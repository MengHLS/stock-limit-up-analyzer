# 数据库设计文档（Database Design）—— 现状结构

> **文档定位**：本文档只描述数据库的**现状结构**（实查事实），**不含**改造方案。目标设计与迁移方案见《数据库重构方案》（`docs/DATABASE_REDESIGN.md`）。
> **生成时间**：2026-09-10 18:40（GMT+8）｜**拆分复核**：2026-09-10 19:30（GMT+8）｜**实查更新**：2026-09-10 20:30（GMT+8，L4 五表分层落地后）
> **数据源**：TiDB Cloud（`gateway03.us-east-1.prod.aws.tidbcloud.com:4000`），schema `VWwjFDE663Dhej4TohVzPQ`
> **生成方式**：**直连 `information_schema` 实查**（只读探针 `scripts/_schema_probe.mts`），非手工维护、非历史文档转录
> **实测规模**：**41 张表 / 435 个字段 / 205 个索引项**（L4 五表分层前为 39 / 422 / 185）
> **口径声明**：全部内容为**实查事实**；正文中标注 ⚠️ 的为**实测缺陷**（汇总清单与处置方案见《重构方案》§4）。

---

## 1. 分层总览

数据库按职责分七层，依赖方向自上而下单向，**下层不得反向依赖上层**。

| 层 | 表数 | 表名 | 职责 |
|---|---|---|---|
| **L1 外部数据域**（A~G 七域） | 10 | `stock_daily_prices` `index_daily` `index_master` `liquidity_daily` `research_securities` `research_security_identifier_history` `research_security_status_history` `corporate_actions` `adjustment_factors` `industry_assignments` | 从 Tushare / BaoStock 落地的**原始事实**，是全部研究的地基 |
| **L2 回填与运维** | 5 | `backfill_checkpoints` `market_data` `limit_up_records` `sentiment_alerts` `stock_suspension_windows` | 回填断点、手工录入的市场/涨停数据 |
| **L3 数据集注册** | 6 | `dataset_definition` `dataset_version` `dataset_build_job` `dataset_build_config` `dataset_build_config_event` `dataset_build_config_board` | Dataset Registry 三实体 + 构建筛选配置三表 |
| **L4 数据集物理表** | 5 | `ds_first_limit_pullback_event` `ds_first_limit_pullback_prefix` `ds_first_limit_pullback_post` `ds_first_limit_pullback_path` `ds_first_limit_pullback_outcome` | 事件型数据集的物化表（`ds_{dataset_code}_{role}`），按「时间方向 × 数据层级」三层血缘分层 |
| **L5 研究链路** | 8 | `strategies` `strategy_versions` `research_datasets` `rd_rows_*` `research_experiment_batches` `research_experiments` `research_runs` `backtest_runs` `paper_trading_runs` | 策略 → 数据集 → 实验 → 运行 → 结果 |
| **L6 应用层** | 4 | `users` `stock_watchlist` `uploaded_images` `operation_logs` | 面向用户的功能表 |
| **L7 框架** | 1 | `__drizzle_migrations` | Drizzle 迁移版本记录 |

> `rd_rows_05809b1a6d97aa02` / `rd_rows_5dce9db1421bec38` 是**按内容指纹动态生成**的行存储表（各 dataset 版本一份），表名不固定，属 `research_datasets` 的附属。
> **L4 的物理表数量**：每数据集 **5 张**（`event` / `prefix` / `post` / `path` / `outcome`）—— 2026-09-10 20:15 由 3 张就地迁移落地（`scripts/applyDatasetWindowLayering.mts`），详见 §2.4 与《重构方案》§2.1/§3.5。
> `L4 表数 3 → 5` 与 `L3 表数 6`（含 `dataset_build_config*` 三表）共同构成本文档与《重构方案》§1 的差异对照基准。

---

## 2. 逐表字段说明

字段表列含义：**键** `PRI`=主键 / `UNI`=唯一键 / `MUL`=普通索引首列；**默认** `—` 表示无默认值。

### 2.1 L1 外部数据域

#### 2.1.1 `stock_daily_prices` — A 域 日线行情（≈ 8,904,857 行）

