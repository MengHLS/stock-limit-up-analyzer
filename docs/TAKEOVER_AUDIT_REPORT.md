# 项目全面接管审计报告（Takeover Audit）

> `stock-limit-up-analyzer` · 第一阶段「项目全面接管审计」交付物
> 审计时间：2026-09-06 · 审计方式：真实 DB 只读实查 + 全仓代码扫描 + 契约对照
> 结论基准：**真实 DB 证据 > 实际运行结果 > 代码 > 测试 > 文档 > 设计假设**

---

## 0. 结论速览

| 维度 | 状态 | 一句话结论 |
| --- | --- | --- |
| Migration | ✅ PASS（24 行，idx 23） | `0023_security_identity_unification` 已真实落地 TiDB |
| Trading Calendar | ✅ FULL | canonical 交易日历，2019 回填 0 周末误写 |
| OHLCV | 🟡 PARTIAL | 748,519 行，checkpoint 174 日（至 2019-09-17，≈2019 年 72%） |
| 8 个研究域表 | 🔴 DATA-PENDING | 全部 0 行（表结构就绪，数据未回填） |
| 测试 / 构建 | ✅ 1268/1283 · build 绿 | 15 失败 = 13 环境 + 2 测试命名漂移，**无业务回归** |
| **RESEARCH_READY** | 🔴 **FALSE** | 引擎键桥接、历史数据覆盖率、8 域回填均未满足 |

**核心判断（与总控指令的差异，必须诚实报告）：**

1. **代码层远比总控指令的 STEP 12 框架更先进。** 总控指令把 STEP 13–25 描述为「未来要做的」，但仓库实际上**已经把其中绝大部分在代码层实现了**——Research Engine（STEP 6.1–6.5 的 experiment/parameterSpace/sweep/trainValidationOos/walkForward/pbo/overfittingAssessment）、Backtest Engine（STEP 8）、Strategy Evaluation（六层评价面板）、Paper Trading（`paperTrading.ts`）都已存在且有测试。
2. **真正的卡点不是「策略层代码缺失」，而是「数据地基未完成」**：8 个研究域表 0 行 → RESEARCH_READY = FALSE。在这一结论翻绿之前，任何基于现有 748,519 行 OHLCV 得出的「正式策略结论」都不可信（正是总控指令 §21 的警告）。
3. **STEP 12 工作处于「进行中且未提交」状态**：`git status` 显示最后一个 commit 是「冻结Step7-11」，而 STEP 12 的产物（`engineKeyBridge.ts`、`step12_certify.mjs`、`docs/step12-evidence/`、OHLCV 回填改造的 `backfillDaily.ts`/`tradingCalendar.ts`/`db.ts`/`tushare.ts`）全部是**未提交的工作区改动**。

---

## 1. 当前完整架构

代码已形成与契约 §1 对齐的清晰分层（`server/` 下）：

