# 组合回测 vs 前向纸面：止损策略一致性审计（STOPLOSS-PARITY-AUDIT-001 · `9bd`）

> 触发：用户提问「审计组合回测与前向纸面交易中使用的止损策略，重点分析两者在止损逻辑、触发条件、执行结果上是否存在偏差或异常」。
> 审计日期：**2026-09-18**。基线提交：**`4c7250f`**（与远端 `origin/main` 逐位一致，远端无新提交）。
> 性质：**只读审计 + 只读探针**。本轮**未改动任何 `server/**` / `client/**` 源码**，也**未写任何库内数据**。

---

## 0. 结论摘要

**两套链路都自称遵循同一套「唯一退出策略」，但实际不等价。** 找到 5 项偏差，其中 1 项为结构性缺陷（有硬证据、会改变成交价与是否出清），2 项为口径/文案失真，2 项为潜在风险。

| 编号 | 偏差 | 性质 | 证据强度 |
|---|---|---|---|
| **D1** | 前向纸面**完全没有「开盘阶段止损」**，组合回测有 | 🔴 结构性缺陷 | 探针 12/12 断言 + 真库出清分布 |
| **D2** | 纸面运行的止损参数**恒为服务端硬编码缺省**，页面不传、也不展示 | 🔴 口径漂移 | 真库 4 条运行 `realistic` 仅含 `initialCapital` |
| **D3** | 组合回测页「回测总览」面板由生产引擎（`hold-while-selected`，**无止损**）产出，却回显止损参数，且卡片正文断言存在「开盘止损释放资金」 | 🟠 文案/口径失真 | 源码 + UI 文案对拍 |
| **D4** | 纸面在「一字跌停延期」「收盘行情缺失」时不写原因 | 🟡 观察性缺口 | 源码对拍 |
| **D5** | 纸面 `tradingDateIndex.get(today) ?? 0` 兜底：日期不在日历时静默永不出清 | 🟡 潜在风险 | 源码推演（未复现） |

---

## 1. 审计范围与方法

**范围**：两条链路里**实际执行**止损那一层的代码 —— 组合回测侧 `server/realisticBacktest.ts#simulateRealisticTPlus1ToTPlus2`（经 `server/research/legacyTransactionSimulator.ts` 单出口暴露），前向纸面侧 `server/paperTrading.ts#advancePaperTradingDay`。

**方法**（三步，不靠读码推演下结论）：

1. **静态对拍**：把两份实现的退出段落逐行并排读，列出分支、顺序、条件、参数来源。
2. **同路径实证**：新写只读探针 `docs/evidence/_probe_stoploss_divergence.mts`，用**同一条价格路径**分别喂两套实现，逐字段比对 `exitDate / exitPrice / reason`。12 条断言**全部通过**（断言方向为「偏差存在」）。
3. **真库取证**：新写只读探针 `docs/evidence/_probe_paper_run_params.mts`，读 `paper_trading_runs` 的实际参数快照与出清原因分布。

---

## 2. 事实基线：同一仓库里并存三套「止损」语义

这是所有偏差的土壤：**「止损」在这个仓库里有三个互不相通的落点。**

| # | 落点 | 止损是否真的执行 | 谁在用 |
|---|---|---|---|
| ① | `realisticBacktest.ts`（研究-legacy 模拟器） | ✅ **真执行**：开盘止损 / 收盘止损 / 动态回撤止盈 / 强势续持 / 最多持有 N 日（+ 可选盘中止损） | 组合回测页的**研究-legacy 快照面板**（当前持仓 / 准备买入 / 全部模拟订单 / 策略对比 / 风险归因）、下行风险研究、`paramSearch` |
| ② | `paperTrading.ts`（前向纸面） | ⚠️ **部分执行**：只有收盘止损 / 动态回撤止盈 / 强势续持 / 最多持有 N 日（+ 可选盘中止损）；**没有开盘止损** | `/paper-trading` 页面 |
| ③ | `server/engine/**`（生产 Strategy Engine） | ❌ **完全不执行**：退出模式固定为 `hold-while-selected`（持仓不再入选当日候选池即卖出，见 `leaderCandidateStrategyBacktest.ts:49-50`） | 组合回测页顶层的「**回测总览**」资金与仓位审计 |

**证据**：`grep -rn "stopLoss" server/engine server/risk` ⇒ **0 命中**（`server/engine/domain.ts:123` 仅在注释里提到「止损」这个标签名）。`server/engine` 目录下「止损」二字只在那一行注释里出现。

