# RESULT · 首板滚动池**真实排序修复**与无损压缩交付（008 纠错轮）

结果标识：`FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008`。
目标：[`GOAL-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md`](GOAL-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)；
预注册：[`PREREG-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md`](PREREG-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)（**任何新 Run 之前**已写）。
本轮性质：**已见数据上的实现纠错**，不是新因子检验，不是未见样本 / OOS。

| 项 | 值 |
|---|---|
| 本轮 Run（STUDY 42 账户） | **`RUN-20261011-AEB6DDAB`** |
| `experimentCodeDigest`（新） | `exp-code-sha256:47d3c2654b139eff19e6f895e98bc03586b1f89f1a8ad6a5afebeea629a16869` |
| `experimentCodeDigest`（007，旧） | `exp-code-sha256:d2b06afa7c7241c089e3d871e7ec7cb6f6aa08fecedc5421bd079d13facfadff` |
| 持久化 Run 状态 | `COMPLETED`（生命周期成功值；`markCompleted` **结构性要求**非空 Manifest Key） |
| 计算终态 | `runStatus=SUCCEEDED` / `EXPLORATORY_KNOWN_ST_ONLY` / `matrixEmitted=true` / `terminalState=EXPLORATORY_COMPLETED` |
| Manifest | `experiments/first-board-pullback/rolling-pool-recovery-st/runs/RUN-20261011-AEB6DDAB/manifest.json`（存在、可读） |
| 产物 | 声明 32 件 + `result.json` + `logs/run.log` + `manifest.json` = 35 个对象，全部读回成功 |
| Dataset / 参数 | `datasetVersionId=780004`；`randomAccountCount=20`、`stPolicy=known-st-only` |
| 耗时 | 计算 221,715 ms（工具口径 255.5 s） |
| 007 旧 Run | `RUN-20261011-2BAEF26C`（计算 SUCCEEDED、保存 FAILED / `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`）—— **未覆盖、未回填** |

---

## 1. 根因、最小修复、测试、坐标、终态与压缩预算

### 1.1 根因（代码级）

| # | 位置（路径 + 符号） | 事实 |
|---|---|---|
| D1 | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` · `run()` | `sortCandidates(candidateRows);` 的**返回值被丢弃**（纯函数返回新数组）⇒ 等于没有排序 |
| D2 | 同文件 · `intentsOf(...)` 的 R 分支 | `(cells) => cells.slice(0, DAILY_TOP_K)` 从**未排序**的当日 cells 取前 3 ⇒ 实际入选 = `buildDailyPool` 的**代码升序**前 3 名 |
| D3 | `research-experiments/shared/rollingPoolRightTail/projection.ts#buildDailyPool` | `dailyRows` 按 `symbol` 升序产出（**本轮未改**该行为） |
| D4 | 同文件 · 候选排名诊断产物 | `selectedByR: index + 1 <= DAILY_TOP_K` 是**另排一次**的结果 ⇒ 与真实计划脱节 |

### 1.2 最小修复（只恢复既有声明的口径）

1. **唯一选择入口**：新增 `selectDailyTopByFactor(cells, topK)` —— **消费 `sortCandidates` 的返回值**得到全序，再取 `slice(0, topK)`。R 的每日计划只由它的 `selected` 产生。
2. **同一结果产生计划与诊断**：`rSelectionByDate`（按决策日缓存的 `DailyFactorSelection`）同时喂给
   - R 的 `plans[0].intentsByDate`（真实计划顺序 = `selected` 内的位置），与
   - 候选排名诊断 `candidateRankingDiagnosticsRowsOf(...)`（`rankByPreReturn10` / `selectedByR` / `rPlanOrder`）。
   诊断**不再自行排序**，`selectedByR` 不再靠猜。
3. **不动 Random 的输入顺序**：`plannableByDate` 仍按原始（代码）顺序传入 Random 的 `pickUniformRandomSubset`；`sortCandidates` 的返回值**不写回** `candidateRows` / `plannableByDate`。因此同池同种子的随机抽样与修复无关。
4. **资格判据共用**：`candidateExclusionReasonOf({identityResolved, policyParticipatesInRanking})` 同时被计划侧与诊断侧调用 ⇒ 「未参与排序」的候选（已知 ST / 身份不可解析）名次一律留空、`selectedByR=false`，**不与参与名次混同**。
5. 冻结顺序保持：确认日价格信号 → 当日 ST 参与资格 → 身份可解析 → R 排序 / Random 抽样 → 计划 → 撮合容量 / 现金 / 涨跌停 / 成交前资格检查。**不**用次日状态预排除前日候选，**不**用现金/持仓删股票补第 4 名（Top3 入选 ≠ 三只都成交；≤2 买入/日仍由执行层裁决）。

### 1.3 版本与身份

- **新 `codeDigest`**（见上表）证明注册到 Runner 的执行体已变；`RECOVERY_ST_S5_ARTIFACTS` 增加 1 条 `artifact-compression-index.csv`。
- **`RECOVERY_COMPUTATION_VERSION` 未递增**（保持 `1.0.0`，`descriptor.version` 同理），理由：
  1. 排序口径**本来就已声明**为 `preReturn10` 降序 → symbol 升序 → eventId 升序；本轮是让实现回到该声明，**没有**修改任何口径常量；
  2. `result.ts` 的 `computationVersion` 是 `z.literal(COMPUTATION_VERSION)`，递增会让**历史 Run 的 payload 不再通过该 schema**，与「旧 Run 不变、仍可读」冲突。
  这是一次**显式记录**的偏离（见 §9），不是"只改展示标签"。
