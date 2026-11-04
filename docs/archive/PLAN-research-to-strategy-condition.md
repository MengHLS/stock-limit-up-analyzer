# 方案：打通「研究测算条件 → 策略条件」链路

> 状态：**方案（待批准，未实施）** ｜ 2026-09-13 17:57 GMT+8
> 触发：用户「这上面的问题都需要解决，给出解决方案」
> 证据：`docs/evidence/_probe_gap_analysis.mts` / `_probe_research_to_condition.mts` / `_probe_observe5_buy.mts`（均只读）
> 追溯：`ROADMAP-CHANGELOG.md` §「追加（17:57）」；同日前序 17:29 / 17:39 / 17:44 三条

---

## 0. 先把「问题」定死（实查，非推断）

用户要的策略：**T 日首板 → 未来 5 日为观察日 → 观察日满足条件就买入**。

实查结论：**策略表达式已就绪，研究能力也够，但两者之间的一公里没铺**。共 **3 处缺口**，按依赖顺序排列：

| # | 缺口 | 代码坐标 | 严重度 |
|---|---|---|---|
| **1** | **观察日变量为 0** —— 研究变量 17 个特征**全部只读 `event` + `prefix`（≤ T）**，没有任何一个能表达「观察日 T+k 当天」的属性 | `server/researchEngine/variables.ts:145-330`（`FIXED_FEATURE_VARIABLES`，全部只有 `prefixRelativeDays`） | 🔴 **阻断** |
| **2** | **词表不同源** —— 研究侧 `pre_return_5d` / `turnover` ≠ 策略侧 `prefix.rd0.close` / `bar.low`，中间无映射层 | 研究侧 `variables.ts`；策略侧 `strategySchema/definition.ts:242-248` | 🔴 高 |
| **3** | **结论不自动填草图** —— `createFromConclusion` 的 5 个草图列**只来自可选 `input.overrides`**，结论 `evidence` 只带统计判定 | `strategyCandidate/service.ts:633-648`；`router.ts:95` | 🟡 中 |

**附带发现（缺口 0，与本需求同源）**：`RESEARCH_ANALYSIS_TYPES` 声明 **12 种**，实际注册执行器 **6 种**（`descriptive` / `eventStudy` / `quantile` / `conditional` / `stability` / `segmentRelation`）——**`PATH` / `REGIME` / `DISTRIBUTION` / `CORRELATION` / `IC` / `SIGNIFICANCE` 未实现**（`analyses/registry.ts:60-65`）。其中 **`PATH` 恰是「按 T+k 逐日看路径」的分析类型**，缺口 1 修好后就需要它。

---

## 1. 为什么缺口 1 是「阻断」而非「麻烦」

策略条件的正确表达（已实测确认）：

```
entry.observationWindow = { start: 1, end: 5, unit: "TRADING_DAY" }
entry.trigger           = FIRST_VALID_DAY
entry.conditions        = [ bar.low >= prefix.rd0.open, ... ]
```

`bar.*` 指**当前正在判定的那个观察日**（`kind: "currentBar"`）。而研究侧要回答「`bar.low >= prefix.rd0.open` 这个条件值不值得用」，必须能**在观察日这个时点上做统计**。

但研究侧现有 17 个特征变量**没有一个**能表示「观察日当日」——
- `pre_*` 系列全是 `prefix.rd ≤ 0`（事件日及之前）；
- `event_*` 系列是事件日列；
- `is_one_word_*` 是事件日形态。

⇒ **「观察日缩量」「观察日回踩到首板日开盘价」这类条件，今天在数据上根本测不出来。** 这就是缺口 1 被定为「阻断」的原因：**不是不好用，是测不了**。

---

## 2. 解决方案（三段，按依赖顺序，可分次交付）

### P1 —— 补齐「观察日变量」（缺口 1，阻断项）

**做什么**：在 `variables.ts` 新增一族**窗口内逐日变量**，与既有 `FEATURE` / `OUTCOME` 并列，语义上属于「第 k 个观察日」——即「条件在该日求值时可见的数据」。

**关键设计：这不是新增 PIT 风险，而是把已有分层显式化。**
`ds_*` 的 `prefix`（≤T）与 `post`（≥T+1）已把时间层编码进表。观察日变量 = **从 `post` 的 rd=k 那根 bar 取数，并声明 `availableFromOffset = k`**（该值最早在 T+k 收盘可观测）。

