# RESULT-BEHAVIOR-POOLS-PIT-ADJUSTED-001

> **Gate：BEHAVIOR_POOLS_PIT_READY**
> 生成日期：2026-10-06（Asia/Shanghai）
> Base Universe：RCP-P0-v1（未修改）；datasetVersionId：780001（只读坐标）
> 信号时点：T 日收盘；行为结构价格：PIT-adjusted OHLC；执行价：**raw T+1 Open**；volume/amount：raw
> PIT 口径：`pitFore_T(d) = backFactor(d) / backFactor(T)`；`adjusted(d) = raw(d) * pitFore_T(d)`（只含 effectiveDate <= T 事件）
> 原始版本 BC-P0-v1 / PR-P0-v1 / VCB-P0-v1 / BB-P0-v1 / RS-MKT-P0-v1 **保留未覆盖**
> 脚本：scripts/_scratch/_behavior_pools_pit_001.mjs（生成）+ _behavior_pools_pit_compare_001.mjs / _behavior_pools_pit_reasons_001.mjs（对比/原因）

## 0. 结论速览

5 个 PIT-adjusted 候选池已生成，行为定义/阈值/窗口完全继承 P0，只替换价格结构输入：

| 行为 | 版本 | PIT 候选行 | 原 P0 候选行 | Gate |
|---|---|---:|---:|---|
| BC | BC-PIT-P1 | **269,572** | 261,271 | BEHAVIOR_POOLS_PIT_READY |
| PR | PR-PIT-P1 | **218,614** | 215,789 | BEHAVIOR_POOLS_PIT_READY |
| VCB | VCB-PIT-P1 | **36,885** | 35,666 | BEHAVIOR_POOLS_PIT_READY |
| BB | BB-PIT-P1 | **44,794** | 42,802 | BEHAVIOR_POOLS_PIT_READY |
| RS（市场-only） | RS-MKT-PIT-P1 | **1,904,607** | 1,899,670 | BEHAVIOR_POOLS_PIT_READY |

Raw vs PIT 对比：**BB 变化最大**（Jaccard 0.8959，1,410 出池 / 3,402 新入池）；BC 基本稳定（Jaccard 0.9692，仅 4 出池）；RS 几乎不变（Jaccard 0.9974，0 出池）。PIT leakage / determinism / execution separation 全部通过。

## 1. 固定口径（未修改任何 P0 定义）

- Base Universe：RCP-P0-v1；signals 只用 T 日及以前。
- 价格结构：`adjusted(d) = raw(d) * backAt(d)/backAt(T)`；T 日 `adjusted(T) == raw(T)`。
- 复权只用 `effectiveDate <= T` 的 factor（`backAt` 为截至 d/T 的累计后向因子）。
- **执行价继续用 raw T+1 Open**（generator 的 pending/executability 路径直接读 raw 下一日 bar 的 Open，与信号价格基数解耦）。
- volume/amount 不调整（VCB 的成交量收缩条件仍用 raw volume）。
- RS 基准 000300.SH 继续用现有指数口径（不引入未来数据）。
- BC/PR/VCB/BB/RS 的定义、窗口（20/60/5/10）、阈值（5% / 0.8 / 0.8 / 10% / 3% / 30% / 20%）全部未改。

## 2. Raw vs PIT 对比（核心）

| 行为 | raw count | PIT count | intersection | raw-only（出池） | PIT-only（新入池） | Jaccard |
|---|---:|---:|---:|---:|---:|---:|
| BC | 261,271 | 269,572 | 261,267 | **4** | 8,305 | 0.96918 |
| PR | 215,789 | 218,614 | 214,313 | **1,476** | 4,301 | 0.97375 |
| VCB | 35,666 | 36,885 | 35,604 | **62** | 1,281 | 0.96365 |
| BB | 42,802 | 44,794 | 41,392 | **1,410** | 3,402 | 0.89585 |
| RS | 1,899,670 | 1,904,607 | 1,899,670 | **0** | 4,937 | 0.99741 |

