# PREREG · 首板滚动池**真实排序修复**与无损压缩交付（008 纠错轮）

预注册标识：`FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008`。
目标文件：[`GOAL-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md`](GOAL-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)。
建立时间：2026-10-11（**在**本轮任何新 Run 之前）。
来源 Run（**不重跑、不回填、不覆盖**）：`RUN-20261011-2BAEF26C`。

---

## 0. 🔴 本轮性质：**已见数据上的实现纠错**，不是新因子检验

本轮**不**声称结果未被看过。相反：

- 007 已经把 A/B 的真实账户收益（`+2.8237%` / `−25.8124%`）算出来并读过了；
- 007 的归因已经指出：**R 账户实际按股票代码升序取前三名**，报告口径却声明按 `preReturn10` 降序；
- 本轮要做的是**让实现回到已经声明的口径**，然后在新 `codeDigest` 下重跑一次 6 账户 SMOKE 与一次
  42 账户 STUDY，如实报告纠错后的数值（无论盈亏）。

因此本轮的结论等级是 **`ALREADY-SEEN-DATA CORRECTION`**：

- **不是**未见样本 / OOS / 前瞻验证；
- **不是**新发现的因子效果；
- **不**因结果好坏调整任何冻结项；
- 报告的收益变化只能解释为「实现纠错造成的差异」，**不能**当作多轮参数择优。

---

## 1. 已确认的缺陷（代码级，非推测）

| # | 位置（路径 + 符号） | 事实 |
|---|---|---|
| D1 | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` · `run()` 内 `sortCandidates(candidateRows);` | **返回值被丢弃**（纯函数返回新数组）⇒ 等于没有排序 |
| D2 | 同文件 · `intentsOf(...)` 的 R 分支 `(cells) => cells.slice(0, DAILY_TOP_K)` | 从**未排序**的当日 cells 直接取前 3 ⇒ 实际入选的是 `buildDailyPool` 的**代码升序**前 3 名 |
| D3 | `research-experiments/shared/rollingPoolRightTail/projection.ts#buildDailyPool` | `dailyRows` 按 `symbol` **升序**产出（该行为**本轮不改**） |
| D4 | 同文件 · 候选排名诊断产物内 `selectedByR: index + 1 <= DAILY_TOP_K` | 诊断**另排一次** `preReturn10`，与真实计划脱节 |

**007 的实测后果**（`RESULT-…-LOSS-ATTRIBUTION-007` §3）：

| 逐笔复核 | A | B |
|---|---:|---:|
| 实际 R 成交 | 144 | 235 |
| 当日**因子**排名 >3 的成交 | 6 | 32 |
| 当日**代码**排序排名 >3 的成交 | **0** | **0** |

379 笔成交全部符合**代码** Top3 ⇒ B 的 `−25.8124%` 与 A 的 `+2.8237%` 属于
**代码顺序优先的旧实现**，**不得**称为已验证的因子排序收益。

---

## 2. 本轮**唯一**授权的变更

1. **恢复既有声明的因子排序**：在 R 的每日候选选择入口消费 `sortCandidates` 的返回值再取 Top3。
2. **纠正诊断记录**：候选排名 / `selectedByR` / 计划集合由**同一个**选择结果产生。
3. **无损压缩交付**：在本实验的**产物打包层**对 ≥1 MiB 的 CSV 做 gzip（level 1），
   经既有 `context.artifact` / ArtifactStorage 交付 `.csv.gz`；**不**提高平台上限、**不**新增全局自动压缩。
4. **必要读取兼容**：交付索引 + 分析工具/消费者**按编码**读回。

---

## 3. 冻结项（**全部保持原值**；任一漂移即触发停止规则）

