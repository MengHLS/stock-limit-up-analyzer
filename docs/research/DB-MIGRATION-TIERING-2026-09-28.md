# 数据库迁移分层清单（TiDB Cloud → 阿里云 ECS 自建 MySQL）

> 生成时间：2026-09-28 · 状态：**方案已定，正在执行**（Step 1 导出于 13:29 起跑；Step 2 已完成并实测验证）
> 触发约束：① 目标是 ECS 上**自建 MySQL**（非 RDS/PolarDB）② TiDB Cloud **费用即将耗尽** ③ 部分数据**可从数据源重建**
> 依据：`docs/architecture/DOMAIN-MAP.md:241-256`（STEP 12 数据地基 A–G 域表映射）+ `scripts/backfill*`（A–G 每域均有现成回填脚本）+ 阿里云/TiDB Cloud 官方文档

---

## 0. 先厘清一个前提：额度耗尽 ≠ 数据丢失

TiDB Cloud Serverless 的行为（官方 FAQ / Pricing 页口径）：

| 情形 | 实际行为 |
|---|---|
| 免费额度（5 GiB 行存 / RU）耗尽 | **立即拒绝新的连接** |
| 耗尽前已建立的连接 | **保持可用，但被限流**（严重限流，非断开） |
| 数据 | **不会被删除**；额度在**下月初重置**，或升级为 scalable cluster 立即恢复 |
| 超过 spending limit | 同上 |

**推论**：这不是"抢救数据"，而是"**趁还能连的时候，把不可再生的先导出来**"。限流状态下仍能跑查询，只是慢——所以动作要按「**先小后大**」排，而不是按表的重要性排。

---

## 1. 分层总览（表数与体积均为 2026-09-28 实测值）

| 层 | 含义 | 表数 | 实测体积 | 处理 |
|---|---|---:|---:|---|
| **T1** | 不可再生（研究/策略/实验/回测产出） | **39** | **430 KB** | 🔴 立即导 |
| **待定 4 张** | 依赖停牌/ST 历史状态，重建能力未证实 | **4** | **18.8 MB** | 🔴 与 T1 同批导 |
| **LEGACY** | `archive_*` 已退役体系（`9cg`） | **12** | 685 KB | 与 T1 同批导 |
| **T2** | A–G 数据地基，有 backfill 脚本可重建 | **9** | 2.3 GB | 到新库回填 |
| **T3** | `ds_*` 数据集物化表 | **5** | **3.4 GB** | 需**显式决策** |
| | | **69** | 5.7 GB | |

> 执行上把「T1 + 待定 4 张 + LEGACY」合并为一个导出层 **`s1_core`（55 张 / ~20 MB）**：这三层在"能否重建"上结论一致（都不能重建），分开跑没有收益。
>
> 🔴 **量级修正**：原方案把 T1 估为「52 张 / 几十 MB」、把 T3 估为 7 张小表。实测**方向对但量级差两个数量级**——真·不可再生内容仅 **430 KB**，而 `ds_*` 物化表独占 **3.4 GB / 58.7%**。

### T1 —— 不可再生，必导（39 张）

| 域 | 表 |
|---|---|
| 策略（8） | `strategies` `strategy_versions` `strategy_parameters` `strategy_entry_rules` `strategy_exit_rules` `strategy_execution_rules` `strategy_research_provenance` `strategy_version_datasets` |
| 研究（15） | `research_experiment` `research_hypothesis` `research_run` `research_analysis` `research_analysis_condition` `research_analysis_metric` `research_analysis_template` `research_analysis_template_item` `research_result` `research_conclusion` `research_strategy_candidate` `research_artifact` `research_finding` `research_question` `research_plan` |
| 数据集元数据（6） | `dataset_definition` `dataset_version` `dataset_build_job` `dataset_build_config` `dataset_build_config_board` `dataset_build_config_event` |
| 参数搜索 / 稳健性（6） | `parameter_search_run` `parameter_search_combination` `parameter_search_result` `search_robustness_run` `search_robustness_result` `search_robustness_parameter_analysis` |
| 回测 / 评估 / OOS / WF（6） | `backtest_runs` `closed_loop_backtest_run` `oos_validation_run` `oos_validation_result` `walk_forward_run` `walk_forward_fold` |
| 生产 / 账户（6） | `paper_trading_runs` `sentiment_alerts` `operation_logs` `uploaded_images` `users` `stock_watchlist` |
| 回填进度（1） | `backfill_checkpoints`（丢了要重新全量回填，务必保留） |
| **⚠️ 待验证可重建性，暂按必导（4）** | `research_security_status_history` `stock_suspension_windows` `limit_up_records` `research_security_identifier_history` |

