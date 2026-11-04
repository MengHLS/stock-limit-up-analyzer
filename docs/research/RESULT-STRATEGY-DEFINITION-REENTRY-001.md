# RESULT-STRATEGY-DEFINITION-REENTRY-001

> **状态：STRATEGY_DEFINITION_READY**
> 本任务只创建 Strategy Definition / Strategy Version Draft，不执行正式 Backtest、Parameter Search、OOS 或 WFA。

## Strategy Summary

| 字段 | 值 |
|---|---|
| strategyId | `strong-trend-reentry-v1` |
| version | `1.0.0` |
| name | Strong Trend Re-entry v1 |
| strategyType | MANUAL |
| status | Draft |
| Entry | FIXED |
| Exit | FIXED |
| Execution | FIXED |
| Position | FIXED |
| Risk | BASELINE |
| Research-derived | YES |
| Dataset | `datasetVersionId=780001` / `v8` |

策略思想：

```text
首板事件
→ S = 后续首次 high >= 2 × event_close
→ S 后出现 low < S_close
→ RECLAIM = 首次 close >= S_close
→ RECLAIM+1 Open 入场
→ 持有 20 个交易日，第 20 日收盘退出
```

## Universe

- 沪深主板。
- 非 ST。
- 已有首板事件。
- 不加入行业、题材、市值、换手率、成交额、涨停次数或其他技术指标过滤。
- 文档 universeId：`mainboard-nonst-first-limit`。
- Dataset 绑定：`first_limit_pullback` / `v8` / `datasetVersionId=780001` / `role=PRIMARY`。

## Event Definition

S 的定义：

```text
首板事件之后，
第一个满足 high >= 2 × event_close 的交易日。
```

- S 使用当日已经发生的盘中 high 判定。
- S 在当日收盘后确认。
- 不使用 S 之后信息确认 S。
- 不使用 S 当日盘中最高价作为成交价。
- 在 canonical definition 中通过 `CUSTOM_EVENT` + `eventCode=STRONG_TREND_REENTRY_V1` 声明。
- 运行期必须由 Strategy Core 注入 `context.resolveEvent` 实现该事件语义；本任务只定义，不实现执行器，不启动 Backtest。

## Reclaim Definition

Pullback：

```text
S 之后出现 low < S_close。
```

RECLAIM：

```text
回撤后首次 close >= S_close。
```

- RECLAIM 在当日收盘后确认。
- RECLAIM 之前的信息只允许来自 event_close、S 当日及之前、以及 S 之后至 RECLAIM 当日的数据。
- canonical definition 中由 custom event 参数 `pullbackRule` / `reclaimRule` 明确声明。

## Entry

正式 Entry：

```text
RECLAIM+1 Open
```

- 信号时点：`T_CLOSE`。
- 成交时点：`T_PLUS_1_OPEN`。
- 不使用 RECLAIM 当日收盘成交。
- 不使用 RECLAIM 当日盘中价格成交。
- 不使用未来价格或未来是否继续上涨信息。

## Execution

- `signalTiming = T_CLOSE`
- `executionTiming = T_PLUS_1_OPEN`
- `priceType = OPEN`
- `quantityMethod = TARGET_WEIGHT`
- `lotSize = 100`
- 执行约束：
  - 同一证券已有未平仓头寸时忽略新信号。
  - 已有头寸退出后允许下一次有效信号。
  - 不同证券允许同时持有。
  - V1 不设置 TopN。
  - 不设置行业或市值过滤。
  - Open 等于涨停价视为不可成交。
  - 下一交易日停牌或缺 Open 视为不可成交。

注意：`Open < limitUpPrice` 只是回测执行假设，不代表现实世界具有 100% 成交保证。

## Exit

V1 只定义一个固定退出：

```text
持有 20 个交易日
第 20 个交易日收盘退出
```

canonical definition：

- `type = TIME_EXIT`
- `trigger = ON_CLOSE`
- `threshold = 20`
- `thresholdUnit = TRADING_DAY`
- `enabled = true`

本版本不加入 Stop Loss、Take Profit、Trailing Stop、MA5/MA10、Strong Hold、Trend Exit。

## Position

- `sizingMethod = EQUAL_WEIGHT`
- 每个有效信号独立建立等权策略头寸。
- 不同股票可同时持有。
- Schema 要求 `maxPositions` 字段；为避免人为 TopN 限制，Draft 使用哨兵值 `10000`，不表示 10,000 只股票的容量假设。
- `maxExposure = 1`
- `maxSinglePosition = 1`
- 不创建 Position 参数，不创建可调仓位参数。

## Duplicate Signal Policy

- 同一股票已经有未平仓头寸时，忽略新的入场信号。
- 已有头寸退出后，允许下一次新的有效信号。
- 不作为新的执行器实现；依赖现有 Strategy Core / portfolio 的标准持仓去重与生命周期语义。
- Draft 中以 execution constraints 显式记录：

```text
DUPLICATE_SIGNAL_IGNORED_WHILE_SAME_SECURITY_POSITION_OPEN
ALLOW_REENTRY_AFTER_POSITION_EXIT
```

## Overlap Policy

- 不同股票同时产生信号时允许同时持有。
- V1 不设置 TopN、行业集中度、市值约束或人为全局组合上限。
- 组合数据窗口与重复事件研究口径不直接作为交易组合语义；正式 Backtest 仍需按 Strategy Core 的 position lifecycle 执行。
- Draft 中以 execution constraints 显式记录：

