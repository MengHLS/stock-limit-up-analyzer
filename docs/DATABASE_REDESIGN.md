# 数据库重构方案（Database Redesign）—— 事件窗口五表分层

> **文档定位**：本文档只写**改造目标与迁移方案**（做什么、为什么、怎么改），不重复陈述现状事实 —— **现状结构说明见《数据库设计文档》**（`docs/DATABASE_DESIGN.md`）。
> **状态**：✅ **已定稿**；✅ **S1~S4 已实施**（2026-09-10 20:15，见 §3.5 状态列）。遗留：**P1 涨停口径修复后的 smoke/v1/v2 重建仍未执行**，故基于当前 `ds_*` 数据的策略结论仍不得产出。
> **定稿时间**：2026-09-10 19:00+ （GMT+8）｜**实施时间**：2026-09-10 19:40–20:15（GMT+8）｜**数据源**：TiDB Cloud 实查（只读探针 + 就地迁移）
> **结构**：§1 现状问题与存在性裁定 · §2 目标设计 · §3 迁移影响分析 · §4 已知问题清单 · 附录 A 完整 DDL · 附录 B 表数量变更记录

---

## 1. 现状问题与存在性裁定

### 1.1 问题存在性裁定（先回答「到底存不存在」）

围绕本设计曾出现若干"看似严重"的议题。为避免概念滑坡与自我强化，此处对每一项做**处置分类** —— 严格区分「已实测存在于数据」「存在于设计但数据尚未触发」「经实测证伪 / 降级」三类：

| # | 议题 | 裁定 | 实测依据 |
|---|---|---|---|
| 1 | 跨表 t 日重复 | ✅ **存在于数据** | `path(rd=0)` 行数 ≡ `event` 行数（151 / 516 / 10,240） |
| 2 | `path` 语义混装（负相对日） | ⚠️ **存在于设计；现存数据未触发** | 三持久版本 `MIN(rd)=0`、`neg_rows=0`（走 legacy 默认 `preWindowDays=0`） |
| 3 | PIT 语义污染 | ✅ **存在于设计** | `path` 同表承载后视行情（`rd≤0`）与前视衍生列 |
| 4 | `path` 原始/衍生混装 + 列级冗余 | ✅ **存在于数据** | 2 对重复列各 213,536/213,536 行完全相同；`path.turnover` 全 NULL |
| 5 | `outcome` 与 `path` 平级存放 | ✅ **存在于设计** | `outcome` 100% 可由 `path` 重算（§2.5），血缘在表结构上不可见 |
| 6 | `EventReference`「致命坑」 | ⚠️ **存在，但性质被高估** | 实为**内存对象耦合**（非跨表取数）；删字段后 `tsc` **强制报错**，属编译期可见 |
| 7 | C3 会改变行数（需权衡） | ❌ **实测零影响** | 三版本 `rd=0` 行的 OHLCV/量额 **100% 非 NULL**，孤儿事件 **0** → 采纳不减少任何行 |
| 8 | `event.turnover` 上游缺失 | ❌ **证伪** | 实测 10,561 / 10,907 = **96.83% 有值**；真正的死列是 `path.turnover`（硬编码 `null`） |

> **一句话结论**：议题 **1/3/4/5 真实存在且值得改造**；**2** 是设计缺陷、现存数据未触发（但用非零 `preWindowDays` 建版本即触发）；**6** 可控（编译期兜底）；**7/8** 是我先前表述不准，已实测证伪。**至此无遗留待决策项。**

### 1.2 现状问题（实查证据）

**问题 ①：跨表 t 日重复。** `path` 表的 `relativeDay = 0` 行与 `event` 表的 t 日行情是**同一份数据**，实测行数完全 1:1 对应：

| 版本 | `event` 行数 | `path` 中 `relativeDay=0` 行数 | 是否相等 |
|---|---|---|---|
| 1（smoke） | 151 | 151 | ✅ |
| 30001（v1） | 516 | 516 | ✅ |
| 90001（v2） | 10,240 | 10,240 | ✅ |
| **合计** | **10,907** | **10,907** | ✅ |

**问题 ②：`path` 语义混装。** DATASET-003B 引入 `preWindowDays` 后，t 日**之前**的行情被写入 `path` 表（用负 `relativeDay`）。即"路径表"同时装着**历史上下文**与**未来路径**两种性质相反的数据。

**问题 ③：PIT 语义污染。** `path` 表的衍生列（`closeFromEventClose` / `isBreakout` …）是**前视（forward-looking）**指标，只能用于打标签；而 t 日及之前的行情是 **PIT 安全的特征来源**。两者混在一张表里，使用侧必须靠 `relativeDay` 符号自己分辨，**容易误把未来信息当特征**。

**问题 ④：`path` 表原始与衍生混装 + 列级冗余（实查）。** `path` 名义 24 列 = 6 身份 + **7 原始** + **10 衍生** + 1 时间戳，其中：

| 现象 | 实测证据 |
|---|---|
| `returnFromEventClose` ≡ `closeFromEventClose` | **213,536 / 213,536 行完全相同**（源码为同一表达式） |
| `lowFromEventClose` ≡ `pullbackFromEventClose` | **213,536 / 213,536 行完全相同** |
| `path.turnover` | **213,536 行全 NULL**（死列） |
| `breakoutPrice` / `daysToBreakout` | 每行重复存储同一常数（事件级属性） |

→ **名义 24 列，实际只有 19 个不同的量**。这是「数据看起来很重复」的真实来源之一。

**问题 ⑤：`outcome` 是 `path` 的派生视图，但与 `path` 平级存放。** 实测 `outcome` 100% 可由 `path` 重算（§2.5），却与 `path` 同处一层，血缘关系在表结构上不可见。

## 2. 目标设计：事件窗口五表分层（✅ 已定稿，无遗留待决策项，待授权实施）

### 2.1 目标结构（✅ 已定稿：五表三层血缘）

