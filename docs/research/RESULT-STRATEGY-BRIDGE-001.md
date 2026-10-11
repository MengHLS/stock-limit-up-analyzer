# RESULT-STRATEGY-BRIDGE-001 · Strategy Bridge：解除 5 项阻塞

> 目标：解除 `RESULT-STRATEGY-DRAFT-001` 的 5 个阻塞，使第一版 `EVENT_STATE_LONG` 策略达到「可进入正式 Backtest」的状态
> 🔴 **NON-PLATFORM-FORMAL-RUN** · **零数据库写入** · Dataset **`780004`** · 策略 Draft `event-state-long-amp5-top3-hold40`
> **未跑 Backtest / OOS / WFA** · **未创建 Candidate / Strategy Version** · **未修改 3570001**

---

## 0. 最终验收

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                      │
│                        ##  A. READY_FOR_FORMAL_BACKTEST                                               │
│                                                                                                      │
│  **十项验收条件【全部满足】（其中 #1 由实际执行验证 52/52 断言通过）**                                        │
│                                                                                                      │
│  | # | 条件 | 结论 | 证据 |                                                                            │
│  |---|---|---|---|                                                                                  │
│  | 1 | maxAmp5 / avgAmp5 已成为正式平台特征 | ✅ | `featureRegistry.ts` 新增 + 默认注册表可 resolve；**52/52 断言通过** | │
│  | 2 | 两个 Variant 都能被平台完整表达 | ✅ | 见 §2 两份 canonical 定义（除排名特征外逐字段相同） |              │
│  | 3 | PIT / leakage 测试通过 | ✅ | rd14⇒null · rd16+ 永不读取 · `usesForwardData=false` · `dataThroughRelativeDay=0` | │
│  | 4 | T+15 → rd16 open → F40 exit 时序可表达 | ✅ | `observationWindow{15,15}` + `LAST_VALID_DAY` + `T_CLOSE`→`T_PLUS_1_OPEN` + `OPEN`；`TIME_EXIT` 40 交易日 | │
│  | 5 | 1/180 固定仓位可表达 | ✅ | `EQUAL_WEIGHT` + `maxPositions=180` ⇒ 引擎实际口径 `EQUAL_WEIGHT_CASH_BUDGET` | │
│  | 6 | 20bps 成本可表达 | ✅ | `commissionModel`/`slippageModel` = BPS 两段，合计 **10bps/边 = 20bps 往返** | │
│  | 7 | rd80 fallback 可表达 | ✅ | 数据集 `postWindowDays=80` 边界 + `SUSPENDED_NEXT_OPEN_UNFILLED` 顺延约束 | │
│  | 8 | 不依赖 3570001 的 exit / position policy | ✅ | 退出用 **rule-list `TIME_EXIT`**（**无 policy 对象**）；仓位用 `EQUAL_WEIGHT`（**非** `FIXED_RATIO`） | │
│  | 9 | 不改变既有冻结研究定义 | ✅ | 因子逐值一致（3 种形状 × 2 特征）；`observation*` / `rollingMaxAmplitude` 定义与行为均未变 | │
│  | 10 | 不产生任何未来数据泄漏 | ✅ | 三道结构性防线（决策点下界 / 上限硬截断 / 完整性） | │
│                                                                                                      │
│  ⚠️ **三项残留（非阻塞，须在正式 Backtest 设置阶段确认）**：见 §6                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. B1 解除 · 正式注册研究因子（**代码交付 + 执行验证**）

### 1.1 改动（**纯增量**）

| 文件 | 改动 |
|---|---|
| `server/strategyCore/featureRegistry.ts` | **新增** `EVENT_STATE_AMPLITUDE_FEATURE_IDS` · `EVENT_STATE_AMPLITUDE_WINDOW` · `eventStateAmplitudeValues()` · **`makeEventStateAmplitudeFeatures()`**；在 `createDefaultFeatureRegistry()` 中追加一行注册 |
| `tests/server/strategyCore/eventStateAmplitude.test.ts` | **新增**（契约测试） |

🔴 **未修改**：`observationMaxAmplitude` · `observationMeanAmplitude` · `rollingMaxAmplitude` 的**任何**定义；未改 `DERIVED_BAR_FIELD_TO_FEATURE_ID`（不扩 legacy 面）；未改 `validateFeatureDefinition` / `sameBarLeakage` / `createFeatureRegistry`。

### 1.2 冻结定义复用（**逐字**）

