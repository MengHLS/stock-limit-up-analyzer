# QUANT MASTER AUDIT REPORT — AUDIT-002（全系统代码审计）

> Auditor：QUANT MASTER AUDITOR（独立 · 只读） ｜ Master Control：ROADMAP.md V2
> 审计范围：**系统整体代码**（代码结构、各模块实现、配置文件、接口逻辑、依赖关系）
> 排除范围：**数据库实际数据**（本次不审计 DB 数据，仅审计代码/配置/依赖）
> 审计方法：静态代码审查 + `tsc --noEmit` + `vitest run` + 三路并行子代理交叉审计 + 关键发现人工复核

---

## 1. 审计时间

`2026-09-09 00:16–00:40 GMT+8`（tsc 00:18；vitest 00:27–00:31；三路子代理并行 00:19–00:26）

## 2. 审计范围与统计

| 区域 | 文件数 | 代码量 | 审查方式 |
|---|---|---|---|
| server/ 后端 | 591 个 .ts | 约 12.7 万行 | 子代理精读 + 关键点人工复核 |
| client/src + shared | 147 个 | 约 2.58 万行 | 子代理 + 契约交叉核对 |
| scripts/ + drizzle/ + 根目录 | 约 42 个 | — | 子代理 + 根目录人工盘点 |
| 配置/依赖 | tsconfig/vite/vitest/drizzle/package.json/.env/.gitignore | — | 人工逐项核对 |

## 3. 总体结论

**代码层整体质量较高，但存在 2 项 CRITICAL（凭据泄露风险 + 认证 gate 正确性 bug）与 3 项 HIGH，当前不可进入 RESEARCH_READY。**

- ✅ **核心研究链的铁律执行到位**：`historicalState/reconstruct.ts` 明确将 `asOf=null` 限定为"仅调试/审计"，研究口径强制显式传 asOf；`researchDataset` 有逐日 PIT 决议 + 全代码 code-ownership 防串扰；`simulator` 端到端 T+1 用例实证守卫"禁止裸 signal→next close"；`closedLoop` 有 BLOCKED 诚实门禁 + 证据门槛。**未发现 CRITICAL 级 look-ahead / survivorship 泄漏**。
- ⚠️ **主要问题集中在**：① 生产凭据硬编码且位于公开 GitHub 仓库；② 数据认证 gate 的 Migration 检查因类型不匹配**恒为 false**；③ 测试套件**非封闭**（依赖 .env/活 DB/活网络），实测 14 用例失败，与历史"测试全过"声明不符；④ 架构层存在三套回测引擎重复与多处类型安全边界（`as any` / 强转 / 非空断言）。
- 📌 **状态判定**：代码层整体 `CODE_READY`（研究链 29/29 编码任务落地）；`RESEARCH_READY = FALSE`、`PRODUCTION_READY = FALSE`（受 H-1/H-2/H-3 及数据域未全量阻塞，本次不审计数据，仅据 ROADMAP §44 现状判定）。

---

## 4. 发现清单（按严重程度）

### 🔴 CRITICAL（2 项）

**C-1 生产凭据硬编码 + 公开仓库泄露风险**
- 位置：`.env:1-3`；根目录 `_tushare_probe.py:4` / `_tushare_probe2.py:3` / `_tushare_probe3.py:3`
- 证据：
  - `.env` 含 TiDB 数据库连接串（明文密码 `6UyQzj7PG71Bmn6GA3GM`）、`JWT_SECRET=qweqrwreqweqrqrqrwqrqwrqwr`（弱口令）、`TUSHARE_TOKEN=cee1f03c...`。
  - 三个探针脚本把真实 token 作为默认值硬编码：`os.environ.get('TUSHARE_TOKEN', 'cee1f03cab70c0b222a1c1083517814ec3c29551627f79ac6ecdad22')`。
  - `.gitignore` 仅有 `._*` 规则（`._` 前缀），**不匹配 `_*.py`**；`.git/config` 确认 remote 为公开仓库 `github.com/MengHLS/stock-limit-up-analyzer.git`。