**核心字段变化数量**（intersection 内相对变化 > 0.1%）：

| 行为 | 字段 | 变化数量 |
|---|---|---:|
| BC | prior20High / breakoutLevel | 3,295 |
| BC | prior60High（观察字段） | 25,794 |
| BC | prevClose | 375 |
| PR | impulseReturn | 5,770 |
| PR | pullbackDepth | 1,715 |
| PR | reclaimLevel | 2,170 |
| PR | retraceRatio | 7,095 |
| PR | swingLowDaysAgo | 1,403 |
| VCB | stageReturn | 1,580 |
| VCB | volRatio | 1,183 |
| VCB | volRecent / volPrior | 374 / 810 |
| VCB | consolidationHigh | 158 |
| VCB | volumeRatio / volumeMean* | **0**（raw volume 保持） |
| BB | platformHigh | 1,921 |
| BB | platformLow | 5,293 |
| BB | platformRange | 5,312 |
| BB | platformReturn | 8,348 |
| RS | rs20 | 125,524 |
| RS | rs5 | 29,120 |
| RS | stockRet1 / rs1 | 2,671 |
| RS | benchRet1 / benchClose | **0**（基准未动） |

## 3. 分年份变化数量（rawN / PITN / intersection / rawOnly / PITOnly）

**BC**（基本稳定：仅 2021 年 4 个出池；新入池集中在 2019/2020）

| 年 | rawN | PITN | both | rawOnly | PITOnly |
|---|---:|---:|---:|---:|---:|
| 2019 | 32,967 | 35,915 | 32,967 | 0 | 2,948 |
| 2020 | 34,007 | 35,189 | 34,007 | 0 | 1,182 |
| 2021 | 34,107 | 34,678 | 34,103 | 4 | 575 |
| 2022 | 29,386 | 30,247 | 29,386 | 0 | 861 |
| 2023 | 29,718 | 30,494 | 29,718 | 0 | 776 |
| 2024 | 37,121 | 37,598 | 37,121 | 0 | 477 |
| 2025 | 38,492 | 39,493 | 38,492 | 0 | 1,001 |
| 2026 | 25,473 | 25,958 | 25,473 | 0 | 485 |

**PR**（出池与新入池分布在所有年份）

| 年 | rawN | PITN | both | rawOnly | PITOnly |
|---|---:|---:|---:|---:|---:|
| 2019 | 25,805 | 26,792 | 25,483 | 322 | 1,309 |
| 2020 | 28,656 | 28,991 | 28,433 | 223 | 558 |
| 2021 | 28,805 | 29,056 | 28,694 | 111 | 362 |
| 2022 | 32,338 | 32,715 | 32,082 | 256 | 633 |
| 2023 | 19,702 | 19,888 | 19,582 | 120 | 306 |
| 2024 | 29,385 | 29,648 | 29,262 | 123 | 386 |
| 2025 | 29,635 | 29,864 | 29,437 | 198 | 427 |
| 2026 | 21,463 | 21,660 | 21,340 | 123 | 320 |

**VCB**（出池 62，集中在 2019/2020）

| 年 | rawN | PITN | both | rawOnly | PITOnly |
|---|---:|---:|---:|---:|---:|
| 2019 | 3,586 | 4,099 | 3,565 | 21 | 534 |
| 2020 | 3,675 | 3,838 | 3,665 | 10 | 173 |
| 2021 | 3,795 | 3,858 | 3,791 | 4 | 67 |
| 2022 | 3,822 | 3,943 | 3,814 | 8 | 129 |
| 2023 | 3,546 | 3,627 | 3,544 | 2 | 83 |
| 2024 | 9,298 | 9,374 | 9,290 | 8 | 84 |
| 2025 | 4,866 | 5,008 | 4,864 | 2 | 144 |
| 2026 | 3,078 | 3,138 | 3,071 | 7 | 67 |

**BB**（变化最大；2019 出池 488、2025 新入池 758）

