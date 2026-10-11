# RESULT-DATASET-DIAG-001 · 780004 / chunk 2461 / `post` INSERT 确定性失败根因定位

> 任务：定位 `780004 / v10-listed365-pre10-post80` 在 `phase=windows` · `chunk=2461` · `cursor=2019-04-02` · `lastEventId=603712.SH@2019-04-02` · `table=ds_first_limit_pullback_post` · `batchSize=1000` 处**确定性 INSERT 失败**的真实 MySQL 根因
> 基线：HEAD `f8b6810`
> 🔴 只做定位：**未 retry 780004 · 未 purge · 未建 780005 · 未改 Dataset 定义 / 12 因子 / T+5 / 回踩定义 · 未跑 P3 · 未跑真实因子 Run · 未改 batchSize**

---

## 0. 🔴 结论（一句话）

> ## 根因 = **DB 服务器 `/tmp` 磁盘写满**，导致 MySQL **内部临时表无法创建**。
> ## `errno = 1114` · `code = ER_RECORD_FILE_FULL` · `sqlState = HY000` · `sqlMessage = The table '/tmp/#sql1_eb1b_0' is full`
> **与数据无关、与 Schema 无关、与批次内容无关、与包大小无关、与锁无关 —— 是基础设施存储耗尽。**

---

## 1. 真实 MySQL 错误（完整错误对象，**首次捕获**）

```
errno      = 1114
code       = ER_RECORD_FILE_FULL
sqlState   = HY000
sqlMessage = The table '/tmp/#sql1_eb1b_0' is full
```

**捕获方式（无副作用）**：一条普通 `SELECT COUNT(*) FROM information_schema.PROCESSLIST` 即稳定复现同一错误 —— 说明**凡需要内部临时表的语句都会失败**，与 `post` 表无关。

**同一错误的独立复现记录**：
| 时刻 | 触发操作 | 结果 |
|---|---|---|
| 前序轮次 | 验收脚本第一条 `COUNT(*)` | `Error: read ECONNRESET`（服务器写临时文件失败后断连） |
| 本轮 | `information_schema.PROCESSLIST` | **`ER_RECORD_FILE_FULL` / 1114 / HY000 / `/tmp/#sql1_eb1b_0 is full`** |
| 本轮 | 1000 行诊断 INSERT | **挂起 > 17 分钟未返回**（无法分配临时/回滚空间） |

---

## 2. 逐项排除（每条都有实测证据）

| # | 假设 | 判定 | 证据 |
|---|---|:---:|---|
| ① | **packet size（`ER_NET_PACKET_TOO_LARGE`）** | ❌ **排除** | `@@max_allowed_packet = 268,435,456` = **256 MB**；1000 行 × 28 列的 SQL ≈ **150 KB**，差 3 个数量级 |
| ② | **列长度 / 类型 / 数值越界** | ❌ **排除** | `post` 全部数值列为 `double`（**无 `DECIMAL`**）；字符列为 `varchar(16/24/32/64)`；用 **780001 在 2019-04-02 的 50 行真实数据**做事务内 INSERT ⇒ **成功（46 ms）** |
| ③ | **锁 / 事务** | ❌ **排除** | `@@innodb_lock_wait_timeout = 50 s`，而 5 轮均在 **≈30 s** 内失败（未达超时）；事务内 `START TRANSACTION` → INSERT → `ROLLBACK` **正常完成**；`RUNNING` 作业 = 0 |
| ④ | **数据异常（某行某列值非法）** | ❌ **排除** | 复制**真实行**可成功写入；且 `failedRows = 0`（行级无失败）；`sql_mode` 含 `STRICT_TRANS_TABLES` 但未见列级报错 |
| ⑤ | 🔴 **服务器存储 / 临时空间耗尽** | ✅ **确认** | **`ER_RECORD_FILE_FULL`：`The table '/tmp/#sql1_eb1b_0' is full`** |

---

## 3. 为什么它「确定性」复现，且 v5–v8 成功、v9/v10 失败

