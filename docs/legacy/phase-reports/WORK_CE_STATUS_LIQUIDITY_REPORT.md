# WORK C+E — Status + Liquidity 合并回填报告

> STEP 12 数据地基建设 · 用 BaoStock 逐股日线同时回填 `research_security_status_history`
> （历史交易状态：停牌/ST）与 `liquidity_daily`（流动性）。
>
> 生成时间：2026-09-06

## 1. 核心洞察落地

BaoStock `query_history_k_data_plus` 一次请求同时返回 `tradestatus`（1=交易 0=停牌）、
`isST`（1=ST 0=正常）、`turn`（换手率%）、`amount`（成交额元）、`volume`（成交量股）。
因此 Status（停牌 + ST）与 Liquidity 合并为**一次逐股回填**，避免对同一股票重复请求。

## 2. 改动文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/providers/baostock_probe.py` | 改 | `stock_daily` 命令加 `isST` 字段；**新增 5 年切片分页**，绕过 `query_history_k_data_plus` 单次 ~4000 行上限 |
| `server/securityStatus/baostockStatus.ts` | 新 | 纯函数：`inferSuspensionIntervals` / `inferStIntervals` / `inferBaostockStatusIntervals` / `mergeConsecutiveRuns` |
| `server/securityStatus/baostockStatus.test.ts` | 新 | 10 个单测：停牌段合并 / ST 段 / 边界 / null 字段 / 权威 vs 推断标注 |
| `server/marketData/liquidityStorage.ts` | 新 | `liquidityBarToInsert` / `upsertLiquidityDaily` / `getBackfilledSecurityCodes` / `liquidityDailyIdempotencyKey` |
| `server/marketData/liquidityStorage.test.ts` | 新 | 6 个单测：单位换算复用 / 幂等键 / bar→insert 映射 / resume 读取 |
| `server/marketData/providers/baostock.ts` | 改 | `BaostockStockRow` 增补可选 `isST?: string` 字段（流动性解析不使用，仅类型对齐 bridge 返回） |
| `scripts/backfillStatusLiquidity.ts` | 新 | 回填 CLI：`--dry-run` / `--limit` / `--codes` / `--from` / `--to` / `--interval` / `--no-resume`，含统计与 checkpoint |

未改动：`server/securityStatus/` 既有纯函数（`timeline.ts` / `validation.ts` / `pointInTime.ts` /
`suspensionAdapter.ts` / `types.ts`）、`server/marketData/liquidity.ts`、OHLCV 相关代码。
（`upsertSecurityStatusIntervals` 为普通 insert、无唯一约束，幂等去重由 CLI 完成，见 §5。）

## 3. 真实 DB 验证结果（小样本，4 只股票）

`--codes=sh.600000,sz.000017,sz.000029,sh.600485`（浦发银行 / 深中华A / 深深房A / *ST信威）：

| 表 | 行数 | 说明 |
|----|------|------|
| `liquidity_daily` | **27,246**（4 distinct code） | 逐日流动性 |
| `research_security_status_history` | **152** | SUSPENSION=149、ST=3 |

**停牌区间抽查**（`SUSPENSION/SUSPENDED`，`src=baostock-daily conf=medium avail=UNKNOWN`）：
- `sec_d3ddc569…`（000029.SZ 深深房A）`SUSPENDED 2000-01-14~2000-01-14` 等（含其 2016–2020 长停牌段）
- `sec_12d6e2fe…`（600485.SH 信威）长期停牌窗口

**ST 区间抽查**（`ST/ST`）：
- `000017.SZ 深中华A`：`ST 1999-05-04~2014-05-13`、`ST 2020-04-29~2021-06-21`
- `600485.SH 信威`：`ST 2019-04-30~2021-05-31`

**流动性单位抽查**（`600000.SH` 2026-09-04）：
- `turnoverRate=0.2275`（% 原样）
- `amount=712270.967`（千元，raw 元 ×0.001）
- `volume=757659.82`（手，raw 股 ×0.01）
- `circulationMarketCap=null`、`totalMarketCap=null`（BaoStock 无市值 → 显式 UNAVAILABLE）
- `securityId=sec_2d017cf1…`（确定性身份软引用，非 null）

## 4. authoritative vs inferred 诚实说明

