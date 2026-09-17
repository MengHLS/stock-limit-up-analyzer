# WORK D 实施报告 — Corporate Actions + Adjustment Factors 真实落库

> STEP 12 数据地基建设：把 `corporate_actions`（公司行为）与 `adjustment_factors`（复权因子）两张表从 0 行变为有真实数据。
> 完成日期：2026-09-06

## 1. 结论摘要

- 已补齐 Tushare `dividend` / `adj_factor` provider 适配器（含纯解析器）、回填 CLI、单元测试，`npm run check` 通过、新增 8 个单测通过。
- **真实 DB 已写入真实数据（非 mock）**：`corporate_actions` = **81 行**、`adjustment_factors` = **102 行**，覆盖 600519.SH / 000001.SZ / 600036.SH 三只股票。
- **关键配额结论（与任务预期不一致，如实记录）**：Tushare `dividend` 与 `adj_factor` 两端点**均实测为 1 次/小时限频**（40203），并非任务描述的「dividend 大概率可用、adj_factor 大概率限频」。今日无法用 Tushare 全量回填，故真实落库改用**已就绪的 BaoStock bridge**（免配额，`source="baostock"`）完成；Tushare 适配器代码已就绪，待配额重置后执行 `npx tsx scripts/backfillCorporateActions.ts` 即可全量回填。

## 2. 改动文件清单

| 文件 | 说明 |
| --- | --- |
| `server/corporateActions/tushareProvider.ts` | 新增。Tushare `dividend`/`adj_factor` provider 适配器 + `parseTushareDividend`/`parseTushareAdjFactor` 纯解析器（每 10 股 → 每股 /10、PIT 三字段映射、adj_factor → fore/back 因子） |
| `server/corporateActions/tushareProvider.test.ts` | 新增。8 个纯解析器单测（字段解析、每股换算、送/转拆分、PIT、adj_factor 变化点转换） |
| `scripts/backfillCorporateActions.ts` | 新增。Tushare 回填 CLI（`--dry-run`/`--limit`/`--stocks`/`--skip-dividend`/`--skip-adj-factor`/`--force`/`--interval`，resume + 统计） |
| `scripts/backfillCorporateActionsBaostock.ts` | 新增。BaoStock 免配额落库 fallback（复用 STEP 7.7 bridge + 解析器 + storage upsert） |
| `scripts/_verify_corporate_actions.ts` | 新增。SQL 验证脚本（两表行数 / 样例股票 / 字段抽查） |

> 未改动任何现有文件：types/engine/provider/storage/validation 均未动，未动 OHLCV（`stock_daily_prices` 回填不受影响），未动 `daily` 接口。

## 3. 关键设计决策

1. **Tushare dividend 字段探测（以实测为准）**：`ts_code, end_date, ann_date, div_proc, stk_div, stk_bo_rate, stk_co_rate, cash_div, cash_div_tax, record_date, ex_date, pay_date, imp_ann_date, base_date`。同一分红年度返回多行（`div_proc` = 预案 / 股东大会通过 / 实施），仅 `实施` 行含 `ex_date`/`record_date`，故解析器只取 `div_proc="实施"`。

2. **PIT 语义（硬约束）**：`ann_date`→`announcementDate`、`record_date`→`recordDate`、`ex_date`→`effectiveDate`，三者严格区分；`ex_date` 缺失的行丢弃并计入 `missingExDate`，**禁止假设 announcementDate === effectiveDate**。同批内同一 `(effectiveDate, actionType)` 去重时保留公告日更早者（PIT 更保守）。

3. **每股单位换算（硬约束）**：Tushare `cash_div`/`stk_div`/`stk_bo_rate`/`stk_co_rate` 为「每 10 股」口径，写入前除以 10。已用真实数据交叉验证：BaoStock `dividCashPsBeforeTax` 为「每股」口径（无需除 10），而 Tushare 为「每 10 股」（必须除 10），两者差异已正确处理。