切分采用**两个正交维度**：**时间方向**（t 日前后）× **数据层级**（原始事实 / 派生指标）。

| # | role | 表名 | `relativeDay` | 层级 | 一句话职责 | 时间方向 |
|---|---|---|---|---|---|---|
| 1 | `event` | `ds_{code}_event` | —（t 日**身份**） | L-事实 | 事件**是什么**（不含逐日 OHLCV） | 时点 |
| 2 | `prefix` | `ds_{code}_prefix` | `−preWindowDays … 0` | L-事实 | t 日**及之前**的**原始行情** | **后视（PIT 安全）** |
| 3 | `post` | `ds_{code}_post` | `1 … +postWindowDays` | L-事实 | t 日**之后**的**原始行情** | 前视 |
| 4 | `path` | `ds_{code}_path` | `1 … +postWindowDays` | **L-衍生** | t 日之后的**衍生指标**（相对事件价） | **前视（仅打标签）** |
| 5 | `outcome` | `ds_{code}_outcome` | —（按 `horizon` 聚合） | **L-聚合** | 结果**如何** | 前视聚合 |

```
event(身份)  +  prefix(原始 ≤0)  +  post(原始 ≥1)        ← L-事实（依赖行情源）
                        │
                        │ 依赖事件参考价 (eventClose / eventHigh / eventVolume)
                        ▼
                  path(衍生 ≥1)                           ← L-衍生（✅ 100% 可由上层重算）
                        │
                        │ 窗口聚合（有损：只留极值，丢轨迹）
                        ▼
                  outcome(按 horizon)                     ← L-聚合（✅ 100% 可由 path 重算）
```

**两条核心论证**：

1. **`prefix` 与 `post` 的分界落在 t 日** —— 而这个分界恰好就是**「可用于特征」与「仅可用于标签」的 PIT 边界**。拆表之后，「误用未来信息」从"需要人工判断"变成"**表选错就查不到**"。
2. **`prefix`/`post` 与 `path` 的分界落在「原始 vs 衍生」** —— 衍生列全部是事件参考价的前视函数，混在行情表里使用侧只能靠字段名猜。分层后血缘**可证**（§2.5 已实测 `outcome ← path` 100% 可重算），且**衍生口径变更只需重算 `path` + `outcome`，不动昂贵的原始事实层**。

> **为何 `prefix` 与 `post` 不合并成一张 `bars`**：二者分界即为 PIT 边界（论证 1），合并会丢掉最重要的一道结构性防线，不可为省一张表而牺牲。

### 2.2 字段级设计

#### 2.2.1 `ds_{code}_event`（事件身份表，18 列）

**移除 6 个日线行情列**：`open` `high` `low` `close` `volume` `amount`（移入 `prefix` / `post`）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | | 事件业务 ID |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | **t 日** |
| `market` | varchar(16) | | 交易所 |
| `industryCode` | varchar(32) | | 行业代码 |
| `boardType` | varchar(32) | | 交易所板块 |
| `previousClose` | double | | **t−1 日收盘价（涨停判定依据）** |
| `limitUpPrice` | double | | **涨停价（四舍五入到分）** |
| `isFirstLimit` | tinyint(1) | | 是否首板 |
| `previousLimitDate` | date | | 上一涨停日 |
| `daysSincePreviousLimit` | int | | 距上一涨停的交易日数 |
| `historicalLimitCount` | int | | 历史涨停次数 |
| `marketCap` / `floatMarketCap` | double | | 总市值 / 流通市值（⚠️ 上游全 NULL，见 §4 P7） |
| `turnover` | double | | t 日换手率（来自 `liquidity_daily.turnoverRate`；实测 **10,561 / 10,907 = 96.83%** 有值） |
| `createdAt` | timestamp | | 落库时间 |

> **为什么 `previousClose` 留 `event` 而不下移**：它是涨停判定的直接依据，`limitUpPrice` 由它派生。若下移到 `prefix` 的 `relativeDay = −1` 行，则当 `preWindowDays = 0`（不物化 t−1 日）时**该行根本不存在**，`limitUpPrice` 将无法回溯验证，违背「可重算」不变量（I11）。体量极小（事件数 × 1 列），故保留为**事件的定义性属性**。
>
> **`turnover` / `marketCap` / `floatMarketCap` 也留 `event`**：三者同属 **t 日时点富集属性**（来自 `liquidity_daily` 富集，**不是日线原始字段**），且不随相对日展开。`prefix` / `post` 只承载**纯日线原始列**，避免把富集列混进特征窗口表。

#### 2.2.2 `ds_{code}_prefix`（L-事实：t 日及之前原始行情，13 列）

**纯原始行情窗口**，供**特征工程**使用。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | 该相对日实际交易日 |
| `relativeDay` | int | | **`−preWindowDays … 0`**（0 = t 日） |
| `open` `high` `low` `close` | double | | 该日 OHLC |
| `volume` `amount` | double | | 量 / 额 |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(datasetVersionId, relativeDay)`

> **不含任何 `*FromEventClose` / `isBreakout` 列** —— 前视指标一律不进本表，从结构上杜绝特征污染（不变量 I8）。
> **不含 `turnover` / 市值列** —— 它们不是日线原始字段，归 `event`（见 §2.2.1）。

#### 2.2.3 `ds_{code}_post`（L-事实：t 日之后原始行情，13 列）— 🆕 新增

**纯原始行情窗口**，供**精确回测撮合**与**标签计算**使用。与 `prefix` **同构**，仅 `relativeDay` 区间不同（可在插件里用同一段 DDL 生成器产出，代码零重复）。

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | 该相对日实际交易日 |
| `relativeDay` | int | | **`1 … +postWindowDays`** |
| `open` `high` `low` `close` | double | | 该日 OHLC |
| `volume` `amount` | double | | 量 / 额 |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(datasetVersionId, relativeDay)`