- 风险说明：① 数据库密码、JWT 签名密钥、Tushare token 一旦 `git add .` 即泄露到公开仓库，全盘沦陷；② JWT_SECRET 为弱口令，可被离线爆破伪造鉴权；③ 当前 `.git/index` 实测不含 `.env` 与 `_tushare_probe*.py`（未跟踪），但历史是否曾提交无法验证。
- 改进建议：① 删除探针脚本中的 token 默认值，改为无 token 即报错退出；② `.gitignore` 增加 `_*.py`、`_*.mjs`、`_*.mts` 规则；③ 轮换 TiDB 密码与 TUSHARE_TOKEN（已可能暴露）；④ JWT_SECRET 改为强随机值并从 `.env` 移除到密钥管理；⑤ 用 `git log --all --full-history -- .env` 核查历史是否曾提交。

**C-2 根目录残留大量探针/临时脚本与大文件（含 C-1 秘密载体）**
- 位置：根目录 `_audit-probe.mts`、`_c.mjs`、`_curve.mjs`、`_empty.mjs`、`_long_curve.mjs`、`_rtt_probe.mjs`、`_s.mjs`、`_verify.mjs`、`_tushare_probe*.py`、`calibrate_open_expectation.ts`、`homeInteractionPerformance.mjs`、`.audit-*.json`（4 个约 8.6MB 各一，合计约 34.5MB）、`server/routers.ts.tmp`
- 风险说明：一次性探针/CDP 脚本与 34MB 审计 JSON 混入源码根目录，污染仓库、掩盖真实源码结构；其中 `_tushare_probe*.py` 与 `_audit-probe.mts` 是 C-1 的秘密/绝对路径载体。
- 改进建议：全部移入 `scripts/_dump/` 或直接删除；`.audit-*.json` 加 `.gitignore` 或归档至对象存储。

---

### 🟠 HIGH（3 项）

**H-1 数据认证 gate 的 Migration 检查恒为 false（正确性 bug）**
- 位置：`scripts/step12_certify_gate.mjs:112`
- 证据：`migJournalMatchesDb = migHas23 && migLastCreatedAt === String(j23.when)`；其中 `migLastCreatedAt` 是 DB 的 datetime 字符串（如 `"2026-09-07 19:47:15"`），而 `j23.when` 是 `drizzle/meta/_journal.json` 里的 epoch 毫秒 `1788676035482`。二者字符串永不相等 → gate #1 "Migration PASS" 永远最多 `PENDING`；第 347 行 `researchReady = dataChecks.every(PASS)` 恒为 `false`。
- 风险说明：即使全部数据回填完成、其余 16 项 gate 全 PASS，`RESEARCH_READY` 仍被这一项永久卡在 FALSE，构成**静默的全局阻塞**（fail-safe 方向，但阻塞研究链推进）。
- 改进建议：统一时间口径后再比对——用 `DATE_FORMAT(created_at, '%s')` 或把 `j23.when` 换算为 epoch 比较；并为该检查补一条「格式断言」单元测试，避免类型漂移复发。
- Blocking：YES（RESEARCH_READY=TRUE 的前置）