> **为什么后面 4 张暂按 T1 处理**：它们虽然属于 B/C 域（数据地基），但依赖**停牌与 ST 的历史状态**，而项目既有记录明确写着 **Tushare 无 `suspend_d` 接口**；`limit_up_records` 的**历史回溯能力**同样未经验证。**在证实「确实能重建」之前，一律先导**——宁可多导 10 MB，不要事后发现补不回来。

### T2 —— 可重建（9 张）

| 域 | 表 | 回填脚本 |
|---|---|---|
| A OHLCV | `stock_daily_prices` | `scripts/backfillDaily.ts` |
| B SecMaster | `research_securities` | `scripts/backfillSecurityMaster*.ts` |
| D CorpActions | `corporate_actions` `adjustment_factors` | `scripts/backfillCorporateActions*.ts` |
| E Liquidity | `liquidity_daily` | `scripts/backfillStatusLiquidity.ts` |
| F Index | `index_master` `index_daily` | `scripts/backfillIndex.ts` |
| G Industry | `industry_assignments` | `scripts/backfillIndustry.ts` |
| 其他 | `market_data` | （随 A 域一并处理） |

> 🔴 **`index_daily` 是交易日历的唯一来源**，且该表停更时会**静默 no-op 却报成功** ⇒ 补数必须带 `--force`。

### T3 —— 需要你拍板（5 张，实测 3.4 GB）

| 表 | 实测体积 | 行数 | 情况 | 建议 |
|---|---:|---:|---|---|
| `ds_first_limit_pullback_post` | 1.4 GB | 4,514,637 | 数据集物化表，从行情派生 | 见下方「致命细节 ①」 |
| `ds_first_limit_pullback_path` | 951 MB | 4,462,297 | 同上 | 同上 |
| `ds_first_limit_pullback_prefix` | 861 MB | 4,210,157 | 同上 | 同上 |
| `ds_first_limit_pullback_outcome` | 105 MB | 741,154 | 同上 | 同上 |
| `ds_first_limit_pullback_event` | 76 MB | 333,727 | 同上 | 同上 |

> 原方案写「3 张」，实测是 **5 张**（`_post` / `_prefix` 此前未列出），这 5 张合计 **3.4 GB = 全库 58.7%**。
> LEGACY 的 12 张 `archive_*`（合计仅 685 KB）实测后归入 `s1_core` 一并导出——体积可忽略，留档比丢弃划算。
---

## 2. 🔴 四个致命细节

### ① `ds_*` 物化表与 `dataset_version` 必须**同迁或同不迁**

`dataset_version` 是研究链路的坐标。历史 Run / Experiment 通过 `datasetVersionId`（软引用，**无 FK**）指向它。

- **只迁元数据、不迁 `ds_*`** ⇒ 历史记录的引用在账面上还在，但**指向的物化数据不存在** ⇒ 这些 Run **不再可复现**。
- **半迁**（迁一部分 `ds_*`）⇒ 更难排查的**悬空引用**。

⇒ 决策只有两个，且必须**显式登记**在迁移记录里：

| 选项 | 代价 | 结果 |
|---|---|---|
| A. 元数据 + `ds_*` 全迁 | 导出最大、耗时最长（额度紧张时风险高） | 历史 Run 保持可复现 |
| B. 只迁元数据，`ds_*` 到新库重建 | 省时间 | 历史 Run **标记为「只读存档，不可复现」**（数据集版本指纹会变） |

**无论选哪个，都不允许"默认没事"**——必须有明确记录。

### ② 排序规则 / 大小写敏感差异（自建 MySQL 必踩）

项目 69 张表的迁移文件里 **`COLLATE` 出现 0 次**（实查），只有 `CHARSET=utf8mb4`：

- TiDB 侧 utf8mb4 默认 = `utf8mb4_bin`（**大小写敏感**）
- MySQL 8.0 默认 = `utf8mb4_0900_ai_ci`（**大小写不敏感**）

⇒ 「股票代码 / 状态字符串的等值匹配与排序」在切库后行为会变。同时 **MySQL 8.0 的 `lower_case_table_names` 只能在 `--initialize` 之前设定**，装完再改实例会起不来。

### ③ 🔴 TiDB Cloud Serverless 上 **禁用 `mysqldump --single-transaction`**（会静默截断）