> **不含任何衍生列**（不变量 I9）—— 本表是"事实"，全部派生量在 `path`。
> **与 `prefix` 严格同构**（字段逐一对齐，仅 `relativeDay` 区间不同）—— 不变量 I10。

#### 2.2.4 `ds_{code}_path`（L-衍生：相对事件价指标，15 列）

**只存衍生指标**，不再承载原始行情。`relativeDay` 语义收紧为 `≥ 1`。

已执行清理（✅ 用户确认）：**删除 2 对完全重复的列** ——
- 删 `returnFromEventClose`（与 `closeFromEventClose` 完全重复，保留后者语义更明确）
- 删 `pullbackFromEventClose`（与 `lowFromEventClose` 完全重复）

| 字段 | 类型 | 键 | 说明 |
|---|---|---|---|
| `id` | bigint | PRI | 自增主键 |
| `datasetVersionId` | bigint | MUL | 版本隔离键 |
| `eventId` | varchar(64) | MUL | 关联事件 |
| `symbol` | varchar(32) | MUL | 证券代码 |
| `tradeDate` | date | | 该相对日实际交易日 |
| `relativeDay` | int | | **`1 … +postWindowDays`** |
| `closeFromEventClose` | double | | 相对事件收盘的收盘涨幅 = `close/eventClose − 1` |
| `highFromEventClose` | double | | 相对事件收盘的最高涨幅 = `high/eventClose − 1` |
| `lowFromEventClose` | double | | 相对事件收盘的最低跌幅 = `low/eventClose − 1` |
| `pullbackFromEventHigh` | double | | 自事件最高价的回踩深度 = `low/eventHigh − 1` |
| `volumeRatio` | double | | 量比 = `volume/eventVolume` |
| `isBreakout` | tinyint(1) | | 是否突破（`high > eventHigh`） |
| `breakoutPrice` | double | | 突破价（= `eventHigh`；⚠️ 每行重复常数，本次保留） |
| `daysToBreakout` | int | | 距突破的交易日数（⚠️ 每行重复常数，本次保留） |
| `createdAt` | timestamp | | 落库时间 |

**约束**：`UNIQUE(datasetVersionId, eventId, relativeDay)`；`KEY(eventId, relativeDay)`；`KEY(datasetVersionId, relativeDay)`

> **本次保留的遗留项**（用户未选择清理，**结构在此显式记录以免遗忘**）：
> - `breakoutPrice` / `daysToBreakout` 为**事件级属性**，当前每行重复存储同一常数 → 更合理的位置是 `event` 表
> - `turnover` 死列：**归属 `event`**（见 §2.2.1），**不**下移到 `prefix` / `post`，避免把富集列混进特征窗口表
> - 上游 `liquidity_daily` 市值列缺失（P7）仍未排查

#### 2.2.5 `ds_{code}_outcome`（L-聚合：按 horizon 结果，10 列）

**结构不变**。聚合只依赖原始 OHLC（`MAX(high)` / `MIN(low)` / `MIN(close)`），因此迁移后**改从 `post` 表取数**即可，语义零变化。

### 2.3 不变量（可直接断言验证）

| # | 不变量 | 验证方式 |
|---|---|---|
| **I1** | `prefix` 与 `path` / `post` 的 `(datasetVersionId, eventId, relativeDay)` 交集为**空** | 三表按 `relativeDay` 区间自证（`≤0` vs `≥1`），另做交叉计数比对 |
| **I2** | 每个 `eventId` 在 `prefix` 中**恰好一行** `relativeDay = 0` | `SELECT eventId, COUNT(*) ... WHERE relativeDay=0 GROUP BY eventId HAVING COUNT(*)<>1` 应为 0 行 |
| **I3** | `event` 表**不含** `open` / `high` / `low` / `close` / `volume` / `amount` 列（`previousClose` 属时点属性，**允许保留**） | `information_schema.COLUMNS` 断言 |
| **I4** | `prefix.relativeDay ∈ [−preWindowDays, 0]`；`post.relativeDay ∈ [1, postWindowDays]`；`path.relativeDay ∈ [1, postWindowDays]` | `MIN/MAX` 断言 |
| **I5** | `event` 行数 = `prefix` 中 `relativeDay=0` 行数（t 日唯一归属 `prefix`） | 两表计数比对 |
| **I6** | `outcome` 行数 = `event` 行数 × `|horizons|` | 计数比对 |
| **I7** | 所有 `ds_*` 行在 `(datasetVersionId, ...业务键)` 上唯一 | `GROUP BY ... HAVING COUNT(*)>1` 应为 0 行 |
| **I8** | `prefix` 表**不含** `*FromEventClose` / `isBreakout` 列（结构级 PIT 防线） | `information_schema.COLUMNS` 断言 |
| **I9** | `post` 表**不含任何衍生列**（纯 OHLCV + 身份） | `information_schema.COLUMNS` 断言 |
| **I10** | `post` 与 `path` 的 `(datasetVersionId, eventId, relativeDay)` 键集合**完全相等** | 两表键集合差集为空 |
| **I11** | `path` 可 100% 由 `prefix + post + event` 重算；`outcome` 可 100% 由 `path` 重算 | 逐条重算比对，最大绝对偏差 = 0（§2.5 已验证 `outcome ← path`） |

### 2.4 与现状的差异对照

| 维度 | 现状 | **目标（✅ 已定稿）** |
|---|---|---|
| 物理表数 | 3（event / path / outcome） | **5**（event / prefix / **post** / path / outcome） |
| t 日行情归属 | `event` **和** `path(0)` **双份**（10,907 行） | `prefix(0)` **唯一一份** |
| t 日之前行情 | 塞进 `path`（负 `relativeDay`） | `prefix`（`−pre … 0`） |
| `path.relativeDay` | `0 … +N` | **`1 … +N`** |
| 原始 / 衍生 | 混装于 `path` | **分离**（`prefix`/`post` 原始 · `path` 衍生） |
| 重复列 | 2 对完全重复（213,536 行相同） | **已删**（`returnFromEventClose` / `pullbackFromEventClose`） |
| PIT 防线 | 靠 `relativeDay` 符号人工分辨 | 靠表边界 + **层级边界**双重隔离 |
| 血缘 | 不可证 | **三层可证**（§2.5 已实测 100%） |
| `DatasetRole` 枚举 | `event` / `path` / `outcome` / `feature` | 增 **`prefix`** + **`post`** |
| `dataset_definition` | 4 个表名列 | 增 **`prefixTableName`** + **`postTableName`** |

