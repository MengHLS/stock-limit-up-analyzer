# STEP 7.3 — 回填覆盖度报告（Backfill Coverage）

> 报告日期：2026-09-06
> 状态：**PILOT / 全量回填尚未执行** —— 覆盖度审计待真实回填后由 DB 侧聚合填充

---

## 一、当前状态

本报告对应的覆盖度审计（§22–§23）依赖**真实回填后的 DB 聚合数据**。截至本报告生成：

- ❌ 未对生产库执行 Pilot（3 交易日）；
- ❌ 未执行 5–10 连续交易日回填；
- ❌ 未执行全市场 2019-01-01 → 当前回填；
- ✅ 覆盖度计算与聚合代码已实现并就绪（见下）。

因此本报告**无可审计的实盘覆盖度数字**，仅能说明「覆盖度审计能力已就绪」及预期目标。

## 二、覆盖度审计能力（已实现）

`server/backfill/coverage.ts` 提供：

| 函数 | 能力 |
|------|------|
| `buildCoverageReport()` | 生成 target/completed/failed/suspicious/missing 日期集合 + min/max/avg + perYear |
| `isSuspiciousCoverage()` | 基于 median 行数检测可疑覆盖 |
| `median()` | 中位数计算 |

`server/backfill/dbRead.ts` 提供 DB 侧聚合（**不全表加载**）：

| 函数 | 能力 |
|------|------|
| `queryDailyAggregates` | 按日聚合行数 |
| `queryYearlyAggregates` | 按年聚合 |
| `queryDuplicateCount` | 重复键计数 |
| `queryDistinctSymbolCount` | 去重标的数 |

> 注意：`buildCoverageReport()` 为纯函数，`distinctSymbols` 置 0，实际由 `queryDistinctSymbolCount`（DB 聚合）填充 —— 避免在纯函数内做全表扫描。

## 三、回填后的预期目标（供验收）

| 指标 | 目标 |
|------|------|
| 覆盖区间 | 2019-01-01 → 当前（~8.95M stock-day） |
| 交易日覆盖 | 与 `trade_cal` 交易日集合对齐 |
| 单日标的数 | 约 4000–5500（随年份增长：3632→4851→5547→5406） |
| 可疑日 | 行数显著低于 median 的日期需标记 SUSPICIOUS |
| 缺失日期 | 交易日集合 − 已回填日期集合 |

## 四、如何生成实盘覆盖度报告

回填完成后，运行覆盖度审计脚本（或调用 `buildCoverageReport` + DB 聚合），输出：

- 目标/已完成/失败/可疑/缺失 日期清单；
- 各年覆盖统计；
- 去重标的数、重复键数。

> 见 `STEP_7.3_IMPLEMENTATION_REPORT.md` 第九节 CLI 操作步骤。

---

## 五、结论

覆盖度**审计能力已就绪**，但**实盘覆盖度数字待回填后生成**。当前不可据此声称覆盖度达标。
