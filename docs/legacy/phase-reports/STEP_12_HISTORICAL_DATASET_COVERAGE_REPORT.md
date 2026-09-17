# STEP 12 — Historical Dataset Coverage Certification

> Quant System Data Infrastructure — Production Historical Dataset Backfill（STEP 12）
> Coverage Report · 直连 TiDB 只读取证（snapshot: `docs/step12-evidence/certify_final.json`）

## 0. 判定速览

| 域 | Provider | DB | Research Usable | PIT | 依据 |
| --- | --- | --- | --- | --- | --- |
| Migration 0023 | — | **PASS**（已落地） | PASS | — | `__drizzle_migrations` 24 行，idx23 `0023_security_identity_unification` |
| Trading Calendar | FULL | FULL | FULL | PASS | canonical `server/security/tradingCalendar.ts`；2019 回填 0 周末误写 |
| OHLCV | FULL | **PARTIAL**（回填进行中） | PARTIAL | PASS(raw) | 748,519 行；2019-01-02→2026-09-04；checkpoint 174 日 SUCCESS（至 2019-09-17） |
| Security Master | PARTIAL（stock_basic 5 次/天） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Identifier History | PARTIAL（namechange 可用） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Historical Status | NONE（suspend_d 无权限） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Industry | NONE（无历史 SW 源认证） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Index | LIMITED（index_daily 5 次/天） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Liquidity | LIMITED（daily_basic 全市场 1 次/小时） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Corporate Actions | PARTIAL（dividend 按股可用） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| Adjustment Factors | FULL（adj_factor 按股可用） | **DATA-PENDING**（0 行） | DATA-PENDING | DATA-PENDING | 表存在；无数据 |
| GAP-ENG-KEY Bridge | — | CODE READY（未接线） | DATA-PENDING | 逻辑 PASS | `server/security/engineKeyBridge.ts` + 11 测试 |

> **诚实结论：RESEARCH_READY = FALSE。** 本认证不因「代码就绪 / provider 可获取」调高 DB/Research 覆盖。

## 1. 每域证据

### 1.1 Migration 0023（DB Reality = PASS）
- 台账：`__drizzle_migrations` 23 → **24** 行；末行 id 414155, hash `e68e3fe9…`, created_at `1788676035482`（= journal `when`），tag 对应 `0023_security_identity_unification`。
- 4 张表 `SHOW COLUMNS`：`securityId varchar(48) NULL` + 新增 `securityCode varchar(20) NOT NULL`。
- 唯一索引切换为 securityCode 键：`uq_industry_assign_security_effective(securityCode,effectiveFrom)`、`uq_liquidity_daily_security_date(securityCode,tradeDate)`、`uq_corporate_action_security_date_type(securityCode,effectiveDate,actionType)`、`uq_adjustment_factor_security_date(securityCode,effectiveDate)`。
- 4 表行数保持 0（结构变更未触碰数据）。
- 机制：沿用项目受控 mysql2 直连 + 台账记账（hash=sha256 文件内容、created_at=journal when，与 drizzle migrator 语义一致）；未用 `drizzle-kit push`，无 DROP/TRUNCATE/DELETE。证据：`docs/step12-evidence/0023_deploy_evidence.json`。

### 1.2 Trading Calendar（PASS）
- 全历史 backfill 改走 canonical `server/security/tradingCalendar.ts::loadTradingCalendar`（参考股 daily 派生交易日，**不再依赖 trade_cal**；trade_cal 实测 1 次/小时不可支撑批量）。
- 实证：2019 已回填交易日集合 `DAYOFWEEK IN (1,7)` = 0 条（Friday→Monday 语义，无 Friday→Saturday/周末误写）。

### 1.3 OHLCV（Provider FULL / DB PARTIAL / Research PARTIAL）
- Provider：`daily(trade_date=整日)` 全市场返回（2026-09-04=5,548 行；2019 年约 3,586–3,700 行/日）——覆盖整个回填区间的市场容量差异。
- DB（snapshot 时刻）：748,519 行；min 2019-01-02 / max 2026-09-04；distinct stocks 4,855；quality：duplicate=0、critical null=0、OHLC violation=0、非法数字=0。
- Research usable：2019-01-02 → 2019-09-17 的**连续真实全市场 raw OHLCV**（checkpoint SUCCESS=174 个交易日，=2019 年 243 个交易日的 72%）；2019 剩余 + 2020-01-01 之后尚未回填（resume 可续）；2026 段（既有候选池 94,848 行）与全市场目标之间仍有 gap。
- 数据质量 edge 处理（真实触发并修复）：上市首日 `pre_close=null` 的北交所新上市 bar 不再整日炸掉（2019-01-15/16 复现两次后修复）——单行按 UNPERSISTABLE 拒写并计数，该日其余 ~3,585 行照常持久化。

### 1.4 Security Master / Identifier History / Status / Industry / Index / Liquidity / Corporate Actions / Adjustment
- DB 层：`research_securities`、`research_security_identifier_history`、`research_security_status_history`、`industry_assignments`、`index_master`、`index_daily`、`liquidity_daily`、`corporate_actions`、`adjustment_factors` 全部 **0 行**（表结构已就绪：research_* 三表与 4 张 STEP7.x 表均在 0023 落地后符合 schema.ts）。
- Provider 层（真实调用取证，`scripts` 探针）：
  - `stock_basic`：40203 频率超限 **5 次/天** → Security Master/Identifier History 基线数据只能按日配额取（L+D 需 2 次/天），本 session 内不可批量。
  - `suspend_d`：**无权限** → Historical Status 的权威停牌源不可用（现停牌窗口为 daily 推断源）。
  - `index_daily`：40203 **5 次/天** → Index 批量回填不可行。
  - `daily_basic`：按 `trade_date` 全市场 **1 次/小时** → Liquidity 全市场批量不可行（按 ts_code 逐股则 ~5,500 次调用）。
  - `dividend` / `adj_factor` / `namechange`：可用（逐股全历史一次调用）→ Corporate Actions / Adjustment / 名称历史的 provider 能力存在，但逐股数量级（数千次调用）超出本 session 配额预算。
- 结论：8 个辅助域 = **DATA-PENDING**，具备 schema + 部分 provider 能力，缺「配额内可控批量回填」执行。

## 2. Survivorship（基于真实 raw 数据）
- 2019 年出现、但 2026 年已不在 stock_daily_prices 中的 distinct 股票：**1,431 只**（含 000005.SZ 等退市样本，抽样见 probe）。
- 意义：raw OHLCV 历史层已具备「退市/更名不消失」特征；最终 Historical Universe 仍需 Master+Identifier+Status+Calendar 共同界定（代码已就绪，数据 DATA-PENDING）。

## 3. 质量门禁汇总（OHLCV, snapshot 时刻）
| Check | 要求 | 实测 |
| --- | --- | --- |
| duplicate (stockCode,tradeDate) | 0 | 0 |
| critical null（open/close/preClose） | 0 | 0 |
| OHLC relationship violation | 0 | 0 |
| invalid numeric / negative volume | 0 | 0 |
| 周末误写 | 0 | 0（2019 窗口） |
| 未来数据写入历史日期 | 禁止 | 未发现（日期=provider 交易日） |
