<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/researchEngine

- 测试文件 **18** 个 ｜ 用例声明 **269** 个
- 涉及源码目录：`server/datasetRegistry/` · `server/researchCore/` · `server/researchCore/repository/` · `server/researchEngine/` · `server/researchEngine/analyses/` · `server/researchEngine/finding/` · `server/researchEngine/report/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/researchEngine                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/researchEngine/analyses/analyses.test.ts`
- 626 行 ｜ 用例声明 28 ｜ describe 7
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/sampleSet.ts` · `server/researchEngine/analyses/registry.ts` · `server/researchEngine/analysisConfig.ts` · `server/researchEngine/variables.ts` · `server/researchEngine/testFixtures.ts` · `server/researchEngine/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/analyses/analyses.test.ts`
- 用例树：
- **DESCRIPTIVE**
  - 输出 mean / median / std / percentile 且结构化落 dimension=variable
  - 缺失值如实计入 missing_count / missing_rate（不当 0）
- **EVENT_STUDY**
  - T+1 / T+3 / T+5 各自成组，均值与手算一致
  - MFE / MAE / 突破率来自 Dataset 真实列，且注明时间维度只实现 daysToBreakout
  - 无可用视界时不产出假数据，并在 notes 中说明
  - 回归：T+1/T+3 只存在于 path（无 outcome 聚合列）时不得失败，也不得虚构 MFE/MAE
- **QUANTILE**
  - 10 分位：分组、每组统计与顶底分位差
  - 5 分位：分组数 = 5
  - 空数据：不产出任何分组，且不产出顶底差（不编造 0）
  - 边界并列：相同特征值不被劈开，实际分组数如实少于请求值
- **CONDITIONAL**
  - 单条件：条件组 vs 全样本 + 差值 / 相对差值 / 组间检验
  - AND 条件：区间过滤（turnover BETWEEN 8 AND 15）
  - 空条件：显式失败（不静默退化成「等于全样本」）
  - 回归：目标是 path 独有视界（无对应 outcome 回撤列）时不得失败
  - 维度条件（market）也能求值
- **STABILITY**
  - year 分组：跨年方向一致性
  - 回归：只有 1 个分组时不产出 STABILITY_RATIO（单组恒为 1，会被误读为「高度稳定」）
  - regime 分组：未注入标签源 → REGIME_PROVIDER_UNAVAILABLE（绝不用近似标签冒充）
  - regime 分组：注入标签源后可用
- **Registry 派发**
  - 已实现的 6 类分析均已注册；未实现类型具名失败
  - 重复注册被拒绝
- **SEGMENT_RELATION**
  - 变量需求 = 两个真实变量名（窗 A 复用既有族、窗 B 用分段族）
  - 缺窗时需求为空（执行器不替用户猜一个窗）
  - 分档 + 配对：逐档统计窗 B、同一样本两段行情的共变，以及顶底档差
  - 缺失不插补：任一侧缺失即整对丢弃，且如实说明被排除的样本数
  - 窗 B 口径为「最大跌幅」时不产出 WIN_RATE（「> 0 占比」不是胜率）
  - 执行器自己再断言一次不重叠：上游把关被绕过时也不静默出结论
  - 样本不足两档时不产出顶底档差，并如实说明（不假装算出了差异）

### `tests/server/researchEngine/analysisConfig.test.ts`
- 148 行 ｜ 用例声明 11 ｜ describe 2
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/analysisConfig.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/variables.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/analysisConfig.test.ts`
- 用例树：
- **SEGMENT_RELATION 窗解析**
  - 合法两窗原样透传，并映射到真实变量名
  - 窗起点为 0 时复用既有变量族（不另造一套口径）
  - 窗形态非法一律具名失败（畸形 / 非整数 / from < 0 / to ≤ from）
  - 口径必须在 SEGMENT_STAT_KINDS 内
  - 缺窗不给默认值（替用户猜一个窗等于替他选题）
  - 分段窗超出真实 path 视界 ⇒ INVALID_ANALYSIS_CONFIG（不返回 null 冒充可用）
  - windowBands 必须是 2..100 的整数
