# RESULT-BACKTEST-REENTRY-BASELINE-001

> **任务：`STRATEGY-IMPLEMENTATION-REENTRY-001`（Phase B）**
> 状态：`BLOCKED`（**run 已跑通，但结果不可作为 baseline 采信**）
> 生成日期：2026-10-05（Asia/Shanghai）
> 策略：`strong-trend-reentry-v1@1.0.0` ／ 数据集：`datasetVersionId=780001`（`first_limit_pullback` v8）
> 本轮：按裁定执行方案 2（流式数据面）→ 再执行「决策成员只保留事件成立日」→ run 跑通

---

## 0. 结论

三件事都做成了：

1. **流式数据面**：装配 >30 min（未成功）→ **11.5 s**，内存 ~8.5 GB → **~1.5 GB**；
2. **决策成员收敛**：由装配层把**同一份** Core 事件判定器注入游标，当日成员从 ≈2,961 降到
   **2,492 个候选名额（全历史）**；`RangeError: Invalid string length` 消失；
3. **baseline run 首次跑通**：`data / research / strategy / backtest / evaluation` 五阶段全部 `EXECUTED`，产出完整 Run 资产。

但结果**不可采信**，因此状态仍是 `BLOCKED`。两条硬伤：

```text
① 退出语义被平台默认值接管：candidateExitPolicy 缺省 = HOLD_WHILE_SELECTED
   ⇒ 一旦不再入选即卖出，实测 holdingPeriod 中位数 = 3 个交易日
   ⇒ 文档声明的 TIME_EXIT 20 从未生效 ⇒ 与研究的 T+20 口径不可比

② 96% 的订单被判 SUSPENDED：14,513 单中 13,897 单「执行日无行」
   ⇒ 权益/收益由数据可得性伪影主导，而不是由策略行为主导
```

## 1. Run 事实（真实产出）

```text
experimentId  = EXP-20261005-REENTRY1
runId         = clrun-reentry-baseline-001
window        = 2019-01-01 → 2026-09-04
datasetSource = registry（事件窗流式游标）
stages        = data/research/strategy/backtest/evaluation = EXECUTED；其余 9 阶段 BLOCKED（未装配）
```

| 量 | 值 |
|---|---:|
| 候选名额 candidateSlots | 2,492 |
| 信号 / 订单 | 14,513 / 14,513 |
| 成交 | 602 |
| 拒单 | 13,911（SUSPENDED 13,897 / LIMIT_UP 8 / LIMIT_DOWN 5 / NO_LIQUIDITY 1） |
| 交易 | 306（已平 296 / 期末未平 10） |
| skipped | FROZEN_EXIT_DEFERRED 192 / BUDGET_BELOW_MIN_LOT 2,177 / NO_NEXT_TRADING_DAY 10 |

| 绩效（**不建议引用**） | 值 |
|---|---:|
| 期末权益 / 总收益 | 40,062.86 / **-59.94%** |
| 最大回撤 | **-66.70%** |
| 胜率 / 盈亏比 | 36.49% / 0.669 |
| 平均仓位 | 0.904 |
| 最大并发持仓 | 11 |
| 单笔收益 中位数 / 均值 | -3.33% / -2.55% |
| 持有交易日 中位数 / 均值 | **3 / 3.89** |

> 在 §0 两条硬伤下产出，-59.94% 与 -66.70% **不能**解读为「策略表现」。

## 2. 本轮实现（方案 2 + 成员收敛）

| 位置 | 内容 |
|---|---|
| `server/runWorkbenchAssembly/datasetFromRegistry.ts` | `createEventWindowDatasetCursor` / `buildEventWindowDatasetCursorFromRegistry` / `estimateEventWindowPanelRowsUpperBound`；新增可选 `decisionMemberPredicate` |
| `server/runWorkbenchAssembly/assemble.ts` | 超行预算时改走流式；`resolveEventMemberPredicate()` 把**同一份** `judgeStrongTrendReentryEvent` + `toCoreBarWindow` 注入游标 |
| `server/research/framework/datasetCursor.ts` | `ResearchDatasetCursorStats` 增可选 `suppressedNonTriggerMembers`（只增不改） |
| `server/research/recipeRegistry.ts` | `strong-trend-reentry-select-all` 的 rank 载体由全 0 权重改为 `{ volumeRatio: 1 }`（见 §3） |
| 测试 | 新增 `tests/server/runWorkbenchAssembly/eventWindowDatasetCursor.test.ts`（8 例） |

