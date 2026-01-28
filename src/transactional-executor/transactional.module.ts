import { Global, Module } from "@nestjs/common";
import { TransactionalExecutor } from "./transactional-executor";
import { DiscoveryModule } from "@nestjs/core";
import { DbTransactionService } from "../transaction/db-transaction.service";
import { DbTransactionContext } from "../transaction/db-transaction-context";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    DbTransactionService,
    DbTransactionContext,
    TransactionalExecutor,
  ],
  exports: [DbTransactionService, DbTransactionContext],
})
export class TransactionalModule {}