> 🔴 关键点：`leaderCandidateStrategyBacktest.ts:79-81` 的注释把这件事说得很清楚 ——
> *"legacy 默认值解析（**仅用于在 `RealisticBacktestResult.assumptions` 中回显输入口径**，与实际执行语义由新引擎决定——引擎的 cost/sizing/risk 才真正生效）"*。
> 也就是说，**止损参数（含 `exitStrategy: "riskManagedHold"`）在引擎路径下只是一串被回显的数字**。

---

## 3. 偏差逐项分析

### D1 · 前向纸面缺失「开盘阶段止损」（结构性缺陷）

**组合回测**（`realisticBacktest.ts:352-373`）在每个事件日先跑一个**开盘阶段循环**：

```
for (const date of eventDates) {
  // 开盘：先处理已有仓位的开盘止损，再处理新买入；同日收盘出清资金不可提前参与开盘买入。
  for (const [key, position] of Array.from(positions.entries())) {
    if (!position.row.secondDayDate || date < position.row.secondDayDate) continue;
    const openReturnPercent = ((marketOpenPrice - position.entryPrice) / position.entryPrice) * 100;
    if (openReturnPercent <= -stopLossPercent) {   // ← ① 开盘跳空破位
      if (blockLimitDownSells && opensAtLimitDown) { /* 延期 */ continue; }
      settlePosition(key, position, date, marketOpenPrice, `开盘触发止损（${round(openReturnPercent)}% ≤ -${stopLossPercent}%）`);
    }
  }
  // ……之后才是当日开盘买入
```

**前向纸面**（`paperTrading.ts:501-585`）**只有收盘阶段**：

- 开盘唯一的用途是**判定一字跌停**（`paperTrading.ts:521/534/539-541`），`marketOpenPrice` 从未参与止损比较。
- 硬指标：`grep -c "openReturnPercent" server/paperTrading.ts` = **0**；`grep -c "开盘触发止损" server/paperTrading.ts` = **0**（回测侧 = 3）。

**触发条件差异**

| | 组合回测 | 前向纸面 |
|---|---|---|
| 开盘价 ≤ 建仓价×(1−止损%) | 立即按**开盘价**出清 | **无此判定** |
| 收盘价 ≤ 建仓价×(1−止损%) | 按**收盘价**出清 | 按**收盘价**出清（一致） |
| 盘中最低价触及止损价（需开启开关） | 按**止损价**出清 | 按**止损价**出清（一致） |

**执行结果差异**（探针实测，零费用零滑点，建仓价 10.00、止损 5% ⇒ 止损价 9.50）：

| 场景 | T+2 价格路径 | 组合回测 | 前向纸面 |
|---|---|---|---|
| **1** | 开 9.40（−6%）→ 盘中 9.30 → **收 10.60（+6%）** | 开盘出清 **9.40**（−6%） | **完全不出清** —— 收 +6% 满足强势续持，期末仍持有 10,000 股 |
| **2** | 开 9.40（−6%）→ **收 9.20（−8%）** | 开盘出清 **9.40** | 收盘出清 **9.20** ⇒ 同一笔成交价低 **2.13%** |
| **3·对照** | 开 9.80 → 盘中 9.30 → 收 9.60（开启盘中止损） | 9.50 | 9.50 ⇒ **一致** |

**为什么这不能算「合理简化」**（三条独立理由）：

1. **页面明文承诺**：`Backtest.tsx:691` 的风控卡片正文写「从T+2起：**开盘触发止损即按开盘出清**」。
2. **模块自述与实现相反**：`paperTrading.ts:28` 写「**成交与退出规则镜像 realisticBacktest**，保证前向曲线与回测口径可比」。
3. **前向纸面的存在意义就是口径可比**：它是「真实样本外兜底历史回测」（`PaperTrading.tsx:120` 页面文案）。漏掉一个会**改变是否出清**的分支，等价于把「样本外验证」建成了一把刻度不同的尺。

**偏差方向**：**双向、不可先验判定** —— 场景 1 里纸面「更赚」（没在恐慌盘卖出），场景 2 里纸面「更亏」（多跌 2% 才出）。这不构成系统性乐观或悲观偏差，而是**方差放大**：纸面的退出时点被推迟到收盘，尾部更厚。

---

### D2 · 纸面运行的止损参数恒为硬编码缺省（口径漂移）

