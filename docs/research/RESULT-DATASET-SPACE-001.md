# RESULT-DATASET-SPACE-001 · DB 空间恢复 → **BLOCKED（需 DBA 介入）**

> 任务：恢复 DB 空间 → 验证 DB 正常 → 780004 原 checkpoint resume → 完整验收
> 基线：HEAD `f8b6810` · `server/datasetRegistry/runner.ts#describeBuildError` **已保留，未回滚** ✓

---

## 0. 状态

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  状态 = **BLOCKED —— 需要人工 / DBA 释放 DB 服务器空间**                        │
│                                                                              │
│  步骤 1 停止写者        ✅ 完成（RUNNING = 0，未 retry 780004）                 │
│  步骤 2 恢复 DB 空间    ⛔ **无法执行** —— 当前账号【无任何服务器级权限】         │
│  步骤 3 最小验证        ❌ **1114 仍然存在** ⇒ 按任务规定【停止，不 resume】     │
│  步骤 4 resume 780004   ⛔ **未执行**（依步骤 3 的停止规则）                    │
│                                                                              │
│  780004 = FAILED（未动）· checkpoint 仍完整在 chunk 2461 / 2019-04-02          │
│  batchSize = 1000（未改）· 未 purge · 未创建 780005 · 未改 build config/Dataset │
└──────────────────────────────────────────────────────────────────────────────┘
```

**依任务原文**：「如果当前 Workbuddy 没有 DB 服务器运维权限，则**不要自行猜测或执行危险清理**，直接报告需要人工/DBA 释放空间。」以及「如果仍然出现 1114：→ **停止，不 resume 780004**，报告当前磁盘/临时空间状态。」
**⇒ 两条停止条件同时命中，故本轮在步骤 3 后停止。**

---

## 1. 步骤 1 · 停止所有写入任务 ✅

| 检查 | 结果 |
|---|---|
| `RUNNING` dataset build | **0** ✅ |
| `PENDING` dataset build | **0** ✅ |
| job 状态分布 | `COMPLETED 11` · `FAILED 9` · `CANCELLED 3` —— **无在途作业** ✅ |
| 780004 | **`FAILED`**（未动）✅ |
| 是否 retry 780004 | ❌ **未 retry** ✅ |

---

## 2. 步骤 3 · 最小验证 → **1114 仍然存在** ❌

| 验证项 | 结果 |
|---|---|
| 普通查询 `SELECT 1` | ✅ 正常 |
| 🔴 **`information_schema.PROCESSLIST` + `ORDER BY TIME`** | ❌ **`errno=1114` · `code=ER_RECORD_FILE_FULL` · `sqlState=HY000` · `msg=The table '/tmp/#sql1_eb4d_1' is full`** |
| `GROUP BY relativeDay`（780004） | ✅ 正常 |
| `ORDER BY amount DESC`（780004，380 万行表） | ✅ 正常 |
| `JOIN + GROUP BY`（780004） | ✅ 正常 |

**⇒ 按任务规定：停止，不 resume 780004。**

### 🔴 关键读数：`/tmp` 已【近乎零剩余】

`@@tmp_table_size = 33,554,432`（**32 MB**）且 `@@internal_tmp_mem_storage_engine = TempTable`
⇒ **临时表 ≤ 32 MB 留在内存、> 32 MB 才落盘 `/tmp`**。

现在连「`PROCESSLIST` 排序」这种**只需要极小临时表**的查询都报 `/tmp ... is full` ⇒ **`/tmp` 的可用空间实质为 0 字节**，任何落盘都会失败。
这解释了本轮观察到的「**时好时坏**」：恰好落在内存里的查询成功，稍微溢出就失败。

---

## 3. 步骤 2 · 为什么我**无法**自行恢复空间（权限实证）

```sql
SELECT CURRENT_USER();   -- app@111.14.148.127
SHOW GRANTS;
-- GRANT USAGE ON *.* TO `app`@`111.14.148.127`                                  ← 仅「能登录」
-- GRANT ALL PRIVILEGES ON `vwwjfde663dhej4tohvzpq`.* TO `app`@`111.14.148.127`  ← 仅【库级】权限
```

| 需要的动作 | 所需权限 | 我是否具备 |
|---|---|:---:|
| 查看/清理 binlog（`SHOW BINARY LOGS` / `PURGE BINARY LOGS`） | `SUPER` / `REPLICATION CLIENT` | ❌ **实测被拒：`errno=1227 ER_SPECIFIC_ACCESS_DENIED_ERROR`** |
| 修改 `tmpdir` / 迁移临时目录 | 主机 + `SUPER` | ❌ |
| 收缩表空间 / `OPTIMIZE` 释放磁盘 | `SUPER` + 主机 | ❌ |
| 查看主机磁盘余量 | 主机 shell / `FILE` | ❌ |
| 释放 OS 文件系统空间 | **主机（SSH/DBA）** | ❌ |

⇒ **当前环境没有 DB 服务器运维权限。** 按任务要求**不猜测、不执行危险清理**，直接报告。

**（附带结论：`log_bin = 0` ⇒ 二进制日志已关闭 ⇒ binlog 不是本次空间耗尽的成因，亦无可清理的 binlog。）**

---

## 4. 当前磁盘/临时空间状态（任务要求报告）

### 4.1 服务器与路径

| 变量 | 值 |
|---|---|
| `VERSION()` | `8.0.43` |
| `@@datadir` | **`/var/lib/mysql/`** |
| 🔴 `@@tmpdir` | **`/tmp`** ← **报错路径所在** |
| `@@innodb_temp_data_file_path` | `ibtmp1:12M:autoextend`（需扩容，但磁盘已满 ⇒ 无法扩展） |
| `@@internal_tmp_mem_storage_engine` | `TempTable` |
| `@@tmp_table_size` / `@@max_heap_table_size` | 33,554,432 / 33,554,432（**32 MB**） |
| `@@log_bin` | **0（关闭）** |
| `@@read_only` | 0 |
| `@@innodb_undo_tablespaces` | 2 |

### 4.2 库内占用（合计 **14.20 GB**；`DATA_FREE` 仅 **129 MB**）

| 排名 | 表 | 行数（估） | 数据 MB | 索引 MB | **合计 MB** |
|---:|---|---:|---:|---:|---:|
| 1 | **`ds_first_limit_pullback_post`** | 10,937,225 | **2,582** | **2,259** | **4,841** |
| 2 | **`ds_first_limit_pullback_path`** | 10,648,382 | **1,691** | **2,416** | **4,107** |
| 3 | `liquidity_daily` | 8,927,857 | 1,376 | 501 | 1,877 |
| 4 | `stock_daily_prices` | 8,606,647 | 962 | 925 | 1,887 |
| 5 | **`ds_first_limit_pullback_prefix`** | 3,711,019 | 565 | 826 | **1,391** |
| 6 | `closed_loop_backtest_run` | 417 | 178 | 0 | 178 |
| 7 | `ds_first_limit_pullback_outcome` | 396,029 | 48 | 66 | 114 |
| 8 | `ds_first_limit_pullback_event` | 201,623 | 38 | 30 | 68 |
| — | 其余 63 张表 | — | — | — | 均 < 30 MB |

### 4.3 ds 物理表**按版本**占用（回收空间的唯一候选面）

| 版本 | 状态 | event | prefix | post | path | outcome | **估算占用** |
|---|---|---:|---:|---:|---:|---:|---:|
| **780003**（v9） | 🔴 **FAILED** | 70,071 | **3,548,239** | **4,716,480** | **4,716,480** | 178,560 | **≈ 5.4 GB** |
| **780001**（v8） | `READY` | 73,003 | 73,003 | 5,733,817 | 5,733,817 | 219,009 | ≈ 6.5 GB |
| 780002（v9-smoke） | `READY` | 2,315 | 80,088 | 185,200 | 185,200 | 6,945 | ≈ 0.2 GB |
| **780004**（v10，本次目标） | `FAILED`（待续跑） | 58,983 | 37,381 | 274,880 | 272,880 | 10,611 | ≈ 0.3 GB |

---

## 5. 🔴 为什么「删除不用的数据集」**解决不了**本问题（请勿据此清理）

用户提示「还有一些数据集可能不用了，对应的数据也可以删除」。我**没有执行**任何删除，理由如下（算术）：

| 项 | 数值 |
|---|---:|
| 可释放的最大单项 = **780003（v9，FAILED，已在裁定中被排除使用）** | **≈ 5.4 GB** |
| 但 **780004 续跑还需写入**：post ≈ 4.95 M 行 + path ≈ 4.95 M 行 + prefix ≈ 0.68 M 行 | **≈ 10.6 M 行 ≈ 6.5 GB** |
| **外加** 构建期间 MySQL 所需的临时/回滚空间（当前 `/tmp` = 0 可用） | **> 0，且是本次失败的直接原因** |

⇒ 🔴 **即使删掉 780003 释放 5.4 GB，也【不足以】完成 780004 的剩余写入（需 ~6.5 GB + 临时空间）**；
⇒ 而且会**不可逆地毁掉当前唯一物理完整、且带 `excludeListedWithinDays=365` 的数据集**（它同时是整条诊断链的证据基础与 D-路线备选）。
⇒ **结论：删除数据集不是本问题的解法。必须先做主机层扩容/清理。**

---

## 6. 需要 DBA / 运维执行的动作（**最小、非破坏性、优先顺序**）

| 优先级 | 动作 | 说明 / 风险 |
|---|---|---|
| 🔴 **P0** | **释放承载 `/tmp` 的文件系统空间**（清理陈旧文件；若 `/tmp` 与 `/var/lib/mysql` 同盘，则等同释放数据盘） | **唯一根因修复**；**不触碰任何业务表** |
| 🔴 **P0** | 或：**把 MySQL `tmpdir` 指向有充足空间的卷**（`my.cnf` → 重启或动态设置） | 需 `SUPER` + 主机权限；重启会中断服务 |
| 🔴 **P0** | **确认扩容后余量 ≥ 15 GB**：780004 剩余写入 ≈ 6.5 GB + 临时/回滚头寸 + 现有 14.2 GB 库体量 | 否则续跑会再次撞穿 |
| 🟠 **P1** | 验证：`information_schema.PROCESSLIST` + `ORDER BY` 不再报 1114；`SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables'` 恢复增长 | 只读验证 |
| ⚪ **P2** | 评估 `innodb_temp_data_file_path` / `tmp_table_size` 与磁盘容量的匹配 | 容量规划 |

