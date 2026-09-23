<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/researchExperiments

- 测试文件 **37** 个 ｜ 用例声明 **345** 个
- 涉及源码目录：`client/src/researchExperiments/` · `research-experiments/` · `research-experiments/first-board-pullback/body-filtered-exit-curve-study/` · `research-experiments/first-board-pullback/conditional-pullback-state-exit-study/` · `research-experiments/first-board-pullback/decision-forward-study/` · `research-experiments/first-board-pullback/dynamic-entry-path-distribution-study/` · `research-experiments/first-board-pullback/dynamic-state-factor-expansion-study/` · `research-experiments/first-board-pullback/entry-aligned-exit-horizon-study/` · `research-experiments/first-board-pullback/first-board-body-study/` · `research-experiments/first-board-pullback/fundamental-study/` · `research-experiments/first-board-pullback/hold-open-price-pullback/` · `research-experiments/first-board-pullback/hold-streak-amplitude-t10-study/` · `research-experiments/first-board-pullback/limit-up-close-hold-study/` · `research-experiments/first-board-pullback/limit-up-price-hold-streak-study/` · `research-experiments/first-board-pullback/oversold-gap-reversal-validation/` · `research-experiments/first-board-pullback/post-event-amplitude-study/` · `research-experiments/first-board-pullback/pre-event-context-study/` · `research-experiments/first-board-pullback/stability-validation/` · `research-experiments/first-board-pullback/threshold-race-policy-study/` · `research-experiments/first-board-pullback/turnover-study/` · `research-experiments/first-board-pullback/volume-recovery-filtered-validation/` · `research-experiments/first-board-pullback/volume-relationship-dynamic-entry-study/` · `research-experiments/shared/firstBoardPullback/` · `server/` · `server/artifactStorage/` · `server/datasetRegistry/` · `server/research/` · `server/research/robustness/` · `server/research/strategyCandidate/` · `server/research/strategySchema/` · `server/researchExperiments/` · `server/researchExperiments/persistence/` · `server/researchRuntime/` · `server/strategyCore/` · `server/strategyCore/production/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/researchExperiments                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ℹ️ 本模块有 **2** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/server/researchExperiments/artifactPublisherLimits.test.ts`
- 122 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/index.ts` · `server/researchExperiments/persistence/artifactPublisher.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/artifactPublisherLimits.test.ts`
- 用例树：
- **实验 Result / Artifact 配额**
  - result.json 超限 ⇒ 上传前拒绝，不写任何对象
  - 产物数量超限 ⇒ 上传前拒绝
  - 上传中途失败 ⇒ 删除本次已写对象，不留半套产物

### `tests/server/researchExperiments/artifactRoute.test.ts`
- 45 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`server/experimentArtifactRoutes.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/artifactRoute.test.ts`
- 用例树：
- **artifactFileName（Content-Disposition 安全）**
  - 取 Key 的最后一段作为文件名
  - 引号 / 换行 / 反斜杠 / 分号一律替换 —— 不允许在响应头上加字段
  - 空 / 以斜杠结尾 ⇒ 回落到稳定的占位名（不是空字符串）

### `tests/server/researchExperiments/bodyFilteredExitCurveStudy.test.ts`
- 180 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/body-filtered-exit-curve-study/experiment.ts` · `research-experiments/first-board-pullback/body-filtered-exit-curve-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/bodyFilteredExitCurveStudy.test.ts`
- 用例树：
- **body-filtered-exit-curve-study**
  - 排除一字板和小实体，并按共同路径输出持有曲线

### `tests/server/researchExperiments/conditionalPullbackStateExitStudy.test.ts`
- 160 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/conditional-pullback-state-exit-study/experiment.ts` · `research-experiments/first-board-pullback/conditional-pullback-state-exit-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/conditionalPullbackStateExitStudy.test.ts`
- 用例树：
- **conditional-pullback-state-exit-study**
  - 触发后入场，并在收盘跌破首板开盘价后下一开盘退出

### `tests/server/researchExperiments/contract.test.ts`
- 443 行 ｜ 用例声明 23 ｜ describe 4
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/contract.test.ts`
- 用例树：
- **Contract · 元数据校验**
  - 合法描述符通过
  - id 形态非法（缺组名 / 大写 / 三段）被拒
  - 参数 code 重复被拒（重复会让默认值归并静默丢项）
  - 非必填参数缺 defaultValue 被拒（避免运行时出现「没有值的参数」）
  - ENUM 无 allowedValues / 默认值不在枚举内 / 非 ENUM 声明枚举 都被拒
  - bounds.min > bounds.max 被拒
  - datasetCode 不合规范被拒（复用 Dataset 域命名正则）
  - 相对日方向写反被拒（prefix > 0 / post < 1）
  - 声明了 post 相对日却没声明 usesForwardData ⇒ 被拒（堵「偷偷读未来数据」）
  - usesForwardData=true 却没写用途 ⇒ 被拒
  - 一个列都没声明 ⇒ 被拒（不读数据的实验多半是写错了）
- **Contract · 注册表**
  - 注册 / 查询 / 列表 / 未注册即抛
  - 重复注册被具名拒绝（不静默覆盖）
  - run() 不是函数 ⇒ 注册失败
  - 注册时即校验元数据（不合规的进不来）
- **Contract · 参数校验与默认值归并**
  - 全缺省 ⇒ 用 defaultValue 归并；必填缺失即拒
  - 未知参数键被拒（打错参数名不该静默无效）
  - 类型 / 越界 / 枚举外 / 空数组 一律拒绝且**不夹取**
  - 显式传值优先于默认值（且不丢失其它默认值）
- **Contract · 结果校验**
  - 合法信封通过
  - 样本账不平 ⇒ EXPERIMENT_RESULT_INVALID（eligible + excluded ≠ candidate）
  - 剔除原因合计 ≠ excludedCount ⇒ EXPERIMENT_RESULT_INVALID（否则样本为何变少无从诊断）
  - 形状不符（缺 metadata / 类型错）⇒ EXPERIMENT_RESULT_INVALID

