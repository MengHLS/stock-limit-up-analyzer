# RESULT-PATTERN-REENTRY-STRONG-TREND-001

> **状态：DISCOVERY_ONLY**
> 本轮只做 DISCOVERY / HYPOTHESIS VALIDATION：不创建 Strategy、Candidate、Parameter Search，不做 OOS/WFA、不优化回撤阈值、不搜索最佳持有期、不给出交易结论。
> 生成日期：2026-10-05（Asia/Shanghai）

## 0. 数据与锚点

- Dataset：`datasetVersionId=780001`（v8）
- 股票池：主板、非 ST；沿用上一轮强势定义和 `T*` 定义。
- 最近 Case 窗口：2026-06-04 至 2026-09-04。
- 强势定义：事件日收盘价为历史基准，事件后 80 个交易日内 `high / event_close >= 2`（累计 ≥100%，不是单日涨幅）。
- `T*`：第一次满足上述条件的交易日，仅作为事后研究锚点，不是实时交易信号。
- 成功/失败/CENSORED：`close(T*+20) > close(T*)` / `<= close(T*)` / 无完整 T+20。

## 1. SUCCESS / FAILURE / CENSORED 样本

| 样本 | 事件数 | SUCCESS | FAILURE | CENSORED |
|---|---:|---:|---:|---:|
| 最近 3 个月 Case（事件级） | 34 | 7 | 12 | 15 |
| 全历史同规则描述性样本 | 691 | 530 | 92 | 69 |

说明：最近 Case 样本按股票去重；全历史样本为事件级，同一股票可能重复出现。H1/H2/H3/H4 的主证据以全历史样本为主，最近 Case 作为小样本方向检查。

## 2. H1：T* 后 MAE 分布

MAE 定义：从 T* 收盘起，到指定观察期结束前，`min(low) / T* close - 1`。

| 观察期 | SUCCESS P25 / 中位数 / P75 | FAILURE P25 / 中位数 / P75 |
|---|---:|---:|
| D1 | -5.8% / -1.9% / 3.3% | -7.3% / -2.4% / 4.7% |
| D3 | -8.1% / -3.0% / 2.2% | -11.2% / -5.8% / 3.0% |
| D5 | -9.2% / -3.5% / 1.5% | -13.8% / -6.4% / 2.8% |
| D10 | -10.0% / -4.3% / 1.0% | -19.0% / -9.7% / -2.4% |

方向：D1 两组接近；D3 开始拉开；D5/D10 差距继续扩大。全历史 D10 中位数约 SUCCESS -4.3% vs FAILURE -9.7%。最近 Case 的方向相同：D10 约 -12.7% vs -20.6%。

## 3. H2：跌破 T* close 后重新站回

固定事件定义：

```text
跌破：T* 后任一交易日 low < T* close
重新站回：跌破之后，首次 close >= T* close
```

全历史样本：

| 组别 | 跌破 T* close | 后续站回 | 站回率（在跌破样本中） | 站回距 T* 中位数 | 站回前 MAE 中位数 |
|---|---:|---:|---:|---:|---:|
| SUCCESS | 439/530 | 428/439 | 97.5% | 3.00 | -5.4% |
| FAILURE | 92/92 | 89/92 | 96.7% | 7.00 | -9.6% |

站回后的结果（从站回日收盘起算）：

| 组别 | 站回后 T+5 中位数 | 站回后 T+10 中位数 | 站回后 T+20 中位数 |
|---|---:|---:|---:|
| SUCCESS | 8.6% | 19.5% | 23.3% |
| FAILURE | -3.2% | -0.9% | -6.1% |

最近 Case 小样本方向：SUCCESS 7/7 站回，FAILURE 6/12 站回；SUCCESS 站回前 MAE 中位数约 -8.9%，FAILURE 约 -21.9%。

结论：大多数两组成员都曾有跌破，因此“跌破”本身不区分；更有价值的是站回速度、站回前 MAE、以及站回后能否延续。

## 4. H3：创新高后的保持能力

固定定义：

