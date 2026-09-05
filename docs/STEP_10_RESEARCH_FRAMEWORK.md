# STEP 10 — Research Framework（研究框架）

> 研究逻辑层，产出一条从 Universe 到 Position Intent 的确定性研究链路。

## 1. 数据流

```
Universe(as-of) ──▶ Features(泄漏守卫 + 计算) ──▶ Signal
     ──▶ Ranking(横截面) ──▶ Selection(config-driven) ──▶ Position Intent
```

终端产物是 **Position Intent**（候选 + 意图权重），仅供研究/后续执行消费，**不构成交易**。

## 2. Universe

```ts
export interface UniverseProvider {
  readonly universeId: string;
  getUniverse(asOfDate: string): readonly string[];
}
```

- 必须支持 **as-of 日期**；禁止直接读取「当前」股票列表。
- 参考实现：
  - `StaticUniverseProvider`：固定成员（与日期无关）。
  - `MapUniverseProvider`：显式「日期 → 成员」映射，当日无定义即 FAIL FAST。

## 3. Feature（FeatureProvider + Availability）

```ts
export interface FeatureAvailability {
  readonly requiredDataThrough: DecisionTime; // 计算所需数据的最晚时点
  readonly availableAt: DecisionTime;         // 值可被使用的最早时点
}

export interface FeatureProvider<D = ResearchSecurityData> {
  readonly featureId: string;
  readonly version: string;
  readonly availability: FeatureAvailability;
  compute(input: FeatureComputeInput<D>): number | null;
}
```

- 输入 `security + date`（决策时点），输出单个特征值；`compute` 纯函数、确定性、无 IO。
- 每个 Feature **必须声明 availability**，供泄漏守卫校验。
- 构建工具：`makeBarFeatureProvider`（包装 bars 计算函数）、`sameDayAvailability`（便捷同日落点声明）。

## 4. Signal

```ts
export interface ResearchSignal {
  readonly securityId: string;
  readonly date: string;
  readonly value: number;
  readonly direction: Direction;         // long | short | neutral
  readonly confidence?: number | null;   // 可选/可空
}
```

- `confidence` 可选/可空，框架不强制未来策略输出置信度。
- `SignalBuilder` 为纯函数；`makeWeightedSignalBuilder(weights)` 提供加权线性示例（任一权重特征缺失 → 返回 null，禁止静默填零）。

## 5. Ranking（横截面排序）

```ts
export interface RankingConfig {
  readonly higherIsBetter: boolean;
  readonly winsorization?: WinsorizationSpec;  // { lowerQuantile, upperQuantile }
  readonly tieBreaking?: "stable" | "average";
  readonly missingPolicy?: "exclude" | "rankLast";
}

export function rankSignals(input: RankInput[], config: RankingConfig): RankedSignal[];
```

- **cross-sectional**：同截面按 value 排序。
- **NaN / missing**：`exclude`（排除，无秩）| `rankLast`（排在有效值后，仅报告）。
- **ties**：`stable`（稳定顺序）| `average`（平均秩）；并列以 `securityId` 升序破平保证确定性。
- **winsorization 接口**：`WinsorizationSpec` + 独立 `winsorize`，本 STEP **不选定具体分位参数**。
- 语义：`rank` 1-based（1 最优）；`percentile = 1 − (rank − 1) / n` ∈ (0,1]，1 最优；缺失 exclude 项 rank/percentile 为 null。
- 缺失（rankLast）条目**绝不参与后续 selection**。

## 6. Selection（选择）

```ts
export type SelectionMethod =
  | { kind: "topN"; n: number }
  | { kind: "topPercentile"; pct: number };

export function selectCandidates(ranked: RankedSignal[], config: SelectionConfig): SelectedCandidate[];
```

- 方法 **configuration-driven**：
  - `topN`：按 rank 取前 n；
  - `topPercentile`：取 `percentile >= 1 − pct`。
- 只选择有有效值且已排序的条目；缺失/NaN 绝不选中。

## 7. Experiment Config（研究实验配置）

```ts
export interface ExperimentConfig {
  readonly datasetVersion: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameters: ResearchParameterSet;
  readonly universe: UniverseConfig;
  readonly dateRange: { startDate: string; endDate: string };
  readonly costModel: CostModel;
  readonly randomSeed: number;  // 整数
}
```

- 不可变（readonly）、可序列化（严格拒绝 NaN/Infinity）。
- 满足 STEP 10 字段要求：datasetVersion / strategyId / strategyVersion / parameters / universe / dateRange / costModel / randomSeed。

## 8. Reproducibility（可复现）

- 相同 dataset + strategy + config + seed → **相同研究输入**。
- 全链确定性：不依赖 `Date.now` / `Math.random` / 全局可变状态 / IO。
- 并列破平统一用 `securityId` 升序，排序结果稳定。

## 9. 使用示例

```ts
const strategy: StrategyContract = { strategyId, strategyVersion, name, parameters, requiredData: ["OHLCV"], signalFrequency: "daily" };
const config: ExperimentConfig = { datasetVersion, strategyId, strategyVersion, parameters, universe: { universeId }, dateRange, costModel, randomSeed: 42 };

const result = runResearchPipeline({
  strategy,
  config,
  decisionTime: { date: "2026-01-02", point: "close" },
  universe: new MapUniverseProvider(universeId, { "2026-01-02": ["A", "B", "C"] }),
  featureProviders: [closeFeatureProvider(decisionTime)],
  signalBuilder: makeWeightedSignalBuilder({ lastClose: 1 }),
  rankingConfig: { higherIsBetter: true },
  selectionConfig: { method: { kind: "topN", n: 2 } },
  dataSource: { availableData: ["OHLCV"], getBars: (id) => bars[id] ?? null },
});
// result.signals / result.ranked / result.selected / result.positionIntents / result.dropped
```