**H-2 测试套件非封闭，14 用例失败（与"测试全过"声明不符）**
- 位置：`server/tushare.secret.test.ts`、`server/tushareTradingCalendar.test.ts`、`server/marketData.test.ts`、`server/limitUp.watch.test.ts`、`server/limitUp.test.ts`、`server/image.uploadAndRecognize.test.ts`
- 证据：`npx vitest run` 实测 **157 文件 / 2305 用例：6 文件失败、14 用例失败、2291 通过（exit 1）**。失败根因两类：① `tushare.secret.test.ts`（1）+ `tushareTradingCalendar.test.ts`（3）直接 `fetch api.tushare.pro` 真实网络调用、依赖 `.env` 的 TUSHARE_TOKEN，vitest 不加载 `.env` → 超时/断言失败；② `marketData.test.ts`（4）、`limitUp.watch.test.ts`（4）、`limitUp.test.ts`（1）、`image.uploadAndRecognize.test.ts`（1）直连真实 DB（如 `marketData.test.ts:2` `import ... from "./db"`），测试环境无 DB 数据 → 返回空。
- 风险说明：测试套件依赖 `.env` + 活 DB + 活网络，非封闭（non-hermetic）；在干净环境不可复现"全过"，削弱"自动化测试"证据层级（ROADMAP §3 证据优先级中高于文档/声明）。
- 改进建议：① 外部 API 测试改为 mock（vi.mock 或 MSW）并加 `describe.skipIf(!process.env.TUSHARE_TOKEN)`；② DB 依赖测试改为内存桩/测试库或 `describe.skipIf`；③ vitest 加 `setupFiles` 统一加载测试 env，明确区分单测/集成测。
- Blocking：YES（VALIDATED 证据链）

**H-3 退市股因缺 `listedDate` 被拒，潜在 survivorship 缺口**
- 位置：`server/security/buildSecurityMaster.ts:87-90`
- 证据：`if (!record.listedDate) { rejected.push({reason:"缺少上市日期"}); continue; }`；配合 `marketData/providers/baostock.ts:74` 中 `ipoDate?.trim() || null`，老退市股的 `ipoDate` 常为空 → 被整体拒绝，退市股从 Security Master 消失。
- 风险说明：若回填脚本未核对 `rejected` 名单，缺失上市日期的退市股会静默丢失，历史股票池重建时产生 survivorship 偏差（退市股无法出现在其真实存续的历史时期）。
- 改进建议：对 `listedDate` 缺失但 `delistedDate` 非空的退市股，用退市日前兜底上市日（或取 earliest 价格日期），并显式告警阻断；或把「缺上市日退市股」单列待人工核验清单。
- Blocking：YES（SURVIVORSHIP_GATE 完整性）

---

### 🟡 MEDIUM（11 项）

**M-1 三套回测引擎并存，成本/成交口径重复**
- 位置：`server/engine/`（STEP 2 Core）、`server/backtest/`（STEP 8）、`server/research/simulator/`（C-14.1）+ `signalToPnl/`（C-23.2）
- 风险说明：next-open 成交、涨跌停、滑点分层、成本五维在多个模块有独立实现，口径可能漂移，维护面大。
- 改进建议：将 `engine/execution.ts` 成本/成交原子函数确立为唯一 canonical 来源，其余模块 import 只读复用。

**M-2 researchRouter 反序列化强转无运行时校验**
- 位置：`server/researchRouter.ts:38-44`
- 证据：`return value as unknown as StrategyDocument`；`compare` 端点直接调用 `compareStrategyDocuments(toStrategyDocument(input.left), ...)`，未经过权威校验器 `assertValidStrategyDocument`。
- 风险说明：若 `shared/strategyDocumentSchema`（zod）与 TS 类型不同步，脏数据会越过校验进入领域层。
- 改进建议：在边界调用权威校验器后再转换，或用 zod 直接 parse 出领域对象。

**M-3 OAuth 用户信息 `as any` 滥用（7 处）**
- 位置：`server/_core/sdk.ts:138-145, 249-256, 281`
- 证据：`(data as any)?.platforms`、`return { ...(data as any), platform: loginMethod }`。
- 风险说明：完全绕过类型系统，OAuth 响应 schema 漂移会静默错判登录方式。
- 改进建议：定义响应类型守卫（type guard）替代 `as any`。

