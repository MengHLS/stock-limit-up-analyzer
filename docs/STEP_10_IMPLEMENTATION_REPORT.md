# STEP 10 — Strategy Research Framework 实施报告

> 阶段性质：**只建设研究框架，不进行正式策略结论**。
> 本阶段不宣布任何策略 profitable / robust / validated / production-ready，不运行正式 OOS / WFO 结论。

## 1. 交付概览

建立了独立的 **Strategy Research Framework**，落地于 `server/research/framework/`，覆盖：

```
Universe → Features → Signal → Ranking → Selection → Position Intent
```

| 文件 | 职责 |
| --- | --- |
| `leakage.ts` | 决策/可用性时点模型（`DecisionTime`）、`FeatureAvailability`、`LookAheadError`、`LeakageGuard` |
| `contract.ts` | 全部研究契约类型（Strategy / Universe / Feature / Signal / Ranking / Selection / PositionIntent / ExperimentConfig） |
| `validation.ts` | 契约校验（结构化 issue + 稳定 code + assert 入口） |
| `universe.ts` | `UniverseProvider` 契约 + `StaticUniverseProvider` / `MapUniverseProvider` 参考实现 |
| `featureProvider.ts` | `makeBarFeatureProvider` / `sameDayAvailability` 构建工具 |
| `signal.ts` | `SignalBuilder`、`makeWeightedSignalBuilder`、`directionFromValue` |
| `ranking.ts` | `rankSignals`（横截面排序）、`winsorize`（缩尾） |
| `selection.ts` | `selectCandidates`（topN / topPercentile） |
| `serialization.ts` | 实验配置 / 策略契约严格序列化 |
| `pipeline.ts` | `runResearchPipeline`（端到端确定性流水线） |
| `index.ts` | 统一出口 |
| `framework.test.ts` | 39 项测试 |

已接入统一出口：`server/research/index.ts` 新增 `export * from "./framework"`。

## 2. 契约清单（完成标准对照）

| STEP 10 要求 | 实现 | 状态 |
| --- | --- | --- |
| Strategy Contract（strategyId / strategyVersion / name / description / parameters / requiredData / signalFrequency） | `StrategyContract`，`strategyVersion` 不可变 | ✅ |
| Universe（`getUniverse(date)`，as-of，禁止读当前列表） | `UniverseProvider` + 两个参考实现，缺失 FAIL FAST | ✅ |
| Feature Contract（security+date → 值，声明 availability） | `FeatureProvider` + `FeatureAvailability` | ✅ |
| Signal（securityId / date / value / direction / confidence，confidence 可空） | `ResearchSignal` | ✅ |
| Ranking（横截面、NaN/missing/ties、winsorization 接口） | `rankSignals` + `WinsorizationSpec` | ✅ |
| Selection（top N / top percentile，配置驱动） | `selectCandidates` + `SelectionConfig` | ✅ |
| ExperimentConfig（datasetVersion / strategyId / strategyVersion / parameters / universe / dateRange / costModel / randomSeed，不可变/可序列化） | `ExperimentConfig` | ✅ |
| Reproducibility（相同 dataset/strategy/config/seed → 相同研究输入） | 全链确定性，无 Date.now/Math.random | ✅ |
| Data Dependency（FAIL FAST，禁止 silent fallback） | `requiredData ⊆ dataSource.availableData` 校验 | ✅ |
| Leakage Protection（requiredDataThrough + availableAt，availableAt > decisionTime 禁止） | `LeakageGuard.assertNoLookAhead` | ✅ |
| 测试（version / serialization / universe / availability / signal / ranking / selection / missing / NaN / determinism / look-ahead） | `framework.test.ts` 39 项 | ✅ |

## 3. 测试结果

- `pnpm vitest run server/research` → **18 个文件 / 294 项全部通过**（含本 STEP 新增 39 项）。
- TypeScript：`server/research/framework/` 目录 **0 错误**。
- 说明：仓库内 `server/backfill`、`server/backtest`、`server/marketData` 等与本 STEP 无关的在建模块存在既有类型错误（含 `downlevelIteration` 等），非本次引入。

## 4. 边界（刻意不做的事）

- **不开发最终策略**，不产生 Order / Fill，不修改 Portfolio。
- **不宣布 Alpha**、不运行正式 OOS / WFO 结论、不针对当前数据过拟合参数。
- **不选择具体 Ranking / Winsorization / Selection 参数**——只提供接口，参数由调用方 configuration-driven 指定。
- 每次 `runResearchPipeline` 只处理**单个 decisionTime 的横截面**；多日期研究由调用方逐日调用（保证确定性）。

## 5. 已知限制

- `FeatureAvailability` 为绝对时点；跨交易日偏移（如「T+1 开盘」）需调用方显式给出绝对日期，框架不内置交易日历。
- `randomSeed` 已纳入契约并校验为整数，但当前流水线本身确定性、不消费随机数；该字段为未来随机步骤（如交叉验证打乱）预留。
- `confidence` 为可选/可空，框架不强制策略输出。
