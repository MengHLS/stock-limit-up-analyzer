# STEP 12 — Historical Dataset Production Backfill Report

> Quant System Data Infrastructure Engineer · `stock-limit-up-analyzer`
> Contract：`docs/quant-system-contract.md`（唯一冻结契约，未改动）
> 本报告所有 DB 数字为**直连 TiDB 只读**实测；snapshot: `docs/step12-evidence/certify_final.json`

---

## 1. Executive Summary

```text
STEP 12 STATUS        = CONDITIONAL PASS（Migration/OHLCV 基建落地；8 域数据回填未达 Research 阈值）
RESEARCH_READY        = FALSE
Migration 0023        = PASS（已真实部署，台账 24 行，4 表结构切换 securityCode 唯一键）
Historical OHLCV      = PARTIAL（2019-01-02 起真实全市场 raw 连续回填进行中）
其余 8 域             = DATA-PENDING（表就绪、0 行；provider 配额/权限受限见 §16）
GAP-ENG-KEY           = BRIDGE IMPLEMENTED + TESTED（11 测试）；ENGINE WIRING = DATA-PENDING
Determinism / PIT     = PASS（逻辑层；数据依赖域随数据回填推进）
Tests                 = check PASS · test 1268 passed/15 env-baseline failed（Regression=0）· build PASS
```

本 STEP 的核心原则执行情况：**不在 DB/数据现实未达成时把状态标绿**。凡无真实数据证据的域一律 `DATA-PENDING`/`PARTIAL`，未使用「代码已就绪 / provider 支持 / 理论可用」代替证据。

---

## 2. Migration 0023 — before / after

| 项 | Before | After |
| --- | --- | --- |
| `__drizzle_migrations` | 23 行（0000–0022） | **24 行**（末行 hash `e68e3fe9…`，created_at `1788676035482`） |
| `industry_assignments` | `securityId varchar(20) NOT NULL`、无 `securityCode`、uk(securityId,effectiveFrom) | `securityId varchar(48) NULL` + `securityCode varchar(20) NOT NULL`、uk(securityCode,effectiveFrom) |
| `liquidity_daily` | 同上（uk securityId+tradeDate） | uk(securityCode,tradeDate) |
| `corporate_actions` | 同上（uk securityId+effectiveDate+actionType） | uk(securityCode,effectiveDate,actionType)、idx(securityCode,effectiveDate) |
| `adjustment_factors` | 同上（uk securityId+effectiveDate） | uk(securityCode,effectiveDate)、idx(securityCode,effectiveDate) |
| 表行数 | 0 | 0（仅结构变更，无数据触碰） |

- 部署机制：沿用项目 Work A 已建立的受控 mysql2 直连执行 + 台账记账，hash 与 created_at 语义与 `drizzle-orm` migrator 完全一致（hash=sha256 文件全文；created_at=journal `when`）。**未用 `drizzle-kit push`；无 DROP/TRUNCATE/DELETE；未改 migration 历史/journal。**
- 证据：`docs/step12-evidence/0023_deploy_evidence.json`（含 before/after SHOW COLUMNS）。

## 3. Security Master（research_securities）

- DB：0 行（表就绪）。Provider：`stock_basic` 实测 **5 次/天**（40203）——本 session 无法批量取 L/D 基线。
- canonical 身份 `sec_<uuid>` 的生成/校验/soft-reference 语义已在代码层（`server/security/*`），未执行数据回填。
- **Coverage: DB=0 / Research=DATA-PENDING**（不把「provider 可拿」当作「DB 已覆盖」）。

## 4. Identifier History

- DB：`research_security_identifier_history` 0 行。Code reuse / overlap 校验与 `detectCodeReuse()` 已有实现与测试。
- Provider：`namechange` 接口可用（更名区间），可作为 identifier/name 历史补强源；primary 基线依赖 stock_basic（同 5 次/天限制）。
- **DATA-PENDING**。

## 5. OHLCV（stock_daily_prices）