### `tests/server/researchExperiments/datasetPort.test.ts`
- 421 行 ｜ 用例声明 12 ｜ describe 3
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/datasetPort.test.ts`
- 用例树：
- **Dataset 桥 · 版本事实**
  - 解析出真实事实（代码 / 标签 / 状态 / 视界）
  - 未知版本返回 null
  - 非 READY / 代码不匹配 / 相对日超视界 分别被拒
- **Dataset 桥 · 列投影即声明**
  - 只有声明过的列出现在行里（未声明的列读出来是 undefined）
  - 声明了不存在的列 ⇒ 当场拒绝（否则取值会静默变 null）
  - 必须声明至少一个列 —— 但校验发生在注册/契约层（这里验证 createAccess 不因空声明崩）
- **Dataset 桥 · 相对日白名单与 PIT 闸门**
  - 未声明的相对日读不到（feature / observation 都拒绝）
  - observation() 必须在 freezeSelection() 之后调用（未冻结即拒）
  - 冻结空样本后 observation() 返回空集，不读取未来数据
  - 未声明 usesForwardData 时 observation() 调用即抛（PIT 结构闸门，不是靠注释提醒）
  - 下推的列投影必须包含**骨架列**（eventId / tradeDate / relativeDay / symbol）
  - 读取按版本下推、且同一个相对日只读一次（惰性缓存）

### `tests/server/researchExperiments/datasetProvider.test.ts`
- 207 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/researchExperiments/datasetProvider.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/datasetProvider.test.ts`
- 用例树：
- **Experiment Dataset Provider Registry**
  - Registry Provider 不得把别的 datasetCode 版本冒领为自己的版本
  - 按 datasetCode 路由，禁止重复注册，未注册立即拒绝
  - Runner 可同时注入 primary 与 auxiliary Dataset，并返回完整 bindings

### `tests/server/researchExperiments/decisionForwardStudy.test.ts`
- 257 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `research-experiments/first-board-pullback/decision-forward-study/experiment.ts` · `research-experiments/first-board-pullback/decision-forward-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/decisionForwardStudy.test.ts`
- 用例树：
- **decision-forward-study**
  - 收益严格从决策日收盘起算，并扣除成本
  - 决策路径齐备但远期窗口缺数据时，sampleCount 保留而 availableCount 下降
  - 跨年度输出按事件年份分组

### `tests/server/researchExperiments/dynamicEntryPathDistributionStudy.test.ts`
- 146 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/dynamic-entry-path-distribution-study/experiment.ts` · `research-experiments/first-board-pullback/dynamic-entry-path-distribution-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/dynamicEntryPathDistributionStudy.test.ts`
- 用例树：
- **dynamic-entry-path-distribution-study**
  - 输出每日路径、MFE/MAE 和阈值到达时间

### `tests/server/researchExperiments/dynamicStateFactorExpansionStudy.test.ts`
- 148 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/dynamic-state-factor-expansion-study/experiment.ts` · `research-experiments/first-board-pullback/dynamic-state-factor-expansion-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/dynamicStateFactorExpansionStudy.test.ts`
- 用例树：
- **dynamic-state-factor-expansion-study**
  - 生成同日横截面分位、历史次数与 T+1 执行因子

