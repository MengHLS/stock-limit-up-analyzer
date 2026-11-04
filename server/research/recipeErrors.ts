/**
 * 运行工作台 — 执行配方解析错误。
 *
 * 单独成文件的原因：`recipeRegistry.ts` 会被 `runWorkbenchAssembly` 与（将来的）UI 诊断
 * 端点同时 import；错误类独立可避免「导入注册表只为拿一个错误类」造成的循环与副作用。
 */

/** 配方解析 / 注册错误（消息必须能直接指向「缺哪个配方 / 去改哪里」）。 */
export class StrategyRecipeRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StrategyRecipeRuntimeError";
    this.code = code;
  }
}