来源 Tushare `daily`。**注意：价格列是 `varchar` 而非 `double`**（历史遗留，避免浮点精度争议）。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `stockCode` | varchar(20) | MUL | — | 证券代码（如 `000001.SZ` / `600000.SH`） |
| `tradeDate` | date | MUL | — | 交易日 |
| `openPrice` | varchar(24) | | — | 开盘价（字符串存储） |
| `closePrice` | varchar(24) | | — | 收盘价 |
| `preClosePrice` | varchar(24) | | — | 前收盘价（**涨停判定的基准**） |
| `lowPrice` | varchar(24) | | — | 最低价 |
| `highPrice` | varchar(24) | | — | 最高价 |
| `volume` | varchar(32) | | — | 成交量（股） |
| `amount` | varchar(32) | | — | 成交额（元） |
| `source` | varchar(32) | | `tushare` | 数据源标识 |
| `sourceUpdatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 源端更新时间 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间（`updatedAt` 带 ON UPDATE） |

#### 2.1.2 `index_daily` — F 域 指数日线（≈ 7,452 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `indexCode` | varchar(32) | MUL | 指数代码 |
| `tradeDate` | date | MUL | 交易日 |
| `open` `high` `low` `close` | double | | 指数 OHLC |
| `amount` `volume` | double | | 成交额 / 成交量 |
| `source` | varchar(32) | | 数据源 |
| `retrievedAt` | timestamp | | 抓取时间 |

#### 2.1.3 `index_master` — F 域 指数元数据（≈ 8 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `indexCode` | varchar(32) | MUL | 内部指数代码 |
| `indexName` | varchar(64) | | 指数名称 |
| `provider` / `providerCode` | varchar(32) | | 数据商与其代码 |
| `firstDate` / `lastDate` | date | | 该指数数据的起止日 |
| `source` | varchar(64) | | 数据源 |
| `retrievedAt` | timestamp | | 抓取时间 |

#### 2.1.4 `liquidity_daily` — E 域 流动性日频（≈ 9,015,158 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `securityId` | varchar(48) | | **规范化证券身份**（当前普遍为 NULL，见《重构方案》§4 P3） |
| `securityCode` | varchar(20) | MUL | 证券代码 |
| `tradeDate` | date | MUL | 交易日 |
| `turnoverRate` | double | | 换手率（%）。非空 8,938,065 / 9,015,158（99.14%） |
| `circulationMarketCap` | double | | 流通市值。⚠️ **死列：全 9,015,158 行均为 NULL**（见《重构方案》§4 P7） |
| `totalMarketCap` | double | | 总市值。⚠️ **死列：全 9,015,158 行均为 NULL**（见《重构方案》§4 P7） |
| `amount` `volume` | double | | 成交额 / 成交量 |
| `source` | varchar(32) | | 数据源（baostock） |
| `retrievedAt` | timestamp | | 抓取时间 |

#### 2.1.5 `research_securities` — B 域 证券主数据（≈ 5,552 行）

**规范身份的唯一权威表**。含退市证券（约 337 只），保证生存者偏差可控。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `securityId` | varchar(48) | UNI | — | **规范化身份 ID**（全库外键语义锚点） |
| `securityType` | enum(`stock`,`etf`,`index`,`bond`,`fund`) | | `stock` | 证券类型 |
| `exchange` | enum(`SH`,`SZ`,`BJ`) | MUL | — | 交易所 |
| `currency` | varchar(8) | | `CNY` | 币种 |
| `country` | varchar(8) | | `CN` | 国家 |
| `status` | enum(`listed`,`suspended`,`delisted`,`terminated`,`unknown`) | MUL | `unknown` | 当前状态 |
| `listedDate` / `delistedDate` | date | | — | 上市 / 退市日 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

#### 2.1.6 `research_security_identifier_history` — B 域 代码历史（≈ 5,552 行）

**PIT 安全**的「某日某证券用哪个代码」，也是回填 universe 的权威来源。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `securityId` | varchar(48) | MUL | — | 规范化身份 ID |
| `exchange` | enum(`SH`,`SZ`,`BJ`) | MUL | — | 交易所 |
| `securityCode` | varchar(20) | | — | 当期代码 |
| `identifierType` | enum(`primary`,`tushare_ts_code`,`sina_symbol`,`baostock_code`,`tencent_symbol`) | | `primary` | 代码体系 |
| `effectiveFrom` | date | MUL | — | 生效起始日 |
| `effectiveTo` | date | | — | 生效结束日（NULL = 至今） |
| `source` | varchar(32) | | `unknown` | 数据源 |
| `retrievedAt` | timestamp | | `CURRENT_TIMESTAMP` | 抓取时间 |

#### 2.1.7 `research_security_status_history` — C 域 状态历史（≈ 10,873 行）

**事件态表**：只记录**发生过**状态变更的证券（未 ST / 未停牌者无行，属正常），故行数远低于全市场。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `securityId` | varchar(48) | MUL | 规范化身份 ID |
| `statusType` | enum(`LISTING`,`TRADING`,`ST`,`DELISTING`,`SUSPENSION`) | MUL | 状态类别 |
| `statusValue` | varchar(32) | | 具体取值（如 `ST` / `*ST`） |
| `effectiveFrom` | date | | 生效起始日 |
| `effectiveTo` | date | | 生效结束日（NULL = 至今） |
| `source` | varchar(64) | | 数据源 |
| `retrievedAt` | timestamp | | 抓取时间 |
| `confidence` | enum(`high`,`medium`,`low`) | | 证据置信度 |
| `availability` | enum(`IMMEDIATE`,`T_PLUS_1`,`UNKNOWN`) | | **信息可得性**（PIT 关键：T+1 状态当日不可知） |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

> **PIT 用途**：`DbDatasetBuildIO.resolveSt(symbol, tradeDate)` 即查本表，按交易日在册判定 ST → 决定涨停比例为 5% 还是 10%。

#### 2.1.8 `corporate_actions` — D 域 公司行为（≈ 31,641 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `securityId` | varchar(48) | | 规范化身份 ID |
| `securityCode` | varchar(20) | MUL | 证券代码 |
| `actionType` | enum(`dividend`,`bonus_issue`,`transfer`,`rights_issue`,`split`,`reverse_split`,`other`) | | 行为类型 |
| `effectiveDate` | date | | 生效日 |
| `recordDate` / `announcementDate` | date | | 股权登记日 / 公告日 |
| `cashAmount` | varchar(32) | | 每股派现 |
| `bonusRatio` / `transferRatio` | varchar(32) | | 送股 / 转增比例 |
| `rightsRatio` / `rightsPrice` | varchar(32) | | 配股比例 / 配股价 |
| `splitRatio` | varchar(32) | | 拆并股比例 |
| `description` | text | | 原文描述 |
| `source` / `retrievedAt` | varchar(32) / timestamp | | 溯源 |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

#### 2.1.9 `adjustment_factors` — D 域 复权因子（≈ 21,932 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `securityId` | varchar(48) | | 规范化身份 ID |
| `securityCode` | varchar(20) | MUL | 证券代码 |
| `effectiveDate` | date | | 因子生效日 |
| `foreFactor` / `backFactor` | varchar(32) | | 前复权 / 后复权因子 |
| `source` / `retrievedAt` | varchar(32) / timestamp | | 溯源 |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

#### 2.1.10 `industry_assignments` — G 域 行业归属（≈ 5,212 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `securityId` | varchar(48) | | 规范化身份 ID（**当前全为 NULL**，见《重构方案》§4 P3） |
| `securityCode` | varchar(20) | MUL | 证券代码 |
| `industryCode` / `industryName` | varchar(32) / varchar(64) | MUL / — | 申万行业代码 / 名称 |
| `effectiveFrom` / `effectiveTo` | date | | 生效区间（`effectiveFrom` **全为单点 `2026-08-31`**，无历史轨迹，见《重构方案》§4 P4） |
| `source` / `retrievedAt` | varchar(32) / timestamp | | 溯源 |

### 2.2 L2 回填与运维

#### 2.2.1 `backfill_checkpoints` — 回填断点（≈ 1,865 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `tradeDate` | date | UNI | — | 交易日（断点粒度 = 日） |
| `status` | enum(`PENDING`,`RUNNING`,`SUCCESS`,`FAILED`,`SUSPICIOUS`,`QUOTA_STOPPED`) | MUL | `PENDING` | 回填状态 |
| `attempts` | int | | `0` | 尝试次数 |
| `rowCount` / `receivedRows` | int | | — | 期望行数 / 实收行数（不一致 → `SUSPICIOUS`） |
| `completedAt` | timestamp | | — | 完成时间 |
| `errorCode` / `errorMessage` | varchar(64) / text | | — | 失败原因 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

#### 2.2.2 `market_data` — 手工录入市场数据（≈ 201 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `dataDate` | date | UNI | 数据日期（一日一行） |
| `turnover` | varchar(20) | | 两市成交额 |
| `marginBalance` | varchar(20) | | 两融余额 |
| `note` | text | | 备注 |
| `createdBy` | int | | 录入用户 |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

#### 2.2.3 `limit_up_records` — 涨停记录（≈ 99,542 行）

由上传图片 OCR 识别 + 人工维护的**业务侧**涨停记录（与 L1 的行情事实互补）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `stockCode` | varchar(20) | MUL | 股票代码 |
| `stockName` | varchar(50) | | 股票名称 |
| `limitUpDate` | date | MUL | 涨停日 |
| `limitUpTime` | varchar(20) | | 首次涨停时间 |
| `boardCount` | varchar(20) | | 连板数（原文，字符串） |
| `circulationValue` | varchar(20) | | 流通市值 |
| `turnover` | varchar(20) | | 换手率 |
| `sector` | varchar(100) | MUL | 所属板块/概念 |
| `keywords` | text | | 关键词 |
| `createdBy` | int | MUL | 创建用户 |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

#### 2.2.4 `sentiment_alerts` — 情绪预警（≈ 3 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `alertDate` | date | MUL | — | 预警日 |
| `alertType` | enum(`warming`,`cooling`,`extreme_hot`,`extreme_cold`) | MUL | — | 预警类型 |
| `title` | varchar(100) | | — | 标题 |
| `description` | text | | — | 描述 |
| `currentScore` / `previousScore` / `scoreChange` | int | | — | 情绪分及变化 |
| `totalLimitUp` | int | | — | 涨停总数 |
| `connectionBoards` / `maxBoards` | int | | — | 连板数 / 最高连板 |
| `isRead` | enum(`0`,`1`) | MUL | `0` | 是否已读 |
| `createdAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