- A：T* 后出现 `high > T* high`；
- B：首次创新高后 5 个交易日内，出现更高收盘，且未先跌破 T* close；
- C：首次创新高后 5 个交易日内，先跌破 T* close，且没有先出现更高收盘；
- N：创新高但 5 日内既未满足 B 也未满足 C；NONE：未创新高。

全历史分类：

| 组别 | B 保持强势 | C 快速跌回 | N | NONE | B 占本组 B+C | C 占本组 B+C |
|---|---:|---:|---:|---:|---:|---:|
| SUCCESS | 453 | 74 | 3 | 0 | 86.0% | 14.0% |
| FAILURE | 65 | 27 | 0 | 0 | 70.7% | 29.3% |

注：最后两列是组内 B/C 占比。B 类有效样本的 SUCCESS 占比为 87.5%，C 类有效样本的 SUCCESS 占比为 73.3%；这不是可交易胜率。

创新高后收益与风险：

| 指标 | SUCCESS 中位数 | FAILURE 中位数 |
|---|---:|---:|
| 创新高后 3 日收益 | 11.6% | 7.8% |
| 创新高后 5 日收益 | 14.5% | 4.8% |
| 创新高后 10 日收益 | 20.0% | -4.1% |
| 创新高后 10 日 MAE | -5.2% | -11.3% |
| 创新高后 10 日 MFE | 36.4% | 28.4% |

MAE/MFE 中位数（创新高后 10 日）：SUCCESS 0.16，FAILURE 0.47。最近 Case 同方向：SUCCESS 1.12，FAILURE 3.06。

结论：创新高本身不是分化点，几乎所有两组事件都会创新高；分化来自创新高后能否保持、收盘能否继续抬升，以及 MAE/MFE 是否恶化。

## 5. H4：T* Close vs T+1 Open 执行口径比较

固定口径：

- A：T* 当日收盘价；
- B：T* 之后第一个可用的下一交易日开盘价（正常为 T*+1 开盘）；
- 收益目标仍为 T*+1/3/5/10/20 的收盘价；不加手续费、滑点、涨跌停成交约束。

全历史中位数：

| 期限 | A：T* Close 为锚 | B：T+1 Open 为锚 |
|---|---:|---:|
| T+1 | SUCCESS 9.0% / FAILURE 10.0% | SUCCESS 1.0% / FAILURE 0.0% |
| T+3 | SUCCESS 14.5% / FAILURE 14.2% | SUCCESS 11.2% / FAILURE 10.8% |
| T+5 | SUCCESS 17.8% / FAILURE 8.0% | SUCCESS 14.3% / FAILURE 7.5% |
| T+10 | SUCCESS 25.9% / FAILURE 1.9% | SUCCESS 22.7% / FAILURE -0.8% |
| T+20 | SUCCESS 35.7% / FAILURE -6.0% | SUCCESS 33.1% / FAILURE -11.0% |

T* close → T+1 open 的缺口中位数：SUCCESS 2.0%，FAILURE 3.2%。

口径差异：T+1 Open 作为锚点会明显拉低 T+1 收益，并在 T+10/T+20 放大失败组负收益；但 SUCCESS/FAILURE 的方向没有被消除。该结果仍不等于可执行收益，因为 T* 与次日开盘可能遭遇无法成交、停牌或涨跌停。

## 6. SUCCESS / FAILURE 的关键差异

| 维度 | 主要观察 | 分化强度 |
|---|---|---|
| 前期趋势 | 上一轮已见：前期 20/40/60 日差异小 | 弱 |
| T* 后 MAE | D3–D10 持续拉开，FAILURE 明显更深 | 中强 |
| 跌破后重新站回 | 两组都可能站回，但 SUCCESS 更快、站回前回撤更浅、站回后更强 | 强 |
| 创新高后保持 | 两组都创新高；B 与 C 的后续收益/MAE/MFE 差异明显 | 强 |
| 执行锚点 | T+1 Open 改变收益幅度，尤其放大 FAILURE 的 T+10/T+20 负值 | 中 |

综合判断：**最接近真正分叉点的是 T* 后的回撤恢复质量，以及创新高之后的保持能力；单纯“前期强”“曾经跌破”“曾经创新高”都较弱。**

## 7. 最有价值的 Pattern

