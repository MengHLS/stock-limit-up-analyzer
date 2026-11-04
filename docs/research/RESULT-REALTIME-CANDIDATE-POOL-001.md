# RESULT-REALTIME-CANDIDATE-POOL-001

> **Gate：`CANDIDATE_POOL_READY`**
> 生成日期：2026-10-05（Asia/Shanghai）
> 口径版本：`RCP-P0-v1`（definitionHash `sha256:55b90453df26195f13303c0909416f50e67524a99607b7de2bbb723bd68697dd`）
> 工件：`scripts/_scratch/_realtime_candidate_pool_001.json`（92,126,893 B；sha256 `0998bbae14740950b3ca6af1c99973f7b4c7bd8a7b26b818fc0102347f9ed41f`）
> 池指纹（仅行数据）：`d43527ee3f4a4804b036976832ea4960e1c529f2219d46e7b252e24ae7cbcb1b`
> 复算脚本：`scripts/_scratch/_realtime_candidate_pool_001.mjs`（全程只读 SELECT）

---

## 0. 结论速览

| 项 | 结果 |
|---|---|
| 窗口 | 2019-01-02 ～ 2026-09-04（**1,863** 个交易日） |
| 主板上市宇宙（scope universe） | **5,770,108** 条 (security × tradeDate) |
| **Candidate Pool 行数** | **4,859,017** 条（占宇宙 84.21%） |
| 硬过滤剔除 | 911,091 条（账已平：`candidate + excluded = universe`） |
| 每日候选数 | min **1,372** / P25 **2,319** / Median **2,661** / P75 **2,959.5** / max **3,072** / mean **2,608.17** |
| 未来信息泄漏 | **未发现**（as-of replay 4/4 完全一致；见 §5.1） |
| 重复股票 | **0**（`(tradeDate, securityId)` 唯一；见 §5.2） |
| 跨日状态错误 | **0**（年龄单调 / 上市-退市边界 / ST / 停牌 全部通过；见 §5.3） |
| T → T+1 Open 可回测 | **支持**：已核验候选 4,856,017 条中可执行 **4,854,201** 条 = **99.9626%**；仅窗口最后一天 2026-09-04 的 3,000 条因源数据边界无法核验（见 §5.4） |
| 是否创建 Strategy / Candidate / Parameter Search | **否** |
| 是否修改 dataset v8（780001） | **否**（只读、未作为池输入） |
| DB 写入 | **0**（零 DDL / 零 DML；见 §6） |

**三个必须同时知道的边界（不阻塞 Ready，但影响解释）：**

1. `ST / SUSPENSION` 状态行的 `availability=UNKNOWN`、`retrievedAt` 在 2026-09（窗口结束之后）。本池采用**生效日语义**（该项目 Dataset 构建的 PIT ST 权威口径）：状态在 T 日真实生效即视为 T 日可知。**入库时点可知性无法机证**，属 provenance 残余风险（见 §9）。
2. `stock_daily_prices` 在 2026-09-04 之后只剩约 490 行/日（2026-09-07 仅 491 行，而 09-04 为 5,548 行）。因此 2026-09-04 的 T+1（09-07）Open **不可核验**，本报告把它单列为 `executabilityUnverified`，不计入可执行率。
3. 停牌的**真正排除**由「T 日无 bar」驱动（T 日收盘即可观测）；`research_security_status_history` 的 SUSPENSION 区间只用于**归因**。二者冲突仅 4 例（全部 2024-06-13，见 §5.3）。

---

## 1. Task

建立一个**与具体策略无关**的日频「实时候选池」，作为后续所有 TopN / Ranking 研究的统一输入：

- 固定信号时点：**T 日收盘**；
- 所有池字段只能使用 **T 日及之前**的数据；
- 交易执行统一预设为 **T+1 Open**；
- 输出 2019-01-02 ～ 2026-09-04 的每日 Candidate Pool 与统计；
- 额外检查未来信息泄漏 / 重复股票 / 跨日状态错误 / T→T+1 Open 可回测性；
- **不**创建 Strategy / Candidate，**不**做因子组合 / Parameter Search，**不**修改现有策略，**不**修改 dataset v8。

## 2. Baseline Version