| 维度 | 权威部分 | 推断部分 | 标注方式 |
|------|----------|----------|----------|
| 停牌 | `tradestatus=0` 是 BaoStock 日线**权威字段**（该交易日停牌为 provider 事实，非缺口反推） | 连续 `tradestatus=0` 交易日合并成区间 `[effectiveFrom, effectiveTo]` 是 **gap inference**（真实起止含非交易日的自然日边界、公告生效日无法仅凭日线确定） | `source="baostock-daily"`、`confidence="medium"`、`availability="UNKNOWN"` |
| ST | `isST=1` 是 BaoStock **权威字段** | 连续 `isST=1` 段合并成 ST 区间是推断；`isST` 二进制**无法区分 ST 与 \*ST**，统一记 `ST`（不越级伪造 \*ST） | 同上 |

- 逐日观测是权威的，区间边界是推断的 → 用 `confidence=medium` 诚实表达区间级不确定性，
  而不是伪装成 `high`（对比 `suspensionAdapter.ts` 中 manual=high / 日线反推=medium 的口径）。
- `availability=UNKNOWN`：日线为收盘后发布，精确公告时间未知，不擅自假设 T+1。

## 5. 单位换算（复用，未自行乘除）

完全复用 `normalizeLiquidity("baostock-daily", raw)`（`server/marketData/liquidity.ts`）的
`LIQUIDITY_PROVIDER_SCALES`：
- `volume` 股 → 手 ×0.01
- `amount` 元 → 千元 ×0.001
- `turnoverRate` % 原样 ×1
- `circulation/total marketCap` 不可提供 → null

CLI 中通过 `parseBaostockStockDaily`（`baostock.ts`，内部调 `normalizeLiquidity`）产出 canonical bar，
`liquidityStorage.liquidityBarToInsert` 只做键映射，**无任何单位乘除**。

## 6. 全量 checkpoint 进度

- **已回填并通过验证**：4 只股票（小样本）。checkpoint 文件：
  `scripts/_backfill_status_liquidity_checkpoint.json` → `{ processed: 4, lastCode: "600485.SH" }`。
- **全量 5552 股 = PENDING**，受两个 BaoStock 免费接口硬限制阻塞（见 §7）。

## 7. 剩余 gap（诚实上报）

1. **`query_history_k_data_plus` 单次 ~4000 行上限**：长上市股票（如 600000，全量 6501 行）
   一次请求会被静默截断到 4000 行（实测止于 2016-05-20）。**已修复**：bridge 内按 5 年切片分页，
   实测 600000 全量 6501 行完整返回（1999-11-10~2026-09-04）。
2. **`query_stock_basic` 单次 2000 行上限**：全市场约 8940 行，实测单次只返回前 2000 行
   （type=1 股票仅 298 只，止于 sh.600332）。因此 stock_basic 无法一次枚举完整 5552 股 universe，
   CLI 已加 warning 诚实上报。完整 universe 需：改用 Tushare `stock_basic`（约 5 次/天硬配额）、
   或分页枚举、或静态 universe 清单。
3. **BaoStock 免费接口登录限频**：连续逐股 login/logout 会触发「用户未登录」/ login 挂起。
   小样本（4 股）与链路验证不受影响，但全量逐股需更保守节流与退避重试。
   当前 CLI 每只股票间隔 ≥300ms（`--interval` 下限 300），但单进程每只股票都重新 login 的
   bridge 模式在 5552 股规模下仍偏重；若要全量，建议引入「单 login 批量逐股」bridge 命令
   （参照 `baostock_corporate_actions.py` 的 `dividend_data_batch` 模式）。

## 8. 验收对照

- `npm run check`（tsc --noEmit）**通过** ✓
- 新增 16 个单测**通过** ✓（`baostockStatus.test.ts` 10 + `liquidityStorage.test.ts` 6）
- 两表真实数据 **>0 行** ✓（liquidity 27,246 / status 152）
- 报告文件：本文件 ✓

> 附注：`npm run check` 首跑时曾报两处 WORK G（industry）遗留类型错误
> （`IndustryAssignment` 缺 `securityCode`），与本任务（WORK C+E）无关、亦非本任务改动引入；
> 该错误在共享工作区中被并发进行的其他 work item 修正，当前 `tsc --noEmit` 全绿。
> 本任务**未修改** `industryStorage.ts` / `parseBaostockIndustry` 等 industry 文件。
