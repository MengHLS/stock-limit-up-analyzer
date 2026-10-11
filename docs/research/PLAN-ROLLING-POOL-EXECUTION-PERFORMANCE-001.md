# PLAN · 滚动池实验执行时间优化

> 标识：`ROLLING-POOL-EXECUTION-PERFORMANCE-001` · 2026-10-11 · 待执行。
> 适用：[修复/ST实验004](GOAL-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004.md)。本方案是实现指令，未宣称提速已经完成。

## 1. 已测事实与尚未测定的瓶颈

上一轮本地日志 `_scratch/fbp3/precheck.log`：完整1005账户预检2056.2秒；`formal.log`：正式2066.3秒。两次约 **68.7分钟**；正式Run执行字段2013888ms约33.6分钟，与工具端到端34.4分钟区分。没有这些日志时从Run产物读取并记录来源，不虚构阶段占比。这些数字不包括开发、测试和后续归因，不代表其他实验都只耗时34分钟。

正式输入记录：事件全扫描58,983，冻结19,510；post约1,560,800行，barQueryCount890；执行投影151,774行、1,899事件作用域证券、496交易日。这些是上一轮事实，新修复信号更多时规模可能扩大。

代码可见的重复工作，不等同于测定的耗时主因：

| 位置 + 符号 | 机会 | 边界 |
|---|---|---|
| `tests/tools/rollingPoolObservationWindowRun.mts` 的precheck/formal分支 | 预检实际重复执行全矩阵 | 004独立模式，小规模检查；旧脚本语义保留 |
| `rolling-pool-observation-window/experiment.ts#run` 的逐账户循环 | 1005次独立撮合，且每组额外装配并运行一个随后丢弃的R | 减少本轮矩阵；权威装配只取配置，或复用同配置的有效结果 |
| `server/research/simulator/engine.ts#runTradeSimulation` | 每账户绑定/检验Dataset、全行rowKeys、Runner bars分组等 | 先profile；共享经验证的不可变准备数据，账户状态独立 |
| `server/research/datasetAccess/handle.ts#bindResearchDataset` | 每次扫描行验证PIT/日期/唯一性 | 不能跳过验证，需一次验证后不可变准备对象及可靠失效 |
| `server/researchExperiments/rollingPoolExecutionSupport.ts#sealRollingPoolExecutionDataset` | 每个交易日 `rows.filter` 做全行扫描 | 单次按日期索引代替重复过滤；排序和封装指纹保持 |

当前没有可信的查询/撮合/统计/持久化阶段分解，不能据此承诺2倍或10倍提速。

## 2. 先建立可比基线

使用 `server/observability/perfProfile.ts` 现有剖析器，开关在进程导入前设置。Windows用PowerShell环境赋值或脚本启动参数，符合AGENTS；调用实际导出的报告接口落盘，不假设设置OUT后自动导出。

记录：全扫描、prefix/post批次、ST历史一次加载/解析、规则投影、排序/随机计划、执行投影、权威装配、dataset_bind、row_precheck、Runner准备、decision_day_loop、canonicalMetrics、归因/bootstrap、序列化/对象存储。输出wall/self/calls、DB请求数、行数、RSS峰值、冷/热缓存和机器/进程参数。

固定同一数据、两组R+两个seed，共6账户作为新代码优化前后基准。工程回归基准和收益研究分开；保留未优化实现/开关作为对照，避免拿1005旧账户与42新账户的时间比冒称引擎加速。重复热基准可小范围运行2次验证波动；不再用全研究矩阵验证性能。

## 3. 实施顺序：先减少重复，再改热点