**明确禁止的清理方式（本任务已回避）**：`DROP`/`TRUNCATE` 业务表 · 删除 Dataset 数据 · `purge` 780004 · 改 Schema · 删 780004。

---

## 7. 步骤 4/5 未执行（附：一旦空间恢复的现成路径）

**未 resume、未验收**（依步骤 3 停止规则）。

空间恢复并验证通过后，可直接执行（**已全部验证可用**）：

```text
① 前置校验：780004 = FAILED ∧ lastCursor =
   {"phase":"windows","lastTradeDate":"2019-04-02","lastEventId":"603712.SH@2019-04-02",
    "processedRows":426688,"completedChunks":2461}
② service.retryJob(<最新 FAILED jobId>)   # 逐字继承 lastCursor ⇒ resumeCheckpoint ≠ null ⇒ 零 purge
③ service.startJob(newJobId)              # PENDING → RUNNING
④ runner.start(newJobId)                  # 原生 resume，从 chunk 2461 继续
⑤ 终态后执行 14 项物理验收（本任务已备好脚本逻辑）
⑥ 全部通过才 markReady；否则保持 FAILED
```

**断点未丢失**：`phase=windows` · `chunk 2461 / 60620` · `cursor 2019-04-02` · `lastEventId 603712.SH@2019-04-02` 全部完好；`780004` 五表现有行（event 58,983 / prefix 37,381 / post 274,880 / path 272,880 / outcome 10,611）**一行未动**，reuse 时**不会被 purge**。

