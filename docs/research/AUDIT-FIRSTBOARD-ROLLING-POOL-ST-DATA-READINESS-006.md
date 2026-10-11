# AUDIT · ST-DATA-READINESS-006 独立核查

> **用户决策更新（2026-10-11）**：本轮保留 Dataset 780004，暂不重建；此前重建建议属于未执行的历史提案，不是当前必做前置。历史 ST 检查独立处理，报告披露现有数据局限。详见 [保留数据集决策](DECISION-FIRSTBOARD-ROLLING-POOL-KEEP-DATASET-780004.md)。

核查时间：2026-10-11 16:03（Asia/Shanghai；中途产物快照）。

## 1. Task / Baseline / 当前完成状态

用户要求分析手动执行的 006 任务。基线为 HEAD `f8b6810347aa5950d1f9b95eaadc73308b68ac21` 加当前未提交工作区；已先检查 git status，不覆盖并发改动。

截至本次核查，IMPACT、S1 实测 JSON 与四份 S2 CSV 已存在；`RESULT-FIRSTBOARD-ROLLING-POOL-ST-DATA-READINESS-006.md`、`s2-requirement-summary.json`、`s2-equivalence-report.json` 尚未落盘。PID 3052 为 tsx 启动器、PID 6896 为实际 Node 执行进程，两者命令均为 S2 `--equivalence`；它们不是两个独立实验。脚本在写完 CSV 后才开始 rd1..80 对照，之后写汇总。因此不能把目前产物判为任务已经最终验收。

这是数据就绪审计，不是收益实验。没有证据支持新的收益结论、破位修复优于原规则或因子排序有效。

## 2. 已确认的发现

### 2.1 当前状态来源不足

S1 实测：ST 维度 841 行、734 个证券身份，全部 ST；NORMAL 与 *ST 均为 0；841 行 availability 均为 UNKNOWN，研究窗口结束前的 retrievedAt 为 0 行。`server/securityStatus/baostockStatus.ts#inferStIntervals` 仅存 isST=1 的合并片段，confidence 为 medium，不能将无记录解释为 NORMAL。

这证明的是“现有记录在现有严格契约下不可直接供给正式买入判定”，不证明外部历史来源不可获取，也不证明股票实际都是 ST/UNKNOWN。

### 2.2 windows 续跑漏预热确有代码证据

`server/datasetRegistry/builder.ts#build` 的 windows 续跑直接读取事件，跳过 `#buildEvents`；而 `loadSecurityIndexes()` 仅在 buildEvents 内调用。随后 `#buildWindowsAndOutcomes` 使用同步状态解析。`server/datasetRegistry/db.ts#resolveStSync` 在未预热时退化 UNKNOWN。应修复共同前置条件，并测试首次构建与 windows 续跑结果一致。

Dataset 780004 全部 post 共 4,718,640 行，5% 涨跌幅字段只有 7,368 行。S1 在主窗口 rd1..20 的 368,620 格中找到与平台 ST 片段重叠的 973 格，全部仍为 10%，其中 canBuyAtOpen=1 为 962 格。**这是记录间的不一致，不是 973 笔真实 ST 买入，也不是已验证的 ST 真值。**机制及作业时间线与退化相符，逐行作业归属未证明。

### 2.3 已有清单远大于真正的入场检查集合

独立使用 Python CSV 解析器逐行统计并计算 SHA-256，未重新扫描数据库或运行策略。

| 产物 | 实际数据行数（不含表头） | SHA-256 |
|---|---:|---|
| required-status-checks.csv | 61,579 | f421b1e26503165b64248dd8e48a48fcfe7ec847ee88c643ff5a5e4ee60fb72d |
| required-observation-days.csv | 780,400 | 60ccff4d414087711ccaef8295a36899787daa5c136f90d6b46007de3946d4c1 |
| status-gap-requests.csv | 507,358 | e7183ceed5e1eb54e6935b3acfaab98b084666bfb29b70b660d828600f0692bc |
| status-gap-requests-map.csv | 841,979 | 077b374b8f37b304598b60293aab4a4c548b9882151157cfc4537fcdee43a46a |

只取事件日 ST、价格候选确认日收盘 ST、拟成交日前 ST 三种 purpose，按 `(symbol, securityId, checkDate, timepoint)` 去重：

| 必需状态检查 | 去重需求 |
|---|---:|
| 事件日 ST 资格 | 19,441 |
| 候选确认日收盘 | 1,300 |
| 拟成交日前 | 1,300 |
| 合计 | **22,041** |

覆盖 2,837 个股票代码，日期为 **2023-11-06 至 2025-10-09**，全部 UNKNOWN。暖启动事件与下一交易日成交使必需范围越出主窗口，不能只补 2024-01-02 至 2025-09-30。

观察日中 779,100 行仅用于归因，1,300 行参与入场资格；全部 1,300 行已被上述确认日键覆盖，额外必需键为 0。507,358 格是包含归因观察的扩展需求；不宜作为开跑必需采购量或强制补齐量。必需集合约占扩展集合 4.34%。这些是本次诊断脚本输出中的静态资格需求；**不是对所有身份、策略执行尾部和账户成交的最终就绪保证**。