- **Pattern A：回撤恢复质量**。SUCCESS 站回 T* close 的中位时间更短（约 3 日 vs 7 日），站回前 MAE 更浅（约 -5.4% vs -9.6%），站回后 T+20 中位数约 +23.3% vs -6.1%。
- **Pattern B：创新高后的保持能力**。几乎所有两组都会创新高；B 类保持强势组比 C 类快速跌回组有更高的后续 T+5/T+10 收益和更低的 MAE/MFE 比。
- **Pattern C：早分叉点**。两组在 D1 差异很小，D3 开始出现，D5/D10 更明显；关键不是第一次回撤，而是回撤后的恢复轨迹。
- **Pattern D：执行锚点不改变方向，但改变幅度**。T* 次日开盘口径下，失败组 T+20 中位数更低，成功组优势缩小但方向仍在。

## 8. 尚不能确认的 Pattern

- 不能确认“跌破—站回”本身是充分信号；全历史两组站回率都超过 96%，真正差异在速度和后续延续。
- 不能确认“创新高”本身是充分信号；两组几乎都创新高。
- 不能确认某一条精确回撤阈值、持有期或量能阈值——本轮没有做阈值优化。
- 最近 Case 只有 7 个 SUCCESS / 12 个 FAILURE，不能单独支撑稳定结论。
- 全历史样本为事件级，同一股票重复出现会放大某些行为；不能等同于独立股票横截面。
- 行业、题材和市值没有纳入分化判定；它们只能作为描述性背景。

## 9. 下一轮可验证 Hypothesis

- **H1**：固定研究“T* 后 D1–D5 恢复速度”是否比事件前趋势更能区分 T+20。
- **H2**：固定一个简单、非优化的“站回后保持”状态，研究站回当天之后的 5/10 日路径。
- **H3**：把“创新高后守住”与“创新高后快速跌回”分开，验证 B/C 分类是否在更早期就能观察。
- **H4**：用 T*+1 开盘和 T*+2 执行窗口重做，检验涨跌停/不可成交对结论的影响。
- **H5**：在独立时间段固定同一规则再检验，但下一轮不得把本轮结果直接升级为 Strategy 或参数搜索。

## 10. PIT / survivorship / event-anchor 风险

- `T*` 使用事件后数据才知道，是**事后研究锚点**，不能作为实时信号。
- 强势定义使用未来高点，成功/失败标签也使用 T*+20；所有结论都是事后标签分析。
- SUCCESS/FAILURE 的分界点 T* 可能是一字板或盘中触及不可成交，执行锚点 A/B 仍不能等同于真实成交。
- 未处理停牌、跌停无法卖出、涨跌停无法买入、手续费、滑点和冲击成本。
- 全历史样本为事件级，存在同一股票重复计数的 survivorship / clustering 风险。
- Dataset v8 的 `preWindowDays=0`，前期趋势使用原始历史行情补齐，必须确保事件日截断；本轮未使用事件后数据做前期特征。
- ST 排除依赖 Dataset v8 `excludeSt=true` 与库内 PIT 状态历史，仍存在状态历史覆盖和置信度限制。
- 最近 Case 存在右删失；CENSORED 未进入成功/失败比较。

## DISCOVERY_ONLY

**DISCOVERY_ONLY**

本轮不得升级为 Strategy，不创建 Candidate、Parameter Search、OOS/WFA 或交易结论。

## 附录：复现文件

- 指标 JSON：`C:\work\sourcecode\stock-limit-up-analyzer\scripts\_scratch\_pattern_reentry_strong_trend.json`
- 逐事件字段：`full[]` / `recent[]` 中包含 `firstBelowRd`、`reclaimRd`、`reclaimDays`、`reclaimMaeBefore`、`newHighRd`、`newHighCategory`、各期限 MAE/MFE、Anchor A/B 收益等原始记录。
- 上一轮 Discovery JSON：`C:\work\sourcecode\stock-limit-up-analyzer\scripts\_scratch\_pattern_discovery_full_history.json`
- Dataset：`datasetVersionId=780001`（v8）`ds_first_limit_pullback_event/prefix/post/path`

