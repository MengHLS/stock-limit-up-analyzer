# STEP 10 — Strategy Contract（策略契约）

> 研究层策略契约。研究逻辑层，不触碰执行层。

## 1. 定义

```ts
export type SignalFrequency = "daily" | "weekly" | "intraday";

export interface StrategyContract {
  readonly strategyId: string;          // 策略唯一标识
  readonly strategyVersion: string;     // 版本，不可变
  readonly name: string;
  readonly description?: string;
  readonly parameters: ResearchParameterSchema;  // 参数 schema（复用研究层）
  readonly requiredData: readonly string[];       // 所需数据域（OHLCV/Turnover/Industry/Index/Status…）
  readonly signalFrequency: SignalFrequency;      // 信号频率
}
```

## 2. 版本不可变（Version Immutable）

- `strategyVersion` 一经发布不可原地覆写；**任何逻辑变更必须产出新版本号**。
- 校验层拒绝空 `strategyVersion`（code `STRATEGY_VERSION_EMPTY`）。
- 实验配置与策略身份一致性由 `runResearchPipeline` 强制（`config.strategyId/strategyVersion === strategy.strategyId/strategyVersion`），防止用错版本。

## 3. 字段契约

| 字段 | 约束 |
| --- | --- |
| `strategyId` | 非空字符串 |
| `strategyVersion` | 非空字符串，不可变 |
| `name` | 非空字符串 |
| `description` | 可选字符串 |
| `parameters` | 参数 schema（含 `parameters` 数组） |
| `requiredData` | 非空字符串数组（声明数据依赖，FAIL FAST 依据） |
| `signalFrequency` | `daily` / `weekly` / `intraday` 之一 |

## 4. Data Dependency（数据依赖）

- `requiredData` 显式声明策略需要的数据域。
- 流水线运行前校验 `requiredData ⊆ dataSource.availableData`，任一缺失即 **FAIL FAST**（抛错），**禁止 silent fallback**。
- 缺失数据域错误示例：`策略 X 所需数据域缺失：Turnover（数据源仅提供 OHLCV）`。

## 5. 校验 code 清单

| code | 含义 |
| --- | --- |
| `STRATEGY_CONTRACT_INVALID` | 契约缺失/非对象 |
| `STRATEGY_ID_EMPTY` | strategyId 为空 |
| `STRATEGY_VERSION_EMPTY` | strategyVersion 为空 |
| `STRATEGY_NAME_EMPTY` | name 为空 |
| `STRATEGY_DESCRIPTION_INVALID` | description 非字符串 |
| `STRATEGY_PARAMETERS_INVALID` | parameters 非法 |
| `STRATEGY_REQUIRED_DATA_INVALID` | requiredData 含空串或缺失 |
| `STRATEGY_SIGNAL_FREQUENCY_INVALID` | signalFrequency 非法 |

## 6. 与既有契约的关系

- **不是**对生产 `StrategyMetadata`（`server/strategy/contract.ts`，BUY/SELL/HOLD 执行语义）的替换。
- **不是**对研究层 `ResearchStrategyDefinition`（`server/research/strategyContract.ts`，实验元数据 + 参数空间）的替换。
- 本契约是「研究框架」的自描述：身份 + 参数 + 数据依赖 + 信号频率，**不含评分/信号/成交逻辑**。

## 7. 序列化

`serializeStrategyContract` / `deserializeStrategyContract` 提供严格 round-trip（拒绝 NaN/Infinity），保证契约可持久化、可复现。