- **旧 StrategyVersion 不变**（`strategy_versions.id=3600005 / 2.0.0 / T74`）；旧报告 / 旧 Run / 旧产物未改动。

### 1.4 门与测试

| 门 | 结果 | 证据 |
|---|---|---|
| `pnpm run check` | **0 错** | `tsc --noEmit` |
| `pnpm run test:changed` | 185 文件 / 2439 用例；**10 失败 = 既有 4 个恒红文件（3+1+4+2）**，**零新增** | `_scratch/fbp8/gateA-test-changed.log` |
| 本轮新增接线测试 | `rollingPoolRecoveryStSortParity.test.ts` **15/15 通过** | 覆盖 §4.3 第 1~7 条 |
| 本轮新增压缩测试 | `rollingPoolRecoveryStArtifactCompression.test.ts` **12/12 通过** | 大件压缩 / 无损 / 发布读回 / 上限仍有效 |
| 既有 recovery-st 测试 | 5 文件 **103/103 通过** | 含前转 ST 拒单、当日权益仓位随盈亏、再入场不新增永久禁止 |
| `node scripts/checkEolDrift.mjs --strict` | 已跟踪漂移 **0**；**新建文件全部 LF**；exit 1 由**其他会话**的未跟踪 CRLF 探针 `_scratch/overlap/probe01_db_state.mjs` 引起（**已披露，未改/未删/未扩忽略**） | 见 §9 |
| SMOKE 发布预算校验 | **通过**（走平台既有 `validatePublishLimits` + `publishRunArtifacts`，内存 ArtifactStorage） | 见 §1.5 |
| 样本账（无未扫描事件的静默缺口） | `candidate 58,983 = eligible 19,510 + excluded 39,473`；剔除原因合计 **39,473**（`EVENT_OUTSIDE_POOL_WINDOW`）；另有 **69** 个事件**已通过事件扫描**但未形成 rd1..80/rd1..40 观察池行（`NEVER_IN_WATCH_POOL`，属 `eligible` 之内，**刻意不计入**剔除原因，否则账不平）⇒ 与 007 逐项一致，**账平** | `_scratch/fbp8/gateC-verification.json` + payload `sampleSummary.notes` |
| formatter | **未运行** `pnpm run format` / `prettier --write` | — |

### 1.5 完整明细无损交付与读回

| 项 | 007（旧，只读实测 / 旧 SMOKE） | 008 SMOKE（6 账户） | **008 STUDY（42 账户）** |
|---|---:|---:|---:|
| 交付件数 | 31 | 32 | 32 |
| 交付总量 | **688,592,665 B**（超 256 MiB 上限） | **45,915,055 B** | **47,565,373 B** |
| 最大单件 | **312,083,057 B**（超 64 MiB 上限） | 23,666,242 B | 23,666,242 B |
| 压缩件数（≥1 MiB 的 CSV） | 0 | 7 | 10 |
| 平台上限 | 64 MiB / 256 MiB / 100 件（**本轮未改**） | 同 | 同 |

- 实现位置：**本实验的产物打包层** `packArtifactForDelivery`（`gzip` level 1，门槛固定 1 MiB）→ 经既有 `context.artifact` / ArtifactStorage 交付 `.csv.gz`（`contentType=application/gzip`，**真二进制 `Uint8Array` body**）。**未**新增全局自动压缩路径。
- 压缩索引 `artifact-compression-index.csv`（未压缩、直接可读）记录：逻辑名 → 实际对象名、角色、编码（`identity`/`gzip`）、原文与交付体积、**原文 SHA-256**、行数。本表**不列自身**（未列出的名字按「对象名 = 逻辑名」解析）。
- **逐件解压校验（STUDY，10 件，全部 `match=true`）**：

| 对象 | 原文 B | 交付 B | 原文 SHA-256（解压后一致） |
|---|---:|---:|---|
| `opportunity-day-attribution.csv.gz` | 312,083,057 | 23,666,242 | `9f2f980a1a4e7b7d…` |
| `observation-repair-ledger-B_RECOVERY_20-2024.csv.gz` | 107,832,874 | 6,007,385 | `828b620c6e544117…` |
| `observation-repair-ledger-A_STRICT_20-2024.csv.gz` | 99,097,445 | 4,231,102 | `5ad83bbd675e03eb…` |
| `observation-repair-ledger-B_RECOVERY_20-2025.csv.gz` | 75,348,967 | 4,196,344 | `04152a2af880ab9b…` |
| `observation-repair-ledger-A_STRICT_20-2025.csv.gz` | 69,919,745 | 3,057,512 | `a31562cc7a235049…` |
| `observation-repair-ledger-B_RECOVERY_20-2023.csv.gz` | 10,834,420 | 670,646 | `933bb66c70be988c…` |
| `observation-repair-ledger-A_STRICT_20-2023.csv.gz` | 10,001,515 | 465,362 | `7e382987cff65a99…` |
| `st-fill-audit-B_RECOVERY_20.csv.gz` | 3,583,133 | 319,640 | `cf5f294dd3087afe…` |
| `st-fill-audit-A_STRICT_20.csv.gz` | 2,200,111 | 203,274 | `a2dc87513b77d2ac…` |
| `anchor-failed-attempts.csv.gz` | 1,922,921 | 98,767 | `88813cf3b2363e1b…` |