1. **缩小本轮矩阵与预检**：004 SMOKE为6账户，STUDY为42；移除完整矩阵预检重复。42相比1005账户数约为4.2%，只是工作量变化，数据加载和更宽候选规模仍存在，不能直接推算24倍提速。缩小随机数牺牲分布精度，报告明确探索性。
2. **输入/投影复用**：同Run只扫描和冻结一次；PIT状态历史一次加载、按symbol/时点解析；逐日观察与修复证据、各组R排序和执行投影一次构建。复用完整授权执行视界，不能为了快只读20天退出行情。
3. **复用权威装配**：审计 `runCompositeRunnerBacktest` → `assembleRunWorkbenchInputs`。在既有链提供最小「装配配置」入口，或复用可证明同配置的装配运行；不能复制默认成本/退出配置，更不能另造撮合器。旧API结果保持不变；新入口需基线登记。
4. **索引和准备缓存**：先将已测热点中的日期成员分组改为一次索引。若重复binding/Runner构造占比显著，建立run作用域的不可变prepared输入，复用handle、日期切片、行存在集合和Runner历史bars。所有外部新输入仍完整校验，候选sourceRun指纹仍逐账户验证。
5. **断点与缓存**：若S5仍长，按账户写内容寻址checkpoint；恢复时加载已完成账户，剩余账户继续，最终按group/accountIndex稳定汇总。正式结果只由完整42账户形成，不把恢复变成多个基准不同的Run。断点能力若无法接入现有生命周期，先只支持诊断工具，报告限制，不伪造平台续跑。
6. **可选进程/worker并行**：仅在profile确认CPU热点且内存足够后实施，默认最多2worker。每个worker调用同一权威引擎，独立状态、独立profile和固定seed；共享只读来源、稳定汇总。同步CPU计算外包 `Promise.all` 不算并行。无需并行即可达到本轮小闭环时不扩大Scope。

前3项为本轮必做的流程优化；第4项只修改测得热点及必要最小模块；第5/6项按收益/成本决定并如实报告是否实施。避免为一次研究重写执行器。

## 4. 缓存和恢复正确性

缓存键至少包括：datasetVersionId、内容/投影指纹、列及相对日要求、扫描/冻结样本口径、价格/公司行为版本、ST来源覆盖和状态源摘要、解析版本及asOf政策、研究配置/代码指纹、执行政策/成本版本、日期范围；账户结果再加group、seed、sourceRun及simulationConfig指纹。仅同label或同object引用不足以证明内容一致。

跨Run文件缓存经平台合法数据端口产生，带来源manifest和校验；新Run仍履行 FULL_DATASET、usesForwardData、freezeSelection及ArtifactStorage要求，不能直接载入缓存绕开Dataset审计。先实现同Run复用即可，跨Run缓存不是完成004的前提。

prepared对象必须确实不可变或有受控所有权和内容校验。TypeScript readonly / WeakMap本身不防输入修改；原数组可变时缓存必须拒绝复用或失效重建。时间窗口、ST状态源、参数、代码、退出配置任一变化，旧缓存及checkpoint不复用。

订单、现金、持仓、峰值、Runner状态、账户曲线、可变随机状态全部不缓存为共享状态。所有允许前视的执行行情只能供当前模拟日及以前的决策接口取用；缓存未来行情不授权未来参与评分。报价/容量结果不可跨账户复用。

正式结果在现有Run生命周期内经ArtifactStorage持久化；临时性能、缓存、checkpoint写 `_scratch/` 或 `scripts/_scratch/`，不留仓库根、不新增表。输出报告明确冷/热耗时、命中率、失效次数和恢复账户数。

## 5. 等价验收、停止与性能报告

同一冻结输入的优化前后逐账户比较：信号/排序、simulationConfig、订单/拒单与原因、成交价格/数量/费用、交易及权益digest、canonicalMetrics、再入场链、ST审计。忽略计时、生成时间、RunID等非业务字段时必须列出具体白名单，不扩大忽略范围。冷/热缓存、顺序/并行、完整/断点恢复均按实际实施范围验证；任一业务差异即优化失败，恢复基线并诊断。

缓存失效测试覆盖数据变更、ST覆盖变化、可变输入、成本/退出变化、seed变化和损坏checkpoint；账户互不污染。保留旧001/002/003真实结果锁，不以本轮新增ST研究规则为理由更改旧digest。

报告提供两张表：①同6账户输入优化前后各阶段耗时和峰值内存，分冷/热；②004实际SMOKE和42账户STUDY总耗时，流程减少量与引擎加速分别解释。目标是让本轮小闭环明显短于旧双重全矩阵；没有实测不得标达成，无法提速也须完成问题定位与研究报告，不能为达成指标削弱真实性。

执行输出落盘，不接管道；进度记录阶段和已完成账户，不等待所有账户结束才显示。30秒以上长阶段尽可能给心跳或分批进度；运行超过估计时输出当前热点及剩余工作，不按收益方向取消运行或临时削减样本。

工程检查按AGENTS：typecheck、受影响测试、EOL、行为/契约/DB/执行影响及架构登记。没有数据库写入需求；若发现依赖新DDL，先提交影响，暂停该优化而继续其他可完成项。