#### 2.2.5 `stock_suspension_windows` — 停牌窗口（≈ 159 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `stockCode` | varchar(20) | MUL | 股票代码 |
| `startDate` / `endDate` | date | | 停牌区间 |
| `source` | enum(`tushare-daily-infer`,`manual`) | | 来源：由日线缺失推断 / 人工 |
| `note` | text | | 备注 |
| `createdAt` / `updatedAt` | timestamp | | 落库时间 |

### 2.3 L3 数据集注册（Dataset Registry）

#### 2.3.1 `dataset_definition` — 数据集定义（1 行）

一个逻辑数据集 = **一组固定物理表**（表名显式落库，运行时绝不猜表名）。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键 |
| `datasetCode` | varchar(64) | UNI | — | 稳定语义代码（lowercase snake_case，禁版本号/日期/环境/UUID） |
| `name` | varchar(128) | | — | 展示名 |
| `description` | text | | — | 说明 |
| `datasetType` | varchar(32) | MUL | — | 数据集类型（如 `event`） |
| `storageType` | varchar(32) | | — | 存储形态（物理表） |
| `status` | varchar(20) | MUL | `ACTIVE` | 定义状态 |
| `eventTableName` | varchar(128) | | — | **事件表名（显式落库）** |
| `prefixTableName` | varchar(128) | | — | 前置行情表名（`rd ≤ 0`，PIT 安全特征层） |
| `postTableName` | varchar(128) | | — | 后置行情表名（`rd ≥ 1`，原始事实层） |
| `pathTableName` | varchar(128) | | — | 路径衍生表名 |
| `outcomeTableName` | varchar(128) | | — | 结果表名 |
| `featureTableName` | varchar(128) | | — | 特征表名（可选，当前未用） |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