- **SEGMENT_RELATION 重叠守卫（WINDOW_OVERLAP）**
  - 紧邻窗（[0,5] 与 [5,20]）不算重叠 —— 锚点日只提供基准价
  - 取值区间相交即拒绝，且错误码是 WINDOW_OVERLAP（不是笼统的配置非法）
  - 重叠时错误信息把两个取值区间与建议写法都说清楚
  - 完全分离的窗通过（窗 A 在后段、窗 B 在更后段）

### `tests/server/researchEngine/batchCreate.test.ts`
- 268 行 ｜ 用例声明 16 ｜ describe 4
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/batchCreate.ts` · `server/researchEngine/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/batchCreate.test.ts`
- 用例树：
- **implementedAnalysisTypes**
  - 取自执行器注册表（唯一权威），并且恰好是已实现的 6 类
- **preflightBatchCreateItems**
  - 合法输入 → 无问题
  - 空批次 → 整批级问题（index = -1）
  - 未实现的类型被点名，且提示里列出已实现集合
  - 名称空白 → 报错；超 200 字符 → 报错
  - CONDITIONAL 缺条件 → 报错；有条件 → 通过
  - 条件行存在但 fieldName 为空白 → 视同没有条件
- **assertBatchCreateItems**
  - 超出单批上限 → BATCH_TOO_LARGE（且消息里有两个数字）
  - 预检失败 → BATCH_VALIDATION_FAILED，消息显式写明「未创建任何分析」
- **createAnalysesBatch**
  - 正常批量：逐项创建，index 与入参一一对应
  - 条件真实落库（created 项保证「有 id 就能跑」）
  - Run 不存在 → RUN_NOT_FOUND
  - 预检失败 → 抛错且**一个都没建**
  - 条件写入失败 → 补偿删除该分析，并计入 failed（不留半成品）
  - 回滚本身失败时如实标注（不静默吞掉）
  - 单批上限内即上限本身可用（边界不误伤）

### `tests/server/researchEngine/columnProjection.test.ts`
- 325 行 ｜ 用例声明 13 ｜ describe 5
- 被测源码：`server/researchEngine/columnProjection.ts` · `server/researchEngine/variables.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/sampleSet.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/columnProjection.test.ts`
- 用例树：
- **列投影 · 派生**
  - 结构列无论变量怎么声明都会被保留
  - 确实发生裁剪：大宽列（open/high/low/amount/createdAt…）不进投影
  - 只申请与 prefix 无关的变量时，prefix 投影只剩结构列
  - 维度键所需的列也算进投影（board → boardType）
  - 变量读了表里不存在的列 → 派生阶段就抛错（不可能静默变 null）
- **列投影 · 逐变量差分（全列 vs 投影）**
  - 每个特征变量：投影后取值 == 全列取值
  - 每个结果变量：投影后取值 == 全列取值
- **列投影 · 越界守卫**
  - 读未投影的列 → PROJECTION_MISSING_COLUMN（不静默 null）
  - 读已投影的列（含 null）与无关属性都放行
  - 全列投影下不拦任何列读取
- **列投影 · 装配层端到端差分**
  - 不裁剪 与 自动派生裁剪 的装配结果完全一致（且在全程守卫下不越界）
  - 流水线并发不改变批序与结果（并发 1 与 3 结果一致）
- **列投影 · 守卫策略解析**
  - 默认 first-chunk，可显式关闭或全开

### `tests/server/researchEngine/conclusion.test.ts`
- 159 行 ｜ 用例声明 12 ｜ describe 1
- 被测源码：`server/researchEngine/conclusion.ts` · `server/researchEngine/types.ts` · `server/researchCore/index.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/conclusion.test.ts`
- 用例树：
- **ConclusionBuilder**
  - 全部达标 → SUPPORTED，且结论正文强制带免责声明
  - 样本不足 → INCONCLUSIVE（即使效应很大）
  - 效应低于最小实际阈值 → REJECTED（不因 p 值小而宣称有差异）
  - 方向一致但统计不达标 → PARTIALLY_SUPPORTED
  - p 值算不出（null）视为未达标 → PARTIALLY_SUPPORTED（保守）
  - 方向不稳定 → INCONCLUSIVE
  - 没有任何可用主效应 → INCONCLUSIVE
  - 主分析按固定优先级选取（QUANTILE 优先于 EVENT_STUDY），不按效应大小挑选
  - confidence 是主观置信度 [0,1]，且显式标注「不是 p 值」
  - 策略阈值原样写入 evidence（可复核 / 可复现）
  - 规则轨迹完整（每一步判定都留痕）
  - evidence 形状在两个分支间保持一致（单一构造入口）

### `tests/server/researchEngine/conditionEvaluator.test.ts`
- 134 行 ｜ 用例声明 11 ｜ describe 1
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/conditionEvaluator.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/conditionEvaluator.test.ts`
- 用例树：
- **条件求值器**
  - 空条件集 = 恒真（无条件即不过滤）
  - 单条件：数值比较
  - AND 条件：全部满足才通过
  - OR 条件：任一满足即通过
  - NOT = 「AND NOT」（取反 + AND），不是连接符
  - BETWEEN 为闭区间 [low, high]；区间反转视为不满足（不静默交换）
  - IN / NOT_IN
  - null 参与比较一律为 false（除 IS_NULL / IS_NOT_NULL）
  - 条件组之间按 groupLogicalOperator 左结合（组 1 的 OR 表示 (g0) OR (g1)）
  - 条件组之间按 AND 时须全部满足
  - 组内条件按 sortOrder 排序后求值（与输入顺序无关）