- 开工前实查：`git status --porcelain` 共 **103** 条工作区改动（含并发会话未提交改动）⇒ 本次审计对象是**当前 working tree**，不是 HEAD。
- 架构基线：`docs/architecture/SYSTEM-BASELINE.md` **v2.7.0**（`T74-EVENT-GATE-P9-001`）。
- 本任务**未改任何已跟踪源码 / 契约 / schema / migration**，只新增研究工件（`RESULT-*.md`）与 gitignore 下的 `scripts/_scratch/**`。

## 3. Relevant Domains

- **Data / Market Data**：`stock_daily_prices`（T 日 OHLCV+amount）、`liquidity_daily`（市场交易日历）。
- **Security Master**：`research_securities`、`research_security_identifier_history`（code ↔ `securityId`）。
- **PIT Status**：`research_security_status_history`（ST / SUSPENSION）。
- **Board Authority**：`server/data/boardRules.ts#classifyBoard`（main = 数字代码以 `60|000|001|002|003` 开头）。
- 与 **Strategy Core / backtestCore / datasetRegistry / 闭环执行链无关**：本池不进入任何执行路径。

## 4. Pre-existing Facts（实查，非推断）

| 事实 | 读数（本次只读探针） |
|---|---|
| `stock_daily_prices` | 8,898,902 行；2019-01-02 ～ 2026-09-30；5,800 个 code；source 恒 `tushare` |
| 窗口内交易日历三源一致 | `stock_daily_prices` = `liquidity_daily` = `index_daily` = **1,863** 日（2019-01-02 ～ 2026-09-04） |
| 主板 code（`classifyBoard==='main'`） | 主数据 **3,486** 个；其中在行情表出现 **3,386** 个（100 个在窗口内无任何 bar：未上市/退市或新上市尚未入价） |
| 证券主数据 | `research_securities` 5,552 只 stock；`listedDate` 无缺失；337 只已退市 |
| 标识符 | 5,552 条 primary；**无** code 复用、**无** 多 primary 区间 |
| ST 区间 | 全量 841 条；与本窗口重叠 **784** 条 / **703** 只证券 |
| SUSPENSION 区间 | 全量 9,532 条；与本窗口重叠 **3,772** 条 / **1,681** 只证券 |
| 状态来源 | 全部 `baostock-daily`，`confidence=medium`，`availability=UNKNOWN`，`retrievedAt=2026-09-06…09-09` |
| 窗口末行情覆盖 | 2026-09-04 及以前 5,548 bar/日；2026-09-07 起骤降至约 420–504 bar/日（尾部未入价） |
| dataset v8 | `dataset_version.id=780001`，`READY`，2019-01-01 ～ 2026-09-04，73,003 events / 11,832,649 rows；本任务**未读作池输入、未改** |

## 5. Changes

本任务**不改变任何业务代码 / schema / migration / execution path**。新增：

| 文件 | 类型 | 说明 |
|---|---|---|
| `RESULT-REALTIME-CANDIDATE-POOL-001.md` | 研究工件 | 本报告 |
| `scripts/_scratch/_realtime_candidate_pool_001.json` | 数据工件（gitignore） | 完整每日 Candidate Pool + 统计 + 审计 |
| `scripts/_scratch/_realtime_candidate_pool_001.mjs` | 复算脚本（gitignore） | 只读 SELECT，生成上述 JSON |

### 5.1 冻结口径（`RCP-P0-v1`）

**Scope（基础宇宙）**：`securityType='stock'`，`classifyBoard(code)==='main'`（`60|000|001|002|003`，交易所 SH/SZ），且 `listedDate ≤ T ≤ (delistedDate ?? +∞)`。

**按序硬过滤（first-fail 归因，每个成员每天恰得 1 个原因）**：

| # | 原因 | 规则 |
|---|---|---|
| 1 | `ST` | T 日存在生效 ST 区间（`statusType='ST'`，`effectiveFrom ≤ T ≤ effectiveTo`） |
| 2 | `SUSPENDED` | T 日存在生效 SUSPENSION 区间 |
| 3 | `NO_TRADING_BAR` | T 日 `stock_daily_prices` 无该证券行（且未被 1/2 命中） |
| 4 | `OHLCV_INCOMPLETE` | bar 存在但 open/high/low/close/preClose 缺失或 ≤0，或 volume/amount 缺失或 <0 |
| 5 | `INSUFFICIENT_LISTING_AGE` | 自 `listedDate` 起按**市场交易日历**（`liquidity_daily` DISTINCT tradeDate）计的交易年龄 < **120** 个交易日 |
| 6 | `BELOW_TRADABILITY_THRESHOLD` | T 日 `amount < 20,000 千元`（= **2,000 万元**）或 `volume ≤ 0` |
| — | `null` | 以上全部通过 ⇒ 进入 Candidate Pool |