这是本次实跑撞到的**最危险的一个坑**：失败表现是**产物被截断**，而不是明显报错退出。

实测（同一张表 `users`，仅差参数）：

| 参数组合 | 退出码 | 产物大小 | 含 `-- Dump completed` 尾标 |
|---|---:|---:|---|
| `--skip-lock-tables`（**无** `--single-transaction`） | **0** | 1094 B | ✅ |
| `--single-transaction` | 2 | 1008 B | ❌ |
| `--single-transaction --quick` | 2 | 1008 B | ❌ |
| `--single-transaction --no-tablespaces` | 2 | 1008 B | ❌ |

报错：`mysqldump: Couldn't execute 'ROLLBACK TO SAVEPOINT sp': SAVEPOINT sp does not exist (1305)`

⇒ TiDB 不支持 mysqldump 在 `--single-transaction` 下依赖的 SAVEPOINT 语义。mysqldump 在每张表收尾时执行 `ROLLBACK TO SAVEPOINT sp` 失败，**数据已写出但尾标未写**。

**两条硬性要求**：

1. 导出脚本必须**同时**校验「进程退出码 == 0」**和**「解压产物含 `Dump completed`」。只查文件大小、或只查退出码，都会漏掉截断。
2. 去掉 `--single-transaction` 后**没有跨表一致性快照** ⇒ 导出前必须确认源端无写入（无 `RUNNING` 在途 Run），导出后必须**逐表比对行数**。

> 若后续要搬多 GB 的 T2/T3 层且对一致性要求高，正确工具是 TiDB 官方 **Dumpling**（专为 TiDB 设计、天然产出一致性快照），而不是继续给 mysqldump 堆参数。

### ④ 🔴 `drizzle/` 与线上库已脱节 —— **不能**用 `drizzle-kit migrate` 重建空库

实查三组数字对不上：

| 来源 | 数量 | 最后一个 |
|---|---:|---|
| `drizzle/*.sql` 文件 | **53** | `0051_first_limit_source_facts.sql` |
| `drizzle/meta/_journal.json` 条目 | **24** | `0023_security_identity_unification` |
| 线上库 `__drizzle_migrations` 行数 | **24** | 同上（idx = 23） |

⇒ 项目从 `0013` 起就**改成手写迁移 + 自建执行器**（`scripts/apply*.mjs`、`scripts/applySqlMigration.mjs`），**drizzle 台账在 `0023` 之后就没再更新**。

**后果**：在空库上跑 `drizzle-kit migrate` **只会建出 `0000~0023` 的表**；`0024~0051` 对应的对象（`archive_*`、`ds_*`、`strategy_research_provenance`、`strategy_versions` 等）**都不会被创建**——而命令**正常返回成功**。

**因此本方案的做法**：新库结构**取自线上库的 `--no-data` 全量 schema 转储**（`/opt/dbdump/schema/00_full_schema.sql.gz`），不是重放 `drizzle/`。

⚠️ `scripts/applySqlMigration.mjs` 还有两处与本次迁移冲突的硬编码：① 固定读项目根 `.env`；② 连接强制 `ssl: { rejectUnauthorized: true }`。对着自建 MySQL（自签证书）会握手失败——这也是不走它建表的原因之一。

> 另记一笔：`0044` 号被两个文件共用（`0044_exit_policy_json.sql` / `0044_walk_forward.sql`）。两者都不在 journal 内、由 `apply*.mjs` 单独执行，当前不影响运行；但编号复用会让取号台账失真，建议后续登记。



---

## 3. 已执行：源侧导出（在 ECS 上直连 TiDB）

### 3.1 为什么改为「在 ECS 上导出」而不是本机

| 方案 | 结论 |
|---|---|
| 本机 `mysqldump` | ❌ 本机**没有** `mysqldump` / `mysql` 客户端（实查）；补装客户端违反项目「禁新依赖」纪律 |
| 本机导出 → 上传 ECS | ❌ 5.7 GB 要**跨境下行 + 再上行**两遍 |
| **ECS 直连 TiDB 导出** | ✅ 实测 ECS → `gateway03.us-east-1.prod.aws.tidbcloud.com:4000` **TCP 可达且认证通过**（4.1 s，含容器启动）；产物**直接落在导入侧磁盘**，零搬运 |

### 3.2 前置（已完成）