```text
ALLOW_MULTIPLE_DISTINCT_SECURITIES
NO_TOPN_IN_V1
NO_INDUSTRY_OR_MARKET_CAP_FILTER
```

## Cost Model

沿用平台默认成本模型：

| 字段 | 值 |
|---|---:|
| commissionRate | 0.0003 |
| stampDutyRate | 0.0005 |
| transferFeeRate | 0.00001 |
| slippageBps | 10 |
| lotSize | 100 |
| minCommission | 5 |

本任务不优化成本参数，不执行成本搜索。

## PIT

策略实时可用信息严格限制为：

```text
首板事件日及之前
+ S 当日
+ S 之后直到 RECLAIM 当日
```

- Event close 是基准。
- S 在 S 当日收盘确认。
- RECLAIM 在 RECLAIM 当日收盘确认。
- Entry 只能发生在 RECLAIM+1 Open。
- T+5 / T+10 / T+20 只能作为 Outcome，不进入入场条件。
- `CUSTOM_EVENT` resolver 必须按上述 PIT 约束实现；文档层不能证明运行时没有旁路读取未来数据。

## Provenance

Strategy metadata tags 已关联以下研究：

- `RESULT-PATTERN-DISCOVERY-STRONG-TREND-001`
- `RESULT-PATTERN-REENTRY-STRONG-TREND-001`
- `RESULT-PATTERN-REALTIME-REENTRY-003`
- `RESULT-PRE-STRATEGY-REENTRY-001`

研究链路：

```text
Research
→ Pattern
→ Hypothesis
→ Pre-Strategy Validation
→ Strategy Definition
```

本轮未写入 `strategy_research_provenance` 数据库表，因为本任务不落库、不绑定正式证据 Run ID；provenance 已进入 StrategyDocument metadata 与 §17 VersionRecord 快照，因此进入文档级 fingerprint。

## Strategy Version

| 字段 | 值 |
|---|---|
| strategyId | `strong-trend-reentry-v1` |
| version | `1.0.0` |
| status | Draft |
| codeVersion | `1.0.0+g7372387` |
| createdAt | `2026-10-05T00:00:00.000Z` |
| document fingerprint | `1114039834f8e364c5e75e1b657dce2f1a45f9ef0ae5f2a260bb9be36ddea9bc` |
| version record fingerprint | `b0e1f72e86f5915ccaa63dc2b987edc55ec918cb356e05d98b8f0975049d19b5` |

Draft 工件：

- `C:\work\sourcecode\stock-limit-up-analyzer\strategy-drafts\strong-trend-reentry-v1.0.0.strategy-document.json`
- `C:\work\sourcecode\stock-limit-up-analyzer\strategy-drafts\strong-trend-reentry-v1.0.0.version-record.json`
- `C:\work\sourcecode\stock-limit-up-analyzer\strategy-drafts\strong-trend-reentry-v1.0.0.validation.json`

未调用 `saveVersion`，因此没有创建生产 `strategies` / `strategy_versions` 数据库行。

## Validation

已执行：

- `validateCanonicalStrategyDefinition`：通过
- `validateStrategyDocument`：通过
- `validateStrategyVersionRecord`：通过
- `computeStrategyDocumentFingerprint`：与 document fingerprint 一致
- `computeStrategyVersionRecordFingerprint`：与 version record fingerprint 一致
- `checkStoredVersionConsistency`：drift = 0
- 相关测试：5 个测试文件 / 172 个用例全通过
- `pnpm run check`：0 错误
- `node scripts/checkEolDrift.mjs --strict`：0 漂移

## Limitations

当前尚未处理：

- 成本真实性。
- 资金容量。
- OOS。
- WFA。
- Exit Optimization。
- 监管事件。
- 其他稳健性问题。
- `CUSTOM_EVENT` 运行期 event resolver 尚未实现；这是定义层完成后的独立执行绑定任务。
- 本文件不启动正式 Backtest。
- `Open < limitUpPrice` 不等于真实世界 100% 可成交。
- Position `maxPositions=10000` 是 Schema 必需字段的哨兵值，不是 V1 的策略约束。

## Final Status

**STRATEGY_DEFINITION_READY**

---

## 附录 B — 指纹更正（由 `STRATEGY-IMPLEMENTATION-REENTRY-001` 追加）

本报告 §17 记录的指纹是本 Draft **最初**版本的指纹。后续两处改动使指纹前移：

1. 为接入 Strategy Core 配方引擎，新增 `recipe`（`strong-trend-reentry-select-all`）；
2. 把 `definition.entry.observationWindow.end` 由 **80 修正为 79**——原值在直读桥上不可执行
   （`neededMaxRelativeDay = end + 1 = 81 > 数据集 post 最大 rd 80`）；`end=79` 保留全部 545 条
   可执行信号、只剔除本就不可成交的 2 条 `reclaim_rd=80` 信号（详见
   `RESULT-STRATEGY-IMPLEMENTATION-REENTRY-001.md` §7）。

**当前指纹（以 `strategy-drafts/*.json` 为准）**：

```text
document fingerprint       = fa114c214502c57e16d85f1ab8c8895ef4e5a2708892b7af5fc564cab5a41bf8
version record fingerprint = c21732f636d348a14dd03ce08438b8b5d90021afb87baa3fb78c6f406d389b84
```

本报告 §17 的旧指纹仅作历史留档。
