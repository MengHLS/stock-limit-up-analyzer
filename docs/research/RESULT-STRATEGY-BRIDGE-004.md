# RESULT-STRATEGY-BRIDGE-004 · R3 最小实测（平台真实 simulator · 小范围单 Run）（**Goal round 3**）

> 🔴 **NON-PLATFORM-FORMAL-RUN**（为**测试级小范围 fixture**，非正式 Run）· **零数据库写入** · **零业务代码改动**
> Dataset **`780004`**（本轮未读）· HEAD **`f8b6810`** · Goal round **3/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **R3 解除** —— 用**平台真实 simulator**（`runTradeSimulation`）小范围实测，三项语义全部确认：        │
│                                                                                                      │
│  ① **不可卖 ⇒ 订单被拒**（`LIMIT_DOWN`）                          ✅ 实测                           │
│  ② **被拒后【每日重新发单】⇒ 结构性顺延成立**                      ✅ 实测（连续 3 日拒绝 × 3 次发单）│
│  ③ **边界处 = 「回测结束仍持仓」**（`positions` 保留 + 边界价 `exitPrice`）✅ 实测                     │
│                                                                                                      │
│  🔴 **并发现 2 项【口径差异】（必须随 Variant 登记）**：                                                │
│     · **退出单在【触发日的次日开盘】执行（NEXT_OPEN）**，非触发日 close                                  │
│     · 涨跌停判定为**严格不等式**（恰为 −10.000% 的 open **不触板**）                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 方法

| 项 | 内容 |
|---|---|
| 引擎 | **`server/research/simulator#runTradeSimulation`**（平台**唯一**带退出策略层的引擎） |
| 数据 | **纯内存 fixture**（≤ 6 个交易日 · 1 只标的 · 无 DB · 无网络） |
| 范式 | 完全对齐 `tests/server/research/executionConstraints/executionConstraints.test.ts` |
| 成本 | `commission 2.5bps/边 + slippage 7.5bps/边 + stampDuty/transferFee 0 + minCommission 0` ⇒ **往返 20bps**（= R2 口径） |
| 约束 | `blockLimitDownSell: true`（跌停不可卖）· `allowPartialFill: true` · `initialCapital 1,000,000` |
| 退出 | `exitPolicy: { maxHoldingDays: 2 }`（对位 Variant 的 `TIME_EXIT 40`） |
| 驱动 | `scripts/_scratch/r3check.ts` → `tsc` 编译 CJS → `node` 执行 |

---

## 2. FACT · 实跑证据

### 2.1 场景 1 · 执行日跌停 ⇒ 次日重新发单（**4/4 断言通过**）

```
orders:
  {"d":"2026-06-01","side":"buy", "st":"PARTIALLY_FILLED","q":95200,"f":94200}
  {"d":"2026-06-03","side":"sell","st":"REJECTED","rr":"LIMIT_DOWN","q":94200,"f":0}   ← 🔴 执行日跌停 ⇒ 拒单
  {"d":"2026-06-04","side":"sell","st":"FILLED",  "q":94200,"f":94200}                 ← 🔴 次日重新发单并成交
  {"d":"2026-06-05","side":"buy", "st":"PARTIALLY_FILLED","q":93100,"f":92100}         ← 清仓后重新建仓
trades: [{"entry":"2026-06-02","exit":"2026-06-05","reason":"持有满2个交易日"}]
```

| 断言 | 结果 |
|---|:---:|
| 存在被拒卖单（`reason = LIMIT_DOWN`） | ✅ |
| **被拒后【重新发单并成交】** | ✅ |
| `Trade.exitTime` 晚于首次执行日 T1 | ✅ |
| 顺延清仓后有新仓建立（说明清仓确已发生） | ✅ |

> ## ✅ **⇒ 「不可卖顺延」实测成立** —— **不是显式 DEFER 机制**，而是**退出条件（`holdingDays >= N`）持续为真 ⇒ 每日重新发单**（承接 `BRIDGE-003` §2.3 的推断，**现已被实测证实**）

### 2.2 场景 2 · 连续跌停至回测结束（**3/4 断言通过**；第 4 项为我的断言错误）

```
orders:
  sell REJECTED LIMIT_DOWN  (2026-06-03)
  sell REJECTED LIMIT_DOWN  (2026-06-04)
  sell REJECTED LIMIT_DOWN  (2026-06-05)     ← 🔴 连续 3 日被拒，但【每日都重新发单】
trades: [{"entry":"2026-06-02","exit":"2026-06-08","exitPrice":7.5,"reason":"回测结束仍持仓"}]
positions(期末): ["600000.SH"]
```

