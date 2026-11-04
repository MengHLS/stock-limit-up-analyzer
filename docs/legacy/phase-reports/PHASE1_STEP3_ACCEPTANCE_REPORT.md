# Step 3 独立验收报告

> 审计身份：独立量化系统架构审计员 + TypeScript 代码审计员
> 审计对象：`server/strategy/` 层（Strategy Contract + Registry + 首个真实策略迁移）
> 审计方法：逐文件读源码 + 独立 57 项断言脚本（不依赖已提交测试）+ 独立探测脚本 + 全量 test/typecheck/build
> 审计日期：2026-09-05

## 总体结论

# PASS

Strategy 已真正成为「可插拔、可测试、可复现、无副作用、无未来函数、与 Backtest Core 解耦」的策略组件。18 项 PASS 条件全部满足。

发现 2 项 **P3（架构债务，非阻塞）**：① adapter 未传 `candidateLimit: null`，继承默认 20 只截断（语义降级，默认配置下不影响结果）；② 股票名用全量 records 最新名称（仅影响标签，不影响评分/排序/信号）。

---

## 1. Contract
**PASS**

`contract.ts` 定义了完整统一契约：`StrategyConfig`（可序列化基类）→ `StrategyAction`(BUY|SELL|HOLD) → `StrategySignal`（意图，含 score/confidence/reason/metadata）→ `StrategyDecision`（signals + strategyVersion + insufficientData）→ `ReadonlyPortfolioContext`（全字段 readonly）→ `StrategyContext<C,D>` → `StrategyMetadata` → `Strategy<C,D>`（metadata + defaultConfig + normalizeConfig + evaluate）。

仅一个真实策略（baseline），不存在「多策略不同接口」。策略定义统一为纯函数 `evaluate(context) => decision`。

## 2. Registry
**PASS**

`registry.ts`：register（重复 id 抛错）/ get（未知 id 抛错）/ has / list（按 id 字典序排序 + 元数据副本）/ evaluate（规范化配置后评估）。独立脚本实测 4/4：正常注册、重复抛错、未知抛错、list 无重复且排序。不依赖 DB/网络，仅依赖 contract.ts，无循环依赖。

## 3. Strategy / Backtest 解耦
**PASS**

策略本体 `strategies/leaderCandidateBaseline.ts` 仅 import `../contract`，不含任何 engine/execution/portfolio 引用。策略只产生 `StrategyDecision`（意图），不执行 buy/sell/fill/execute。成交由 `toCoreSignals`（adapter 边界层）桥接为 Core Signal，最终由 `runBacktest` 的 Portfolio/Execution 决定价格与数量。

## 4. Strategy / Portfolio 解耦
**PASS**

策略通过 `ReadonlyPortfolioContext`（cash/equity/openPositionCount/openPositionSymbols 全部 readonly）读取组合快照，无 `portfolio.buy()/sell()`，无 cash/position/equity 修改。baseline 策略 evaluate 甚至完全未读取 portfolio 字段（业务上不需要），仅保留在 Context 契约中供其他策略使用。

## 5. DB / Network 解耦
**PASS**