> `prefixTableName` / `postTableName` 由 migration `drizzle/0030_dataset_window_layering.sql` 新增并回填为 `ds_{datasetCode}_prefix` / `ds_{datasetCode}_post`（与 `naming.ts` 同源，禁一版一表）。

#### 2.3.2 `dataset_version` — 数据集版本（3 行）

**多版本靠 `datasetVersionId` 隔离，禁止「一版一表」。**

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键（= 物理表中的 `datasetVersionId`） |
| `datasetId` | bigint | MUL | — | 所属定义 |
| `version` | varchar(32) | | — | 版本标签（如 `v1` / `smoke`） |
| `status` | varchar(20) | MUL | `DRAFT` | `DRAFT`→`BUILDING`→`READY`；失败 `FAILED` |
| `startDate` / `endDate` | date | | — | 构建窗口 |
| `universeDefinitionJson` | longtext | | — | Universe 定义镜像 |
| `filterDefinitionJson` | longtext | | — | **筛选口径镜像**（配置表的 legacy 回退层） |
| `featureVersion` / `sourceVersion` | varchar(32) | | — | 特征版本 / 源数据版本 |
| `totalEvents` / `totalRows` | bigint | | — | 构建产出规模 |
| `createdAt` / `completedAt` | timestamp | | | 创建 / 完成时间 |

#### 2.3.3 `dataset_build_job` — 构建作业（5 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键 |
| `datasetVersionId` | bigint | MUL | — | 目标版本 |
| `jobId` | varchar(64) | UNI | — | 作业业务 ID |
| `status` | varchar(20) | MUL | `PENDING` | `PENDING`→`RUNNING`→终态(`COMPLETED`/`FAILED`/`CANCELLED`) |
| `totalChunks` / `completedChunks` / `currentChunk` | bigint | | — | 分块进度 |
| `processedRows` / `failedRows` | bigint | | — | 处理行数 |
| `lastSymbol` / `lastTradeDate` | varchar(32) / date | | — | 断点位置 |
| `lastCursor` | **longtext** | | — | checkpoint JSON（**必须 LONGTEXT**，TEXT 会撑爆） |
| `startedAt` / `completedAt` / `updatedAt` | timestamp | | | 时间戳 |
| `errorMessage` | text | | — | 失败原因 |

#### 2.3.4 `dataset_build_config` — 构建筛选配置主表（0 行）

与 `dataset_version` **1:1 UNIQUE**。标量入列（可索引），多值入子表。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键 |
| `datasetVersionId` | bigint | **UNI** | — | 目标版本（1:1） |
| `excludeSt` | tinyint(1) | | `0` | 是否排除 ST（按事件日 PIT 状态判定） |
| `preWindowDays` | int | | `0` | **t 日及之前**的窗口天数 |
| `postWindowDays` | int | | `20` | **t 日之后**的窗口天数 |
| `outcomeHorizonsJson` | longtext | | — | 结果视界数组，如 `[5,10,20]` |
| `batchSize` | int | | `1000` | 批大小 |
| `configVersion` | int | | `1` | 配置结构版本 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

#### 2.3.5 `dataset_build_config_event` — 事件维度（多值，0 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键 |
| `configId` | bigint | MUL | — | 指向主表 |
| `relativeDay` | int | | — | **相对日锚点（≤ 0）**：0 = t 日、-1 = t-1 日；**禁止正锚点**（反未来泄漏） |
| `eventKind` | varchar(32) | | — | 事件类型（如 `firstBoard`） |
| `sortOrder` | int | | `0` | 展示顺序 |

#### 2.3.6 `dataset_build_config_board` — 板块维度（多值，0 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | bigint | PRI | — | 自增主键 |
| `configId` | bigint | MUL | — | 指向主表 |
| `board` | varchar(32) | | — | 交易所板块：`main` / `chinext` / `star` / `bse` |
| `sortOrder` | int | | `0` | 展示顺序 |

### 2.4 L4 数据集物理表（`ds_first_limit_pullback_*`，**5 张**）

命名规则：`ds_{dataset_code}_{role}`，`role ∈ event / prefix / post / path / outcome / feature`。