```bash
# 源库清点基线（只读，只查 information_schema）——跑前确认没有 RUNNING 在途 Run
cd C:/work/sourcecode/stock-limit-up-analyzer
npx tsx docs/evidence/_db_migration_inventory.mts
# 产出 docs/evidence/_db_migration_inventory.{md,json}：69 表 / 3240 万行 / 5.7 GB / 0 张无主键表
```

### 3.3 服务器侧落地物

| 路径 | 内容 |
|---|---|
| `/opt/dbdump/.tidb_env` | 源库连接参数（`chmod 600`，不进命令行历史） |
| `/opt/dbdump/tables.{s1_core,s2_market,s3_ds}.txt` | 三份表清单，**按体积升序**；55 + 9 + 5 = 69（已校验合计） |
| `/opt/dbdump/export.sh` | 分片导出器，可断点续跑 |

```bash
# 在 ECS 上执行（每个 tier 幂等：已存在的分片自动 SKIP）
cd /opt/dbdump
./export.sh schema      # ① 全库 schema（--no-data --routines --triggers）
./export.sh s1_core     # ② 55 张不可再生表（~20 MB，几分钟内完成）
./export.sh s2_market   # ③ 9 张行情表（2.3 GB，按需）
./export.sh s3_ds       # ④ 5 张 ds_* 物化表（3.4 GB，取决于决策）
```

### 3.4 必须保留的参数取值

| 参数 | 为什么 |
|---|---|
| `--column-statistics=0` | MySQL 8.0 客户端默认会查 `column_statistics` 表，**TiDB 没有这张表** |
| `--set-gtid-purged=OFF` | TiDB **没有 GTID**，不加会去查 `gtid_executed` 报错 |
| **不加** `--single-transaction` | 🔴 见第 2 节 ③：会导致**静默截断** |
| `--skip-lock-tables` | 覆盖 `--opt` 默认带来的 `LOCK TABLES` |

**逐表可见性**是刻意的：中途断了，前面已完成的分片仍可用；重跑自动 `SKIP`。
---

## 4. 修正后的执行顺序（6 步）

| 步 | 动作 | 状态 |
|---|---|---|
| **1** | 源库只读清点（拿基线与体积分布） | ✅ 已完成 |
| **2** | ECS 装 MySQL 8.0.43（容器） | ✅ 已完成并实测验证参数 |
| **3** | ECS 直连 TiDB 分片导出（`s1_core` 优先） | 🔄 进行中 |
| **4** | 新库建结构（**线上库 schema 转储**，非 `drizzle/` 重放 —— 见 2-④） | ⏳ |
| **5** | 导入 `s1_core` + 逐表行数比对 | ⏳ |
| **6** | 切流：改 `.env` 的 `DATABASE_URL` → 热重启 server → 杀在途 Run；旧库保留只读 1~2 周 | ⏳ |
| **7** | 回填 T2 行情地基 + 重建 `ds_*`（如选方案 B） | ⏳ |

> 🔴 第 6 步是**唯一会改动生产行为**的步骤：改 `.env` 属于「改 `server/**` 环境」⇒ 必须先杀掉在途 Run，且**用户正在使用页面时禁止执行**。

---

## 4.5 Step 2 已部署配置（实测生效）

部署位置 `/opt/mysql/docker-compose.yml`，与现有 MinIO 栈（`/opt/minio/`）**分属两个 compose 项目**，互不干扰。

实测环境：**阿里云 ECS · Alibaba Cloud Linux 4 · 2 vCPU · 1.6 GB 内存 · 40 GB 盘（可用 18 GB）**
⇒ 该规格**显著低于**自建 MySQL 的常规建议，因此做了一处必要加固：**新增 2 GB swap**（`/swapfile`，已写入 `/etc/fstab`，`vm.swappiness=10`、`vm.overcommit_memory=1`）。

```yaml
services:
  mysql:
    image: mysql:8.0.43          # 🔴 必须钉版本：镜像源的 mysql:8.0 裸标签解析到 8.0.27，无 innodb_redo_log_capacity
    container_name: mysql
    restart: unless-stopped
    command:
      # ===== 源侧 TiDB 口径对齐 =====
      - --lower-case-table-names=1
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_bin
      - --sql-mode=ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
      # ===== 1.6 GB 低内存实例适配 =====
      - --innodb-buffer-pool-size=256M
      - --innodb-buffer-pool-instances=1
      - --innodb-log-buffer-size=16M
      - --innodb-redo-log-capacity=134217728
      - --performance-schema=OFF
      - --innodb-flush-method=O_DIRECT
      - --table-open-cache=400
      - --tmp-table-size=32M
      - --max-heap-table-size=32M
      # ===== 通用 =====
      - --max-allowed-packet=256M
      - --max-connections=120
      - --default-time-zone=+08:00
      - --skip-name-resolve
      - --skip-log-bin
    environment:
      MYSQL_ROOT_PASSWORD: <见 /opt/mysql/docker-compose.yml，28 位纯字母数字>
      TZ: Asia/Shanghai
    ports:
      - "127.0.0.1:3306:3306"    # 🔴 只绑回环：公网不暴露 3306，外部访问一律走 SSH 隧道
    volumes:
      - /opt/mysql/data:/var/lib/mysql
      - /opt/mysql/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p<同上>"]
      interval: 15s
      timeout: 5s
      retries: 20
      start_period: 90s
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "3" }
```