**链路**：

```
client/src/pages/PaperTrading.tsx:106
  createMutation.mutate({ label, strategyKey, initialCapital })      ← 只传 3 个字段，无 options
        ↓
server/routers.ts:1416   options: backtestOptionsSchema.optional()    ← 可选，缺省 {} 
        ↓
server/db.ts:2716-2718   normalizePaperTradingOptions → realistic 只被塞进 initialCapital
        ↓
server/paperTrading.ts:321-331   realistic.stopLossPercent ?? 5 / trailingProfitActivationPercent ?? 6 / …
```

**真库取证**（`_probe_paper_run_params.mts`，4 条现存运行）：

```
#90002 质量复合评分·前向纸面   paramsJson 顶层键 = ["realistic"]   realistic 实际键 = ["initialCapital"]
#90001 质量复合评分·前向纸面   同上
#30001 风险扣分策略·前向纸面   同上
#1     原始策略·前向纸面       同上
  生效的退出参数：stopLossPercent = （缺省） / trailingProfitActivationPercent = （缺省） / …（7 项全缺省）
```

⇒ **没有任何一条纸面运行带过自定义止损参数**，全部按 `stopLossPercent=5 / trailingProfitActivationPercent=6 / trailingDrawdownPercent=3 / strongHoldMinReturn=3 / maxHoldingDays=5 / enableIntradayStopLoss=false / blockLimitDownSells=false` 运行。

**对比组合回测**：`Backtest.tsx:406-410` 有一套完整可编辑的风控参数（默认值恰好也是 6/3/5/3/5，但**用户可改**，`:689-691` 是 UI 控件）。

**后果**：用户在回测页把止损从 5% 改成 8%，前向纸面**仍按 5% 运行**，且页面上**没有任何地方能看到生效参数**（`grep "realistic\|stopLoss\|trailing" client/src/pages/PaperTrading.tsx` ⇒ **0 命中**）。于是「回测 vs 纸面」的差异会被归因成「样本外表现不同」，实际可能是**参数根本没对上**。

**探针另证**（场景 4）：同一价格路径（同场景 1）下，回测止损 5% ⇒ 开盘出清 9.40；回测止损 8% ⇒ 不出清（收 +6% 转强势续持）。**参数改一格，退出结论就翻面** —— 而纸面永远停在 5%。

---

### D3 · 组合回测页「回测总览」的止损口径与文案失真

`Backtest.tsx:701`（「回测总览」→ 资金与仓位审计卡片）正文：

> 「峰值持仓 … 最低可用现金 …。**开盘止损释放的资金仅在同一开盘时点后参与候选排序；收盘出清资金不提前复用。**」

但该卡片的 `simulation` 来自**生产引擎**结果（`leaderCandidateStrategyBacktest.ts:232` 的 `adaptEngineResultToRealisticBacktestResult`），引擎退出模式是 `hold-while-selected` ——**该链路上一次止损都不会发生**。这句「开盘止损释放的资金……」描述的是一个**在这条链路里不存在**的机制。

同时 `simulation.assumptions`（`:202 resolveAssumptionDefaults`）把 `stopLossPercent / trailingProfitActivationPercent / exitStrategy` 一并回显 —— **数字来自 legacy 默认值解析，不代表引擎行为**（源码注释自己写明了）。

**影响**：读者会把「回测总览」的收益/回撤理解成「带 5% 止损的风控结果」，实际是「持仓到跌出候选池为止」的结果。这与上一轮（`9bc`）加的 `[data-portfolio-provenance]` 徽标解决的问题同源 —— 徽标只标了**快照面板**的 provenance，**总览面板本身没有**[1]。

[1] 上一轮已就两段非等价在页面加了徽标（`Backtest.tsx:702`），但那只覆盖「当前持仓 / 准备买入」快照面板；本条的失真点在 `:701` 的资金与仓位审计卡片。

---

### D4 · 纸面的退出「无原因」（观察性缺口）

| 情形 | 组合回测 | 前向纸面 |
|---|---|---|
| 一字跌停延期（`blockLimitDownSells`） | 写入原因：`"T+2一字跌停，按严格规则延后至下一实际交易日"` / `"连续一字跌停…"` / `"一字跌停，保守成交概率N%未命中…"`，且会拼接在既有原因后（`realisticBacktest.ts:604-611`） | **不写任何原因**（`paperTrading.ts:554-558` 只更新 `previousClosePrice` 后 `continue`） |
| T+2 收盘行情缺失 | 写入 `"T+2收盘行情缺失，等待下一实际交易日"`（`realisticBacktest.ts:562-565`） | **不写任何原因**（`:516-520` 静默顺延） |

