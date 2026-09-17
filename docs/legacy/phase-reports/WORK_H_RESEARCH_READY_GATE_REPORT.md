# WORK H — Research Ready Gate 认证收口报告

> `stock-limit-up-analyzer` · STEP 12 数据地基收口 · WORK H
> 认证脚本：`scripts/step12_certify_gate.mjs`（在 `step12_certify.mjs` snapshot 基础上扩展）
> 证据快照：`docs/step12-evidence/research_ready_gate.json`
> 认证时间：2026-09-06T11:46:34Z · 真实 TiDB 只读实查 · 阈值常量化、当前值一律查库

---

## 0. 最终判定

| 项 | 值 |
| --- | --- |
| **RESEARCH_READY** | 🔴 **FALSE** |
| 数据域条件（15 项） | PASS 8 / PENDING 7 / FAIL 0 |
| 全部条件（17 项） | PASS 10 / PENDING 7 / FAIL 0 |

**诚实结论：数据地基尚未收口，`RESEARCH_READY = FALSE`。** 7 个数据域仍为 PENDING，不因「代码就绪 / provider 可获取」调高覆盖。当前仅 Security Master + Identifier History + Index 三个数据域达到 FULL，OHLCV 接近 FULL（1816/1863 交易日）但仍在回填中。

---

## 1. 认证条件清单（17 项，当前值 vs 阈值）

> 状态规则：当前值 ≥ 阈值 → PASS；当前值 < 阈值但 > 0 → PENDING；违反硬约束（重叠/重复/质量）→ FAIL。

| # | 条件 | 状态 | 当前值 | 阈值 | 判定依据 |
| --- | --- | --- | --- | --- | --- |
| 1 | Migration PASS | ✅ PASS | 台账 24 行，journal idx=23 tag=`0023_security_identity_unification`，DB 末行 created_at 与 journal when 一致 | ≥24 行 + tag23 匹配 | `__drizzle_migrations` 24 行 |
| 2 | Trading Calendar FULL | ✅ PASS | canonical 1863 日（2019-01-02 → 2026-09-04），4 指数一致 | ≥1800 日 | 以已全量 index_daily 交易日集合为权威基准 |
| 3 | OHLCV FULL | 🟡 PENDING | **1816 / 1863** 交易日（缺口 46 日），重复键 0 | =1863 日 + 重复键 0 | `stock_daily_prices` distinct tradeDate |
| 4 | Security Master FULL | ✅ PASS | **5552** 行（distinct securityId 5552） | ≥5500 | `research_securities` |
| 5 | Identifier History FULL | ✅ PASS | **5552** 行，与 securities 一一对应（5552↔5552） | ≥5500 + 一一对应 | `research_security_identifier_history` |
| 6 | Historical Status | 🟡 PENDING | **22 / 5500** 只证券（211 行） | ≥5500 只 | `research_security_status_history` distinct securityId |
| 7 | Industry | 🟡 PENDING | **574 / 5000** 只证券 | ≥5000 只 | `industry_assignments` distinct securityCode |
| 8 | Index | ✅ PASS | **4** 核心指数，各 **1863** 交易日 | 4 指数 + ≥1800 日 | `index_daily`（000001.SH/399001.SZ/000300.SH/000905.SH） |
| 9 | Liquidity | 🟡 PENDING | **54 / 5000** 只证券 | ≥5000 只 | `liquidity_daily` distinct securityCode |
| 10 | Corporate Actions | 🟡 PENDING | **19 / 5000** 只证券 | ≥5000 只 | `corporate_actions` distinct securityCode |
| 11 | Adjustment Factors | 🟡 PENDING | **20 / 5000** 只证券 | ≥5000 只 | `adjustment_factors` distinct securityCode |
| 12 | Historical Universe 可重建 | 🟡 PENDING | 三表有数据，但 status 仅覆盖 22/5500 | 三表有数据 + status ≥5500 | securities + identifier + status 联合 |
| 13 | PIT validation | ✅ PASS | identifier 重叠 0、status 重叠 0 | 重叠 = 0 | effectiveFrom/effectiveTo 区间重叠 SQL |
| 14 | Survivorship validation | ✅ PASS | 退市股 **337** 只 | ≥1 | securities status=delisted / delistedDate 非空 |
| 15 | Data quality validation | ✅ PASS | 重复键 0、null 关键字段 0、周末交易日 0 | 全 0 | stock_daily_prices |
| 16 | No critical blocker | ✅ PASS | 无 FAIL 项 | 无 FAIL | 上述 15 项聚合 |
| 17 | Certification snapshot 可复现 | ✅ PASS | 脚本幂等（只读 + 阈值常量化 + 当前值查库） | 幂等 + 时间戳 | 脚本设计保证 |