### `tests/server/researchEngine/engine.test.ts`
- 421 行 ｜ 用例声明 16 ｜ describe 1
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/engine.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/testFixtures.ts` · `server/researchEngine/datasetReader.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/engine.test.ts`
- 用例树：
- **ResearchEngine**
  - Experiment 不存在 → EXPERIMENT_NOT_FOUND
  - Run 不属于该 Experiment → RUN_EXPERIMENT_MISMATCH
  - Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND
  - Dataset Version 非 READY → DATASET_VERSION_NOT_READY（BUILDING 版本不得用于研究）
  - 无 Analysis → NO_ANALYSES
  - 未实现的分析类型 → UNKNOWN_ANALYSIS_TYPE；Run 落 FAILED 但 startedAt 为空（预检拒绝）
  - 配置非法（QUANTILE 缺 featureField）→ INVALID_ANALYSIS_CONFIG；Run 落 FAILED 且未开始执行
  - Run 不存在 / Run 不归属该 Experiment → 不回写任何状态（无法归因则不动状态）
  - Run 状态非 PENDING/FAILED/CANCELLED → RUN_NOT_PENDING
  - 重跑时 RUNNING 转换必须清掉上一轮的失败残留（errorCode / errorMessage / completedAt）
  - 执行期失败 → Run 落 FAILED 且 errorCode / errorMessage 已保存，未完成 Analysis 收敛为 CANCELLED
  - 分析执行器内部失败 → Run FAILED + errorCode=ANALYSIS_FAILED
  - 成功链路：5 类分析全跑通，结果与结论均可经 Repository 查回
  - 重跑幂等：二次执行不会重复累积结果行
  - 反模式守卫：执行不写 Dataset（事件 / 路径 / 结果行数与执行前一致）
  - 样本超硬上限 → DATASET_TOO_LARGE（诚实失败，不 OOM）

### `tests/server/researchEngine/engineIncremental.test.ts`
- 452 行 ｜ 用例声明 15 ｜ describe 5
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/engine.ts` · `server/researchEngine/testFixtures.ts` · `server/researchEngine/analyses/registry.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/engineIncremental.test.ts`
- 用例树：
- **ResearchEngine.runIncremental — 正常补跑**
  - 补跑新分析：新分析产出结果，旧分析的结果与完成时间**原样保留**
  - 🔴 补跑时的 RUNNING 转换必须清掉上一轮的失败残留（否则 errorCode 会「粘住」）
  - 🔴 复用 Run 冻结的基准：整轮后改 Run 配置的日期窗口，补跑仍按快照窗口装配
  - 省略 analysisIds → 自动补跑全部「尚无有效结果」的分析
