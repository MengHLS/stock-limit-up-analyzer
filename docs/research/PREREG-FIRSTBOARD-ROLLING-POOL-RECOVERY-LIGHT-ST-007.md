# PREREG · `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` 预注册（结果可见前冻结）

> 执行对象：[`GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`](GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md)
> 数据决定：[`DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md`](DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md)（含 007 轻量 ST 政策确认）
> 上游冻结：`GOAL/PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md`（价格规则 / 账户 / 统计口径逐字沿用）
> 数据就绪：`RESULT/IMPACT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`（**只取结论，不重做**）
> 基线：HEAD **`f8b6810`**；工作区 **227 项 = 41 tracked-modified + 186 untracked**（并发会话，**未触碰**）
>
> 🔴 **本文件在**任何**收益矩阵结果可见之前落盘。** 冻结后不得因结果方向修改判据、阈值、分母、seed、窗口或分组。
> 🔴 **本轮性质 = `EXPLORATORY / KNOWN_ST_ONLY`**。参数缺省仍是原严格政策；本轮的 UNKNOWN 放行是**用户明确授权的资格政策变体**，
> **不是严格 PIT 研究**，不得被表述为 PIT / OOS / 模拟交易 / 实盘验证。

---

## 0. 本轮改了什么、没改什么（一句话）

| | |
|---|---|
| **改** | ST **资格政策**（新增显式政策 `KNOWN_ST_ONLY_EXPLORATORY` / `recovery-known-st-only/1.0.0`，缺省仍为严格）＋ 为放行 UNKNOWN 所需的**最小执行契约兼容**（可选声明，缺省 `REJECT`）＋ 测试、SMOKE、STUDY、报告。 |
| **不改** | 价格买点（A/B）、`preReturn10` 排序、Top3 与破平键、随机实现与种子、再入场、当日权益 20% 仓位、成本、冻结 Runner 退出（`3600005` / T74）、`evaluateStGate` 严格契约 `1.1.0`、Dataset `780004`。 |

---

## 1. 基线指纹（冻结）

| 项 | 值 |
|---|---|
| HEAD | **`f8b6810347aa5950d1f9b95eaadc73308b68ac21`**（`f8b6810`） |
| 工作区 | 227 项 = 41 tracked-modified + 186 untracked（含并发会话）；本轮**不触碰** |
| Dataset | **`datasetVersionId = 780004`** / `first_limit_pullback` / `v10-listed365-pre10-post80` / READY |
| 构建配置 | `dataset_build_config.id = 510004`：`excludeSt=1`、`excludeListedWithinDays=365`、`preWindowDays=10`、`postWindowDays=80`、`outcomeHorizons=[5,10,20]`、`board=main`、事件 `relativeDay=0 / firstBoard` |
| 策略版本 | `strategy_versions.id = 3600005`，`2.0.0`，指纹 **`f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c`** |
| 冻结退出政策 | `server/researchExperiments/frozenRunnerExitPolicy.ts#loadFrozenRunnerPolicyBundle` |
| 主入场窗口 | **2024-01-02 ~ 2025-09-30**（已见探索窗口，**不是 OOS**） |
| ST 闸门严格契约 | `ST_GATE_CONTRACT_VERSION = "1.1.0"`（**本轮不变**） |
| 原严格执行资格政策 | `recovery-st-execution-eligibility/1.0.0`（**本轮不变，仍是缺省**） |
| 本轮新政策 | `KNOWN_ST_ONLY_EXPLORATORY` / **`recovery-known-st-only/1.0.0`**（探索性，非严格 PIT） |
| 代码指纹 | 运行时由平台记录（`experimentCodeDigest`）；SMOKE 与 STUDY 各自记录并分别声明 |

---

## 2. 冻结矩阵（与 004 逐字相同）

| 组 | 观察/买点 | 最晚成交 | 账户 |
|---|---|---:|---|
| **A `A_STRICT_20`** | 003 的 D：全程守首板支撑，N=5 逐日各 ≥3 分，突破确认；**首次可靠破位后永久停买** | T+20（确认日 ≤ rd19） | R + 20 Random |
| **B `B_RECOVERY_20`** | 未破位分支**与 A 完全相同**；破位后改走五日综合修复分支（局部低点 `F`、`W=[d−5,d−1]`、`ΣQ_j ≥ 15/20`、确认日突破放量） | T+20 | R + 20 Random |