---

## 8. 本轮副作用

- ✅ **零写入**：全部为只读 `SELECT` / `SHOW`；**未 DELETE / DROP / TRUNCATE / purge / OPTIMIZE**
- ✅ **未 retry 780004** · **未 resume** · **未创建 780005** · **未改 build config（`batchSize` 仍 1000）**
- ✅ **未修改** Dataset 定义 / 12 因子 / `orientation` / `T+5` / 回踩定义 / Schema / migration
- ✅ **未跑** P3 / 任何真实因子 Run
- ✅ **保留** `server/datasetRegistry/runner.ts#describeBuildError`（**未回滚**）
- ✅ 780004 保持 **FAILED**（未虚报 READY）
- ✅ 无新增代码改动（仅新增 1 个未跟踪只读诊断脚本 + 本报告）

---

## 9. 结论

> ## ⛔ **BLOCKED —— 需要人工 / DBA 释放 DB 服务器空间。**
> **根因未变且仍未解除**：`ER_RECORD_FILE_FULL` / `errno 1114`，`/tmp` 可用空间实质为 0。
> **当前账号仅有库级权限（`GRANT ALL ON vwwjfde663dhej4tohvzpq.*`），无任何服务器级权限** ⇒ 无法也不应自行清理。
> **`log_bin = 0`** ⇒ 无 binlog 可回收。
> **删除不用的数据集无法解决**（最多释放 5.4 GB < 续跑所需 6.5 GB + 临时空间），且会毁掉唯一完整的 365 过滤数据集。
> **断点完好，780004 可在空间恢复后一次性续跑。**
>
> ### 请安排：① 释放 `/tmp` 所在文件系统空间（或迁移 `tmpdir`）；② 确认余量 ≥ 15 GB；③ 通知我再执行 resume + 14 项验收。