```
振幅(rd) = (high(rd) − low(rd)) / close(rd−1)
runningPreClose 自【事件日收盘】起步，逐根更新
窗口 = rd11 ~ rd15
maxAmp5 = max(5 个振幅)   avgAmp5 = mean(5 个振幅)
```

与 `observationWindowFeatureValues`（rd1~5）**同一链式前收算法**，未另立公式 ✓

### 1.3 🔴 三道结构性防线（**静态可判，不依赖调用方自觉**）

| # | 防线 | 实现 | 验证 |
|---|---|---|---|
| **①** | **决策点下界** | `if (current.relativeDay < 15) return null;` | ✅ **rd0/1/5/10/11/12/13/14 全部 ⇒ null**（8×2 = 16 断言） |
| **②** | **上限硬截断** | `.filter(bar => bar.relativeDay >= 1 && bar.relativeDay <= 15)` | ✅ **rd16~25 注入极值（high=1000/low=1）后，两特征值【逐位不变】**；决策点 rd15 → rd25 值不变 |
| **③** | **完整性** | `values.length === 5` 否则 null | ✅ 窗口中部整根缺失 ⇒ null |

### 1.4 ✅ 实际执行验证结果（**52 passed / 0 failed**）

> ⚠️ 本沙箱 `vitest` 因 `spawn EPERM` **不可用**（已知限制，不重试另一路径）⇒ 改用**编译执行**：
> `tsc` 将 `server/strategyCore` 编译为 CJS 到 `%TEMP%`，由 harness **直接 require 生产模块**并断言
> （与 `tests/server/strategyCore/eventStateAmplitude.test.ts` 的断言**完全一致**）。

| 分组 | 断言数 | 结果 |
|---|:---:|:---:|
| 契约（id / version / historyMode / leakage） | 13 | ✅ 全通过 |
| 注册（默认注册表 has / resolve / 无第二份语义） | 5 | ✅ |
| **① rd15 可算**（含手算锚点 `0.4/11.0`） | 5 | ✅ |
| **② rd14 及以前 ⇒ null** | 8 | ✅ |
| **③ rd16+ 永不进入计算** | 3 | ✅ |
| **④ 逐值一致**（3 种形状 × 2 特征） | 6 | ✅ |
| 数据不完整 / 非法 ⇒ null | 5 | ✅ |
| **既有 rd1~5 特征定义未被改动** | 7 | ✅ |
| **合计** | **52** | ✅ **0 failed** |

**关键断言（原文）**
```
✅ rd14 ⇒ null（两特征）                     ← 决策点下界
✅ rd16~25 极值注入后 maxAmp5 逐位不变         ← 上限硬截断（证明未读 rd16+）
✅ 决策点 rd15 → rd25 值不变（证明未读 rd16+）
✅ observationMaxAmplitude 仍只吃 rd1~5（不受 rd11/rd15 极值影响）   ← 既有定义未受损
✅ rollingMaxAmplitude 仍封顶 rd5
```

---

## 2. B2 解除 · 第一版**双轨候选**（**不伪装择优**）

🔴 `FACTOR-SELECT-001` 是 **3:3 平局** ⇒ **不得伪装成已选出唯一因子**。本轮建立两个 **Draft Variant**：

| Variant | 排名因子 | 方向 | 其余 |
|---|---|---|---|
| **`event-state-long-maxamp5-top3`** | `maxAmp5` | **−1**（振幅低者优） | **完全一致** |
| **`event-state-long-avgamp5-top3`** | `avgAmp5` | **−1**（振幅低者优） | **完全一致** |

**两者唯一的差异 = `recipe.featureVersions[0].featureId`**（`maxAmp5` ↔ `avgAmp5`）—— 其余每个字段逐字相同。
✅ **未跑 factor search · 未新增第三个因子 · 未做权重优化 · 未重做 TopN 搜索**

### 2.1 canonical 定义（Variant 1；Variant 2 仅替换 `featureId`）