**后果**：纸面订单的 `reason` 会长时间停在 `null`，「出清说明」栏目的 `holding.reason ?? "持仓中，等待下一实际交易日按退出规则判断。"` 会掩盖「其实是被一字跌停卡住了」这一关键事实。

---

### D5 · 纸面日历索引兜底（潜在风险，未复现）

`paperTrading.ts:334`：`const todayIndex = tradingDateIndex.get(today) ?? 0;`
`paperTrading.ts:509`：`const eligible = todayIndex > position.entryTradingDateIndex;`

若 `today` 不在传入的 `tradingDates` 里 ⇒ `todayIndex = 0` ⇒ `eligible` 恒为 `false` ⇒ 该持仓**在当日静默永不出清**（连止损也不会触发），且不会有任何告警。

当前调用方（`db.ts:2862` 用 `tradingDates.filter(...)` 生成推进集合）保证了 `today ∈ tradingDates`，所以**目前不会触发**。但这是一个「非法输入 ⇒ 静默错误语义」的兜底，与项目里其他位置（如 `PaperTradingCalendarStaleError`）「宁可响亮失败」的既有纪律不一致。

---

## 4. 执行结果偏差的量化小结

| 维度 | 组合回测 | 前向纸面 | 是否一致 |
|---|---|---|---|
| 止损基准价 | `entryPrice`（含滑点的实际成交价） | `entryPrice`（同） | ✅ |
| 止损价 | `entryPrice × (1 − stopLossPercent/100)` | 同 | ✅ |
| 开盘止损 | `open ≤ 止损价`（自 T+2 起，开盘阶段先于买入） | **不存在** | ❌ **D1** |
| 盘中止损 | `open > 止损价 且 low ≤ 止损价` ⇒ 按止损价成交 | 同 | ✅ |
| 收盘止损 | `close ≤ 止损价` ⇒ 按收盘价成交 | 同 | ✅ |
| 动态回撤止盈 | 先按**最高收盘价**算 `peakReturn ≥ 启动浮盈` 才置 `trailingArmed`，再看自峰值回撤 | 同 | ✅ |
| 强势续持 | `closeReturn ≥ 续持阈值 且 close ≥ 前收` | 同 | ✅ |
| 最多持有 N 日 | `holdingDays ≥ maxHoldingDays`（`holdingDays` 定义相同） | 同 | ✅ |
| 一字跌停延期 | 延期 + 写原因 + 概率成交 | 延期、**不写原因**、概率成交（哈希种子语义等价） | ⚠️ D4 |
| 一字跌停卖出概率种子 | `${code}::${nextDayDate}::${date}` | `${code}::${entryDate}::${today}` | ✅ 等价（`nextDayDate === entryDate`，见 `realisticBacktest.ts:316` 按 `nextDayDate` 分组） |
| 参数来源 | UI 可编辑 | 服务端硬编码缺省 | ❌ **D2** |
| 真库落地 | — | 4 条运行 / 10 笔已出清：**8 笔「…强势续持…」、2 笔「收盘触发止损」、0 笔「开盘触发止损」** | ❌ 与 D1 互证 |

> 真库那 10 笔里「开盘触发止损 = 0」**不能**单独证伪 D1（样本太小、且本来就是回测独有分支），但它与静态审计、探针结论**三者同向**。

---

## 5. 成因定位（根因链）

1. **两份实现是「人手抄写」而非「同源构造」** —— `realisticBacktest.ts` 与 `paperTrading.ts` 各写了一份退出状态机，没有共享的「退出规则内核」。项目在**分仓**上已经做过同类治理（抽出 `server/positionBudget.ts#allocatePlannedBudgets` 作唯一权威），**退出规则当初没跟上**：`paperTrading.ts:374-386` 至今内联着第二份分仓实现（上一轮 `9bc` 已登记为待收敛项）。
2. **纸面是「按天增量推进」的状态机**，而回测是「先枚举全部事件日再逐日模拟」。搬退出规则时，纸面把「开盘」这一整段简化成「只用来判定一字跌停」——**开盘止损的分支在搬运时被整体丢掉**，且没有测试钉住（`tests/server/paperTrading.test.ts` 只有「收盘触发止损」1 例，见 `:219-233`；回测侧则有 5 例开盘止损断言）。
3. **参数没有从「人」流到「机器」** —— 纸面创建入口把 `options` 设为可选，前端不用，于是「纸面镜像回测口径」在**参数层面**就已经断了；页面也从未展示生效参数，缺陷因此不可见。
4. **同一页面三条交易语义共存** —— `hold-while-selected`（引擎）与 `riskManagedHold`（legacy）在同一页并列，UI 文案与 provenance 标注只覆盖了一部分，于是 D3 这类「数字对不上、文案又在说另一件事」的失真得以存在。