```
新增角色：OBSERVATION（第 k 个观察日）
变量命名：obs_{k}d.{open|high|low|close|volume|amount}
          obs_{k}d.return_from_event_close   （= post.rd{k}.close / prefix.rd0.close − 1）
          obs_{k}d.volume_ratio_5d           （相对前 5 日均量）
          obs_{k}d.holds_event_low           （是否未破首板日最低价，复用在 outcome 侧已验证的口径）
```

**必须遵守的三条纪律**：
1. **`availableFromOffset` 必须落地**：变量携带「最早可观测偏移」，`CONDITIONAL` / `PATH` 在用它筛样本时必须校验 `availableFromOffset <= 观察窗口终点`，否则就是**事后筛选冒充信号**（与既有 `holds_event_low_*` 的注释同一纪律）；
2. **不得并入 `FEATURE_VARIABLES`**：`FEATURE` 的 `resolve` 只能拿到 `FeatureSources`（类型级互斥），把观察日变量塞进去会**在编译期破坏 PIT 防线**；
3. **`ds_*` 表零改动**：`post` 已有 rd∈[1,20] / 471,816 行全部 OHLCV，**不需要迁移、不需要重新构建数据集**。

**依赖**：无。可独立交付。

---

### P2 —— 新增「观察日条件」分析能力（缺口 0 + 1 的收口）

**做什么**：让研究实验能回答「**在观察窗口的第 k 日，满足 X 条件的子样本，后续表现如何**」。

两条路，**建议选 A**：

**A. 扩展 `CONDITIONAL`（推荐，改动小、语义正交）**
`CONDITIONAL` 的输入已经是结构化条件集，只需让条件字段能引用 P1 新增的观察日变量，并在配置里增加一个 `evaluationOffset`（在哪个观察日上求值）。输出结构不变（条件样本 vs 全样本 + Welch t/p）。

**B. 实现 `PATH` 执行器（在 A 之后按需）**
`PATH` 的本意就是「按 T+k 逐日看路径」。它更适合回答「**哪天买最好**」这类扫描式问题。但它目前**未实现**（缺口 0），且与 A 有大范围重叠 ⇒ **建议等 A 跑出真实需求后再做**，避免为假设的需求先造一个执行器。

**必须遵守**：
- 新增分析类型/能力必须走 `analyses/registry.ts` 的注册表，**未注册即 `UNKNOWN_ANALYSIS_TYPE` 响亮失败**；
- 条件集为空 ⇒ `INVALID_ANALYSIS_CONFIG`（**不静默退化成「等于全样本」**，沿用既有纪律）；
- 结论判定仍由 `ConclusionBuilder` 按预设规则做，**执行器不自行声称「显著」**。

**依赖**：P1。

---

### P3 —— 词表映射 + 候选草图建议值（缺口 2 + 3）

**做什么**：把研究结论的条件，**翻译**成策略字段引用，并以**建议值**形式送进候选草图。

**3.1 映射层（缺口 2）**
新建一张**双向映射表**（单一 SoT，放 `server/**`，客户端只读镜像）：

| 研究变量 | 策略字段引用 | 说明 |
|---|---|---|
| `turnover` | `event.turnover` | 事件日列，1:1 |
| `limit_up_premium` | `event.limitUpPrice` / `event.previousClose` | 需派生 |
| `pre_close` | `prefix.rd0.close` | 1:1 |
| `event_low_offset` | `prefix.rd0.low` / `prefix.rd0.close` | 需派生 |
| `obs_{k}d.low` | `bar.low`（在 rd=k 的观察日） | 需带偏移 |
| `holds_event_low_h` | **不可映射**（属 OUTCOME，作信号条件必被 `labelOnly`/前视规则拒绝） | **必须显式标注为不可映射** |

🔴 **纪律**：映射**不是全覆盖**。`OUTCOME` 族（`max_return_h` / `holds_event_low_h` …）**天然不可作信号条件**，映射表必须**显式列为不可映射并说明原因**，禁止「尽力猜一个」。

**3.2 建议值送进草图（缺口 3）**
`createFromConclusion` 增加一条**显式**路径：读取来源结论的 `CONDITIONAL` 条件集 → 经 3.1 映射 → 生成 `entryRule` 的**建议草稿**。