| 项 | 冻结值 |
|---|---|
| Dataset | `datasetVersionId=780004`（`first_limit_pullback` / `v10-listed365-pre10-post80`）；不重建、不回填 |
| 主决策窗口 | 2024-01-02 至 2025-09-30（执行尾窗按现有实现） |
| A 组 | `A_STRICT_20`：N=5、T+20、支撑破位后**永久停买**的比较基准 |
| B 组 | `B_RECOVERY_20`：未破位同 A；破位后原局部低点修复窗口、`ΣQ_j ≥ 15/20`、突破与量能确认不变 |
| 成交上界 | 最晚 T+20；确认上界 T+19；确认后次日计划入场；**不新增固定买入日** |
| 排序口径 | **可参与的当日信号候选中**：`preReturn10` 降序 → symbol 升序 → anchorEventId 升序；Top3 |
| 排序角色 | 因子**只排序**，不生成买点、不新增阈值筛选、不反向使用未来收益 |
| 初始资金 / 仓位 | 100,000 元；**当日总权益的 20%**；最多 5 持仓、每日最多 2 次买入；100 股整手 |
| 退出 | 冻结策略 `3600005 / 2.0.0 / T74` 的既有装配与参数；**不改 StrategyVersion** |
| 再入场 | 原有完全平仓后再次触发可入场的规则；不改次数 / 冷却 / 同时持仓约束 |
| 成本与撮合 | 原值不变；复用 Strategy Core / 权威装配 / `runTradeSimulation`；**不另写回测引擎** |
| ST | 显式 `KNOWN_ST_ONLY_EXPLORATORY`（`--st-policy known-st-only`）；仅排除已有记录中的 ST；UNKNOWN 可参与且原样留档；**严格缺省不改** |
| SMOKE | 每组 R + 2 Random = **6 账户** |
| STUDY | 每组 R + 20 Random = **42 账户**；原 20 种子（`20261010 + i`，i=0..19）与两组配对方式不变 |
| 统计 | 原主靶（`B_R − A_R` 共同宇宙 ≥+20% 唯一锚点覆盖率差）、block20/block40、种子 20261010/20261011、1000 次、样本门槛、逐年分层**均不变**；**不降低**右尾 50 命中门槛 |
| 平台上限 | 单件 **64 MiB** / 总量 **256 MiB** / **100** 件 —— **本轮不放宽、不重声明** |

**默认参数仍是严格 ST 政策**；真实执行必须显式传 `--st-policy known-st-only`。

---

## 4. 版本与身份（"不能只改展示标签"）

| 项 | 本轮处置 | 理由 |
|---|---|---|
| 实验 `codeDigest` | **必然改变**（`computeExperimentCodeDigest` 覆盖 `descriptor` + `run.toString()` + `resultSchema`，`run` 体已被改动）⇒ 新 Run 与 007 的 Run 在执行身份上可区分 | 这正是 codeDigest 的既有用途：作者不升版本时仍能证明「注册到 Runner 的执行体不同」 |
| 实验计算版本文称 `RECOVERY_COMPUTATION_VERSION` / `descriptor.version` | **不递增**（保持 `1.0.0`） | 排序口径**本来就已经声明**为 `preReturn10` 降序；本轮是让实现回到该声明，**没有**改变任何口径常量。且 `result.ts` 的 `computationVersion` 是 `z.literal(...)`，递增会让**历史 Run 的 payload 不再通过该 schema**，与「旧 Run 保持不变、仍可读」冲突 |
| 旧 StrategyVersion | **不变**（`strategy_versions.id=3600005 / 2.0.0`） | 本轮不碰策略语义 |
| 旧报告 / 旧 Run / 旧产物 | **不改、不覆盖**（`_scratch/fbp7/` 原样保留；本轮输出写到 `_scratch/fbp8/`） | 需要保留纠错前后对照 |

若后续审计认为必须有独立的口径版本号，应**另立**一个不影响历史 payload 解析的机制，不在本轮临时发明。

---

## 5. 新增/修改的产物与口径

| 产物 | 变更 |
|---|---|
| `candidate-ranking-diagnostics-{group}.csv` | **新增列**：`participantCountThatDay`（参与候选数 = 因子名次真实分母）、`identityResolved`、`participatesInRanking`、`exclusionReason`、`rPlanOrder`（真实计划顺序）、`rFillDate` / `rFillEvidenceRef` / `rNotFilledReason` / `rNotFilledEvidenceRef`、`sortingSource`。`poolSizeThatDay` 语义 = 原始价格信号账当日**全部行数**；**未参与者** `rankByPreReturn10` **留空**（不与参与名次混同） |
| `artifact-compression-index.csv` | **新增**：逻辑名 → 实际对象名、编码（`identity`/`gzip`）、原文/交付体积、**原文 SHA-256**、行数。本表自身不压缩、不列自身；未列出的名字按「对象名 = 逻辑名」解析 |
| ≥1 MiB 的 CSV | 交付名追加 `.gz`，`contentType = application/gzip`，body 为**真二进制**；**行/列/顺序/数值/证据全部保留**（不采样、不删未触发观察日、不截断年份、不筛赢家） |
| 结果摘要 / 小表 | 仍直接可读（< 1 MiB ⇒ 原文交付） |