### `tests/server/researchExperiments/entryAlignedExitHorizonStudy.test.ts`
- 176 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/entry-aligned-exit-horizon-study/experiment.ts` · `research-experiments/first-board-pullback/entry-aligned-exit-horizon-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/entryAlignedExitHorizonStudy.test.ts`
- 用例树：
- **entry-aligned-exit-horizon-study**
  - 排除一字板与T+1..T+5涨跌停触达，并按持有日展开共同样本

### `tests/server/researchExperiments/exp001FundamentalStudy.test.ts`
- 1691 行 ｜ 用例声明 76 ｜ describe 12 ｜ 📄 源码文本断言
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/objectKey.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/datasetRegistry/types.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `client/src/researchExperiments/pages.ts` · `research-experiments/first-board-pullback/fundamental-study/experiment.ts` · `research-experiments/first-board-pullback/fundamental-study/result.ts` · `research-experiments/manifest.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/exp001FundamentalStudy.test.ts`
- 用例树：
- **EXP-001 · 1. ExperimentDefinition 注册**
  - 清单里有本实验，且能通过 Registry 注册
  - descriptor 坐标自洽：id / pageKey / version / 计算口径版本一致
  - 实验全程不得出现旧 Research 的锚字段（analysisId / findingIds / conclusionId / candidateId）
  - 参数共 4 个，且都是研究范围参数（无「寻优」语义）
- **EXP-001 · 2+11. Dataset 声明与 PIT 边界**
  - 声明面：datasetCode / 前缀 / 后缀 / 列 / usesForwardData / decisionOffsetDays
  - 参数越界一律执行前拒（不夹取）：maxObservationDay=6 超出声明边界
  - 未登记参数键被拒（不会静默忽略）
  - 版本非 READY ⇒ 拒（EXPERIMENT_DATASET_VERSION_NOT_READY）
  - Dataset 语义代码不匹配 ⇒ 拒（不静默换数据集）
  - 声明视界超出该版本真实视界 ⇒ 拒（不夹取）
  - 🔴 结构级闸门：maxObservationDay 超过 decisionOffsetDays 时 run() 自己拒绝（不靠参数边界兜）
  - futureHorizons 含重复元素 ⇒ 拒（去重会静默改变列结构）
  - 取数只走声明面：未声明的相对日读不到（观测日白名单）
- **EXP-001 · 3. T+1…T+5 相对日期计算**
  - byDay 覆盖 rd = 1…maxObservationDay，交易日与夹具一致
  - maxObservationDay 是可调的观察范围（3 ⇒ 只到 T+3）
- **EXP-001 · 4+5+6+7. 基准价 / 回踩 / 破位（路径条件）/ 回撤深度**
  - 回撤与破位锚在**首板日开盘价**，回踩锚在**首板日收盘价**（两个锚不可混）
  - 回撤深度用**累计最低价**（不是当日最低价），两个口径都给
  - 🔴「不破首板日开盘价」是**路径条件**：T+2 破位后，T+4/T+5 涨回也不算不破
  - isValidOhlc 把「高低倒挂」「非正」「缺失」都判为非法
  - contiguousWindow 缺一天就返回 null（禁跳洞取数）
- **EXP-001 · 8. 回撤深度分桶**
  - 默认边界产出 6 个桶（未回踩 + 4 段 + 溢出一段），互不重叠且完全覆盖
  - 边界本身是「下界含、上界不含」（-2% 落在 DD_200BP，不落 NO_PULLBACK）
  - 非法边界当场抛错（首项非 0 / 非递减 / 正数 / 少于 2 项）
  - 紧凑标签从权威边界派生（图表横轴不写第二套数值）
  - 分桶汇总表：主夹具 3 个样本全部落桶，且 NO_PULLBACK 为空
- **EXP-001 · 9. 后续收益与突破**
  - byHorizon：以首板日**收盘价**为锚，MFE/MAE 与同锚 high/low 收益数学恒等
  - 突破研究：对首板日收盘价与涨停价两个基准，记录首次突破相对日
  - 缺远端行情 ⇒ 视界如实不可用（available = false，不夹取、不用短窗冒充）
  - 后续视界表按「截至 T+5 的破位状态」分组，且样本数随视界缩短而增加
  - 入场日视角：k = 1 的「入场前未破位」是空路径恒真（定义结果，不是研究发现）
  - 入场日视角：入场后的口径需要 rd 齐全，否则如实为 null（next20 在 post 视界 20 内恒不可用）
  - 逐日路径表：T+1 全部回踩、T+5 无人回踩；破位只从 T+2 开始
  - 不破 / 破位对照表：每日三组（ALL / NON_BREAK_OPEN / BREAK_OPEN）都在
- **EXP-001 · 10+13. 剔除原因与数据质量（端到端 Run）**
  - 六个候选中三个入池，三个各自归入一个闭集原因，账目严格守恒
  - 剔除原因码全部在闭集里（禁止出现未登记原因）
  - 数据质量块逐项登记（缺观察日 / 非法 OHLC / 远端视界不足）
  - summary / metrics 的坐标与关键统计量与表同源
  - 观察按四类产出，且**不出现**「最优 / 最佳 / 应该买」这类策略结论措辞
  - 🔴 同一句里的「未跌破 X% / 曾跌破 Y%」必须互补：Y 用**截至**口径，不是**当日**破位率
  - 假设只以 H1/H2/H3 形式给出（potential strategy hypotheses），不含策略对象
  - 🔴 读取层调用次数 = rd=0 一次 + 20 个观察日各一次（禁 N×M 逐事件逐日查询）
  - MAX_EVENTS_LIMIT：超上限的事件逐条登记，不静默丢弃
  - 🔴 数据集声明的事件数 > 本轮扫描到的候选数 ⇒ 缺口必须显式出数（守恒式覆盖不到它）
  - 缺口为 0 时不报缺口；数据集未声明总数时缺口是 null（**不是** 0）
  - 同一事件 ID 重复出现 ⇒ 去重并计数（不重复计入样本）
- **EXP-001 · 12. 空数据（零候选也要产出结构完整的结果）**
  - events 为空 ⇒ 成功、账目 0=0+0、表 / 图 / 统计仍然齐全（不崩、不造假）
  - 有事件但首板日全部缺行情 ⇒ 全部剔除、原因逐条登记、结果仍可读
- **EXP-001 · 14. Result Envelope**
  - metadata 由平台填真实坐标（实验无法谎报 Dataset 版本）
  - 信封含 6 张表 / 8 个统计量 / 2 个分布 / 4 张图 / 1 个比较
  - 比率类统计量的 sampleCount 挂的是**分母**（分类日有路径的样本数），不是分子
  - 表内比率按显示位收敛（页面看到的数值与 CSV 同源，不存在第二套口径）
  - 样本账不平 ⇒ 平台拒（实验自己也不制造不平的账）
- **EXP-001 · 15. Artifact Key**
  - 9 个产物：名字是合法相对名**且不含角色段**、落在 Run 前缀的角色段下、两两唯一
  - 🔴 全仓静态扫描：任何实验定义 / 模板都不得把角色段写进产物 name（`tables/x.csv` 即错）
  - CSV 产物与信封里的表**同名同源**（表 key + `.csv` 就是声明名）
  - CSV 是 UTF-8 文本、两行注释 + 表头 + 逐行数据；SVG 自包含且不含外部引用
  - 非法产物名字在收集阶段**当场抛**（不等上传阶段），失败 Run 的 artifactFiles 为空
  - buildArtifacts 是纯函数：同样的表 ⇒ 同样的字节（可复现）
- **EXP-001 · 16. Manifest 与前端页面注册**
  - 本实验在清单里，且前端页面注册表有对应组件（漏登记会降级为通用渲染器）
  - 清单不出现重复 id（重复注册会让其中一个静默失效）
  - 清单里的每个实验都声明了真实存在的 datasetCode 与 forwardDataPurpose（有前视数据时）
  - pageKey 与 id 一致（页面注册表按 pageKey 索引）
- **EXP-001 · 17. 全量扫描与决策时点矩阵**
  - ① 分页是全量扫描的实现方式：页大小 2 ⇒ 6 个事件 = 3 轮分页
  - ②③ 候选 = 数据集声明事件数，unscannedEventCount 严格为 0（不是 null）
  - ④ 分页无重复：扫描行数 = 去重后候选数（keyset 游标不重不漏）
  - 🔴 平台安全阀**没有被删掉**：注入小上限后截断必须可见（缺口 > 0）
  - ⑤ 非法 OHLC 不污染未来收益；两个口径（Bar 次 / 事件数）分档自洽
  - ⑤b 长视界坏 Bar 只让该视界不可用，**不**把事件从核心样本里删掉（规格 §5 明令）
  - ⑥ 逐视界样本账：eligible 不随视界变（长视界缺数据不回流删核心样本）
  - ⑦⑧⑨ 决策矩阵：T+1…T+5 × ALL/NON_BREAK_OPEN/BREAK_OPEN × 各视界，行数齐备且分组互补
  - ⑩ 后续窗口**不含决策日当天及之前**的数据（锚 = 决策日收盘价，窗口自 T+k+1 起）
  - ⑩b h ≤ k 的格子按定义不可用（不是「样本为 0」）：T+5 决策 → T+5 视界
  - ⑪ Result 账目守恒：candidate = eligible + excluded，且 Σ excludedByReason = excluded
  - 矩阵**不含** best / optimal / worst / rank 之类字段（规格 §8）
  - 决策矩阵的 customPayload 与 tables 同源（不可能是两套口径）
  - Matrix 的每个视界都有 `availableCount ≤ sampleCount`，且不可用格子的收益为 null

### `tests/server/researchExperiments/exp002StabilityValidation.test.ts`
- 1271 行 ｜ 用例声明 50 ｜ describe 11 ｜ 📄 源码文本断言
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/objectKey.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/datasetRegistry/types.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `client/src/researchExperiments/pages.ts` · `research-experiments/manifest.ts` · `research-experiments/first-board-pullback/stability-validation/experiment.ts` · `research-experiments/first-board-pullback/stability-validation/result.ts` · `server/research/robustness/multiDimension.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/exp002StabilityValidation.test.ts`
- 用例树：
- **EXP-002 · 1. Dataset Version 正确**
  - 已注册：清单 + 页面注册表键与 descriptor.pageKey 一致
  - 数据坐标声明：语义码 / 全量扫描 / rd=0 只作 feature / post 1…20
  - Run 结果的坐标来自平台（实验无法谎报）：datasetId / datasetCode / 版本标签 / 事件总数
  - 非 READY 版本 ⇒ 执行前拒（EXPERIMENT_DATASET_VERSION_NOT_READY）
  - 语义码不匹配 ⇒ 执行前拒（EXPERIMENT_DATASET_CODE_MISMATCH）
  - 声明了超出数据集真实视界的相对日 ⇒ 执行前拒（EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE）
- **EXP-002 · 2. PIT 正确（决策时点 / 未来数据的有意声明）**
  - 决策时点上界 = EXP-001 的 maxObservationDay（= 5），并显式声明使用未来数据
  - Run 记录如实回报 PIT 坐标：decisionOffsetDays = 5 / forwardDataRead = true
  - 🔴 结构级闸门实测：未声明 usesForwardData 时读 rd≥1 当场抛
- **EXP-002 · 3. 无未来数据泄漏（读取上界 = 声明上界）**
  - 真实读取上界恰为声明上界，且不超过它
  - 矩阵每个变体所需的相对日上界都在声明窗口内
  - 未在 postRelativeDays 里声明的相对日 ⇒ 读不到（白名单闸门）
  - 🔴 少声明相对日并不会静默少读：run() 自查后把 Run 判 FAILED
- **EXP-002 · 4. baseline 可复现（同输入 ⇒ 同产物）**
  - 同输入跑两次 ⇒ customPayload / runId / 指纹 / counts / 日志逐字一致
  - Baseline 显式声明在 Definition 里，且理由可读（不是隐含默认）
  - 结果里的 Baseline 与声明逐字段一致，且是真实算出来的（不是空壳）
- **EXP-002 · 5. variant 真重算（不是复制旧结果 / 不是只改标签）**
  - 🔴 自检行：与基准同配置的两个变体逐指标 delta 恰为 0 且判定 stable
  - 改一根 bar（E1 的 rd=10 收盘）⇒ 基准指标与观测到的 delta 一起变
  - 逐变体指标互不相同（不是把同一份值复制给每一行）
  - 🔴 静态扫描：本实验目录里没有任何「读旧结果文件」的路径
- **EXP-002 · 6. sample accounting 平衡（§13）**
  - 逐变体：三式都平 + 原因合计 = 各桶 + 原因码全在闭集里
  - 信封口径（平台守恒式）：eligible + excluded = candidate，且原因合计 = excluded
  - 两套口径的换算在结果里是**显式**的（信封 eligible = 核心 validCount）
  - 🔴 样本集合变化可见：T+20 视界因缺一个远端观察日而少一个样本
  - 样本条件分组的样本量与手算一致（分桶互斥且完全覆盖）
  - maxEvents 主动裁剪 ⇒ 进「缺数据」桶（不静默丢弃）
- **EXP-002 · 7. Result Envelope（动态信封，不建全局固定 schema）**
  - 3 张表 / 统计项 / 1 张图 / customPayload 全部齐备且过本实验自己的 resultSchema
  - 矩阵表 = 逐变体 × 逐指标的长表（48 行），列里有判定与样本量
  - 统计项与声明一致：候选数、缺口、坏 bar 反查恒为 0、基准口径
  - 图表系列 = 三个声明比较指标；不可用点是 null 而不是 0
  - 零事件仍产出结构完整的结果（不崩、不造假）
- **EXP-002 · 8. Artifact manifest / 产物索引**
  - 产出恰好 5 个文件：3 CSV + 1 SVG + 核心记录
  - 信封里声明的产物索引与真实产出同名同角色（且不带字节）
  - 🔴 核心记录可离线复核：`robustness-run.json` 反序列化后指纹通过校验
  - 产物内容与信封表同源（CSV 行数 = 表的行数）
  - 产物声明的名字集合里没有「本实验没实现」的东西（唯一来源 = 一次 artifactSpecs 列表）
- **EXP-002 · 9. 对象 Key 结构（真实 MinIO 写入由 §22 E2E 验证）**
  - 三类角色的 Key 都落在 `experiments/<id>/runs/<runId>/` 下
  - contentType 与角色一致（上传时按此声明 MIME）
- **EXP-002 · 10. Run 状态（含失败路径的两条出口）**
  - 正常路径 ⇒ SUCCEEDED + result 非空 + error 为 null
  - 执行前参数越界 ⇒ 领域错误（不是 SUCCEEDED 也不是静默夹取）
  - 🔴 失败 Run 不产出 Manifest（artifactFiles 为空）
  - 维度声明与变体归属自洽（3 个维度、无空维度）
  - 结论里逐项登记了「不产出什么」（sensitive 是发现而非缺陷）
- **EXP-002 · 11. 前端最终态（静态闸门）**
  - 页面注册表键 = descriptor.pageKey，且导出的是一个组件
  - 页面文件存在，且**不**引 server 运行时 / 不引实验定义 / 不引引桥
  - 实验目录结构完整（result / experiment / page / README）
  - 页面覆盖了总览 / 矩阵 / 样本账 / 产物四块（DOM 文案在 E2E 里量）
  - 观察项类别是中文标签（DOM 里出现的是人读文案，不是枚举码）
  - README 说明了「复用既有 Robustness 方法、不新建引擎 / 不新建表」
  - 指标词表与比较声明同源（页面 / CSV / 图表都从这一份取）

### `tests/server/researchExperiments/firstBoardBodyStudy.test.ts`
- 172 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/first-board-body-study/experiment.ts` · `research-experiments/first-board-pullback/first-board-body-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/firstBoardBodyStudy.test.ts`
- 用例树：
- **first-board-body-study**
  - 按严格涨停首板实体高度分桶，并排除收盘高于涨停价的异常事件

