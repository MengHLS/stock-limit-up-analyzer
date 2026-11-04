/**
 * STRATEGY-ARCH-001 — Strategy Core 唯一出口。
 *
 * 分层（自下而上，**无环**）：
 *
 *   types                  词表 / 领域错误 / 校验结果
 *   canonical              canonical JSON + sha256
 *   temporal               时间语义（相对日 + evaluation-time + PIT 访问关卡）
 *   expression             值表达式（含文本解析）
 *   ruleGraph              RuleGraph 节点与求值
 *   featureRegistry        特征注册表（含内置指标）
 *   parameterResolver      参数 schema + 解析（FIXED / TUNABLE / DERIVED）
 *   dataRequirements       数据需求 + 兼容性契约 + Dataset 绑定守卫
 *   executionSemantics     执行语义 + 状态迁移
 *   capabilities           能力推导 + 一致性断言
 *   definition             StrategyCoreDefinition（规范 / 校验 / 冻结）
 *   fieldReference         字段引用目录（复用 legacy 唯一解析器）
 *   leakageGuard           泄漏守卫（静态审计 + 运行期关卡 + 产出前断言）
 *   decision               StrategyDecision
 *   fingerprint            行为级指纹
 *   version                StrategyVersion 不可变语义
 *   runSnapshot            运行快照（构建 / 校验 / 复现）
 *   runtime                StrategyRuntime.evaluate（统一执行入口）
 *   adapters/legacy…       legacy StrategyDefinition ⇄ Core 适配
 *
 * 纪律：本目录**不 import** 任何 DB / router / 执行引擎；`runtime.ts` 是本层唯一
 * 需要「外部注入事件判定器」的地方（因为它不认识 Dataset）。
 */

export * from "./types";
export * from "./canonical";
export * from "./temporal";
export * from "./expression";
export * from "./ruleGraph";
export * from "./featureRegistry";
export * from "./parameterResolver";
export * from "./dataRequirements";
export * from "./executionSemantics";
export * from "./capabilities";
export * from "./definition";
export * from "./fieldReference";
export * from "./leakageGuard";
export * from "./decision";
export * from "./fingerprint";
export * from "./version";
export * from "./runSnapshot";
export * from "./runtime";
export * from "./adapters/legacyDefinition";