- **ResearchEngine.runIncremental — 执行批次日志**
  - 整轮写 batch 1（FULL），补跑写 batch 2（INCREMENTAL），样本数与批次号都对得上
  - 快照不可变：补跑不修改 inputSnapshot（只追加执行日志）
- **ResearchEngine.runIncremental — 结论**
  - 补跑不生成结论，也不动既有结论（只用部分分析的摘要拼不出完整结论）
- **ResearchEngine.runIncremental — 拒绝非法目标**
  - 已 COMPLETED 的分析 → ANALYSIS_NOT_RUNNABLE（不覆盖）
  - 全部已完成且未指定 id → NO_RUNNABLE_ANALYSES
  - 分析不属于该 Run → ANALYSIS_NOT_IN_RUN
  - Run 正在 RUNNING → RUN_ALREADY_RUNNING
  - 从未整轮执行过（无基准快照）→ RUN_SNAPSHOT_MISSING，并指引先整轮执行
  - Run 属于别的 Experiment → RUN_EXPERIMENT_MISMATCH
- **ResearchEngine.runIncremental — 失败路径与可重入**
  - 补跑失败 → Run FAILED + errorCode；批次日志收敛为 FAILED（不留 RUNNING），此前批次结果保留
  - 失败后分析为 FAILED，可再次补跑并成功（批次号继续递增，不复用）