| 层 | 模块锚点（实际目录） | 状态 |
| --- | --- | --- |
| Raw Data | `server/data/`（types/adapter/validation/boardRules/series） | ✅ 已实现 |
| Identity | `server/security/`（securityId/code/identifierHistory/universe/historicalUniverse/master/provider） | ✅ 代码就绪 |
| Identifier History | `server/security/identifierHistory.ts` | ✅ 代码就绪（数据待回填） |
| Trading Calendar | `server/security/tradingCalendar.ts` | ✅ FULL |
| Status Timeline | `server/securityStatus/`（timeline/pointInTime/suspensionAdapter/persistence） | ✅ 代码就绪 |
| Historical Universe | `server/security/historicalUniverse.ts` | ✅ 判定器就绪（输入数据待回填） |
| PIT | `server/securityStatus/pointInTime.ts` + `server/research/framework/leakage.ts` | ✅ 语义冻结 |
| Engine Key Bridge | `server/security/engineKeyBridge.ts` | ✅ 代码就绪（**未接线**，GAP-ENG-KEY） |
| Backfill 基础设施 | `server/backfill/`（scheduler/checkpoint/rateLimiter/retry/pipeline/pagination/persistence/canonical/coverage） | ✅ 已实现 |
| Corporate Action | `server/corporateActions/`（engine/portfolioTransform/storage/provider/validation/integration） | ✅ 双层架构已实现（数据待回填） |
| Features | `server/features/`（contract/registry/pipeline/basic/snapshot） | ✅ 已实现 |
| Strategy | `server/strategy/`（contract/registry/adapter/strategies/leaderCandidateBaseline） | ✅ 已实现 |
| Risk | `server/risk/` + `server/riskEngine/` | ✅ 已实现 |
| Portfolio | `server/portfolio/`（account/accounting/domain） | ✅ 已实现 |
| Backtest Engine | `server/backtest/`（engine/execution/portfolio/position/metrics/cost/dbBarStore） | ✅ 已实现 |
| Research Framework | `server/research/`（framework/* + walkForward/pbo/overfittingAssessment/sweep 等） | ✅ 已实现 |
| Market Data（行业/指数/流动性） | `server/marketData/`（industry/indexes/liquidity/pointInTime/providers） | ✅ 代码就绪（数据待回填） |

**Provider 层（`server/marketData/providers/`）：** akshare、baostock、sina、tushare、pythonBridge —— 5 个 provider 已具备，另有 `scripts/providers/` 下的 akshare/baostock 探针脚本。

---

## 2. STEP 1–12 状态

| STEP | 主题 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 项目基础 + 核心架构 | ✅ Done | React19+Vite7+Express+tRPC11+Drizzle 栈 |
| 2–4 | 数据/研究/统计/回测基础 + 评价重构 | ✅ Done | `docs/PHASE1_STEP2~4` 系列验收报告 |
| 5 | 统一数据质量层 + Canonical MarketData + Feature Pipeline | ✅ Done | `docs/PHASE1_STEP5_*` + `STEP5_FINAL_FULL_SYSTEM_INDEPENDENT_AUDIT_REPORT.md` |
| 6 | Research 层（experiment/paramSpace/sweep/WFO/PBO/overfitting） | ✅ Done（代码+测试） | `server/research/` 完整，`STEP6_*` 报告 |
| 7.3 | 全市场 OHLCV Backfill 基础设施 | ✅ Done（基础设施） | `server/backfill/` 全套 + 174 日 checkpoint |
| 7.4 | Security Identity Layer | ✅ Done（代码） | `server/security/` |
| 7.5 | Historical Status（timeline/PIT） | ✅ Done（代码，数据待回填） | `server/securityStatus/` |
| 7.6 | Industry/Index/Liquidity 基础设施 | ✅ Done（代码，数据待回填） | `server/marketData/` |
| 8 | Backtest Engine | ✅ Done | `server/backtest/` + `server/engine/` |
| 9 | Portfolio + Risk 架构 | ✅ Done | `server/portfolio/` + `server/risk*` |
| 10 | Strategy Research Framework（Universe→Feature→Signal→Ranking→Selection→PositionIntent） | ✅ Done | `server/research/framework/` + `server/strategy/` |
| 11 | 量化系统契约冻结 | ✅ Done | `docs/quant-system-contract.md`（唯一契约来源） |
| 12 | **Historical Dataset Production Backfill** | 🟡 **IN PROGRESS** | 见 §4 |

---

## 3. 当前数据库状态（真实只读实查）

> 直连 TiDB `gateway03...prod.aws.tidbcloud.com:4000`，非历史报告转述。

### 3.1 Migration Ledger
- `__drizzle_migrations` = **24 行**
- 末行：id `414155`，hash `e68e3fe9…`，created_at `1788676035482` → tag `0023_security_identity_unification`
- journal（`drizzle/meta/_journal.json`）24 条 entry（idx 0–23），与 DB 台账一致 ✅

### 3.2 各表行数
| 表 | 行数 | 状态 |
| --- | --- | --- |
| stock_daily_prices | **748,519** | PARTIAL |
| backfill_checkpoints | **174**（全部 SUCCESS） | PARTIAL |
| stock_suspension_windows | **155** | ✅ 有数据（停牌推断源，报告未重点提及） |
| research_securities | 0 | DATA-PENDING |
| research_security_identifier_history | 0 | DATA-PENDING |
| research_security_status_history | 0 | DATA-PENDING |
| industry_assignments | 0 | DATA-PENDING |
| index_master / index_daily | 0 / 0 | DATA-PENDING |
| liquidity_daily | 0 | DATA-PENDING |
| corporate_actions / adjustment_factors | 0 / 0 | DATA-PENDING |

### 3.3 OHLCV / Checkpoint / Survivorship
- `stock_daily_prices`：min `2019-01-02`，max `2026-09-04`，distinct stocks **4,855**，duplicate keys **0**
- `backfill_checkpoints`：min `2019-01-02`，max `2019-09-17`（**174 个交易日**，≈2019 年 243 个交易日的 72%；相对 2019–2026 全区间约 **9%**）
- Survivorship（真实 raw 数据）：2019 distinct **3,830**，2026 distinct **3,288**，**2019 出现但 2026 已消失 = 1,512 只**（与总控指令的 ~1,431 同一量级，直接实查为准）

### 3.4 0023 迁移 schema 验证（SHOW COLUMNS + SHOW INDEX）
4 张表均确认：`securityCode varchar(20) NOT NULL` + `securityId varchar(48) NULL`，唯一索引切换为 securityCode 键：
- `uq_industry_assign_security_effective`
- `uq_liquidity_daily_security_date`
- `uq_corporate_action_security_date_type`
- `uq_adjustment_factor_security_date`

### 3.5 research_* 三表 schema 验证
`research_securities` / `research_security_identifier_history` / `research_security_status_history` 均确认 `securityId varchar(48) NOT NULL`，且含完整 enum（exchange/statusType/identifierType/availability 等），符合契约 §2–§3。

---

## 4. 当前 STEP 12 状态

**STEP 12 = CONDITIONAL PASS / DATA PRODUCTION IN PROGRESS**（与总控指令 §5 一致，且经实查确认）。

- ✅ Migration 0023：**DB-PENDING → 已落地（PASS）**——这是相对契约 §25 的进展。
- ✅ Trading Calendar：FULL。
- ✅ 已解决两个生产数据问题（上市首日 pre_close=null 单行拒写；Drizzle/mysql2 唯一索引幂等）。
- 🟡 OHLCV：PARTIAL，checkpoint 174 日，可 resume。
- 🔴 8 个研究域：DATA-PENDING（0 行）。
- 🟡 Engine Key Bridge：CODE READY 但未接线（GAP-ENG-KEY，DATA-PENDING）。

**STEP 12 剩余 8 个 blocker（与总控指令 §12 对齐）：** B1 OHLCV 未满 / B2 Security Master+Identifier 无数据 / B3 Status 无权威 suspend_d / B4 CA+Adjustment+Liquidity 未回填 / B5 Industry 无认证源 / B6 Index 未回填 / B7 Engine Bridge 未接入 / B8 Research Ready 未认证。

---

## 5. 已完成能力（代码级）

1. canonical Trading Calendar（禁止自然日 T+1）
2. Security Identity 基础（sec_<uuid> + identifierHistory + code reuse 检测）
3. Historical Status timeline + PIT 知识日解析（IMMEDIATE/T_PLUS_1/UNKNOWN）
4. Historical Universe 判定器（survivorship-safe，正向确认/负向阻断）
5. Engine Key Bridge（`resolveEngineKeyAt` / `resolveSecurityIdByEngineKey`，含 11 测试）
6. Backfill 全套基础设施（scheduler/checkpoint/rateLimiter/retry/pipeline/pagination/persistence/canonical/coverage/validation）
7. Corporate Action 双层架构（价格调整层 ≠ 组合变换层）
8. Feature Registry + Pipeline（防未来泄漏，Determinism 测试）
9. Research Framework 全链（Universe→Feature→Signal→Ranking→Selection→PositionIntent）
10. Backtest Engine（Signal→Order→Fill→Portfolio，T+1 结算、成本/滑点、公司行为会计）
11. Research 评估体系（WFO/PBO/overfitting/parameterStability/sweep）
12. Paper Trading（前向纸面交易）

---

## 6. 未完成能力（数据级）

- ❌ Security Master / Identifier History：0 行（stock_basic 5 次/天、namechange 逐股，缺配额内批量回填执行）
- ❌ Historical Status：0 行（suspend_d 无权限；当前仅 daily 推断源，`stock_suspension_windows` 155 行）
- ❌ Industry：0 行（无认证历史 SW 源）
- ❌ Index：0 行（index_daily 5 次/天）
- ❌ Liquidity：0 行（daily_basic 全市场 1 次/小时）
- ❌ Corporate Actions / Adjustment Factors：0 行（dividend/adj_factor 逐股可用但数千次调用超配额）
- ❌ OHLCV 全历史（2019-09-17 之后待 resume）
- ❌ Engine Key Bridge 接线（需等 Master + Identifier 数据就绪）

---

## 7. 关键技术债

| 债务 | 说明 | 严重度 |
| --- | --- | --- |
| GAP-ENG-KEY | 回测引擎 raw 层仍以自然键 stockCode 作键，需经 identifier history 桥接到 sec_<uuid> | P0（blocker） |
| 0023 后续数据回填 | 8 域 0 行，缺配额可控的批量回填执行 | P0 |
| STEP 12 未提交 | engineKeyBridge + 回填改造 + 认证产物全部 uncommitted | P1（工作区风险） |
| 测试命名漂移 | `stockPriceSyncPage.test.ts` 期望 `StockPriceSync.tsx`，实际页面已更名 `StockSync.tsx`（路由 `/stock-sync`） | P2 |
| drizzle meta snapshot 滞后 | `drizzle/meta/` 只有 0000–0015 snapshot，journal 有 24 条（0016–0023 手工补登记，无对应 snapshot） | P2 |
| suspend_d 无权限 | Historical Status 缺权威停牌源，只能用 daily 推断 | P1 |
| provider 配额 | stock_basic/index_daily 5 次/天、daily_basic 1 次/小时、trade_cal 1 次/小时 | P1 |

---

## 8. 风险

1. **用 2026 当前股票列表回填 2019 = Survivorship Bias**（已有 1,512 只退市样本实证）。
2. **用 effectiveDate 代替 information availability = Look-ahead Bias**（CA/Adjustment 尤其危险）。
3. **把「provider 可获取」当「DB 已有」**（8 域 0 行就是反例）。
4. **把「代码已支持」当「数据已回填」**（engine bridge / universe / status 全在等数据）。
5. **未提交工作区**：STEP 12 全部产物 uncommitted，一旦误操作可能丢失。
6. **早于 RESEARCH_READY 下策略结论**：当前 748,519 行 OHLCV ≠ 研究可用，任何「策略有效」结论此刻都不可信。

---

## 9. STEP 12 剩余任务（WORK A–H）

| Work | 目标 | 依赖 | 优先级 |
| --- | --- | --- | --- |
| A | OHLCV 2019→2026 全回填至 checkpoint 100% | 已有基础设施，直接 resume | 🔴 最高（可立即并行） |
| B | Security Master + Identifier History（stock_basic + namechange） | 配额（stock_basic 5 次/天） | 🔴 高 |
| C | Historical Status（listing boundary + daily 推断 + T+1 availability） | 无 suspend_d，需推断 | 🟡 中 |
| D | Corporate Actions + Adjustment（PIT 严格） | dividend/adj_factor 逐股 | 🟡 中 |
| E | Liquidity（quota-aware，daily_basic 全市场 1 次/小时） | 配额 | 🟡 中 |
| F | Index（000001.SH/399001.SZ/000300.SH/000905.SH 先行） | index_daily 5 次/天 | 🟢 低 |
| G | Industry（先 provider discovery + 小样本 PIT 验证，勿大规模回填） | 无认证源 | 🟢 低（先验证） |
| H | Research Ready Gate（唯一认证，DB 实算） | A–G 完成度 | 🔴 收口 |

---

## 10. STEP 13–25 路线图

> 关键认知修正：**STEP 13–21 的「代码」大多已存在**（research engine、backtest、evaluation、optimization、WFO、OOS、overfitting、versioning），真正的剩余工作是「数据就绪后接线 + 用真实数据验证」，而不是从零写代码。

| STEP | 主题 | 现状 | 剩余工作 |
| --- | --- | --- | --- |
| 13 | Research Engine | ✅ 代码已实现 | 接入真实 PIT 数据 + 引擎键桥接 |
| 14 | Backtest Enhancement | ✅ 代码已实现 | 用 Historical Universe 替换 Data Coverage Universe |
| 15 | Strategy Definition/Builder | 🟡 有 contract+registry，缺 Builder UI | 补策略可视化定义 |
| 16 | Strategy Evaluation | ✅ 六层评价面板已实现 | 真实数据校准 |
| 17 | Parameter Optimization | ✅ sweep/combinationGenerator 已实现 | 真实数据 + 配额 |
| 18 | Robustness Testing | ✅ parameterStability 已实现 | 真实数据 |
| 19 | Walk-Forward / OOS | ✅ walkForward/oosEvaluation 已实现 | 真实数据 |
| 20 | Overfitting Detection | ✅ pbo/overfittingAssessment 已实现 | 真实数据 |
| 21 | Strategy Versioning | ✅ experimentRegistry/persistence 已实现 | 数据 |
| 22 | Market Regime Analysis | 🟡 有情绪周期，缺 regime 分层框架 | 新建 |
| 23 | Paper Trading/Simulation | ✅ paperTrading 已实现 | 真实数据 |
| 24 | Trading Review/Discipline | 🔴 未开始 | 新建（对应你的 329 笔交易复盘需求） |
| 25 | Production Quant Platform | 🔴 未开始 | 收口 |

---

## 11. 可以并行的 Work

- **WORK A（OHLCV resume）** 与 **WORK B/C/D/E/F/G** 互不阻塞，可并行推进。
- **WORK H（Research Ready Gate）** 依赖 A–G 完成度，属收口任务。
- **STEP 24（交易纪律）** 与数据回填无强依赖，可在等配额期间并行开发（对应你 329 笔交易的复盘需求）。

---

## 12. 当前最优先任务

1. **先 git 提交 STEP 12 现有产物**（冻结 engineKeyBridge + 回填改造 + 认证，避免工作区丢失）。
2. **WORK A：OHLCV resume**（2019-09-17 → 2026-09-04，基础设施已就绪，直接续跑，是唯一「配额成本低、确定性高」的推进点）。
3. **WORK B：Security Master + Identifier History**（配额敏感，按日配额取 stock_basic + namechange）。
4. **修复测试命名漂移**（`stockPriceSyncPage.test.ts` → 对齐 `StockSync.tsx`，让测试回到 1268+ 全绿基线）。

---

## 13. 测试 / 构建基线

| 检查 | 结果 |
| --- | --- |
| `npm run check`（tsc --noEmit） | ✅ PASS |
| `npm run build`（vite + esbuild） | ✅ PASS |
| `npm run test`（vitest） | 1283 tests：**1268 passed / 15 failed**（6 文件） |

**15 失败分类：**
| 类别 | 数量 | 说明 |
| --- | --- | --- |
| Environment（DB 未注入） | 9 | `limitUp.test.ts`(1) + `limitUp.watch.test.ts`(4) + `marketData.test.ts`(4) —— 测试环境 `getDb()` 为 null |
| Environment（token/网络） | 4 | `tushare.secret.test.ts`(1，token 未注入) + `tushareTradingCalendar.test.ts`(3，网络超时) |
| **Test drift（非环境）** | **2** | `stockPriceSyncPage.test.ts`(2) —— 期望 `StockPriceSync.tsx`，实际页面已更名 `StockSync.tsx` |

> **Regression = 0**，Environment = 13，Test drift = 2。无业务逻辑回归。

---

## 14. 冲突与发现（诚实声明）

1. **总控指令「STEP 13–25 待做」 vs 代码现实「已实现」**：冲突。以代码为准——research/backtest/evaluation/optimization/WFO/overfitting/paperTrading 均已实现。但这不改变 RESEARCH_READY = FALSE 的结论。
2. **测试期望 `StockPriceSync.tsx` vs 实际 `StockSync.tsx`**：命名漂移，需修正测试（或统一命名）。
3. **总控指令「~1,431 只退市样本」 vs 实查 1,512**：量级一致，以实查为准。
4. **`stock_suspension_windows` 155 行**：总控指令 §7 未列入「0 rows 表」，实查确认该表已有数据（停牌推断源），不属 DATA-PENDING。
5. **STEP 12 产物全部 uncommitted**：`git log` 末 commit 为「冻结Step7-11」，STEP 12 为工作区未提交状态。

---

*审计基准：真实 TiDB 只读查询 + 全仓代码扫描 + 三查（check/test/build）。未修改任何核心业务代码。*
