# RESULT-STRATEGY-IMPLEMENTATION-REENTRY-001

> **任务：`STRATEGY-IMPLEMENTATION-REENTRY-001`（Phase A）**
> 状态：`IMPLEMENTATION_READY`
> 生成日期：2026-10-05（Asia/Shanghai）
> 目标：把 `strong-trend-reentry-v1.0.0` 从 Strategy Definition Draft 接入现有 Strategy Core 执行链。

---

## 0. 范围与边界

本报告覆盖 Phase A（Runtime Event Resolver → Contract Validation）。Phase B（Baseline Backtest）
输出到 `RESULT-BACKTEST-REENTRY-BASELINE-001.md`。

本轮**没有**执行：Parameter Search、OOS、WFA、Robustness、Exit Optimization、止损/止盈优化。
本轮**没有**创建 Candidate、没有创建第二套事件执行器、没有绕过 Strategy Core。

## 1. Resolver

### 1.1 实现位置（复用现有事件解析框架）

| 项 | 值 |
|---|---|
| 事件码 | `eventCode = STRONG_TREND_REENTRY_V1` |
| 事件类型 | `CUSTOM_EVENT` |
| 解析器 | `server/strategyCore/production/strongTrendReentryEventSource.ts` |
| 契约 | `EventOccurrenceResolver`（`server/strategyCore/runtime.ts`），**不是**新执行器 |
| 装配选择 | `server/runWorkbenchAssembly/assemble.ts#assembleStrategySide`（`CUSTOM_EVENT`+eventCode 命中才启用，否则回落 `createDatasetEventResolver`） |
| eventCode 读取 | `server/strategyCore/production/versionFromDocument.ts#coreVersionFromDocument` 新增只读字段 `eventCode` |
| 导出 | `server/strategyCore/production/index.ts` 重新导出解析器与其常量 |

导出符号：`judgeStrongTrendReentryEvent`、`createStrongTrendReentryEventResolver`、
`STRONG_TREND_REENTRY_EVENT_CODE`、`STRONG_TREND_REENTRY_EVENT_TYPE`、`STRONG_TREND_REENTRY_MULTIPLE`。

### 1.2 语义（与 Strategy Definition 逐条对齐）

```text
rd0  = 首板事件 bar（prefix.relativeDay = 0）
event_close = rd0.close
S    = 第一个 rd > 0 且 high >= 2 × event_close 的 bar
S_close = S.close
Pullback = 第一个 rd > S.rd 且 low < S_close 的 bar
RECLAIM  = 第一个 rd > Pullback.rd 且 close >= S_close 的 bar
事件成立  ⇔ reclaim.relativeDay === context.currentRelativeDay
```

- `S` 只用到 `rd0.close`（首板日已知）与当期 bar 的 `high`，不使用 S 之后的数据。
- Pullback 判据要求 `rd > S.rd` ⇒ **S 当天自身 low 不参与 Pullback**。
- RECLAIM 判据要求 `rd > Pullback.rd` ⇒ 只有 Pullback 之后的首次站回才成立。
- 事件**只在 RECLAIM 当天返回 true** ⇒ 同一次强势回调只会产生一个入场信号，不会在 RECLAIM 之后每天重复发信号。
- 收到未知 `eventType` / 未知 `eventCode` 时**响亮抛错**（`CORE_DEFINITION_INVALID`），不静默返回 false。
- 缺少 `rd=0` bar、或 `rd0.close` 非有限正数 ⇒ 分别抛错 / 返回 `UNDECIDABLE`（后者计入 `undecidableCount`）。

### 1.3 配方（signalEngine）

`server/research/recipeRegistry.ts` 新增 `strong-trend-reentry-select-all`：`point=close`、
`signalFrequency=daily`、`signalKind=weighted`、`defaultWeights={isBullish:0}`、
`selectionConfig={method:{kind:topPercentile,pct:1}}` ⇒ **事件命中即全选，无 TopN、无排序过滤**。

## 2. PIT 验证

| 保证 | 实现 | 测试 |
|---|---|---|
| 每一步只用当时及之前数据 | 解析器按 `relativeDay` 升序扫描，`S` / `Pullback` / `RECLAIM` 严格 rd 递增 | ✅ |
| 拒绝未来扫描 | `visibleData.bars` 出现 `relativeDay > currentRelativeDay` ⇒ 抛 `CORE_DEFINITION_INVALID` | ✅ |
| 不使用 T+20 | 解析器签名内无 outcome/exit 输入 | ✅ |
| 不使用 SUCCESS / FAILURE | 同上；标签仅在研究层存在 | ✅ |
| 不使用未来创新高 | 解析器不读 `high` 之外的未来量 | ✅ |
| 不使用未来 Exit 结果 | 同上 | ✅ |

## 3. Execution Contract

`strategy-document.definition.execution`：

```text
signalTiming    = T_CLOSE
executionTiming = T_PLUS_1_OPEN
priceType       = OPEN
quantityMethod  = TARGET_WEIGHT
lotSize         = 100
```