### `tests/server/researchEngine/finding/findingDetector.test.ts`
- 409 行 ｜ 用例声明 23 ｜ describe 9
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/finding/findingDetector.ts` · `server/researchEngine/finding/findingInteractionAnalyzer.ts` · `server/researchEngine/finding/resultView.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/finding/findingDetector.test.ts`
- 用例树：
- **§9 detectPattern —— 单调 / 峰 / 谷 / 无**
  - 全正差分 ⇒ 单调上升
  - 全负差分 ⇒ 单调下降
  - 内部最大 ⇒ 峰（并给出反转位置）
  - 内部最小 ⇒ 谷
  - 端点即极值 ⇒ NONE（不硬判峰谷）
  - 少于 3 档 ⇒ NONE（不足以判定）
- **§9 区间文字 —— 退化切点一律不编造**
  - 严格递增切点 ⇒ 还原区间
  - 切点全 0（真库 0/1 特征实测）⇒ 全部 null，且判为不严格递增
- **§7 样本分级（阈值配置化）**
  - 按 <100 / 100~299 / 300~999 / >=1000 分级
- **resultView —— Result 行 → 有序序列**
  - QUANTILE：档位带区间文字，且 ordinal 顺序由 quantile 号决定
  - CONDITIONAL：ALL 进 benchmark，不进 buckets
  - STABILITY：ALL 行进 benchmark；年份切片按数值排序
  - DESCRIPTIVE：不可评估（档位是变量名），但可作基准提供者
- **§6/§9 QUANTILE 探测**
  - 单调上升且差异达标 ⇒ MONOTONIC_RELATION，档位证据完整
  - 差异低于 materialityAbs ⇒ **不产出** Finding（如实「没有发现」）
  - 退化切点（全 0）⇒ 降级为 EFFECT，且不判定单调
  - 有同 Run 基准时报告真实 excessReturn
- **§10 EVENT_STUDY 探测**
  - 识别峰值视界与连续有效区间（对齐任务书示例）
- **§11 STABILITY 探测**
  - 三切片同向 ⇒ stable，effect 恒为 null（稳定性发现不主张效应量）
  - 正负各半 ⇒ contradicted（不进 SUPPORTED 路线）
  - 单切片 ⇒ 不产出 Finding（不可评估，不编造「稳定」）
- **§12 组合判定辅助**
  - 纯 AND ⇒ 可视为已测试；含 OR / NOT ⇒ 不可
- **fingerprint 幂等键**
  - 同 (runId, type, analysis, dimension) ⇒ 同值；任一变化 ⇒ 变值

### `tests/server/researchEngine/finding/findingPipeline.test.ts`
- 366 行 ｜ 用例声明 15 ｜ describe 5
- 被测源码：`server/researchCore/index.ts` · `server/researchCore/hypotheses.ts` · `server/researchEngine/finding/findingScorer.ts` · `server/researchEngine/finding/findingInteractionAnalyzer.ts` · `server/researchEngine/finding/resultView.ts` · `server/researchEngine/finding/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/finding/findingPipeline.test.ts`
- 用例树：
- **§14 研究评分**
  - 缺失维度**重归一化**：只有 effect 可用时，总分 = effect 分（不被未测维度拖低）
  - 五维全不可用 ⇒ 总分 null（无法评估，而不是 0 分）
  - 效应量在无基准时取档位间真实差异（§6「寻找明显差异」）
  - score 恒写 DISCOVERED（引擎无权宣布 SUPPORTED）
  - §9 PEAK 的单调性取**更强的单调腿**（而非整体秩相关）
- **§12 Interaction —— 有 Result 才产 Finding，否则只产未验证假设**
  - 存在纯合取且子句 ⊇ 并集的分析 ⇒ 产出 INTERACTION Finding（引用真实 findingIds）
  - 没有任何分析覆盖组合 ⇒ **不产 Finding**，只回传 untested（任务书 §12）
  - 组合分析含 OR ⇒ 不认（保守充分条件，宁可说没验证过）
  - 互为子集的两条条件不算组合（无信息量）
- **§21 Look-ahead —— Outcome 不得进入信号条件**
  - Outcome 字段出现在条件中 ⇒ 拒绝
  - 仅特征 / 观察日字段 ⇒ 通过
- **§13 Finding 状态 / §3.1 provenance 守卫**
  - 引擎不能写 DISCOVERED 以外的状态
  - 无 Result provenance 的 Finding 被拒绝（禁止凭空产生发现）
- **§18 Hypothesis → Candidate 资格**
  - 非 SUPPORTED 的假设不得转 Candidate
  - SUPPORTED 但未形式化（缺 conditions/target/horizon）仍被拒

### `tests/server/researchEngine/maintenance.test.ts`
- 432 行 ｜ 用例声明 19 ｜ describe 6
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/maintenance.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/maintenance.test.ts`
- 用例树：
- **analysisIdsReferencedByConclusionEvidence**
  - 提取当前形状（primaryAnalysis + contributingAnalyses）
  - 兼容历史分支键 analyses（旧 evidence 形状）
  - 形状不认识 → 返回空数组（不猜，交由调用方按不可归属处理）
- **deleteRunCascade — 结论归属必须精确**
  - 只删归属该 Run 的结论，另一个 Run 的结论保留
  - 删 Run 会清掉它的条件 / 指标定义 / 结果行（孤儿为 0）
  - 证据提不出 analysisId 的结论**不删**，并如实计入 unattributedConclusions
  - Run 不存在 → RUN_NOT_FOUND
  - RUNNING 的 Run → DELETE_CONFLICT（拒绝删飞行中的写入）
- **deleteExperimentCascade — 整树无残留**
  - 级联删除后各实体计数与仓储状态一致（无孤儿）
  - 多 Run 实验：全部 Run 一并删除
  - 有 RUNNING 的 Run 时整体拒绝（不留半删状态）
  - Experiment 不存在 → EXPERIMENT_NOT_FOUND