### 2.5 血缘分析：`outcome` 是 `path` 的有损投影（实测证据）

`outcome` 与 `path` **存在强相关**，关系是**函数依赖**而非并列：

```
outcome(H) = f( path.filter(1 ≤ relativeDay ≤ H) )
```

源码依据（`server/datasetRegistry/path.ts#buildOutcomeRow`）：`window = bars.filter(b => b.relativeDay >= 1 && b.relativeDay <= horizon)`，再从窗口取 `MAX(high)` / `MIN(low)` / `MIN(close)` / 首个突破日。

**实测验证（v1，id=30001，逐条比对全部 1,509 条 outcome 行）**：

| 指标 | 结果 |
|---|---|
| 参与比对 | 1,509 |
| `maxReturn` 精确相等（< 1e-9） | **1,506** |
| 双方同为 NULL（非不匹配） | **3** |
| 最大绝对偏差 | **0** |
| 结论 | **1,506 + 3 = 1,509 → 100% 可由 `path` 重算** |

3 条 NULL 样本（`300799.SZ@2024-01-23` H=5、`600647.SH@2024-01-11` H=5/H=10）的 `maxHigh` 为 NULL —— 窗口内无行情（停牌/数据缺失），`outcome.maxReturn` 同样为 NULL，**双方一致，属诚实不伪造**。

**方向性**：`outcome` 可 100% 由 `path` 重算；`path` **不能**由 `outcome` 还原（极值聚合丢弃了逐日轨迹）。故 `outcome` 在层级上**低于** `path`，是派生视图而非事实。

### 2.6 设计取舍记录（为何选五表）

§2.1 的切分维度之一是**时间方向**（t 日前后），§1.2 问题 ④ 暴露出**第二个正交维度**：**数据层级**（原始事实 vs 派生指标）。两者交叉得到五表。

**候选方案对比**：

| 方案 | 表 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| 不拆表，只清冗余列 | 3 | 改动最小 | 保留原始/衍生混装的结构性缺陷；衍生口径变更需重建全部 | ❌ 未采纳 |
| 仅切 t 日前后 | 4 | 表数少 | `path` 仍混装；血缘不可证 | ❌ 未采纳 |
| **两维度交叉（五表）** | **5** | 血缘可证 / 衍生可独立重算 / PIT 双重隔离 | 每数据集 +2 表；完整视图需 join | ✅ **已定稿** |

**收益**：

| 收益 | 说明 |
|---|---|
| **血缘可证** | 三层各有明确上游；已实测 `outcome ← path` 100% 可重算（§2.5） |
| **可重算性** | 衍生口径变更只需重算 `path` + `outcome`，**不动昂贵的原始事实层** |
| **PIT 更硬** | 衍生列（前视）物理隔离在 `path`；`prefix`/`post` 是纯行情，**无前视污染风险** |
| **顺带清理** | 拆表时一并删除 2 对完全重复的列（§1.2 问题 ④） |

**代价与缓解**：

| 代价 | 量化 | 缓解 |
|---|---|---|
| 表数 | 每数据集 **3 → 5**（+2） | `prefix` 与 `post` 同构，可用**同一段 DDL 生成器**产出，代码零重复 |
| 完整视图需 join | `post ⋈ path ON (datasetVersionId, eventId, relativeDay)` | 可按需建只读宽视图 `ds_{code}_path_wide`（TiDB 视图性能待实测） |
| 跨境 TiDB 往返 | 单次 ~0.5s，join 有额外成本 | **拆列不拆行，行数不翻倍**（`post`/`path` 各 213,536 行） |

**命名决策**：role 采用 `prefix` / `post` / `path` —— `path` 保留既有名字（下游查询、前端、验证脚本改动最小），`prefix`/`post` 表达"事件前 / 后"的原始行情。备选 `prefix_raw`/`post_raw`/`path_derived` 与 `prefix`/`post`/`label` 未被采纳。

---

## 3. 迁移影响分析（面向已定稿的五表方案）

### 3.1 数据库对象

| 对象 | 动作 | 说明 |
|---|---|---|
| `ds_*_prefix` | **新建** | 3 表 DDL 自包含（禁 `CREATE TABLE ... LIKE`） |
| `ds_*_post` | **新建**（仅 §2.6 五表方案） | 原始行情（`relativeDay ≥ 1`），与 `prefix` 同构仅区间不同 |
| `ds_*_event` | **重建**（删 6 个日线行情列） | 表结构变更，须重建；**保留** `previousClose` / `limitUpPrice` / `marketCap` 等时点属性（列归属见 §3.3） |
| `ds_*_path` | **数据重写** | 四表方案：收紧 `relativeDay ≥ 1`；五表方案：**再删 7 个原始行情列 + 2 个重复列 + 死列**，只留衍生 |
| `ds_*_outcome` | 无变更 | — |
| `dataset_definition` | 增列 `prefixTableName`（+ `postTableName`） | migration `0030` |
| `dataset_build_config` | 无变更 | `preWindowDays` 语义不变，仅落点从 `path` 改为 `prefix` |

**建议**：因既有数据本就要按修复后的涨停口径重建（见 `ROADMAP §44.1`，涨停漏判 38.03%），**结构与口径一次性收敛**，不做 `ALTER TABLE` 渐进迁移。

### 3.2 代码模块