> **五表三层血缘**（2026-09-10 20:15 由 3 表就地迁移落地，零数据丢失）：
> ```
> event(身份) + prefix(L-事实 原始 rd ≤ 0) + post(L-事实 原始 rd ≥ 1)
>                                 │
>                                 ▼
>                        path(L-衍生 rd ≥ 1)  →  outcome(L-聚合，按 horizon)
> ```
> 分界依据两条正交维度：**时间方向**（t 日之前 / t 日 / t 日之后）× **数据层级**（原始事实 / 派生指标）。
> `prefix` 与 `post` 的分界落在 t 日 = 「可用于特征（后视，PIT 安全）」与「仅可用于标签（前视）」的边界。
> 迁移影响：`event` 24 → **18 列**、`path` 24 → **15 列**、新增 `prefix` / `post` 各 13 列；`outcome` 结构不变。

#### 2.4.1 `ds_first_limit_pullback_event` — 事件身份表（**精确 10,907 行** / 18 列）

**只承载事件身份 + t 日时点属性**；t 日行情已迁出（唯一归属 `prefix` 的 `relativeDay = 0` 行）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | | 事件业务 ID（`symbol`+`tradeDate` 派生） |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | **t 日（事件日）** |
| `market` | varchar(16) | | 交易所 |
| `industryCode` | varchar(32) | | 行业代码。⚠️ **死列：全 10,907 行均为 NULL**（上游 G 域 `effectiveFrom` 单点 2026-08-31 无法覆盖历史交易日，见《重构方案》§4 P4） |
| `boardType` | varchar(32) | | 交易所板块（`classifyBoard` 判定） |
| `previousClose` | double | | 前收盘价（**涨停判定依据**，故留本表而非下移 t−1 行） |
| `limitUpPrice` | double | | **涨停价（四舍五入到分）** |
| `turnover` | double | | t 日换手率（来自 `liquidity_daily.turnoverRate`）。非空 10,561 / 10,907（96.8%） |
| `isFirstLimit` | tinyint(1) | | 是否首板 |
| `previousLimitDate` | date | | 上一个涨停日 |
| `daysSincePreviousLimit` | int | | 距上一涨停的交易日数 |
| `historicalLimitCount` | int | | 历史涨停次数 |
| `marketCap` / `floatMarketCap` | double | | 总市值 / 流通市值。⚠️ **死列：全 10,907 行均为 NULL**（上游 `liquidity_daily` 市值列全空，见《重构方案》§4 P7） |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId)`；`KEY(datasetVersionId, tradeDate)`；`KEY(symbol, tradeDate)`

> ⚠️ **本表已不含** `open` / `high` / `low` / `close` / `volume` / `amount`（不变量 I3）—— 前视与后视行情一律走 `prefix` / `post`。

#### 2.4.2 `ds_first_limit_pullback_prefix` — 前置行情表 🆕（**精确 10,907 行** / 13 列）

**纯原始行情窗口**，供**特征工程**使用；`relativeDay ∈ [−preWindowDays, 0]`（`0` = t 日）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | 该相对日的实际交易日 |
| `relativeDay` | int | | **`−preWindowDays … 0`**（当前三版本实测均为 `0`，因 legacy 默认 `preWindowDays=0`） |
| `open` `high` `low` `close` | double | | 该日 OHLC |
| `volume` `amount` | double | | 量 / 额 |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(symbol, tradeDate)`；`KEY(datasetVersionId, relativeDay)`

> **结构级 PIT 防线（不变量 I8）**：本表**禁止**出现任何 `*FromEventClose` / `*FromEventHigh` / `isBreakout` / `volumeRatio` 列 —— 前视指标一律不进特征窗口。
> 也不含 `turnover` / 市值列（它们是 t 日时点富集属性，归 `event`）。
> **实例**：每个事件在本表**恰好一行 `relativeDay = 0`**（不变量 I2），且该行数 ≡ `event` 行数（不变量 I5）。

#### 2.4.3 `ds_first_limit_pullback_post` — 后置行情表 🆕（**精确 202,629 行** / 13 列）

**纯原始行情窗口**，供**精确回测撮合**与**标签计算**使用；`relativeDay ∈ [1, postWindowDays]`。
与 `prefix` **严格同构**（不变量 I10，仅 `relativeDay` 区间不同；DDL 由 `plugins.ts` 的同一段生成器产出）。

字段与 §2.4.2 完全一致，仅 `relativeDay` 语义为 `≥ 1`。

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(symbol, tradeDate)`；`KEY(datasetVersionId, relativeDay)`

> **不含任何衍生列（不变量 I9）** —— 本表是「事实」，全部派生量在 `path`。
> **键集合与 `path` 完全相等**（不变量 I10）：实测 `post=202,629` ≡ `path=202,629`，双向差集均为 0。

#### 2.4.4 `ds_first_limit_pullback_path` — 路径衍生表（**精确 202,629 行** / 15 列）

**只存衍生指标**，不再承载原始行情；`relativeDay` 语义为 **`1 … +postWindowDays`**（PIT 边界收紧，`rd ≤ 0` 已归 `prefix`）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | 该相对日的实际交易日 |
| `relativeDay` | int | | **`1 … +postWindowDays`**（实测 `1 ~ 20`） |
| `highFromEventClose` | double | | 相对事件收盘的最高涨幅 = `high/eventClose − 1` |
| `lowFromEventClose` | double | | 相对事件收盘的最低跌幅 = `low/eventClose − 1` |
| `closeFromEventClose` | double | | 相对事件收盘的收盘涨幅 = `close/eventClose − 1` |
| `pullbackFromEventHigh` | double | | 自事件最高价的回踩深度 = `low/eventHigh − 1` |
| `volumeRatio` | double | | 量比 = `volume/eventVolume` |
| `isBreakout` | tinyint(1) | | 是否突破（`high > eventHigh`） |
| `breakoutPrice` | double | | 突破价（= `eventHigh`，⚠️ **每行重复存储同一常数**，更合理位置是 `event`，本次保留） |
| `daysToBreakout` | int | | 距突破的交易日数（⚠️ **每行重复存储同一常数**，本次保留） |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(symbol, tradeDate)`；`KEY(datasetVersionId, relativeDay)`