- **deleteAnalysisCascade / deleteHypothesisCascade**
  - 删分析保留其 Run，但删掉证据指向它的结论
  - 删假设连带删它的结论（同实验其他假设的结论不动）
- **invalidateAnalysis — 改口径后旧产物必须失效**
  - 清结果 + 删失效结论 + Analysis 与 Run 回退 PENDING
  - replaceConditionsAndInvalidate：先守卫 → 再替换 → 最后失效（顺序不可颠倒）
  - RUNNING 时拒绝替换条件，且**条件不被改写**（守卫在前）
  - 分析不存在 → ANALYSIS_NOT_FOUND
- **describeDeletionCounts**
  - 只列非零项；全零时给明确措辞（不假装删了什么）

### `tests/server/researchEngine/metrics.test.ts`
- 171 行 ｜ 用例声明 19 ｜ describe 2
- 被测源码：`server/researchEngine/metrics.ts` · `server/researchCore/index.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/metrics.test.ts`
- 用例树：
- **Metric Calculator**
  - MEAN / MEDIAN / STD 与手算一致
  - 分位数（线性插值，与 shared/quant-stats 同源）
  - WIN_RATE 严格大于 0（0 计为未胜）
  - 非有限值被过滤；样本不足返回 null（绝不产出 NaN / Infinity）
  - PROFIT_FACTOR 在无亏损样本时返回 null（不返回 Infinity）
  - MAX_DRAWDOWN 的口径是「事件级回撤均值」，不是净值曲线回撤
  - 缺失统计：区分「无样本」与「全缺失」
  - finiteValues 不修改入参
  - 未登记的指标码直接抛错（防止 Analysis 内偷偷自己算）
  - 所有登记指标码都能在 researchCore 指标登记表中找到（零漂移）
  - Welch 两样本 t 统计量（可手算验证）
  - 二元指标：顶底差 / 差值 / 相对差值
  - P_VALUE_DIFFERENCE 由 Welch t 经正态近似得到，且对明显差异给极小 p
  - 方向一致性：子区间与整体同号占比
  - MetricCalculator 是唯一实现：同一 code 只有一个定义对象
- **Metric Calculator — 配对指标**
  - 配对口径：两侧同时有限才成对，缺失不插补、不整对均值填补
  - PAIR_SAMPLE_COUNT = 真正进入计算的配对样本数（不是任一单侧的样本数）
  - PAIR_CORRELATION / PAIR_RANK_CORRELATION 与 shared/quant-stats 同源
  - 配对指标码同样零漂移（与 RESEARCH_METRIC_CODES 一致），未登记码直接抛错

### `tests/server/researchEngine/observationVariables.test.ts`
- 364 行 ｜ 用例声明 18 ｜ describe 6
- 被测源码：`server/researchEngine/variables.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/sampleSet.ts` · `server/researchEngine/testFixtures.ts` · `server/researchEngine/columnProjection.ts` · `server/researchEngine/analyses/registry.ts` · `server/researchEngine/analysisConfig.ts` · `server/researchCore/index.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/observationVariables.test.ts`
- 用例树：
- **观察日变量 · 命名与可见性**
  - 逐日变量的 availableFromOffset 等于它自己的 k（不是 1）
  - 累积变量的 postRelativeDays 覆盖 1..k 全部观察日
  - 事件日最低价（holds_event_low）确需基准线 ⇒ 声明 needsEventBar
  - 缩放类口径（量能比 / 收盘比）同样声明 needsEventBar
  - 缩量条件必须用比率口径：min_volume 是绝对量，min_volume_ratio 才是可比较的比率
  - 可以解析名字的两半（逐日 / 累积各有稳定键名）