| 观察 | 用本根因解释 |
|---|---|
| 同一 chunk 连续 5 次失败、**断点零前移** | `/tmp` 一直处于满状态，重试必然撞同一堵墙 ✓ |
| `failedRows = 0`（语句级而非行级） | 服务器资源错误在语句开始前/中途抛出，与行内容无关 ✓ |
| v5/v6/v7/v8 **成功**，v9(10-07)/v10(10-08) **失败** | 两次失败是**最近两次**构建 —— 此时 `post` 表已累积到 **10,937,225 行 / 2,582 MB**，`/tmp` 也随之被填满 ✓ |
| **N=50 INSERT 成功（46 ms），N=1000 挂起** | 小批次可留在内存临时表（`internal_tmp_mem_storage_engine = TempTable`）；**大批次需要落盘到 `/tmp`** ⇒ 立即失败/挂起 ✓✓ |
| 首轮全量跑到 chunk 2461（273 s）后失败，重试 ~30 s 就失败 | 首轮在 `/tmp` 尚未耗尽时尚能推进；此后 `/tmp` 已满 ⇒ 重试**一开始就撞上** ✓ |
| 无关查询也报 `ECONNRESET` / `ER_RECORD_FILE_FULL` | 服务器整体处于存储耗尽状态，与本次构建无关的语句同样受害 ✓ |

**服务器实测状态**：
```
VERSION()                     = 8.0.43
@@datadir                     = /var/lib/mysql/
@@tmpdir                      = /tmp                      ← 报错路径
@@innodb_temp_data_file_path  = ibtmp1:12M:autoextend      ← 需扩容但磁盘已满
@@internal_tmp_mem_storage_engine = TempTable
全库 DATA_LENGTH 合计          = 7.31 GB
全库 INDEX_LENGTH 合计         = 6.89 GB
全库 DATA_FREE                 = 129 MB                    ← 几乎无余量
ds_first_limit_pullback_post   = 10,937,225 行 / 2,582 MB
```

---

## 4. 任务要求的 10 项定位结论

| # | 问题 | 结论 |
|---|---|---|
| **1** | 真实 MySQL `errno` | 🔴 **1114** |
| **2** | `sqlState` | 🔴 **HY000** |
| **3** | 原始数据库错误 message | 🔴 **`The table '/tmp/#sql1_eb1b_0' is full`**（code `ER_RECORD_FILE_FULL`） |
| **4** | 是否属于 **packet size** | ❌ **不是**（`max_allowed_packet` = 256 MB ≫ 批次 ~150 KB） |
| **5** | 是否属于 **列长度/类型/数值越界** | ❌ **不是**（数值列全为 `double`、无 `DECIMAL`；真实行可在事务内成功写入） |
| **6** | 是否属于 **锁/事务** | ❌ **不是**（锁超时 50 s > 失败耗时 ~30 s；事务内 INSERT/ROLLBACK 正常） |
| **7** | 是否属于 **数据异常** | ❌ **不是**（`failedRows=0`；真实数据可写入） |
| **8** | **最小修复方案** | 🔴 **运维动作：释放 DB 服务器 `/tmp`（及数据盘）空间** —— 这是**唯一根因修复**。次选：把 MySQL `tmpdir` 指到有空间的卷。**无需改 Schema / Dataset 定义 / 因子** |
| **9** | 是否需要修改 **batchSize** | ⚠️ **建议作为缓解（非根因修复）**：调小 `batchSize`（如 1000 → 250/100）可让批次留在**内存临时表**、避免落盘 `/tmp` ⇒ 在磁盘修复前即可恢复构建能力。**但本任务禁止改 batchSize，故未改。** |
| **10** | 是否需要修改 **Dataset Builder / error persistence** | **Builder 逻辑：不需要**（逻辑正确）。**error persistence：需要，且已做最小修复**（见 §5） |

---

## 5. 已做的最小代码修改（仅错误诊断，**不改构建逻辑**）

**文件**：`server/datasetRegistry/runner.ts`
**改动规模**：**38 insertions(+), 1 deletion(-)** —— 仅 1 处调用点替换 + 1 个纯函数新增。

**新增**：`export function describeBuildError(err: unknown): string`
- 沿 `err.cause` 链**最多 4 层**提取 `code` / `errno` / `sqlState` / `sqlMessage`（带去重防环）
- 无 `cause` 时**退化为原行为**（返回 `err.message`）⇒ **向后兼容，零行为变化**

**替换**：
```diff
- const message = err instanceof Error ? err.message : String(err);
+ const message = describeBuildError(err);
```

