# NestJS TypeORM Transactional Context

> Transaction management for NestJS with TypeORM supporting propagation and isolation.

[![npm version](https://img.shields.io/npm/v/@bro-ankit/nestjs-typeorm-transactional-context.svg)](https://www.npmjs.com/package/@bro-ankit/nestjs-typeorm-transactional-context)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why This Package?

Managing transactions in NestJS can be cumbersome. This library provides:

- **Zero boilerplate** - Just add `@Transactional()` decorator
- **Framework integration** - Built specifically for NestJS dependency injection
- **Type safety** - Full TypeScript support with proper types
- **Tested** - Battle-tested with comprehensive test coverage
- **Lightweight** - Minimal dependencies, leverages existing TypeORM

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [API Reference](#api-reference)
- [Advanced Patterns](#advanced-patterns)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Features

- ✅ **Declarative Transactions** - Simple `@Transactional()` decorator
- ✅ **Transaction Propagation** - Control nested transaction behavior
- ✅ **Transaction-Aware Repositories** - Repositories that respect transaction context
- ✅ **Isolation Levels** - Support for all TypeORM isolation levels
- ✅ **Async Context** - Works with NestJS's async context
- ✅ **TypeScript** - Full type safety
- ✅ **Testing** - Easy to test with dependency injection

---

## Installation

```bash
npm install @bro-ankit/nestjs-transactional-context
# or
yarn add @bro-ankit/nestjs-transactional-context
# or
pnpm add @bro-ankit/nestjs-transactional-context
```

---

## Requirements

- NestJS 10.x or higher
- TypeORM 0.3.x or higher
- Node.js 18.x or higher

---

## Quick Start

### 1. Import Modules

```ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TransactionalModule } from "@bro-ankit/nestjs-transactional-context";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      // ... your database config
    }),
    TransactionalModule, // Required
  ],
})
export class AppModule {}
```

### 2. Use the `@Transactional()` Decorator

```ts
import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";
import { Transactional } from "@bro-ankit/nestjs-transactional-context";
import { User } from "./user.entity";
import { InjectRepository } from "@nestjs/typeorm";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Transactional()
  async createUser(name: string, email: string): Promise<User> {
    const user = this.userRepository.create({ name, email });
    await this.userRepository.save(user);

    if (!email.includes("@")) {
      throw new Error("Invalid email"); // rolls back the created user
    }

    return user;
  }
}
```

### 3. Create Transaction-Aware Repositories

```ts
import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";
import {
  TransactionalAwareRepository,
  DbTransactionContext,
} from "@bro-ankit/nestjs-transactional-context";
import { User } from "./user.entity";

@Injectable()
@TransactionalAwareRepository(User)
export class UserRepository extends Repository<User> {
  constructor(private readonly ctx: DbTransactionContext) {
    super(User, ctx.getEntityManager());
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async createUser(name: string, email: string): Promise<User> {
    const user = this.create({ name, email });
    return this.save(user);
  }
}
```

Register in your module:

```ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user.entity";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserRepository, UserService],
  exports: [UserService],
})
export class UserModule {}
```

---

## Usage Examples

### Basic Transaction

```ts
@Injectable()
export class OrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  @Transactional()
  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    const order = this.orderRepository.create({ userId, items });
    await this.orderRepository.save(order);
    return order; // Automatically commits
  }
}
```

### Nested Transactions with Propagation

```ts
@Injectable()
export class PaymentService {
  constructor(
    private readonly orderRepository: Repository<Order>,
    private readonly paymentRepository: Repository<Payment>,
    private readonly dbTransactionService: DbTransactionService,
  ) {}

  @Transactional()
  async processPayment(orderId: string): Promise<Payment> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    const payment = await this.createPaymentRecord(order);

    // Independent transaction for logging
    await this.dbTransactionService.executeInTransaction(
      { propagation: false },
      async () => {
        await this.logPaymentAttempt(orderId);
      },
    );

    return payment;
  }

  @Transactional()
  private async createPaymentRecord(order: Order): Promise<Payment> {
    return this.paymentRepository.save({ orderId: order.id } as Payment);
  }

  private async logPaymentAttempt(orderId: string): Promise<void> {
    // logging logic here
  }
}
```

### Manual Transaction Control

```ts
@Injectable()
export class ReportService {
  constructor(
    private readonly dbTransactionService: DbTransactionService,
    private readonly orderRepository: OrderRepository,
    private readonly reportRepository: ReportRepository,
  ) {}

  async generateReport(): Promise<Report> {
    return this.dbTransactionService.executeInTransaction(async () => {
      const data = await this.orderRepository.find();
      const processed = await this.processData(data);
      return this.reportRepository.save(processed);
    });
  }
}
```

### Transaction Rollback

```ts
@Injectable()
export class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  @Transactional()
  async transfer(fromId: string, toId: string, amount: number): Promise<void> {
    const fromAccount = await this.accountRepository.findOne({
      where: { id: fromId },
    });
    const toAccount = await this.accountRepository.findOne({
      where: { id: toId },
    });

    if (!fromAccount || !toAccount) throw new Error("Accounts not found");

    if (fromAccount.balance < amount) {
      throw new Error("Insufficient funds"); // Automatically rolls back
    }

    fromAccount.balance -= amount;
    toAccount.balance += amount;

    await this.accountRepository.save([fromAccount, toAccount]);
  }
}
```

### Isolation Levels

```ts
import { IsolationLevel } from "typeorm/driver/types/IsolationLevel";

@Injectable()
export class InventoryService {
  constructor(
    private readonly productRepository: Repository<Product>,
    private readonly dbTransactionService: DbTransactionService,
  ) {}

  async updateStock(productId: string, quantity: number): Promise<void> {
    await this.dbTransactionService.executeInTransaction(
      { isolationLevel: "SERIALIZABLE" },
      async () => {
        const product = await this.productRepository.findOne({
          where: { id: productId },
        });
        product.stock -= quantity;
        await this.productRepository.save(product);
      },
    );
  }
}
```

---

## API Reference

### `@Transactional()`

```ts
@Transactional()
async myMethod(): Promise<void> {
  // commits automatically on success
  // rolls back automatically on error
}
```

### `@TransactionalAwareRepository(entity)`

```ts
@Injectable()
@TransactionalAwareRepository(User)
export class UserRepository extends Repository<User> {
  constructor(private readonly ctx: DbTransactionContext) {
    super(User, ctx.getEntityManager());
  }
}
```

### `DbTransactionService`

```ts
executeInTransaction<T>(callback: () => Promise<T>): Promise<T>
executeInTransaction<T>(options: TransactionOptions, callback: () => Promise<T>): Promise<T>
```

### `DbTransactionContext`

```ts
getEntityManager(): EntityManager
getQueryRunner(): QueryRunner | undefined
isActive(): boolean
getTransactionId(): string | undefined
```

### `TransactionOptions`

```ts
interface TransactionOptions {
  propagation?: boolean; // default: true
  isolationLevel?: IsolationLevel; // default: 'READ COMMITTED'
}
```

### `IsolationLevel`

```ts
type IsolationLevel =
  | "READ UNCOMMITTED"
  | "READ COMMITTED"
  | "REPEATABLE READ"
  | "SERIALIZABLE";
```

---

## Advanced Patterns

### Testing with Transactions

```ts
describe("UserService", () => {
  let service: UserService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          /* test db config */
        }),
        TransactionalModule,
        TypeOrmModule.forFeature([User]),
      ],
      providers: [UserService, UserRepository],
    }).compile();

    service = module.get(UserService);
  });

  it("should rollback on error", async () => {
    await expect(service.createUser("test", "invalid-email")).rejects.toThrow(
      "Invalid email",
    );

    const count = await service.countUsers();
    expect(count).toBe(0);
  });
});
```

### Concurrent Transactions

```ts
async processBatch(items: Item[]): Promise<void> {
  await Promise.all(
    items.map(item =>
      this.dbTransactionService.executeInTransaction({ propagation: false }, async () => {
        await this.processItem(item);
      }),
    ),
  );
}
```

### Event-Driven / Background Jobs (SQS, Cron, Microservices)

Unlike other libraries, this package doesn't depend on the HTTP Request object. It works anywhere thanks to the NestJS Discovery Module.

```ts
@Injectable()
export class SqsConsumer {
  constructor(private readonly userService: UserService) {}

  @SqsMessageHandler("user-queue")
  @Transactional() // Just works! No manual wrapping needed.
  async handleMessage(message: AWS.SQS.Message) {
    const data = JSON.parse(message.Body);
    await this.userService.update(data.id, data.updates);
  }
}
```

---

## Troubleshooting

- Ensure `@Transactional()` is applied.
- Ensure repository extends `@TransactionalAwareRepository`.
- Ensure errors are thrown for rollback.

---

## Best Practices

- Keep transactions short.
- Don’t catch errors inside `@Transactional()`.
- Use propagation wisely.
- Set timeouts.
- Use appropriate isolation levels.

---

## Comparison with Other Solutions

| Feature                | This Package                        | nestjs-cls (Transactional)                          | Manual TypeORM | typeorm-transactional |
| :--------------------- | :---------------------------------- | :-------------------------------------------------- | :------------- | :-------------------- |
| **NestJS Integration** | ✅ Native (Simple Import)           | ✅ Plugin-based                                     | ⚠️ Manual      | ⚠️ Limited            |
| **Setup Complexity**   | ✅ **Minimal (Plug-and-play)**      | ⚠️ High (Multi-step config)                         | ⚠️ Moderate    | ✅ Low                |
| **Execution Context**  | ✅ **Agnostic (Works in SQS/Cron)** | ⚠️ (Controller Context Bound) Requires manual setup | ❌ Manual prop | ✅ Supports ALS       |
| **Bundle Weight**      | ✅ **Ultralight (Single-purpose)**  | 📦 Heavy (Full CLS Suite)                           | N/A            | ⚠️ Moderate           |
| **Decorator Support**  | ✅ `@Transactional()`               | ✅ `@Transactional()`                               | ❌ No          | ✅ `@Transactional()` |
| **Async Context**      | ✅ Native `AsyncLocalStorage`       | ✅ `AsyncLocalStorage`                              | ❌ No          | ⚠️ Legacy             |
| **Active Maintenance** | ✅ **Active**                       | ✅ Active                                           | N/A            | ❌ Archived           |
| **TypeScript First**   | ✅                                  | ✅                                                  | ✅             | ⚠️                    |

---

## Contributing

Contributions are welcome! Submit a PR.

---

## License

MIT © [Ankit Pradhan](https://github.com/bro-ankit)

```

```