- **观察日变量 · 可用上界来自真实数据**
  - post 只覆盖到 T+5 时，obs_9d.close 不可用（不是默认到 20）
  - 数据集没有任何 post 数据 ⇒ 一切观察日变量不可用，且 listObservations 为空
  - 把结果变量当观察日用会明确拒绝（角色反用，不是「未知变量」）
  - OBSERVATION_MAX_OFFSET 是声明上限；真实上界仍由目录决定
- **观察日变量 · PIT 护栏**
  - 在 T+3 判定却引用 obs_5d ⇒ 拒绝（这正是「用未来信息当条件」）
  - 引用 offset ≤ 判定日的观察日变量 ⇒ 通过，并回传用到的变量
  - 特征 / 结果 / 维度不受本护栏约束（它们各有自己的 PIT 规则）
- **观察日变量 · 列投影**
  - 声明 observationDefs 后 post 列真的被投影进来（否则静默全 null）
- **观察日变量 · 端到端装配**
  - 观察日条件能装配出真实取值，且与 post K 线逐位一致
  - 没有 post 数据的数据集上装配观察日变量 ⇒ 数值全 null（不报错、不臆造）
  - 未登记的观察日变量名在装配期就失败（不静默变 null）
- **观察日变量 · 端到端 CONDITIONAL 分析**
  - 观察日条件可作条件集，样本分流正确且与手算一致

### `tests/server/researchEngine/pit.test.ts`
- 120 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`server/researchEngine/variables.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/sampleSet.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/pit.test.ts`
- 用例树：
- **PIT 安全**
  - 命名层：结果变量不能当特征（具名拒绝，不静默 null）
  - 命名层：特征变量不能当结果（反向也拒绝）
  - 装配层：把 T+5 收益当特征申请 → VARIABLE_ROLE_VIOLATION
  - 数据层：清空全部未来数据后，特征仍可完整解析（特征不依赖 > T 数据）
  - 装配层：只加载被申请的变量（未申请的结果列不进内存）

### `tests/server/researchEngine/readRetry.test.ts`
- 128 行 ｜ 用例声明 8 ｜ describe 3
- 被测源码：`server/researchEngine/readRetry.ts` · `server/researchEngine/datasetReader.ts` · `server/datasetRegistry/query.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/readRetry.test.ts`
- 用例树：
- **瞬时错误判定**
  - 识别裸的网络错误
  - 沿 cause 链识别被包装的错误（只看外层 message 会漏判）
  - 语义错误一律不视为瞬时（不会重试）
  - 尝试次数可配置且有上限
- **有界重试**
  - 瞬时错误重试后成功，并如实报告重试次数
  - 语义错误立即抛出，不重试
  - 超过上限时抛出最后一次的真实错误（不吞错）
- **接线：Dataset 读取层确实重试**
  - 读 path 遇到瞬时重置 → 重试并成功（重试必须可见）

### `tests/server/researchEngine/reclaim.test.ts`
- 203 行 ｜ 用例声明 8 ｜ describe 1
- 被测源码：`server/researchCore/repository/inMemory.ts` · `server/researchCore/repository/contract.ts` · `server/researchCore/types.ts` · `server/researchEngine/reclaim.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/reclaim.test.ts`
- 用例树：
- **reclaimOrphanResearchWork —— 研究链孤儿回收**
  - 默认阈值：父 Run 终态缓冲 30 分钟 / RUNNING 停更 12 小时
  - ① 父 Run 已终态且过缓冲期 ⇒ 子 Analysis 收敛为 CANCELLED（Run 本身不再改写）
  - ② 父 Run 刚终态（缓冲期内）⇒ 不收敛，让位给「用户正要重跑」
  - ③ 🔴 父 Run PENDING 且从未执行 ⇒ 保留（待执行草稿），并如实回报
  - ④ 父 Run RUNNING 但未超阈值 ⇒ 不动（可能真在跑）
  - ⑤ 父 Run RUNNING 超阈值 ⇒ 收敛 Run（FAILED / RUN_ORPHANED）+ 子分析 + Experiment 回滚
  - ⑥ 幂等：连跑两次，第二次零写入
  - ⑦ 阈值全关 ⇒ 整体跳过（即使存在真孤儿也不写）