---

## 6. 改进 / 修复方案（可选，按代价从低到高）

### 方案 A（推荐，最小改动）· 给纸面补上开盘止损，抽公共内核

- **A1 补分支**：在 `paperTrading.ts` 的「开盘成交既有清单」**之前**插入开盘止损循环（必须在前 —— 回测里开盘止损释放的现金可以参与同日开盘买入，见 `realisticBacktest.ts:375-376` 的 `equityAtEntry` 注释）：

  ```ts
  // 开盘阶段：先处理已有仓位的开盘止损（与 realisticBacktest 同序）
  for (const position of positions) {
    if (todayIndex <= position.entryTradingDateIndex) continue;   // 建仓当日不做退出
    const dayPrice = priceByStockDate.get(`${position.stockCode}::${today}`);
    const openPrice = dayPrice?.openPrice ?? null;
    if (!validPrice(openPrice)) continue;
    const openReturnPercent = ((openPrice - position.entryPrice) / position.entryPrice) * 100;
    if (openReturnPercent > -stopLossPercent) continue;
    // 与收盘段同口径：一字跌停且开启限制 ⇒ 延期（并写原因，顺带修 D4）
    if (blockLimitDownSells && isOneWordLimitDownAtOpen(...)) { 记录延期原因; continue; }
    settlePosition(position, today, openPrice, `开盘触发止损（${round(openReturnPercent)}% ≤ -${stopLossPercent}%）`);
  }
  ```
- **A2 抽内核**（可选，与 A1 同时做更佳）：把「止损价 / 峰值回撤 / 强势续持 / 持有上限」的**纯判定**抽成一个无状态函数（例如 `server/research/exitRuleCore.ts#evaluateExit(...)`），两端各自只负责「取价 + 结算」。这样 D1/D4 这类漂移**结构上不可能再发生**。
- **代价**：`server/**` 改动（会热重启，**须确认无在途 Run**）；改完纸面历史运行的后续推进结果会与之前不同（见「风险」）。
- **风险与取舍**：纸面状态是**逐日推进并落库**的（`stateJson` 快照），补分支**不能回溯**已走过的日子 ⇒ 要么 ① 新建运行从头跑（推荐，口径干净），要么 ② 接受「此日之后一致、之前留档」。**这个策略选择需要你定**。

### 方案 B · 参数贯通 + 可视化

- **B1**：`PaperTrading.tsx` 增加风控参数卡（复用 `Backtest.tsx:689-691` 的控件形态），或提供「从当前回测配置继承」按钮，把 `options.realistic` 真正传下去。
- **B2**：纸面详情页回显**生效参数**，并把「缺省」显式标注出来（例如 `止损 5%（缺省）`）。
- **B3**：后端在创建时把 `options` 的缺省补齐后落库（让 `paramsJson` 是**完整快照**而非只含 `initialCapital`），避免「事后无法判断当初用了什么」。
- **代价**：纯 `client/**` + 一行后端**无需改动**（`options` 已在 schema 里）。若只做 B1+B2，**server 零改动**，最安全。

### 方案 C · 契约测试（强烈建议，无论选不选 A）

新增 `tests/server/exitRuleParity.test.ts`：用**同一条价格路径**同时跑 `simulateRealisticTPlus1ToTPlus2` 与 `advancePaperTradingDay`，逐字段断言 `exitDate / exitPrice / reason 关键字` 一致。至少覆盖：

1. 开盘跳空破位 + 当日收回（当前会**红**，修好 A1 后**绿**）
2. 开盘跳空破位 + 续跌
3. 仅盘中破位（开/收都在止损上方）
4. 峰值回撤止盈启动与不启动
5. 强势续持 / 达到最多持有日
6. 一字跌停延期（含概率成交开关）