| 年 | rawN | PITN | both | rawOnly | PITOnly |
|---|---:|---:|---:|---:|---:|
| 2019 | 2,607 | 2,535 | 2,119 | 488 | 416 |
| 2020 | 5,903 | 6,188 | 5,625 | 278 | 563 |
| 2021 | 5,656 | 5,954 | 5,547 | 109 | 407 |
| 2022 | 3,708 | 3,877 | 3,617 | 91 | 260 |
| 2023 | 7,564 | 7,972 | 7,497 | 67 | 475 |
| 2024 | 6,089 | 6,306 | 5,990 | 99 | 316 |
| 2025 | 7,781 | 8,297 | 7,539 | 242 | 758 |
| 2026 | 3,494 | 3,665 | 3,458 | 36 | 207 |

**RS**：0 出池；新入池 2019: 1,358 / 2020: 415 / 2021: 418 / 2022: 466 / 2023: 510 / 2024: 618 / 2025: 714 / 2026: 438。

## 4. BB 出池 / 新入池明细

| 年 | 出池（raw-only） | 新入池（PIT-only） |
|---|---:|---:|
| 2019 | 488 | 416 |
| 2020 | 278 | 563 |
| 2021 | 109 | 407 |
| 2022 | 91 | 260 |
| 2023 | 67 | 475 |
| 2024 | 99 | 316 |
| 2025 | 242 | 758 |
| 2026 | 36 | 207 |
| **合计** | **1,410** | **3,402** |

BB 字段变化：platformHigh 1,921、platformLow 5,293、platformRange 5,312、platformReturn 8,348、breakoutDistance 1,971。
BB 出池原因（采样 200/1,410）：rangeOk 失败 197、returnOk 失败 190 —— 即 PIT 调整后的平台区间（>30%）或平台期漂移（>20%）不再满足，这是原来的 23.40% 公司行为暴露在候选层面的直接体现。BB 新入池（采样 200/3,402）：raw 的 breakoutOk 失败 200/200、upDay 失败 153/200 —— 调整后历史平台高点下降，原本未突破的 T 日变成突破。

## 5. PR / VCB 入池变化原因

> 原因采用**有界采样**：PR rawOnly 采样 400/1,476、VCB rawOnly 全部 62/62、BB rawOnly 采样 200/1,410、adjustedOnly 各采样 200-400；每个事件可能同时命中多个失败 check。

**PR（PULLBACK-RESTART）**

| rawOnly（出池）失败 check | 数量（/400） |
|---|---:|
| reclaimCrossing（C_{T-1} < reclaimLevel <= C_T 不再成立） | 326 |
| notBreakout（C_T <= swingHigh 不再成立） | 243 |
| pullbackOk（pullbackDepth >= 3% 不再成立） | 136 |
| impulseOk（impulseReturn >= 10% 不再成立） | 123 |
| swingFound / noFullRetrace / upDay | 122 / 122 / 122 |

adjustedOnly（新入池）的 raw 失败 check：reclaimCrossing 326、impulseOk 316、notBreakout 267、pullbackOk 251、upDay 242。
**结论**：PR 的入池变化主要是 **swingLow/swingHigh/pullbackLow/reclaimLevel 在 ex-date 附近的重新定位**导致 reclaim 穿越条件翻转，而不是单一阈值。

**VCB（VOLATILITY-CONTRACTION-BREAKOUT）**

| rawOnly（出池）失败 check | 数量（/62） |
|---|---:|
| volOk（volRecent/volPrior < 0.8 不再成立） | **62 / 62（100%）** |
| stageOk / volumeOk / breakoutOk / upDay | 0 |

adjustedOnly（新入池）的 raw 失败 check：stageOk 159/200、breakoutOk 39/200、volOk 38/200、upDay 29/200。
**结论**：VCB 出池的**唯一原因**是 PIT 调整改变了收益序列的波动率收缩条件（`volOk`）；成交量收缩 `volumeOk` 保持（raw volume 未调整），与口径设计一致。

## 6. BC 稳定性 / RS 表现