4. **adj_factor 转换**：Tushare `adj_factor` 是「后复权因子」（raw × adj_factor = 后复权价，最早日≈1），即项目 `backFactor`；前复权因子 `foreFactor(d) = adj_factor(d) / adj_factor(最新日)`（数学推导：back(d) = ∏1/f(e)[e≤d]，fore(d) = ∏f(e)[e>d] = back(d)/back(最新)）。解析器只保留「因子变化点」（除权除息日），首行基线不产出，与 BaoStock 累计因子的 dividOperateDate 语义对齐。

5. **幂等落库**：复用 `storage.ts` 的 `upsertCorporateActions`/`upsertAdjustmentFactors`（ON DUPLICATE KEY UPDATE），未新写任何写库逻辑。

## 4. 真实 DB 验证结果（SQL）

执行 `npx tsx scripts/_verify_corporate_actions.ts`：

| 表 | 行数 | 股票数 | 生效日区间 | source |
| --- | --- | --- | --- | --- |
| `corporate_actions` | **81** | 3 | 2004-05-11 ~ 2026-07-10 | baostock |
| `adjustment_factors` | **102** | 3 | 1991-04-03 ~ 2026-07-10 | baostock |

样例股票 600519.SH（贵州茅台）公司行为抽查（按生效日升序）：

```
dividend  effective=2004-07-01 record=2004-06-30 ann=2004-03-26 cash=0.3
transfer  effective=2004-07-01 record=2004-06-30 ann=2004-03-26 transfer=0.3
dividend  effective=2005-08-05 record=2005-08-04 ann=2005-04-23 cash=0.5
transfer  effective=2005-08-05 record=2005-08-04 ann=2005-04-23 transfer=0.2
```

- **每股换算正确**：2004 年「10 派 3 转 3」→ `cash=0.3`（元/股）、`transfer=0.3`（股/股）。
- **PIT 正确**：`record_date`（登记日）= `effective`（除权除息日）前一交易日；`ann_date`（公告日）早于两者，三者严格区分。
- 复权因子 600519.SH 前 5 条：`back` 单调递增（1 → 1.11828 → 1.239853 → 1.626076 → 1.969098），`fore` 单调趋近 1，符合累计因子语义。

### Tushare 解析器对真实探测数据的抽查

`parseTushareDividend` 单测数据取自 2026-09-06 真实 `dividend 600519.SH` 探测返回的「实施」行，逐字一致：

```
原始行（Tushare 每10股口径）:
  ["600519.SH","20251231","20260417","实施",0.0,null,null,28.02423,28.02423,"20260625","20260626",...]

解析输出（每股口径）:
  actionType=dividend  cashAmount=2.802423（28.02423/10）
  announcementDate=2026-04-17（ann_date）  recordDate=2026-06-25（record_date）  effectiveDate=2026-06-26（ex_date）
```

三字段严格区分、每 10 股 → 每股换算正确；`div_proc` 非「实施」行（预案/股东大会通过）被跳过。`parseTushareAdjFactor` 的 `fore=adj/latest` 推导已由 `adjustSeriesFromFactors` 引擎语义反推验证（见 §3.4）。

## 5. dividend / adj_factor 真实配额结论

| 端点 | 实测限频 | 结论 | 能否全量 |
| --- | --- | --- | --- |
| `dividend` | **1 次/小时**（40203） | **CONDITIONAL GAP** | 否（今日仅 1 次成功调用，其余均 40203） |
| `adj_factor` | **1 次/小时**（40203） | **CONDITIONAL GAP** | 否（今日仅 1 次成功调用，其余均 40203） |

- 实测时间线（2026-09-06）：`dividend 600519.SH` 成功 1 次 → `dividend 300750.SZ` 立即「1 次/分钟」→ 5 分钟后「1 次/小时」；`adj_factor 600519.SH` 成功 1 次 → 5 分钟后「1 次/小时」。据此判断该 token 为低配额档（约 1 次/小时/端点）。
- **任务预期修正**：任务假设「dividend 大概率可用（≤10 只）」不成立；实际 dividend 与 adj_factor 同样受 1 次/小时约束。
- **未伪造、未宣称完成全量**：dividend / adj_factor 的 Tushare 全量回填明确标注为 CONDITIONAL GAP。

## 6. Provider → Requested → Received → Persisted → Rejected → Failed → Checkpoint 统计

### BaoStock 真实落库（今日实际完成，source=baostock）

