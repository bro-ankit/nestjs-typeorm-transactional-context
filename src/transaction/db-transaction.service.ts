import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { DbTransactionContext } from "./db-transaction-context";
import { TransactionOptions } from "../types/transaction-options.interface";

@Injectable()
export class DbTransactionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: DbTransactionContext,
  ) {}

  async executeInTransaction<T>(
    runInTransaction: (manager: EntityManager) => Promise<T>,
  ): Promise<T>;

  async executeInTransaction<T>(
    options: TransactionOptions,
    runInTransaction: (manager: EntityManager) => Promise<T>,
  ): Promise<T>;

  async executeInTransaction<T>(
    optionsOrRunInTransaction:
      | TransactionOptions
      | ((manager: EntityManager) => Promise<T>),
    maybeRunInTransaction?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const options: TransactionOptions =
      typeof optionsOrRunInTransaction === "function"
        ? { propagation: true, isolationLevel: "READ COMMITTED" }
        : optionsOrRunInTransaction;

    const runInTransaction =
      typeof optionsOrRunInTransaction === "function"
        ? optionsOrRunInTransaction
        : maybeRunInTransaction;

    if (!runInTransaction) {
      throw new Error("runInTransaction function must be provided");
    }

    const { propagation = true, isolationLevel = "READ COMMITTED" } = options;

    if (propagation && this.transactionContext.hasActiveTransaction()) {
      const existingManager = this.transactionContext.getEntityManager();
      return runInTransaction(existingManager);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction(isolationLevel);

    try {
      return await this.transactionContext.runInContext(
        queryRunner.manager,
        async () => {
          const result = await runInTransaction(queryRunner.manager);
          await queryRunner.commitTransaction();
          return result;
        },
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
