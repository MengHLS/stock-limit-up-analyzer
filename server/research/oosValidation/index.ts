/**
 * OOS-001 — Out-of-Sample Validation 统一出口。
 *
 * ## 交付内容
 *
 * | 文件 | 职责 |
 * | --- | --- |
 * | `types.ts`               | 领域类型 + 身份常量（Run / Result / 冻结候选 / 源坐标 / 执行结果） |
 * | `window.ts`              | OOS 时间窗口隔离（纯函数；`oosStart > searchEnd` 等五条判定） |
 * | `freeze.ts`              | 冻结候选参数（**重算 parameterHash 复核**，不信任库里的值） |
 * | `comparison.ts`          | IS / OOS 对照（六对指标；delta / ratio / degradation / drawdown change） |
 * | `run.ts`                 | 状态机（**复用** PS 唯一权威迁移表）· ID · 指纹 · 执行前置判定 |
 * | `gate.ts`                | 源 Run / 源结果 Validity Gate + **选中组合** canonical 读数 Gate |
 * | `definitionFingerprint.ts` | 策略定义指纹（构造不出 ⇒ `null`，**绝不编造**） |
 * | `persistence.ts`         | 两表读写（唯一落点；`parameter_search_*` **只读**） |
 * | `executor.ts`            | create / start / cancel / read / list / result |
 *
 * ## 与 `searchRobustness/**` 的关系（**语义相反，并列不互相取代**）
 *
 * - `server/research/searchRobustness/**`（ROBUSTNESS-001）：冻结 Search Result 上的
 *   邻域稳定性分析 —— **零重跑、零重算**；
 * - 本目录（OOS-001）：在**未参与搜索的数据窗口**上**重新执行 Backtest 并重算
 *   canonical metrics** —— **必须重跑**。
 *
 * 两者同属「消费 Parameter Search 结果」的输入姿态，但一个刻意不执行、一个刻意执行，
 * 因此是**并列兄弟模块**。本目录**未改动** `searchRobustness/**` 任何一行。
 *
 * ## 与仓库既有「OOS」模块的关系（🔴 **四者并存，边界必须分清**）
 *
 * 本仓在 OOS-001 之前**已有四套与「样本外」相关的模块**。它们都**未**被本目录改动，
 * 也**都不是**「可重跑的、落库的、绑定 Parameter Search 结果的验证运行」：
 *
 * | 既有模块 | STEP | 职责 | 与本域的关键差别 |
 * | --- | --- | --- | --- |
 * | `research/trainValidationOos.ts` | 6.4 | Train/Validation/OOS **评估计划模型**（immutable plan + fingerprint） | **纯模型**，不可执行、不落库 |
 * | `research/validationSelection.ts` | 6.4 | 选中实验 → `FrozenOosCandidate`（参数/版本/成本模型锁定） | **纯模型**；且 `FrozenOosCandidate` 是**进程内计划候选**，不是「某次真实 Search Run 的组合行快照」 |
 * | `research/oosEvaluation.ts` | 6.4 | 冻结候选的 OOS **结果容器**（`OosEvaluationResult`） | 文件头自述「**不实现任何回测 / 交易**」 |
 * | `research/oosIsolation/**` | 19 (C-19.2) | IS/OOS **隔离记录 + 纪律机器检查 + 归档账本** | 记录/检查层，**无重跑语义** |
 *
 * 本目录（OOS-001）与它们的**根本差别**有四条，缺一条就不算 OOS-001：
 *   ① **有 Run 身份与状态机**（`OOSV-…` + CREATED/RUNNING/COMPLETED/FAILED/CANCELLED + 幂等 + `COMPLETED` 不可重跑）；
 *   ② **参数冻结可复核**（`parameterHash` 重算比对；入参里**没有参数值位置**）；
 *   ③ **真进闭环重跑**（经 `strategyEvaluation/backtestBridge` 走 data→research→strategy→backtest→evaluation）；
 *   ④ **落库可追溯**（`oos_validation_run` / `oos_validation_result` 两表，含冻结快照与 IS/OOS 对照）。
 *
 * ⚠️ 因为命名空间已相当拥挤，本域导出的通用名一律带 `oos` 前缀
 *   （`oosFingerprintOf` / `oosCalendarDaysBetween`），且类型名避开既有同名
 *   （`FrozenCandidateSnapshot` 而非 `FrozenOosCandidate`）—— 见 `types.ts` / `run.ts` /
 *   `window.ts` 内的逐条说明。
 *
 * 🔴 本目录**不允许**出现：参数搜索 / 参数重选 / 参数调整 / 按 OOS 表现改参数 /
 *   读取「当前最新策略版本」补全历史冻结信息 / 任何「最佳 · 最优 · 推荐」型结论。
 */

export * from "./types";
export * from "./window";
export * from "./freeze";
export * from "./comparison";
export * from "./run";
export * from "./gate";
export * from "./definitionFingerprint";
export * from "./persistence";
export * from "./executor";
