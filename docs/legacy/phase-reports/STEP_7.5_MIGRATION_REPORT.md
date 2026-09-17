# STEP 7.5 — MIGRATION REPORT

## 一、结论

**迁移状态：DDL 已交付，apply 暂缓（pending）。** 原因有三，均非本步骤可单独解决：
1. **既有三态漂移**：`__drizzle_migrations` 仅 6 条，而 journal 有 16 条，中间存在 `drizzle-kit push` 产物。
2. **多 Worker 并发**：STEP 7.3 / 7.4 / 7.6 / 8 正在同时向 `drizzle/schema.ts` 加表，迁移编号未收敛。
3. **禁止 push / 禁止 reset**（§十）——故本步骤只交付审计 + 手动 DDL，不落库。

## 二、三态审计（只读实测）

| 层 | 状态 |
| --- | --- |
| `drizzle/schema.ts` | 已含 24 张表（含本步骤新增 `research_security_status_history`） |
| `drizzle/meta/_journal.json` | 16 条（idx 0–15） |
| 迁移文件 | `0000`–`0015` + `0016_market_data_infra.sql`（STEP 7.6）+ `0017_security_status_history.sql`（本步骤） |
| 实际 DB `__drizzle_migrations` | **6 条**（0000–0005 已应用） |
| 实际 DB 表 | **11 张**用户表（缺 4 张 research 表 + paper_trading_runs + 各并行新表） |

**漂移清单**（schema 定义但 DB 缺失，或 journal 与 DB 不一致）：

- schema 有、DB 无：`paper_trading_runs`、`research_experiments`、`research_runs`、`research_experiment_batches`（STEP 6 遗留，历史已知）。
- 并行新表（schema 已加、尚未迁移）：`backfill_checkpoints`、`adjustment_factors`、`corporate_actions`（7.3）、`research_securities`、`research_security_identifier_history`（7.4）、`industry_assignments`、`index_master`、`index_daily`、`liquidity_daily`（7.6）、`research_security_status_history`（7.5 本步骤）。

## 三、本步骤新增表

`research_security_status_history`（DDL 见 `drizzle/0017_security_status_history.sql`）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int AUTO_INCREMENT PK | |
| `securityId` | varchar(48) | 软引用 `research_securities.securityId`（sec_<uuid>），**不加 FK** |
| `statusType` | enum(LISTING,TRADING,ST,DELISTING,SUSPENSION) | 状态维度 |
| `statusValue` | varchar(32) | 维度内取值（含 `*ST`） |
| `effectiveFrom` | date | 生效日（含） |
| `effectiveTo` | date NULL | 失效日（含），null=至今 |
| `source` | varchar(64) | 来源 |
| `retrievedAt` | timestamp NULL | 抓取时间 |
| `confidence` | enum(high,medium,low) | 置信度 |
| `availability` | enum(IMMEDIATE,T_PLUS_1,UNKNOWN) | 发布时点语义 |
| `createdAt`/`updatedAt` | timestamp | |

索引：`idx_security_status_security_type_from (securityId,statusType,effectiveFrom)`、`idx_security_status_type_from (statusType,effectiveFrom)`。

**不设唯一约束**：允许同一 `(securityId,statusType,effectiveFrom)` 多行（不同 retrievedAt/source 版本），as-of 取最新由应用层排序完成。

## 四、为什么不用 `drizzle-kit generate` / `push`

- `generate` 会以「schema vs 0015 快照」做 diff，把**所有**并行新表（7.3/7.4/7.6 + 本步骤）一次性打包进下一个迁移，破坏各 Worker 的迁移归属，且与正在写入 journal 的其它 Worker 竞争。
- `push` 被 §十明确禁止。
- 故本步骤改为**手动编写独立 DDL**（风格对齐 `0016_market_data_infra.sql`），编号 `0017` 为占位，最终编号待集中收敛。

## 五、建议收敛路径（apply 前）

1. 等所有并行 Worker（7.3/7.4/7.6/8）的 schema 改动冻结。
2. 统一跑一次 `drizzle-kit generate` 产出**单一**合并迁移（或在确认漂移基线后按编号顺序 apply 各手动 DDL）。
3. 先补齐 `__drizzle_migrations` 基线（0006–0015 的「已存在表」需以幂等方式登记，避免重复 CREATE/ALTER 报错）。
4. 再 apply `research_security_status_history`（及其它新表），并补 `research_security_status_history.securityId` 到 `research_securities.securityId` 的 FK（若 7.4 采用 FK 策略）。

## 六、完成标准

- [x] 先审计 schema / journal / actual DB（三态实测）
- [x] 禁止 drizzle-kit push（未使用）
- [x] 禁止 reset database（未使用）
- [x] 新增表 + 迁移 DDL 交付
- [~] 实际 apply → **pending**（受既有漂移 + 并发制约，需集中收敛后执行）