- **每行 / 每列 / 顺序 / 数值 / 证据全部保留**：不采样、不删未触发观察日、不截断年份、不筛赢家（压缩是逐字节无损；解压哈希与原文相等）。
- **读回路径**：`ArtifactStorage.get()` 返回的正是**压缩字节**（`st-fill-audit-B` 交付 319,640 B ≠ 原文 3,583,133 B）；`manifest` 经真实发布器写出并通过存在性验证（`verifyManifestArtifacts`）。分析工具 `tests/tools/rollingPoolRecoverySt007Analysis.mts` 已按**编码**读回（先读压缩索引解析真实对象名 → `gzip` 先 `gunzipSync` 再解析 UTF-8 → 核对原文 SHA-256）；旧普通 CSV 路径不变（`< 1 MiB` ⇒ 仍叫 `.csv`、`text/csv`）。
- 结果摘要 / 小表仍直接可读；数百 MB 明细经既有后端下载、由工具解压，**不在网页内展开**（前端对 `format=binary` 正确提示「不是文本格式，请下载」）。

---

## 2. A / B 账户结果（本轮，R 账户，纠错后）

固定口径：初始 100,000 元；**当日总权益 20%**；最多 5 持仓、每日最多 2 买入；100 股整手；计划 Top3；最晚 T+20；冻结 Runner `strategy_versions.id=3600005 / 2.0.0 / T74`。

| 指标 | A `A_STRICT_20` | B `B_RECOVERY_20` |
|---|---:|---:|
| **当前权益复合收益** | **+3.2429623609000036 %** | **−35.96741798660001 %** |
| 年化收益 | +1.6582928601721614 % | −20.52487903298841 % |
| **MDD** | **23.47385293519999 %** | **36.14153861450002 %** |
| 已完成交易 | **144** | **236** |
| 期末未平仓 | **0** | **0** |
| 实际成交锚点数 | 143 | 235 |
| 计划涉及锚点 / 股票（去重） | 204 / 204 | 442 / 442 |
| 成交笔数（含加仓）/ 拒单 | 288 / 17 | 472 / 17 |
| 胜率 | 36.80555555555556 % | 35.16949152542373 % |
| 盈亏比（profitFactor） | 1.043452372578366 | 0.6847829511886576 |
| 平均盈利 / 平均亏损 | +8.833131481498805 % / −4.7785889781621815 % | +6.442988702842353 % / −4.858713852621972 % |
| **≥+20% 计数 / 率** | **4 / 2.777777777777776 %** | **4 / 1.694915254237288 %** |
| **≥+50% 计数 / 率** | **2 / 1.3888888888888888 %** | **1 / 0.423728813559322 %** |
| **≥+100% 计数 / 率** | **0 / 0 %** | **0 / 0 %** |
| 平均持有（交易日） | 5.541666666666667 | 5.771186440677966 |
| 亏损笔 / 平均亏损持有 | 91 笔 / 4.27 日 | 153 笔 / 4.37 日 |
| 盈利笔 / 平均盈利持有 | 53 笔 / 7.72 日 | 83 笔 / 8.36 日 |
| 期末现金占比 | 100 % | 100 % |
| 再入场成交次数 | **1** | **1** |
| **容量跳过（建仓侧，有 `skipCode`）** | **70**（`MAX_POSITIONS_REACHED` 63 + `MAX_DAILY_BUYS_REACHED` 7） | **268**（255 + 13） |
| 锚点整链净损益合计 | +3,242.96 元 | −35,967.42 元 |
| 显式费用合计 | 2,755.01 元 | 4,192.92 元 |
| 入场后前 3 / 5 日不利波动（均值，最差） | −5.0066 % / −6.4267 %（最差 −32.4510 %） | −4.7650 % / −6.2319 %（最差 −33.5726 %） |

**覆盖（主靶分子/分母）**：共同可核实锚点宇宙 **18,611**；A 命中 4（覆盖率 0.00021492665627854496），B 命中 4（同）。唯一命中股票数 4 / 4。

---

## 3. 每组 R 相对其 20 个 Random

| 组 | R 收益% | R 排名（21 账户） | R 优于几个 Random | Random 均值 / 中位 | Random 最好 / 最差 | Random 分位（q05 / q25 / q75 / q95） | Random SD |
|---|---:|---:|---:|---:|---:|---|---:|
| A | **+3.2430** | **2** | **19 / 20** | −5.1847 / −4.5700 | +10.5482 / −22.5600 | −18.2595 / −7.6230 / −1.5312 / +3.5872 | 7.6861 |
| B | **−35.9674** | **21（末位）** | **0 / 20** | −14.0502 / −15.9950 | +3.8811 / −26.0521 | −24.9913 / −23.7749 / −7.7741 / +2.8953 | 9.8588 |

