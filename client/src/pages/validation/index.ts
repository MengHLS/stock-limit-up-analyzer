/**
 * 验证域页面 barrel（FRONTEND-FINAL-001 · P0-1）。
 *
 * 正式验证域 = 稳健性 / OOS / Walk-Forward 三块，全部走**持久化** `paramSearch.*` 端点。
 */

export { default as ValidationIndexPage } from "./ValidationIndexPage";
export { default as RobustnessValidationPage } from "./RobustnessValidationPage";
export { default as OosValidationPage } from "./OosValidationPage";
export { default as WalkForwardValidationPage } from "./WalkForwardValidationPage";