**基础可交易性门槛为什么是 2,000 万元**：这是一个**先验固定**的最小流动性地板（2000 万元/日成交额），用于保证 T+1 Open 下单在多数主板标的上不至于因流动性过差而失真。**在读取任何收益 / outcome / 未来字段之前就已冻结**，未用收益结果反向优化；本报告只报告它造成的剔除数量，不报告任何"按阈值分组的收益"。

**明确不使用**：首板、S、RECLAIM、未来涨幅、未来新高、未来成交量、未来收益、任何 outcome 字段；不使用 `limit_up_records` / `ds_*` 事件或 outcome 表；不使用 `research_securities.status`（当前快照，非 PIT）。

**执行语义**：T 日收盘给出池；T+1 Open 仅作**可执行性审计**，**不参与** T 日筛选（否则构成未来泄漏）。

## 6. Output（工件与编码）

JSON 采用**列式字典**编码以控制体积（全量 universe 5.77M 行）：

```
pool.fields      = [tradeDate, securityId, code, candidatePoolVersion, exclusionReason]
pool.dates[]     = 1,863 个交易日
pool.securities[]= [securityId, code]（3,486 个主板证券）
pool.exclusionReasons[] = [ST, SUSPENDED, NO_TRADING_BAR, OHLCV_INCOMPLETE, INSUFFICIENT_LISTING_AGE, BELOW_TRADABILITY_THRESHOLD]
pool.rows[]      = [dateIndex, securityIndex, exclusionReasonIndex | null]
                   exclusionReason = null  ⇒ 该 (T, securityId) 进入 Candidate Pool
```

- `pool.rows` 共 **5,770,108** 条 = 全量「每日主板上市宇宙」样本；
- 其中 `exclusionReason = null` 的 **4,859,017** 条即 Candidate Pool；
- 排除行同样落盘，使「排除原因（如有）」可逐行审计；
- 顶层还含 `accounting` / `distribution` / `yearlyStats` / `dailyStats` / `leakageAudit` / `duplicateAudit` / `crossDayAudit` / `poolFingerprintSha256` / `gate`。

**解码示例**（取自 JSON 首行）：`pool.rows[0] = [0, 0, null]` ⇒ `tradeDate=2019-01-02`、`securityId=sec_d5e57ebc-…`、`code=000001.SZ`、`candidatePoolVersion=RCP-P0-v1`、`exclusionReason=null`（入池）。

## 7. Statistics

### 7.1 每日候选数分布（跨 1,863 个交易日）

| 指标 | 候选数 | （参考）每日宇宙数 |
|---|---:|---:|
| N | 1,863 | 1,863 |
| Min | **1,372**（2020-02-03） | 2,829 |
| P25 | **2,319** | 3,013.5 |
| Median | **2,661** | 3,163 |
| P75 | **2,959.5** | 3,186 |
| Max | **3,072**（2024-02-28） | 3,204 |
| Mean | 2,608.17 | 3,097.21 |
| StdDev | 356.87 | 119.78 |

### 7.2 各年份候选数量分布

| 年份 | 交易日 | 宇宙行 | **候选行** | 剔除行 | 日均候选 | Min / Median / Max | 候选证券数 | 可执行率* |
|---|---:|---:|---:|---:|---:|---|---:|---:|
| 2019 | 244 | 699,809 | **518,535** | 181,274 | 2,125.1 | 1,488 / 2,080.5 / 2,711 | 2,808 | 99.934% |
| 2020 | 243 | 717,114 | **566,684** | 150,430 | 2,332.0 | 1,372 / 2,307 / 2,665 | 2,826 | 99.946% |
| 2021 | 243 | 750,951 | **564,516** | 186,435 | 2,323.1 | 1,890 / 2,291 / 2,759 | 2,997 | 99.959% |
| 2022 | 242 | 762,501 | **649,947** | 112,554 | 2,685.7 | 2,430 / 2,687.5 / 2,899 | 3,090 | 99.966% |
| 2023 | 242 | 771,522 | **661,502** | 110,020 | 2,733.5 | 2,497 / 2,727.5 / 3,013 | 3,144 | 99.980% |
| 2024 | 242 | 771,516 | **678,123** | 93,393 | 2,802.2 | 2,138 / 2,930.5 / 3,072 | 3,147 | 99.976% |
| 2025 | 243 | 772,823 | **728,767** | 44,056 | 2,999.0 | 2,829 / 3,008 / 3,058 | 3,145 | 99.966% |
| 2026（至 09-04） | 164 | 523,872 | **490,943** | 32,929 | 2,993.6 | 2,887 / 2,993 / 3,044 | 3,123 | 99.966%* |