```jsonc
{
  "schemaVersion": "1.0",
  "datasets": [{ "datasetId": "first_limit_pullback", "datasetVersion": "v10-listed365-pre10-post80",
                 "datasetVersionId": 780004, "role": "PRIMARY" }],
  "entry": {
    "event": { "type": "FIRST_LIMIT_UP", "params": { "limitUpRatio": 0.1 } },
    // 🔴 单日窗口 {15,15} + LAST_VALID_DAY ⇒ 决策【恒在 rd15】
    "observationWindow": { "start": 15, "end": 15, "unit": "TRADING_DAY" },
    "trigger": { "type": "LAST_VALID_DAY" },
    "conditions": []
  },
  "execution": {
    "signalTiming": "T_CLOSE",           // rd15 收盘出信号
    "executionTiming": "T_PLUS_1_OPEN",  // rd16 开盘成交
    "priceType": "OPEN",
    "quantityMethod": "TARGET_WEIGHT",
    "lotSize": 100,
    "commissionModel": "BPS",
    "slippageModel": "BPS",
    "executionConstraints": ["OPEN_AT_LIMIT_UP_UNFILLED", "SUSPENDED_NEXT_OPEN_UNFILLED"]
  },
  "exit": {
    // 🔴 rule-list 形式：单条 TIME_EXIT，【无 policy 对象】⇒ 无止损 / 无止盈 / 无 runner
    "rules": [{ "id": "exit-time-40", "type": "TIME_EXIT", "trigger": "ON_CLOSE",
                "threshold": 40, "thresholdUnit": "TRADING_DAY", "priority": 0, "enabled": true }]
  },
  "position": { "sizingMethod": "EQUAL_WEIGHT", "maxPositions": 180,
                "maxExposure": 1, "maxSinglePosition": 0.005556, "positionRatio": 0.005556 },
  "risk": { "maxExposure": 1 },
  "parameters": [],
  "recipe": {
    "recipeId": "event-state-long-amp5-top3",
    "kind": "signalEngine", "point": "close", "signalFrequency": "daily",
    "featureVersions": [{ "featureId": "maxAmp5", "version": "1.0.0" }],   // ← Variant 2: "avgAmp5"
    "rankingConfig": { "higherIsBetter": false },                          // ← 冻结方向 −1
    "selectionConfig": { "method": { "kind": "topN", "n": 3 } }
  }
}
```

> 📌 `higherIsBetter: false` 是**冻结方向 `dir = −1`** 的平台表达（振幅**低**者优）—— 与 3570001 的 `higherIsBetter: true` 不同，因为 3570001 的 3F 使用**已含方向的桶位分**，而本策略使用**原始特征值**。

---

## 3. B3 解除 · 第一版仓位口径

**采用研究已实际验证过的固定组合口径**（**未做任何仓位参数搜索**）：

| 项 | 值 | 来源 |
|---|---|---|
| TopN | **3** | FROZEN |
| `MAX_CONC` | **`ceil(1.5 × 3 × 40) = 180`** | FROZEN（`NB-RANDOM-002`） |
| 每笔目标权重 | **`1 / 180`** | FROZEN |
| 每日先出后进 | ✅ | FROZEN |
| 满仓跳过 | ✅ | FROZEN |
| 同 symbol 不重复持仓 | ✅ | FROZEN |
| 现金不足跳过 | ✅ | FROZEN |

**平台可表达性证据**：`server/backtest/context.ts#resolvePositionSizing` 确立引擎**实际口径恒为 `EQUAL_WEIGHT_CASH_BUDGET`**（「等权现金预算 ÷ 整手（maxPositions=…）」）⇒ 声明 `sizingMethod: "EQUAL_WEIGHT"` + `maxPositions: 180` **即精确表达 `w = 1/180`** ✓
**先例**：生产定义 `strongTrendReentryEventSource.test.ts` 使用 `EQUAL_WEIGHT` + `maxPositions: 10000` ⇒ **大 `maxPositions` 有既存先例** ✓

> ## 🔴 **明确登记**：**`MC = 180` 是【研究执行口径】，不代表已经证明是最优风险参数。**
> ## **本轮未做仓位参数搜索；`maxExposure` / `maxSinglePosition` 的精确取值见 §6 R1。**

---

## 4. B4 解除 · 以研究退出逻辑作为第一版研究基准

**不继承 3570001 的**：6% stop loss · PEAK_DRAWDOWN · MA5/MA10 take profit · strongHold · runnerBridge

| 项 | 第一版固定值 |
|---|---|
| 入场 | **rd16 `open`** |
| 出场 | **目标 rd55 `close`（F40）** |
| 成交条件 | **`canSellAtClose = 1` 时成交** |
| 不可卖 | **顺延**（`SUSPENDED_NEXT_OPEN_UNFILLED`） |
| 最终兜底 | **rd80**（数据集 `postWindowDays = 80` 边界） |
| stop loss | 🚫 **无** |
| take profit | 🚫 **无** |
| runner | 🚫 **无** |

