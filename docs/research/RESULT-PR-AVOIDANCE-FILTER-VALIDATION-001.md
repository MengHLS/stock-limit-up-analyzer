# RESULT-PR-AVOIDANCE-FILTER-VALIDATION-001

> 生成日期：2026-10-06（Asia/Shanghai）
> datasetVersionId=780001；RCP-P0-v1；PIT-adjusted PR score = `C_T/reclaimLevel-1`
> 信号 T 收盘；执行 raw T+1 Open → raw T+1 Close；成本：佣金 0.025%/边 + 过户费 0.001%/边 + 滑点 5bps/边 + 印花税 0.1%/0.05%（按日期）
> 成交约束：T+1 停牌/无 bar/缺价、开盘涨停不可买、收盘跌停不可卖 → 剔除
> 未创建 Strategy；未做 Parameter Search / Composite / OOS / WFA；未修改 PR 定义/阈值

## 0. Gate

```text
PR_NO_AVOIDANCE_VALUE
```

**核心判据 `Excluded-Top Pool > Full Pool` 不成立（至少在 Exclude Top 10% 上已被证明不成立）。**

## 1. 本轮执行情况（重要限制，先声明）

本次为验证 Exclude Top10/20/30% 而扩展并重跑了 PR T+1 引擎（新增 ex10/ex20/ex30 桶、成本前收益、换手率统计）。**该长任务被外部环境连续 2 次静默 kill（exit -1 / exit 1，均停在 bar streaming 阶段，无异常堆栈），因此 ex20 / ex30 的逐日序列、CAGR、最大回撤、逐年与换手率结果本次未取得。** 为避免伪造，本报告：

- 对 **Exclude Top 10%** 给出**严格可推导**的结果（由已完成的 PR TopN 任务的全 Pool 与 Top10 日均精确线性推导，二者都是等权日均、口径完全一致）；
- 对 **Exclude Top 20% / 30%** 明确标注 `NOT CERTIFIED`（本轮未测得，不得据此下结论）；
- 不做任何阈值/方向调参。

## 2. Exclude Top 10%：解析推导（口径与 TopN 任务完全一致）

设每日 RCP 可成交成员 n，Pool 为全部 n 的等权日均，Top10 为 score 最高的 10%（等权日均）。则"排除 Top10% 后剩余 90%"的当日等权均值满足：

`Ex10 = (Pool − 0.10 × Top10) / 0.90`（逐日成立，故均值也成立）

用已完成的 PR TopN 扣成本结果（全历史）：

| 组合（扣成本） | T+1 日均 | CAGR | 最大回撤 | 日胜率 |
|---|---:|---:|---:|---:|
| Full Pool | -0.0781% | -19.39% | -85.08% | 49.10% |
| Top 10%（被排除组） | -0.0258% | -7.95% | -68.40% | 49.21% |
| **Exclude Top 10%（剩余 90%）** | **-0.0839%** | NOT CERTIFIED* | NOT CERTIFIED* | NOT CERTIFIED* |

\* `Ex10` 的日均由可认证数据精确推导；其 CAGR / 最大回撤 / 逐日 t / 逐年需要逐日序列，本次未取得。

**逐日 spread 方向：`Ex10 − Pool` 的每日值 = `(Pool − 0.1×Top10)/0.9 − Pool = (0.1/0.9)×(Pool − Top10) = -0.0805%`（日均）。**
即：**排除 Top10% 后，剩余 Pool 比原 Pool 更差**（-0.0839% vs -0.0781%），spread 为负。**`Excluded-Top Pool > Full Pool` 在 10% 上不成立。**

含义：PR Top10% 不是池内最弱的一组，而是**比池均值更好**的一组（-0.0258% vs -0.0781%）；把它们剔除会拉低剩余池。PR 的高分并不代表"未来 T+1 相对弱势"。

## 3. 分布形状：PR score 与 T+1 收益是 U 形，不是单调规避信号

由 Pool / Top10 / Bottom10 的日均可解出中间 8 个十分位的平均：

`0.1×D1 + 0.1×D10 + 0.8×avg(D2..D9) = Pool`
`0.1×(-0.0258%) + 0.1×(+0.0029%) + 0.8×avg(D2..D9) = -0.0781%`
⇒ `avg(D2..D9) ≈ -0.0948%`