| 断言 | 结果 |
|---|:---:|
| 卖出被连续拒绝 ≥ 2 次（`LIMIT_DOWN`） | ✅ **3 次** |
| **期末【仍持有】** | ✅ |
| `Trade.reason = 「回测结束仍持仓」` | ✅ |
| ~~`Trade.exitPrice` 为空~~ | ❌ **我的断言错** ⇒ 🔴 **平台【确实】填了边界价 `exitPrice = 7.5`** |

> ## 🔴 **修正发现**：平台在「回测结束仍持仓」时 **`Trade.exitPrice` 被填为【边界日的价格】**（7.5）—— 即**按边界价 mark-to-market 记账**，**同时** `positions` 仍保留该持仓。
> ## 📌 **⇒ 与研究口径的「rd80 按 close 强制结算」在【PnL 口径上近似等价】**，差异仅在于平台用**最后一天价格**、研究用 **rd80 close**（真实数据下两者相同）

---

## 3. 🔴 两项**新发现的口径差异**（必须随 Variant 登记）

| # | 差异 | 证据 | 影响 |
|---|---|---|---|
| **D1** | **退出单在【触发日的次日开盘】执行（`NEXT_OPEN`）**，**不是**触发 bar 的 `close` | 场景 1：持仓满 2 日于 **06-03** 触发，卖单 `tradeDate = 06-03`，**成交于 06-04 开盘**；`Trade.exitTime = 06-05` | 🔴 **研究口径 = rd55 `close` 出场**；平台默认 = **rd56 开盘**。Variant 声明了 `TIME_EXIT ... trigger: "ON_CLOSE"`，**是否能改为同日 close 成交【未验证】** |
| **D2** | **涨跌停判定为严格不等式** | 首次运行用 `open = 8.505`（`9.45 × 0.9 = 8.505`，恰为 −10.000%）⇒ **未被判跌停、正常成交**；改为 `8.40` 后即被拒 | 🔴 **恰好位于板价的 open 不触板** ⇒ 与研究 `canSellAtClose`（数据集口径）**可能有逐事件差异** |

---

## 4. R3 判定

| 研究口径 | 平台实测行为 | 判定 |
|---|---|:---:|
| rd16 open 入场 | `NEXT_OPEN` 执行 ✓ | ✅ 一致 |
| **rd55 close 出场（F40）** | **次日开盘执行** | 🔴 **D1 时点差异（待验证 `ON_CLOSE` 是否可改）** |
| **`canSellAtClose = 1` 时成交** | `blockLimitDownSell: true` ⇒ 跌停拒卖 | ✅ 语义一致（D2 边界判定差异） |
| **不可卖 ⇒ 顺延** | **每日重新发单**（实测连续 3 日） | ✅ **成立** |
| **rd80 兜底（按 close 强制结算）** | 边界处 `exitPrice` = 最后一天价格 + `positions` 保留 + `reason = "回测结束仍持仓"` | ✅ **PnL 口径近似等价** |

> ## ✅ **⇒ R3 解除**：三项语义（**拒单 / 顺延 / 边界结算**）均在**平台真实引擎**上实测确认
> ## 🔴 **但 D1（出场时点）与 D2（板价判定）两项差异【必须随 Variant 登记】**，并在正式 Backtest 设置阶段裁定

---

## 5. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | 🔴 **`TIME_EXIT ... trigger: "ON_CLOSE"` 是否能实现【同日 close 成交】**（本轮用 legacy `exitPolicy.maxHoldingDays`，走 `NEXT_OPEN`）⇒ **D1 待验证** |
| **N2** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎板价判定的**逐事件一致性**（D2） |
| **N3** | ❌ 两个 Variant 的**任何绩效**（**仍未跑正式 Backtest**） |
| **N4** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于研究 `w = 1/180` |
| **N5** | ❌ 研究 harness ↔ 平台 simulator 的逐笔等价性 |
| **N6** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |

---

## 6. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入** · ✅ **未跑正式 Backtest / OOS / WFA** · ✅ **未创建 Candidate / Strategy Version** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 新增文件仅 `scripts/_scratch/r3check.ts`（gitignore）

---

## 7. 下一步（**Goal 保持 active**）

```text
1. 验证 D1：TIME_EXIT trigger=ON_CLOSE 能否实现同日 close 成交（否则 Variant 出场时点需改注为「次日开盘」）
2. 两 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
3. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**