- **账户数**：`STUDY = 2 × (1 + 20) = 42`；`SMOKE = 2 × (1 + 2) = 6`。
- 随机种子固定 **`20261010 + i, i = 0..19`**；两组同 `i` 同 seed；**沿用原随机实现**（不修改）。
- Random 抽样：**当日相同合法候选宇宙、相同选中人数 Top3、均匀无放回**。
- 排序：`preReturn10` 降序 → `symbol` 升序 → `anchorEventId` 升序，Top3；观察分（`ΣQ_j`）**不参与排序**。
- 账户：初始 100,000 / 最多持仓 5 / 每日最多新买 2 / 每笔预算 = **决策日收盘当前总权益 × 20%**（受现金与整手约束）。
- 退出：`strategy_versions.id = 3600005`（指纹见 §1），成本、退出与再入场记账**逐字沿用**。
- 停止规则：`SMOKE` 只验工程正确（**不做收益筛选**）；工程闸门通过后 `STUDY` **无论方向好坏完整执行一次**；
  **收益差不是继续 STUDY 的判断条件**；不挑种子、不重调分数/窗口、不扩跑 200 账户。

---

## 3. 轻量 ST 资格政策（本轮唯一的口径变化，冻结）

### 3.1 政策标识与缺省

| 项 | 值 |
|---|---|
| 政策 id | **`KNOWN_ST_ONLY_EXPLORATORY`** |
| 政策版本 | **`recovery-known-st-only/1.0.0`** |
| 缺省 | **原严格政策**（`recovery-st-execution-eligibility/1.0.0`；只认可核验 `NORMAL`） |
| 实验参数 | 新增 `stPolicy`（`ENUM`，`required=false`，`defaultValue="strict"`，允许值 `["strict","known-st-only"]`） |
| 运行工具 | `tests/tools/rollingPoolRecoveryStRun.mts --st-policy <strict\|known-st-only>`；**参数非法即拒绝启动** |
| 声明 | 政策 id / 版本 / 来源指纹 / 记录覆盖 / 已知局限全部写入 frozen-config 与结果 |

### 3.2 行为表（**逐字实现**）

| 读取结果 | 确认日收盘 | 真实买入前 | 审计状态 |
|---|---|---|---|
| 已有历史记录明确标记该时点为 ST / \*ST | **不进入排序候选** | **拒单** | `ST`（保留来源、生效区间、证据指纹） |
| 有明确正常记录 | 可以参与 | 可以执行 | `NORMAL` |
| 无记录、身份无法解析或证据不能判断 | 可以参与 | 可以执行 | **`UNKNOWN`，且注明"本轮允许未知"** |

### 3.3 来源与解读边界（冻结）

- **来源**：`research_security_status_history` 的 **ST 维度**，**运行期一次性读取**，连同所需证券身份映射，
  **经既有运行端口/桥接注入研究层**；**实验作者函数不直接 SQL**。
- **身份**：用**有效区间**与**该日期对应的证券身份**判定（复用仓内唯一 PIT 身份解析实现）。
  **不用今天的名称判断历史**；**不用行情涨跌停字段冒充 ST 状态**。
- **BaoStock 合并 ST 区间**可作为本轮"历史标签排查"依据；**不升级为严格 PIT 证据**，
  **不伪造 `availableAsOf`**，**不修改 `availability` / `confidence`**，**不把缺席派生成 `NORMAL`**。
- **边界 / 重叠无法判断 ⇒ `UNKNOWN`**，并按用户选择**放行**。
- 上表的身份缺口指 **ST 来源映射**缺口；**真正的交易证券身份、价格与订单坐标仍须满足原执行约束**。
  **不得凭空生成 `securityId`**，**不得把交易身份无法解析视为可成交**（该候选照旧被丢弃并如实计数）。
- 期望的形状（本轮实测前的事前声明）：平台 ST 维度**只有 ST 片段、没有 NORMAL 行**
  ⇒ 绝大多数时点将是 `UNKNOWN`；`NORMAL` 分支为**结构上可用但本轮可能为空**的分支（不得用缺席补 NORMAL）。

### 3.4 时点分离（冻结）

- **确认日 15:00**（`CONFIRM_CLOSE_ELIGIBILITY`）只决定**当日**资格（谁进候选池 / Top3 / Random 抽样）。
- **成交日 09:15**（`PRE_FILL`）按**当日已有历史状态**复查；隔夜转 ST **取消订单**。
- **次日状态不得反向影响前日排名**；不使用次日事实递补第 4 名。
- **首次、重试、再次入场、R 与 Random 全部走同一政策**。
- ST 拒单必须发生在**扣现金、成本、建仓与成功入场计数之前**。
- 已持仓后成为 ST ⇒ **不新增买入**；退出继续原规则。