⇒ **RECLAIM 当日收盘确认信号，下一交易日 Open 成交**；不是 RECLAIM close、不是盘中价。

⚠️ 如实标注：`SIGNAL_FILLED` 只是基于 OHLC 的回测执行假设，**不等于**现实世界 100% 可成交。

## 4. Position Semantics

`sizingMethod=EQUAL_WEIGHT`，`maxPositions=10000`，`maxExposure=1`，`maxSinglePosition=1`。

- `mapPositionSizing`（`server/backtest/context.ts`）对 `EQUAL_WEIGHT` 返回 `effective=EQUAL_WEIGHT_CASH_BUDGET`；
  实际成交预算 = 等权现金预算 ÷ 整手，**与 `maxPositions` 无关**。
- `maxPositions` 仅被 `Portfolio` 当作**并发持仓数上限**（`openPositionCount >= maxPositions` 时拒绝新建仓）。
- 真实数据下同时持仓只有数百个，`10000` 是 Schema 哨兵值，**不会触发**，不改变等权计算、不改变单仓资金分配、不产生异常仓位。

**结论：NO Position Semantics Conflict**（未触发 NEEDS_HUMAN）。

## 5. Duplicate Signal

复用既有 Portfolio lifecycle（`server/backtest/portfolio.ts`）：

```text
同一证券已有未平仓头寸 → 新 Entry 被拒（reason = 同一股票已有持仓，暂不支持加仓）
头寸退出后           → 允许下一次新的有效 Entry
不同证券             → 允许并行持有
```

未新建任何 duplicate-position 逻辑。

## 6. Execution Feasibility

复用平台现有执行框架（`server/backtest/execution.ts` / `engine.ts` / `context.ts`），不新造成交判定。

| 情形 | 平台状态 |
|---|---|
| 下一交易日不存在 | 计划层 `NO_NEXT_TRADING_DAY`（skip，不静默） |
| 停牌 / 执行日无行 | `SUSPENDED` 拒单 |
| 缺 Open / 无有效价格 | `NO_LIQUIDITY` 拒单 |
| Open >= limitUpPrice | `LIMIT_UP` 拒单（`blockLimitUpBuys` 默认 true） |
| 成交量为 0 | `NO_LIQUIDITY` 拒单（`zeroVolumePolicy` 默认 REJECT） |
| 现金不足 | `INSUFFICIENT_CASH`（允许部分成交按整手缩量） |

平台默认执行政策（`DEFAULT_BACKTEST_EXECUTION_POLICY`）：`tPlus1=true`、`blockLimitUpBuys=true`、
`blockLimitDownSells=true`、`suspensionPolicy=REJECT`、`allowPartialFill=true`、`zeroVolumePolicy=REJECT`，
与策略声明的 `OPEN_AT_LIMIT_UP_UNFILLED` / `SUSPENDED_NEXT_OPEN_UNFILLED` 语义一致。

研究侧（`RESULT-PRE-STRATEGY-REENTRY-001`）的成交分层结论：SIGNAL 547 → SIGNAL_EXECUTABLE 545 →
SIGNAL_FILLED 513；不可成交 34（`ONE_WORD_LIMIT_UP` 13、`OPEN_AT_LIMIT_UP` 32、`MISSING_ROW` 2，原因可重叠）。

## 7. Definition Execution-Horizon Correction（必须显式记录）

Draft 原声明 `definition.entry.observationWindow = { start: 1, end: 80, unit: TRADING_DAY }`。

直读桥语义（`server/runWorkbenchAssembly/datasetFromRegistry.ts`）：

```text
投影 bar 相对日        = rd=0 ∪ rd ∈ [1, end+1]
决策日资格            = rd ∈ [start, end]
neededMaxRelativeDay  = end + 1   （决策日的下一交易日 = 执行日）
```

实测 `datasetVersionId=780001` 的 post 深度为 `rd ∈ [1, 80]`（5,733,817 行 / 73,003 事件，
2019-01-02 ~ 2026-09-04）。`end=80` ⇒ `neededMaxRelativeDay=81 > 80` ⇒ 直读桥**整段拒绝**
（`REGISTRY_POST_WINDOW_TOO_SHORT`，不静默夹取）。

把 `end` 修正为 **79** 后 `neededMaxRelativeDay=80`，窗口完全落在该数据集可提供的行情范围内。

修正的影响（用研究侧逐事件结果核对）：

| 量 | 值 |
|---|---:|
| 研究 SIGNAL 总数 | 547 |
| 其中 `reclaim_rd = 80` | **2**（`002838.SZ`、`600520.SH`） |
| 该 2 条是否可执行 | **否**（`reclaim1_missingOpen=true`，即 SIGNAL_NON_EXECUTABLE） |
| `reclaim_rd ≤ 79` 且可执行 | 545（= 全部 SIGNAL_EXECUTABLE） |

⇒ `end: 80 → 79` **只剔除这 2 条本来就无法成交的信号**，保留全部 545 条可执行信号；
不是放宽/收紧信号定义，而是把声明窗口修正为**可执行上界**。

