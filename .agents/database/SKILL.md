---
name: database-agent
description: 数据库安全检查与变更影响评估。默认只读；任何 DDL/DML/迁移动作都必须先输出影响报告并获得明确授权。
---

# Database Agent Skill

> 先读仓库根 `AGENTS.md` §4（数据库规则）。
> **默认只读。** 危险操作必须**先报告、后授权、再执行**。

## 1. 允许（默认）

- schema inspection（`drizzle/schema.ts`、`information_schema` 只读查询）
- `SELECT`（只读查询 / 统计 / 对账）
- migration inspection（`drizzle/*.sql` + `drizzle/meta/**`）
- dependency analysis（谁读/写这张表；对照 `docs/architecture/DATABASE-MAP.md`）
- SQL draft（**只写不进库**）
- migration validation（幂等性检查、`--dry-run` / `--check`）

## 2. 默认禁止

```text
pnpm run db:push            ❌（= drizzle-kit generate && migrate；当前 journal 止 0023 / snapshot 止 0015 ⇒ 不可用）
drizzle-kit generate        ❌
手写 / 修改 _journal.json    ❌（属伪造）
修改历史 migration          ❌
DROP TABLE / DROP COLUMN    ❌（除非明确授权且已登记影响）
TRUNCATE / 批量生产数据修改  ❌
增加不必要的外键           ❌（当前全库 0 FK，跨表一律软引用）
```

## 3. 本仓库真实的 migration 机制（务必按它走）

- migration 文件：`drizzle/0000…*.sql`（编号连续，全部**手写 SQL**）。
- **`db:push` 不可用**：`drizzle/meta/_journal.json` 止于 `idx=23`，snapshot 只到 `0016` ⇒ 之后**只能**靠旁路执行器。
- 执行器：`scripts/applySqlMigration.mjs`（通用，按 `--> statement-breakpoint` 切句，按 `-- @guard` 查 `information_schema` 跳过已存在对象）+ 每个 migration 一个专用 `scripts/apply*.mjs|mts`。
- **不存在「一键 up 全部」脚本。**
- 幂等判据：apply 两次 ⇒ 第二次 `0 executed / N skipped`。
- 🔴 `@guard` 语义 = 「目标已存在即跳过」。对**删除类**语句不能加 guard（否则永远删不掉），此时用 `DROP TABLE IF EXISTS` 自身幂等。
- 🔴 破坏性 migration 必须写**回滚段**（改名/重建步骤），并保留历史行（RENAME 为 `archive_*` 而不是 DROP）。

## 4. 数据库变更影响报告（强制）

如果需要数据库变更，**必须**先输出下列六项并等待明确授权：

```text
Reason              为什么非改库不可（能不能用代码解决？）
Affected Tables     受影响表 / 列 / 索引（读方 + 写方都要列）
Compatibility       与旧数据 / 旧代码的兼容性（存量行怎么办、老版本代码会不会挂）
Migration Plan      新 SQL 文件编号 + apply 脚本 + 幂等策略 + 执行顺序
Rollback Plan       回滚步骤（RENAME 回原名 / 重建被 DROP 的表）
Validation          验证方式（幂等复跑 / 行数对账 / 只读探针 / 相关测试）
```

> 没有这六项 = 不允许执行。执行时**不得**触碰 `.env` 凭据入库、不得把生产数据导出到仓库。

## 5. 只读检查清单

1. 表是否存在于 `drizzle/schema.ts`？还是只在 migration SQL 里？（两者不一致是常见状态）
2. 是**声明表**还是**迁移建表**？真实库需要只读探针确认。
3. 谁写这张表？（`INSERT` / `UPDATE` / `DELETE` / `RENAME` 的调用点）
4. 谁读这张表？（仓储 / 查询层 / tRPC 端点）
5. 是否有唯一约束 / 索引？跨表引用是软引用（0 FK）吗？
6. 是否是历史归档表（`archive_*`）？归档表**不得**重新进入读路径。
7. 变更会不会影响 `datasetVersionId` / `decisionOffsetDays` / PIT 结构？（见 `AGENTS.md` §2）

## 6. 输出模板

```text
Inspection Scope        查了什么（表 / 列 / 索引 / migration）
Findings                事实（实查，不推断）
Risks                   风险（含并发写入 / 在途 Run / 归档表误用）
Recommendation          建议（只读不改 / 需要变更 → 附第 4 节六项报告）
Authorization           等待授权 / 已授权（授权来源）
```