- **BC 基本保持稳定**：261,271 中仅 **4** 个出池（Jaccard 0.96918）；prior20High 变化 3,295（约 1.3%），breakoutLevel 同值变化 3,295；prior60High（仅观察字段，不参与入池）变化 25,794（9.9%）。新入池 8,305 主要来自 2019/2020。
- **RS 几乎不变**：0 出池、4,937 新入池（Jaccard 0.99741）；rs20 变化 125,524、rs5 变化 29,120、stockRet1/rs1 变化 2,671；benchRet1/benchClose 变化 **0**（000300.SH 基准未动），证明基准未被 PIT 股票价格污染。

## 7. 审计

### 7.1 PIT leakage（as-of replay）

generator 内建 as-of replay：对 4 个采样日只用 `tradeDate <= T` 的截断窗口重跑，与主运行逐 securityId 对比，5 个池全部一致：

| 行为 | 2019-06-28 | 2021-06-30 | 2023-06-30 | 2026-09-04 | 对称差 |
|---|---|---|---|---|---|
| BC | 120/120 | 125/125 | 218/218 | 106/106 | 0 |
| PR | 57/57 | 114/114 | 126/126 | 127/127 | 0 |
| VCB | 9/9 | 13/13 | 19/19 | 6/6 | 0 |
| BB | 13/13 | 20/20 | 45/45 | 21/21 | 0 |
| RS | 462/462 | 872/872 | 1,787/1,787 | 1,451/1,451 | 0 |

主运行使用 `backFactor(d)/backFactor(T)`（只含 effectiveDate <= T 的事件），replay 用截断窗口重算，二者一致 ⇒ 无未来 action 泄漏。

### 7.2 Candidate determinism

每个 PIT 池的 `(tradeDate, securityId)` 唯一键数 == 行数，重复 0：

| 行为 | 行数 | 唯一键 | 重复 | reconciled |
|---|---:|---:|---:|---|
| BC | 269,572 | 269,572 | 0 | true |
| PR | 218,614 | 218,614 | 0 | true |
| VCB | 36,885 | 36,885 | 0 | true |
| BB | 44,794 | 44,794 | 0 | true |
| RS | 1,904,607 | 1,904,607 | 0 | true |

### 7.3 Execution separation（signalPrice = adjusted；executionPrice = raw T+1 Open）

- 信号价格基数：`PIT_ADJUSTED_WINDOW`（窗口 OHLC 均为 `raw * backAt(d)/backAt(T)`；T 日 factor=1 ⇒ `adjusted(T) == raw(T)`）。
- 执行价格基数：`RAW_T_PLUS_1_OPEN`（generator 的 pending/executability 路径直接读取下一交易日 **raw Open**，与信号基数解耦）。
- 示例：

| 行为 | T | 证券 | signalCloseAdjusted | adjustedCloseAtT==rawT | T+1 | executionOpenRaw |
|---|---|---|---:|---|---:|---:|
| PR | 2019-01-30 | 000576.SZ | 6.83 | true | 2019-01-31 | 6.80 |
| PR | 2019-01-30 | 000652.SZ | 3.29 | true | 2019-01-31 | 3.08 |
| VCB | 2019-01-30 | 000100.SZ | 2.76 | true | 2019-01-31 | 2.76 |
| VCB | 2019-01-30 | 603165.SH | 16.15 | true | 2019-01-31 | 16.30 |
| BB | 2019-04-03 | 000729.SZ | 7.27 | true | 2019-04-04 | 7.38 |
| BB | 2019-04-03 | 002101.SZ | 9.79 | true | 2019-04-04 | 10.13 |

### 7.4 公司行为发生日附近 walk-through

PIT 任务已对 12 只证券做过 ex-date 前后 walk-through（如 600519.SH 2026-06-26：raw ex 日 -3.59% → adjusted -1.31%；600028.SH 2026-06-17：raw -2.41% → adjusted -0.21%）。本轮 PIT 池的行为结构计算使用同一 adjusted 窗口，因此 ex-date 附近的 mechanical jump 不再被当作真实涨跌；VCB 60 只出池样本中 100% 由 `volOk` 翻转，正是该修正的直接效果。

