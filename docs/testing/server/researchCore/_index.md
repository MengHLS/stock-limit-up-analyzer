<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/researchCore

- 测试文件 **8** 个 ｜ 用例声明 **125** 个
- 涉及源码目录：`server/researchCore/` · `server/researchCore/repository/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/researchCore                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/researchCore/candidates.test.ts`
- 146 行 ｜ 用例声明 11 ｜ describe 1
- 被测源码：`server/researchCore/candidates.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/candidates.test.ts`
- 用例树：
- **策略候选（Research 出口）**
  - strategyDefinitionId 为 null 合法（尚未转正）
  - strategyDefinitionId 为 undefined 合法
  - 空 strategyDefinitionId 被拒绝（要么 null，要么非空）
  - 非法 experimentId 被拒绝
  - 空名称被拒绝
  - 状态机：DRAFT → REVIEW → ACCEPTED → CONVERTED
  - 状态机：非法迁移被拒绝
  - 转正一致性：CONVERTED 必须带 strategyDefinitionId
  - 转正一致性：非 CONVERTED 状态不得已绑定策略
  - filterRule 复用条件集合校验（与 Analysis 条件同构）
  - 非法 filterRule 会被拒绝（不静默通过）

### `tests/server/researchCore/candidates.updateBoundary.test.ts`
- 96 行 ｜ 用例声明 9（含 `.each` 展开） ｜ describe 1
- 被测源码：`server/researchCore/candidates.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/candidates.updateBoundary.test.ts`
- 用例树：
- **Candidate 普通 update 写入边界（RESEARCH-006.1）**
  - 硬拒字段清单 = 结构锚 + 来源快照，逐项与 006.0 §7.1 对齐
  - 状态机守卫字段清单 = status + strategyDefinitionId
  - 两个清单无交集（不存在「既硬拒又守卫」的字段）
  - 只含草图字段的 patch 通过
  - 空 patch 通过
  - 状态机守卫字段不在硬拒清单内（由状态机守卫，不由本断言拦）
  - 硬拒字段 %s 越界即抛错并点名
  - 值为 undefined 的越界键不算越界（与 TS 可选字段语义一致）
  - 多个越界键一次性全部点名

### `tests/server/researchCore/conclusions.test.ts`
- 115 行 ｜ 用例声明 10 ｜ describe 4
- 被测源码：`server/researchCore/index.ts` · `server/researchCore/conclusions.ts` · `server/researchCore/hypotheses.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/conclusions.test.ts`
- 用例树：
- **§15 结论状态机**
  - DRAFT / FINAL 可互转；SUPERSEDED 是终态
  - 每个状态的转移目标都在闭集内（防拼写漂移）
- **§15 定稿必须已引用 Finding**
  - findingIds 为空 ⇒ 拒绝定稿
  - findingIds 非空 ⇒ 允许
- **§26 结论类型 → 假设状态映射**
  - SUPPORTED / REJECTED 如实映射；PARTIALLY_SUPPORTED 与 INCONCLUSIVE **只**到 TESTED
- **§26 状态推进链**
  - DRAFT → SUPPORTED 走逐级合法链（不可跳级）
  - 同态返回单元素；终态不可再推进
  - TESTABLE → TESTED → SUPPORTED 两段可达
  - 🔴 链上每一步都必须被假设状态机认可（两套映射不许漂移）
  - assertHypothesisWriteback 复用假设状态机（非法直跳被拒）