| 分组 | T+1 日均（扣成本） |
|---|---:|
| Top10（D1） | -0.0258% |
| 中间 80%（D2..D9） | **-0.0948%** |
| Bottom10（D10） | +0.0029% |

**最弱的是中间 80%，不是高分端。** 高分端与低分端都相对更好（U 形）。因此"排除 PR 高分以规避未来弱势"在机制上不成立：高分端不是弱势来源。

## 4. Rank IC（来自已完成的 PR T+1 任务）

| 指标 | 值 |
|---|---:|
| mean IC | **-0.0060** |
| ICIR | -0.041 |
| IC 正日占比 | 48.34% |

PR score 与 T+1 净收益**没有正向秩相关**；结合第 3 节的 U 形，这进一步说明不存在单调的"高分=弱势"规避信号。

## 5. 其余要求的回答状态

| 问题 | 回答 |
|---|---|
| 1. 排除 PR 高分后，剩余 Pool 是否稳定优于原 Pool？ | **否（Exclude Top10 已被证明更差 -0.0839% vs -0.0781%）**；20%/30% 未测得 |
| 2. 排除 10%/20%/30% 是否方向一致？ | **无法认证 20%/30%**（任务被 kill）；10% 为负向改善 |
| 3. 改善是否跨三个时期？ | 10% 为负改善（不改善）；三时期分解未测得 |
| 4. Exclude Top10 是否比直接用 PR TopN 更稳定？ | 无证据：Ex10 比 Pool 更差；TopN−Pool 为正但 Top<Bottom、IC≈0 |
| 5. 是否只是减少高换手/不可成交股票导致成本下降？ | 未测得（换手率统计未完成）；理论上 Ex10 换手低于 TopN，但其毛/净收益方向已被解析为负 |
| 6. PR 是否真正提供"规避未来 T+1 相对弱势股票"的信息？ | **否**：高分端相对更强、中间 80% 最弱，IC≈0，无单调规避信息 |

**成本前 / 成本后**：本次成本前序列未测得（NOT CERTIFIED）。但 Ex10 的**扣成本日均**已由相同口径的扣成本 Pool/Top10 精确推导；成本前 Ex10 的符号无法从该恒等式单独推出（需要毛收益的 Top10/Pool 均值，TopN 任务有记录但 Ex10 的毛序列未取得）。

## 6. 已知残余风险 / 限制

1. **数据不完整**：ex20 / ex30、Ex10 的 CAGR/最大回撤/逐年/换手率、成本前序列均未测得——原因是本任务长读作业被环境连续 kill。任何后续结论必须重跑补齐，**不得用本轮缺失数据做判断**。
2. **Exclude Top10 的日均结论是精确的**（逐日恒等式 + 两份已完成结果），不是近似；但它只覆盖 10% 这一档。
3. **U 形分布**是解析结论（由 D1/D10/Pool 三个已认证日均推出），提示 PR 更适合"避开中间组"而不是"避开高分端"，但这也只是一个待验证的假设，本轮不作为 gate 依据。
4. 未修改 PR 定义/阈值、RCP-P0-v1、dataset v8；未创建 Strategy。

## 7. 产物

| 产物 | 路径 | 状态 |
|---|---|---|
| 本报告 | RESULT-PR-AVOIDANCE-FILTER-VALIDATION-001.md | 完成 |
| PR TopN 基准结果 | scripts/_scratch/_pr_topn_forward_validation_001_topn.json | 已完成（用于解析推导） |
| PR 规避脚本 | scripts/_scratch/_pr_topn_forward_validation_001.mjs（已扩展 ex10/ex20/ex30 + 成本前 + 换手） | 已就绪，未完整运行 |
| 规避结果 JSON | scripts/_scratch/_pr_avoidance_validation_001.json | **未生成（任务被 kill）** |

**下一阶段**：本轮 Gate 为 `PR_NO_AVOIDANCE_VALUE`。若仍要评估 20%/30% 档，必须先重跑 `_pr_topn_forward_validation_001.mjs`（已含 ex10/ex20/ex30 逻辑）并补齐逐日序列；在补齐前，PR 不得作为规避因子进入任何 TopN/Strategy 研究。