> **已执行的清理（本次迁移）**：删 `returnFromEventClose`（与 `closeFromEventClose` 完全重复，213,536/213,536 行相同）、删 `pullbackFromEventClose`（与 `lowFromEventClose` 完全重复）、删 `turnover`（死列，全 NULL，根因 `buildRelativeBarsFull` 硬编码 `turnover: null`）、6 个原始行情列移交 `prefix`/`post`。
> 列数 24 → **15**；**所有衍生列均可由 `prefix(rd=0)` + `post` 100% 重算**（不变量 I11，抽样逐条比对最大绝对偏差 0）。

**实测 `relativeDay` 分布（迁移后，直连实查）**：

| 表 | `datasetVersionId` | `min` | `max` | 行数 |
|---|---|---|---|---|
| `prefix` | 1（smoke） / 30001（v1） / 90001（v2） | 0 | 0 | 151 / 516 / 10,240 |
| `post` | 1 / 30001 / 90001 | 1 | 6 / 20 / 20 | 523 / 5,938 / 196,168 |
| `path` | 1 / 30001 / 90001 | 1 | 6 / 20 / 20 | 523 / 5,938 / 196,168 |

#### 2.4.5 `ds_first_limit_pullback_outcome` — 结果表（**精确 32,721 行** / 10 列）