**M-4 tsconfig 未覆盖 scripts/ 与 drizzle/，关键脚本无类型检查**
- 位置：`tsconfig.json:2`（include 仅 `client/src`、`shared`、`server`）
- 证据：`npx tsc --noEmit` exit 0 只覆盖三目录；`scripts/`（回填/gate/迁移）与 `drizzle/`（schema）不被 `check` 检查。实测隐患：`calibrate_open_expectation.ts:74 const out: any`、`migrate_add_high_volume.ts:16 as Array<{...}>` 硬断言。
- 风险说明：承担数据正确性的回填/gate 脚本反而游离于类型检查之外（H-1 的 bug 正因 `.mjs` 无类型约束）。
- 改进建议：把 `scripts/**/*`、`drizzle/**/*` 纳入 tsconfig include（或单独 tsconfig），关键 gate 脚本改 `.ts` 以获得类型保障。

**M-5 前端 StrategyEditor 硬编码虚构种子文档**
- 位置：`client/src/pages/StrategyEditor.tsx:72-173`
- 证据：`TEMPLATE_DOCUMENT` 硬编码 `fingerprint:"c8f0996d…"`、`datasetVersion:"rd-1.0.0-1-cffc2a0e66efbf0b"`、`universeId` 及完整 hash 链，作为编辑器默认内容提交 `validate` 后展示"校验通过"。
- 风险说明：与"禁止 mock 冒充真实数据"铁律冲突；引用可能不存在的 dataset 版本，误导用户以为在编辑真实策略。
- 改进建议：默认值改为空 + 明确"演示示例"标注，或由后端 `catalog.list` 拉取真实策略元数据。

**M-6 Map.tsx 死代码含 `VITE_` API key 引用**
- 位置：`client/src/components/Map.tsx:89-93`
- 证据：`API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY`；`MapView` 无任何文件 import（仅自身注释引用）。
- 风险说明：`VITE_` 前缀变量会打进 bundle；一旦该组件被引用，地图代理 key 即对客户端可见（当前因死代码未实际打包，故降为 MEDIUM）。
- 改进建议：删除该死代码文件，或改为服务端代理注入。

**M-7 status 历史表非幂等（可复现性违例）**
- 位置：`scripts/backfillStatusLiquidity_sql.ts:105-106`
- 证据：注释自认 `research_security_status_history 无唯一约束，纯 INSERT，同一 (securityId,statusType,effectiveFrom,effectiveTo) 可能产生重复行`。
- 风险说明：重跑回填会产生重复行，破坏可复现性。
- 改进建议：加应用层去重或唯一索引，保证重跑幂等。

**M-8 `asOf=null` 双语义冲突**
- 位置：`server/historicalState/reconstruct.ts:17`（`asOf=null`=全知视角）vs `server/researchDataset/policy.ts:302`（`asOf:null`=逐日 PIT）
- 风险说明：同一 `null` 值在不同模块语义相反，仅靠注释区分，易被误用。
- 改进建议：用显式枚举 `{mode:"omniscient"}` vs `{mode:"perTradeDate"}` 替代 null 双关。

**M-9 schema 三源 drift + securityCode 字段语义双轨**
- 位置：`drizzle/schema.ts`（24 表）、`drizzle/*.sql`、`scripts/migrate_*.ts` 三套定义并存；`schema.ts:693`（identifier_history.securityCode=6 位无后缀）vs `schema.ts:463/545`（liquidity/industry.securityCode=带 .SH/.SZ 后缀）
- 风险说明：跨表关联需经 `CONCAT(ih.securityCode,'.',ih.exchange)` 桥接，易静默失配。
- 改进建议：确立 schema.ts 为唯一来源；STEP 12.5 identity 层提供唯一 normalize 函数 + 单测。

**M-10 BaoStock 串行约束靠约定，无跨进程锁**
- 位置：`scripts/backfillStatusLiquidity.ts:486`、`scripts/backfillCorporateActionsBaostock.ts:157`
- 风险说明：两个脚本各自独立 login，orchestrate 靠串行编排规避并发，但无跨进程 Session 探测/锁，手动并发即违反 §30 单 Session 铁律（历史已发生 28 次"用户未登录"）。
- 改进建议：脚本启动时探测活跃 Session，有占用即拒绝启动。

