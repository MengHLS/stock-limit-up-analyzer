# WORK B（BaoStock 全量）实施报告 — Security Master 全市场回填

> STEP 12 WORK B：用 BaoStock（免费无配额）替代 Tushare stock_basic，把
> `research_securities` + `research_security_identifier_history` 从 1 行回填为全市场真实数据。
> 完成日期：2026-09-06

## 1. 结论摘要

- ✅ 已用 BaoStock `query_stock_basic` 全量回填 A 股证券主数据（**含退市股**，anti-survivorship-bias）。
- ✅ `research_securities` = **5552 行**、`research_security_identifier_history` = **5552 行**（均 > 5000）。
- ✅ 退市股 **337 只** 已正确落入（`status=delisted`、`delistedDate` 非空）。
- ✅ securityId 与已有 1 行（`000001.SZ` → `sec_d5e57ebc-8bbb-4f2b-9784-5319a434ab11`）**完全一致**，未产生重复 identity。
- ✅ `npm run check` 通过；`server/security/` 下 123 个测试全部通过（含新增 7 个 BaoStock 解析测试）。
- ⚠️ 名称历史 / 改名（namechange）与退市后代码复用（code reuse）为 **CONDITIONAL GAP**（见 §5），未伪造。

## 2. 改动文件清单

| 文件 | 说明 |
| --- | --- |
| `server/security/baostock.ts` | 新增。BaoStock `stock_basic` Provider + `parseBaoStockStockBasic` 纯解析器 + 多尝试去重并集拉取 |
| `server/security/baostock.test.ts` | 新增。BaoStock 解析单测（code 转换 / type 过滤 / 退市映射，7 个用例） |
| `server/security/index.ts` | 修改。导出 `./baostock` |
| `scripts/backfillSecurityMasterBaostock.ts` | 新增。回填 CLI（`--fetch` / `--input` / `--dump` / `--dry-run` / `--limit` / `--attempts` / `--python`） |
| `scripts/_verify_security_master_baostock.ts` | 新增。SQL 验证脚本（两表行数 / status/exchange 分布 / 退市股 / 锚点 / code reuse） |
| `scripts/_baostock_stock_basic_dump.json` | 辅助。BaoStock 原始行 fixture（8940 行，供离线回放 `--input` 复现） |
| `docs/WORK_B_BAOSTOCK_FULL_REPORT.md` | 本报告 |

未改动：`drizzle/schema.ts`、`deterministicId.ts`、`buildSecurityMaster.ts`、`repository.ts`、`provider.ts`、`db.ts`、OHLCV（`stock_daily_prices`）相关代码 —— 全部复用，不重写。

## 3. 关键设计决策

1. **确定性 securityId 复用**：沿用 `securityIdAnchorForTsCode("600000.SH")` = `tushare:600000.SH`，SHA-1 → `sec_<uuid>`。**锚点格式保持 Tushare 风格**（`tushare:<code>.<exchange>`），BaoStock 的 `sh.600000` 在解析时转为 `600000.SH` 再进锚点，保证与既有 `000001.SZ` 行一致、不产生重复 identity。

2. **BaoStock code 转换**：`sh.` → `SH`、`sz.` → `SZ`、`bj.` → `BJ`（`bj.` 当前实测无数据，预留）。`type=1` 才算股票；`outDate` 非空 = 退市日（`delistedDate`），`ipoDate` = 上市日（`listedDate`）。

3. **过滤**：只落 `type=1` 股票（含退市股 337 只）。指数（`type=2`）、基金（`type=4`）、债（`type=5`）不落库。

4. **BaoStock 后端不稳定对抗（重要实测发现）**：`query_stock_basic` 单次登录仅第一次查询有效（后续返回 0 行）；跨会话偶发**截断**（返回 2000/4000/6000/8000 行而非全量 8940 行）或 `用户未登录` 报错。Provider 采用「**多尝试（默认 12 次，间隔 3s）+ 按 code 去重并集 + 拿到完整快照（≥8900 行）即提前停止**」。实测 2~9 次尝试内收敛到全量 8940 行。

5. **幂等 + resume**：复用 `repository.upsertSecurityMaster`（`ON DUPLICATE KEY UPDATE`）。`research_securities` 按唯一键 `securityId`、identifier history 按唯一键 `(exchange, securityCode, identifierType, effectiveFrom)` upsert。中断/截断后重跑即续跑（按 securityId 去重），无需显式 checkpoint。

## 4. 真实 DB 验证结果（SQL）

执行 `npx tsx scripts/_verify_security_master_baostock.ts`：

| 指标 | 值 |
| --- | --- |
| `research_securities` 行数 | **5552** |
| `research_security_identifier_history` 行数 | **5552** |
| distinct securityId | **5552** |
| status 分布 | listed **5215** / delisted **337** |
| exchange 分布 | SH **2463** / SZ **3089** |
| 退市股数 | **337** |
| code reuse（同 code 多 securityId）组数 | **0** |
| 锚点 `000001.SZ` | `sec_d5e57ebc-8bbb-4f2b-9784-5319a434ab11`（与 WORK B 前 1 行一致） |

退市股抽查（按退市日倒序，真实数据）：

```
SZ 002898 listed=2017-09-12 delisted=2026-07-17
SZ 002808 listed=2016-08-12 delisted=2026-07-14
SZ 000004 listed=1991-01-14 delisted=2026-07-14
SZ 300029 listed=2009-12-25 delisted=2026-07-10
SH 600193 listed=1999-05-27 delisted=2026-07-06
SH 605081 listed=2021-02-09 delisted=2026-07-03
SH 600608 listed=1992-03-27 delisted=2026-07-03
SH 600696 listed=1993-12-06 delisted=2026-06-29
```

## 5. CONDITIONAL GAP：名称历史 / 改名 / 代码复用

BaoStock **无 namechange 接口**，`stock_basic` 每代码仅一条快照（当前名 + 退市信息）。因此：

- **名称历史**：本次仅落 `stock_basic` 的**当前名称**，未落历史改名区间。改名历史属 CONDITIONAL GAP，需未来用 Tushare `namechange`（限频 1 次/小时）或其它数据源补全。
- **代码复用（code reuse）**：退市后代码被新上市主体复用的情况，`stock_basic` 单快照**无法暴露**（同一 code 只出现一次）。本次 `detectCodeReuse` 检出 **0 条**，属预期 —— 机制已就绪（`buildSecurityMasterFromNameChanges` + `splitNameChangeSegments`），仅缺改名数据，**未伪造**。
- **Survivorship 边界说明**：BaoStock 已含**未被复用的退市股**（337 只），这是 survivorship-bias 修正的关键增量；但「退市后代码被复用」的那部分历史主体仍缺失（会落在当前上市快照里，退市主体不可见），这是 stock_basic 单快照的固有局限，已如实标注。

## 6. 复现 / 运行

```bash
# 实时全量回填（Python 解释器用 MARKETDATA_PYTHON 指定，或 --python 传入）
MARKETDATA_PYTHON="C:/Users/A/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \
  npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch --attempts=25

# 预览（不写库）
npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch --dry-run

# 离线回放（已保存原始行 fixture）
npx tsx scripts/backfillSecurityMasterBaostock.ts --input=./scripts/_baostock_stock_basic_dump.json

# 拉取并保存原始行
npx tsx scripts/backfillSecurityMasterBaostock.ts --fetch --dump=./scripts/_baostock_stock_basic_dump.json

# SQL 验证
npx tsx scripts/_verify_security_master_baostock.ts

# 类型检查 + 单测
npm run check
npx vitest run server/security/baostock.test.ts
```
