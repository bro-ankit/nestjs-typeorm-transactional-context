import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { DbTransactionService } from "../transaction/db-transaction.service";
import { IsolationLevel } from "typeorm/browser/driver/types/IsolationLevel.js";
import { TRANSACTIONAL_KEY } from "../decorators/transactional.decorator";

@Injectable()
export class TransactionalExecutor implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly transactionService: DbTransactionService,
  ) {}

  onApplicationBootstrap() {
    this.applyTransactionalWrappers();
  }

  private applyTransactionalWrappers() {
    const providers = this.discovery.getProviders().filter((p) => p.instance);
    for (const wrapper of providers) {
      const instance = wrapper.instance;
      const prototype = Object.getPrototypeOf(instance);

      if (!prototype) continue;

      const methodNames = this.scanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const originalMethod = instance[methodName];
        if (typeof originalMethod !== "function") continue;

        const metadata = this.reflector.get<{
          isolationLevel: IsolationLevel;
          propagation: boolean;
        }>(TRANSACTIONAL_KEY, originalMethod);

        if (!metadata) continue;

        const wrapped = async (...args: unknown[]) => {
          return this.transactionService.executeInTransaction(
            {
              propagation: metadata.propagation,
              isolationLevel: metadata.isolationLevel,
            },
            async () => {
              return originalMethod.apply(instance, args);
            },
          );
        };

        this.copyMetadata(originalMethod, wrapped);
        instance[methodName] = wrapped;
      }
    }
  }

  // Preserves decorator metadata on the replacement function so stacked decorators
  // (e.g. another DiscoveryService-based executor on the same method) still work,
  // regardless of which executor's onApplicationBootstrap runs first.
  private copyMetadata(source: object, target: object) {
    for (const key of Reflect.getMetadataKeys(source)) {
      Reflect.defineMetadata(key, Reflect.getMetadata(key, source), target);
    }
  }
}