- Random 逐账户收益（种子 `20261010..20261029`，两组同种子）：
  - **A**：`+2.73 / −4.83 / +2.00 / −1.81 / −3.70 / +3.22 / −6.18 / −7.69 / −11.84 / −22.56 / −0.75 / −5.83 / −5.34 / −7.60 / −4.31 / −18.03 / −1.79 / +10.55 / −3.88 / −16.04`
  - **B**：`−18.28 / −15.21 / −24.08 / −2.32 / −9.22 / +1.67 / +2.84 / −11.60 / −17.81 / −24.10 / −7.87 / −26.05 / −15.04 / −16.78 / −21.02 / −24.94 / −23.84 / −23.75 / −7.49 / +3.88`
- Random MDD：A 中位 22.93 %（R 23.47 %）、B 中位 27.90 %（R 36.14 %）。
- Random 已完成交易数：A 140–146、B 225–241；期末未平仓全为 0。
- Random 的 ≥+20% 计数：A 每账户 2–4 个、B 每账户 5–10 个。**池化** Random 尾率：A 63/2865 = 2.1990 %、B 139/4651 = 2.9886 %（R 分别 2.7778 % / 1.6949 %）。
- R 与 Random 的**分布形态**：A 的 R 位于分布右肩（第 2 名，但最大值 +10.55 % 由 Random 取得）；B 的 R **低于全部 20 个 Random**（末位），且 MDD 高于 Random 中位数。

🔴 **限制（不放松）**：这 20 个种子是**同一份数据上的 20 次抽样**，**不是 20 份独立市场样本**；
它们的离散度不构成任何显著性证据，也不能用来给 R 的排名赋 p 值。

---

## 4. 原预注册主靶、block20/40、右尾样本门槛与逐年结果

**主靶**（`B_R − A_R`：共同可核实锚点宇宙上「至少一笔已完成净收益 ≥+20% 的唯一锚点数」覆盖率差；配对移动块 bootstrap，1000 次）：

| 口径 | 点估计 | 95% 下界 | 95% 上界 | 簇数 | 零分母迭代 |
|---|---:|---:|---:|---:|---:|
| **block20 主口径**（seed 20261010） | **0** | **−0.00033256945650262824** | **+0.0002989980172620684** | 425 | 0 |
| **block40 敏感性**（seed 20261011） | **0** | **−0.0003100167646322922** | **+0.00028552952390308316** | 425 | 0 |
| block20 配对均值差（锚点整链净损益） | 0 | −4.578546846016897 | +0.47552759398055605 | 425 | 0 |

- `sampleGateMet = false`：两组 ≥+20% 唯一命中锚点数 = **4 / 4**，**未同时达到事前门槛 50**。
- `supported = false`；逐年同向年度仅 **2024**。
- ⇒ **`INSUFFICIENT_EVIDENCE`**（不等同于证明无效）。**未降低门槛、未扩大随机账户数补样本、未追参数或种子。**

**逐年**（同靶 + R 年度收益）：

| 组 | 年 | 共同宇宙锚点 | ≥+20% 命中锚点 | 覆盖率 | R 年度收益% |
|---|---|---:|---:|---:|---:|
| A | 2024 | 10,535 | 0 | 0 | −23.313662364799992 |
| A | 2025 | 8,076 | 4 | 0.0004952947003467063 | +34.630190389363676 |
| A | 2026 | 0 | 0 | null | 0 |
| B | 2024 | 10,535 | 3 | 0.00028476506881822496 | −26.26621783340003 |
| B | 2025 | 8,076 | 1 | 0.00012382367508667657 | −13.157062974581068 |
| B | 2026 | 0 | 0 | null | 0 |

- 右尾样本门槛**未达标**；2024 / 2025 是**已见探索窗口**，**不是 OOS**。
- Runner（`3600005 / T74`）的**因果贡献未测**（本实验没有退出消融）。

---

## 5. 与 007 的对比：旧 R 是**代码顺序**，新 R 是**实际因子排序**

### 5.1 口径声明（必须先说）

007 的 A/B 收益（`+2.8237 %` / `−25.8124 %`）来自**代码升序取前三名**的旧实现，
**不得**称为「已验证的因子排序收益」（已在 007 RESULT 与 AUDIT 登记为
`BASELINE_DRIFT / RESEARCH_RESULT_INTERPRETATION_INVALID`）。
本轮的收益变化是**实现纠错**造成的，**不是**多轮参数择优的结果。

### 5.2 逐项对照

| 指标 | 007（代码顺序） | **008（实际因子排序）** |
|---|---:|---:|
| A 收益 / MDD | +2.8237432769999904 % / 22.012506288800022 % | **+3.2429623609000036 % / 23.47385293519999 %** |
| A 已完成交易 / 成交锚点 | 144 / 143 | **144 / 143** |
| A 计划涉及锚点 | 201 | **204** |
| A ≥20/50/100%（计数/率） | 4 (2.7778 %) / 2 (1.3889 %) / 0 | **4 (2.7778 %) / 2 (1.3889 %) / 0** |
| A 相对 20 Random | 第 3 名（优于 18/20） | **第 2 名（优于 19/20）** |
| B 收益 / MDD | −25.81240630880004 % / 29.599205981300038 % | **−35.96741798660001 % / 36.14153861450002 %** |
| B 已完成交易 / 成交锚点 | 235 / 234 | **236 / 235** |
| B 计划涉及锚点 | 431 | **442** |
| B ≥20/50/100%（计数/率） | 6 (2.5532 %) / 1 (0.4255 %) / 0 | **4 (1.6949 %) / 1 (0.4237 %) / 0** |
| B 相对 20 Random | 第 20 名（优于 1/20） | **第 21 名（优于 0/20）** |
| 主靶点估计 / block20 / block40 | 0.00010746 / [−0.00010387, +0.00035113] / [−0.00011195, +0.00034928] | **0 / [−0.00033257, +0.00029899] / [−0.00031002, +0.00028553]** |
| **因子排名 >3 的成交** | A **6** / 144、B **32** / 235 | **A 0 / 144、B 0 / 236** |
| **代码排名 >3 的成交** | A 0、B 0（全部 379 笔符合代码 Top3） | 不适用（已按因子排序） |
| 原始价格信号（按组） | A 328 / B 1,300 | **A 328 / B 1,300（逐组相同）** |
| 资格候选（参与排序） | A 328 / B 1,297 | **A 328 / B 1,297（逐组相同）** |
| **Random 账户结果** | 基准 | **与 007 逐项、逐笔完全相同**（20 个种子 × 2 组；见 §5.4） |
| 冻结配置 | 基准 | **0 项漂移** |

