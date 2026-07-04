import "reflect-metadata";
import {
  Injectable,
  Module,
  OnApplicationBootstrap,
  SetMetadata,
} from "@nestjs/common";
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Transactional } from "../../src/decorators/transactional.decorator";
import { TransactionalExecutor } from "../../src/transactional-executor/transactional-executor";
import { DbTransactionService } from "../../src/transaction/db-transaction.service";

const WITH_METRICS_KEY = Symbol("WITH_METRICS_KEY");
const WithMetrics = (operationName: string) =>
  SetMetadata(WITH_METRICS_KEY, { operationName });

@Injectable()
class MetricsExecutor implements OnApplicationBootstrap {
  public readonly calls: string[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery
      .getProviders()
      .filter((p) => p.instance)) {
      const instance = wrapper.instance as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const original = instance[methodName];
        if (typeof original !== "function") continue;

        const meta = this.reflector.get<{ operationName: string }>(
          WITH_METRICS_KEY,
          original,
        );
        if (!meta) continue;

        const wrapped = (...args: unknown[]) => {
          this.calls.push(meta.operationName);
          return original.apply(instance, args);
        };

        // Any executor doing this kind of wrapping needs to forward metadata for the
        // stacking guarantee to hold - this mirrors what TransactionalExecutor now does.
        for (const key of Reflect.getMetadataKeys(original)) {
          Reflect.defineMetadata(
            key,
            Reflect.getMetadata(key, original),
            wrapped,
          );
        }

        instance[methodName] = wrapped;
      }
    }
  }
}

interface DoesWork {
  doWork(): Promise<string>;
}

describe("Given TransactionalExecutor and another DiscoveryService-based executor wrapping the same method", () => {
  let mockTransactionService: {
    executeInTransaction: ReturnType<typeof vi.fn>;
  };

  async function buildModule(
    executorOrder: "transactional-first" | "metrics-first",
  ) {
    mockTransactionService = {
      executeInTransaction: vi.fn((_opts, fn) => fn()),
    };

    @Injectable()
    class StubService implements DoesWork {
      @Transactional()
      @WithMetrics("stub_operation")
      async doWork(): Promise<string> {
        return "done";
      }
    }

    @Module({
      imports: [DiscoveryModule],
      providers: [
        StubService,
        ...(executorOrder === "transactional-first"
          ? [TransactionalExecutor, MetricsExecutor]
          : [MetricsExecutor, TransactionalExecutor]),
        { provide: DbTransactionService, useValue: mockTransactionService },
      ],
    })
    class TestModule {}

    const module = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    await module.init();

    return {
      stub: module.get(StubService),
      metrics: module.get(MetricsExecutor),
    };
  }

  describe("When TransactionalExecutor wraps before MetricsExecutor", () => {
    it("Then both the transaction and metrics wrapping still apply", async () => {
      const { stub, metrics } = await buildModule("transactional-first");

      const result = await stub.doWork();

      expect(result).toBe("done");
      expect(mockTransactionService.executeInTransaction).toHaveBeenCalled();
      expect(metrics.calls).toEqual(["stub_operation"]);
    });
  });

  describe("When MetricsExecutor wraps before TransactionalExecutor", () => {
    it("Then both the transaction and metrics wrapping still apply", async () => {
      const { stub, metrics } = await buildModule("metrics-first");

      const result = await stub.doWork();

      expect(result).toBe("done");
      expect(mockTransactionService.executeInTransaction).toHaveBeenCalled();
      expect(metrics.calls).toEqual(["stub_operation"]);
    });
  });
});
