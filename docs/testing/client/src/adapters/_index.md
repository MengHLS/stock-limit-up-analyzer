<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/client/src/adapters

- 测试文件 **5** 个 ｜ 用例声明 **147** 个
- 涉及源码目录：`client/src/adapters/` · `server/research/strategyCandidate/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/client/src/adapters                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/client/src/adapters/closedLoopRunAdapter.test.ts`
- 414 行 ｜ 用例声明 23 ｜ describe 7
- 被测源码：`client/src/adapters/closedLoopRunAdapter.ts`
- 单跑：`pnpm exec vitest run tests/client/src/adapters/closedLoopRunAdapter.test.ts`
- 用例树：
- **closedLoopRunAdapter — 空态**
  - emptyClosedLoopRun 不携带任何「看起来跑过」的字段
- **closedLoopRunAdapter — 防御性解析**
  - 非对象 / 无 runId → null（保持空态，不臆造）
  - 缺 wiring / overall → 全部降级为空，不抛错
  - 未知阶段状态 → UNKNOWN（不猜成 EXECUTED）
  - 阶段缺 stageId 的行被丢弃（不产生空键行）
- **closedLoopRunAdapter — 映射**
  - 全链概要 / 计数 / 装配覆盖逐字段透传
  - 阶段行含阻塞 reasonCode / detail / 交接指纹
- **closedLoopRunAdapter — 评估标量（零计算）**
  - evaluation EXECUTED 且有 evaluationRef → 直搬三节标量
  - evaluation 未 EXECUTED → evaluation 为 null（不读残缺 output）
  - output.kind ≠ evaluationRef → 不抽取（防张冠李戴）
  - 三节全缺 → null（不返回「全 null 的伪标量对象」）
  - 缺字段 → null 而非 0（不推算、不填零）
- **closedLoopRunAdapter — RunResultViewModel 投影**
  - 指标按既定字段对应直搬（cagrPct → annualizedReturnPct 等改名，不换算）
  - 无评估标量 → 全 null 且 hasData=false（UI 显示空态）
- **closedLoopRunAdapter — experimentId 派生**
  - 形态符合 EXP-YYYYMMDD-XXXXXXXX
  - 同配置 + 同日 → 同 id；任一输入变化 → 不同 id
  - 跨日 → 不同 id（日期段随当日变化）
- **classifyRebuildScope — 成交明细范围的可信度判定**
  - A. 有继承声明（或「沿用该数据集声明的约束」）→ inherited
  - B. 明说「未继承任何板块约束」→ declared-unscoped（已知全板块，不是未知）
  - C. 🔴 修复前的历史 note（无任何范围声明）→ unknown：这正是用户看到 300/688 的那条
  - D. null / 空 → unknown（不说话 ≠ 已确认）
  - E. 只有 rebuild 才判定：直读命中 → rebuildScope = null
  - F. 端到端形态：rebuild + 修复后 note ⇒ inherited；rebuild + 修复前 note ⇒ unknown

### `tests/client/src/adapters/datasetRegistryAdapter.test.ts`
- 222 行 ｜ 用例声明 15 ｜ describe 4
- 被测源码：`client/src/adapters/datasetRegistryAdapter.ts` · `shared/datasetRegistryContracts.ts`
- 单跑：`pnpm exec vitest run tests/client/src/adapters/datasetRegistryAdapter.test.ts`
- 用例树：
- **datasetRegistryAdapter · 列表 / 详情 / 版本元信息聚合**
  - 列表：聚合 versionCount / latestVersion / latestVersionStatus
  - 列表空态：无版本 → versionCount=0 / latest=null
  - 列表：updatedAt 原样透传（null 归一为 null）
  - 版本列表：dateRange / totalEvents / totalRows 映射
  - 版本列表：缺 endDate 时 dateRange 半开