\* 可执行率=可核验 T+1 Open 的比例；2026 另有 3,000 条（2026-09-04 当日候选）因窗口边界**不可核验**，不计入分母。

### 7.3 各类硬过滤剔除数量（全窗口）

| 原因 | 数量 | 占剔除 | 占宇宙 |
|---|---:|---:|---:|
| `BELOW_TRADABILITY_THRESHOLD`（<2,000 万元） | **577,939** | 63.43% | 10.016% |
| `ST` | **256,323** | 28.13% | 4.442% |
| `INSUFFICIENT_LISTING_AGE`（<120 交易日） | **67,126** | 7.37% | 1.163% |
| `SUSPENDED` | **9,673** | 1.06% | 0.1676% |
| `NO_TRADING_BAR`（未归因缺失） | **30** | 0.0033% | 0.00052% |
| `OHLCV_INCOMPLETE` | **0** | 0% | 0% |
| **合计剔除** | **911,091** | 100% | 15.79% |
| **入池候选** | **4,859,017** | — | 84.21% |
| **盘账** | `5,770,108 = 4,859,017 + 911,091` | ✅ 平 | |

### 7.4 缺失数据比例 / 停牌剔除比例

| 指标 | 值 |
|---|---:|
| 停牌剔除比例（`SUSPENDED / universe`） | **0.1676%**（9,673 / 5,770,108） |
| 缺失数据比例（`NO_TRADING_BAR / universe`） | **0.00052%**（30 / 5,770,108） |
| OHLCV 不完整比例 | **0%**（0 / 5,770,108；Tushare 日线该窗口无缺字段） |
| 缺失合计（NO_BAR + OHLCV_INCOMPLETE） | **0.00052%** |
| 非主板（out-of-scope）上市样本 | **2,837,881** 行（不计入池账；全市场上市样本 8,607,989 行） |

> 说明：本窗口内 A 股「长停牌」已显著减少，且停牌必有「无 bar」；因此 `SUSPENDED` 与 `NO_TRADING_BAR` 两项都很小。`NO_TRADING_BAR` 只统计**未被 SUSPENSION 区间解释**的缺失，是纯粹的未归因数据缺口。

## 8. Audits

### 8.1 是否存在未来信息泄漏 —— 未发现

**静态口径（按信息时点逐列声明）**：

| 输入 | 时点边界 |
|---|---|
| `stock_daily_prices` | 只用 `tradeDate = T`（T 日 OHLCV / amount） |
| `research_security_status_history` | 只取 `effectiveFrom ≤ T ≤ effectiveTo`（ST / SUSPENSION） |
| `research_securities` | `listedDate` / `delistedDate`（静态主数据；用于 T 日存在性，不读 `status` 快照） |
| `liquidity_daily` | 只取 `DISTINCT tradeDate` 作**外生日历**（计算上市交易年龄） |
| 未读 | `ds_*` event/outcome、`limit_up_records`、首板/S/RECLAIM、任何未来涨幅/新高/成交量/收益 |

**动态 as-of replay（独立路径）**：对 4 个采样日，用**只允许 `tradeDate ≤ T` / `effectiveFrom ≤ T`** 的独立查询重算当日池，与主流水线逐 securityId 对比：

| 采样日 | as-of 池 | 主流水线池 | 仅在 as-of | 仅在主 | 结论 |
|---|---:|---:|---:|---:|---|
| 2019-06-28 | 2,109 | 2,109 | 0 | 0 | ✅ 一致 |
| 2021-06-30 | 2,211 | 2,211 | 0 | 0 | ✅ 一致 |
| 2023-06-30 | 2,773 | 2,773 | 0 | 0 | ✅ 一致 |
| 2026-09-04 | 3,000 | 3,000 | 0 | 0 | ✅ 一致 |