### 实测验证结果（不是「按文档配好了」，是容器里查出来的）

| 参数 | 目标值 | 实测 | |
|---|---|---|---|
| `collation_server` | `utf8mb4_bin` | `utf8mb4_bin` | ✅ |
| `character_set_server` | `utf8mb4` | `utf8mb4` | ✅ |
| `lower_case_table_names` | `1` | `1` | ✅ |
| `max_allowed_packet` | 256 MB | `268435456` | ✅ |
| `innodb_buffer_pool_size` | 256 MB | `268435456` | ✅ |
| `innodb_redo_log_capacity` | 128 MB | `134217728` | ✅ |
| `time_zone` | `+08:00` | `+08:00` | ✅ |
| `sql_mode` | 不含 `NO_AUTO_CREATE_USER` | 8.0 默认集 | ✅ |
| 目标库 | `utf8mb4` / `utf8mb4_bin` | `vwwjfde663dhej4tohvzpq` / `utf8mb4` / `utf8mb4_bin` | ✅ |
| 容器内存占用 | — | **184 MiB**（占实例 11%） | ✅ 实测远低于预估 |

**三个取值理由（都有实测依据，不是猜）**

| 参数 | 取值 | 依据 |
|---|---|---|
| `--collation-server` | **`utf8mb4_bin`** | 源侧 TiDB 实测 `utf8mb4_bin`。迁移文件里 `COLLATE` 出现 **0 次**（实查）⇒ 沿用才能保证字符串比较行为不变 |
| `--lower-case-table-names` | **`1`** | 源侧 TiDB 固定为 `2`（原样存储 + 不敏感）；Linux 上 MySQL 不支持 2，只能 0 或 1。选 `1` 保住「**不敏感**」这一关键属性。容器化的好处：装错删数据目录重来即可，**不必重装 ECS** |
| `--sql-mode` | 8.0 默认集（**不含** `NO_AUTO_CREATE_USER`） | 源侧 TiDB 的 `sql_mode` **实际含** `NO_AUTO_CREATE_USER`（实测确认），该选项在 MySQL 8.0 **已被移除**，照抄会直接起不来 |

### 本机访问方式：SSH 隧道（不暴露公网）

```bash
# 开发机 → ECS MySQL，本地 13306 映射到 ECS 回环 3306
plink -ssh -batch -P 22 -l root -pw '<ECS 密码>' -hostkey '<指纹>'       -L 13306:127.0.0.1:3306 -N 47.94.112.21
# 之后本机连 127.0.0.1:13306 即可
```

> 这样 3306 **不需要**开安全组、也不需要改 `.env` 里的公网地址，切流前可以并行验证新库。
---

## 5. 已确认事项与剩余待决

### 已确认（本次实查/实测得出，不再是未知数）

| 原待确认项 | 结论 |
|---|---|
| ECS 规格 / OS | 阿里云 ECS · Alibaba Cloud Linux 4 · 2 vCPU · **1.6 GB** · 40 GB 盘（可用 18 GB） |
| 内存够不够 | MySQL 容器实测 **184 MiB**；已加 2 GB swap 兜底 |
| ECS → TiDB 连通性 | ✅ TCP 可达 + 认证通过 |
| 本机 `mysqldump` | ❌ 没有 ⇒ 改为 ECS 侧导出 |
| 目标实例形态 | ECS 上 docker-compose 自建 MySQL 8.0.43 |
| MySQL 版本坑 | 镜像源 `mysql:8.0` 裸标签 = **8.0.27**（无 `innodb_redo_log_capacity`）⇒ 必须钉 `8.0.43` |

### 剩余待决（只影响第 4/7 步，不阻塞第 3/5 步）