grep 全策略层（contract.ts/registry.ts/strategies/*.ts/adapter.ts）源码：无 fetch/axios/mysql2/drizzle/tushare/node:http/node:https/process.env。唯一命中是 `contract.test.ts` 中作为「禁止清单」字符串出现的预期本身。策略层零 DB/网络依赖。

## 6. Future Leakage
**PASS**

- 策略本体只读 `data.candidates`，而 data 由 `buildLeaderCandidateDataViewForDate(records, signalDate)` 构建，内部 `buildLeaderCandidatesForDate` 用 `records.filter((record) => record.limitUpDate <= targetDate)` **严格 point-in-time 过滤**（`leaderCandidates.ts:450`）。
- 独立脚本污染测试：`recordsThroughT3` 与 `recordsThroughT6` 在 T3 的信号 `JSON.stringify` **完全一致**（含 score/reason/metadata），T4-T6 记录不改变 T3 决策。
- 无 shift(-1)/lead/next/lookahead/全量未来数组预计算。
- 唯一例外：`buildLatestStockNameMap(records)` 用全量 records 构建股票名映射（见 §16 P3-2），但仅影响 stockName 标签，不进入 score/排序/信号动作。

## 7. Determinism
**PASS**

独立脚本实测：相同 data+config 两次 evaluate `JSON.stringify` 深度相等。源码无 Date.now()/new Date()/Math.random()。排序比较器 `rankDescending` 追加 stockCode 作为最终平局键，使 `Array.sort` 完全确定（消除 Array.prototype.sort 的稳定性依赖）。

## 8. Instance Isolation
**PASS**

策略是纯函数对象，无 module-level mutable state / singleton strategy state / 静态缓存。独立脚本 A/B/A 实测：A1 === A2，且 B 与 A 不同（互不串扰）。`strategyRegistry` 虽为单例，但仅存策略定义（不可变），不存任何策略运行状态。

## 9. Config
**PASS**

`LeaderCandidateBaselineConfig`：`minScore: number | null`、`maxSignals: number`，强类型、可序列化、有默认值（null / 5）、无 magic number（阈值/上限作为 config 显式化）。`normalizeConfig` 纯函数：缺省回填、非法值回退默认、合法值保留。独立脚本实测 4/4。

## 10. Metadata
**PASS**

`StrategyMetadata`：id / name / version / description / category / requiredData / supportsLong / supportsShort / supportsIntraday，可唯一标识。baseline 为 `leader-candidate-baseline` v1.0.0。version 区分实现版本（不同版本可通过 registry 注册不同 id 或改 version）。

## 11. Signal Model
**PASS**

`StrategySignal`（symbol/signalTime/action/score/confidence/reason/metadata）≠ `Order`（symbol/side/quantity/executionTime/orderType/signal）≠ `Fill`（symbol/side/quantity/price/basePrice/fees/slippageAmount）。Signal **不含** actualFillPrice/commission/slippage 等执行结果字段，无职责污染。`toCoreSignals` 仅声明方向与名义数量（缺省 100），成交价/费用/滑点由 Core 决定。

## 12. Legacy 对照
**PASS**

迁移策略「龙头候选原始评分 baseline」的排序键前四项（score↓ → boards↓ → sectorCount↓ → limitUpTime↑）与 legacy `buildLeaderCandidatesForDate` 的候选排序**完全一致**，仅追加 stockCode 作为确定性兜底平局键（唯一行为改变，已在策略文件头与开发报告 §9 记录）。评分本身仍由 legacy `buildLeaderCandidatesForDate`（Data Provider 角色）完成，策略不重复评分。测试 `leaderCandidateBaseline.test.ts` 含「Legacy 行为对照」用例，独立脚本验证排序顺序一致。

## 13. Tests
通过：**393**
失败：**15**（全部为既有环境类，与 Step 1 / Step 2 历史清单**完全一致，本次无新增**）

失败清单（15 个，均缺外部依赖/网络超时/前端组件渲染）：
- `limitUp.test.ts`（1）、`limitUp.watch.test.ts`（4）、`marketData.test.ts`（4）→ 缺 DATABASE_URL
- `tushare.secret.test.ts`（1）、`tushareTradingCalendar.test.ts`（3）→ 缺 TUSHARE_TOKEN / 网络超时
- `stockPriceSyncPage.test.ts`（2）→ 缺 StockPriceSync.tsx

策略层测试独立运行 **25/25 全绿**（contract 10 + registry 6 + leaderCandidateBaseline 9）。

## 14. Typecheck
**PASS**（`npx tsc --noEmit` exit 0）

## 15. Build
**PASS**（`dist/index.js` 408.2kb，17.73s）

## 16. 严重问题

### P0
无。

### P1
无。

### P2
无。

### P3
- **P3-1（语义降级）**：`adapter.ts:41-46` `buildLeaderCandidateDataViewForDate` 未传 `candidateLimit: null`，导致继承 `buildLeaderCandidatesForDate` 默认 `candidateLimit ?? 20`，策略在准入候选 > 20 只的交易日只能看到前 20 只。独立探测实测：25 只准入候选 → adapter 视图仅 20 只，而 legacy 回测路径（`buildLeaderCandidateBacktest`）传 `candidateLimit: null` 可见全部 25 只。**影响范围**：默认 `maxSignals=5` 远小于 20，且前 20 只已是最高分，因此默认配置下信号结果**不受影响**；仅当策略配置 `maxSignals > 20` 时才会丢失第 21 名之后的候选。
- **P3-2（标签级未来数据）**：`leaderCandidates.ts:451` `buildLatestStockNameMap(records)` 用全量 records（含未来日期）构建股票名映射，用于 `stockName` 标签。仅影响展示名称，不进入 score/排序/信号动作，不影响回测可信度。

## 17. 必须修复的问题

无（P3 均为非阻塞项，见 §18）。

## 18. 可以延期的问题

1. **P3-1**：`adapter.ts` 的 `buildLeaderCandidateDataViewForDate` 补传 `candidateLimit: null`（与 legacy 回测口径对齐）。修复方式：在 adapter 调用 `buildLeaderCandidatesForDate` 时显式传 `{ ...options, candidateLimit: null }`；验证方式：25 只准入候选 → adapter 视图应返回 25 只。
2. **P3-2**：`buildLatestStockNameMap` 未来数据标签，仅影响展示，建议在后续 Step 中改为 point-in-time 名称快照。
3. 五策略其余 4 套（riskPenalty / hardFilter / qualityBlend / qualityGate）尚未迁移到 Contract（依赖 downsideRisk 风险分与质量复合评分，属后续 Step）。
4. realisticBacktest 的策略门控+执行+组合+退出仍耦合在 Legacy 中，未迁移。

---

## 附：独立审计脚本证据（57/57 通过）

| 验证组 | 断言数 | 结果 |
|---|---|---|
| Registry 行为（register/get/has/list/重复/未知） | 4 | ✅ |
| 未来数据污染（T1-T3 vs T1-T6） | 2 | ✅ |
| 确定性（两次深度相等） | 1 | ✅ |
| 实例隔离（A/B/A） | 2 | ✅ |
| Config 复现（默认/幂等/非法回退/保留） | 4 | ✅ |
| 真实策略经 Registry → Backtest Core 产生 trades | 7 | ✅ |
| 架构边界静态检查（策略/contract/registry 零 engine/db/network/随机） | 37 | ✅ |

补充探测（独立）：发现 P3-1（adapter candidateLimit 截断），默认配置无影响。