- 全市场真实 backfill **已在生产中执行**（既有 `BackfillScheduler` + `DbCheckpointStore`；canonical 交易日历；6s 间隔；batch 1000；断点续传）。
- snapshot：**748,519 行**（基线 116,332），min 2019-01-02 / max 2026-09-04，distinct stocks 4,855；2019 已连续回填 **174 个交易日**（2019-01-02→2019-09-17，=2019 全年 243 交易日的 72%）；checkpoint：174 SUCCESS / 0 FAILED / 0 QUOTA_STOPPED / 0 SUSPICIOUS。
- 质量：duplicate=0 / critical null=0 / OHLC violation=0 / 非法数字=0 / 2019 周末误写=0。
- Research coverage：2019-01-02→2019-09-17 每交易日全市场 raw OHLCV（~3,586–3,700 只/日，2019 年市容量）真实入库；目标 2019-01-01→当前（1,863 个交易日）未全部完成 → **PARTIAL**，剩余可 `resume`。
- 修复的真实缺陷（均为本次 DB 现实触发）：① `db.ts` ensure 唯一索引对 Drizzle 包装错误（cause 链）误判 → ER_DUP_KEYNAME 噪音，现幂等；② 上市首日 `pre_close=null`（BJ 新股 2019-01-15/16）曾令整日 FAILED → pre_close 合法可空，单行拒写计数、整日照常（2019-01-15 received 3586 → persisted 3585，2026 同）。

## 6. Historical Status

- DB：`research_security_status_history` 0 行。PIT/availability/保守 T+1 fallback 语义与测试已在（STEP 7.5 / securityStatus）。
- Provider：`suspend_d` **无权限**（40203）；现状停牌为 daily 推断源。
- **DATA-PENDING**。

## 7. Industry

- DB：`industry_assignments` 0 行（0023 后结构就绪）。无已认证的历史申万行业源 → 禁止以当前行业回填历史。
- **DATA-PENDING**。

## 8. Index

- DB：`index_master`/`index_daily` 0 行。Provider：`index_daily` 实测 **5 次/天**。
- **DATA-PENDING**。

## 9. Liquidity

- DB：`liquidity_daily` 0 行。Provider：`daily_basic` 全市场按日 **1 次/小时**（逐股 ~5,500 次调用量级）。
- **DATA-PENDING**。

## 10. Corporate Actions

- DB：`corporate_actions` 0 行。Provider：`dividend` 可用（ann_date/ex_date/record_date 三时间字段分离在数据中真实存在，满足 公告日≠除权日 语义）。
- 逐股回填数量级数千次调用 → 本 session 预算不足。
- **DATA-PENDING**。

## 11. Adjustment Factors

- DB：`adjustment_factors` 0 行。Provider：`adj_factor` 可用（单股一次全历史，000001.SZ 返回 1,863 行）。
- 回填须满足 PIT 可知性（derived data 原则），**不得**用 2026 完整历史构造 2019 因子——实施计划见 §17。
- **DATA-PENDING**。

## 12. Historical Universe（Survivorship 验证）

- 逻辑层（`resolveHistoricalUniverse`/Master/Identifier/Status/Calendar/PIT）已有实现与测试；当前因 8 域无数据 → 返回空，属**契约正确 + 数据未填**。
- raw 实证（真实 DB）：2019 年在交易、2026 年已不存在的 distinct 股票 **1,431 只** → 已回填 raw 历史层天然不含「当前池反推历史」污染；`DbBarStore.securities()` 仅代表 Data Coverage Universe（已注明）。

## 13. GAP-ENG-KEY

- 现状（DB 现实）：`backtest/types.ts Security.securityId` 与 `DbBarStore` 均以 `stockCode`（引擎兼容键）为键。
- 交付：`server/security/engineKeyBridge.ts` —— 确定性双向桥：`resolveEngineKeyAt(canonical sec_<uuid> → engineKey, asOf)` 与 `resolveSecurityIdByEngineKey(engineKey → canonical, asOf)`；NO_IDENTIFIER 拒绝 / AMBIGUOUS 抛错（数据错误不静默）；code reuse 按 asOf 分离。**11 个专项测试全绿**。
- **Engine wiring = DATA-PENDING**：真实 identifier-history 数据回填后才接线（回测引擎保持 RAW + stockCode 运行，不伪造键空间迁移）。

## 14. DB Reality（TiDB 直连证据）

- 25 张业务表存在；`__drizzle_migrations` 24 行；8 张研究域表 + `backfill_checkpoints` 均为 0 行基线（除 OHLCV 域推进中）。
- 完整数字：`docs/step12-evidence/certify_final.json`（migrationLedger / stock_daily_prices / checkpoints / schema_* 唯一索引）。

## 15. Tests

| 项 | 结果 |
| --- | --- |
| `npm run check` | PASS（含 engineKeyBridge 新模块类型） |
| `npm test` | **1268 passed / 15 failed（6 文件，全部为历史环境基线：stockPriceSyncPage 缺页面、tushare token 未注入、tushareTradingCalendar 网络超时、limitUp/watch/marketData 无 DB env），Regression=0**；新增 bridge 11 测试全过 |
| `npm run build` | PASS（dist/index.js 503.2kb） |

