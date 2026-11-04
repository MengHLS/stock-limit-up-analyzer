/**
 * 实例的结果契约（薄层）。
 *
 * 🔴 本文件**不得**运行时 import `assemble.ts` / `template.ts` —— 它们依赖
 *    `node:zlib`（服务端产物写入），一旦被 `page.tsx` 间接引用，node 内置模块就会
 *    被打进浏览器 bundle。因此这里只从 `types.ts`（纯常量与类型，零 node 依赖）取常量，
 *    载荷**类型**用 `import type`（编译期完整擦除）。
 *
 * 实例的自有结果结构由模板的 `compositeFactorSchema` 唯一定义（在 `assemble.ts`），
 * 本文件不复制、不裁剪 —— 复制一份“页面用的 schema”正是漂移的起点。
 */

export {
  COMPOSITE_FACTOR_CONTRACT_ID,
  COMPOSITE_FACTOR_EXPERIMENT_TYPE,
  COMPOSITE_FACTOR_TEMPLATE_ID,
  COMPOSITE_COMBOS,
  COMPOSITE_TOP_N_SIZES,
  COMPUTATION_VERSION,
  DAY_SCOPES,
  DAY_SCOPE_LABELS,
  FACTOR_DIRECTION_LABELS,
  NORMALIZATION_LABELS,
} from "../../shared/compositeFactor/types";

export type { CompositeFactorPayload } from "../../shared/compositeFactor/assemble";