| 模块 | 影响 |
|---|---|
| `naming.ts` | `DATASET_ROLES` 增 `prefix`；`buildDatasetTableNames` 返回增 `prefix` |
| `plugins.ts` | `prefixCreateSql` 新增；`eventCreateSql` 删 6 个日线行情列；`firstLimitPullbackPlugin.physicalTables` 增一项 |
| `types.ts` | 增 `FirstLimitPullbackPrefix`（+ `FirstLimitPullbackPost`）行类型；`FirstLimitPullbackEvent` 删 6 个日线行情字段；`FirstLimitPullbackPath` 删 7 原始列 + 2 重复列 + `turnover` |
| `builder.ts` | `assembleEventRow` 不再写日线行情；`buildEventPathsAndOutcomes` 的 `EventReference` 改从**入参 `relativeBars`** 提取（**零额外查询**，详见 §3.3）；负相对日行写 `prefix`、正相对日原始行写 `post`、衍生写法 `path` |
| `db.ts` | 增 `prefix` / `post` 表 upsert 与查询 |
| `path.ts` | 新增纯函数 `eventReferenceFrom(bars)`（§3.3）；`buildPathRows` 拆为 `buildRawBars`（→ `post`）与 `buildDerivedRows`（→ `path`）；`outcome` 聚合改从 `post` 取 OHLC（聚合只需原始列） |
| `query.ts` / `router.ts` | 预览端点增 `prefix` 角色 |
| `shared/datasetRegistryContracts.ts` | `DatasetEventRow` 删 6 字段；增 `DatasetPrefixRow`；`DatasetTableRole` 增 `prefix` |
| `physicalTables.ts` | 清版本/删表逻辑覆盖新表（按 `physicalTables` 声明驱动，**无需硬编码**） |
| 前端 | 事件预览表删 6 列；新增 prefix 预览 Tab；`VersionDetail` 筛选口径卡片补「前置窗口」说明 |
| 验证脚本 | `verifyDataset003b.mts` 断言改写（负相对日从 `path` 改为 `prefix` 查） |

### 3.3 关键实现细节：`EventReference` 改道（S2 必读）

**问题根因：同一个类型承担了双重身份。**

`FirstLimitPullbackEvent` 目前同时扮演两个角色：

| 角色 | 用途 | 消费方 |
|---|---|---|
| ① **落库行** | 提供 `ds_*_event` 的列值 | `db.ts` upsert |
| ② **计算上下文** | 提供 `eventClose` / `eventHigh` / `eventVolume` 作为 path/outcome 的**参考基准** | `builder.ts:184` |

第 4 节的拆表只削掉了角色 ①，但角色 ② 目前也是从**同一个 `event` 行对象**上读行情字段拼出来的：

```ts
// builder.ts:184（现状）—— 依赖 event 行的行情列
const ref: EventReference = {
  eventClose: event.close ?? 0,
  eventHigh:  event.high ?? 0,
  eventVolume: event.volume,
};
```

**风险等级：编译期可见，不是运行时静默。** 删掉 `FirstLimitPullbackEvent` 的行情字段后，上述三行会立刻被 `tsc` 指出来 —— 这个坑不可能被漏掉。

**解法：把角色 ② 从行对象上剥离，改为从入参显式提取。**

关键事实：**D0 行情本来就已经在内存里**。`buildRelativeBarsFull`（`builder.ts:202`）产出的 `relativeBars` 中，`relativeDay = 0` 那一行就是完整的 D0 OHLCV（`builder.ts:222-232`）。因此**不需要任何 DB 往返** —— 文档早前版本写的「改从 `prefix(relativeDay=0)` 回读」是过度设计。

```ts
// path.ts —— 新增纯函数，与 prefix 行同源
export function eventReferenceFrom(bars: readonly RelativeBar[]): EventReference | null {
  const d0 = bars.find((b) => b.relativeDay === 0);
  if (!d0) return null;
  return { eventClose: d0.close, eventHigh: d0.high, eventVolume: d0.volume };
}

// builder.ts —— 改后
function buildEventPathsAndOutcomes(
  datasetVersionId: number,
  event: FirstLimitPullbackEvent,   // 只用 eventId / symbol 等身份字段
  relativeBars: readonly RelativeBar[],
  outcomeHorizons: readonly number[],
) {
  const ref = eventReferenceFrom(relativeBars);            // ← 唯一来源
  if (ref === null) return { paths: [], outcomes: [] };    // D0 无行情 → 事件不成立
  const paths = buildPathRows(datasetVersionId, event.eventId, event.symbol, relativeBars, ref);
  const outcomes = buildOutcomeRows(datasetVersionId, event.eventId, outcomeHorizons, relativeBars, ref);
  return { paths, outcomes };
}
```

调用点（`builder.ts:597`）与 `path.ts` 的 `buildPathRows` / `buildOutcomeRows` / `buildPathRow` 签名**都不用改**。

**三条硬约束：**

| # | 约束 | 理由 |
|---|---|---|
| **C1** | ref **必须**只从 `relativeBars` 取，**禁止**从 `DailyBar`（`bar` 变量）取 | **单源保证**：`prefix` 表的行就是从 `relativeBars` 过滤出来的，只有同源才能保证 `path.returnFromEventClose` 的基准**恒等于** `prefix.close`。从 `DailyBar` 取当前值虽相同，但引入第二条取数路径，将来 `prefix` 一旦加复权/富集加工即分裂 |
| **C2** | `EventReference.eventClose` / `eventHigh` 放宽为 **`number \| null`**，**禁止** `?? 0` 兜底 | 兜底值 `0` 会在 `ratioTo` 里被判为 `base === 0 → null`，语义"碰巧"正确但属魔数；类型显式化后"缺 D0 数据"成为可表达状态。连带 `firstBreakoutRelativeDay(bars, eventHigh)` 的 `eventHigh` 参数需同步放宽，并在 `null` 时短路返回 `null` |
| **C3** | D0 无行情时**跳过该事件**（不产出 path/outcome 行） | 现状是产出 `post` 条**全 NULL** 的 path 行 + 全 NULL outcome 行。D0 停牌/无数据时连涨停判定都不成立，产出空行既浪费存储又制造"看起来重复"的噪音。✅ **已实测为「零代价」防御性改动**：三个持久版本 `relativeDay = 0` 行的 `close`/`open`/`high`/`low`/`volume`/`amount` **100% 非 NULL**，孤儿事件（有 `event` 无 `rd=0` 行）为 **0**。采纳后**不减少任何现存行数**，仅在未来出现数据缺口时提供保护。**结论：采纳。** |