---

## 2. 逐项证据（真实 SQL 实测）

### 2.1 已达 FULL 的数据域（8 项 PASS）

- **Migration**：`__drizzle_migrations` 24 行；`drizzle/meta/_journal.json` idx=23 tag=`0023_security_identity_unification`，`when=1788676035482` 与 DB 末行 `created_at` 精确一致 → 迁移已真实落地。
- **Trading Calendar**：无独立日历表，以已全量 `index_daily` 4 核心指数的 distinct tradeDate（1863 日，2019-01-02 → 2026-09-04）作为 canonical 基准，4 指数天数一致 → 日历 FULL。
- **Security Master**：`research_securities` 5552 行（含退市股 337 只），distinct securityId 5552。
- **Identifier History**：5552 行，distinct securityId 5552，与 securities 一一对应。
- **Index**：`index_daily` 7452 行，4 核心指数各 1863 交易日，覆盖全区间。
- **PIT**：identifier 与 status 的 effectiveFrom/effectiveTo 区间重叠检测均为 0（无重叠语义违规）。
- **Survivorship**：securities 含 337 只退市股（survivorship-safe 证据）。
- **Data quality**：OHLCV 重复键 0、openPrice/closePrice/preClosePrice 无 null/空、周末（DAYOFWEEK IN 1,7）交易日 0。

### 2.2 仍 PENDING 的数据域（7 项，缺口清单）

| 域 | 当前 | 目标 | 缺口 |
| --- | --- | --- | --- |
| OHLCV | 1816 交易日 | 1863 交易日 | **差 46 个交易日**（回填进行中，checkpoint 已覆盖至 2025 年中，resume 可续） |
| Historical Status | 22 只证券（211 行） | 5500 只 | **差 5478 只** |
| Industry | 574 只 | 5000 只 | **差 4426 只**（且当前为 2026-08-31 快照，非历史 PIT 序列） |
| Liquidity | 54 只 | 5000 只 | **差 4946 只** |
| Corporate Actions | 19 只 | 5000 只 | **差 4981 只** |
| Adjustment Factors | 20 只 | 5000 只 | **差 4980 只** |
| Historical Universe 可重建 | status 仅覆盖 22 只 | status ≥5500 | 依赖 Historical Status 收口 |

---

## 3. 诚实声明

1. **本 gate 不把「代码已支持」当「DB 已有数据」**：8 个研究域表结构就绪（`securityId`/`securityCode` 双键、唯一索引已切至自然键），但 Industry/Liquidity/CA/ADJ/Status 的实际覆盖远低于阈值，如实标 PENDING。
2. **「当前值」全部来自真实 TiDB 查询**，阈值（5500 全市场 / 1800+ 交易日 / 4 核心指数）为常量，可复现。脚本运行时刻 backfill 仍在进行（OHLCV 由 1782→1816 增长、industry 由 474→574 增长），故快照值随时间演进，`capturedAt` 时间戳标识取证时刻。
3. **RESEARCH_READY = FALSE 是诚实结论**：多域 partial，任何基于当前数据集的正式策略结论此刻仍不可信（对应总控指令 §21 警告）。

---

## 4. 交付物

| 文件 | 说明 |
| --- | --- |
| `scripts/step12_certify_gate.mjs` | 认证 gate 脚本（新增，保留原 snapshot 逻辑并扩展 17 项判定） |
| `docs/step12-evidence/research_ready_gate.json` | 认证快照（17 项状态 + RESEARCH_READY + capturedAt + snapshot） |
| `docs/WORK_H_RESEARCH_READY_GATE_REPORT.md` | 本报告 |

> 原 `scripts/step12_certify.mjs` 未改动，其 snapshot 能力在新脚本中以 `gate.snapshot` 完整保留。