**这是把 D1 从「靠人记得」变成「机器保证」的唯一手段**，且成本低（纯 `tests/**`，不动 `server/**`）。

### 方案 D · 文案与 provenance 修正（低成本，独立可做）

- **D-1**：修正 `Backtest.tsx:701` —— 把「开盘止损释放的资金仅在同一开盘时点后参与候选排序」改为如实描述，或**把这张卡片也标注 provenance**（它来自生产引擎，退出模式 = `hold-while-selected`，无止损）。
- **D-2**：`assumptions` 里的止损类字段标注「仅研究-legacy 段生效；生产引擎按 `hold-while-selected` 退出」。
- **D-3**：若暂不修 D1，则**先修 `paperTrading.ts:28` 与 `PaperTrading.tsx:120` 的自述文案**，如实写明纸面暂无开盘止损 —— 「如实标注」远好于「安静地不一样」。

### 方案 E · 口径统一（架构级，需单独授权）

让「回测总览」与「快照面板」可比：要么给生产引擎也实现 `riskManagedHold` 退出（工作量大，且会改变全部既有生产回测数值），要么让总览也走 legacy 模拟器（会与「生产引擎是唯一生产口径」的既有边界冲突）。**本条不建议顺手做**，只作为路线图备选。

### 方案 F · 对齐止损默认值的三处声明

`server/research/patternLibrary/executionAssumptions.ts:44,67` 声明 `stopLoss: 0.08`（**8%**），而两个模拟器的缺省都是 **5%**。该默认值会经 `projectCandidateSketch` 铺进候选草图，再经 promote 进入策略文档的 `exitRules`。**而生产引擎并不消费 `exitRules`**（`server/engine` 零 `stopLoss` 引用）⇒ 目前它**不产生行为差异，只产生「文档声称 8%、实际跑 5%（或完全不跑）」的口径错配**。建议：明确「哪个数是权威」并让三处对齐，或在文档层标注「研究草图的默认执行假设，不被生产引擎消费」。

---

## 7. 建议的验收判据（若实施 A/B/C/D）

| 项 | 判据 |
|---|---|
| D1 已修 | `exitRuleParity.test.ts` 6 个场景全绿；`grep -c "开盘触发止损" server/paperTrading.ts` ≥ 1 |
| D1 已修（真机） | 新建一条纸面运行并推进 ≥ 1 个交易日，其「全部模拟订单」中出现过 `开盘触发止损` 关键字（需先出现一次跳空破位样本，属机会性） |
| D2 已修 | 新建纸面运行的 `paramsJson.realistic` **键数 ≥ 6**（不再是只含 `initialCapital`）；页面能看到生效参数 |
| D3 已修 | 「资金与仓位审计」卡片文案不再断言止损机制，或带 `[data-*-provenance]` 标注 |
| D4 已修 | 一字跌停延期的纸面订单 `reason` 非 `null` 且含「一字跌停」 |
| 回归 | `npx tsc --noEmit` = 0；全量 `vitest run` 失败文件集合与基线逐项一致（基线 = 8 failed 文件 / 17 failed 用例） |

---

## 8. 证据与复现

| 文件 | 内容 | 重跑 |
|---|---|---|
| `docs/evidence/_probe_stoploss_divergence.mts` | 4 场景 × 2 实现同路径对拍 + 源码静态断言，**12/12 通过** | `node_modules/.bin/tsx docs/evidence/_probe_stoploss_divergence.mts` |
| `docs/evidence/_probe_stoploss_divergence.out.txt` | 上者输出留档 | 随上者落盘 |
| `docs/evidence/_probe_paper_run_params.mts` | 真库只读：纸面运行参数快照 + 出清原因分布 | 同上（**需非沙箱**，本机出站受沙箱限制） |
| `docs/evidence/_probe_paper_run_params.out.txt` | 上者输出留档 | 随上者落盘 |

**关键复现命令**（静态层，不需要跑探针）：

```bash
grep -c "开盘触发止损" server/realisticBacktest.ts   # 3
grep -c "开盘触发止损" server/paperTrading.ts        # 0  ← D1
grep -c "openReturnPercent" server/paperTrading.ts   # 0  ← D1
grep -rn "stopLoss" server/engine server/risk        # 0  ← 引擎无止损
```

---

## 9. 未决问题（需要你定）