- **datasetRegistryAdapter · 作业状态与进度**
  - RUNNING + chunk 比例 → progress 50%
  - COMPLETED → progress 100%
  - RUNNING 无 chunk 信息 → progress null（不臆造）
  - 五态 status 原样透传
  - detail 形态附带 checkpointSummary 摘要
- **datasetRegistryAdapter · 统计**
  - 统计：event/path/outcome/rowCount/firstDate/lastDate 映射
  - 统计：horizons 与 declared 透传
- **datasetRegistryAdapter · 错误态 / 格式化**
  - 错误 → DiagnosticError（code/title/suggestions/technical）
  - formatCount：number 千分位 / null → —
  - formatDateTime：ISO → 本地 YYYY-MM-DD HH:mm / null → —

### `tests/client/src/adapters/researchEngineAdapter.test.ts`
- 719 行 ｜ 用例声明 50 ｜ describe 10
- 被测源码：`client/src/adapters/researchEngineAdapter.ts`
- 单跑：`pnpm exec vitest run tests/client/src/adapters/researchEngineAdapter.test.ts`
- 用例树：
- **researchEngineAdapter — 指标单位与格式化**
  - 自带单位的指标码不依赖变量名
  - 无单位指标码必须看变量名（同一 MEAN 在不同变量上单位不同）
  - 收益型变量识别覆盖后端全部收益变量族
  - 百分比 / 计数 / 统计量各自格式化；null 一律显示 —（不显示 0）
  - 极小非零百分比不被显示成假零
  - 标签：指标中文名 / 变量中文名；未收录原样返回不臆造
  - 时长格式化
- **researchEngineAdapter — 分组维度**
  - 五种真实维度写法都能渲染成可读标签
  - 维度排序键稳定且与键顺序无关
  - Q2 必须排在 Q10 之前（数值排序，不是字符串排序）
- **researchEngineAdapter — 结果行 / 分组块**
  - 逐指标保留各自的样本数，分母不一致时不给统一的「组样本数」
  - 全部指标样本数一致时才给出统一的组样本数
  - 标量行与分组行分离（顶底差 / p 值差值走 SCALAR）
  - 结果行读取 details.variable 以决定单位；缺失变量时不猜
  - 指标值为 null 的合法结果行显示 —，不显示 0
- **researchEngineAdapter — 分档区间与结论速览**
  - 分档端点反解：首档 ≤、末档 >、中间为左开右闭（与 band(v) 规则同源）
  - 区间把「第 5 档」翻成「跌幅最小」—— 档号本身不含方向，靠它才读得懂符号
  - 非分档分组（条件组 / 变量 / 板块）不产出区间，不臆造
  - QUANTILE 的区间单位由特征变量决定（比例型特征 → 百分数）
  - buildHeadline 对分档分析给出顶底档与引擎写入的差值口径
  - buildHeadline 对条件分析把「满足条件」当主语、「全样本」当参照（差值口径原样带出）
  - 名义分类维度（变量 / 板块 / 行业）不做顶底差 —— 无序维度之间没有「差值」可言
  - 分组不足 2 组时不硬凑结论
- **researchEngineAdapter — 对照组反推**
  - 按恒等式反推「不满足条件」那组的均值
  - 条件组均值与全样本相同时，反推值也相同（不会凭空造出差异）
  - 反推值可无损还原全样本均值（round-trip）
  - 没有剩余样本（条件组 ≥ 全样本）时返回 null，而不返回 0 或自身
  - 计数缺失或非正时返回 null（宁可缺数，也不给可疑数）
  - 均值缺失或非有限数时返回 null
- **researchEngineAdapter — 有序变量序列（趋势图）**
  - volume_ratio 的中文名已登记（防回归成「volume_ratio T+1」这种半工程名）
  - 量比族：识别为有序序列，基准线 = 1，点按滞后阶数升序
  - 收益族的基准线是 0（不是 1）
  - 指标码去重且保持首次出现顺序
  - 族不一致 / 变量名不是滞后族 / 混入分组维度 → 不认（宁可不出图，也不乱出）
  - 滞后重复 / 少于 2 个点 → null