**M-11 旧编号命名残留 + 临时文件残留**
- 位置：`server/research/signalEngine/engine.ts:115`（`strategy13`）、`strategySchema/map.ts:275`（`strategy13ToRecipeRef`）、`server/routers.ts.tmp`（288B 未完成片段）
- 风险说明：`Strategy13`/`signal13` 等旧 STEP 编号命名未迁移，与现行语义命名混杂；`.tmp` 残留污染源码树。
- 改进建议：按 §49 命名规范统一重命名；删除 `.tmp`。

---

### 🟢 LOW（6 项）

- **L-1** 前端类型安全：`Home.tsx`/`Market.tsx`/`Upload.tsx` 多处 `any`、`Backtest.tsx:74` 非空断言 `!`、`adapters/strategyAdapter.ts:154` 与 `Upload.tsx` 用 `Math.random()` 生成业务 ID、`MarketDataInput.tsx:37`/`useComposition.ts:51` 定时器未清理。
- **L-2** 空 catch 静默降级：`server/research/signalToPnl/engine.ts:651`（冻结释放失败无任何日志，注释自称"不静默"）、`server/db.ts:1994/2049/2156`、`dataHealth.ts:311` 多处 `JSON.parse` 空 catch。
- **L-3** 前端硬编码量化默认参数：`Backtest.tsx:22-28`（早盘 3.2%/上午 1.6%）、`Market.tsx:198`（两融余额 Y 轴 domain 下限 7500）。
- **L-4** 板块前缀启发式重复定义：`Home.tsx:56-61, 665-670`（300/688/920 前缀判断两处重复）。
- **L-5** `DATABASE_URL` 双处读取：`server/db.ts:72` 与 `server/_core/env.ts:4`；`scripts/orchestrate_backfill.mjs:17` 硬编码 Python 绝对路径 `C:/Users/A/.workbuddy/...`；`scripts/_coverage_audit_raw.json:165` 泄露真实库名。
- **L-6** 非空断言 `!` 约 269 处，集中在确定性纯函数内部（如 `reconstruct.ts:96 sorted[0]!`），风险可控但建议逐步收敛。

---

## 5. 配置与依赖审计结论

| 项 | 结论 | 备注 |
|---|---|---|
| TypeScript 严格模式 | ✅ `strict: true` | 但 include 不含 scripts/drizzle（见 M-4） |
| 类型检查 | ✅ `tsc --noEmit` exit 0 | 仅覆盖 client/shared/server |
| 测试 | ❌ 6 文件 14 用例失败 | 非封闭，见 H-2 |
| 依赖 | ⚠️ `wouter@3.7.1` 有 patch；`overrides: tailwindcss>nanoid=3.3.7` | 正常，无已知高危 |
| 密钥管理 | ❌ `.env` 明文 + 弱 JWT + 探针硬编码 token | 见 C-1 |
| 构建产物 | ⚠️ `dist/index.js` 与 `dist/public/assets/*.js` 命中秘密特征 | dist 已 gitignore，但含凭据的 bundle 需确认不外发 |

## 6. 模块级状态速览（代码层）

- `server/historicalState/` + `audit/`：✅ PIT/asOf 边界清晰，CODE_READY（VALIDATED 依赖数据）
- `server/researchDataset/`：✅ 确定性 datasetVersion + policy 9 类齐备，CODE_READY
- `server/research/`（29 子模块）：✅ 研究链 29/29 编码完成，铁律断言到位，CODE_READY
- `server/engine/` / `backtest/` / `simulator/`：⚠️ 三套并存（M-1），各自正确但口径未统一
- `server/security/`：⚠️ 退市股 listedDate 拒绝缺口（H-3）
- `server/_core/sdk.ts`、`researchRouter.ts`：⚠️ 类型安全边界（M-2/M-3）
- `scripts/`：❌ gate 恒 false（H-1）+ 非幂等（M-7）+ 无类型检查（M-4）
- `client/`：✅ tRPC 契约前后端对齐、数据真实性纪律好；⚠️ 硬编码种子文档（M-5）、死代码（M-6）、any 残留（L-1）
- `drizzle/`：⚠️ 三源 drift + 字段语义双轨（M-9）