### 5.3 逐笔排序一致性（**0 越界**，不只是汇总收益）

| 组 | R 真实成交 | **排序越界成交** | 已知 ST 成交 | 确认日 > rd19 的成交 | `selectedByR` ⇔ `rPlanOrder` 不一致 | 计划顺序不连续天 | 单日入选 > Top3 天 | 参与候选缺名次 | `participantCountThatDay` 不一致 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 144 | **0** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B | 236 | **0** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

判据（`scripts/_scratch/verify008SortingConsistency.mts`，只读）：对**每一笔** R 真实成交，
用 `st-fill-audit` 的 `(anchorEventId, confirmDate)` 回接 `candidate-ranking-diagnostics`，
要求 `selectedByR=true` 且 `rankByPreReturn10 ∈ [1,3]` 且 `rPlanOrder` 非空。
**380 笔成交全部落在对应确认日的实际 Top3 内。**

### 5.4 Random 未被修复扰动（§4.3 第 7 条）

- **SMOKE**：`random-account-metrics-{A,B}.csv` 的 Random 行与逐笔分片
  `trades-random-{A,B}-part-00.csv` 与 007 基线**逐字节相同**（289 / 469 行，`identical=true`）。
- **STUDY**：payload 里 20 个 Random 账户 × 2 组的 26 项指标与 007 payload **零差异**
  （`randomPayloadIdenticalTo007 = true`）——即使 R 的计划集合已改变。
- 机制上可解释：修复只改 R 回调消费的 `selected`；`plannableByDate` 的**原始输入顺序**、
  `pickUniformRandomSubset` 的按输入下标取样、以及 Random 的计划构造都未变。
  ⇒ 本轮**没有**发生「同池同种子 Random 结果意外变化」的停止条件。

---

## 6. 本轮归因问题（只读方法，无额外参数矩阵 / 无扩大数据窗口）

### 6.1 修复分支的交易与损益（B，R 账户，按真实成交审计的 `branch`）

| B 实际入场分支 | 交易数 | 净损益 | 单笔平均收益 | ≥20 % / ≥50 % |
|---|---:|---:|---:|---:|
| **RECOVERY** | **152** | **−20,967.64 元** | −0.8000 % | 3 / 1 |
| **ORIGINAL** | **84** | **−14,999.78 元** | −1.0359 % | 1 / 0 |
| 合计 | **236** | **−35,967.42 元** | −0.8840 % | 4 / 1 |

- B 的整链净损益 −35,967.42 元中，修复分支贡献 **−20,967.64 元（58.3 %）**，仍是主要亏损来源，
  但它已不再是「未被排序的扩池交易」：本轮它**实际按 `preReturn10` 排序入选**。
- B 独有锚点（A 已完成而 B 未）：**156** 个，其中 **151** 个当日走修复分支候选；
  B 独有已完成交易 157 笔，画像 mean −0.8871 %、median −1.9133 %、≥20 % = 1.91 %。
- 显式费用合计 4,192.92 元；即便把显式费用全部还原为 0，仍亏 31,774.50 元
  ⇒ 结果**不能**主要归咎于显式佣金税费。

### 6.2 退出分组（R 账户；**「止损」标签包含盈利保护**）

| 退出分组 | A：笔数 / 净损益 | B：笔数 / 净损益 |
|---|---:|---:|
| 「止损」标签且最终**盈利**（保护退出） | 29 / +59,600.35 元 | 29 / +42,142.99 元 |
| 「止损」标签且最终**亏损** | 51 / −58,498.99 元 | **83 / −86,892.36 元** |
| MA 趋势止盈 | 25 / −1,493.93 元 | 58 / −2,196.69 元 |
| 持有满 5 个交易日 | 37 / −812.19 元 | 58 / −26.30 元 |
| 强势续持后持有满 10 个交易日 | 2 / +4,447.72 元 | 8 / +11,004.95 元 |

- 亏损交易的持有期明显更短（A 4.27 日 vs 盈利 7.72 日；B 4.37 日 vs 8.36 日），与 007 同形。
- 这些是**结果账**，**不是**删掉某一组后的账户回测；本轮**没有**做退出消融。

### 6.3 满仓遗漏的原信号（A 成交而 B 未成交）

