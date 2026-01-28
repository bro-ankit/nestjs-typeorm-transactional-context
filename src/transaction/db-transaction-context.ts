import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AsyncLocalStorage } from "node:async_hooks";

@Injectable()
export class DbTransactionContext {
  private readonly asyncLocal: AsyncLocalStorage<EntityManager>;

  constructor(private readonly dataSource: DataSource) {
    this.asyncLocal = new AsyncLocalStorage<EntityManager>();
  }

  runInContext<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.asyncLocal.run(manager, fn);
  }

  getEntityManager(): EntityManager {
    return this.asyncLocal.getStore() ?? this.dataSource.manager;
  }

  hasActiveTransaction(): boolean {
    return !!this.asyncLocal.getStore();
  }
}