A_STRICT_20 有 328 个原始价格候选，B_RECOVERY_20 有 1,300 个；候选代码共 771 个。跨组候选累计 1,628 行，不能当成 1,628 笔交易。该数仅来自 rd1..41，等价性产物未出，不提前宣布与正式 rd1..80 完全一致。事件上市龄被明确记为未逐锚点核查，非次新资格仍应完成低成本核对。

## 3. IMPACT 方案实施前需要补正的四点

1. **指纹必须包括判决相关字段。** §1.2 的行级哈希遗漏 availability/availableAsOf、confidence、覆盖依据、派生协议版本与证据。只改可信度或可知时间时可能得到相同 sourceFingerprint，缓存与 Run 归档无法区别。补充这些稳定字段及原始来源快照指纹；不要纳入每次运行的当前时间。
2. **先过滤实际时点与可知性，再选冲突记录。** `server/securityStatus/timeline.ts#resolveSecurityStatus` 是日期级接口，并不直接提供所有 ST 闸门事实元数据。不能先用日期级 latest 选一条，最后才让 09:15 闸门拒绝：当日下午才生效的记录会遮蔽早上仍有效的记录。需明确保留完整源事实、按实际 effectiveAt/availableAsOf 过滤再复用确定性优先级的方案，并增加同日 09:15/15:00 对照。不得为此悄悄更改状态权威语义。
3. **不能用实际持有天数反推出未观测的尾部需求。** §5.2 的 `fillRd + 实际持有天数` 主要描述已观测路径；缺尾导致的未平仓或截断会低估本来需要的数据。应分开记录已观测退出日、策略触发后计划持有上限、实际缺 bar/不可卖/截断、未平仓与 Runner 延长触发证据，再判尾部是否足够。provider 是当前首个阻塞；不是其修好后唯一剩余阻塞。不能提前保证 post80 足够。
4. **先验证来源可得性，再决定大规模补数和重建。** 交易所历史来源目前未核实；日线 isST=0 的显式观测与“缺数据推断为正常”必须区分。本地模块说明将日线合并成区间存在边界推断，不等于原始正常观测不存在；不过当日收盘字段仍不能直接证明当日 09:15 已可知。应先用 ST 转入、摘帽、隔夜变更、无记录、身份边界等小样本验证证据和发布时间，保持严格闸门，不凭字段自行升级可信度。

附：缺口 CSV 的 groups 存在如 `A_STRICT_20|A_STRICT_20|B_RECOVERY_20|B_RECOVERY_20|COMMON` 的重复标签。原因是合并后的组字符串又作为 Set 元素与单组混用；后续消费应拆成原子组再去重，映射表保留逐锚点用途。该问题不改变上述按身份/日期/时点统计，但会影响按组聚合。

## 4. 性能判断与下一步

S1 的 48 个查询耗时 798,771 ms（约 13 分 19 秒），无查询失败。S2 `loadPost(maxRd)` 按相对日再按事件块串行查询，41 与 80 两轮合计重复读取 rd1..41。首次对照有验证价值，但后续不应每次重做；应保存输入坐标/字段/来源指纹的可复用快照，再从一次读入的数据投影所需窗口，测量候选一致性与 IO 时间。**41 日读范围只涉及买点诊断，不代表收益回测只需 41 日。**

建议顺序：

1. 当前执行进程完成后，补齐 RESULT、汇总、等价性判定和日志，核对本审计 CSV 哈希；不同则重新核查快照。
2. 将 22,041 个必需状态键与归因键明确分账；用小样本核验已有/候选来源的历史状态、真实生效时间、可知性与完整性；先给出可供审核的协议和成本。
3. 修复 windows 续跑共同前置条件，用合成输入验证与完整构建一致；不重写 780004。
4. 数据协议确定后实现只读 provider，补正指纹与实际时点的冲突选择，并评估新 Dataset 执行字段和尾部的影响。
5. 数据与执行条件均通过，再做原 004 六账户 SMOKE；通过后再做 STUDY。池化缺省 NORMAL 的显式政策属于另一直接消费链，不能插入为本次 004 必做前置。

## 5. Changes / Contract / DB / Execution / Tests / Baseline

本次仅增加独立分析文档、CHANGE-AUDIT 条目和忽略目录中的 CSV 核查脚本/JSON。未修改业务代码、Dataset、策略、状态契约或撮合；0 DDL/DML、不重跑实验，不干预原执行进程。没有架构版本跃迁；只更新 CHANGE-AUDIT。

CSV 计数、哈希和必要键包含关系已独立验证。未改业务实现，不重复此前业务测试。严格 EOL 实查：已跟踪漂移 0；既有未跟踪 `_scratch/overlap/probe01_db_state.mjs` 为 CRLF，故全仓检查非 0，未触碰该文件，不声称全仓通过。

独立机器证据：`scripts/_scratch/st-data-readiness006/independent-review-csv.json` 与 `independent-essential-summary.json`。scratch 受 gitignore 保护；跨机交接前应由执行方归档必要证据，不能只传文档路径。