---

## 6. 停止规则（§8；命中即停止正式收益解释并报告具体证据）

- 任一**已知 ST 成交**；
- 任一**实际排序越界选择**（成交股票不在对应确认日的实际 Top3）；
- **未来信息回流**（次日事实影响前日排名 / 资格）；
- **样本账不平**（事件扫描 / 资格 / 排除原因加总不一致）；
- **真实发布超限**（件数 / 单件 / 总量，或 gzip 解压哈希不一致 / manifest 不可读）；
- **冻结参数漂移**（买点、期限、因子方向、仓位、成本、退出、种子、Dataset、ST 政策）；
- 排序修复后若**同池同种子的 Random 业务结果发生变化** ⇒ 先查输入顺序与共享状态，**不静默接受**。

另外（目标 §8）：**不**改买点 / 期限 / 因子方向 / 仓位 / 退出来改善结果；**不**扩随机种子；
**不**做第二套策略；**不**触碰历史 Run。正式 42 账户本轮**最多一次**。

---

## 7. 验收与预注册的工程门

| 门 | 判据 |
|---|---|
| Gate A | `pnpm run check` 0 错；本轮接线/压缩测试 + 直接受影响测试通过；`pnpm run test:changed` **零新增失败**；`node scripts/checkEolDrift.mjs --strict` 新增文件 LF / 已跟踪漂移 0；**不跑** formatter |
| Gate B | 6 账户 SMOKE：账平、无未扫描事件静默缺口、**资格候选 → 因子 Top3 → R 计划集合逐集合相等**、**越界成交 0**、原始信号与资格集合未因排序变化、已知 ST 真实买入 0、新买 ≤ T+20、无未来倒灌、当前权益 20% 仓位成立、**完整压缩产物预算通过 + 解压哈希一致 + 读回路径有效**；与 007 历史 Random SMOKE 的**业务指标/逐笔**可比对照 |
| Gate C | 一次 42 账户 STUDY：计算 `SUCCEEDED` **且** 持久化 Run `SUCCEEDED` **且** manifest 存在 **且** 完整产物可读 **且** 42 账户齐全 **且** 逐笔排序一致性通过。`persisted=true` **不等于**保存成功；「计算 SUCCEEDED + Run FAILED」必须报告为**交付失败** |

🔴 排序修复后 R 的**交易/权益指纹预期会变**（这正是修复的目的）⇒ **不**以旧 R 收益或旧 R 指纹
作为验收条件。可比性要求只落在：Dataset、原始信号集合、资格政策、冻结参数，以及**独立 Random 结果**。

---

## 8. 预注册的分析口径（事后不得更改）

最终报告 `RESULT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md` 必须回答目标 §7 的七问，其中：

- A/B：当前权益复合收益、MDD、已完成交易数、实际成交锚点/股票数、≥20/50/100% 计数与率、
  亏损/持有、再入场、容量跳过、期末未平仓；
- 每组 R 相对其 20 个 Random 的位置与分布（保留「20 个种子**不是** 20 份独立市场样本」的限制）；
- 原主靶 + block20/block40 区间 + 右尾样本门槛 + 逐年结果；不足则明确 `INSUFFICIENT_EVIDENCE`，
  **不降低门槛**；
- 与 007 对比时明确「旧 R = 代码顺序、新 R = 实际因子排序」，并**逐笔**核实越界 0；
- 归因问题（修复分支交易/损益、满仓遗漏原信号、再入场次数、退出后路径可否评估）复用本地
  **只读**归因方法，**不**发动额外参数矩阵、**不**扩大数据窗口；
- ST 仅简要报告（已知 ST 排除与成交、UNKNOWN 探索政策），**不**补数据集、**不**做全量 ST 治理。

---

## 9. 变更记录

| 时间 | 事件 |
|---|---|
| 2026-10-11（预注册） | 在 Gate A 通过、任何新 Run **之前**写下本文档；明确「已见数据纠错」性质与全部冻结项 |
