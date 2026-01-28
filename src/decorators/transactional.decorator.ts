import { SetMetadata } from "@nestjs/common";
import { IsolationLevel } from "typeorm/driver/types/IsolationLevel.js";

export const TRANSACTIONAL_KEY = "TRANSACTIONAL_METHOD";

export function Transactional(
  propagation?: boolean,
  isolationLevel?: IsolationLevel,
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    SetMetadata(TRANSACTIONAL_KEY, { isolationLevel, propagation })(
      target,
      propertyKey,
      descriptor,
    );

    return descriptor;
  };
}