### `tests/server/researchExperiments/firstBoardPullbackFoundation.test.ts`
- 331 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `research-experiments/shared/firstBoardPullback/cost.ts` · `research-experiments/shared/firstBoardPullback/foundation.ts` · `research-experiments/shared/firstBoardPullback/types.ts` · `research-experiments/shared/firstBoardPullback/wrapExperiment.ts` · `server/researchExperiments/datasetPort.ts` · `research-experiments/shared/firstBoardPullback/panel.ts` · `research-experiments/shared/firstBoardPullback/dataset.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/firstBoardPullbackFoundation.test.ts`
- 用例树：
- **first-board-pullback public foundation**
  - declares and enforces the v5 Dataset binding
  - rejects non-v5 Dataset versions
  - aligns holdingDay from actual entry and uses next sellable open
  - uses the same commonSample event set for every holding day
  - deducts commission, stamp duty, slippage and impact

### `tests/server/researchExperiments/firstBoardPullbackStrategy.test.ts`
- 280 行 ｜ 用例声明 14 ｜ describe 4
- 被测源码：`server/researchExperiments/strategyBridge.ts` · `server/researchExperiments/firstBoardPullbackStrategyDraft.ts` · `server/research/strategyCandidate/definitionBuild.ts` · `server/research/strategySchema/map.ts` · `server/research/strategySchema/definition.ts` · `server/strategyCore/ruleGraph.ts` · `server/strategyCore/production/versionFromDocument.ts` · `server/research/strategyCandidate/researchEvidence.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/firstBoardPullbackStrategy.test.ts`
- 用例树：
- **§8 / §11 首板回踩草稿 → 合法定义 + PIT**
  - 1-a) 草稿能过既有校验器（结构 + Look-Ahead L1–L8），且 Core 定义可构造
  - 1-b) 观察窗口上界 == EXP-001 的 DECLARED_DECISION_OFFSET_DAYS（跨模块钉死，含边界语义）
  - 1-c) 无 look-ahead：条件字段全在 currentBar 域（不含 post.* / path.* / outcome.*）
  - 1-d) NEXT_OPEN ⇒ 信号 T_CLOSE、成交 T_PLUS_1_OPEN、价类型 OPEN（决策 ≤ 决策偏移）