A 成交锚点 143、B 成交锚点 235；A 成交而 B 未成交 **64** 个锚点，逐项对接 B 当日的真实事实：

| B 未成交的直接原因 | 锚点数 |
|---|---:|
| `MAX_POSITIONS_REACHED`（并发持仓已满，真实跳过记录） | **49** |
| 当日有 B 候选但**实际因子名次在 Top3 之外**（名次 4×8、5×1、6×3、7×1、9×1、24×1） | **15** |
| 未被政策排除而未参与排序 / 当日无 B 候选 | 0 / 0 |
| 尚不能解释 | **0** |

- 🔴 与 007 的关键差别：007 里 25 个锚点的原因是「实际**代码顺序**排在 Top3 外」；
  本轮同一分层的名字变成「实际**因子**名次在 Top3 外」——正是修复生效的直接体现。
- 仍以满仓为主（49/64 = 76.6 %）：弱交易占用仓位、原信号被跳过，与本轮归因问题一致。

### 6.4 再入场

| 组 | R 再入场成交次数 | 再入场锚点 | 两次入场日 |
|---|---:|---|---|
| A | **1** | `600397.SH@2024-10-10` | 2024-10-23 → 2024-11-01 |
| B | **1** | `600785.SH@2024-02-19` | 2024-03-07 → 2024-03-18 |

与 007（A 1 次 / B 1 次）一致：**再入场政策未改**，且证据仍不支持「再入场次数上限挡住了机会」。

### 6.5 退出后路径**可否评估**

- 用 `confirmRd + 1 + holdingPeriod` 推算退出 rd，与 Dataset 物理上界 **rd80** 比较：
  - A：**91 / 91** 笔亏损交易的「退出 rd + 20 ≤ 80」⇒ 可评估；
  - B：**153 / 153** 笔亏损交易的「退出 rd + 20 ≤ 80」⇒ 可评估。
- 结论：**可以**用既有的只读方法（`scripts/_scratch/review007/fetch-attribution-bars.mts` 的同一口径：
  既有 Dataset 端口、显式 `usesForwardData=true`、只读 rd1..80）评估退出后 20 日路径，
  **不需要**扩大数据窗口、**不需要**新建回测。
- 本轮**未重跑**该 bar 拉取（避免在报告阶段引入第二套计算）；因此退出后峰值/终点的**具体数值
  本轮不复述**，只报告「可评估」这一结论与样本计数。007 的路径结论（存在错过上涨、也存在继续走弱）
  在可比口径下仍然成立，但**不得**据此调整退出参数。

---

## 7. ST（简要）

- 政策：`KNOWN_ST_ONLY_EXPLORATORY` / `recovery-known-st-only/1.0.0`（探索性，严格缺省不变）。
  来源 `research_security_status_history#statusType=ST`：读入 841 行 / 734 证券 + 身份 5552 行；
  `availability` 全 `UNKNOWN`、显式 NORMAL 行 **0**；来源指纹 `cbd5ff564f69a6d6…`。
- **已知 ST 排除候选 = 3 个价格信号（全部在 B 组）**；**已知 ST 订单 = 0、已知 ST 真实成交 = 0**。
- UNKNOWN 参与候选：A 328 / B 1,297；UNKNOWN 订单 8,162（成交 7,896 / 拒单 266），**原样留档**。
- 严格 PIT 视角读数照记（**仅证据**）：`ST_COVERAGE_BLOCKED`、3,256 个检查点全 UNKNOWN、
  可核验 NORMAL 0。**UNKNOWN 可参与是用户授权的探索性政策，不是严格 PIT 结论。**
- 未补数据集、未做全量 ST 治理。

---

## 8. 契约 / DB / 执行影响与基线更新

- **Contract**：**无公共契约变化**。`ExperimentArtifactFileSpec.body` 本就接受 `Uint8Array`、
  `contentType` 本就可覆盖；`inferArtifactDescriptor` 对未知扩展名按角色回落（`.gz` → `format: "binary"`，
  显式 MIME `application/gzip`，落 `manifest.tables`）。**未**提高 64/256 MiB 阈值、**未**放松校验、
  **未**直连对象存储 SDK、**未**用压缩 JSON 信封绕过信封限制。
  实验本地声明面变化：`RECOVERY_ST_S5_ARTIFACTS` +1 条；大件 CSV 对象名追加 `.gz`；
  `candidate-ranking-diagnostics-{group}.csv` 新增 10 列（`participantCountThatDay` /
  `identityResolved` / `participatesInRanking` / `exclusionReason` / `rPlanOrder` / `rFillDate` /
  `rFillEvidenceRef` / `rNotFilledReason` / `rNotFilledEvidenceRef` / `sortingSource`），
  `poolSizeThatDay` 语义明确为「原始价格信号账当日行数」，未参与者 `rankByPreReturn10` 留空。
- **DB**：**0 schema 变更 / 0 migration / 0 DDL / 0 历史批量写 / 0 回填**。
  本轮新增 1 条 Run 行 + 1 份 manifest + 35 个对象（就是本次交付本身）。
- **Execution Path**：R 的每日候选选择从「未排序 `slice`」改为「消费 `sortCandidates` 返回值」；
  Random 路径**未改**（已由逐笔字节相同证明）。策略语义、买点、期限、仓位、成本、退出、再入场、
  Dataset 坐标全部未改。
