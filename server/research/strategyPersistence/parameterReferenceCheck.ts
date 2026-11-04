/**
 * FRONTEND-FINAL-001（P1-1）— 策略版本的**参数引用面**只读判定。
 *
 * ## 为什么需要这一层
 *
 * 参数「声明在 schema 里」**不等于**「决策引擎会读它」。实测 `cand-360001@1.0.0` 声明 3 个
 * `TUNABLE` 参数、规则图引用 **0** 个 ⇒ 3 组不同取值产出的权益曲线**逐字节相同**
 * （搜索结果是「假差异」）。后端因此以
 * `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 拒绝 Run；但**只有后端知道**这件事，
 * 前端此前只能原样转述一个错误码。本模块把该判定投影成可读字段，让 UI 能在发起搜索**之前**
 * 就展示「哪些参数不会被任何执行链读到」。
 *
 * ## 判据（**不新写解析逻辑**）
 *
 * 唯一权威收集器 = `strategyCore/ruleGraph.ts#collectRuleParameterReferences`；
 * 引用面 = 入口规则图 + 出场规则图 + 声明式出场规则的 `parameterCode`
 * （与 `server/paramSearchRouter.ts#referencedParameterCodesOf` **同一组合口径**，
 *  保证「前端预检查」与「后端拒绝」看到的是同一个集合）。
 *
 * ## 不可判定（🔴 绝不用默认值冒充结论）
 *
 * Core 定义不可构造（历史 v1 文档无 `definition` 段 / 适配器构造失败）⇒ `applied = false`
 * 且 `referencedCodes = []`，由调用方/前端显性显示「不可判定」，而不是「没有被引用」。
 *
 * 纯函数：无 IO、不取系统时间（`createdAt` 由调用方注入）。
 */

import { collectRuleParameterReferences } from "../../strategyCore/ruleGraph";
import { coreVersionFromDocument } from "../../strategyCore/production/versionFromDocument";
import type { StrategyDocument } from "../strategySchema/types";
import type {
  ParameterReferenceCheckSummary,
  StrategyVersionBundle,
  StrategyVersionBundleWithReferences,
} from "./contract";

/**
 * 由一个策略文档判定其**规则图实际引用**的参数 code 集合。
 *
 * @param document 已落库的 canonical 策略文档（权威来源）
 * @param createdAt 注入式时间戳（Core 版本元数据用；本模块不取系统时间）
 */
export function checkParameterReferences(
  document: StrategyDocument,
  createdAt: string,
): ParameterReferenceCheckSummary {
  const core = coreVersionFromDocument({ document, createdAt });
  if (!core.ok) {
    return {
      applied: false,
      referencedCodes: [],
      note:
        `⚠️ 未做引用面检查：Core 定义不可构造（${core.reason}）⇒ 该版本执行链引用的参数无法枚举。`
        + "此时每行的 `referenced` 恒为 false，**不代表「未被引用」**。",
    };
  }
  const refs = new Set<string>(collectRuleParameterReferences(core.version.definition.ruleGraph));
  const exitGraph = core.version.definition.exitRuleGraph;
  if (exitGraph !== null) {
    for (const code of collectRuleParameterReferences(exitGraph)) refs.add(code);
  }
  for (const rule of core.version.definition.exitRules) {
    const code = (rule as { readonly parameterCode?: unknown }).parameterCode;
    if (typeof code === "string" && code !== "") refs.add(code);
  }
  const sorted = [...refs].sort();
  return {
    applied: true,
    referencedCodes: sorted,
    note:
      `引用面检查已执行：规则图引用 ${String(sorted.length)} 个参数`
      + `（${sorted.join(" / ") || "（无）"}）。`,
  };
}

/**
 * 把引用面判定**附加**到版本包上（返回新对象，不修改入参）。
 *
 * 只做两件事：给每个参数行补 `referenced`、在包顶层补 `parameterReferenceCheck`；
 * 既有字段（含 `projections` 的其它 4 类与每个参数行的既有列）逐字段透传，语义不变。
 */
export function attachParameterReferences(
  bundle: StrategyVersionBundle,
  createdAt: string,
): StrategyVersionBundleWithReferences {
  const check = checkParameterReferences(bundle.document, createdAt);
  const referencedCodes = new Set(check.referencedCodes);
  return {
    ...bundle,
    projections: {
      ...bundle.projections,
      parameters: bundle.projections.parameters.map((row) => ({
        ...row,
        // 不可判定时恒 false，真实含义由 `parameterReferenceCheck.applied` 给出。
        referenced: check.applied && referencedCodes.has(row.code),
      })),
    },
    parameterReferenceCheck: check,
  };
}
