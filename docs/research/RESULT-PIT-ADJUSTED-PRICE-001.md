# RESULT-PIT-ADJUSTED-PRICE-001

> **Gate：PIT_ADJUSTMENT_PARTIAL**
> 生成日期：2026-10-06（Asia/Shanghai）
> 目标：为后续价格结构研究建立严格的 PIT Forward-Adjusted OHLC 口径
> 脚本：scripts/_scratch/_pit_adjusted_price_001.mjs（只读）
> 明细：scripts/_scratch/_pit_adjusted_price_001.json
> 未修改：stock_daily_prices / dataset v8(780001) / RCP-P0-v1 / BC·PR·VCB·BB 定义；零 DDL / 零 DML

## 0. 结论速览

1. **仓库已有权威调整公式**（server/corporateActions/engine.ts）：现金分红/送股/转增/配股的除权除息因子 + 拆合股因子 + 同日多事件合并；本轮完整复用，未自创公式。
2. **生产 PIT 口径**：`pitFore_T(d) = backFactor(d) / backFactor(T)`（d <= T），`adjusted(d) = raw(d) * pitFore_T(d)`。该式只使用 `effectiveDate <= d / <= T` 的累计后向因子，**不含任何 T 之后的事件**；T 日 adjusted = raw。
3. **数据审计**：corporate_actions 实际只有 3 类 —— dividend 28,328 / transfer 3,101 / bonus_issue 212；关键字段 100% 填充；recordDate 31,639/31,641、announcementDate 31,641/31,641；无重复 (securityCode,effectiveDate,actionType)；3,004 个同日多类型事件组；237 条行为属于已退市证券；**securityId 全为 NULL，需按 securityCode 解析**。
4. **数据缺口（判 PARTIAL 的原因）**：corporate_actions 相对 adjustment_factors **不完整** —— 2,877 个 factor 日期（2,610 只证券）在 corporate_actions 中没有对应事件行；另有 135 条 action 没有 factor 行（2026-09/10 为主）。公式验证 226/250 通过、24 只证券存在 >0.5% 差异；rights_issue / split / reverse_split / other **在数据中不存在**（公式存在但未获实测）。因此 event 分解口径标 PARTIAL；**生产 backFactor 比率口径本身完整且 PIT 安全**。
5. **Leakage 三项全部通过**：as-of replay 24/24 一致；future-action mutation 6/6 T 日价格不变；raw identity 6/6 无公司行为证券 adjusted == raw。
6. **对行为候选的影响**：BB 受影响最大 —— 42,802 个候选中 1,410 个（**3.29%**）因 PIT 调整而**出池**，9,811 个（22.9%）关键字段发生变化，同时产生 3,402 个新候选；PR 出池 1,476（0.68%）、VCB 出池 62（0.17%）、BC 出池 4（0.002%）。

## 1. 固定原则（本轮遵守）

1. `stock_daily_prices` 原始行情保留不变（未写入）。
2. 不使用完整历史后验复权因子回填历史：生产口径只用 `backFactor(d)/backFactor(T)`，d、T 均 <= 研究日 T。
3. T 日计算只使用 `tradeDate <= T` 的原始行情与 `effectiveDate <= T` 的公司行为。
4. 每个 T 独立计算自己的 adjusted 序列（T=2020 与 T=2025 各自锚定），不生成一份"最终全历史复权价"。
5. 复算逻辑来自仓库既有 engine；不修改 dataset v8；不创建 Strategy；未做 Parameter Search / OOS / WFA / Robustness。

## 2. Corporate Action 数据审计

### 2.1 actionType 数量与字段完整性

| actionType | 行数 | 证券数 | 生效日范围 | 现金分红 | 送股 | 转增 | 配股 | 拆合股 | recordDate | announcementDate | 关键字段缺失 |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dividend | 28,328 | 4,800 | 2004-05-11 ~ 2026-10-23 | 28,328 | 0 | 0 | 0 | 0 | 28,327 | 28,328 | **0** |
| transfer | 3,101 | 1,818 | 2004-05-11 ~ 2026-09-14 | 0 | 0 | 3,101 | 0 | 0 | 3,100 | 3,101 | **0** |
| bonus_issue | 212 | 153 | 2008-10-31 ~ 2026-07-28 | 0 | 212 | 0 | 0 | 0 | 212 | 212 | **0** |
| rights_issue | 0 | 0 | — | — | — | — | — | — | — | — | — |
| split / reverse_split | 0 | 0 | — | — | — | — | — | — | — | — | — |
| other | 0 | 0 | — | — | — | — | — | — | — | — | — |
| **合计** | **31,641** | **4,824** | 2004-05-11 ~ 2026-10-23 | | | | | | 31,639 | 31,641 | |