- **researchEngineAdapter — 实验 / Run**
  - runToVm 由起止时间算时长；失败原因必须冒泡
  - 预检拒绝（从未 startedAt）时长为 null，而不是 0
  - experimentToVm 归一 null 字段
- **researchEngineAdapter — 结论 evidence**
  - 解析真实 evidence：阈值口径 / 主效应 / 规则轨迹 / 免责声明全部落位
  - 主分析为 null（证据不足分支）不崩，且仍保留阈值与轨迹
  - 兼容统一之前落库的旧键名（trace / analyses）
  - evidence 缺失 / 非对象时返回空壳而不是抛错（老数据兼容）
- **researchEngineAdapter — Finding → VM（RESEARCH-FINDING-001）**
  - findingTypeLabelOf 覆盖六维类型；未收录回退原值
  - 数值原样映射；缺失即 null，不在前端重算
  - 基准不可得时显式标记 benchmarkUnavailable，而不是假装有基准
  - 档位明细优先级：effect.buckets > monotonicity.buckets > horizon.points
- **researchEngineAdapter — 错误诊断**
  - 引擎错误码被翻译成「下一步做什么」，而非裸抛错误码
  - 支持 [CODE] 包裹形式
  - 未知错误退化为通用 RPC_ERROR，不臆造建议
  - 空消息也有可读解释

### `tests/client/src/adapters/strategyAdapter.test.ts`
- 128 行 ｜ 用例声明 9 ｜ describe 2
- 被测源码：`client/src/adapters/strategyAdapter.ts`
- 单跑：`pnpm exec vitest run tests/client/src/adapters/strategyAdapter.test.ts`
- 用例树：
- **strategyAdapter 无损往返**
  - 已知字段往返保真
  - extra 透传字段（recipe/metadata）不丢
  - rules 往返保真（field/operator/operand）
  - positionSizing 往返保真
  - nullable 参数显式 defaultValue:null 不丢
  - costModel 与 executionModel 往返保真
- **strategyAdapter 展示 helpers**
  - ruleConditionText 生成可读条件
  - positionSizingLabel 映射中文标签
  - emptyRule 生成合法默认规则

### `tests/client/src/adapters/strategyCandidateAdapter.test.ts`
- 648 行 ｜ 用例声明 50 ｜ describe 12
- 被测源码：`client/src/adapters/strategyCandidateAdapter.ts` · `server/research/strategyCandidate/candidateTypes.ts`
- 单跑：`pnpm exec vitest run tests/client/src/adapters/strategyCandidateAdapter.test.ts`
- 用例树：
- **sketchFieldText**
  - 1-a) null / undefined / 纯空白字符串都表示「未填写」
  - 1-b) 对象 → 缩进 JSON（原样，不重排语义）
  - 1-c) 字符串 → 原文；其它原始值 → String()
- **candidateStatusLabelOf**
  - 2-a) 六态都有中文标签
  - 2-b) 未收录状态回退原文、空值回退「—」（不猜）
- **candidateToDetailVm**
  - 3-a) 基础信息 + 来源 + 草图一次映射完整
  - 3-b) 草图五项齐全，未填写的标 present=false（不是空字符串）
  - 3-c) 未转正时 strategyDefinitionId 为 null（合法状态，不伪造）
  - 3-d) sourceResearchRunId 为 null 时如实为 null（证据提不出，不伪造）
  - 3-e) 来源缺失必须转成人话，并说明是快照
  - 3-f) CANDIDATE_SKETCH_FIELDS 与 VM 输出顺序一致（防止两处顺序漂移）
- **sourceMissingNote**
  - 4-a) 无缺失 → null（不显示无用提示）
  - 4-b) 未收录的缺失原因原样透出（不吞、不猜）
- **candidateToRowVm**
  - 5-a) 列表行保留来源结论与来源 Dataset 坐标（唯一坐标，不用 label 比对）