- **§8 FIXED / TUNABLE / DERIVED 与「研究 / 设计」来源登记**
  - 2-a) 登记表三分完整、来源二分完整，且每条都有非空说明
  - 2-b) 登记为 TUNABLE 的取值**恰好**等于定义里的 TUNABLE 参数（不多不少）
  - 2-c) 研究侧登记必须能追到已引用的证据 Run（不能只有一句「来自研究」）
- **§14 TUNABLE 参数的**真实**引用面**
  - 3-a) 两条条件的右值都是参数引用（而不是常量）
  - 3-b) Core 规则图**真的**引用了这两个参数（这是 Parameter Search 用的同一判据）
  - 3-c) 引用面**恰好**等于声明的 TUNABLE 集合（没有「声明了却没人读」的死参数）
  - 3-d) 两个 TUNABLE 参数都带范围与默认值（数值参数缺 min/max 会被构造器响亮拒绝）
- **§17 严禁自动择优**
  - 4-a) 草稿 / 定义的**用户可见文本**里没有评价性词汇
  - 4-b) 证据种类词表是闭集且不含评价性取值
  - 4-c) 证据列表保持**声明顺序**（不做任何排序 —— 排序会被误读成重要程度）

### `tests/server/researchExperiments/hardening.test.ts`
- 317 行 ｜ 用例声明 8 ｜ describe 4
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/index.ts` · `server/researchExperiments/codeDigest.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/persistence/index.ts` · `server/researchExperiments/persistence/runQueue.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/hardening.test.ts`
- 用例树：
- **实验代码指纹**
  - 同一定义稳定；run 源码或 descriptor 变化都会改变指纹
- **进程内实验队列**
  - 并发有界，drain() 等到全部任务结束
- **异步 Run 生命周期**
  - start() 立即返回 PENDING，后台执行完成后变为 COMPLETED
  - 后台 markRunning() 异常也会把 PENDING Run 收敛为 FAILED
- **Result / Artifact 配额**
  - 结果信封体积超限 ⇒ 上传前拒绝
  - 结果表行数 / 单元格数超限 ⇒ 上传前拒绝
  - 单产物体积超限 ⇒ 不写任何对象
  - 对象数量超限 ⇒ 在写入前拒绝

### `tests/server/researchExperiments/holdOpenPricePullback.test.ts`
- 237 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `research-experiments/first-board-pullback/hold-open-price-pullback/experiment.ts` · `research-experiments/first-board-pullback/hold-open-price-pullback/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/holdOpenPricePullback.test.ts`
- 用例树：
- **hold-open-price-pullback**
  - 冷启动仅登记交易周期事实，不把未触发 / 破位算成 0 收益
  - 缺少等待窗口行情时归入样本账外，不伪造触发或收益
  - 排除一字涨停首板时，事件仍保留候选账但不进入 eligible

### `tests/server/researchExperiments/holdStreakAmplitudeT10Study.test.ts`
- 145 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/hold-streak-amplitude-t10-study/experiment.ts` · `research-experiments/first-board-pullback/hold-streak-amplitude-t10-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/holdStreakAmplitudeT10Study.test.ts`
- 用例树：
- **hold-streak-amplitude-t10-study**
  - 交叉守线 streak 与平均振幅

### `tests/server/researchExperiments/limitUpCloseHoldStudy.test.ts`
- 184 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/limit-up-close-hold-study/experiment.ts` · `research-experiments/first-board-pullback/limit-up-close-hold-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/limitUpCloseHoldStudy.test.ts`
- 用例树：
- **limit-up-close-hold-study**
  - 按 T+1..T+5 最低收盘相对 T 日涨停价分组并排除一字板

### `tests/server/researchExperiments/limitUpPriceHoldStreakStudy.test.ts`
- 139 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/limit-up-price-hold-streak-study/experiment.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/limitUpPriceHoldStreakStudy.test.ts`
- 用例树：
- **limit-up-price-hold-streak-study**
  - 分别计算收盘守线和盘中守线 streak

### `tests/server/researchExperiments/manifest.test.ts`
- 181 行 ｜ 用例声明 9 ｜ describe 3
- 被测源码：`research-experiments/manifest.ts` · `client/src/researchExperiments/pages.ts` · `server/researchExperiments/registry.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/manifest.test.ts`
- 用例树：
- **清单 · 每个实验都能注册**
  - 真实清单里至少有一个实验（示例必须存在，否则体系没有被验证过）
  - 逐个注册成功（元数据 / 参数 / Dataset 声明全部自洽）
  - 示例实验的 id 与目录约定一致（`<组>/<实验>`）且 pageKey 与 id 相同
- **接缝 · 服务端清单 ⇄ 前端页面注册表**
  - 每个已注册实验的 pageKey 都能找到页面组件（漏登记会被这条抓住）
  - 前端注册表没有指向不存在实验的多余条目（改名后没同步会被这条抓住）
  - 未知 pageKey 返回 null（由平台降级为通用渲染器）