1. **D1 怎么修**：修（方案 A）还是先只改文案（方案 D-3）？若修，历史纸面运行是**新建重跑**还是**接受前后不一致**？
2. **D2 参数要不要贯通**：是否希望前向纸面默认继承回测页的风控配置？（涉及「纸面到底代表哪一套口径」的定义）
3. **D3 的「总览」面板定位**：是否要把「回测总览」也纳入 provenance 标注范围（当前只有快照面板有）？
4. **方案 F 的权威数**：止损默认值到底是 5% 还是 8%？

---

## 10. 边界声明

- 本轮**未改动任何源码**（`server/**`、`client/**` 零 diff），**未写任何库内数据**，**未启动服务**。
- 探针均为**只读**：`_probe_stoploss_divergence.mts` 不连库；`_probe_paper_run_params.mts` 仅 `SELECT`。
- 差值的量化建立在**零费用零滑点**的合成路径上，用于隔离退出规则本身；真机数值会叠加滑点与费用，但**「是否出清」的分叉不受费用影响**。
- `RESEARCH_READY` 未变 TRUE；本审计**不产出任何策略结论**，只产出工程口径结论。
---

## 11. 后续更新 · `9be`（2026-09-18 实施记录）

> 本节由 `9be` 追加，**不改写**前 10 节的历史结论（`9bd` 当时的事实仍然成立）。阅读顺序建议：先看本节，再回看第 3 节 D1。

### 11.1 用户决策（本轮开工前逐项确认，四问 + 三问）

| 议题 | 决策 |
| --- | --- |
| 「总仓位的 3%」分母 | **建仓时账户总权益**（现金 + 存续持仓按最近可见收盘估值，冻结在建仓那一刻）——与回测 `RealisticTrade.pnlToEquityRatio` 同源 |
| 判定时点 | **可配**：`open` / `close` / `both`（缺省 `both`）；作用范围 = 两条止损 + **动态回撤止盈** |
| 存量运行 | **也启用**（缺字段按「开盘+收盘 + 3%」解析 ⇒ **零写库**即生效） |
| 策略设置范围 | 退出与止损组 + 仓位组 + 交易约束开关组（三组全上页面） |
| 成交约束开关缺省 | **全部保持现状（关 / 0）** ⇒ 不勾选即与改动前行为完全相同 |

### 11.2 实施内容

**A. 纸面补上开盘阶段退出（修复 D1）** —— `server/paperTrading.ts`

- 阶段顺序改为**开盘①退出 → 开盘②买入 → 收盘退出**（🔴 顺序不可换：开盘止损释放的现金要能参与**同日开盘**买入；这也是回测 `realisticBacktest.ts:352-376` 的顺序）。
- 新增纯函数 `evaluateHardExitRules({phaseLabel, price, position, ...})`：单票比例止损 → **组合无条件止损** → 动态回撤止盈；开盘与收盘**共用同一函数**（同一套规则两个时点各判一次，不会各自漂移）。
- 退出原因前缀走**字面量表** `HARD_EXIT_PREFIX`，源码里能直接 grep 到「开盘触发止损」——跨文件对拍（`grep -c`）当初就是发现 D1 的方式，**可被 grep 的事实才是可审计的事实**。

**B. 新增「组合无条件止损」（纸面专属，用户要求）**

- 语义：单票浮亏（市值 − 建仓成本，含买入费用）达「建仓时账户总权益」的 N% ⇒ **无条件**出清（不受强势续持 / 回撤止盈已激活 / 最多续持未到豁免）。
- 缺省 **3%**，`0` = 关闭。**组合回测侧不存在该规则**（`grep -c "组合止损" server/realisticBacktest.ts` = 0），这是**用户明确要求的口径分叉**：只加纸面，以免改动回测后重算全部历史回测数值。
- 仍**受「一字跌停卖不出」这一物理约束**（守卫在调用方）：「无条件」指的是不受策略豁免，不是让交易所的跌停板失效；此时会把原因如实写到订单上（顺带补上 D4 在开盘分支的缺口）。
- ⚠️ 遗留持仓没有 `equityAtEntry`（2026-09-18 之前落库）⇒ 读取端（`db.ts#parsePaperTradingState`）**在持久化边界上**回落为初始资金，并注明这是近似值。**不散落在判定函数里**——否则「哪些持仓是近似的」在数据层就再也看不出来。

**C. 参数贯通 + 页面可视化（对应方案 B，部分修复 D2）**