1. **`ds_*` 决策（3.4 GB）**：方案 A 全迁（导出耗时最长）还是方案 B 重建 + 把历史 Run 标注为「只读存档、不可复现」？
   - 注：`ds_*` 是**从行情派生的物化表**，其上游 `dataset_build_config` 等元数据已随 `s1_core` 导出（数千字节）⇒ 只要行情数据回填完成，理论上可重建。
2. **T2 回填排期**：BaoStock 单会话 + Tushare 积分受限这两个瓶颈决定回填要几天还是几周。
3. **「backfill 相关库」是否与本项目同实例** —— 若不同，需对那个实例单独清点（探针换个 `DATABASE_URL` 可复用）。
4. **切流窗口**：第 6 步要求「无在途 Run + 用户不在用页面」，需要一个明确时间点。
## 6. 执行结果快照（2026-09-28）

### 已完成并验证

| 步骤 | 结果 | 证据来源 |
|---|---|---|
| ECS 加 swap | 2 GB `/swapfile`，已入 `/etc/fstab` | `swapon --show` |
| MySQL 8.0.43 容器 | `healthy`，实测内存 **184 MiB** | `docker ps` / `docker stats` |
| 关键参数 | 8 项**全部生效**（见 4.5 验证表） | 容器内 `SELECT @@...` |
| 源库清点 | 69 表 / 3240 万行 / 5.7 GB / **0 张无主键表** | `_db_migration_inventory.json` |
| schema 转储 | **69** 个 `CREATE TABLE` + 完成尾标 + 无 gzip 警告 | `/opt/dbdump/schema/` |
| **新库建表** | **0 → 69 张，全部 `utf8mb4_bin`，288 个索引** | 目标库 `information_schema` |
| `s1_core` 导出 | **55 分片 / 23 MB**，零空文件、零缺尾标、清单完全对应 | `/opt/dbdump/s1_core/` |
| `s1_core` 导入 | **55/55 成功** | `import.sh` 输出 |
| **逐表精确行数比对** | **55/55 一致**（首轮 54/55，补导后复比 55/55） | `verify.sh` 输出 |

### 🔴 执行中发现：源库在迁移窗口内**仍被写入**

`verify.sh` 首轮报 `closed_loop_backtest_run` 源 **106** / 目标 **103**。查证结果：

| 指标 | 源库 | 目标库 |
|---|---:|---:|
| 行数 | 106 | 103 |
| `MAX(createdAt)` | **2026-09-28 13:54:05**（+08:00） | 2026-09-28 13:38:10 |

源库该表在 13:19 / 13:30 / 13:38 / 13:43 / 13:48 / 13:54 各有新增（`status = ALL_EXECUTED`），**约每 5 分钟一批**；而 `s1_core` 导出在 **13:44** 前即已完成。

⇒ **这不是导入丢行，而是去掉 `--single-transaction` 后失去跨表一致性快照的直接后果**（第 2 节 ③ 已预警，此处补上了实测证据）。
⇒ 当时本机**没有任何 node 进程在运行** ⇒ 写入源库的是**外部进程/服务**，需使用者确认来源。

**补救与结论**：
1. 已删除该表分片 → 重导（其余 54 张自动 SKIP）→ 全层重导入 → 复比对 **55/55 一致**。
2. ⇒ **切流之前必须再跑一次完整的「重导 → 重导入 → 复比对」收尾闭环**，且必须安排在一个**确认无写入的窗口**内执行。这是本方案里唯一不可省略的收尾动作。

### 本机访问新库的已知限制

ECS 上 MySQL 只绑回环（`127.0.0.1:3306`）⇒ 本机需经 SSH 隧道访问。实测结论：

- plink 端口转发在本机当前执行环境下报 `Local port ... forwarding to 127.0.0.1:3306 failed: Network error: Permission denied`
- 直接测试监听能力：`net.listen(14001, '127.0.0.1')` ⇒ **`EACCES`**
- ⇒ **当前执行环境禁止本地监听端口**。隧道只能在放开该限制的前提下建立；否则需改为「**在 ECS 侧运行写入端**」（在服务器上装 Node 并跑回填脚本，写入走回环，完全不需要隧道）。

### 尚未执行（等决策）

| 项 | 依赖 |
|---|---|
| `s2_market`（2.3 GB）/ `s3_ds`（3.4 GB）导出 | 「到新库回填」还是「一并导出」的决策 |
| T2 行情地基回填 | 可写入新库的通路（隧道 **或** ECS 侧运行） |
| 切流（第 4 节第 6 步） | 无在途 Run + 无外部写入的时间窗 |

