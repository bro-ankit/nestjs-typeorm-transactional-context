import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { Injectable } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Entity, PrimaryGeneratedColumn, Column, Repository } from "typeorm";
import { TransactionalAwareRepository } from "../../src/decorators/transactional-aware-repository.decorator";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DbTransactionContext } from "../../src/transaction/db-transaction-context";
import { Transactional } from "../../src/decorators/transactional.decorator";
import { TransactionalModule } from "../../src/transactional-executor/transactional.module";
import { DbTransactionService } from "../../src/transaction/db-transaction.service";

@Entity("test_entity")
class TestEntity {
  @PrimaryGeneratedColumn("uuid", { name: "id" })
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;
}

@Injectable()
@TransactionalAwareRepository(TestEntity)
class TestRepository extends Repository<TestEntity> {
  constructor(private readonly ctx: DbTransactionContext) {
    super(TestEntity, ctx.getEntityManager());
  }

  async createAndReturn(
    name: string,
    description?: string,
  ): Promise<TestEntity> {
    const entity = this.create({ name, description });
    await this.save(entity);
    return entity;
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.update(id, { name });
  }

  async findByName(name: string): Promise<TestEntity[]> {
    return this.find({ where: { name } });
  }
}

@Injectable()
class TestService {
  constructor(
    private readonly repo: TestRepository,
    private readonly dbTransactionService: DbTransactionService,
  ) {}

  async createOutsideTransaction(name: string): Promise<void> {
    await this.repo.createAndReturn(name);
    throw new Error("rollback outside txn");
  }

  @Transactional()
  async createWithTransactional(name: string): Promise<TestEntity> {
    return this.repo.createAndReturn(name);
  }

  @Transactional()
  async createAndFail(name: string): Promise<void> {
    await this.repo.createAndReturn(name);
    throw new Error("rollback transactional");
  }

  @Transactional()
  async createMultiple(names: string[]): Promise<TestEntity[]> {
    const entities: TestEntity[] = [];
    for (const name of names) {
      const entity = await this.repo.createAndReturn(name);
      entities.push(entity);
    }
    return entities;
  }

  @Transactional()
  async updateAndFail(id: string, newName: string): Promise<void> {
    await this.repo.updateName(id, newName);
    throw new Error("update rollback");
  }

  @Transactional()
  async createNested(nameOuter: string, propagation = true): Promise<void> {
    await this.repo.createAndReturn(nameOuter);

    if (propagation) {
      await this.createWithTransactional("innerPropTrue");
    } else {
      await this.dbTransactionService.executeInTransaction(
        { propagation: false },
        async () => {
          await this.repo.createAndReturn("innerPropFalse");
        },
      );
    }

    throw new Error("outer rollback");
  }

  @Transactional()
  async createAndCallAnother(name1: string, name2: string): Promise<void> {
    await this.repo.createAndReturn(name1);
    await this.createWithTransactional(name2);
  }
}