## 16. Coverage Matrix（Provider / DB / Research）

| Domain | Provider | DB | Research | Min | Max | Rows | Securities | Quality | PIT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Security Master | PARTIAL(5/d) | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Identifier History | PARTIAL | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| OHLCV | FULL | PARTIAL | PARTIAL | 2019-01-02 | 2026-09-04 | 748,519* | 4,855 | dup0/null0/viol0 | PASS(raw) |
| Status | NONE | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Industry | NONE | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Index | LIMITED(5/d) | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Liquidity | LIMITED(1/h) | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Corporate Actions | PARTIAL | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |
| Adjustment | FULL | DATA-PENDING | DATA-PENDING | — | — | 0 | 0 | n/a | n/a |

\* snapshot 时刻数值（2019-01-02→2019-09-17 已入库）；resume 后更新。

## 17. Remaining Blockers

| # | Blocker | Evidence | Impact | Next Action |
| --- | --- | --- | --- | --- |
| B1 | OHLCV 2019→now 全市场未跑完（1,863 目标交易日，已完 174=2019-09-17） | checkpoint 分布；时耗 ~8s/日 | Research 时间覆盖不完整 | 复用 `scripts/backfillDaily.ts --start=2019-01-01 --end=2026-09-04` 续跑（幂等/resume，已修复 pre_close & 索引幂等缺陷） |
| B2 | Security Master/Identifier History 无数据 | stock_basic 5 次/天（40203） | canonical 身份层空 | 分天配额取 L+D（2 次/天），编写 stock_basic→research_securities+identifier_history 幂等摄入脚本 |
| B3 | Historical Status 无权威停牌源 | suspend_d 无权限 | 状态域不可建 | 以 daily 断档推断 SUSPENSION（保守 T+1 availableAt）+ Master 上市/退市界 |
| B4 | CorpAction/Adjustment/Liquidity 数据未回填 | 逐股数千次调用预算 | 复权/流动域空 | dividend/adj_factor/daily_basic(ts_code) 按 universe 分批回填，adjustment 遵守 PIT（derived 不提前知） |
| B5 | Industry 无历史源 | 无认证历史 SW 源 | 行业域空 | 评估并认证 provider（如申万 API/爬虫）后再回填；禁当前行业回填历史 |
| B6 | Index 受限 | index_daily 5 次/天 | 指数域空 | 按日配额补 index_master+index_daily 核心指数（000001.SH/399001.SZ/000300.SH/000905.SH） |
| B7 | GAP-ENG-KEY 未接线 | 依赖 identifier history 数据 | 研究 canonical→引擎键自动化不可用 | 数据就绪后接 DbBarStore/research pipeline 并按 §22 测试 |

## 18. Research Ready Gate

```text
Migration = DB synchronized          PASS
Security Identity = canonical        DATA-PENDING（代码 PASS）
Identifier History = usable          DATA-PENDING
OHLCV = research coverage threshold  PARTIAL
Historical Status = usable           DATA-PENDING
Industry = usable                    DATA-PENDING
Index = usable                       DATA-PENDING
Liquidity = usable                   DATA-PENDING
Corporate Actions = usable           DATA-PENDING
Adjustment = PIT-safe                DATA-PENDING
Historical Universe = survivorship-safe  DATA-PENDING（逻辑 PASS）
PIT                                  PASS（代码层；数据域随回填）
Backtest source = DB                 PARTIAL（OHLCV 域已 raw 入库）
GAP-ENG-KEY                          BRIDGE READY / NOT WIRED
Determinism                          PASS
→ RESEARCH_READY = FALSE
```

## 19. Final Recommendation

1. **STEP 12 = CONDITIONAL PASS**：真实完成了 0023 部署、canonical 日历整合、OHLCV 全市场 raw 生产回填（进行中、可续跑）、两个真实数据缺陷修复、GAP-ENG-KEY 桥（+11 测试）。**不应判定 RESEARCH_READY=TRUE**。
2. 继续执行 B1（OHLCV resume）直至 2019→当前全市场打满；随后按 B2→B4 分日配额完成 canonical 身份/CA/调整域回填；B3/B5/B6 需先解决 provider 源。
3. 数据域全部落地并二次 certification 后再重算 RESEARCH_READY（唯一 Gate 入口）。