同时把桥的粗筛常量 `DATASET_POST_MAX_RELATIVE_DAY` 从 20 提到 80（真实上界仍由各版本的
`getPostRelativeDayRange()` 实测判定，见 `REGISTRY_POST_WINDOW_TOO_SHORT`）。

修正后指纹：

```text
strategy document fingerprint     = fa114c214502c57e16d85f1ab8c8895ef4e5a2708892b7af5fc564cab5a41bf8
strategy version record fingerprint = c21732f636d348a14dd03ce08438b8b5d90021afb87baa3fb78c6f406d389b84
```

（Draft 尚未落库到 `strategy_versions`；`persistedToDatabase=false`。上一版报告中的旧指纹已作废。）

## 8. Tests

### 8.1 新增测试：`tests/server/strategyCore/production/strongTrendReentryEventSource.test.ts`

| # | 任务要求 | 用例 |
|---|---|---|
| 1 | 首板后首次达到 +100% | S = 首个 `high >= 2×event_close` |
| 2 | S 后第一次 Pullback | Pullback 严格晚于 S，S 当天 low 不算 |
| 3 | Pullback 后第一次 RECLAIM | 只认首次站回，后续日期不重复 |
| 4 | RECLAIM 当天不得入场 | `signalTiming=T_CLOSE` + `executionTiming=T_PLUS_1_OPEN` |
| 5 | 下一交易日 Open 入场 | `priceType=OPEN`，非 RECLAIM close |
| 6 | 无未来数据 | future bar ⇒ 抛「未来数据」 |
| 7 | 重复信号 | Portfolio 拒绝「同一股票已有持仓」；不同证券可并行 |
| 8 | 涨停 / 停牌 / 缺 Open | 复用平台执行框架（见 8.2） |
| 9 | Position sizing | `EQUAL_WEIGHT → EQUAL_WEIGHT_CASH_BUDGET` |
| 10 | maxPositions 哨兵语义 | `10000` 不改等权计算 |

### 8.2 复用的既有执行框架测试（未改松）

`tests/server/research/executionConstraints/executionConstraints.test.ts`：

- 开盘涨停禁买 → 买入订单 `LIMIT_UP` 拒绝；关闭拦截则正常成交
- 开盘跌停禁卖 → 卖出订单 `LIMIT_DOWN` 拒绝
- 执行日 `volume=0` ⇒ `NO_LIQUIDITY` 拒单（三种执行模型都拦得住）
- 并发持仓数上限 ⇒ `MAX_POSITIONS_REACHED`

停牌（执行日无行 ⇒ `SUSPENDED`）由 `server/research/simulator/engine.ts` 承接。

### 8.3 运行结果

```text
pnpm run check                                              → 0 error
vitest (11 files)                                           → 263 tests passed
  strongTrendReentryEventSource.test.ts                     →   9 passed   (新增)
  barWindowAndEvent / versionFromDocument / runtimeAndAdapter →  39 passed
  portfolio / strategyPortfolio                             →  27 passed
  windowProjection                                          →  18 passed
  strategySchema / strategyDefinition                       → 120 passed
  strategyPersistence                                       →  20 passed
  executionConstraints（既有执行框架，见 8.2）                →  30 passed
node scripts/checkEolDrift.mjs --strict                     → 0 drift
```

## 9. Status

```text
Resolver                 → IMPLEMENTED (CUSTOM_EVENT / STRONG_TREND_REENTRY_V1)
PIT                      → VERIFIED
Execution Contract       → VERIFIED (T_CLOSE → T+1 OPEN, priceType=OPEN)
Position Semantics       → NO CONFLICT (10000 = 并发上限哨兵，不改等权)
Duplicate Signal         → REUSES Portfolio lifecycle
Execution Feasibility    → REUSES platform policy (LIMIT_UP / SUSPENDED / NO_LIQUIDITY)
Tests                    → 263 passed / check 0 error / EOL 0 drift
```

**Phase A 状态：`IMPLEMENTATION_READY`**

Phase B（Baseline Backtest）见 `RESULT-BACKTEST-REENTRY-BASELINE-001.md`。

---

## 附录 C — Phase B 后续（本轮「方案 2」）

Phase B 仍 `BLOCKED`，但按裁定已执行「改走流式 / 按需读取的数据面」：

| 项 | 结果 |
|---|---|
| 新增 | 事件窗**流式**游标 `createEventWindowDatasetCursor` |
| 装配路由 | `assemble.ts#resolveDataset`：仅在物化行数上界超护栏时启用 |
| 语义 | 与 `buildWindowRows` 逐字段一致（同一行投影 / 面板身份 / rd 集合 / 前收口径） |
| 效果 | 装配 >30 min（未成功）→ **10.4 s**；内存 ~8.5 GB → **~2.9 GB** |
| 新增测试 | `tests/server/runWorkbenchAssembly/eventWindowDatasetCursor.test.ts`（7 例） |

阻塞点已从「数据集行预算」变为「候选 run 记录超 V8 字符串上限」——
详见 `RESULT-BACKTEST-REENTRY-BASELINE-001.md` §5.3。