describe("Transactional Library E2E", () => {
  let container: StartedPostgreSqlContainer;
  let app: TestingModule;
  let service: TestService;
  let repo: TestRepository;
  let dbTransactionService: DbTransactionService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:14-alpine")
      .withUsername("test")
      .withPassword("test")
      .withDatabase("test")
      .start();

    app = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          host: container.getHost(),
          port: container.getPort(),
          username: container.getUsername(),
          password: container.getPassword(),
          database: container.getDatabase(),
          entities: [TestEntity],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([TestEntity]),
        TransactionalModule,
      ],
      providers: [TestService, TestRepository],
    }).compile();

    await app.init();

    service = app.get(TestService);
    repo = app.get(TestRepository);
    dbTransactionService = app.get(DbTransactionService);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  }, 30000);

  afterEach(async () => {
    await repo.clear();
  });

  describe("Basic Transaction Operations", () => {
    it("should commit a single transaction successfully", async () => {
      const entity = await service.createWithTransactional("Alice");

      expect(entity.name).toBe("Alice");
      expect(entity.id).toBeDefined();

      const all = await repo.find();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("Alice");
    });

    it("should rollback when transaction fails", async () => {
      await expect(service.createAndFail("Bob")).rejects.toThrow(
        "rollback transactional",
      );

      const count = await repo.count();
      expect(count).toBe(0);
    });

    it("should not rollback when error occurs outside transaction", async () => {
      await expect(service.createOutsideTransaction("Charlie")).rejects.toThrow(
        "rollback outside txn",
      );

      const all = await repo.find();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("Charlie");
    });

    it("should commit multiple operations in single transaction", async () => {
      const entities = await service.createMultiple([
        "User1",
        "User2",
        "User3",
      ]);

      expect(entities).toHaveLength(3);
      expect(entities.map((e) => e.name)).toEqual(["User1", "User2", "User3"]);

      const count = await repo.count();
      expect(count).toBe(3);
    });

    it("should rollback all operations when one fails in transaction", async () => {
      await expect(
        service.createMultiple(["User1", "User2"]).then(() => {
          throw new Error("fail after creates");
        }),
      ).rejects.toThrow();
    });
  });

  describe("Update Operations", () => {
    it("should rollback update operations on error", async () => {
      const entity = await service.createWithTransactional("Original");
      const originalId = entity.id;

      await expect(
        service.updateAndFail(originalId, "Updated"),
      ).rejects.toThrow("update rollback");

      const found = await repo.findOne({ where: { id: originalId } });
      expect(found?.name).toBe("Original");
    });
  });

  describe("Nested Transactions", () => {
    it("should rollback nested transaction when propagation is true", async () => {
      await expect(service.createNested("OuterTrue", true)).rejects.toThrow(
        "outer rollback",
      );

      const all = await repo.find();
      expect(all).toHaveLength(0);
    });

    it("should commit inner transaction when propagation is false", async () => {
      await expect(service.createNested("OuterFalse", false)).rejects.toThrow(
        "outer rollback",
      );

      const all = await repo.find();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("innerPropFalse");
    });

    it("should propagate transaction to called transactional methods", async () => {
      await service.createAndCallAnother("First", "Second");

      const all = await repo.find();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.name).sort()).toEqual(["First", "Second"]);
    });
  });

  describe("Transaction Isolation", () => {
    it("should isolate concurrent transactions", async () => {
      const results: { txA: string[]; txB: string[] } = { txA: [], txB: [] };

      const txA = dbTransactionService.executeInTransaction(async () => {
        await repo.createAndReturn("A1");
        const f1 = await repo.find(); // returns A1
        results.txA.push(...f1.map((r) => r.name));

        // wait till B commits
        await new Promise((resolve) => setTimeout(resolve, 50));

        await repo.createAndReturn("A2"); // returns A1 B1 A2
        const f2 = await repo.find();
        results.txA.push(...f2.map((r) => r.name));
      });

      const txB = dbTransactionService.executeInTransaction(
        { propagation: false },
        async () => {
          // wait till A has inserted A1
          await new Promise((resolve) => setTimeout(resolve, 25));

          const f1 = await repo.find(); // empty still since transaction A is not committed yet
          results.txB.push(...f1.map((r) => r.name));

          await repo.createAndReturn("B1");
          const f2 = await repo.find(); // Returns B1
          results.txB.push(...f2.map((r) => r.name));
        },
      );

      await Promise.all([txA, txB]);

      const finalNames = (await repo.find()).map((r) => r.name).sort();

      expect(results.txA).toEqual(["A1", "A1", "B1", "A2"]);
      expect(results.txB).toEqual(["B1"]);
      expect(finalNames).toEqual(["A1", "A2", "B1"]);
    });

    it("should handle multiple concurrent independent transactions", async () => {
      const transactions = Array.from({ length: 5 }, (_, i) =>
        dbTransactionService.executeInTransaction(
          { propagation: false },
          async () => {
            await repo.createAndReturn(`User${i}`);

            await new Promise((resolve) => setTimeout(resolve, 10));
          },
        ),
      );

      await Promise.all(transactions);

      const count = await repo.count();
      expect(count).toBe(5);
    });
  });

  describe("Error Handling", () => {
    it("should handle errors gracefully and maintain consistency", async () => {
      await service.createWithTransactional("ExistingUser");

      await expect(service.createAndFail("FailedUser")).rejects.toThrow();

      const all = await repo.find();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("ExistingUser");
    });
  });

  describe("Repository Queries", () => {
    it("should work with custom repository methods in transaction", async () => {
      await service.createWithTransactional("TestUser");

      const found = await repo.findByName("TestUser");
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("TestUser");
    });
  });
});
