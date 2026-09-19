/**
 * 由策略文档的 `parameters` 派生**参数搜索空间**（STEP B 落点③ 的接线件）。
 *
 * ## 🔴 状态标记：`LEGACY / PREVIEW`（PARAMETER-002 判定，2026-09-19）
 *
 * 本文件是**旧派生器**：它读 `document.parameters`（**legacy v1 有损视图**，
 * `ResearchParameterSchema` 里**没有 `parameterRole` 字段**）⇒ 只要 `FIXED` 参数带
 * `min/max/step`，它就会**照样进搜索空间**（R-05 的机制）。
 *
 * ### 仍然保留的原因（实查有真实消费者，**不是死代码**）
 *
 * | 消费者 | 场景 | 为什么不能立刻切到新派生器 |
 * |---|---|---|
 * | `server/paramSearchRouter.ts`（`describe` / `run` 的 effectiveSpace） | **技术预览**端点 | 预览的入参是「调用方给的一张 `ParameterSpace`」，本就不是按 role 派生的语义 |
 * | `server/research/closedLoopWiring/executors.ts`（**optimization 阶段**） | 闭环 14 阶段主链之一 | 该阶段只持有 `document`，**不持有** `strategy_parameters` 投影行；新派生器要求 projection（含 role）。切换属于**主链改动**，不在 PARAMETER-002 范围内（登记为遗留） |
 *
 * ### 🔴 PARAMETER-001/002 的持久化搜索**永远**使用新的 role-aware 派生器
 *
 * 唯一实现 = `server/research/parameterSearch/searchSpace.ts#deriveParameterSearchSpaceFromProjection`：
 *   - 读 **`strategy_parameters` 投影的 `parameterRole`** ⇒ `FIXED` 不进搜索空间、`DERIVED` 不得直接搜索；
 *   - 读**规则图参数引用面** ⇒ 排除「死参数」（声明为 TUNABLE 但决策引擎读不到）。
 *
 * **禁止**把 `server/research/parameterSearch/**` 切回本文件 —— 由
 * `tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts` 的
 * **静态源码守卫**钉住（一旦回退，测试立刻变红）。
 *
 * ---
 *
 * ## 为什么必须从文档派生
 *
 * `paramSearchRouter.ts` 的 `MAPPABLE_PARAMETER_DICTIONARY` 是一张**固定 8 字段白名单**，
 * 未收录的维度落到 `switch` 的 `default: break` ⇒ **静默忽略**（P0-2 的直接证据：
 * 调用方以为某维度参与了寻优，实际被丢掉且无任何提示）。
 * 文档的 `parameters` 才是「这个策略到底暴露了哪些可调参数」的唯一权威声明，
 * 因此搜索空间必须由它派生，而不是由调用方传一张字典。
 *
 * ## 三类参数的处理口径（**禁静默丢弃**）
 *
 * | 情况 | 处理 |
 * |---|---|
 * | `number` 且 `min` / `max` / `step(>0)` 齐备且 `min <= max` | 进搜索空间 |
 * | 其余（`string` / `boolean` / 缺界或界非法的 `number`） | **如实记入 `excluded`**（带原因） |
 *
 * ⚠️ 为什么缺界时**不猜**：`min` / `max` / `step` 是搜索空间的**定义**，不是可以补的默认值。
 * 猜 `step = 1` 会把一个 `[0, 0.3]` 的连续阈值变成 31 个搜索点 —— 那是拿「我们的臆测」
 * 替换「研究者声明的意图」。这与 `strategyCandidate/definitionBuild.ts:454` 的既有口径一致
 * （「范围必须由草稿声明 —— 数值参数要同时给出 min 与 max，Promote 不会替你给搜索空间定界」）。
 *
 * 本函数**纯函数、零抛错**：返回结构化结果（含 `excluded`），
 * 由调用方决定「一个可搜索参数都没有」时是否响亮失败。
 */

import type { ParameterSpace, SweepNumberParameter } from "../parameterSpace";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterType } from "../types";

/** 未进搜索空间的参数（**必须**如实带出去，禁静默丢弃）。 */
export interface ExcludedParameter {
  readonly name: string;
  readonly type: ResearchParameterType;
  /** 为什么不进（逐条可读，含缺哪些界）。 */
  readonly reason: string;
}

export interface ParameterSpaceDerivation {
  /** 可搜索空间（可能为空 —— 空不等于错，由调用方决定怎么处理）。 */
  readonly space: ParameterSpace;
  readonly excluded: readonly ExcludedParameter[];
  /** 文档声明的全部参数名（含已排除者）——供「如实回显」与审计对账。 */
  readonly declaredParameterNames: readonly string[];
}

/**
 * 从策略文档派生搜索空间。
 *
 * 参数顺序 = 文档声明顺序（**不排序**：顺序本身是研究者声明的一部分，
 * 且网格生成按声明序做笛卡尔积，保持顺序即保持 `evaluatedSamples` 可追溯）。
 */
export function deriveParameterSpaceFromDocument(document: StrategyDocument): ParameterSpaceDerivation {
  const declared = document.parameters?.parameters ?? [];
  const parameters: SweepNumberParameter[] = [];
  const excluded: ExcludedParameter[] = [];

  for (const parameter of declared) {
    if (parameter.type !== "number") {
      excluded.push({
        name: parameter.name,
        type: parameter.type,
        reason: `type=${parameter.type}（当前搜索空间只表达数值参数；非数值维度不被静默转成数值）`,
      });
      continue;
    }

    const missing: string[] = [];
    if (typeof parameter.min !== "number" || !Number.isFinite(parameter.min)) missing.push("min");
    if (typeof parameter.max !== "number" || !Number.isFinite(parameter.max)) missing.push("max");
    if (typeof parameter.step !== "number" || !Number.isFinite(parameter.step) || parameter.step <= 0) {
      missing.push("step（必须 > 0 且有限）");
    }
    if (missing.length > 0) {
      excluded.push({
        name: parameter.name,
        type: parameter.type,
        reason: `数值参数缺 ${missing.join(" / ")}——搜索空间的范围必须由文档声明，不替你猜`,
      });
      continue;
    }

    // 走到这里 min / max / step 已确认是有限数字；排除顺序倒挂（否则 validateParameterSpace 会抛）
    if (parameter.min! > parameter.max!) {
      excluded.push({
        name: parameter.name,
        type: parameter.type,
        reason: `min(${parameter.min}) > max(${parameter.max})——范围倒挂，不替你交换`,
      });
      continue;
    }

    parameters.push({
      type: "number",
      name: parameter.name,
      min: parameter.min!,
      max: parameter.max!,
      step: parameter.step!,
    });
  }

  return {
    space: { parameters },
    excluded,
    declaredParameterNames: declared.map(parameter => parameter.name),
  };
}
