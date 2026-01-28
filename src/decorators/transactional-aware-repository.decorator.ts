import { ObjectLiteral, Repository } from "typeorm";
import { DbTransactionContext } from "../transaction/db-transaction-context";

type BaseTargetType = { new (...args: any[]): Record<string, any> };

function isMethodOverridden<T extends BaseTargetType>(
  target: InstanceType<T>,
  repo: Repository<ObjectLiteral>,
  prop: string | symbol,
): boolean {
  const targetProto = Object.getPrototypeOf(target);
  const repoProto = Object.getPrototypeOf(repo);
  return targetProto[prop] !== repoProto[prop];
}

function handleRepoProperty<T extends BaseTargetType>(
  target: InstanceType<T>,
  repo: Repository<ObjectLiteral>,
  prop: string | symbol,
  proxyInstance: any,
) {
  const value = (repo as any)[prop];

  if (typeof value === "function") {
    if (isMethodOverridden(target, repo, prop)) {
      return (target as any)[prop].bind(proxyInstance);
    }
    return value.bind(repo);
  }

  return value;
}

function handleTargetProperty<T extends BaseTargetType>(
  target: InstanceType<T>,
  prop: string | symbol,
  proxyInstance: InstanceType<T>,
) {
  const value = (target as any)[prop];
  if (typeof value === "function") {
    return value.bind(proxyInstance);
  }
  return value;
}

export function TransactionalAwareRepository<T extends BaseTargetType>(
  EntityClass: any,
) {
  return function (constructor: T) {
    return class extends constructor {
      constructor(...args: any[]) {
        super(...args);

        const context = args.find((arg) => arg instanceof DbTransactionContext);
        if (!context) throw new Error("DbTransactionContext not found");

        const proxyInstance: typeof this = new Proxy(this, {
          get: (target, prop) => {
            const repo = context.getEntityManager().getRepository(EntityClass);

            if (prop in repo) {
              return handleRepoProperty(target, repo, prop, proxyInstance);
            }

            return handleTargetProperty(target, prop, proxyInstance);
          },
        });

        // Rebind all prototype methods to the proxy instance
        const proto = Object.getPrototypeOf(this);
        Object.getOwnPropertyNames(proto).forEach((key) => {
          if (
            key !== "constructor" &&
            typeof (this as any)[key] === "function"
          ) {
            (proxyInstance as any)[key] = (proxyInstance as any)[key].bind(
              proxyInstance,
            );
          }
        });

        return proxyInstance;
      }
    };
  };
}