**结构不变**；聚合只依赖原始 OHLC（`MAX(high)` / `MIN(low)` / `MIN(close)`），故迁移后取数语义等价于读 `post`。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `horizon` | int | | 视界（交易日数） |
| `maxReturn` / `minReturn` | double | | 视界内最大 / 最小收益 |
| `maxDrawdown` | double | | 最大回撤 |
| `isBreakout` | tinyint(1) | | 视界内是否突破 |
| `daysToBreakout` | int | | 距突破的交易日数 |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, horizon)`；`KEY(eventId, horizon)`

> **血缘（不变量 I11）**：`outcome(H) = f(path.filter(1 ≤ relativeDay ≤ H))` —— 实测可 100% 重算（最大绝对偏差 0）。

### 2.5 L5 研究链路

#### 2.5.1 `strategies` — 策略主表（0 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `strategyId` | varchar(64) | UNI | — | 策略业务 ID |
| `name` | varchar(128) | | — | 策略名 |
| `latestVersion` | varchar(32) | | — | 最新版本 |
| `status` | varchar(32) | | `Draft` | 策略状态 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 落库时间 |

#### 2.5.2 `strategy_versions` — 策略版本（0 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `strategyId` | varchar(64) | MUL | 关联策略 |
| `version` | varchar(32) | | 版本号 |
| `strategyDocumentJson` | longtext | | 策略文档快照 |
| `versionRecordJson` | longtext | | 版本记录 |
| `fingerprint` | varchar(64) | | 内容指纹 |
| `datasetVersion` | varchar(96) | | **绑定的数据集版本** |
| `universeId` | varchar(128) | | 绑定 universe |
| `codeVersion` | varchar(64) | | 代码版本 |
| `createdAt` | timestamp | | 创建时间 |

#### 2.5.3 `research_datasets` — 研究数据集快照（7 行）

**内容指纹快照架构**（与 L3 Registry 并存，属 legacy 路径）。

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `datasetId` | varchar(128) | UNI | — | 数据集业务 ID |
| `datasetVersion` | varchar(96) | MUL | — | 数据集版本 |
| `name` | varchar(128) | MUL | — | 名称 |
| `startDate` / `endDate` | date | | — | 窗口 |
| `asOfPerTradeDate` | enum(`true`,`false`) | | `true` | 是否逐交易日 asOf（PIT 开关） |
| `asOf` | date | | — | 固定 asOf 日 |
| `rowsFingerprint` | varchar(64) | | — | 行内容指纹 |
| `policySetFingerprint` | varchar(64) | | — | 策略集指纹 |
| `versionSnapshotFingerprint` | varchar(64) | | — | 版本快照指纹 |
| `versionSnapshotJson` / `dataSnapshotJson` | longtext | | — | 版本 / 数据快照 |
| `universeDefinitionJson` | longtext | | — | universe 定义 |
| `rowCount` | int | | — | 行数 |
| `gate` | varchar(16) | | — | 认证门禁（`PASS`/`FAIL`/`INCONCLUSIVE`） |
| `gateNotesJson` | longtext | | — | 门禁说明 |
| `rowsTableName` | varchar(64) | | — | **指向动态行存储表**（`rd_rows_*`） |
| `createdAt` | timestamp | MUL | `CURRENT_TIMESTAMP` | 创建时间 |

#### 2.5.4 `rd_rows_*` — 动态行存储（`05809b1a6d97aa02` 163 行 / `5dce9db1421bec38` 800 行）

表名 = `rd_rows_{指纹前 16 位}`，**每个数据集版本一份**，生命周期跟随 `research_datasets`。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `tradeDate` | date | MUL | 交易日 |
| `securityId` | varchar(64) | | 证券身份 |
| `partitionSeq` | int | MUL | 分区序号（配合分页） |
| `rowJson` | longtext | | **整行 JSON**（宽表内容） |

#### 2.5.5 `research_experiments` / `research_experiment_batches` / `research_runs`（0 / 0 / 2 行）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `research_experiments` | `experimentId`(UNI) / `strategyId` / `strategyVersion` / `snapshotJson` / `status`(`created`\|`running`\|`completed`\|`failed`) | 单次实验配置快照 |
| `research_experiment_batches` | `batchId`(UNI) / `parameterSpaceJson` / `parameterSpaceFingerprint`(MUL) / `experimentIdsJson` / `status`(`created`\|`running`\|`completed`\|`failed`\|`cancelled`) | 参数空间批量实验 |
| `research_runs` | `runId`(UNI) / `experimentId`(MUL) / `status`(`running`\|`succeeded`\|`failed`) / `resultJson` / `error` / `startedAt` / `finishedAt` / **`datasetId`** / **`datasetVersion`**(MUL) / **`datasetFingerprint`** | 实验运行实例；后三列 = **数据集强绑定**（legacy 路径为 NULL） |

#### 2.5.6 `backtest_runs` / `paper_trading_runs`（1 / 0 行）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `backtest_runs` | `paramsHash`(MUL) / `paramsJson` / `summaryJson` / `resultJson`(longtext) / `createdAt`(MUL) | 回测结果缓存（按参数哈希复用） |
| `paper_trading_runs` | `label` / `strategyKey` / `paramsJson` / `initialCapital` / `status`(`active`\|`paused`\|`completed`) / `lastProcessedDate` / `stateJson`(longtext) | 模拟盘账户状态机 |

### 2.6 L6 应用层

#### 2.6.1 `users`（1 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `openId` | varchar(64) | UNI | — | 第三方登录 ID |
| `name` | text | | — | 昵称 |
| `email` | varchar(320) | | — | 邮箱 |
| `loginMethod` | varchar(64) | | — | 登录方式 |
| `role` | enum(`user`,`admin`) | | `user` | **角色（决定 admin 端点权限）** |
| `createdAt` / `updatedAt` / `lastSignedIn` | timestamp | | `CURRENT_TIMESTAMP` | 时间戳 |

#### 2.6.2 `stock_watchlist`（6 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `userId` | int | MUL | — | 所属用户 |
| `stockCode` / `stockName` | varchar(20) / varchar(50) | | — | 股票代码 / 名称 |
| `watchType` | enum(`normal`,`important`) | | `normal` | 关注级别 |
| `note` | text | | — | 备注 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 时间戳 |

#### 2.6.3 `uploaded_images`（≈ 309 行）

| 字段 | 类型 | 键 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | int | PRI | — | 自增主键 |
| `fileKey` | varchar(255) | | — | 对象存储 key |
| `fileUrl` | text | | — | 访问 URL |
| `originalName` | varchar(255) | | — | 原始文件名 |
| `limitUpDate` | date | | — | 图片对应涨停日 |
| `status` | enum(`pending`,`processing`,`completed`,`failed`) | MUL | `pending` | 识别状态 |
| `createdBy` | int | MUL | — | 上传用户 |
| `createdAt` / `updatedAt` | timestamp | | `CURRENT_TIMESTAMP` | 时间戳 |

#### 2.6.4 `operation_logs`（≈ 83 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | int | PRI | 自增主键 |
| `operationType` | enum(`image_recognition`,`date_refresh`) | MUL | 操作类型 |
| `status` | enum(`processing`,`success`,`empty`,`failed`) | | 执行状态 |
| `imageId` | int | MUL | 关联图片 |
| `fileName` | varchar(255) | | 文件名 |
| `requestedDate` | date | MUL | 请求日期 |
| `effectiveDate` | date | | 实际生效日期 |
| `recognizedCount` / `refreshedCount` | int | | 识别 / 刷新条数 |
| `message` | text | | 日志信息 |
| `createdBy` | int | MUL | 操作用户 |
| `imageUrl` | text | | 图片 URL |
| `createdAt` / `updatedAt` | timestamp | | 时间戳 |

### 2.7 L7 框架

#### 2.7.1 `__drizzle_migrations`（24 行）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint unsigned | PRI | 自增主键 |
| `hash` | text | | 迁移文件哈希 |
| `created_at` | bigint | | 应用时间戳 |

---

## 3. 横向设计约定

### 3.1 命名规范

| 对象 | 规则 | 示例 |
|---|---|---|
| Dataset 物理表 | `ds_{dataset_code}_{role}`，`role ∈ event/prefix/post/path/outcome/feature` | `ds_first_limit_pullback_event` |
| Dataset 代码 | lowercase snake_case；**禁**版本号 / 日期 / 环境名 / UUID | `first_limit_pullback` |
| 版本标签 | 仅存在于 `dataset_version.version`，**不参与表名** | `v1` / `2024-full` |
| 业务时间列 | `tradeDate`（交易日）/ `effectiveFrom`~`effectiveTo`（生效区间） | — |
| 落库时间列 | `createdAt` / `updatedAt` / `retrievedAt` / `sourceUpdatedAt` | — |
| 溯源列 | `source`（数据源）+ `retrievedAt`（抓取时间）成对出现 | — |

### 3.2 PIT（Point-In-Time）约定

| 场景 | 约定 |
|---|---|
| 信息可得性 | `research_security_status_history.availability`：`IMMEDIATE` / `T_PLUS_1` / `UNKNOWN`，T+1 状态**当日不可知** |
| ST 判定 | 必须走 `DbDatasetBuildIO.resolveSt(symbol, tradeDate)`，**按交易日在册**判定，禁用代码前缀 |
| 数据集筛选 | 相对日锚点 **≤ 0**（0 = t 日），**禁止正锚点**（双层校验：契约层 + 纯函数层） |
| 固定 asOf | `research_datasets.asOfPerTradeDate = false` 时用 `asOf` 单点，**只能产出 CONDITIONAL 认证** |

### 3.3 状态枚举

| 表 | 字段 | 取值 |
|---|---|---|
| `dataset_version` | `status` | `DRAFT` → `BUILDING` → `READY`；`BUILDING` → `FAILED`；`FAILED`/`READY` → `BUILDING`（重建） |
| `dataset_build_job` | `status` | `PENDING` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED`（终态无出边） |
| `dataset_definition` | `status` | `ACTIVE`（未定义 `ARCHIVED` 迁移） |