---

## 7. T2「数据地基」落地（2026-09-28 晚 · 已完成并验收）

> 本节取代第 6 节「尚未执行」表中的前两项（`s2_market` 导出、T2 回填）。T3 仍按既定决策暂缓。

### 7.1 决策记录与依据

| 项 | 决策 | 理由 |
|---|---|---|
| T2 行情域 9 张表 | **源库分片直搬 · 全量** | A 域 `stock_daily_prices` **无 BaoStock 重建路径** ⇒ 「从数据源重建地基」在体积最大的一块上不成立 |
| T3 `ds_*` 5 张 | **暂不处理** | 可从策略层重跑再生成，且占全库 58.7% 体积 |

推翻「可重建」前提的关键证据（全量 grep 「谁会写 `stock_daily_prices`」的结论）：

| 表 | 行数 | 体积 | 可重建？ | 依据 |
|---|---:|---:|---|---|
| `stock_daily_prices` | 8,897,559 | 1103.7 MB | ❌ **无 BaoStock 路径** | 仅 `backfillDaily.ts` / `backfill_high_volume.ts`，**均 Tushare**（1650 交易日 × 6 s ≈ 2.75 h 起，且受积分限流） |
| `liquidity_daily` | 9,015,158 | 1286.6 MB | ⚠️ 可但慢（估 6~15 h） | `backfillStatusLiquidity.ts` 持久会话逐只 5552 股 |
| 其余 7 张 | ~55,000 | ~11 MB | ✅ 快 | BaoStock / Tushare 均可 |

### 7.2 导出（ECS → TiDB，分片）

| 指标 | 实测 |
|---|---|
| 分片数 | **50** = `stock_daily_prices` 8 片（按年）+ `liquidity_daily` 35 片（按年）+ 7 张整表 |
| gzip 产物 | **479 MB** |
| 首片完成 → 末片完成 | 15:22:40 → 15:37:35 |
| **实际总耗时** | **14 分 55 秒** |
| **实际均值** | **548 KB/s** |
| 完整性校验 | 50/50 通过（退出码 + 非空 + 解压后 `Dump completed` 尾标），**坏片 0** |

分片方案的硬要求（已写入 `export.sh` v2）：分片必须走 `--no-create-info --skip-add-drop-table` —— 否则 `mysqldump` 默认的 `--add-drop-table` 会让**第 2 片把第 1 片的数据整片 DROP 掉**。

### 7.3 导入（ECS 本地容器）

| 指标 | 实测 |
|---|---|
| 分片导入 | **50/50 成功 / 0 失败** |
| 耗时 | **785 秒**（13 分 05 秒） |
| fsync 优化 | 导入期临时 `innodb_flush_log_at_trx_commit: 1 → 2`，脚本结束**自动恢复为 1**（已复查 = 1） |
| 统计信息 | 69/69 表 `ANALYZE` 通过；大表 `table_rows` 从估算 **0** 修正为真实量级 |

### 7.4 验收（核心判据：逐表精确 `COUNT(*)` 比对）

| 表 | 源库 | 目标库 | 判定 |
|---|---:|---:|---|
| `liquidity_daily` | 9,015,158 | 9,015,158 | ✅ |
| `stock_daily_prices` | 8,897,559 | 8,897,559 | ✅ |
| `corporate_actions` | 31,641 | 31,641 | ✅ |
| `adjustment_factors` | 31,337 | 31,337 | ✅ |
| `index_daily` | 7,508 | 7,508 | ✅ |
| `research_securities` | 5,552 | 5,552 | ✅ |
| `industry_assignments` | 5,212 | 5,212 | ✅ |
| `market_data` | 223 | 223 | ✅ |
| `index_master` | 9 | 9 | ✅ |
| **合计** | **17,994,199** | **17,994,199** | **9/9 一致** |

- **独立复跑第二次 ⇒ 结果完全一致**（可复现）。
- 落盘证据：`/opt/dbdump/logs/verify_s2_market_20260928.txt`；已抓回本地 `docs/evidence/_t2_market_verify_raw.txt`。

### 7.5 目标库最终形态

| 项 | 值 |
|---|---|
| 表数 | 69 |
| 总体积 | **3926.2 MB（≈3.83 GB）**，其中 T2 九表 **3782.7 MB** |
| 估算行数 | 17,662,686（`table_rows` 是 InnoDB **估算值**，与精确 17,994,199 有正常偏差） |
| 索引条目 | 372 |
| 空表 | **6** 张 = T3 `ds_first_limit_pullback_*` 5 张（源库有货、本次未迁）+ `search_robustness_run`（源库本就空） |
| ECS 磁盘 | 26 G 已用 / **12 G 可用** |