**结论**：池内成员与 T+1 Open 完全解耦（T+1 只出现在审计字段）；未发现未来信息泄漏。**残余风险**：ST/SUSPENSION 的入库时点可知性无法机证（见 §9.1）。

### 8.2 是否存在重复股票 —— 否

| 检查 | 结果 |
|---|---|
| `(tradeDate, securityId)` 重复 | **0** |
| 每日宇宙内重复成员 | **0** |
| 行数对账 | `rowCount 5,770,108 = Σ每日 universe 5,770,108` ✅ |
| 跨日重复是否算错误 | **否**：同一股票在不同交易日重复出现是日频横截面的设计语义（每日独立一行） |

### 8.3 是否存在跨日状态错误 —— 否

| 检查 | 结果 |
|---|---:|
| 上市交易年龄单调性违例（`age(T) < age(T-1)`） | **0** |
| 相邻交易日年龄步长违例（`age(T) - age(T-1) ≠ 1`） | **0** |
| 检查证券 / 日期 | 3,486 只 / 5,770,108 个宇宙行 |
| 候选早于 `listedDate` | **0** |
| 候选晚于 `delistedDate` | **0** |
| 候选落在生效 ST 区间 | **0** |
| 候选落在生效 SUSPENSION 区间 | **0** |
| 候选当日无 bar | **0** |
| OHLCV 结构一致性违例（high/low 与 open/close 矛盾） | **0** |

**唯一已知冲突（已如实登记，不阻塞）**：4 条主板样本同时存在「SUSPENSION 生效」与「当日有 bar」——`600647.SH` / `600766.SH` / `603133.SH` / `002087.SZ`（均 2024-06-13，单日区间）。按 first-fail 归因它们仍被 `SUSPENDED` 剔除；这是 source 侧区间边界噪声，不影响池的自洽性。

### 8.4 是否能够支持 T → T+1 Open 的回测 —— 支持（99.96%）

| 项 | 值 |
|---|---:|
| 候选行（全窗口） | 4,859,017 |
| 已核验（下一交易日源覆盖完整） | **4,856,017** |
| 其中 T+1 Open 可执行 | **4,854,201（99.9626%）** |
| 其中不可执行 | **1,816**（全部为「下一交易日无 bar」，无「Open 缺失/非正」） |
| 不可核验（窗口边界） | **3,000**（2026-09-04 当日候选；其 T+1=2026-09-07 源覆盖仅 491/5,548） |

分年不可执行数（不含不可核验）：2019 = 341；2020 = 306；2021 = 231；2022 = 224；2023 = 131；2024 = 166；2025 = 251；2026 = 166。**说明**：T+1 无 bar 的 1,816 例等价于下一交易日停牌/退市，是回测执行端必须显式处理的真实不可成交情形，**不应**通过未来信息把它从 T 日池里提前剔掉。

## 9. Impact

### 9.1 Contract Impact

- **无**：不新增/修改 `shared/**` 契约、tRPC 路由、tRPC 顶层 key、前端入口；不创建第二套 SoT。
- Candidate Pool 是**研究输入工件**，不是 Strategy / Candidate / Run / Dataset Version；不占用 datasetVersionId。

### 9.2 DB Impact

- **零 DDL / 零 DML / 零 migration**；全部为只读 SELECT。
- 未触碰 `dataset_version` / `dataset_build_config` / `ds_first_limit_pullback_*`；dataset v8（780001）保持原样。
- 未导出任何凭据；未把生产数据写回仓库（工件在 gitignore 的 `scripts/_scratch/**`）。

### 9.3 Execution Impact

- **无**：池不进入 Strategy Core / backtestCore / simulator / Parameter Search / OOS / WFA / Paper Trading 任何执行路径。
- T+1 Open 语义与既有执行口径一致（T 日收盘信号 → 下一交易日 Open），但本任务只做**可执行性审计**，不新增撮合实现。