### `tests/server/researchCore/conditions.test.ts`
- 212 行 ｜ 用例声明 15 ｜ describe 1
- 被测源码：`server/researchCore/conditions.ts` · `server/researchCore/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/conditions.test.ts`
- 用例树：
- **Research 条件（结构化，非字符串）**
  - 指令 §8 示例条件集合通过校验
  - 条件以结构化字段表达（fieldName / operator / value 分离）
  - 组内 sortOrder 保持确定性顺序
  - 扁平行 → 条件组可往返（groupConditions 逆运算）
  - 组号不连续被拒绝（不静默通过）
  - 组内 sortOrder 重复被拒绝
  - BETWEEN 需要 [下界, 上界] 且下界 ≤ 上界
  - IS_NULL / IS_NOT_NULL 不接受 value
  - IN / NOT_IN 需要非空数组
  - 非法 operator 被拒绝
  - 非法 groupLogicalOperator 被拒绝
  - 支持 OR / NOT（条件组扩展预留）
  - NOT 为组内首条时渲染为「NOT cond」
  - 「OR + 取反」通过条件组表达（组内 AND NOT + 组间 OR）
  - 渲染结果可读（用于报告引用）

### `tests/server/researchCore/executionLog.test.ts`
- 164 行 ｜ 用例声明 18 ｜ describe 4
- 被测源码：`server/researchCore/executionLog.ts` · `server/researchCore/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/executionLog.test.ts`
- 用例树：
- **assertResearchRunExecutionLog — 结构校验**
  - null / undefined → 空数组（不是未定义语义）
  - 非数组 → 抛错（不静默当空）
  - 缺 sequence / sequence 非正整数 → 抛错
  - mode / status 越界 → 抛错
  - analysisIds 非数字数组 → 抛错
  - startedAt 缺失 → 抛错（无法判断批次先后）
  - 可选字段保留，未知字段丢弃
  - 失败批次：errorCode / errorMessage 保留，sampleCount 可为 null
- **nextExecutionSequence — 批次号推进**
  - 全新 Run（无日志、无快照）→ 1
  - 🔴 版本边界：有快照但日志为空 → 2（batch 1 已被历史占用，不伪造）
  - 日志最大序号 + 1
  - 日志序号乱序时取最大值
- **appendExecutionLogEntry — 追加式**
  - 追加到末尾且**不修改入参**
  - 批次号重复 → 抛错（不静默覆盖）
  - 从空日志追加首个条目
- **settleExecutionLogEntry — 收敛批次终态**
  - 按 sequence 就地替换终态字段，不动其它条目
  - 批次号不存在 → 抛错（不静默新增）
  - settle 后长度不变（只收敛，不追加）

### `tests/server/researchCore/repository/inMemory.test.ts`
- 907 行 ｜ 用例声明 38 ｜ describe 13
- 被测源码：`server/researchCore/repository/inMemory.ts` · `server/researchCore/repository/errors.ts` · `server/researchCore/repository/contract.ts` · `server/researchCore/results.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/repository/inMemory.test.ts`
- 用例树：
- **Research Repository — Experiment CRUD**
  - create / getById / list / update / delete
  - dataset_version_id 必须存在（soft reference 的应用层保证）
  - 实验创建后知道自己基于哪个 Dataset Version，且不可改（输入边界冻结）
- **Research Repository — Hypothesis CRUD**
  - create / getById / listByExperiment / update / delete
  - 引用不存在的 Experiment 被拒绝
- **Research Repository — Run CRUD**
  - create / getById / list / nextRunNo / update / delete
  - (experimentId, runNo) 唯一 —— 重复 runNo 被拒绝
  - inputSnapshot 记录本次执行真正使用的配置
- **Research Repository — Analysis CRUD**
  - create / getById / list / update / delete
- **Research Repository — Condition CRUD**
  - replaceForAnalysis 整批写入并按组号 / 顺序读回
  - 非法条件被拒绝（不静默落库）
  - 引用不存在的 Analysis 被拒绝
- **Research Repository — Metric CRUD**
  - create / getById / listByAnalysis / update / delete
  - (analysisId, metricCode) 唯一 —— 重复定义被拒绝
- **Research Repository — Result CRUD**
  - createMany：单值 + 分组结果，结构化字段可查
  - 非法结果被拒绝（NaN 不入库）
  - 引用不存在的 Analysis 被拒绝
