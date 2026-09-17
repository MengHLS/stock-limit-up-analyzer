# Step 3 开发完成报告 —— Strategy Contract 统一策略契约

## 总体说明

在 Step 1（统一统计基础层 shared/quant-stats.ts）与 Step 2（统一 Backtest Core server/engine/）之上，
建立统一 Strategy Contract + Strategy Registry，并完成第一个真实策略迁移。

本 Step 未重新实现 Step 1/Step 2，未删除 Legacy，未进入 Step 3 之外的任何后续功能。
本报告只陈述「开发完成」，不提前宣称 Step 3 PASS（PASS 判定留给下一阶段独立审计）。

---

## 1. Strategy Contract

新增 `server/strategy/contract.ts`，定义策略形态约束：

- `StrategyConfig`：策略参数基类，要求可序列化、可复现、可记录。
- `StrategyAction`：`BUY | SELL | HOLD`（意图，非成交）。
- `StrategySignal`：统一信号模型（symbol / signalTime / action / score / confidence / reason / metadata）。
- `StrategyDecision`：信号集合 + strategyVersion + insufficientData。
- `ReadonlyPortfolioContext`：只读组合快照（cash / equity / openPositionCount / openPositionSymbols，全字段 readonly）。
- `StrategyContext<C, D>`：受控输入（signalTime + data + 只读组合快照 + 已规范化 config）。
- `StrategyMetadata`：自描述（id / name / version / description / category / requiredData / supportsLong / supportsShort / supportsIntraday）。
- `Strategy<C, D>`：元数据 + 默认配置 + `normalizeConfig` + `evaluate`（纯函数，无副作用）。
- `AnyStrategy = Strategy<StrategyConfig, unknown>`：Registry 边界的统一上界（使用 `unknown`，非业务 `any`）。

策略职责边界：只「判断当前是否应采取某种行为」，不执行订单、不改现金/持仓、不算成交价/费用/滑点/收益/Sharpe/回撤、不访问 DB/网络、不改全局状态、不操作 UI。

## 2. Strategy Context

- `signalTime`：当前信号时点，策略只能读取 <= 该时点的信息。
- `data: D`：受控数据视图，由上层 Data Provider 准备，策略不得自行查询。
- `portfolio: ReadonlyPortfolioContext`：只读组合快照。
- `config: C`：经 `normalizeConfig` 规范化后的强类型配置。

不做 `initialize`/`finalize`——本项目策略为纯函数式，无需生命周期钩子（按规范「不为了形式强行加入」）。

## 3. Strategy Signal

统一 `StrategySignal` 模型，action 支持 BUY/SELL/HOLD，可选 score/confidence/reason/metadata。
Signal ≠ Order ≠ Fill：策略只表达意图，成交数量/价格/费用/滑点由 Backtest Core 决定。

## 4. Strategy Config

- `LeaderCandidateBaselineConfig`：`minScore: number | null`（最低评分阈值）+ `maxSignals: number`（策略输出上限）。
- 强类型、有默认值（`minScore: null, maxSignals: 5`）、可序列化、可复现。
- `normalizeConfig` 缺失回填、非法回退，纯函数。

## 5. Strategy Metadata

`leader-candidate-baseline` 的元数据完整描述：id / name / version "1.0.0" / description / category "打板龙头候选" /
requiredData ["leaderCandidateDataView"] / supportsLong true / supportsShort false / supportsIntraday false。

## 6. Strategy Registry

新增 `server/strategy/registry.ts`：

- `register(strategy)`：id 唯一，重复注册抛错。
- `get(id)`：未知 id 抛错。
- `has(id)` / `list()`（按 id 排序、返回元数据副本）。
- `evaluate(id, signalTime, data, portfolio, rawConfig?)`：规范化配置后评估。
- 不依赖 DB/网络/UI/execution/portfolio 可变 API，可独立测试，无循环依赖（仅依赖 contract.ts）。

## 7. Strategy State

迁移策略为无状态纯函数（无 module-level mutable state / singleton state / static cache），
因此无需 Strategy State；状态可派生时优先使用 Context（符合规范「优先使用 Context」）。

## 8. 已迁移策略

迁移第一个真实策略：**龙头候选原始评分（baseline）** → `server/strategy/strategies/leaderCandidateBaseline.ts`。

- 业务规则：对信号日可见的已评分候选池，按原始综合评分降序排序，可选 `minScore` 阈值过滤，输出前 `maxSignals` 个 BUY 意图。
- 评分本身仍由既有 Data Provider（`leaderCandidates.buildLeaderCandidatesForDate`）完成，策略不重复评分。
- 排序键：评分降序 → 连板降序 → 题材家数降序 → 封板时间升序 → 股票代码升序（前四项与 legacy 一致，末项为确定性兜底，见 §9 行为改变记录）。

## 9. Legacy Adapter

新增 `server/strategy/adapter.ts`：

- `buildLeaderCandidateDataView(result)`：把 legacy `LeaderCandidateResult` 映射为策略数据视图（只读透传评分）。
- `buildLeaderCandidateDataViewForDate(records, signalDate, options)`：便捷入口，严格 point-in-time（复用 `buildLeaderCandidatesForDate`）。
- `toCoreSignals(decision, { requestedQuantity })`：`StrategyDecision` → Backtest Core `Signal`（意图 → 订单意图；HOLD 不产 Core Signal）。

**行为改变记录**（§19 要求）：