### 3.5 最小执行契约兼容（本轮唯一 `server/**` 改动，冻结）

当前 `runTradeSimulation` 即使 `allowed=true` 也拒绝 `status=UNKNOWN`，且收尾断言要求 `FILLED ⇒ NORMAL`。因此：

| 项 | 冻结语义 |
|---|---|
| 新可选声明 | `SimulationConfig.executionEligibilityUnknownPolicy?: "REJECT" \| "ALLOW_WHEN_DECISION_ALLOWS"`，**缺省 = `REJECT`** |
| 放行条件 | 仅当**显式声明** `ALLOW_WHEN_DECISION_ALLOWS` **且** `decision.allowed === true` **且** `status === "UNKNOWN"` 才放行 |
| ST | **始终拒绝**，即使闸门错误地返回 `allowed=true`（与既有失败关闭一致） |
| 其它 status | 一律拒绝（闭集） |
| 审计 | 逐笔审计**保留真实 `UNKNOWN`**，**不改写为 `NORMAL`** |
| 收尾断言 | `FILLED ⇒ status ∈ {NORMAL} ∪ (声明放行时的 {UNKNOWN})`；违反即整轮抛错 |
| 校验 | 配置形状与「声明了 unknown 政策却没声明闸门」⇒ 响亮失败 |
| 快照 | **仅在显式声明时**多出 `executionEligibility.unknownPolicy` 键 ⇒ 未声明的既有记录与指纹**逐字节不变** |
| 禁用 | ❌ 把 UNKNOWN 改写成 NORMAL ❌ 移除整个执行闸门 ❌ 另开第二条模拟器路径 |

`evaluateStGate` 的严格契约 **1.1.0 保持不变**；轻量政策是**另一个有版本的资格决策**。
价格状态求值**不受 ST 政策驱动**，**不因 ST/UNKNOWN 抹掉观察历史**。

### 3.6 轻量模式**不**继承的严格前置条件（冻结）

- **不**使用 `stSummary.blocked` 作为前置条件；
- **不**要求 `providerVerifiable`；**不**把严格 provider 的 `verifiable` 伪造为 `true`；
- 缺状态**不再暂停全部账户**；
- null-provider 的**早诊断**只保留在**原严格模式**（`stPolicy=strict`，缺省）；
- 轻量模式使用**真实载入的历史标签索引**，即使部分或全部查不到也**如实记 `UNKNOWN`**。
- 旧终态 `ST_COVERAGE_BLOCKED` **不是**轻量模式的必然终点。

### 3.7 ST 排查取样范围（冻结，不扩表）

只需覆盖下列五类，用少量真实记录 + 合成样例锁定：

1. 区间内**已知 ST**；2. 区间外 `UNKNOWN`；3. **无记录** `UNKNOWN`；
4. 确认日非 ST、**成交日已知 ST**；5. **平仓后再入场遇 ST**。

🔴 **不**再生成 50 万格清单、**不**采购数据、**不**补 22,041 格、**不**把缺口比例作为本轮开跑门槛。

---

## 4. 靶指标、统计与判定（沿用 004 §6，逐字）

### 4.1 主比较

**`B_R − A_R`** —— 共同可核实锚点宇宙上，「至少一笔已完成净收益 ≥ +20% 的**唯一锚点数覆盖率**」之差。
分母 = **两组共有且数据资格可核实的锚点宇宙**（**不是**各组成交数），**披露**全部数据缺口与 ST 排除，**不按事后盈利改分母**。

### 4.2 同时报告

实际成交 ≥+20 / 50 / 100% 尾率、唯一股票命中数、单笔净均值、锚点整链净损益（扣全部试错成本）、
账户复合收益 / MDD / 期末现金占比、资金与容量、交易次数、持有期、前 3 / 5 交易日不利波动；
新增买点与原买点分开画像。

### 4.3 统计

固定 **1000 次配对日期块 bootstrap**；`block20` 主 / `block40` 敏感性；**95% 双侧**；
覆盖指标按共同锚点**首次进入观察池的日期**聚类；双臂**同日历、同抽样索引、空日保留**；
交易/整链指标另按入场日期键聚类，**两者不混用**；逐年报告同靶（2024 / 2025 = 已见探索窗口）。

### 4.4 事前判定规则（**不因结果改阈值**）