- **Research Repository — Conclusion CRUD**
  - create / getById / list / update / delete（可关联 Hypothesis）
  - Conclusion 不能只有一段文字：必须关联 Experiment
  - 关联不存在的 Hypothesis 被拒绝
- **Research Repository — StrategyCandidate CRUD**
  - create（strategyDefinitionId = null 合法）→ REVIEW → ACCEPTED → CONVERTED
  - 非法状态迁移被拒绝（DRAFT → CONVERTED 需经 REVIEW/ACCEPTED）
  - CONVERTED 但无 strategyDefinitionId 被拒绝
  - 引用不存在的 Conclusion 被拒绝
- **Research Repository — Artifact CRUD**
  - create（挂 Experiment）/ list / delete
  - create（挂 Run）
  - 既无 experimentId 也无 runId 被拒绝
- **Research Repository — 关系查询（指令 §18）**
  - getExperimentWithRuns
  - getRunWithAnalyses
  - getAnalysisBundle 一次取全 conditions / metrics / results
  - getExperimentConclusions / getHypothesisConclusions / getCandidatesByExperiment
- **Research Repository — 指令 §25 完整领域链路**
  - DatasetVersion → Experiment → Run → Analysis → Result / Conclusion → Candidate → Strategy(软引用)
- **Research Repository — 分析模板（RESEARCH-002C）**
  - create 写头 + 明细，明细按 sortOrder 排序并可读回
  - CONDITIONAL 模板项的条件以 JSON 快照往返（展开落库时才转关系表）
  - 名字 trim 后入库；重名 → ResearchConflictError（唯一约束兜底）
  - list：空库返回 []，非空按 name 排序（模板少，不分页）
  - delete 显式先删明细（零 FK，不依赖级联）
  - config / conditionsJson 深拷贝：外部持引用改不动内部状态

### `tests/server/researchCore/results.test.ts`
- 153 行 ｜ 用例声明 11 ｜ describe 1
- 被测源码：`server/researchCore/results.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/results.test.ts`
- 用例树：
- **Research 结果层**
  - 指标码集合覆盖指令 §9 列举的核心指标
  - 单值结果：MEAN_RETURN = 0.0283 结构化落 metricValue
  - 分组结果：Q1..Q10 每组一行，维度进 dimensionJson
  - 分组结果的 dimensionKey 不能为空
  - 序列结果：逐年 IC 每点一行
  - 拒绝 NaN / Infinity（禁止非有限数值进入结果层）
  - SCALAR 结果的 dimension 必须为 null（结构化边界）
  - GROUPED 结果必须带非空 dimension
  - sampleCount 必须非负整数
  - 非法 analysisId 被拒绝
  - metricValue 允许为 null（复杂结果走 resultJson）

### `tests/server/researchCore/types.test.ts`
- 157 行 ｜ 用例声明 13 ｜ describe 1
- 被测源码：`server/researchCore/types.ts`
- 单跑：`pnpm exec vitest run tests/server/researchCore/types.test.ts`
- 用例树：
- **Research 领域枚举（集中管理）**
  - 每类枚举无重复取值
  - 每类枚举非空
  - researchType 覆盖指令 §4 的 8 种
  - experiment status 覆盖指令 §4 的 6 态
  - hypothesis status 收敛为 RESEARCH-FINDING-001 §16 的 6 态
  - run status 覆盖指令 §6 的 5 态
  - analysis type 覆盖指令 §7 的 11 种，另加 RESEARCH-004 的 SEGMENT_RELATION
  - conclusion type 覆盖指令 §11 的 4 种
  - candidate status 覆盖指令 §12 的 6 态
  - artifact type 覆盖指令 §13 的 6 种
  - 枚举取值一律大写下划线（无小写漂移）
  - 条件运算符集合包含指令 §8 列举的比较能力
  - 逻辑连接符支持 AND / OR / NOT 与条件组（指令 §8）