- source：全部 `baostock`；`retrievedAt` 全部在 **2026-09-06 ~ 2026-09-09**（窗口结束之后）⇒ 入库时点可知性无法机证；本轮按 `effectiveDate` 生效日语义使用（与仓库 types.ts「调整只依赖 effectiveDate」一致）。
- `securityId`：**全部为 NULL**（31,641/31,641）⇒ 必须通过 `securityCode` 解析；本轮按 code 键处理。
- 分年覆盖：2004-2018 仅约 **40 条**（少数证券、稀疏）；2019 起每年 3,137 ~ 4,914 条（2,641 ~ 3,759 只证券）⇒ **2019 以前的公司行为覆盖不完整**。

### 2.2 异常与边界检查

| 检查 | 结果 |
|---|---|
| 同一 (securityCode, effectiveDate, actionType) 重复 | **0** |
| 同一 (securityCode, effectiveDate) 多 actionType | **3,004** 组（多为 dividend+transfer，少数 dividend+bonus_issue） |
| 关键字段缺失（dividend 无 cash、transfer 无 transferRatio、bonus_issue 无 bonusRatio） | **0** |
| 极端值（cash>100、bonus/transfer>5、split>50） | 0（min cash 0.000518、min bonus 0.05） |
| 属于已退市证券的 action | **237** 条 |
| action 无对应 factor 行 | **135** 条（2026 dividend 114 + transfer 1；2022 dividend 17 + transfer 1；2006 dividend 1 + transfer 1） |
| factor 行无对应 action 行 | **2,877** 条 / **2,610** 只证券（2019: 735，2020: 435，2021: 499，2022: 375，2023: 432，2024: 175，2025: 132，2026: 64，其余为 1991-2013） |
| adjustment_factors 总行数 / 证券数 / 范围 | 31,337 / 5,025 / 1991-04-03 ~ 2026-09-04；foreFactor/backFactor 全部 > 0；无重复 (securityCode,effectiveDate) |

**结论**：三种实际存在的 actionType 字段可靠、生效日可靠；但 `corporate_actions` 分解表相对 provider `adjustment_factors` **不完整**（2,877 个 factor 日期缺失 action 行），且 rights/split/other 类无数据可验证。

## 3. PIT Forward Adjustment 定义

### 3.1 生产口径（完整、PIT 安全）

设 provider 累计后向因子 `backFactor(x) = ∏ { 1/f(e) : e.effectiveDate <= x }`。

对研究日 T 与历史交易日 d（d <= T）：

```text
pitFore_T(d) = backFactor(d) / backFactor(T)
adjusted(d) = raw(d) * pitFore_T(d)
```

- `backFactor(d)` 与 `backFactor(T)` 都只包含 `effectiveDate <= d/T` 的事件 ⇒ **不含 T 之后的事件**；
- 因此 `pitFore_T(d)` 恰好等于 `∏ { f(e) : d < e.effectiveDate <= T }`；
- 在 d = T 时 `pitFore_T(T) = 1` ⇒ **T 日 adjusted == raw**；
- 对每个 T 独立计算，不产生"最终全历史复权价"；
- **不使用 foreFactor**（foreFactor 锚定 provider 最新日，含未来事件；虽然在比率中会约掉，但作为输入仍属未来派生数据）。

### 3.2 事件公式口径（仓库权威 engine，用于 per-type 说明与验证）

来源：`server/corporateActions/engine.ts`（`computeGroupForwardFactor` / `computeForwardFactor` / `buildFactorSeriesFromActions`）+ `types.ts` 字段语义。

| actionType | 公式 | 字段来源 |
|---|---|---|
| dividend | `f = (preClose - cash) / (preClose * (1 + bonus + transfer + rights))` 取 rights=bonus=transfer=0 → `f = (preClose - cash) / preClose` | cashAmount |
| bonus_issue | 同上取 cash=rights=0 → `f = preClose / (preClose * (1 + bonus)) = 1/(1+bonus)` | bonusRatio |
| transfer | 同上 → `f = 1/(1+transfer)` | transferRatio |
| rights_issue（数据不存在） | `f = (preClose - cash + rights*rightsPrice) / (preClose*(1+bonus+transfer+rights))` | rightsRatio / rightsPrice |
| split（数据不存在） | `f = 1/N`（1 拆 N） | splitRatio |
| reverse_split（数据不存在） | `f = N`（N 合 1） | splitRatio |
| other（数据不存在） | **UNSUPPORTED**（无字段语义定义，不伪造） | — |

