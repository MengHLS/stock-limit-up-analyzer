# STEP 10 — Leakage Audit（泄漏审计）

> 防未来函数（look-ahead）审计：框架内每一处「时间」都必须显式声明，且任何特征可用性时点晚于决策时点即被拒绝。

## 1. 时序模型

```ts
export interface DecisionTime {
  readonly date: string;   // YYYY-MM-DD
  readonly point: DecisionPoint; // "open" | "close"
}
```

排序规则：同一天 `open < close`；不同日期按字符串日期升序（`compareDecisionTime`）。

## 2. Feature 可用性声明

每个 Feature 必须声明 `FeatureAvailability`：

```ts
export interface FeatureAvailability {
  readonly requiredDataThrough: DecisionTime; // 计算所需数据的最晚时点
  readonly availableAt: DecisionTime;         // 值可被使用的最早时点
}
```

## 3. 泄漏守卫规则

`LeakageGuard.assertNoLookAhead(featureId, availability, decisionTime)`：

1. `availableAt > decisionTime` → 抛 `LookAheadError`（未来函数）；
2. `requiredDataThrough > decisionTime` → 抛 `LookAheadError`（数据尚未可得）。

两条规则在 `runResearchPipeline` 中对**每个 feature provider** 强制执行，任一违反即中断。

## 4. 防泄漏的多层防线

| 层 | 机制 | 说明 |
| --- | --- | --- |
| 声明层 | `FeatureAvailability`（requiredDataThrough + availableAt） | 特征自报数据依赖与可用时点 |
| 守卫层 | `LeakageGuard.assertNoLookAhead` | 运行时拒绝前视特征 |
| 数据层 | `visibleBars(rawBars, date, point)` | as-of 过滤，未来 bar 物理上不可见 |
| 边界层 | 策略不可直接查询 DB/网络 | 特征只能消费 pipeline 传入的过滤后数据 |

- `visibleBars` 对 `"close"` 决策点保留 `timestamp <= date`，对 `"open"` 保留 `timestamp < date`，未来 bar 不会进入特征计算（测试验证：未来 bar 不泄漏进特征值）。
- 特征 `compute` 只接收已 as-of 过滤的 bars，且被 `readonly` 约束。

## 5. 审计结论

| 检查项 | 结果 |
| --- | --- |
| 特征是否必须声明 requiredDataThrough | ✅ 强制（`FeatureAvailability`） |
| 特征是否必须声明 availableAt | ✅ 强制（`FeatureAvailability`） |
| availableAt > decisionTime 是否被拒绝 | ✅ `LookAheadError` |
| requiredDataThrough > decisionTime 是否被拒绝 | ✅ `LookAheadError` |
| 未来 bar 是否可能进入特征计算 | ❌ 不可能（`visibleBars` as-of 过滤） |
| 是否存在静默 fallback 掩盖缺失数据 | ❌ 不存在（requiredData FAIL FAST） |
| 是否存在 NaN/Infinity 进入信号/排序 | ❌ 校验层拒绝，排序层过滤 |

## 6. 泄漏相关测试覆盖

- `availableAt <= decisionTime` 通过守卫；`availableAt > decisionTime` 拒绝。
- `requiredDataThrough > decisionTime` 拒绝。
- 端到端：look-ahead 特征 provider 进入 `runResearchPipeline` 抛 `LookAheadError`。
- 未来 bar（决策日之后的 bar）不泄漏进特征值（`value === 100` 而非 `999`）。

## 7. 已知边界

- 框架不内置交易日历；跨交易日偏移（如「T+1 开盘」）需调用方显式给出绝对日期，否则由 `compareDecisionTime` 按字符串日期判定。若调用方给出错误日期，属数据配置错误而非框架泄漏——建议未来接项目既有交易日历（`server/tushareTradingCalendar` / 本地缓存）做日期解析。