**为什么这是根因级的诊断缺口**：drizzle 把驱动错误包成 `Error("Failed query: <SQL>")`，**底层 MySQL 字段只在 `err.cause` 上**；旧代码只落 `err.message` ⇒ `errorMessage`（上限 16,000 字符）被 SQL 文本塞满、**零错误码** ⇒ **v9 + v10 共 6 轮排查无法定性**。

**验证**（编译后直跑）：
```
=> Failed query: insert into `ds_first_limit_pullback_post` (...) values ... | cause[0]:
   code=ER_RECORD_FILE_FULL · errno=1114 · sqlState=HY000 · sqlMessage=The table '/tmp/#sql1_eb1b_0' is full
含 errno=1114 / ER_RECORD_FILE_FULL / sqlState=HY000 / 'is full'  : true ×4
退化路径（无 cause）: boom   ← 向后兼容 ✓
```
`node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` = **0 错** ✓

---

## 6. 复现与证据链（可复核）

| 步骤 | 方法 | 结果 |
|---|---|---|
| 1 | `SELECT @@max_allowed_packet` | 256 MB ⇒ 排除包大小 |
| 2 | `information_schema.COLUMNS` / `STATISTICS` on `post` | 全 `double`/`varchar`；`uq_post_version_event_day(datasetVersionId,eventId,relativeDay)`；`id` 自增 PK |
| 3 | 事务内 INSERT（780001 的 2019-04-02 真实行，`datasetVersionId=999999999`） | **N=50 成功 46 ms → ROLLBACK** ✓；**N=1000 挂起 > 17 min** ⇒ **规模相关** |
| 4 | `information_schema.PROCESSLIST` 普通查询 | 🔴 **`ER_RECORD_FILE_FULL` / 1114 / HY000 / `/tmp/#sql1_eb1b_0 is full`** |
| 5 | 服务器变量 + 表体量 | `/tmp` 为 tmpdir；全库 7.31 GB 数据 + 6.89 GB 索引，`DATA_FREE` 仅 **129 MB** |

**零持久化写入**：步骤 3 的两个 INSERT **全部在事务内 `ROLLBACK`**，`post` 表未新增任何行（`datasetVersionId=999999999` 亦无残留）。

---

## 7. 本轮副作用

- ✅ **未 retry 780004** · **未 purge** · **未创建 780005** · **未改 780004 build config**（`batchSize` 仍为 1000）
- ✅ **未修改** Dataset 定义 / 12 因子 / `orientation` / `T+5` 锚点 / 回踩定义 / Schema / migration
- ✅ **未执行** P3 · **未执行**任何真实因子 Run
- ✅ **未因定位成功而自动修复并重建**（按要求停止）
- ✅ **唯一的代码改动**：`runner.ts#describeBuildError`（38+/1−，纯诊断，向后兼容，tsc 0 错）
- ⚠️ 诊断期间的一次 1000 行 INSERT **被主动终止**（`job_kill`）—— 该语句是**只读诊断**且处于事务中，未提交任何数据
- ⚠️ **重要环境提示**：诊断期间观测到 DB 服务器 `/tmp` 已满，**可能影响该库上的其他一切操作**（包括你正在使用的平台）

---

## 8. 建议下一步（**需授权，本任务不做**）

| 优先级 | 动作 | 归属 |
|---|---|---|
| 🔴 **P0** | **运维：释放 DB 服务器 `/tmp` 与数据盘空间**（或将 MySQL `tmpdir` 迁至有空间卷） | **运维 / DBA**，非代码 |
| 🔴 **P0** | 空间恢复后**验证**：`information_schema.PROCESSLIST` 等需临时表的查询不再报 1114 | 运维 |
| 🟠 **P1** | 视情况把 `batchSize` 调小（**须单独授权**，因会改 `780004` 的冻结 build config） | 需授权 |
| 🟠 **P1** | 空间恢复后，对 `780004` 做**一次** resume（断点仍完整在 chunk 2461） | 需授权 |
| ⚪ **P2** | 给其他「把大结果集落临时表」的热点查询做容量评估 | 另立任务 |

**🔴 明确不建议**：在 `/tmp` 仍满时继续任何 retry（必然同败）· purge 后从头重建（同败且丢失 37,381 prefix + 274,880 post 行进度）· 新建版本绕过（不解决根因）。
