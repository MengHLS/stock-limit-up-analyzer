# RESULT-DATASET-SPACE-002 · 扩容后验证 → **仍 BLOCKED（`/tmp` 未被扩容）**

> 触发：用户「我重新扩容了」 ⇒ 执行 DATASET-SPACE-001 步骤 3（最小验证）→ 步骤 4（一次性 resume）
> 基线：HEAD `f8b6810` · `runner.ts#describeBuildError` **保留未回滚** ✓
> 🔴 **零持久化写入** · **未 resume 780004** · **未 purge** · **未建 780005** · **未改任何配置**

---

## 0. 结论

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│  状态 = **仍 BLOCKED —— 扩容生效于【数据卷】，但承载 `/tmp` 的【另一个文件系统】未被扩容** │
│                                                                                │
│  ✅ 数据卷：已恢复   （决定性证据：1000 行真实批次 INSERT **464 ms 成功**；扩容前 >17 min 挂起）│
│  ❌ `/tmp`：仍为 0  （决定性证据：**连一个空的 TEXT 临时表都建不出来** ⇒ 立即 1114）        │
│                                                                                │
│  依任务规则「如果仍然出现 1114 ⇒ 停止，不 resume 780004」⇒ **未 resume**         │
│  780004 = FAILED（未动）· checkpoint 完好 · batchSize 仍 1000 · 五表行数一行未变  │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 扩容后的实测对照（同一批探针，扩容前 vs 扩容后）

| 探针 | 扩容前 | **扩容后** | 判定 |
|---|---|---|---|
| 1000 行真实批次 `INSERT`（事务内） | ❌ **挂起 > 17 min** | ✅ **成功 464 ms** | 🟢 **数据卷已恢复** |
| 大表 `GROUP BY`（varchar/int 列） | ✅ | ✅ | 🟢 内存临时表正常 |
| 大表 `ORDER BY amount` | ✅ | ✅ | 🟢 内存临时表正常 |
| `SELECT 1` / 五表计数 | 部分 ECONNRESET | ✅ 全部正常 | 🟢 连接稳定 |
| 🔴 `PROCESSLIST + ORDER BY`（含 `TEXT` 列） | ❌ 1114 | ❌ **1114** | 🔴 **磁盘临时表仍不可用** |
| 🔴 **`CREATE TEMPORARY TABLE (…, payload TEXT)`** | — | ❌ **`1114 · The table 'probe_text' is full`** | 🔴 **`/tmp` 可用空间 = 0** |

---

## 2. 🔴 为什么「数据卷好了」但「`/tmp` 还是满的」

**证据链**：`CREATE TEMPORARY TABLE probe_text (id INT, payload TEXT)` —— **一个【空表】都建不出来**，直接 `errno=1114 · code=ER_RECORD_FILE_FULL · The table 'probe_text' is full`。

**机理**：MySQL 8 的内存临时表引擎 **`TempTable` 不能存 `TEXT`/`BLOB` 列** ⇒ 任何含 `TEXT`/`BLOB` 的临时表**必须强制落盘到 `@@tmpdir`（= `/tmp`）**，与表大小无关。
⇒ 空表都失败 = **`/tmp` 的可用字节数为 0**。

**同时**：1000 行真实 `post` 批次 INSERT 仅用 **464 ms** 成功 ⇒ 该路径依赖的是 **InnoDB 临时表空间 `ibtmp1`**（`12M:autoextend`）与数据卷，**与 `/tmp` 是两套东西**。

> ## ⇒ **扩容生效在「数据卷」，而 `/tmp` 位于【另一个未被扩容的文件系统】**（很可能独立挂载点或 tmpfs）。

**这也解释了「为什么只有那一条查询失败」**：
| 查询 | 临时表是否含 TEXT/BLOB | 落盘？ | 结果 |
|---|---|---|---|
| `GROUP BY relativeDay`（int） | 否 | ❌ 留内存 | ✅ 成功 |
| `ORDER BY amount`（double） | 否 | ❌ 留内存 | ✅ 成功 |
| 1000 行 INSERT（InnoDB 引擎） | — | 走 `ibtmp1` | ✅ 成功 |
| **`PROCESSLIST`（`INFO` 是 `longtext`）** | ✅ **是** | ✅ **必须落盘 `/tmp`** | 🔴 **1114** |
| **`CREATE TEMPORARY TABLE (… TEXT)`** | ✅ **是** | ✅ **必须落盘 `/tmp`** | 🔴 **1114** |

---

## 3. 上一条诊断结论需要**修正一处**

`RESULT-DATASET-DIAG-001` 曾写「**数据卷 7.31 GB + 6.89 GB / `DATA_FREE` 129 MB**」并把它与 `/tmp` 满并列叙述。**现在看应更精确地表述为**：