语义等价性：`projectEventRow` / `eventScopedSecurityId` / rd 集合（0 ∪ [1,end+1]）/ 前收口径 /
观察日 null 富集，全部与物化路径**同一实现**；流式分支**只在物化路径本会超护栏时**启用 ⇒
既有窄窗口策略行为逐字节不变。

## 3. 过程中修掉的两个实现缺陷（已修）

1. **rankValue 的符号决定方向**（`framework/signal.ts#directionFromValue`）：全 0 权重 ⇒ rankValue=0 ⇒
   `neutral` ⇒ longOnly 判 `NON_LONG_DIRECTION`（首轮 2,492 个候选全被跳过）。
   改为 `{ volumeRatio: 1 }`：**恒正载体**，`topPercentile=1` ⇒ 不影响入选集合，只用于满足方向判定。
2. **候选记录超字符串上限**：由「当日成员 = 事件成立成员」解决（见 §0 第 2 点）。

Draft 指纹随 recipe 调整前移：document `4097977e5298de6b6dad4806f66d4fd720335e952a6830939e36ce494776f7f6`，
version record `381e573875326e26b06fb67ac01c4de7c2d772d71335ee8bbf43c9cfc3b5a45b`。

## 4. 与 RESULT-PRE-STRATEGY-REENTRY-001 的对照

**仍不可比**：研究侧是「T* 锚点 + 固定 T+20 观测」，本轮实际是「候选消失即卖、持有中位数 3 日」。

| 维度 | 研究侧 | 本轮 run 实际 |
|---|---|---|
| 入场 | RECLAIM+1 Open | RECLAIM+1 Open（一致） |
| 出场 | 固定 T+20 观测 | **HOLD_WHILE_SELECTED（候选消失即卖）** |
| 信号数 | 547 | 2,492 候选名额（触发成员） |
| 成交 | 513（SIGNAL_FILLED） | 602 成交 / 13,897 SUSPENDED |
| 成本 | 未计 | 已计（佣金/印花税/过户费/滑点） |

> 口径提醒：研究侧 T+20 表里的「样本 513」是 SIGNAL_FILLED 数；真正可算 T+20 的只有 **461** 条
> （86 条 `reclaim_rd ≥ 60` 因 `entry_rd + 20 > 80` 截尾）。

## 5. 两条硬伤的定位

### 5.1 退出语义

`assemble.ts#assembleStrategySide` 构造 `simulationConfig` 时取
`document.definition?.exit?.candidateExitPolicy ?? "HOLD_WHILE_SELECTED"`。
本 Draft 的 `definition.exit` 只有 `rules:[TIME_EXIT 20]`，**未声明 `candidateExitPolicy`** ⇒
平台按默认 `HOLD_WHILE_SELECTED` 执行 ⇒ 声明的 20 日时间退出从未生效（实测持有中位数 3 日）。

### 5.2 SUSPENDED 占比 96%

`13,897 / 14,513` 单在执行日取不到 `(tradeDate, securityId)` 行。候选 run 只保留触发成员
（每个事件 1 天），而回测复用 research 期间按面板身份保留的逐日行
（`retainSecurityIds` → `takeRetainedRows`）。执行日行的可得性与持仓窗口强耦合，需要单独核对
保留区间是否覆盖「触发日 → 退出日」全程。**本轮未完成该核对**，故不下结论。

## 6. Status

```text
数据面        → 事件窗流式游标（已实现、已验证、已跑通全历史）
Baseline run  → 已产出（五阶段 EXECUTED），但**不可采信**
Blocked by    → ① candidateExitPolicy 未声明（退出语义 != 声明） ② 96% SUSPENDED 未定位
```

### 最终状态

**`BLOCKED`**

### 下一步（按优先级）

1. **在 Draft 显式声明 `candidateExitPolicy`**，使 `TIME_EXIT 20 TRADING_DAY` 真正生效
   （属策略定义变更，需走 `applyDefinitionChange()` 出新版本）；
2. **定位并修掉 SUSPENDED 96%**：核对该策略下 `retainSecurityIds` 保留区间是否覆盖执行/退出日；
3. 两项修完后重跑，再与 `RESULT-PRE-STRATEGY-REENTRY-001` 的 T+20 做同口径对照。

在 1–2 落地前，**不采信本轮收益/回撤**，也不进入任何优化 / OOS / WFA。