| 域 | Requested(股) | Received(原始行) | Persisted(落库行) | Rejected | Failed(股) | Checkpoint(股) |
| --- | --- | --- | --- | --- | --- | --- |
| dividend（公司行为） | 3 | 25+18+24=67 | **81**（含同日拆分多 actionType） | 0 | 0 | 3 |
| adj_factor（复权因子） | 3 | 31+41+30=102 | **102** | 0 | 0 | 3 |

### Tushare 回填（配额阻塞，今日未落库；CLI 已就绪）

| 域 | Requested | Received | Persisted | Rejected | Failed | Checkpoint |
| --- | --- | --- | --- | --- | --- | --- |
| dividend | 1（600519 探测成功） | ~30+ | 0（未写库） | — | 2（300750 两次 40203） | 0 |
| adj_factor | 1（600519 探测成功） | 1 年区间 | 0（未写库） | — | 1（000001 40203） | 0 |

> 说明：Tushare CLI 的统计口径为 `Requested`=请求股票数、`Received`=原始返回行数、`Persisted`=upsert 落库行数、`Rejected`=解析跳过（含 missingExDate）+校验 INVALID、`Failed`=请求失败股票数、`Checkpoint`=成功处理股票数（供 resume 跳过）。

## 7. 剩余 blocker / 风险

1. **Tushare 配额（主 blocker）**：`dividend` / `adj_factor` 均 1 次/小时。全量回填需多轮/多天，或升级 Tushare 积分档。配额重置后执行 `npx tsx scripts/backfillCorporateActions.ts --stocks=...` 即可（resume 幂等）。
2. **送转字段语义未用真实 Tushare 数据确认**：`stk_bo_rate`/`stk_co_rate` 的送/转映射基于 Tushare 官方字段命名（`stk_div`/`stk_bo_rate`=送股、`stk_co_rate`=转增）+ mock 单测；真实 送转 样本（如 300750.SZ）今日被限频未取到，待配额后抽查确认。
3. **BaoStock 已知缺口（沿用 STEP 7.7 结论）**：`dividend_data` 不含配股（rights_issue）/拆合股结构化字段，且可能漏掉部分特别/中期分红；事件分解完整性应以复权因子为交叉校验，不能只依赖 dividend_data。
4. **source 混用风险**：`adjustment_factors` 唯一键为 `(securityCode, effectiveDate)`，同一股票先后用 baostock / tushare 回填会互相覆盖（后写胜出）。全量回填时建议同一股票固定单一 provider 来源。

## 8. PIT / Survivorship 影响

- **PIT**：`effectiveDate`（除权除息日）为复权引擎唯一生效时点；`announcementDate`（公告日）供上层做 availability 过滤（决策时点能否「得知」该事件），本层不混同两者。Tushare 的 `ann_date` 为预案公告日（最早的公开披露），PIT 上偏保守（更早可知），符合「禁止假设 announcementDate===effectiveDate」。
- **Survivorship**：本次落库仅覆盖 3 只存续中的知名股票，未涉及退市股；公司行为/复权因子天然不存在「幸存者偏差」（每只股票各自独立的事件序列），但**若后续用于全市场回测**，需保证退市股的事件序列也齐备，否则样本池会偏「存活者」。该约束与 `research_securities` 的 L/D/P 全量（WORK B）联动。

## 9. 复现 / 运行

```bash
# 单元测试
npx vitest run server/corporateActions/

# Tushare 回填（配额重置后，1 次/小时，节制）
npx tsx scripts/backfillCorporateActions.ts --stocks=600519.SH,000001.SZ,600036.SH

# Tushare 预览（不写库）
npx tsx scripts/backfillCorporateActions.ts --dry-run --stocks=600519.SH

# BaoStock 免配额落库（真实数据 fallback）
BAOSTOCK_PYTHON="C:/Python312/python.exe" \
BAOSTOCK_PYTHONPATH="C:/Users/A/AppData/Roaming/Python/Python312/site-packages" \
npx tsx scripts/backfillCorporateActionsBaostock.ts --stocks=600519.SH,000001.SZ,600036.SH

# SQL 验证
npx tsx scripts/_verify_corporate_actions.ts
```
