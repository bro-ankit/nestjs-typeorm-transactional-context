import { IsolationLevel } from "typeorm/driver/types/IsolationLevel.js";

export interface TransactionOptions {
  /**
   * Whether to propagate the transaction context.
   * - true: Join existing transaction (default)
   * - false: Create new independent transaction
   * @default true
   */
  propagation?: boolean;

  /**
   * Transaction isolation level
   * @default 'READ COMMITTED'
   */
  isolationLevel?: IsolationLevel;
}