**列归属（一次定清，避免反复）：**

| 归属 | 列 | 说明 |
|---|---|---|
| **留 `event`**（身份） | `id` / `datasetVersionId` / `eventId` / `symbol` / `tradeDate` / `market` / `boardType` / `industryCode` / `isFirstLimit` / `previousLimitDate` / `daysSincePreviousLimit` / `historicalLimitCount` / `createdAt` | 与行情无关的标识与时点 |
| **留 `event`**（事件事实 / 时点属性） | `previousClose`（涨停判定依据）/ `limitUpPrice`（由 `previousClose` 派生）/ `marketCap` / `floatMarketCap` / `turnover` | **都不是日线行情**。`turnover` 来自 `liquidity?.turnover`（流动性富集）而非日线表，与 `marketCap` 同属 t 日富集属性 |
| **移入 `prefix`**（`rd ≤ 0`） | `open` / `high` / `low` / `close` / `volume` / `amount` | t 日及之前的原始日线 |
| **移入 `post`**（`rd ≥ 1`） | `open` / `high` / `low` / `close` / `volume` / `amount` | t 日之后的原始日线（与 `prefix` 同构） |
| **移入 `path`**（`rd ≥ 1`） | 全部 `*FromEventClose` / `volumeRatio` / `isBreakout` / `breakoutPrice` / `daysToBreakout` | 衍生指标（前视） |

> **`turnover` 归属已定：留 `event`**（见 §2.2.1）。它来自富集层（`liquidity_daily.turnoverRate`，实测 `event` 表 **96.83% 有值**）而非日线表，与 `marketCap` / `floatMarketCap` 同属 **t 日时点属性**。
> ⚠️ 注意 `path.turnover` 是**另一个东西**：它由 `buildRelativeBarsFull` **硬编码为 `null`**（213,536 行全空，属死列），改造时**直接删除**，不要下移。`prefix` / `post` 只承载**纯日线原始列**，避免把富集列混进特征窗口表。

### 3.4 影响面小结

- **低风险**：`ds_*_outcome` 结构不变（仅取数改从 `post`）；物理表操作层按插件 `physicalTables` 声明驱动，**天然覆盖新增的 `prefix`/`post`**。
- **中风险**：`event` 表字段减少会影响前端事件预览与 `listEvents` 契约（需同步）；`path` 预览需拆为「原始（`post`）/ 衍生（`path`）」两个 Tab。
- **已定（原「唯一待确认项」）**：§3.3 的 **C3** —— D0 无行情时跳过事件。实查证明当前**不存在此类事件**（`rd=0` 行数据 100% 完整、孤儿事件 0），故该条为**零代价防御**，**已采纳**。至此**无遗留待决策项**。
- **编译期自动兜底**：§3.3 的 `EventReference` 改道由 `tsc` 强制发现，不属"静默风险"。

### 3.5 实施顺序与状态（S1~S4 已实施）

| 阶段 | 内容 | 验证方式 | 状态 |
|---|---|---|---|
| **S1** | `naming.ts` 增 `prefix`/`post` role；`plugins.ts` 增两表 DDL；`dataset_definition` 增两列（migration `0030`） | `npx tsc --noEmit` + `plugins.test.ts` | ✅ 已实施 |
| **S2** | `types.ts` / `path.ts` 拆分（`eventReferenceFrom` + `buildRawBars` → `post`；`buildDerivedRows` → `path`）；`builder.ts` 按 **§3.3** 改道 `EventReference`（含 C1/C2/C3） | 单测：`path.test.ts` / `builder.test.ts` | ✅ 已实施 |
| **S3** | `db.ts` 增 `prefix`/`post` 读写；`query.ts` / `router.ts` / 契约 / 前端适配 | 目标套件全绿 + `npm run build` | ✅ 已实施（18 文件 / 268 tests 全过） |
| **S4** | `smoke` / `v1` / `v2` 收敛到五表结构 + 不变量 I1~I11 断言 | `scripts/verifyDatasetWindowLayering.mts` + `scripts/verifyDataset003b.mts` | ✅ **结构已收敛（就地迁移，零重建、零数据丢失）**；⏳ **P1 涨停口径重建仍未执行** |
| **S5** | 可选：建 `ds_{code}_path_wide` 宽视图；排查 P7 市值回填链路 | TiDB 视图性能实测 | ⏳ 未启动 |

> **S4 实施方式说明（与初稿的差异）**：初稿设想「DROP + 重建 + 数据重灌」。实际采用**就地迁移**（`scripts/applyDatasetWindowLayering.mts`）：
> 建 `prefix`/`post` → 把 `path` 的 `rd ≤ 0`（10,907 行）搬进 `prefix`、`rd ≥ 1`（202,629 行）复制进 `post` → 删 `path` 中 `rd ≤ 0` 行 → 摘掉 `path` 9 列 / `event` 6 列 → 回填定义表名 + 刷新 `totalRows`。
> **理由**：三版本共 213,536 行跨境重建成本极高（v2 单次构建 1381.6s），而本次拆分**不产生新信息**（`prefix` = 原 `path(rd≤0)`，`post` = 原 `path(rd≥1)` 的原始列投影），就地迁移可**零丢失、幂等、可 dry-run** 完成。
> **但请注意**：`prefix`/`post` 中的原始行情**仍是 P1 修复前口径**（涨停判定漏判 38.03% 导致事件集本身偏少）——**P1 重建仍必须执行**，届时直接用新构建覆盖即可（表结构已就位，无需再改 DDL）。

