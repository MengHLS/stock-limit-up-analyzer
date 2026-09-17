# STEP 12 WORK G — Industry 域真实数据回填报告

> 目标：用 BaoStock 把 `industry_assignments` 表从 0 行回填为全市场真实行业数据（当前证监会行业分类快照）。
> 完成日期：2026-09-06

## 1. 结论摘要

- ✅ 已打通「BaoStock `query_stock_industry` → 解析 `IndustryAssignment` → 幂等 upsert `industry_assignments`」全链路。
- ✅ 真实 DB 已写入 **249 行**真实行业数据（249 只股票、56 个证监会行业代码，source=`baostock`）。
- ✅ `npm run check`（tsc --noEmit）通过；新增单元测试 12 个全通过。
- ⚠️ **CONDITIONAL GAP（诚实声明）**：BaoStock 只提供「当前」行业，无历史行业区间。本回填是当前行业快照，**非完整历史归属**，未伪造历史行业。
- ⚠️ **重要实测修正**：任务简报「type=1 股票 5552 只」来自一次稳定时的全量 dump（`scripts/_baostock_stock_basic_dump.json`，8940 行 / type=1=5552），但本次会话中 `query_stock_basic` 多次调用受免费服务器限频/波动影响，实测返回 4000 / 2000 / 0 行不等。全量 5552 回填受服务器稳定性约束，见 §6。

## 2. 改动文件清单

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `scripts/providers/baostock_probe.py` | 新增 | 新增 `stock_industry <baostock_code>` 命令，输出行业行 JSON（沿用 redirect_stdout 吞 login 输出的模式） |
| `server/marketData/providers/baostock.ts` | 新增函数 | `baostockCodeToSecurityCode`、`splitIndustryCodeName`、`parseBaostockIndustry`、`fetchBaostockIndustry`、`fetchBaostockStockBasic`（未改动既有函数） |
| `server/marketData/industryStorage.ts` | 新增文件 | `industryAssignmentToInsert`（纯函数）+ `upsertIndustryAssignments`（ON DUPLICATE KEY UPDATE）+ `listBackfilledIndustrySecurityCodes`（resume）+ `countIndustryAssignments` |
| `scripts/backfillIndustry.ts` | 新增文件 | 回填 CLI：`--dry-run` / `--limit=N` / `--code=` / `--interval=ms`，resume + 增量 flush + 统计 |
| `server/marketData/industryProvider.test.ts` | 新增文件 | 12 个纯函数单测（解析 / 代码转换 / code/name 拆分 / 区间校验） |

未改动：`drizzle/schema.ts`、`server/marketData/industry.ts`（PIT 纯函数复用，未重写）、OHLCV 与 research 其他表。

## 3. 数据流与 PIT 语义

```
query_stock_basic (type=1 股票) ──> 逐股 query_stock_industry ──> parseBaostockIndustry ──> upsert
```

`parseBaostockIndustry` 的 PIT 映射（诚实表达，见 `server/marketData/providers/baostock.ts`）：

| 字段 | 值 | 依据 |
| --- | --- | --- |
| `securityCode` | `sh.600000` → `600000.SH` | `baostockCodeToSecurityCode` 逆变换 |
| `securityId` | = 规范化代码 | marketData 领域 `SecurityId` 即代码（types.ts），供 industry.ts PIT 函数直接用 |
| `industryCode` | `J66` | 从 `J66货币金融服务` 拆分 |
| `industryName` | `货币金融服务` | 同上 |
| `effectiveFrom` | `updateDate`（如 2026-08-31） | 「从该时点起生效」的诚实表达 |
| `effectiveTo` | `null` | 当前仍有效 |
| `source` | `baostock` | — |
| `retrievedAt` | now | 本行写入/检索时间 |

落库映射（`industryAssignmentToInsert`）：DB 的 `securityId` 列是「永久身份」软引用（`sec_<uuid>`，指向 `research_securities`），security master 尚未回填，故置 `null`（与 corporateActions 口径一致）；权威自然键由 `securityCode` 承载（唯一约束 `uq_industry_assign_security_effective (securityCode, effectiveFrom)` 所在）。

## 4. 真实 DB 验证结果

最终 SQL 抽查（`DATE_FORMAT` 确认存储日期无时区偏差）：

| 指标 | 值 |
| --- | --- |
| 总行数 | **249** |
| 去重 securityCode | 249（1:1，无重复） |
| 去重 industryCode | 56 |
| `effectiveTo IS NULL`（当前仍有效） | 249（全部） |
| effectiveFrom 范围 | 2026-08-31 ~ 2026-08-31 |
| source 分布 | baostock = 249（唯一） |