- 🔴 **直接根因 = `/tmp` 所在文件系统耗尽（与数据卷是否拥挤无关）** —— 空 TEXT 临时表即可复现。
- 数据卷此前**也**接近满（`DATA_FREE` 129 MB）且**已通过本次扩容解决**（INSERT 从挂起变 464 ms）。
- **两者是独立的两块空间**，必须分别处理。

---

## 4. 能否 resume？—— **依规则未执行**

任务明确规定：
> 「如果仍然出现 1114：→ **停止，不 resume 780004**，报告当前磁盘/临时空间状态。」

**实测：1114 仍【稳定复现】**（两条独立探针）⇒ **按规则停止，未 resume。**

**⚠️ 必须同时上报的相反证据（供你决策，我不擅自覆盖规则）**：
- 780004 **当初失败的那条语句就是 `insert into ds_first_limit_pullback_post`**；
- 而同类 1000 行批次 INSERT **现在 464 ms 成功**；
⇒ **构建路径本身可能已可用**，但**构建过程中任何需要磁盘临时表的步骤（含对 `TEXT` 列的排序/分组/`information_schema` 查询）仍会失败**，属于**未消除的确定性失败面**。

**⇒ 我的建议：先补齐 `/tmp` 扩容再一次成型，不要带病 resume。** 若你决定在 `/tmp` 未修的情况下强行 resume，请明确指示，我会照做并如实记录结果。

---

## 5. 需要你在主机 / 容器上执行（DBA）

| 优先级 | 动作 |
|---|---|
| 🔴 **P0** | **扩容或清理承载 `/tmp` 的那个文件系统**（**与数据卷不是同一个**）<br>定位命令：`df -h /tmp` · `df -h /var/lib/mysql`（对比两者是否同一挂载点） |
| 🔴 **P0** | 若 `/tmp` 是 **tmpfs**（内存盘）⇒ 扩容 tmpfs 或改挂到磁盘卷：`mount -o remount,size=8G /tmp` |
| 🔴 **P0** | 或：**把 MySQL `tmpdir` 指向已扩容的数据卷**（`my.cnf` → `tmpdir=/var/lib/mysql-tmp`，需重启；且该目录须可写） |
| 🟠 **P1** | 清理 `/tmp` 下遗留的 `#sql*` 临时文件（**仅限 `/tmp` 内 MySQL 临时文件，勿动业务数据**） |
| 🟠 **P1** | **建议余量**：`/tmp` ≥ **4 GB**（大查询/排序的磁盘临时表头寸） |
| ⚪ **P2** | 复核 `@@tmp_table_size`（当前 32 MB）与 `/tmp` 容量的匹配 |

**验证命令（扩容后请先跑这条，通过我再 resume）**：
```sql
CREATE TEMPORARY TABLE t (id INT, payload TEXT);   -- 必须成功
DROP TEMPORARY TABLE t;
SELECT ID FROM information_schema.PROCESSLIST ORDER BY TIME DESC LIMIT 5;  -- 必须成功
```

---

## 6. 本轮副作用（零持久化写入）

- ✅ **未 resume 780004** · **未 retry** · **未 purge** · **未创建 780005** · **未改 build config（`batchSize` 仍 1000）**
- ✅ **未修改** Dataset 定义 / 12 因子 / `orientation` / `T+5` / 回踩定义 / Schema / migration
- ✅ **未跑** P3 / 任何真实因子 Run · **未 markReady**（780004 保持 **FAILED**）
- ✅ **未改动任何 `.ts` 代码**；`runner.ts#describeBuildError` **保留未回滚** ✓
- ✅ **零持久化写入**：
  - 1000 行诊断 INSERT **在事务内 `ROLLBACK`**（残留检查 `datasetVersionId=999999999` = **0** ✓）
  - 空间探测**只用 `TEMPORARY` 表**（断连即消失，且已显式 `DROP`）
- ✅ 780004 五表行数**逐项未变**：`event 58,983` · `prefix 37,381` · `post 274,880` · `path 272,880` · `outcome 10,611`

---

## 7. 就绪状态：只差 `/tmp` 一项

```text
✅ DB 连通稳定
✅ 数据卷已扩容（1000 行批次 464 ms）
✅ 内存临时表路径正常
✅ 780004 断点完好：phase=windows · chunk 2461/60620 · cursor 2019-04-02
                    lastEventId 603712.SH@2019-04-02
✅ 五表断点数据一行未动（reuse 时不会被 purge）
❌ /tmp 仍为 0 ⇒ 唯一剩余阻断项
```

**`/tmp` 修好后即可直接执行一次性 resume + 14 项物理验收**（脚本与流程均已验证可用）。