- **candidateErrorDiagnostic**
  - 6-a) 同名候选冲突：给出可执行解释 + 后端原文
  - 6-b) 权限不足：标题与建议都指向管理员身份
  - 6-c) 状态流转 CONFLICT：提示按当前状态重选，不替换成前端自己的判定
  - 6-d) 状态流转 CONFLICT 明确写出「CONVERTED 不由状态流转产生」
  - 6-e) 没有 hint 的组合只回显后端原文 —— 不编造「合理但不存在」的规则
  - 6-f) 没有错误码时**不臆造**领域码：回退 RPC_ERROR，只展示后端原文
  - 6-g) 无消息、非对象输入都不崩，且给出「无错误信息」兜底
  - 6-h) 未收录的 code 只显示通用标题，不编解释
- **promoteResultToVm**
  - 7-a) 首次转正：说「转正成功」，并同时给出 Strategy 坐标与执行 Dataset
  - 7-b) 🔴 幂等命中：标题必须是「未创建新的 Strategy Version」，**不得**出现「创建成功」
  - 7-c) 拿不到执行 Dataset 的 label 时只显示 #id（不猜一个像样的名字）
  - 7-d) 来源/执行两个 Dataset 坐标与分歧原因原样带出（对照展示用，不重算）
- **strategyVersionPath**
  - 8-a) 落点是策略**详情页** `/strategies/:strategyId` + 版本参数（列表与详情分家）
  - 8-b) 坐标做 URL 编码（不裸拼，特殊字符不会串位）
  - 8-c) promoteResultToVm 产出的 path 与直接构造一致（不会两处漂移）
- **readRpcDomainCode（§7 领域码跨 tRPC 边界的读取约定）**
  - 9-a) 只认 `[CODE]` 写法：裸词 / 小写 / 长度不足都不算领域码（不推断）
  - 9-b) 领域码在 message 开头 —— 与后端 `withDomainCode` 拼接顺序一致
- **promoteFailureVm（§11 / §27.4）**
  - 9-c) 14 个领域码得到**两两不同**的诊断（≥7 个各不相同，不能一句话糊弄所有失败）
  - 9-d) 领域解释与后端原文**同时**呈现（不吞原文，用户与开发者都能看懂）
  - 9-e) 拿不到领域码（如 zod 传输层拒绝）→ 不臆造，回退 tRPC 通用标题并保留原文
  - 9-f) 完全没有可用信息也不崩，且不编造领域码
  - 9-g) 🔴 写回失败：解析后端 details 的三个坐标 + stage，并劝「不要新建候选」
  - 9-h) 只有写回失败才带 writeback 坐标（其余失败绝不显示「已产出的 Strategy」）
  - 9-i) 草图类失败的建议是「回去改草稿」，不是「在转正时另给定义」
  - 9-j) 状态不对时建议「先流转到 ACCEPTED」（可执行，而不是泛泛重试）
- **promotionProvenanceToVm**
  - 10-a) 完整溯源：来源类型 + 五个上游坐标 + 创建时间，一项不少
  - 10-b) 没有溯源行（未转正 / 非本系统产出）→ hasProvenance=false 且**不生成**空行
  - 10-c) 上游已删除：如实标注该行缺失 + 明说「不影响策略读取与执行」（§23）
  - 10-d) 无缺失时不显示无用提示
  - 10-e) 来源 Dataset 与执行 Dataset **两个坐标都保留**（对照展示，不合并、不覆盖）
  - 10-f) 缺值一律显示 null（如实留空，不补 0 / 不补「未知」）
  - 10-g) 免责声明是原话：溯源不参与执行（§13 要求必须展示）
- **parsePromoteWritebackDetails**
  - 11-a) 解析后端 `describeDetails` 的真实格式（key=value / key=value）
  - 11-b) 解析不到就全 null（**绝不**用本地状态补一个看起来对的 id）
  - 11-c) 键名必须完全匹配：近似的错误键名不会被误读
  - 11-d) 键存在但值为空 → null（不把空串当坐标）