同日多事件：拆/合股各自独立叠乘；其余（现金/送/转/配）分量分别求和后套用统一公式 —— 与仓库 `computeGroupForwardFactor` 完全一致。

**preClose**：生效日之前**最近一根有效 raw close（严格 d < effectiveDate）**；现金分红/配股缺 preClose 时确定性失败（`MISSING_PRECLOSE`），不静默跳过。

### 3.3 未支持 / 缺口标记

| 标记 | 说明 |
|---|---|
| `UNSUPPORTED_CORPORATE_ACTION` | rights_issue / split / reverse_split / other：仓库公式存在（other 除外），但当前数据无该类行，未获实测 |
| `MISSING_FACTOR_ROW` | 135 条 action 无对应 provider factor 行（2026-09/10 为主，超出 factor 表末日 2026-09-04） |
| `PARTIAL_ACTION_DECOMPOSITION` | 2,877 个 factor 日期（2,610 只证券）在 corporate_actions 中无分解行 ⇒ 仅用 corporate_actions 的 event 口径会漏事件；生产口径改用完整 backFactor 比率 |

## 4. 公式验证（event engine vs provider factors）

对 250 只含 factor 的证券，用仓库 event 公式重建累计因子，与 provider `backFactor`/`foreFactor` 对比：

| 判据 | 定义 | 结果 |
|---|---|---|
| backProduct 稳定性 | `backFactor(d) * CumF(d)` 在各 factor 日期应为常数（相对标准差） | **226/250 通过**（阈值 relStd < 0.002） |
| foreCheck | `foreFactor(d) * CumF(d) / CumF(last) ≈ 1`（阈值 0.005） | **226/250 通过** |
| 失败样本 | 24 只 | 差异来自 corporate_actions 与 adjustment_factors 的事件集合不一致（见 2.2）；例：000001.SZ 13 factors vs 23 actions、000002.SZ 10 vs 5、000564.SZ 2 factors vs 0 actions、000049.SZ foreMaxErr 7.3%、000564.SZ foreMaxErr 57.9% |

**结论**：公式本身与 provider 累计因子在多数证券上完全吻合；剩余差异是**数据完整性**问题（action 分解表缺行/多行），不是公式错误。

## 5. 样本 Walk-through（12 只，覆盖分红 / 送转 / 多次连续行为）

下表取每只证券一个含公司行为的 ex-date 与其后的研究日 T=ex+5 交易日；完整 OHLC 序列见 JSON `samples`。

| 证券 | ex-date | action | raw 前收 | PIT factor | adjusted 前收 | raw ex 收盘 | raw ex 日收益 | adjusted ex 日收益 | 机械跳变消除 |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| 600519.SH | 2026-06-26 | dividend 28.02423 | 1212.10 | 0.976883 | 1184.08 | 1168.63 | -3.59% | **-1.31%** | +2.28pp |
| 000728.SZ | 2026-06-26 | dividend 0.10 | 7.68 | 0.986979 | 7.58 | 7.66 | -0.26% | **+1.06%** | +1.32pp |
| 600999.SH | 2026-07-16 | dividend 0.449 | 20.90 | 0.978469 | 20.45 | 19.48 | -6.79% | **-4.74%** | +2.05pp |
| 002555.SZ | 2026-09-03 | dividend 0.10 | 18.23 | 0.994514 | 18.13 | 18.30 | +0.38% | **+0.94%** | +0.55pp |
| 002270.SZ | 2026-04-30 | dividend 0.21 | 25.50 | 0.991764 | 25.29 | 24.49 | -3.96% | **-3.16%** | +0.80pp |
| 600028.SH | 2026-06-17 | dividend 0.112 | 4.97 | 0.977867 | 4.86 | 4.85 | -2.41% | **-0.21%** | +2.21pp |

（其余 6 只：000001.SZ / 600036.SH / 000651.SZ / 002415.SZ / 601318.SH / 600000.SH 的完整 raw / action / PIT factor / adjusted OHLC / effective date 见 JSON `samples`。）

**人工检查结论**：

1. **ex-date 前后不合理断点被消除**：adjusted 前收 = raw 前收 × PIT factor；ex-date 当天 factor = 1（T 锚定）。例如 600519 的 -3.59% raw 跳变修正为 -1.31%，600028 的 -2.41% 修正为 -0.21%。
2. **无公司行为日期 raw == adjusted**：raw identity 测试（第 6 节）在 6 只无 factor 证券上全部成立。
3. **T 日 adjusted 不依赖未来 action**：mutation 测试（第 6 节）确认。
4. **同证券多行为可累计**：PIT factor 由 backFactor 比率给出，天然支持多个 ex-date 的累乘（见 JSON samples 中 000728 等多次分红序列）。

