import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

/**
 * Vite/Vitest 会把静态 `import ... from "node:sqlite"` 错解析为裸包。
 * 运行时仍从 Node 内建模块取得同一构造器，调用方只依赖这里的类型别名。
 */
export const NodeSqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
export const DatabaseSync = NodeSqlite.DatabaseSync;
export type DatabaseSync = NodeDatabaseSync;