---

## 4. 已知问题与风险清单

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| **P1** | **涨停判定漏判 38.03%** —— 旧逻辑用未四舍五入的 `preClose×(1+ratio)` 比较，而交易所涨停价四舍五入到分。实测 4,325 个封板样本漏判 1,645 个 | 既有 `smoke`/`v1`/`v2` 样本数偏低，**须重建** | ✅ 代码已修复（`exchangeLimitUpPrice`），数据待重建 |
| **P2** | **跨表 t 日重复** —— `path(relativeDay=0)` 与 `event` 的 t 日行情重复（10,907 行） | 存储浪费 + 语义混淆 | ✅ **已消除**（2026-09-10 20:15 就地迁移：t 日行情唯一归属 `prefix`，`event` 6 个日线列已摘除；实测 `event=10,907` ≡ `prefix.rd=0=10,907`，I5 断言通过） |
| **P3** | **`securityId` 缺失** —— `liquidity_daily` / `industry_assignments` / `corporate_actions` 的 `securityId` 普遍为 NULL（`industry_assignments` 全 5,212 行为 NULL） | 违反身份铁律，跨域 JOIN 只能靠 `securityCode`，存在代码变更风险 | ⏳ 待回填 |
| **P4** | **`industry_assignments.effectiveFrom` 单点** —— 全为 `2026-08-31`，无历史轨迹 | 历史 asOf 行业查询只能近似，**严格 PIT 行业轨迹不可得** | ⏳ 需另寻历史源或声明为「当前快照口径」 |
| **P5** | **执行器终态非原子** —— `completeJob` → `markReady` 两次独立写库，实测窗口 0~840ms | 崩溃则版本永久卡 `BUILDING`（`COMPLETED` 不可 retry） | ⏳ 已上报，建议合并单事务 |
| **P6** | **双套数据集体系并存** —— L3 Registry（物理表）与 `research_datasets`（内容指纹 JSON 快照）并存 | 认知负担 + 部分路径未收敛 | ⏳ 已知，legacy 路径待收敛 |
| **P7** | **上游市值数据从未落库** —— `liquidity_daily.circulationMarketCap` / `totalMarketCap` **全 9,015,158 行为 NULL**；下游 `ds_*_event.marketCap` / `floatMarketCap` 因此全 10,907 行为 NULL（死列） | **任何依赖市值/流通盘的特征与筛选均不可用**（如小盘股过滤、市值分层）；`turnoverRate` 正常（99.14%）说明是该两列的回填缺失而非整域失败 | ⏳ **待修复**（需查 BaoStock 回填链路为何未写市值列） |
| **P8** | **`path` 表列级冗余** —— `returnFromEventClose` ≡ `closeFromEventClose`（213,536/213,536 行相同）、`lowFromEventClose` ≡ `pullbackFromEventClose`（213,536/213,536 行相同）、`turnover` 全 NULL、`breakoutPrice`/`daysToBreakout` 为每行重复常数 | 名义 24 列实际仅 **19 个不同的量**；是「数据看起来很重复」的真实来源；浪费存储与认知 | ✅ **已消除（部分）**：2 对重复列 + `turnover` 死列 + 6 个原始行情列**已随 2026-09-10 20:15 就地迁移摘除**（`path` 24 → **15 列**）；`breakoutPrice`/`daysToBreakout` 两个每行重复常数**按用户决定保留**（更合理位置是 `event`，本次未迁移） |

---

## 附录 A：目标结构完整 DDL（S1 可直接执行）

> 与 §2.2 字段级设计严格一一对应；风格与 `server/datasetRegistry/plugins.ts` 现有生成器一致（`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`）。
> 表名为模板 `ds_{datasetCode}_{role}`，下表以 `ds_first_limit_pullback_*` 为例。
> **DDL 必须自包含**（内联列定义）—— 禁用 `CREATE TABLE ... LIKE 模板表`，否则删表后无法重建（这是 DATASET-003A 的硬约束）。

### A.1 `ds_{code}_event`（18 列，由 24 列删去 6 个日线列）

```sql
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_event` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `datasetVersionId` bigint NOT NULL,
  `eventId` varchar(64) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `tradeDate` date NOT NULL,
  `market` varchar(16) DEFAULT NULL,
  `industryCode` varchar(32) DEFAULT NULL,
  `boardType` varchar(32) DEFAULT NULL,
  `previousClose` double DEFAULT NULL,      -- 涨停判定依据，不可下移（preWindowDays=0 时 prefix 无 rd=-1 行）
  `limitUpPrice` double DEFAULT NULL,       -- exchangeLimitUpPrice(previousClose, ratio)，四舍五入到分
  `turnover` double DEFAULT NULL,           -- 流动性富集（liquidity_daily.turnoverRate），非日线列
  `isFirstLimit` tinyint(1) DEFAULT NULL,
  `previousLimitDate` date DEFAULT NULL,
  `daysSincePreviousLimit` int DEFAULT NULL,
  `historicalLimitCount` int DEFAULT NULL,
  `marketCap` double DEFAULT NULL,          -- ⚠️ 上游缺失，见 P7
  `floatMarketCap` double DEFAULT NULL,     -- ⚠️ 上游缺失，见 P7
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_version_event` (`datasetVersionId`,`eventId`),
  KEY `idx_event_version_date` (`datasetVersionId`,`tradeDate`),
  KEY `idx_event_symbol_date` (`symbol`,`tradeDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

**删除的 6 个列**：`open` / `high` / `low` / `close` / `volume` / `amount`（全部下移到 `prefix` 的 `rd=0` 行）。

### A.2 `ds_{code}_prefix`（13 列，t 日及之前原始行情）— 🆕 新增