## 6. Leakage Audit

### A. As-of replay（2019 / 2021 / 2023 / 2026）

对 4 个研究日 T × 6 只样本证券，分别用「production backFactor 比率」与「只用 effectiveDate <= T 的 corporate_actions 事件重放」重算 pitFore，对比：

- 样本数：**24**；一致（相对差 < 1%）：**24/24**。
- 说明：两者的差异上限正是 corporate_actions 的缺口；对事件集合完整的证券，二者完全一致。

### B. Future-action mutation test

对 6 只样本证券，在 factor 序列中人为追加一条 **T 之后**（2099-01-01）的 factor 行，重算 T 日 adjusted：

- **6/6 T 日 adjusted 完全不变**（before == after）；
- 6/6 满足 `adjusted(T) == raw(T)`。

### C. Raw identity test

对 6 只没有任何 factor 行的主板证券：

- **6/6 adjusted OHLC == raw OHLC**（全部采样日）。

**Leakage 结论**：未发现未来信息泄漏；生产 backFactor 比率口径满足 PIT。

## 7. 对现有行为候选的影响评估

对 BC / PR / VCB / BB 的历史候选，用 PIT-adjusted 价格（backFactor 比率）重算各自定义中的价格结构字段与入池条件，与 raw 口径对比：

| Behavior | 候选总数 | 调整后仍入池 | 出池 | 出池率 | 受影响非候选 | 新入池 | 字段发生变化的候选 | 字段变化率 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BC | 261,271 | 261,267 | **4** | 0.0015% | 323,334 | 8,305 | 25,802 | 9.9% |
| PR | 215,789 | 214,313 | **1,476** | 0.684% | 325,910 | 4,301 | 8,847 | 4.1% |
| VCB | 35,666 | 35,604 | **62** | 0.174% | 336,535 | 1,279 | 1,694 | 4.75% |
| BB | 42,802 | 41,392 | **1,410** | **3.294%** | 982,630 | 3,402 | 9,811 | **22.9%** |

**字段级差异数量**（相对变化 > 0.1% 才计入）：

| Behavior | 字段 | 变化数量 |
|---|---|---:|
| BC | prior20High | 3,299 |
| BC | prior60High（观察字段） | 25,798 |
| PR | impulseReturn | 6,095 |
| PR | pullbackDepth | 2,563 |
| PR | reclaimLevel | 3,290 |
| VCB | stageReturn | 1,642 |
| VCB | volRecent | 410 |
| VCB | volPrior | 836 |
| VCB | consolidationHigh | 171 |
| BB | platformHigh | 2,128 |
| BB | platformRange | 6,634 |
| BB | platformReturn | 9,758 |

**重点回答：有多少历史候选因为公司行为调整而发生入池/出池变化？**

- **出池**：BC 4（0.002%）、PR 1,476（0.68%）、VCB 62（0.17%）、**BB 1,410（3.29%）**。
- **新入池**（受影响非候选中 raw=false 到 adjusted=true）：BC 8,305、PR 4,301、VCB 1,279、BB 3,402。
- **BB 受影响最大**：22.9% 的候选至少一个价格结构字段发生变化，3.29% 的候选直接出池；与上一轮统计的 BB「60 日窗口公司行为暴露 23.40%」一致。BC/PR/VCB 的出池率 < 1%，但观察/结构字段（BC prior60High、PR impulseReturn/pullbackDepth、VCB stageReturn）有可观变化，会影响后续强弱研究。

## 8. Gate 判定

| 判据 | 结果 |
|---|---|
| 现有 actionType 是否都能按可靠字段计算 | dividend / transfer / bonus_issue：**是**（关键字段 0 缺失） |
| rights_issue / split / reverse_split / other | **数据中不存在**（公式在仓库 engine 中已定义，但未获实测；other 无字段语义定义） |
| PIT as-of replay | **24/24 通过** |
| future-action mutation | **6/6 通过**（T 日 adjusted 不变） |
| raw identity | **6/6 通过**（无 factor 证券 adjusted == raw） |
| corporate_actions 与 adjustment_factors 一致性 | **不一致**：2,877 个 factor 日期（2,610 只证券）无 action 行；135 条 action 无 factor 行；公式验证 226/250 通过、24 只失败 |

### Gate

**PIT_ADJUSTMENT_PARTIAL**

**判定理由**：