| 项 | 旧行为 | 新行为 | 原因 |
|---|---|---|---|
| 平局排序 | legacy 仅 4 个排序键，完全同分依赖数组顺序（Array.sort 稳定，但受输入顺序影响） | 追加 stockCode 作为最终稳定平局键 | 确定性改进：消除对输入顺序的隐式依赖，避免「平局下结果不可复现」 |

其余行为与 legacy baseline（`strategyScore = candidate.score` + 降序排序）完全一致，测试已对照验证（见 §13）。

## 10. Future Leakage 防护

- 策略仅通过 `context` 读数据，不访问全量未来行情数组/DB 未来日期/全局缓存/singleton/隐式时间变量。
- 数据视图由 `buildLeaderCandidatesForDate` 构建，其内部 `records.filter(r => r.limitUpDate <= targetDate)` 保证 point-in-time。
- 未来数据污染测试（T1-T3 vs T1-T6）已通过：T3 时点信号完全一致。
- 契约层源码经静态依赖边界测试：不含 execution/portfolio 可变 API/DB/网络/随机/日期引用。

## 11. Strategy / Backtest 解耦

- 策略不 import execution/portfolio 可变 API；Backtest Core 通过 `signalProvider` 消费策略决策（经 Registry + adapter 桥接）。
- 集成测试验证：策略经 Registry → decision → toCoreSignals → runBacktest 产生成交。

## 12. Strategy / Portfolio 解耦

- 策略只读 `ReadonlyPortfolioContext`（全字段 readonly），不能调用 `portfolio.buy/sell`。
- 组合约束（maxPositions/容量/资金/lotSize）仍在 Portfolio 层裁决（Step 2 已实现）。

---

## 13. 新增测试（25 个，全部通过）

| 文件 | 数量 | 覆盖 |
|---|---|---|
| `contract.test.ts` | 10 | 契约形态、BUY/SELL/HOLD、数据不足、配置规范化、确定性、只读组合、架构依赖边界 |
| `registry.test.ts` | 6 | 注册/查询/列表、重复 id 报错、未知 id 报错、evaluate 规范化、list 副本隔离、emptyDecision |
| `leaderCandidateBaseline.test.ts` | 9 | BUY 信号、数据不足、确定性、实例隔离(A/B/A)、未来数据污染、Legacy 对照、minScore、maxSignals、Registry+Core 集成 |

对应规范 §21 的 16 类测试全部落实：
1. Contract ✓ 2. Registry ✓ 3. duplicate id ✓ 4. unknown id ✓ 5. Config ✓ 6. BUY ✓ 7. SELL ✓ 8. HOLD ✓
9. insufficient data ✓ 10. deterministic ✓ 11. instance isolation ✓ 12. future contamination ✓
13. Portfolio read-only ✓ 14. 不直接执行交易（架构边界）✓ 15. Registry+Core 集成 ✓ 16. Legacy 对照 ✓

---

## 新增/修改/删除文件

**新增文件**：
- `server/strategy/contract.ts`
- `server/strategy/registry.ts`
- `server/strategy/adapter.ts`
- `server/strategy/index.ts`
- `server/strategy/strategies/index.ts`
- `server/strategy/strategies/leaderCandidateBaseline.ts`
- `server/strategy/contract.test.ts`
- `server/strategy/registry.test.ts`
- `server/strategy/leaderCandidateBaseline.test.ts`

**修改文件**：无（Legacy 与 Step 1/Step 2 代码零改动，纯新增）。

**删除文件**：无。

## 新增核心类型

`StrategyConfig` / `StrategyAction` / `StrategySignal` / `StrategyDecision` / `ReadonlyPortfolioContext` /
`StrategyContext` / `StrategyMetadata` / `Strategy` / `AnyStrategy` / `StrategyRegistry` /
`LeaderCandidateBaselineConfig` / `LeaderCandidateScore` / `LeaderCandidateDataView` / `ToCoreSignalsOptions`。

## Legacy 代码

未删除，未改动。Legacy 评分/策略/回测（`leaderCandidates.ts` / `downsideRisk.ts` / `realisticBacktest.ts`）保持不变，
仅通过 `adapter.ts` 只读复用其 Data Provider 产出。

## 架构债务（遗留，非本 Step 阻塞）

- 五策略中其余四套（riskPenalty / hardFilter / qualityBlend / qualityGate）尚未迁移到 Contract（依赖 downsideRisk 的风险分与质量复合评分），留后续 Step。
- Legacy `realisticBacktest.ts` 仍将策略门控（三档预期）+ 执行 + 组合 + 退出逻辑耦合在一起（Step 2 已记录）。
- `buildLeaderCandidatesForDate` 的 `stockNameByCode` 默认使用全量 records 的 `buildLatestStockNameMap`，名称标签存在极轻微的「最新名称」语义（仅影响展示标签，不影响评分/信号），与策略评分本身 point-in-time 无关。

---

## 工程验证

- npm test：**393 通过 + 15 失败**（15 个失败全部为既有环境类：缺 DATABASE_URL / TUSHARE_TOKEN / 网络超时 / StockPriceSync，与 Step 1/Step 2 验收清单完全一致，**本次修改未引入任何新失败**）。
- npm run typecheck：✅ exit 0。
- npm run build：✅（dist/index.js 408.2kb）。

## 最终结论

Step 3 开发完成：Strategy Contract + Registry + 首个真实策略（baseline）迁移 + 16 类测试全部落地并通过。
是否 PASS，留待下一阶段独立审计。