- **基线文档**：`CHANGE-AUDIT.md` 追加本轮条目；`RESULT-…-LOSS-ATTRIBUTION-007.md` 与
  `RESULT-…-RECOVERY-LIGHT-ST-007.md`、`AUDIT-…-RECOVERY-LIGHT-ST-007.md` **追加**纠错引用
  （不删旧文、不覆盖并发修改）。`SYSTEM-BASELINE.md` / `system-manifest.yaml` / `CONTRACT-MAP.md`
  **未改**，理由：无新增 entry point、无公共契约变化、无架构版本跃迁。

---

## 9. 偏离与理由（逐条）

| # | 偏离 | 理由 |
|---|---|---|
| 1 | **Gate C 首次调用退出码 1**（工具缺陷） | 工具的持久化终态判据把**执行器**词表 `SUCCEEDED` 与**生命周期**词表 `COMPLETED` 混用 ⇒ 把一条真正成功的 `COMPLETED` Run（`resultManifestKey` 非空、`markCompleted` 结构性要求 manifest）误报为交付失败。**已修**（判据改为生命周期成功值 `COMPLETED` 并留档），并用 `--verify-persisted` **只读复检同一条 Run**（exit 0）。**未重跑 42 账户**、**未改任何研究参数或种子**。原始失败证据保留在 `_scratch/fbp8/gateC-study.log`。 |
| 2 | 未递增 `RECOVERY_COMPUTATION_VERSION` | 见 §1.3（口径本就已声明；递增会让历史 payload 不再通过 `z.literal`）。新 `codeDigest` 已区分执行身份。 |
| 3 | 本轮输出写到 `_scratch/fbp8/`（未复用 `fbp7/`） | 007 的交付必须原样保留以便纠错前后对照。 |
| 4 | 压缩索引**不列自身** | 索引必须以 `identity` 交付且「先有 body 才有自身的体积/哈希」，无法自指；未列出的名字按「对象名 = 逻辑名」解析（旧 CSV 路径）。 |
| 5 | `checkEolDrift --strict` 仍 exit 1 | **其他会话**的未跟踪文件 `_scratch/overlap/probe01_db_state.mjs`（CRLF）触发；按目标要求**披露**，未改/未删该文件，未扩大忽略范围。已跟踪漂移 **0**、本轮新增文件**全部 LF**。 |
| 6 | 未重跑退出后 bar 拉取 | §6.5：报告阶段不引入第二套计算；只给「可评估」的结论与样本计数（91/91、153/153）。 |
| 7 | 残余账差：`skippedIntentCount`（75 / 277，账户指标，来自 `run.skipped` 全量）与 `anchor-failed-attempts.csv`（70 / 268，按设计只记**建仓**侧）不一致 5 / 9 | 产物按代码只保留 `side === "buy"`；差值不属建仓容量跳过。**如实列出**，未改动任何一侧以凑齐。 |
| 8 | 本轮新增只读探针放在 `scripts/_scratch/`（已 gitignore） | 遵循 AGENTS 工程铁律第 8 条。 |

---

## 10. 复现与证据路径

| 内容 | 路径 |
|---|---|
| Gate A 增量测试日志 | `_scratch/fbp8/gateA-test-changed.log` |
| Gate B SMOKE 日志 / 信封 / 产物 | `_scratch/fbp8/gateB-smoke.log`、`_scratch/fbp8/smoke-outcome.json`、`_scratch/fbp8/smoke-artifacts/` |
| Gate B 独立校验报告 | `_scratch/fbp8/gateB-verification.json`（`passed=true`） |
| Gate C STUDY 日志 / 信封 | `_scratch/fbp8/gateC-study.log`、`_scratch/fbp8/study-run.json` |
| Gate C 只读复检 | `_scratch/fbp8/gateC-recheck.log`、`_scratch/fbp8/study-recheck.json` |
| Gate C 独立校验报告 | `_scratch/fbp8/gateC-verification.json`（`passed=true`） |
| 读数汇总 / 归因 / 007 分析口径 | `_scratch/fbp8/summary-008-study.json`、`_scratch/fbp8/attribution-008.json`、`_scratch/fbp8/analysis.json`、`_scratch/fbp8/analysis.md` |
| 只读探针 | `scripts/_scratch/verify008SortingConsistency.mts`、`scripts/_scratch/attribute008.mts`、`scripts/_scratch/summarize008.mts`、`scripts/_scratch/probe008Storage.mts` |
| 本轮接线 / 压缩测试 | `tests/server/researchExperiments/rollingPoolRecoveryStSortParity.test.ts`、`tests/server/researchExperiments/rollingPoolRecoveryStArtifactCompression.test.ts` |
| 本实验打包层与交付校验 | `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#packArtifactForDelivery`、`.../deliveryVerification.ts` |

**完成定义对照**（目标 §8）：修复已验证 ✅ + SMOKE 门槛通过 ✅ + 一次 42 账户结果**完整交付**
（计算 SUCCEEDED ✅ / 持久化 Run COMPLETED ✅ / manifest 存在 ✅ / 完整产物可读 ✅ / 42 账户齐全 ✅ /
逐笔排序一致性通过 ✅）+ 本报告 ✅。**无停止条件命中**：无已知 ST 成交、无排序越界、无未来信息回流、
样本账平、发布未超限、冻结参数无漂移。