### `tests/server/researchEngine/reportGenerator.test.ts`
- 436 行 ｜ 用例声明 10 ｜ describe 2
- 被测源码：`server/researchCore/index.ts` · `server/researchEngine/datasetReader.ts` · `server/researchEngine/report/generator.ts` · `server/researchEngine/report/service.ts` · `server/researchEngine/report/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/reportGenerator.test.ts`
- 用例树：
- **buildResearchReport（纯投影）**
  - 同输入 ⇒ 同正文 ⇒ 同 checksum（不含任何时钟读数）
  - 无 Finding 时如实展示「没有发现」，不造数
  - 取不到模式与结论时，置空并记入 unresolvedTraceFields（不伪造）
- **generateResearchReport（落库与幂等）**
  - Run 未 COMPLETED ⇒ REPORT_RUN_NOT_COMPLETED，且一行都不写
  - 首次生成 → CREATED；artifactType=REPORT / storageType=INLINE；metadata 可溯源
  - 正文**原样引用** research_result 的数值（未四舍五入、未改名）
  - 同 Run 重复生成 ⇒ REUSED，artifact 行数不增加（A-2）
  - 结果变化后重生成 ⇒ SUPERSEDED，仍只有 1 份 REPORT（A-1）
  - 结论的 primaryAnalysis 不属于本 Run ⇒ conclusionId=null，不拿别的 Run 的结论冒充（A-3）
  - Dataset 版本上下文不可达 ⇒ 不编造区间/事件数，如实记入 unresolvedTraceFields

### `tests/server/researchEngine/variables.test.ts`
- 376 行 ｜ 用例声明 22 ｜ describe 3
- 被测源码：`server/datasetRegistry/types.ts` · `server/researchEngine/variables.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngine/variables.test.ts`
- 用例树：
- **变量目录**
  - 每个特征变量都写明了口径与角色（不许有名字没口径）
  - 结果变量由真实视界展开（path 1/5/10 + outcome 5/10/20）
  - 结果变量名解析：kind + horizon
  - 只按真实视界造变量（不虚构不存在的数据）
  - 未登记的变量名 → UNKNOWN_VARIABLE
  - 维度取值来自真实列（year / month / quarter / board / market）
  - ms 级极端月份不产生非法 quarter
- **分段结果变量（RESEARCH-004）**
  - 名字解析只认 segment_{stat}_{a}_{b}d，且 a ≥ 1、b > a
  - 命名唯一规则：from = 0 复用既有变量族，绝不另造第二套口径
  - 取值区间：锚点日只提供基准价（from = 0 时取值从 1 起）
  - 目录：分段变量按需构造（不进 listOutcomes），越界即 UNKNOWN_VARIABLE
  - 取值口径：锚在窗起点收盘，relativeDays 含锚点日；四种口径互不相同
  - 缺任一天 ⇒ 整个分段量为 null（不按剩余日平滑过去，口径不随缺失漂移）
  - 定义对象可独立构造，且名字与解析器互逆
- **事件日形态特征与最低价守护族**
  - 事件日形态：开盘价 = 涨停价 ⇒ 开盘即封；low < 涨停价 ⇒ 当日曾开板
  - 缺 D0 行情 ⇒ 形态特征与守护族一律 null（不臆造基准线）
  - 全程守住事件日最低价 ⇒ 1，余量 = 极值/低位 − 1 > 0
  - 两个口径会给出**不同**结论：盘中破、收盘守住
  - 缺任一天 ⇒ 整个守护量为 null（不按剩余天数平滑过去）
  - 守护族是 OUTCOME：当特征用必须被 PIT 角色校验挡住
  - 逐日量比取自 path.volumeRatio，视界跟随 path 而非 outcome
  - 命名规则与定义对象自洽（每个守护变量都声明了 needsEventBar）