```sql
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_prefix` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `datasetVersionId` bigint NOT NULL,
  `eventId` varchar(64) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `tradeDate` date NOT NULL,
  `relativeDay` int NOT NULL,               -- ∈ [-preWindowDays, 0]，0 = t 日（D0）
  `open` double DEFAULT NULL,
  `high` double DEFAULT NULL,
  `low` double DEFAULT NULL,
  `close` double DEFAULT NULL,
  `volume` double DEFAULT NULL,
  `amount` double DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prefix_version_event_day` (`datasetVersionId`,`eventId`,`relativeDay`),
  KEY `idx_prefix_event_day` (`eventId`,`relativeDay`),
  KEY `idx_prefix_symbol_date` (`symbol`,`tradeDate`),
  KEY `idx_prefix_version_day` (`datasetVersionId`,`relativeDay`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

> **不变量 I8**：本表**禁止**出现任何 `*FromEventClose` / `isBreakout` 列 —— 前视指标一律不进特征窗口（结构级 PIT 防线）。

### A.3 `ds_{code}_post`（13 列，t 日之后原始行情）— 🆕 新增

**与 `prefix` 严格同构**（可由同一段 DDL 生成器参数化产出，代码零重复），仅 `relativeDay` 区间与索引前缀不同：

```sql
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_post` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `datasetVersionId` bigint NOT NULL,
  `eventId` varchar(64) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `tradeDate` date NOT NULL,
  `relativeDay` int NOT NULL,               -- ∈ [1, postWindowDays]
  `open` double DEFAULT NULL,
  `high` double DEFAULT NULL,
  `low` double DEFAULT NULL,
  `close` double DEFAULT NULL,
  `volume` double DEFAULT NULL,
  `amount` double DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_post_version_event_day` (`datasetVersionId`,`eventId`,`relativeDay`),
  KEY `idx_post_event_day` (`eventId`,`relativeDay`),
  KEY `idx_post_symbol_date` (`symbol`,`tradeDate`),
  KEY `idx_post_version_day` (`datasetVersionId`,`relativeDay`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

### A.4 `ds_{code}_path`（15 列，仅衍生指标；原 24 列 → 删 9 列）

```sql
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_path` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `datasetVersionId` bigint NOT NULL,
  `eventId` varchar(64) NOT NULL,
  `symbol` varchar(32) NOT NULL,
  `tradeDate` date NOT NULL,
  `relativeDay` int NOT NULL,               -- ∈ [1, postWindowDays]（不再含 0 与负值）
  `highFromEventClose` double DEFAULT NULL,
  `lowFromEventClose` double DEFAULT NULL,
  `closeFromEventClose` double DEFAULT NULL, -- 等价于旧 returnFromEventClose（已删重复列）
  `pullbackFromEventHigh` double DEFAULT NULL,
  `volumeRatio` double DEFAULT NULL,
  `isBreakout` tinyint(1) DEFAULT NULL,
  `breakoutPrice` double DEFAULT NULL,       -- ⚠️ 事件级常数（更合理位置是 event，见 §2.2.4 遗留项）
  `daysToBreakout` int DEFAULT NULL,         -- ⚠️ 同上
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_path_version_event_day` (`datasetVersionId`,`eventId`,`relativeDay`),
  KEY `idx_path_event_day` (`eventId`,`relativeDay`),
  KEY `idx_path_symbol_date` (`symbol`,`tradeDate`),
  KEY `idx_path_version_day` (`datasetVersionId`,`relativeDay`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

**删除的 9 个列**：`open` / `high` / `low` / `close` / `volume` / `amount`（→ `post`）、`turnover`（死列）、`returnFromEventClose`（≡ `closeFromEventClose`）、`pullbackFromEventClose`（≡ `lowFromEventClose`）。

### A.5 `ds_{code}_outcome`（10 列，结构不变，仅取数改从 `post`）

```sql
CREATE TABLE IF NOT EXISTS `ds_first_limit_pullback_outcome` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `datasetVersionId` bigint NOT NULL,
  `eventId` varchar(64) NOT NULL,
  `horizon` int NOT NULL,
  `maxReturn` double DEFAULT NULL,
  `minReturn` double DEFAULT NULL,
  `maxDrawdown` double DEFAULT NULL,
  `isBreakout` tinyint(1) DEFAULT NULL,
  `daysToBreakout` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outcome_version_event_horizon` (`datasetVersionId`,`eventId`,`horizon`),
  KEY `idx_outcome_event_horizon` (`eventId`,`horizon`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

### A.6 `dataset_definition` 增列（migration `0030`）

```sql
ALTER TABLE `dataset_definition`
  ADD COLUMN `prefixTableName` varchar(128) DEFAULT NULL AFTER `pathTableName`,
  ADD COLUMN `postTableName`   varchar(128) DEFAULT NULL AFTER `prefixTableName`;
```

> `DatasetRole` 枚举同步增 `prefix` / `post`（见 `server/datasetRegistry/naming.ts`）；物理表操作层按插件 `physicalTables` 声明驱动，**天然覆盖新表、无需硬编码**。

### A.7 列数对照速查

| 表 | 现状列数 | 目标列数 | 变化 |
|---|---|---|---|
| `event` | 24 | **18** | −6（日线列下移） |
| `prefix` | — | **13** | 🆕 |
| `post` | — | **13** | 🆕 |
| `path` | 24 | **15** | −9（6 下移 + 1 死列 + 2 重复列） |
| `outcome` | 10 | **10** | 0 |
| **合计** | **58** | **69** | +11 |

## 附录 B：表数量变更记录

| 时间 | 表数 | 变更 |
|---|---|---|
| 2026-09-10 18:40 | **39** | 实查基线（含 `dataset_build_config` 三表 + `ds_*` 三表） |
| 2026-09-10 19:00 | 39 | 目标设计**定稿**（五表三层血缘），**尚未实施** |
| （实施后） | **41** | 采纳五表方案后 +2（每数据集 `prefix` + `post` 表） |
