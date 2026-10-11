# AUDIT · 首板滚动池 ST 执行修复独立验收

审查人：Codex；日期：2026-10-11。对象：HEAD `f8b6810` 加当前未提交工作区，非仅 HEAD。执行者：DeepSeek Harness 桌面应用。依据：[修复方案](PLAN-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md)、[执行报告](RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005.md)。

## 1. 判定

**专项代码验收通过，允许进入一次 SMOKE 数据前置复验。当前不能批准收益矩阵。**

没有发现本轮新增测试失败或行尾漂移；全仓仍有既有失败，因此不声称仓库总体 DoD 全绿。历史 ST 数据与行情尾部门禁未因代码修复自动满足。第二阶段必须在数据门禁、6 账户 SMOKE 和同输入性能等价全部通过后，才可执行 42 账户 STUDY。

## 2. 已核对的修复

1. `server/research/simulator/engine.ts#runTradeSimulation`：声明 `executionEligibilityGate` 的买入，在实际执行日检查资格，发生在报价、扣款、持仓、成本及成交计数变化之前。只有显式允许且状态为 NORMAL 才继续。ST/UNKNOWN 拒单；卖出不受该新增分支影响。逐笔审计与成交 NORMAL 断言已接入。
2. `research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment.ts#run`：确认日资格与排序、成交前拒单分工明确；R 与 Random 注入同一政策，二次入场也检查。下一交易日状态不用于补选原第 4 名。
3. Codex 复审发现辅助 `runCompositeRunnerBacktest` 会顺带撮合却未接入闸门，第一次交付因此未获批准。续修以 `server/research/compositeRunner/index.ts#assembleCompositeRunnerSimulationConfig` 替换该调用，只装配配置。旧组合回测入口复用同一装配实现后调用唯一撮合入口；真实装配/撮合测试覆盖零辅助撮合、配置等价、隔夜 ST 拒单和正常成交正对照。没有新造回测执行链。
4. `research-experiments/shared/rollingPoolRecovery/stGate.ts#evaluateStGate`：有效区间与可知性统一使用实际 `effectiveAt`；日期终点覆盖完整日，精确时间保持精确端点，无效格式拒绝。独立 6 个边界探针通过。
5. provider 缺失时不扫描 post rd≥1、不冻结候选、不撮合；未测计数为 null，保留 `ST_COVERAGE_BLOCKED`。
6. 发现 manifest 从陈旧版本递增而与基线头部不一致，已登记 BASELINE_DRIFT 并统一 v2.8.0。历史内容保留；契约与执行地图已更新。

## 3. Codex 独立执行证据

日志目录：`scripts/_scratch/recovery-st-fix005/`。均在本机当前工作区执行，输出先落盘。

| 检查 | 结果 | 证据 |
|---|---|---|
| 修改前定向基线 | 9 文件 / 141 例通过 | `codex-before-tests.log` |
| 最终类型检查 `pnpm run check` | exit 0 | `codex-final-check.log` |
| 修复、simulator、compositeRunner 定向回归 | 18 文件 / 190 例通过，exit 0 | `codex-final-tests.log` |
| 003 观察窗口回归 | 1 文件 / 31 例通过，exit 0 | `codex-final-observation.log` |
| `pnpm run test:changed` | 4 文件 / 10 例失败，2379 例通过；exit 1 | `codex-final-test-changed.log` |
| 失败集合比较 | 10 条 FAIL 标题逐条相同，零新增失败 | 与执行者修改前 `baseline-test-changed.log` 比较 |
| 缺省关闭闸门的固定输入指纹 | 前后完整 JSON payload 深层相同 | `probe-digest-before.json` 与 `probe-digest-after3.json`，剥离包装日志后比较 |
| ST 时间独立探针 | 6 / 6 通过 | `codex-time-acceptance.log` |
| `checkEolDrift --strict` | exit 1；tracked 漂移 0 | `codex-final-eol.log` |

既有失败来自 `datasetFilterForm`（2）、`limitUp`（1）、`limitUp.watch`（4）、`threeFactorTopNStrategyDocument`（3）。行尾非 0 仅来自其他会话未跟踪的 `_scratch/overlap/probe01_db_state.mjs`（CRLF）；未修改该文件、未扩大忽略规则。以上问题未被本次测试掩盖。

## 4. 影响与剩余边界