### 10.1 关键文件指纹（SHA-256）

| 文件 | SHA-256 | 字节 |
|---|---|---:|
| `docs/research/RESULT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md` | `3866e4370cd585b5c2fee5fb72cc2e1ce54b5e9dab1f3f129daf997825dfd023` | 29,841 |
| `docs/research/PREREG-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md` | `bd2849453179a88d998a199fdc9a56f37f3fe6bae98c8045f0e503ea35454c86` | 11,435 |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts` | `3945288f8cf78b7ceb3bfec917b1d4a756295bfeaf715cdba9920a74fae37ca0` | 243,725 |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/deliveryVerification.ts` | `32c6ebcff0e793c36bcdc8e75d0a77090ea1e870f40a0c25c4e3acf51ee4cf4b` | 13,932 |
| `research-experiments/first-board-pullback/rolling-pool-recovery-st/result.ts` | `a489e855574f95abb121dde824c3046a863ad083911628fa9366090689ba1c24` | 95,172 |
| `tests/tools/rollingPoolRecoveryStRun.mts` | `f7d10ba490855723abbbd4773272ee465b2d7b73c98d033a3c54f81eb0b80adc` | 30,986 |
| `tests/tools/rollingPoolRecoverySt007Analysis.mts` | `bd0f81e6467f7b525136a6bb8123f29756b219703ed14ef38225bd8ea4dee3cf` | 38,677 |
| `tests/server/researchExperiments/rollingPoolRecoveryStSortParity.test.ts` | `b18380aca38d10d4241b5c269f1433e7aebef9caf5b256a044bb01de9b3752d9` | 28,003 |
| `tests/server/researchExperiments/rollingPoolRecoveryStArtifactCompression.test.ts` | `2fe03b8d3dadb49b42cf59c78bd04a57b4b7a9d949c697af0b7b0bc5b0f2868e` | 16,398 |
| `_scratch/fbp8/gateB-verification.json` | `fd282f758e1ad3010af5f454471c75945f9e084ea930425621c7989244ee1580` | 13,887 |
| `_scratch/fbp8/gateC-verification.json` | `bbc063d4cbcfcf49ab2a5bec28ac49290f0eeb126b80f87e4fa847cdfbf4f9d6` | 11,678 |
| `_scratch/fbp8/study-run.json` | `b4c6761e7fc344a8a32847a4a7ac78410570e8beb9125cb1de1149cafc129039` | 99,977 |
| `_scratch/fbp8/attribution-008.json` | `4a5aed1851a875451181cfa4a6999525b49df1d60c50343ca30cccd61ad3c2ff` | 73,629 |

> 🔴 `_scratch/**` **未纳入版控**（本仓库惯例：`_scratch/` 整体作为一个未跟踪目录）。
> 因此上面 5 个 `_scratch` 条目的哈希是**本机证据指纹**，不随仓库分发；报告的自足结论不依赖它们。

## 11. 独立复核补充（2026-10-11；优先于上文冲突表述）

完整复核见 [AUDIT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008](AUDIT-FIRSTBOARD-ROLLING-POOL-SORT-PARITY-008.md)。正式Run `COMPLETED`、完整产物可读、实际Top3成交越界0及本报告账户收益已独立确认；本地payload与对象存储结果一致。

- **验收残项**：候选诊断连接成交/跳过记录时，查询键使用 `confirmRd`，Map却以确认日期建键，导致A144笔/B236笔成交证据栏、A70条/B268条建仓跳过原因栏全部为空。排序与账户收益不受影响，逐候选审计链仍需小修；现有诊断测试传空证据Map，未覆盖此缺陷。本轮不改业务代码、不回填原Run。
- **§6.3日期口径修正**：若按A实际确认日连接B当日记录，应为48个满仓、16个因子Top3外；原49/15使用了部分事件另一日的首次跳过。`600179.SH@2025-08-25` 在A确认日2025-09-12未进B的Top3，满仓跳过发生在2025-09-16。64个遗漏锚点合计不变；整事件生命周期可存在两种原因，不能混写为同日原因。
- **§5.2/§8 Random证据范围修正**：正式STUDY的40个Random账户指标全部一致；逐笔历史一致已验证的是SMOKE，不是40个正式账户的完整历史交易CSV。正式逐笔一致不应作为已验证事实。
- **辅助分析口径**：`analysis.md` 首表288/472为买卖成交数，204/442为计划覆盖锚点；引用实际完整交易及成交锚点时使用本报告的144/236和143/235。
- **§6.5路径补充**：复用既有rd1..80缓存，无新数据查询/回测；A91条亏损交易都有完整退出后20日路径，B为152/153。B缺失事件 `002123.SZ@2024-11-20` 后续部分行情无效，物理窗口内不等于行情完整。后续至少一次收盘回到入场价：A50/91、B89/152；至少一次收盘达入场价+20%：A11/91、B19/152；第20日相对入场价均值−4.52%/−3.82%。均为前向事后原始价格路径，不是可执行收益，不能直接推出应放宽退出。

阶段结论修正为：**正式执行成功、排序纠错通过；诊断审计字段及部分报告口径尚待收口**。旧Run与产物保留，不为这些诊断字段重跑42账户。以上补充改变报告文件内容，§10.1的报告自指纹不再代表当前文件；历史指纹不作为当前验证依据。