## 10. Tests / Verification

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run check` | **0 error（exit 0）** |
| 行尾漂移 | `node scripts/checkEolDrift.mjs --strict` | **0**（见 §11 收尾） |
| 增量测试 | 本任务**未改任何已跟踪源码/契约** ⇒ 对被测代码的 affected set 为空；不新建可被仓库测试图引用的代码 | 不适用（无新增失败面） |
| 数据自检 | 池脚本内建（账平、行数对账、年龄单调、逐日去重、4 日 as-of replay） | 全部 PASS |
| JSON 有效性 / 行数 | 独立解析工件 | `JSON.parse` 成功；5,770,108 行；null 行 = 4,859,017 |

> 说明：`pnpm run test:changed` 会按 git 工作区改动（含并发会话的 103 条改动）反推受影响测试，与本任务无关且成本高；由于本任务对已跟踪代码的净改动为 0，按「零新增失败面」处理，未跑全量 `pnpm test`（全量含已知恒红环境用例）。

## 11. Baseline Update

**无 baseline 文档更新**：本任务不是实现细节变化、不是 Domain 状态跃迁、不新增 entry point / contract / 表 / 执行路径，因此按 `AGENTS.md` §8 不更新 `CHANGE-AUDIT.md` / `SYSTEM-BASELINE.md` / `system-manifest.yaml`。本文件即研究工件本身。

## 12. Remaining Risks

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| R1 | ST / SUSPENSION 行 `availability=UNKNOWN`、`retrievedAt` 在窗口结束后 ⇒ 状态**区间边界**的入库可知性无法机证 | 中 | 采用项目既有 PIT ST 生效日权威口径；停牌由「T 日无 bar」独立保证（T 日可观测）；如需严格 ingestion-PIT，需补一份「按公告日可得」的 ST 状态源 |
| R2 | 窗口最后一天（2026-09-04）T+1 Open 不可核验 | 低 | 已单列 `executabilityUnverified=3000`，不计入可执行率；等 2026-09-07 行情补齐后可复算 |
| R3 | 4 条 SUSPENSION 与 bar 冲突（2024-06-13） | 低 | 已按 SUSPENDED 剔除并登记；不改变任一入池成员 |
| R4 | 「上市满 120 交易日」用 `liquidity_daily` 市场日历；若该日历在历史早期或有缺日，会影响早期上市年龄恰好卡边的极少数样本 | 低 | 已在窗口内三源日历一致性验证（1,863 日完全一致）；建议后续用官方交易日历表替换 |
| R5 | 基础门槛 2,000 万元使 2019-2021 早期年份剔除较多（2019 剔除 140,315 行） | 低-中 | 门槛已先验冻结、禁止按收益反向优化；如需更保守池，应在**看到收益前**另行冻结新版本（如 `RCP-P0-v2`）而不是本任务内调参 |
| R6 | 主板口径含原中小板 002/003（2021-04-06 已并入深主板） | 低 | 与仓库权威 `classifyBoard` 一致；如需「2021 前仅 000/001/600/601/603/605」，应作为显式新版本而不是隐式修改 |

## 13. Next Step

1. **只读验收**：以 `scripts/_scratch/_realtime_candidate_pool_001.json` 为统一输入，先做 TopN / Ranking 研究；
2. 若需要入仓级可复现工件，应将复算脚本沉淀为 `scripts/`（非 `_scratch/`）并登记 `CHANGE-AUDIT.md`（本任务未获授权，未做）；
3. 若研究进入执行阶段，应把 T+1「无 bar / 无法成交」的 1,816 例作为 simulator 的显式不可成交分支，而不是在 T 日池里提前剔除；
4. 如需严格 ingestion-PIT，另开任务补齐 ST/SUSPENSION 的「公告可得日」数据源，并复算池版本 `RCP-P0-v2`。

## 14. Gate

```
Gate: CANDIDATE_POOL_READY

理由：
  - 账平：universe 5,770,108 = candidate 4,859,017 + excluded 911,091；Σ excludedByReason = 911,091
  - 未来信息泄漏：as-of replay 4/4 完全一致（0 对称差）
  - 重复股票：0
  - 跨日状态错误：0（年龄单调 / 上市-退市边界 / ST / 停牌 / 无 bar 全部通过）
  - T→T+1 Open：已核验 4,856,017 条，可执行率 99.9626%
  - dataset v8 / 策略 / 执行链：0 改动，0 DB 写入

非阻塞警告：
  - T_PLUS_1_OPEN_UNVERIFIED_SOURCE_COVERAGE_ROWS=3000（窗口最后一天）
  - ST_STATUS_INGESTION_KNOWLEDGE_UNVERIFIED（availability=UNKNOWN / retrievedAt=2026-09）
  - SUSPENSION_BAR_CONFLICT=4（2024-06-13，已按 SUSPENDED 剔除并登记）
```