## 8. 已知残余风险 / 限制

| # | 风险 | 说明 |
|---|---|---|
| R1 | 上游 PIT 口径为 `PIT_ADJUSTMENT_PARTIAL` | `corporate_actions` 分解表相对 adjustment_factors 不完整（2,877 个日期无 action 行；135 条 action 无 factor 行），rights_issue/split/reverse_split/other 无数据可验证。本轮的 PIT 池使用完整的 `backFactor` 比率口径，不受事件分解缺口影响；但 per-type event 复权仍不可作为唯一事实来源。 |
| R2 | 2019 以前 action 覆盖稀疏 | factor 覆盖 1991+；事件分解 2004-2018 仅约 40 条。 |
| R3 | volume/amount 未复权 | VCB 成交量条件继续用 raw volume（按任务要求）；跨 ex-date 的 amount 口径不完全可比。 |
| R4 | RS 仍为市场-only | `industry_assignments` 无历史 PIT 板块归属，RS-MKT-PIT-P1 不输出板块字段。 |
| R5 | 元数据 label | PIT 池 JSON 中 `audits.corporateActionExposure.note` 仍写 "raw unadjusted prices"，这是上一版文案；实际 priceBasis 已是 PIT_FORWARD_ADJUSTED（`priceBasis` 字段已标注）。审计含义（窗口内存在公司行为）仍有效。 |
| R6 | T+1 可执行性边界 | 2026-09-04 的 T+1 源覆盖不完整，各池单列 `executabilityUnverified`（BC 106 / PR 127 / VCB 6 / BB 21 / RS 1,451）。 |

## 9. Gate

**BEHAVIOR_POOLS_PIT_READY**

判定理由：

1. 5 个行为全部完成 PIT 价格替换（BC-PIT-P1 / PR-PIT-P1 / VCB-PIT-P1 / BB-PIT-P1 / RS-MKT-PIT-P1），定义/阈值/窗口未改；
2. PIT leakage as-of replay：5 个池 4/4 采样日全部一致（对称差 0）；
3. Candidate determinism：5 个池 `(tradeDate, securityId)` 唯一、0 重复；
4. Execution separation 明确：signalPrice 使用 PIT-adjusted 窗口，executionPrice 使用 **raw T+1 Open**，二者不混用；
5. 原始版本 BC-P0-v1 / PR-P0-v1 / VCB-P0-v1 / BB-P0-v1 / RS-MKT-P0-v1 均未覆盖。

**进入下一轮行为研究的建议**：以 PIT 版本（`*-PIT-P1`）作为价格结构研究的默认输入；BB 与 PR 的历史结论需要用 PIT 版本复核（BB Jaccard 0.896、1,410 出池；PR 1,476 出池），BC 基本稳定、RS 几乎不变。

## 10. 工件

| 工件 | 路径 | 行数 |
|---|---|---:|
| BC PIT | scripts/_scratch/_behavior_breakout_continuation_pit_001.json | 269,572 |
| PR PIT | scripts/_scratch/_behavior_pullback_restart_pit_001.json | 218,614 |
| VCB PIT | scripts/_scratch/_behavior_contraction_breakout_pit_001.json | 36,885 |
| BB PIT | scripts/_scratch/_behavior_base_breakout_pit_001.json | 44,794 |
| RS PIT | scripts/_scratch/_behavior_relative_strength_pit_001.json | 1,904,607 |
| 对比/原因 | scripts/_scratch/_behavior_pools_pit_comparison_001.json | — |
| 生成脚本 | scripts/_scratch/_behavior_pools_pit_001.mjs | — |
| 对比脚本 | scripts/_scratch/_behavior_pools_pit_compare_001.mjs | — |
| 原因/执行分离脚本 | scripts/_scratch/_behavior_pools_pit_reasons_001.mjs | — |
