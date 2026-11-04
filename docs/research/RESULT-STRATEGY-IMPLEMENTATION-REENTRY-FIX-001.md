# RESULT-STRATEGY-IMPLEMENTATION-REENTRY-FIX-001

> 任务：`STRATEGY-IMPLEMENTATION-REENTRY-FIX-001`
> 状态：**`BLOCKED`**（Exit 已修；SUSPENDED 根因已定位并证实，修复未完成）
> 日期：2026-10-05

---

## 1. Exit 修复（已完成）

### 1.1 canonical 取值

```text
StrategyCandidateExitPolicy = "HOLD_WHILE_SELECTED" | "DISABLED"   // server/research/strategySchema/definition.ts
CandidateExitPolicy         = "HOLD_WHILE_SELECTED" | "DISABLED"   // server/research/simulator/types.ts
含义（simulator/types.ts 原文）：DISABLED = 「候选评分不参与卖出，持仓只由止损/止盈/时间退出等显式规则结束」
```

⇒ 选用 **`DISABLED`**：候选不再入选时不提前退出，持有直到 `TIME_EXIT 20` 生效。**未新增任何 enum / field value**。

### 1.2 写入 Definition

`strategy-drafts/strong-trend-reentry-v1.0.1.strategy-document.json`：

```text
definition.exit.candidateExitPolicy = "DISABLED"
definition.exit.rules             = [TIME_EXIT 20 TRADING_DAY @ ON_CLOSE]   ← 未改
Entry / Position / Risk             = 未改
```

### 1.3 Version / Fingerprint 变化

| 项 | 1.0.0 | 1.0.1 |
|---|---|---|
| version | `1.0.0` | `1.0.1`（patch） |
| document fingerprint | `4097977e…` | **`5d5d3cbefe797e3d57f9b0c08899805c713d90f9e189cefc26232f8db0817a3b`** |
| version record fingerprint | `381e5738…` | **`04e32b895372efe62cf3a6c5c9372414919e760a1a91fb925598a36c4fb97a31`** |
| definition / document / versionRecord validation | PASS | **PASS** |
| stored consistency drift | 0 | **0** |

### 1.4 版本流程的一个真实缺口（必须登记）

`candidateExitPolicy` **只存在于 legacy strategy-schema**（`strategySchema/definition.ts:667`），
**没有进入 Strategy Core 定义**（`git grep candidateExitPolicy server/strategyCore` = 0 hit）。
因此 `applyDefinitionChange()` 无法观测这次变更：它对 Core 定义做行为等价判定 ⇒ 会返回
`kind: "unchanged"` ⇒ **不产生新版本**。

⇒ 本轮采用与创建 Draft 时**同一套** legacy 文档版本流程（`createStrategyDocumentFromDefinition` +
`createStrategyVersionRecord` + `validate*` + `checkStoredVersionConsistency`）产生 `1.0.1`，
并在此**如实登记**「Core 版本流看不到该字段」这一缺口（属架构问题，需独立裁定）。

## 2. SUSPENDED 根因（已定位并证实，修复未完成）

### 2.1 实测（1 年窗口复现，91% SUSPENDED）

```text
window=2024-01-01..2024-12-31  candidateSlots=376  intents=376
totalOrders=755  fills=67  rejected=688
byReason: SUSPENDED 686 / LIMIT_DOWN 1 / LIMIT_UP 1
audit 按 side×status 拆分：{ "sell:REJECTED": 687, "buy:REJECTED": 1 }
```

⇒ **686 个 SUSPENDED 全部是 SELL**，而且不是 686 个不同仓位，是**少数仓位每天重试卖出**：

```text
sample: side=sell  id=...::event:603099.SH@2023-09-18
  2024-01-17  inRetainedRows=true
  2024-01-25  inRetainedRows=false
  2024-02-01  inRetainedRows=false
  ...（同 id 连续多日）
```

### 2.2 为什么

```text
该事件日 = 2023-09-18；其 ds_* 事件窗 = rd 0..80 ⇒ 最后一行 ≈ 2024-01-17
仓位在窗口末段（rd≈79）才建仓 ⇒ 卖出日落到 rd>80
⇒ 事件窗内没有该 (tradeDate, securityId) 行
⇒ 引擎拒单 SUSPENDED，且**次日重新计划卖出**（不静默顺延）⇒ 每天一条 SUSPENDED
```

⇒ 正是任务预判的那条：**Signal Membership 的裁剪被连带施加到了 Execution Holding Data**。
我上一轮把「当日决策成员」收敛为触发成员时，`retainSecurityIds → takeRetainedRows` 保留的仍然只是
**事件窗内**的行（rd ≤ 80），而持仓生命周期需要 `entryDate → exitDate` 的行 —— 这两者**必须解耦**。

### 2.3 结论：这不是「保留范围调大一点」能修的

`ds_*_post` 在 rd>80 **不存在**该事件的行（`postRange.max = 80`）。因此要覆盖完整持仓生命周期，
执行数据必须来自**事件窗之外的另一份数据面**（按 `(securityId, tradeDate)` 可查的日线），
即任务 §4 指向的 Dataset / Execution Data Assembly 层改动 —— **本轮未实现**。

## 3. 修改文件

| 文件 | 改动 |
|---|---|
| `scripts/_scratch/_create_strategy_definition_reentry_001.mts` | version → 1.0.1；`exit.candidateExitPolicy = "DISABLED"`；输出改指 v1.0.1 |
| `strategy-drafts/strong-trend-reentry-v1.0.1.strategy-document.json` | 新版本工件 |
| `strategy-drafts/strong-trend-reentry-v1.0.1.version-record.json` | 新版本记录 |
| `strategy-drafts/strong-trend-reentry-v1.0.1.validation.json` | 验证摘要 |

（v1.0.0 工件保留未改，作为不可变历史版本。）

## 4. 新增测试

**未完成**（预算耗尽）。计划覆盖（任务 §5）：

```text
Exit        : candidateExitPolicy=DISABLED + TIME_EXIT 20 ⇒ 候选不再入选时持仓继续存在，第 20 个交易日收盘退出
Retention   : Signal Day → Entry Day → Holding Day → Exit Day 行全部可被 execution runtime 取到
SUSPENDED   : 最小案例（signal/entry/holding/exit bars 齐全）不得因 execution dataset pruning 判 SUSPENDED
```

## 5. 最终状态

```text
Exit 修复            → DONE（1.0.1 / candidateExitPolicy=DISABLED / 指纹已更新 / 校验通过）
SUSPENDED 根因        → FOUND & PROVEN（SELL 侧事件窗耗尽 + 每日重试）
SUSPENDED 修复        → NOT DONE（需事件窗之外的执行日线数据面）
新增回归测试           → NOT DONE
Baseline 002          → NOT PRODUCED（见 RESULT-BACKTEST-REENTRY-BASELINE-002.md）
```

**`BLOCKED`**

### 解除阻塞的最小改动方向（需裁定）

1. 在 Execution Data Assembly 层为**已持仓**面板身份补一份按 `(securityId, tradeDate)` 可查的日线
   （entryDate → exitDate），与 signal-member pruning 完全解耦；
2. 或让事件窗游标在成员被 retain 后**继续以日线补齐**其 rd>80 的行；
3. 两者都属「新增执行数据面」，需架构评审；且修完必须补 §4 的 3 组回归测试再运行 Baseline 002。