## 7. 证据矩阵（Evidence Matrix）

| Domain | Claim | Evidence | Status | Confidence |
|---|---|---|---|---|
| 凭据安全 | 无硬编码秘密 | `.env` 明文 + `_tushare_probe*.py` 硬编码 token | FAIL | HIGH |
| Gate 正确性 | Migration 检查可 PASS | `step12_certify_gate.mjs:112` 类型不匹配恒 false | FAIL | HIGH |
| 测试 | 套件全绿 | `vitest run` 14 failed / 2305 | FAIL | HIGH |
| 类型检查 | 全仓干净 | `tsc --noEmit` exit 0（不含 scripts/drizzle） | PASS(受限) | HIGH |
| Survivorship | 退市股完整入 Master | `buildSecurityMaster.ts:87` 拒绝缺 listedDate | PARTIAL | HIGH |
| PIT | 无 look-ahead | reconstruct/audit 双重断言 + asOf 强制显式 | PASS(代码) | HIGH |
| 可复现性 | 回填幂等 | status 历史表纯 INSERT 非幂等（M-7） | FAIL | HIGH |
| 架构 | 单一直口径 | 三套回测引擎并存（M-1） | PARTIAL | MEDIUM |
| 契约 | 前后端一致 | research/dataHealth/historicalState/researchDataset router 对齐 | PASS | HIGH |

## 8. 阻断问题（Blocking）

1. **C-1** 凭据硬编码 + 公开仓库 → 轮换密钥 + 清理探针文件（安全阻断）。
2. **H-1** gate Migration 检查恒 false → `RESEARCH_READY=TRUE` 永久被卡（正确性阻断）。
3. **H-2** 测试非封闭 14 失败 → VALIDATED 证据链不成立。
4. **H-3** 退市股 listedDate 拒绝 → SURVIVORSHIP_GATE 完整性缺口。

## 9. 建议处置（按优先级）

1. **立即**：轮换 TiDB 密码 + TUSHARE_TOKEN + JWT_SECRET；删除根目录探针/临时文件；补 `.gitignore` 规则（`_*.py`/`_*.mjs`/`_*.mts`/`.audit-*.json`）；`git log --all` 核查历史是否曾提交 `.env`。
2. **P0**：修复 `step12_certify_gate.mjs:112` 时间口径（H-1），并补格式断言测试。
3. **P0**：把 scripts/ + drizzle/ 纳入 tsc（M-4），关键 gate 脚本改 TS。
4. **P1**：测试套件封闭化（mock 外部 API/DB，见 H-2）；核对并处理 rejected 退市股名单（H-3）。
5. **P1**：确立 `engine/execution.ts` 为唯一成本/成交来源，收敛三套引擎口径（M-1）。
6. **P2**：收敛 M-2~M-11 类型安全/命名/幂等/语义双轨问题。

## 10. 下次审计触发

- C-1/H-1 修复后复核；测试套件封闭化后复核；
- 任一数据域状态向 DATA_READY/VALIDATED 迁移时（届时恢复 DB 数据审计）；
- 或按宪章 §11 任一触发条件命中时。

---

## 附：与历次审计的关系

本次为**代码层全量审计**（AUDIT-002），与 AUDIT-001（STEP 12 数据域审计）互补：AUDIT-001 结论（数据域 C/D/E 未全量、A-B universe 错配、行业历史语义缺口）在本轮**未复核**（本轮不审计 DB 数据）。二者共同约束：`RESEARCH_READY = FALSE` 的判断依据为「代码层 H-1/H-2/H-3 未解 + 数据层 C/D/E 未全量」双轨。