### 7.6 写入通路（本机 → 新库）已打通

本机执行环境**禁止创建任何监听套接字**（Bash 侧 `EACCES`、PowerShell 侧 `WSAEACCES`，回环与 `0.0.0.0` 均失败）⇒ **SSH 隧道方案彻底不可用**。改走「安全组 + 非标端口 + 受限账号」：

| 关卡 | 处置 |
|---|---|
| 阿里云安全组 | 入方向 TCP **13306**，源 **`111.14.148.127/32`** |
| 容器端口映射 | `0.0.0.0:13306:3306`（回环 3306 保留） |
| 数据库账号 | `app@111.14.148.127`，`caching_sha2_password`，**`REQUIRE SSL`** |
| 传输加密 | 自签证书 ⇒ 连接串须 `ssl={"rejectUnauthorized":false}`；实测 `Ssl_cipher=TLS_AES_256_GCM_SHA384` |

三项判据全部通过：正向连通 / TLS **实际生效**（非明文降级）/ `root` 对外**拒绝**。

### 7.7 🔴 顺带修掉的缺陷：`root@'%'` 曾可从公网登录

探针的**负向判据**抓到：MySQL 官方镜像默认创建 `root@'%'`，`ssl_type` 为空（**不强制 TLS**）⇒ 此前唯一防线只有安全组，同一 NAT 后任何设备持 root 密码即可登入。

已 `DROP USER 'root'@'%'`。**连带坑**：compose healthcheck 走 `mysqladmin -h 127.0.0.1 -uroot`，而服务端启用 `--skip-name-resolve` ⇒ `127.0.0.1` **不会**解析成 `localhost`，`root@localhost` 匹配不上 ⇒ 必须显式补 `root@'127.0.0.1'`，否则健康检查**静默失去凭据**。补齐后仍 `healthy`。

```
收敛前: root@%  · root@localhost
收敛后: root@localhost · root@127.0.0.1（仅回环）· app@111.14.148.127（REQUIRE SSL）
```

### 7.8 更正登记（本轮推翻/修正的既有判断）

| # | 原判断 | 实测更正 | 错在哪 |
|---|---|---|---|
| 1 | 导出速率 204 KB/s → 82 KB/s → 182 KB/s | **实测均值 548 KB/s**（479 MB / 895 s） | **瞬时采样冒充全称速率**：采样窗口恰逢慢速段。同一坑第三次踩 ⇒ 结论性数字必须用「总量 ÷ 全程耗时」，或取 mtime 首末差 |
| 2 | `liquidity_daily` 78% 是 pre-2019（约 1.0 GB） | pre-2019 仅 **9.29%（837,290 行 / 约 120 MB）** | **用年份跨度冒充数据量**：1992 年全市场只有几十只股票 ⇒ 年份跨度 ≠ 行数占比 |
| 3 | 源库被**外部进程**持续写入 | 是本机 `scripts/run3FTopNEntryStudy.mts` 研究作业（每完成一个 arm 写一条 `closed_loop_backtest_run`） | 首次排查用 `Get-Process node` 过滤未命中；改用 `Get-CimInstance Win32_Process` + `Get-NetTCPConnection` 反查**连接持有者**才定位 |
| 4 | 隧道不可用 ⇒「写入通路待定」 | 隧道确实不可用，但**根本不需要隧道**：安全组 + 非标端口直连即通 | 结论（隧道不通）正确，但**把「手段」当成了「前提」**，多绕一轮 |

### 7.9 遗留（不阻塞 T2）

| 项 | 说明 |
|---|---|
| T3 `ds_*` 5 张 | 源库约 3.4 GB；本次未迁，目标库中为**空表**。需要时可用同一分片方式补迁 |
| `.env` 尚未切换 | 本机 dev server 与两组研究作业仍在读旧库；改 `.env` 会让页面指向几乎为空的新库 ⇒ **必须与切流同日进行** |
| 切流窗口 | 仍需「无在途 Run + 用户不在用页面」的时间点 |
| 收尾闭环 | 切流前仍需一次「重导 → 重导入 → 复比对」，且落在确认无写入的窗口内 |
| `backfillLimitUpRecords` | 仅覆盖主板，跳过创业板 300/301 与科创板 688/689 ⇒ 若用它回填须知此限制 |