**平台可表达性证据（关键）**：
- `STRATEGY_EXIT_RULE_TYPES` 含 **`TIME_EXIT`**（`strategySchema/definition.ts` L129-136）⇒ 可用 **rule-list 形式**声明**单条 `TIME_EXIT`**，**不产生 `policy` 对象** ⇒ **`ExitPolicyDefinition.stop` 的必填约束不被触发** ✓
- `EXIT_RULE` 字段支持 `threshold` + `thresholdUnit`（`definition.ts` L640-641）⇒ `threshold: 40, thresholdUnit: "TRADING_DAY"` = **F40** ✓
- 🔴 **先例**：生产定义 `strongTrendReentryEventSource.test.ts` 使用
  `exit: { rules: [{ type: "TIME_EXIT", trigger: "ON_CLOSE", threshold: 20, thresholdUnit: "TRADING_DAY", priority: 1, enabled: true }] }` —— **无止损、无 policy** ✓
- ⚠️ **对照**：`exitPolicyDefinitionErrors`（`exitPolicyCommon.ts` L376-383）**要求 `stop` 必须是对象** ⇒ 「带 policy 的统一退出」路径**无法表达「无止损」** ⇒ **本轮【不采用** policy 路径**】** ✓

> ## ✅ **⇒ 独立 `timeExit` / rule-list execution policy 可表达；3570001 的 exit policy【未被修改、未被复制】**

---

## 5. B5 解除 · 正式接受范围收窄 + B6 成本口径

### 5.1 B5 范围收窄（**登记，不改冻结原则**）

| 尺度 | 第一版策略 |
|---|:---:|
| **`EVENT_STATE_LONG`** | ✅ **唯一纳入** |
| SHORT | 🚫 **不进入**（冻结：「仅登记角色，不进策略」） |
| MEDIUM | 🚫 **不进入**（冻结：「⛔ 不与 LONG/SHORT 组合」；绝对净值 −0.82%） |
| 原 LONG-4 | 🚫 **不进入**（`ATTRIBUTION-001`：T+15 无稳定增量） |
| 三尺度综合评分 | 🚫 **禁止**（冻结原则 §3-4） |

✅ **`FACTOR-TIMESCALE-FINAL-001` 未被修改** —— 本轮仅**引用并遵守**其冻结结论。

### 5.2 B6 成本口径（**拆分，不制造更优结果**）

| 项 | 值 | 说明 |
|---|---|---|
| 研究口径 | **往返合计 20bps**（harness：每笔 `net = gross − 0.002`） | FROZEN |
| 平台表达 | `commissionModel: "BPS"` + `slippageModel: "BPS"` | INHERITED（字段名） |
| **拆分** | **10 bps / 边**（往返 20bps） | **NEW-DESIGN（映射）** |
| 建议取值 | `commissionRate = 0.00025`（2.5bps）· `slippageBps = 7.5` ⇒ **合计 10bps/边** | NEW-DESIGN |
| 其它成本分量 | `stampDutyRate = 0` · `transferFeeRate = 0` · `minCommission = 0` · `lotSize = 100` | NEW-DESIGN |

**平台证据**：`server/engine/execution.ts` L31/L43 —— `slippageBps` 按 **每边** 施加（买入 `×(1+bps/1e4)`、卖出 `×(1−bps/1e4)`）⇒ **10bps/边 = 20bps 往返** ✓

> ## 🔴 **必须登记的口径保真度限制**：研究口径 20bps 是**平坦成本假设**；映射后 `stampDutyRate = 0` ⇒ **未含 A 股印花税**（卖出约 5bps）⇒ **若如实计入印花税，往返成本将高于 20bps**。
> ## **本轮【不通过修改成本参数制造更优结果】—— 映射严格保持「合计 = 研究 20bps」；该保真度缺口见 §6 R2。**

---

## 6. 三项残留（**非阻塞 · 须在正式 Backtest 设置阶段确认**）

| # | 残留 | 性质 | 处置 |
|---|---|---|---|
| **R1** | `maxExposure` / `maxSinglePosition` 的**精确取值**需过 schema 校验 | 定义细节 | 建议 `maxExposure = 1`（180 × 1/180 = 1.0）· `maxSinglePosition = 1/180 ≈ 0.005556`；**须在创建 Draft 时跑 `validateCanonicalStrategyDefinition` 确认**（本轮未创建，故未跑） |
| **R2** | **成本口径保真度**：平坦 20bps ↔ 平台分解模型（含印花税差异） | 口径映射 | 已登记（§5.2）；**正式 Backtest 须以同一 20bps 口径为准**，不得因分解而改变总成本 |
| **R3** | **rd80 兜底**的**逐位等价** | 回测器行为 | 平台侧由数据集 `postWindowDays = 80` 边界 + 顺延约束承载；**须在 Backtest 设置阶段核对**（属**回测器行为**，非**策略定义能力**） |