- 生产口径 `pitFore_T(d) = backFactor(d)/backFactor(T)` **完整、PIT 安全、通过 mutation / identity / as-of replay**，可直接用于后续价格结构研究。
- 但事件分解表 `corporate_actions` **不完整**（相对 adjustment_factors 缺 2,877 个日期），且 rights_issue / split / reverse_split / other 在数据中不存在 ⇒ 「全部公司行为均可根据可靠字段计算」不能成立。
- 因此判 **PARTIAL**（存在部分 action 无法可靠分解，不影响生产 backFactor 口径）；**不是 BLOCKED**（无未来信息泄漏，公式可信）。

## 9. 已知残余风险

| # | 风险 | 等级 | 说明 / 缓解 |
|---|---|---|---|
| R1 | corporate_actions 分解表不完整（2,877 个 factor 日期无 action 行） | 中 | **生产必须用 backFactor 比率口径**，不要只用 corporate_actions 的 event 口径；event 口径仅作验证与公式说明 |
| R2 | rights_issue / split / reverse_split / other 无数据 | 中 | 仓库 engine 已有公式（other 除外），但未获实测；当前 2019-2026 数据中未出现，主要影响更早历史（如拆股） |
| R3 | 2019 以前 action 覆盖稀疏（2004-2018 仅约 40 条） | 中 | 生产 backFactor 覆盖 1991+（5,025 证券）；但对 2019 年初窗口跨越 pre-2019 事件的样本，event 口径不可验证 |
| R4 | 135 条 action 无 factor 行（2026-09/10 为主） | 低 | 多在 factor 表末日 2026-09-04 之后 / 研究窗口之后；研究窗口内按 MISSING_FACTOR_ROW 处理，不伪造 |
| R5 | provider 数据 retrievedAt 在窗口结束后（2026-09） | 低-中 | 采用 effectiveDate 生效日语义（与仓库 types.ts 一致）；入库时点可知性无法机证 |
| R6 | volume / amount 不调整（与仓库 engine 一致） | 低 | VCB 的成交量收缩条件使用未调整 volume；跨 ex-date 的 amount 口径不完全可比。本轮未修改 |
| R7 | 退市证券 237 条 action | 低 | 按 securityCode 处理，未过滤；退市后无行情，不会进入研究窗口条件 |

## 10. Impact / Verification

### 10.1 Impact

- **Contract**：无（不新增/修改 shared 契约、tRPC、前端）。
- **DB**：零 DDL / 零 DML；只读 SELECT。`stock_daily_prices`、`corporate_actions`、`adjustment_factors`、dataset v8（780001）均未修改。
- **Execution**：不进入 Strategy Core / backtestCore / simulator；未创建 Strategy / Candidate；未做 Parameter Search / OOS / WFA / Robustness；未修改 RCP-P0-v1 / BC·PR·VCB·BB 定义。

### 10.2 Verification

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型检查 | node_modules\\.bin\\tsc.cmd --noEmit（等价 pnpm run check 的 tsc --noEmit） | 0 error（exit 0） |
| 行尾漂移 | node scripts/checkEolDrift.mjs --strict | 0 |
| 工件 | scripts/_scratch/_pit_adjusted_price_001.json | 已生成（audit / formulaValidation / samples / leakage / impact / gate） |
| 脚本 | scripts/_scratch/_pit_adjusted_price_001.mjs | 只读；含生产 PIT 口径 + event 公式口径 + 验证 + impact |
| Smoke 校验 | 短窗口 rawFailUnexpected = 0（BC/PR/VCB/BB 候选数与候选池完全一致） | 通过 |

## 11. Gate

**PIT_ADJUSTMENT_PARTIAL**

生产 PIT forward-adjusted OHLC 口径（`backFactor(d)/backFactor(T)`）已建立并通过 PIT / mutation / identity / as-of replay 全部测试，可直接用于后续价格结构研究；但由于 `corporate_actions` 分解表相对 provider `adjustment_factors` 不完整（2,877 个日期缺 action 行），且 rights_issue / split / reverse_split / other 无数据可验证，per-type event 口径只能判 PARTIAL。

对后续研究的直接结论：

1. **使用 `backFactor(d)/backFactor(T)` 作为生产 PIT 复权口径**，不要用 `foreFactor`，不要用完整历史一次性复权。
2. **BB 的历史候选需要重点复核**：3.29% 出池、22.9% 字段变化；BC/PR/VCB 的出池率低，但结构/观察字段变化会影响强弱研究。
3. 在补齐 corporate_actions 的分解缺口（或补充 rights/split 数据）之前，per-type event 复权不可单独作为唯一事实来源。