- **边界 · 新体系不得耦合旧 Research 结构（规格 §14）**
  - 源码里不出现旧链路的结构字段名与表名
  - 不做文件系统发现（无 import.meta.glob / 无目录扫描调用）
  - 实验页面不 import server/** 运行时（页面跑在浏览器里）

### `tests/server/researchExperiments/minioArtifactStorage.test.ts`
- 319 行 ｜ 用例声明 14 ｜ describe 4
- 被测源码：`server/artifactStorage/index.ts` · `server/artifactStorage/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/minioArtifactStorage.test.ts`
- 用例树：
- **MinioArtifactStorage · 命令与元数据映射**
  - put：带上 Bucket/Key/ContentType/Body；首次写入回报 overwritten=false
  - put：已存在同一 Key ⇒ overwritten=true（如实回报，不当成错误）
  - get：Body → Buffer，ETag 去引号，LastModified → ISO
  - getMetadata / exists：404 ⇒ null / false（查存在性语义**不抛**）
  - get 一个不存在的对象 ⇒ 抛 NOT_FOUND（如实失败，不返回空 Buffer）
  - delete：S3 对不存在的键也返回成功 ⇒ 自己先 HEAD，返回 false 才如实
  - list：映射 Contents，并透传 Prefix / MaxKeys
  - list：前缀含越界段 ⇒ 结构级拒绝（不发请求）
- **MinioArtifactStorage · 错误翻译（判据不依赖驱动文案）**
  - 非「不可用」的其它错误在 put 上翻译为 PUT_FAILED（不冒充不可用）
  - 桶不存在（NoSuchBucket）⇒ UNAVAILABLE 且文案点明「确认桶已存在」
- **MinioArtifactStorage · 安全与 key 注入**
  - describe() 只报端点与桶，**绝不**回显 accessKey / secretKey
  - 非法 Object Key ⇒ 在任何网络调用**之前**就被拒
  - 未注入 client 时使用真实 S3Client（构造不抛、describe 不泄漏）
- **minioEndpointUrl**
  - 按 useSsl 选协议、补默认端口、去掉尾部斜杠

### `tests/server/researchExperiments/oversoldGapReversalValidation.test.ts`
- 171 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/oversold-gap-reversal-validation/experiment.ts` · `research-experiments/first-board-pullback/oversold-gap-reversal-validation/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/oversoldGapReversalValidation.test.ts`
- 用例树：
- **oversold-gap-reversal-validation**
  - 只选择长间隔且前期跌幅超过 10% 的信号，并用同日可行首板做基准

### `tests/server/researchExperiments/postEventAmplitudeStudy.test.ts`
- 157 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/post-event-amplitude-study/experiment.ts` · `research-experiments/first-board-pullback/post-event-amplitude-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/postEventAmplitudeStudy.test.ts`
- 用例树：
- **post-event-amplitude-study**
  - 区分无涨跌停 / 有涨跌停，并在无涨跌停组内按平均振幅分桶

### `tests/server/researchExperiments/preEventContextStudy.test.ts`
- 167 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `research-experiments/first-board-pullback/pre-event-context-study/experiment.ts` · `research-experiments/first-board-pullback/pre-event-context-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/preEventContextStudy.test.ts`
- 用例树：
- **pre-event-context-study**
  - 用 PIT 间隔和 T-1/T-n 收盘计算前期涨幅，并输出上下文矩阵

### `tests/server/researchExperiments/protocolGate.test.ts`
- 375 行 ｜ 用例声明 7 ｜ describe 1
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/index.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/persistence/index.ts` · `server/researchExperiments/persistence/runQueue.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchExperiments/protocol.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/protocolGate.test.ts`
- 用例树：
- **Research Protocol / phase lock**
  - 协议指纹区分辅助 Dataset 版本
  - OBSERVATION 不接受仅适用于 Holdout 的 FAIL Gate
  - OBSERVATION 持久化协议指纹、窗口和 OBSERVATION_READY Gate
  - HOLDOUT 复用父 Observation 的冻结参数并只允许一次
  - HOLDOUT 修改参数被冻结闸门拒绝
  - HOLDOUT 窗口被历史探索 Run 看过时拒绝启动
  - Evaluation Window 真实过滤事件

### `tests/server/researchExperiments/router.test.ts`
- 350 行 ｜ 用例声明 15 ｜ describe 4
- 被测源码：`shared/const.ts` · `server/routers.ts` · `shared/researchExperimentsContracts.ts` · `server/artifactStorage/index.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/persistence/index.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/router.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/router.test.ts`
- 用例树：
- **appRouter 注册守卫**
  - researchExperiments 全部端点已挂载（漏挂 = 前端恒 404 且页面不报错）
- **读端点（公开）**
  - list 返回**摘要**（描述符 + Run 数 + 最近 Run；未运行 ⇒ runCount=0 / latestRun=null）
  - list 可按 datasetCode 过滤
  - get 返回**详情**（描述符 + 该实验的 Run 列表）
  - get 未注册实验 ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_NOT_FOUND]（前端可抠码）
  - listDatasetVersions 返回只读版本目录
  - getRun 未知 runId ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_RUN_NOT_FOUND]
- **run 端点（admin）**
  - 未登录 / 非管理员一律 FORBIDDEN（鉴权在 resolver 之前）
  - admin 执行成功 ⇒ **已持久化** + Run=COMPLETED + manifest 引用 + 完整 outcome
  - 参数非法 ⇒ BAD_REQUEST 且 message 带 [EXPERIMENT_PARAMETER_INVALID]
  - 未知 Dataset 版本 ⇒ NOT_FOUND 且 message 带 [EXPERIMENT_DATASET_VERSION_NOT_FOUND]
- **004 · Run 查询面（写一次 → 走 tRPC 读回来）**
  - listRuns / getRun / getRunResultManifest / getArtifactMetadata 串起来可用
  - getRun 的「最新 Run」也会反映在 list 摘要里（页面列表列的来源）
  - reconcileRun：非 RUNNING 的 Run ⇒ BAD_REQUEST + [EXPERIMENT_RUN_STATE_INVALID]
  - 对象存储不可用 ⇒ 返回**请求成功但 Run=FAILED**（不伪装成成功，也不抛 500）

### `tests/server/researchExperiments/runner.test.ts`
- 427 行 ｜ 用例声明 14 ｜ describe 5
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/runner.test.ts`
- 用例树：
- **Runner · load（未注册即抛）**
  - listDescriptors / requireDescriptor
  - 未注册实验 ⇒ EXPERIMENT_NOT_FOUND（执行前抛，不是 FAILED outcome）
- **Runner · validate（执行前一律抛）**
  - 参数非法 ⇒ EXPERIMENT_PARAMETER_INVALID
  - Dataset 版本不存在 ⇒ EXPERIMENT_DATASET_VERSION_NOT_FOUND
  - Dataset 语义代码不匹配 ⇒ EXPERIMENT_DATASET_CODE_MISMATCH（不静默换数据集）
  - prepare() 返回解析结果与 Dataset 事实（同一份事实供 run 复用）
- **Runner · execute（成功路径）**
  - SUCCEEDED：metadata 由 runner 填真实坐标，实验无法谎报
  - 日志进入执行元数据，并有界（不超过 MAX_EXPERIMENT_LOG_LINES）
  - 未声明 usesForwardData 的实验拿不到 post 数据（PIT 闸门在 runner 链路里真实生效）
- **Runner · capture error（执行期失败一律回报，不吞错）**
  - run() 抛异常 ⇒ FAILED + 原始消息进 error.message
  - customPayload 不符本实验 resultSchema ⇒ FAILED + EXPERIMENT_RESULT_INVALID
  - 样本账不平 ⇒ FAILED（不让「样本被静默吞掉」的结果过关）
- **Runner · 执行身份与 PIT 样本冻结**
  - 未冻结样本就读取 observation ⇒ FAILED + EXPERIMENT_SELECTION_NOT_FROZEN
  - 冻结样本后 metadata 记录 selectedEventCount，代码变化 ⇒ codeDigest 变化

### `tests/server/researchExperiments/runPersistence.test.ts`
- 1034 行 ｜ 用例声明 36 ｜ describe 11
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/artifactStorage/index.ts` · `server/artifactStorage/types.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/errors.ts` · `server/researchExperiments/persistence/index.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchExperiments/persistence/runQueue.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/runPersistence.test.ts`
- 用例树：
- **Run DATE 读回**
  - 按业务日历输出 YYYY-MM-DD，不经 UTC 截断漂移
- **Object Key 规范（唯一产生点）**
  - Key 形态完全由 (实验, Run, 角色, 名字) 决定 —— 不用随机路径
  - runId 里的 key 注入（`/`、`..`、反斜杠）被**结构级**拒绝
  - 产物名字：越界 / 绝对 / 反斜杠一律拒
  - isObjectKeyUnderRun：只认本 Run 前缀（跨 Run 读取的**结构闸**）
- **Manifest 契约**
  - buildRunManifest 产出稳定结构（result 是引用，不是内容）
  - inferArtifactDescriptor：角色优先于扩展名（artifact + .json 不得被改判成 TABLE）
  - 🔴 分桶后果：role=artifact 的 .json 落 `artifacts` 段，不得混进 `tables` 段
  - 坐标自洽校验：把 A 的 Manifest 挪到 B ⇒ 当场拒（不是事后发现）
  - parseRunManifest：坏 JSON / 缺字段 ⇒ EXPERIMENT_MANIFEST_INVALID
- **Run 状态迁移（唯一权威表）**
  - 合法迁移通过、终态不可再迁移
  - stale 只标注不改写：RUNNING 超阈值才算卡住
  - 没有 Manifest Key 就不许 COMPLETED（规格 §13 情况 A 的结构闸）
  - summarizeOutcome / isInlineViewable 与服务端契约常量一致
- **集成：Experiment → Run → Result → 对象存储 → Manifest → DB → 读回**
  - 顺序落库并写全产物；重新查询可完整读回（页面刷新不必重跑）
  - 执行期失败 ⇒ outcome FAILED + Run FAILED，且**不写任何对象**（不留悬挂 RUNNING）
  - 请求本身不成立（未注册实验）⇒ 直接抛领域错误，**不留任何行**
- **失败路径：对象存储不可用 / 上传失败（情况 A 的守门）**
  - 存储不可用 ⇒ Run=FAILED（**绝不 COMPLETED**），但真实 outcome 仍如实返回
  - 上传失败（PUT_FAILED）⇒ Run=FAILED 且错误码 = EXPERIMENT_ARTIFACT_UPLOAD_FAILED
  - 上传成功但对象随即消失（验证阶段发现）⇒ 仍收敛为 FAILED，不用 COMPLETED 埋雷
- **读路径：引用与对象不一致时必须如实报告**
  - 对象被外部删除 ⇒ 仍然可读，但 missing 被点名、inlineViewable=false
  - Manifest 内容被改坏 ⇒ artifactsAvailable=false 并给出 EXPERIMENT_MANIFEST_INVALID
  - 存储整体不可读 ⇒ artifactsAvailable=false 且 manifest/result 为 null（不伪造空结果）
- **Artifact 读取授权（两道闸）**
  - 未登记进 Manifest 的 Key ⇒ EXPERIMENT_ARTIFACT_NOT_FOUND
  - 跨 Run 的 Key ⇒ 结构闸拒绝（EXPERIMENT_ARTIFACT_KEY_INVALID）
  - 非法 Key（越界段）在任何存储访问之前就被拒
  - 读不存在的 Run ⇒ EXPERIMENT_RUN_NOT_FOUND（不返回空对象）
- **幂等：重复 finalize / Run id 冲突 / 人工收敛**
  - 同一 Run 用同一 Manifest Key 重复 markCompleted ⇒ 幂等 no-op（不抛错、不改内容）
  - 同一 Run 用**不同** Manifest Key 重复 finalize ⇒ 拒绝（不静默改引用）
  - 重复 markFailed 幂等；已 COMPLETED 的 Run 不会被打回 FAILED
  - Run id 连续冲突 ⇒ 抛 EXPERIMENT_RUN_ID_CONFLICT（而不是撞出一个重复行）
  - reconcileRun：RUNNING → FAILED（带留痕）；非 RUNNING 一律拒
  - 落库行本身不会出现「COMPLETED 但无 manifestKey」的非法组合
- **异步启动：后台队列与持久化生命周期**
  - start 立即返回 PENDING；队列 drain 后收敛为 COMPLETED
  - Run 历史支持 offset 分页，避免长期只能看到固定首页
- **惰性解析对象存储**
  - 未调用任何存储操作时，resolveStorage 不被求值（=> 未配 MinIO 也能读列表/历史 Run）

### `tests/server/researchExperiments/runRepositoryRetry.test.ts`
- 172 行 ｜ 用例声明 7 ｜ describe 1
- 被测源码：`server/researchExperiments/persistence/runRepository.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/runRepositoryRetry.test.ts`
- 用例树：
- **004 · Run 仓库的只读重试（冷连接瞬时失败不得变成页面 500）**
  - getRun：首次瞬时失败 → 重试一次后成功（调用 2 次，返回 null 而不是抛错）
  - listRuns：首次瞬时失败 → 重试后返回（调用 2 次，返回空数组）
  - countRunsByExperiment：重试后读到真实计数（不是退化成 0）
  - latestRunByExperiment：两步查询整体重试一次后成功
  - 语义错误（ER_NO_SUCH_TABLE）**不重试**，只调用 1 次并原样抛出
  - 超过重试上限后仍然抛出（有界，不会把请求挂死）
  - 🔴 写路径不重试：createRun 的 insert 瞬时失败只调用 1 次（重试写会重复写入）

### `tests/server/researchExperiments/strategyBridge.test.ts`
- 480 行 ｜ 用例声明 11 ｜ describe 4
- 被测源码：`shared/researchExperimentsContracts.ts` · `server/researchExperiments/strategyBridge.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchExperiments/datasetPort.ts` · `server/research/strategyCandidate/types.ts` · `server/research/strategyCandidate/provenance.ts` · `server/research/strategyCandidate/definitionBuild.ts` · `server/research/vocabulary.ts` · `server/research/strategyCandidate/strategyPromotionPort.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/strategyBridge.test.ts`
- 用例树：
- **桥 · CandidateSketchCarrier 的旧锚不影响产物**
  - 两组不同旧锚值 ⇒ definition / executionAssumptions / recipe 逐字节相等
- **溯源 · sourceKind 分派必填面**
  - 旧体系（缺省）三个旧锚必须为正整数（与 002 之前逐字一致）
  - 独立实验来源：三个旧锚必须为 null（禁假 id 凑数），且必须给实验坐标
  - InMemory 仓储按同一批断言（两个实现同一语义）
- **桥 · 成功路径与失败出口**
  - 成功：写溯源（sourceKind=INDEPENDENT_EXPERIMENT / 三锚为 null / 有 digest）
  - 实验执行期失败 ⇒ EXPERIMENT_RUN_FAILED（不拿失败结果造策略）
  - 实验未注册 ⇒ EXPERIMENT_INVALID（执行前错误透出领域码）
  - 策略创建失败 ⇒ STRATEGY_CREATE_FAILED
  - 策略已建但溯源写失败 ⇒ PROVENANCE_WRITE_FAILED 且**回报已产生的坐标**
  - 草案非法（缺 entryRule）⇒ DRAFT_INVALID
- **桥 · 实验结果指纹**
  - 同结果 ⇒ 同 digest；改一个统计量 ⇒ digest 变（canonical + sha256）

### `tests/server/researchExperiments/strategyBridgeEvidence.test.ts`
- 704 行 ｜ 用例声明 13 ｜ describe 4
- 被测源码：`server/researchExperiments/strategyBridge.ts` · `server/researchExperiments/evidenceRunReader.ts` · `server/research/strategyCandidate/provenance.ts` · `server/research/strategyCandidate/service.ts` · `server/research/strategyCandidate/researchEvidence.ts` · `server/research/strategyCandidate/strategyPromotionPort.ts` · `server/research/strategyCandidate/types.ts` · `server/researchExperiments/firstBoardPullbackStrategyDraft.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/strategyBridgeEvidence.test.ts`
- 用例树：
- **§18.3 按真实持久化 Run 建策略**
  - 1-a) 合法证据 ⇒ 建出 1.0.0 + 写溯源 + 证据进快照（首条真实闭环的单元级证明）
  - 1-b) 幂等：同证据重放 ⇒ 复用既有溯源行、`created=false`、不写第二行
  - 1-c) 同版本挂**另一套**证据 ⇒ EVIDENCE_PROVENANCE_CONFLICT（绝不覆盖历史快照）
- **§12 / §18.4 按 Run 建策略的失败面**
  - 2-a) 引用的 Run 不存在 ⇒ EVIDENCE_RUN_NOT_FOUND（禁手写 Run id）
  - 2-b) Run 未完成 / 结果读不回 / 缺参数快照 ⇒ 各自专属码，且都不写任何东西
  - 2-c) reference 在结果里解析不到 ⇒ EVIDENCE_REFERENCE_UNRESOLVED（不得虚构 artifact）
  - 2-c2) Exploratory / Gate 未 PASS / 协议不一致的 Run 不得进入正式策略
  - 2-d) 多份证据 Dataset 分歧 / 要求执行绑定分歧 ⇒ EVIDENCE_DATASET_MISMATCH
  - 2-e) 装配未注入读回端口 ⇒ EVIDENCE_READER_UNAVAILABLE（不静默降级成「不核实」）
- **§6 证据进「可追溯身份」**
  - 3-a) 证据段被冻结进 sourceSnapshotJson，且**通过声明即受校验**
  - 3-b) 证据变 ⇒ 指纹变；证据不变 ⇒ 指纹不变（身份能识别来源变化）
- **§16 溯源读路径能看到研究证据**
  - 4-a) 读到 5 条证据（EXP 编号 / 版本 / Run / Dataset 版本 / 引用）+ 证据指纹
  - 4-b) 非证据型溯源（历史行）⇒ `[]` + `null`（读路径不因形态旧而失败）

### `tests/server/researchExperiments/thresholdRacePolicyStudy.test.ts`
- 138 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/threshold-race-policy-study/experiment.ts` · `research-experiments/first-board-pullback/threshold-race-policy-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/thresholdRacePolicyStudy.test.ts`
- 用例树：
- **threshold-race-policy-study**
  - 比较正负阈值先到时的止盈止损规则

### `tests/server/researchExperiments/turnoverStudy.test.ts`
- 141 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/turnover-study/experiment.ts` · `research-experiments/first-board-pullback/turnover-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/turnoverStudy.test.ts`
- 用例树：
- **turnover-study**
  - 计算换手率分桶和日期聚类 Bootstrap，并披露流通市值缺失

### `tests/server/researchExperiments/volumeRecoveryFilteredValidation.test.ts`
- 142 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/volume-recovery-filtered-validation/experiment.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/volumeRecoveryFilteredValidation.test.ts`
- 用例树：
- **volume-recovery-filtered-validation**
  - 过滤小实体 / 高换手，并在量能未恢复时退出

### `tests/server/researchExperiments/volumeRelationshipDynamicEntryStudy.test.ts`
- 136 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`research-experiments/first-board-pullback/volume-relationship-dynamic-entry-study/experiment.ts` · `research-experiments/first-board-pullback/volume-relationship-dynamic-entry-study/result.ts` · `server/researchExperiments/datasetPort.ts` · `server/researchExperiments/registry.ts` · `server/researchExperiments/runner.ts` · `server/researchRuntime/datasetReader.ts` · `server/researchRuntime/versionContext.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchExperiments/volumeRelationshipDynamicEntryStudy.test.ts`
- 用例树：
- **volume-relationship-dynamic-entry-study**
  - 在固定动态入场后计算 T-n/T 与 T+N/T 量比