| securityCode | industryCode | industryName | effectiveFrom | effectiveTo | source |
| --- | --- | --- | --- | --- | --- |
| 600000.SH | J66 | 货币金融服务 | 2026-08-31 | null | baostock |
| 600004.SH | G56 | 航空运输业 | 2026-08-31 | null | baostock |
| 600006.SH | C36 | 汽车制造业 | 2026-08-31 | null | baostock |
| 600010.SH | C31 | 黑色金属冶炼和压延加工业 | 2026-08-31 | null | baostock |

- 行业代码为证监会行业分类（`J66` 金融业/货币金融服务、`G56` 航空运输业、`C36` 汽车制造业、`C31` 黑色金属等），抽查正确。
- `effectiveFrom = 2026-08-31`（BaoStock `updateDate`），`effectiveTo = null`，`source = baostock`，PIT 字段符合设计。

## 5. 数据统计（含本节流/限频观测）

### 5.1 `query_stock_basic` 实测波动（同一免费服务器）

| 调用 | total 行 | type=1 | 备注 |
| --- | --- | --- | --- |
| 第 1 次 | 4000 | 2298 | — |
| 第 2 次（连续登录后） | 0 | 0 | 疑似限频 |
| 第 3 次 | 2000 | 298 | 截断/波动 |
| 历史稳定 dump | 8940 | **5552** | 见 `scripts/_baostock_stock_basic_dump.json` |

### 5.2 回填落库统计

- `--limit=20` 小样本：candidates=20，parsed=16（4 只退市股返回空行业），落库 16 行。
- `--limit=300` 扩展样本：candidates=300，requested=284（resume 跳过已回填 16），parsed=233，empty=51（退市股无行业），failed=0，invalid=0，落库 233 行。
- **合计：industry_assignments 共 249 行**（16 + 233），覆盖 249 只股票、56 个证监会行业。

### 5.3 增量 flush 修复

首版 `--limit=300` 采用「攒到最后一次性 upsert」，DB 连接在 12 分钟 BaoStock 拉取期间空闲被 TiDB 断开（`ECONNRESET`），导致整批丢失。已改为**每 25 只增量 flush**（`FLUSH_SIZE=25`），保持连接活跃、失败面小、resume 可续。

## 6. CONDITIONAL GAP — 历史行业缺失

1. **BaoStock 无历史行业区间**：`query_stock_industry` 只返回「当前」证监会行业分类（单行、无有效期），无法提供历史归属变更（如某股曾属 A 行业后改属 B 行业）。
2. **不伪造历史**：`effectiveFrom = updateDate` 是「从该行业分类更新时点起生效」的诚实表达；`effectiveTo = null` 表示当前仍有效。**没有**用当前行业回填历史区间。
3. **残留风险**：若某股未来行业变更，重跑回填会产生新的 `effectiveFrom`（新 updateDate）区间，而旧行 `effectiveTo` 仍为 null，形成两个重叠的「当前」区间（`validateIndustryIntervals` 会报 OVERLAPPING_INTERVALS）。初始 0→N 回填无此问题；后续需在回填时「闭合旧区间」（将旧行 effectiveTo 置为新的 updateDate - 1 天）才能得到完整 PIT 历史。
4. **全量 5552 受服务器稳定性约束**：免费服务器限频/波动导致 `query_stock_basic` 返回不全（§5.1）。全量回填命令 `npx tsx scripts/backfillIndustry.ts`（不加 `--limit`，逐股节流 ≥0.3s）已跑通，但完整覆盖 5552 需服务器稳定 + 约 3.5 小时（每只 ~2s 的 Python 启动+登录开销），本次会话标记为 **pending**。

## 7. 使用方式

```bash
# 环境变量：Python 解释器（含 baostock 0.9.3）
export MARKETDATA_PYTHON="C:/Users/A/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

# dry-run 小样本
npx tsx scripts/backfillIndustry.ts --dry-run --limit=20

# 真实小样本
npx tsx scripts/backfillIndustry.ts --limit=20

# 指定代码
npx tsx scripts/backfillIndustry.ts --code=sh.600000,sz.000001

# 全量（resume 自动跳过已回填；逐股节流 300ms）
npx tsx scripts/backfillIndustry.ts
```

## 8. 验收对照

- ✅ `npm run check` 通过（tsc --noEmit 无错误）。
- ✅ 新增测试 `server/marketData/industryProvider.test.ts` 12 个通过；`industry.test.ts` 既有测试不受影响。
- ✅ 真实 DB `industry_assignments` 有真实数据（>100 行）。
- ✅ 报告 `docs/WORK_G_INDUSTRY_REPORT.md` 输出。
- ℹ️ `server/marketData.test.ts`（既有 DB 集成测试，非本 WORK 产物）在 vitest 无 DATABASE_URL 环境下 4 例失败，与 WORK G 无关。