只有**同时**满足：① 两组各 **≥ 50 个独立 ≥+20% 唯一命中锚点**；② 主/敏感性区间**下界 > 0**；
③ **逐年同向**；④ 账户收益与风险**未显示相反取舍** —— 才可列为「待未见样本验证的候选」。
否则 ⇒ **`INSUFFICIENT_EVIDENCE`**。**样本量不足不靠随机账户数补足**。

🔴 **即使原主靶判据满足，本轮结论也只能是探索性的**，因为本轮**接受了 UNKNOWN**、
使用**历史（非 PIT）标签**并受**旧 Dataset 局限**约束。

### 4.5 终态（§8，四选一，**必须恰好一个**）

`EXPLORATORY_COMPLETED`（42 账户 + 统计完成） / `SMOKE_ENGINEERING_FAILED` / `DATA_LIMITED` / `EXECUTION_FAILED`。

**停止条件**（有限枚举）：实际工程失败、非法资金/仓位、**已知 ST 买入**、冻结价格/排序/退出漂移、
真实执行数据无法支持指标。
🔴 **未知 ST 状态本身不是停止条件** —— 那是用户已确认的本轮政策。

**`DATA_LIMITED` 的事前定义**（避免事后辩解）：仅当**实际缺数据使退出、估值或指标无法完整计算**时标记
（例如账户权益曲线为空、`canonicalMetrics` 给出 `NOT_AVAILABLE`、或必要执行 bar 缺失导致无法完成撮合）。
**未平仓 / 尾部截断 / 延长持有暴露本身不等于 `DATA_LIMITED`**（按 §6 单列为观测，不自动阻断、
**不静默强平、不补最后价、不删样本**）。是否重建 Dataset **不由执行方决定**。

---

## 5. 产物与交付

- `docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`（本文件，**收益可见前落盘**）
- `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007.md`
- 新 Run ID、实际可运行命令、config/source 指纹、测试、性能、A/B/R/Random 矩阵、既有研究产物
- 架构：`CHANGE-AUDIT.md` + （新增执行配置契约/入口）`CONTRACT-MAP.md` / `EXECUTION-FLOW.md` /
  `SYSTEM-BASELINE.md` / `system-manifest.yaml`，版本接续真实基线（`v2.8.0` → `v2.9.0`），**不覆盖并发文档**
- **不重复生成** 006 的来源审计
- 新 Run 与产物写入**新输出目录**（`_scratch/fbp7/`）；**不覆盖** `_scratch/fbp4` 历史交付
- 允许：标准研究 Run 的应用层写入（`startRun` / `artifactStorage`）
- **不授权**：直接 SQL 回填历史、批量写生产状态、DDL / migration、新 Dataset 构建

---

## 6. 事前登记的解释局限（不是事后辩解）

1. **不是严格 PIT**：历史标签的 `availability` 全 `UNKNOWN`、`retrievedAt` 全在窗口后约一年
   ⇒ 严格 PIT 下**可核验结论 = 0**。本轮是**用户授权的政策变体**，结论**不得**升级为 PIT / OOS / 实盘。
2. **absence ≠ NORMAL**：平台 ST 维度**没有 NORMAL 行**，因此本轮几乎所有时点都是 `UNKNOWN`。
   `UNKNOWN` 放行意味着**"未发现 ST 记录"被当作可参与**，这与"当日确实非 ST"**不是**同一命题。
3. **执行面字段与状态事实互相矛盾**（006 实测：973 个「平台 ST 区间生效」格里 `limitRuleUp` 全 `0.1`、
   `canBuyAtOpen=1`）⇒ Dataset 的涨跌停派生列**不可用作 ST 证据**；本轮 ST 判定**只**用历史标签索引。
4. **A/B 是机制级对照**（同时改变局部支撑与观察聚合），**不能**称为「仅取消永久排除」的单因素效应。
5. **随机 20 个 seed 不是 20 份独立市场样本**，只能作粗略分布描述。
6. **Runner 贡献不可观测则明确未测**。

---

## 7. 边界（本轮不做）

- ❌ 不改 `evaluateStGate` 严格契约 1.1.0；不改价格规则、排序、随机、仓位、成本、退出；
- ❌ 不改 builder / `poolStIndex`；不新增因子；不重构其它领域；不新建第二套策略或撮合实现；
- ❌ 不重建 Dataset、不补 ST 全表、不采购、不新增外部数据源、不重复 006 全量来源审计；
- ❌ 不跑 `pnpm run format`；不 reset/stash/commit/overwrite 并发工作区改动；
- ❌ 不在收益可见后改判据、阈值、分母、seed、窗口或分组。