- 契约：新增可选执行资格闸门和只装配配置入口；ST 契约为 1.1.0。缺省未启用闸门的旧行为指纹保持一致。
- 数据库：本修复无 DDL、DML、migration、历史 Run 回填或新 Dataset。
- 执行：删除每组一次结果被丢弃的辅助撮合；正式账户仍走权威 simulator。没有真实性能基准，不能量化提速。
- 保留原研究口径：T+20、五日观察、破位修复、二次入场、TopK、因子、Runner、成本、seed 及当日权益比例。
- 未验证真实 42 账户收益。默认 provider 仍缺失；可靠 NORMAL/ST 覆盖、PIT 可知性、948 个行情格字段一致性及理论 rd94/95 尾部条件均须按数据门禁处理。
- 装配配置指纹是元数据对账字段，不替代 tradeDigest/equityDigest 或输入内容指纹；函数名占位不能证明两个闭包行为相同。

## 5. 下一步

由 Codex 向当前 DeepSeek 桌面会话发出第二阶段指令：调用既有运行工具 SMOKE 一次；若门禁失败，交付具体阻断与补数要求，停止 STUDY。不要重复证明相同缺口，不用空仓收益评价策略。新数据引入、历史批量回填、新 Dataset 与 DDL 仍需具体影响报告及单独授权。

## 6. 第二阶段执行结果复核（2026-10-11）

用户自行向桌面端提交第二阶段指令后，Codex 核对 [复验报告](RESULT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-FIX-005-REVERIFY.md)、`scripts/_scratch/recovery-st-reverify/{smoke.log,run-meta.txt}`、`_scratch/fbp4/smoke-outcome.json` 及全部 6 个产物。

**判定：复验报告的核心结论与实际产物一致；数据前置明确阻断，研究尚未完成。**

- SMOKE 工具退出码 3；墙钟 25.6 秒、工具自报 18.1 秒、框架执行主体 5,479 毫秒，三者测量边界不同。不得把这次快速诊断当作完整矩阵提速证明。
- Runner 的 `runStatus=SUCCEEDED` 表示成功交付诊断；研究状态为 `ST_COVERAGE_BLOCKED`。`matrixEmitted=false`、`primaryComparison=null`、实际结果 `groups=[]`。配置里的 6 账户是计划规模，不是已执行账户。
- 扫描 58,983 个首板事件，其中 39,473 个在主窗口外，窗口内剩余 19,510 个事件；这些均不是交易数或唯一股票数。`postRowCount=0`、`barQueryCount=0`、`forwardDataRead=false`，未冻结样本、未解析身份、未撮合。
- provider 缺失的 4 次探针均为 UNKNOWN；未扫描的计划候选和覆盖分母为 null。覆盖 CSV 仅表头，收益和交易结果未生成。没有证据支持 A/B 优劣、因子排序有效性或复合收益结论。
- 直接实现 `experiment.ts#resolveStatusProvider` 仍无条件 `return null`。修复执行闸门不等于已接入真实历史状态源；重复 SMOKE 无法解除该阻断。
- 6 个产物 codeDigest 一致。独立断言与文件 SHA256 核对通过，日志为 `scripts/_scratch/recovery-st-reverify/codex-review.log`。当前 compositeRunner 的 SHA 为 `24e03e0f…`，与更新后的第一阶段报告一致；此前 `1bb5f1e6…` 对应修正文档注释前的快照（澄清装配仍可能只读查询），不可据此误报执行逻辑改变。

剩余交付不足：复验报告 §7.3 只说明如何生成最小补数清单，尚未交付实际 `symbol × 日期 × 检查时点` 清单。报告中的 2,378/2,827、948 格及历史 availability 信息来自此前 S1 审计，不是本次 SMOKE 重新测得；尾部 rd94/95 条件本次也未检查到。

下一步应先只读核查可用历史 ST 来源、证据与覆盖范围，并提出 provider 接入及 windows 续跑索引缺陷的具体影响方案。NORMAL 可以来自有穷尽性证据的历史状态重建，不必机械要求每股票每天新增一行；没有覆盖依据则保持 UNKNOWN。涉及研究语义、新数据、回填或新 Dataset 的动作仍另行裁定。数据条件具备后才重跑 SMOKE，再考虑 STUDY。本次审查未重跑实验、未调用桌面端、未改业务代码或数据库。