- 新设置块放在 `options.paperTrading`（**不塞进 `realistic`**）：`realistic` 是与回测共用的参数容器，往里加只有纸面认识的字面量 = 制造「回测参数里躺着它不消费的字段」这类最难发现的漂移（D3 就是这么来的）。
- 缺省值只写一次：`resolvePaperRealisticOptions` / `resolvePaperTradingSettings` 由**推进逻辑与「生效参数面板」共用**。
- `PaperTrading.tsx`：新建运行表单补齐三组设置（含判定时点下拉、5 个成交可行性开关、10 个数值项），并在详情页新增「**该运行实际生效的参数**」面板，逐项标注「你设的 / 默认」。

**D. 测试（对应方案 C 的一部分）** —— `tests/server/paperTrading.test.ts`

新增 18 例（22 → 40），覆盖：建仓算术基线、组合止损收盘/开盘触发、三态时点差异、回撤止盈进开盘、阈值 0 关闭、一字跌停不假装出清、缺省解析、纯判定函数优先级与旧持仓兜底。**关键口径用「数值指纹」钉住**：`占建仓总权益 3.3%` 与「按成本算的 3.33%」可区分，分母被换掉会立刻失败。

### 11.3 D1~D5 现状（截至 `9be`）

| 项 | 状态 |
| --- | --- |
| **D1** 纸面缺开盘止损 | ✅ **已修**（可 grep：回测 3 / 纸面 >0；同路径 exitDate / exitPrice / reason 逐位一致） |
| **D2** 参数恒缺省且零展示 | 🟡 **部分修复**：创建时可传、页面可设、详情页展示生效值；**存量 4 条运行仍是缺省回落**（如实标为「默认」，不再假装） |
| **D3** 总览文案 / provenance 失真 | ⛔ **未动**（`grep -rn "stopLoss" server/engine server/risk` 仍为 0）——见事项 `rQ4upJ` |
| **D4** 延期不写 reason | 🟡 **部分修复**：开盘分支被跌停挡住时会写原因；收盘段的一字跌停延期仍未写——见事项 `rnJMEX` |
| **D5** `?? 0` 静默不出清 | ⛔ **未动**——见事项 `r1gbaa` |
| 方案 F 默认值 8% vs 5% | ⛔ **未动**（权威数仍待用户定）——见事项 `rf77Lu` |

### 11.4 复现与证据

```bash
node_modules/.bin/tsx docs/evidence/_probe_stoploss_divergence.mts   # 等价性探针（断言方向已翻转）
node_modules/.bin/tsx docs/evidence/_probe_inflight_runs.mts         # 改 server 前的在途 Run 闸门
node docs/evidence/_probe_paper_settings_render.mjs                  # 无头浏览器量 DOM（页面可达性）
node_modules/.bin/vitest run tests/server/paperTrading.test.ts       # 40/40
```

- 等价性探针：**全部断言通过**——两端在开盘分支的 `exitDate` / `exitPrice` / `reason` 三处逐位一致（场景 1/2/3）；唯一分叉是纸面组合止损（场景 4，附「设为 0 即复原等价」的反证）；时点设为「仅收盘」是**有意**差异（场景 5）。
- 前端 DOM 探针：**18/18 通过**（设置容器与三组、10 个数值项、5 个开关默认全关、判定时点可交互且「恢复默认设置」可还原、生效参数面板含组合止损 3% 且如实标注「默认」）。
- 全量套件：**8 失败文件 / 17 用例**，与本轮开工前登记的基线**逐项相同**（判据是失败文件集合）。

### 11.5 本节新增的边界声明

- 本轮**改了源码**：`server/paperTrading.ts`、`server/db.ts`、`server/routers.ts`、`client/src/pages/PaperTrading.tsx`、`tests/server/paperTrading.test.ts`。**组合回测侧一行未改**（`server/realisticBacktest.ts` 零 diff）。
- 改 `server/**` 前已跑闸门：全部真实 Run 表 RUNNING = 0；唯一命中的 `research_question` #270001 最后更新停在 30 小时前、且服务在其后已重启过 ⇒ 判定为**僵尸态**（详见 `_probe_inflight_runs.out.txt`）。
- 存量 4 条运行的下一次推进起，行为会**按缺省**改变（开盘分支 + 组合止损 3%）；**已推进过的日子不可回溯**，同一运行由此存在前后口径分界。若要口径干净，应新建运行重跑（推荐，但需用户决定）。
- `RESEARCH_READY` 仍未 TRUE；本轮**不产出任何策略结论**。