### 3.4 数值类型选择

| 场景 | 选择 | 理由 |
|---|---|---|
| `ds_*` 价格 / 收益 | `double` | Drizzle `decimal` 返回 string 会与 TS `number` 类型错配 |
| `stock_daily_prices` 价格 | `varchar(24)` | 历史遗留，避免浮点争议；**读取时必须显式转 number** |
| `rd_rows_*.rowJson` | `longtext` | 整行 JSON，TEXT 会溢出 |
| `dataset_build_job.lastCursor` | `longtext` | checkpoint JSON 含累计涨停历史，TEXT 64KB 撑爆 |

### 3.5 身份与复权

- **身份锚点** = `research_securities.securityId`（varchar(48)），经 `research_security_identifier_history` 做「代码 ↔ 身份」的时点映射。
- **复权** = `adjustment_factors`（前复权 `foreFactor` / 后复权 `backFactor`），按 `(securityCode, effectiveDate)` 生效。
- `ds_*` 表使用的是**原始价**（未复权），`limitUpPrice` 由 `previousClose` 现算，口径与交易所一致。

---

## 附录 A：文档生成与复核方式

```bash
# 1. 直连 information_schema 导出全库结构（只读）
npx tsx scripts/_schema_probe.mts
#   → scripts/_schema_probe_out.json（tables / columns / indexes / ds_* 精确行数与 relativeDay 分布）

# 2. ds_* 精确行数断言（可选）
node -e "const d=require('./scripts/_schema_probe_out.json');console.log(d.dsDetail)"
```

**本文件第 2 节全部字段信息**来自 `information_schema.COLUMNS` 实查；**《重构方案》§1.2 的行数证据**来自对 `ds_*` 三表的 `COUNT(*)` 与 `GROUP BY relativeDay` 实查，非估算。

## 附录 B：本文档的证据来源脚本

| 脚本 | 用途 | 关键产出 |
|---|---|---|
| `scripts/_schema_probe.mts` | 全库结构导出 | 39 表 / 422 字段 / 185 索引 + `ds_*` 精确行数与 `relativeDay` 分布 |
| `scripts/_coldup_probe.mts` | `path` 列级冗余 | `pair1_same = pair2_same = 213,536 / 213,536` |
| `scripts/_lineage_probe.mts` | 血缘 / 死列 | `event.turnover` 10,561 非空；`event.marketCap`/`industryCode` = 0；`path.turnover` = 0 |
| `scripts/_lineage_probe2.mts` | 差异归因 | 1,509 比对 / 1,506 精确 / 3 双方 NULL / **max_abs_diff = 0** |
| `scripts/_liq_probe.mts` | 上游市值列覆盖 | `liquidity_daily` 9,015,158 行：`turnoverRate` 99.14% 非空，**市值两列全 NULL** |
| `scripts/_turnover_probe.mts` | `turnover` 死列定位 | `event.turnover` 10,561/10,907 非空；`path.turnover` 0/213,536 |
| `scripts/_d0_probe.mts` | D0 完整性（`rd=0` 行数据与孤儿事件） | 三版本 `rd=0` 行 OHLCV/量额 **100% 非 NULL**；孤儿事件 **0**；`neg_rows = 0` |

> 上述脚本均为**只读一次性探针**，可安全重跑复核。