🔴 **三条不可让步的约束**：
1. **只产出建议，不自动落库** —— 仍由人确认后保存（人是闭环里的确认环节）；
2. **不可映射的项必须如实报出**，例如「条件 #3（`holds_event_low_5d ≥ 1`）来自 OUTCOME 族，是事后筛选，不能作为买入条件」——**不静默丢弃、不降级猜测**；
3. **不得新增第二个 Candidate → Strategy 入口**，`promote` 仍是唯一 `CONVERTED` 通道。

**依赖**：P1（观察日变量）+ P2（条件能被测算）。

---

## 3. 交付顺序与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1** | 观察日变量族 + `availableFromOffset` | `tsc` exit 0；新增变量单测（含「`availableFromOffset` 超出窗口即拒」）；`vitest` 失败集合 = 基线 |
| **P2** | `CONDITIONAL` 支持观察日求值 | 真实库跑通一次「观察日条件 vs 全样本」；结论落库；`tsc` / `vitest` / `vite build` 三件套 |
| **P3** | 映射表 + 草图建议值 | 映射表**对表测试**（防漂移）；不可映射项**必被报出**的单测；端到端：真实结论 → 候选草图建议 → 人确认 → `promote` |

**每阶段结束必须**：更新 `ROADMAP.md` §44（覆盖式）+ §44.5（队列）+ `ROADMAP-CHANGELOG.md`（append-only）。

---

## 4. 风险与边界（诚实登记）

1. 🔴 **改 `server/**` 会热重启并杀死在途研究 Run** ⇒ 动手前必须只读查 `research_runs` 有无在途；P1/P2/P3 **全部涉及 `server/**`**，须避开用户在跑任务的时段。
2. ⚠️ **P2 的「观察日求值」有事后筛选风险** —— 在 T+5 才知道「T+3 那天缩量」很容易滑向「用已知结果挑样本」。**`availableFromOffset` 校验是唯一的防线**，必须在 P1 就落地，不能留到 P2。
3. ⚠️ **`market_cap` / `float_market_cap` 实测不可用**（上游 `liquidity_daily` 该列为 NULL）⇒ 任何依赖市值的条件**今天测不了**，映射表应标注。
4. ⚠️ **不建议同时做 P1~P3** —— 一次只交付一段，每段独立可验证。三件事耦合在一起出问题时会难以定位。
5. ⚠️ **`ds_*` 表与数据集版本零改动** —— 本方案**不需要**迁移、不需要重建、不需要重新构建数据集。若有人提出「先重建数据集」，**那是走错方向**。

---

## 5. 最小验证路径（建议先走这一步，成本最低）

在动 P1 之前，**先用人工方式验证策略本身是否成立**：
1. 用户用大白话给出「几项条件」（如「观察日收盘价不低于首板日开盘价」+「观察日缩量」）；
2. 直接把这几项写成 `entry.conditions`（`bar.*` vs `prefix.rd0.*`），建一个候选草图；
3. 走 `promote` 转正 + 运行工作台直读 390002 跑一次（**6.2s 那条快路径**）。

**如果这一步就跑出正收益** ⇒ 说明方向对，再投 P1~P3 把人工环节自动化。
**如果条件不显著** ⇒ 省下 P1~P3 的全部工作量，先改条件假设。

> 这一步**零 `server/**` 改动**（只写候选数据 + 跑一次运行），风险最低，且能立刻检验策略。

---

## 附：实查原始数据

```
声明 12 种分析 / 已实现 6 种
未实现: DISTRIBUTION / CORRELATION / IC / PATH / REGIME / SIGNIFICANCE

FEATURE 变量 17 个 —— 全部只读 event + prefix（≤ T）：
  turnover / previous_close / limit_up_price / limit_up_premium /
  days_since_previous_limit / historical_limit_count /
  market_cap / float_market_cap（后两个上游 NULL，实测不可用）/
  pre_close / pre_return_5d / pre_return_20d / pre_volatility_20d /
  pre_volume_ratio_5d_20d / event_low_offset / event_open_offset /
  is_one_word_open / is_one_word_hold
🔴 观察日（T+k）当日 bar 属性变量数 = 0

策略侧字段引用四形态：bar.*(currentBar) / prefix.rdN.*(preEvent) /
                      event.*(eventDay) / post.rdN.*(forwardBar)
前视约束：post.rd{n} 仅当 n <= earliestSignalOffset 放行
          （window 1..5 + FIRST_VALID_DAY ⇒ 上限 = T+1）
```