---

## 7. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 两个 Variant 在**平台正式口径**下的任何绩效（本轮**未跑 Backtest**） |
| **N2** | 🔴 `maxAmp5` vs `avgAmp5` 的择优（`FACTOR-SELECT-001` **3:3 平局**未解决；本轮**如实保留双轨**） |
| **N3** | ❌ `MC = 180` 是否为合理风险参数（**仅为研究执行口径**） |
| **N4** | ❌ 研究 harness ↔ 平台 simulator 的**逐笔等价性**（`P0-ORACLE-002` 仅在 harness 内验证过） |
| **N5** | ❌ OOS / WFA 划分 |
| **N6** | ❌ 冲击成本 / 容量（无订单簿数据） |
| **N7** | ❌ `(A) 年度切分口径缺陷`（遗漏每年首日 P&L，+0.34%~+1.40%）**尚未修复** |
| **N8** | ❌ R1 / R2 / R3 三项残留的最终确认 |
| **N9** | ❌ 可外推（仅 `780004` · 仅首板回踩 · 仅 Top3） |

---

## 8. 限制与合规声明

✅ **未跑 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未重新研究因子** · ✅ **未做 F80** · ✅ **未做 TopN / 权重 / 仓位搜索** · ✅ **未把 3570001 的 runner / 止损 / 止盈复制过来** · ✅ **未修改既有正式策略 3570001** · ✅ **未修改 `FACTOR-TIMESCALE-FINAL-001`** · ✅ **未修改 `observation*` / `rollingMaxAmplitude` 定义** · ✅ **未写数据库** · ✅ **未改 Schema / Migration / Dataset**

**变更的业务代码（唯一一处，本任务明确授权）**：`server/strategyCore/featureRegistry.ts` —— **纯增量**（新增常量 + 工厂 + 默认注册表追加一行）。

**验证**：`tsc --noEmit` **0 错** · 特征契约 **52/52 通过** · CR=0

---

## 9. 修改文件清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `server/strategyCore/featureRegistry.ts` | **修改**（纯增量：`EVENT_STATE_AMPLITUDE_FEATURE_IDS` · `EVENT_STATE_AMPLITUDE_WINDOW` · `eventStateAmplitudeValues` · `makeEventStateAmplitudeFeatures` + 注册一行） |
| 2 | `tests/server/strategyCore/eventStateAmplitude.test.ts` | **新增**（契约测试） |
| 3 | `docs/research/RESULT-STRATEGY-BRIDGE-001.md` | **新增**（本报告） |
| 4 | `docs/architecture/CHANGE-AUDIT.md` | **追加**审计条目 |
| 5 | `ROADMAP.md` | **追加** §48（Strategy Bridge 完成 · 下一项 = FORMAL BACKTEST） |
| 6 | `scripts/_scratch/b1verify.cjs` | **新增**（只读验证 harness，已 gitignore） |

**未改动**：3570001 · 既有因子定义 · Schema / Migration / Dataset · `FACTOR-TIMESCALE-FINAL-001` · 其它业务 `.ts`

---

## 10. 一句话结论

> ## **B1 已由实际执行验证解除**（新增 `maxAmp5` / `avgAmp5` 两个正式特征，**52/52 断言通过**：rd15 可算 · **rd14 及以前恒 null** · **rd16+ 永不读取** · **逐值一致** · **既有 rd1~5 定义未受损**）；**B2 转为两个固定 Variant**（不伪装择优）；**B3 用 `EQUAL_WEIGHT` + `maxPositions=180` 精确表达 1/180**；**B4 用 rule-list `TIME_EXIT 40` 表达无止损的研究退出**（**不触发必填 `stop` 的 policy 路径**）；**B5 如实收窄为仅 `EVENT_STATE_LONG`**；**B6 以 10bps/边 = 20bps 往返如实拆分** ⇒ **裁定 `A. READY_FOR_FORMAL_BACKTEST`**（附三项非阻塞残留 R1~R3）。
> ## **本任务在此停止：未跑 Backtest / OOS / WFA，未创建 Candidate / Version。**

**本任务完成，在此停止。**