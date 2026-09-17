# STEP 6.5 IMPLEMENTATION REPORT — WFO + PBO + Overfitting Detection

> 状态：**PASS**
> 日期：2026-09-06
> 范围：`server/research/` Research Layer 稳健性与过拟合检测能力（在 STEP 6.1–6.4 之上）

---

## 1. Scope

在已完成的 STEP 6.1 Research Contract、6.2 Experiment/Registry/Run、6.2-FIX-1 CostModel Freeze、6.3 Parameter Sweep、6.4 Train/Validation/OOS 之上，新增：

- **WFO（Walk-Forward Optimization）**：多连续时间窗口 `Train → Validation → OOS`，验证样本外稳定性；
- **Parameter Stability**：参数跨窗口分布与离散度（仅作 evidence，不独立定级）；
- **PBO / CSCV**：估计「从大量候选挑选历史最优参数」的过拟合概率；
- **Overfitting Assessment**：rule-based 风险判定（low / medium / high / insufficient_data）。

仅实现 Research Layer 的 `Research → Evaluate → Report`，**不修改 Production Core**、**不 commit / push**。

## 2. Architecture

严格遵循 §二「最高优先级架构原则」：STEP 6.5 是 Research Orchestration / Analysis Layer，绝不重新实现 Strategy / Backtest / Risk / Execution / Portfolio / Performance 引擎。

```
WalkForwardWindow
      ↓
ResearchEvaluationService (STEP 6.4)
      ↓  evaluateValidation → selectValidationCandidate → freezeSelectedCandidate → evaluateOos
ResearchBacktestExecutor (STEP 6.2)
      ↓
Production Backtest Core
```

Research 层只决定「何时运行、运行哪些参数、如何划分数据、如何比较结果、如何统计」，撮合/手续费/滑点/仓位/风控全部由既有生产链路负责。

## 3. Files Changed

**新增（5 源文件 + 5 测试文件）：**

| 文件 | 职责 |
| --- | --- |
| `walkForward.ts` | WFO Contract / Window Mode / Window Definition / Window Fingerprint / WFO Config |
| `parameterStability.ts` | 参数跨窗口统计 / 分布 / 离散度 |
| `pbo.ts` | CSCV 分区 / Train-Test 组合 / 排名 / PBO 计算 |
| `overfittingAssessment.ts` | Validation→OOS degradation + Overfitting Assessment |
| `walkForwardService.ts` | WFO 窗口编排 + 结果聚合 + 序列化 |
| `walkForward.test.ts` (22) / `parameterStability.test.ts` (11) / `pbo.test.ts` (15) / `overfittingAssessment.test.ts` (14) / `walkForwardService.test.ts` (7) | 测试 |

**修改：** `index.ts`（新增 5 模块导出）。

**未改动：** 生产 `engine` / `strategy` / `risk` / `_core`、既有 6.1–6.4 契约、DB schema / migration（§三十七 不强制新增表）。

## 4. WFO Design

`WalkForwardConfig`（§四）：`mode`（rolling | expanding）、`trainSize` / `validationSize` / `oosSize` / `stepSize`（日历天数，正整数）、`datasetRange`（闭区间 `[start, end]`）、`selectionMetric`、`selectionDirection`。

**时间粒度决策（文档化）：** 本系统唯一时间概念为 `YYYY-MM-DD` 日历日期（无「交易日索引」），故窗口以**日历天**为粒度滑动，用 UTC 日期算术（`Date.UTC`）保证 deterministic、不依赖本地时区 / DST。这是与 §六/§七 示例（`1-100` 整数索引）在「时间单位」上的一次明确约定。

**Rolling：** `trainStart = datasetRange.start + windowIndex * stepSize`；Train 长度固定。
**Expanding：** `trainStart = datasetRange.start`（固定）；`trainEnd = datasetRange.start + trainSize - 1 + windowIndex * stepSize`（扩展）。
两种模式 Validation / OOS 均向前移动 `stepSize`：

```
trainEnd = trainStart + trainSize - 1
validationStart = trainEnd + 1
validationEnd = validationStart + validationSize - 1
oosStart = validationEnd + 1
oosEnd = oosStart + oosSize - 1
```

每窗口三段满足 `trainEnd < validationStart`、`validationEnd < oosStart`（闭区间严格无重叠），窗口按时间严格递增。

## 5. Window Generation

`generateWalkForwardWindows(config)`：

- **fail fast**（§八）：`trainSize/validationSize/oosSize/stepSize <= 0`、非整数、`mode` 非法、`datasetRange` 倒序、`selectionMetric` 非法、`stepSize < oosSize`（相邻 OOS 会重叠）→ 抛 `ResearchValidationError`，绝不 `return []`。
- **明确停止**：循环在 `oosEnd > datasetRange.end` 时停止（无法形成完整 OOS）；若第 0 个窗口即无法形成 → 抛 `WFO_INSUFFICIENT_DATASET`（fail fast）。
- **防御性 invariant**：生成后断言每窗口三段无重叠、相邻窗口 OOS 无重叠、时间严格递增。

**Window Fingerprint（§九）：** `windowIndex + mode + trainRange + validationRange + oosRange` → canonical JSON（对象键字典序）+ SHA-256，不依赖对象键插入顺序；相同窗口相同指纹，改任一日期不同指纹。

## 6. Validation/OOS Isolation

复用 STEP 6.4 的语义锁（`validationOnly` / `oosLocked` 恒 `true`），每个窗口独立走完整链路：

```
Window → evaluateValidation → selectValidationCandidate（只接受 Validation 结果）
      → freezeSelectedCandidate → evaluateOos（只接受 FrozenOosCandidate）
```

**窗口独立性（§十一）：** 每个窗口的 `ResearchEvaluationPlan` 独立构造，Selection 只接受该窗口 `evaluateValidation` 产出的候选结果，类型签名上不接收任何其它窗口 OOS。测试用「Window 1 OOS 极好 / Window 2 OOS 极差」及其反向构造，验证两轮 Selection 结果完全一致。

## 7. Parameter Stability

`analyzeParameterStability(parameterSets)`（§十五）：输入为每个窗口 Frozen Candidate 的 `parameters`，**只使用参数本身**（签名不接收 OOS 表现，结构上杜绝用 OOS 重挑参数）。

每个参数输出（`ParameterStabilityStat`）：`parameterName`、`parameterType`、`windowValues`（窗口序）、`uniqueValues`（类型确定排序 + 去重，null 恒最后）、`frequency`（稳定键）、`mostCommonValue/Count`、`uniqueCount`、`dispersion`；number/integer 另给 `min/max/mean/median/standardDeviation/range`；boolean 给 `trueCount/falseCount/trueRatio`。

**类型推断：** 全 boolean → `boolean`；全 number → 全整数 `integer` 否则 `number`；全 string → `enum`；全 null → `enum`；混用类型 → fail fast。

**dispersion 定义（文档化）：** number/integer = 变异系数 `std/|mean|`（mean=0 时 std=0 → 0，否则 unavailable=null）；enum/boolean = 类别离散度 `1 - mostCommonCount/total`。

**不实现 stabilityScore（§十六）：** 无法给出有明确统计依据的加权评分，故只输出参数分布，不强制生成 score。

## 8. CSCV Design

`generateCscvSplits(numPartitions)`（§十八/§十九）：

- N 必须为**偶数且 >= 4**（否则抛错，§八「禁止 N=3」）；
- 枚举 C(N, N/2) 个 Train 组合，其补集为 Test；**去对称重复**（只保留「含分区 1」的组合）恰好去重一半；
- **N=4 产生 3 个划分**（与 §十九 完全一致）：`{1,2}|{3,4}`、`{1,3}|{2,4}`、`{1,4}|{2,3}`；N=6 产生 C(6,3)/2 = 10 个。

**时间语义（§二十）：** 分区为连续时间区间，保持时间顺序，不 shuffle；候选结果标记 `partitionMetrics` 分区身份；deterministic。未修改 Production Backtest Core。

## 9. PBO Formula（明确数学定义）

**输入（§二十一）：** 复用 Sweep/Experiment 已有结果，即候选 × 分区指标矩阵 `PboCandidate.partitionMetrics[i]`（`i` 为分区序号，值为选择指标在该分区上的已评估值），**不重新执行 Backtest**。

**Train/Test 标量：** 涉及分区的指标**算术平均**（各分区等权）。候选参与某划分排名的前提是**全部分区指标均为有限数字**（null/NaN/Infinity → 非法，不得排名）。

**Train/Test ranking（§二十二/§二十四）：** 按 `selectionMetric` + `selectionDirection`（maximize 降序 / minimize 升序）排名，**同值 tie-break 用 `experimentId` 字典序**（禁止数组序 / DB 序 / random）。样本内（Train）排名第 1 者为选中候选。

**overfit 判定（§二十三，阈值显式）：** 设选中候选在 Test 上的排名为 `testRank`（1 = 最优），有效候选数 `n`，则

```
testPercentile = (testRank - 1) / (n - 1)
isOverfit      = (testPercentile >= 0.5)   // 落入 Test 表现的「最差一半」
```

**最终 PBO 计算公式：**

```
PBO = overfitObservations / validCSCVObservations
```

其中 `validCSCVObservations = evaluatedCombinations`（有效候选 >= 2 的划分数）。恒满足 **0 <= PBO <= 1**。

**数据不足（§二十六）：** 候选 < 2 或无可评估划分 → 返回 `status="insufficient_data"`、`pbo=null`；N 非法在 `generateCscvSplits` 中抛错。禁止 `catch → PBO=0`。

**PBO 定位（§十七）：** PBO 是研究统计量（估计历史最优候选在样本外不佳的概率），不是策略质量评分，绝不做 `PBO → 评分` 映射。

## 10. Overfitting Assessment

`analyzeValidationOos(windows, metric, direction)`（§十四）：**方向一致**的 degradation 公式

```
maximize: degradation = validationValue - oosMetricValue
minimize: degradation = oosMetricValue - validationValue   // degradation > 0 统一表示 OOS 劣于 Validation
relativeDegradation = degradation / |validationValue|      // validationValue = 0 → unavailable(null)
```

汇总：`evaluatedWindowCount`、`averageDegradation`、`maxRelativeDegradation`、`degradedWindowCount`。

`assessOverfitting({pbo, parameterStability, validationOosAnalysis, thresholds})`（§二十七/§二十八，rule-based）：

1. **insufficient_data（最高优先级）**：PBO 与 Validation→OOS 退化两项主证据均不可用（Stability 仅作 evidence，不足以单独定级，§二十九）；
2. **high**：`PBO >= pboHigh` 或 `maxRelativeDegradation >= degradationHigh`（明显崩溃）；
3. **medium**：`PBO >= pboMedium` 或 `maxRelativeDegradation >= degradationMedium`；
4. **low**：其余。

阈值集中在 `OverfittingThresholds`（默认：`pboHigh=0.5 / pboMedium=0.25 / degradationHigh=1.0 / degradationMedium=0.5`），非散落 magic number。Stability 只写入 `reasons[]`，不独立触发 high（§二十九）。

## 11. Strategy Version Freeze

候选 snapshot 携带 `strategyVersion`，编排走 `strategyRegistry.get(strategyId, strategyVersion)` 精确解析（复用 STEP 6.4，无 getLatest/currentVersion）。测试：`v1` 运行后 registry 增加 `v2`，重跑 WFO 所有窗口仍记录 `strategyVersion = "1.0.0"`，executor 收到定义恒为 v1。

## 12. CostModel Freeze

继承 STEP 6.2-FIX-1 / 6.4：`retargetSnapshot` 只改 dataset 日期，保留冻结 `costModel`；WFO/OOS 不重读 `DEFAULT_COST_MODEL`。测试：`DEFAULT_COST_MODEL.minCommission = 5`、候选冻结 `minCommission = 1`，executor 收到的所有（Validation + OOS）snapshot 均为 1。

## 13. Determinism

以下全部 deterministic（纯函数，不依赖 Date.now / Math.random / DB 自然序 / 对象键插入序 / 无序 Map/Set 迭代）：`generateWalkForwardWindows`、`computeWindowFingerprint`、`computeWalkForwardConfigFingerprint`、`analyzeParameterStability`、`generateCscvSplits`、`computePbo`、`analyzeValidationOos`、`assessOverfitting`。`frozenAt` / `executedAt` 仅作元数据，不参与 fingerprint。

## 14. Serialization

- `serializePboResult` / `deserializePboResult`、`serializeWalkForwardResult` / `deserializeWalkForwardResult`，均含结构校验 + `structuredClone`（mutation isolation）；
- 严格 replacer 拒绝非有限数字（NaN/Infinity 不静默转 null）；
- round-trip `serialize → deserialize → deepEqual` 与「改返回对象不影响原结果」均有测试覆盖。

## 15. Tests

| 命令 | 结果 |
| --- | --- |
| `npx vitest run server/research` | **243 passed**（新增 69：walkForward 22 + parameterStability 11 + pbo 15 + overfittingAssessment 14 + walkForwardService 7） |
| `npm run check`（tsc --noEmit） | **exit 0** |
| `npm run build`（vite build + esbuild） | **exit 0** |

覆盖 §三十八 全部要求：WFO Window（rolling/expanding/顺序/不重叠/boundary/stepSize/insufficient data/invalid config/deterministic fingerprint）；WFO Isolation（正反向 OOS 极好/极差不影响 Selection）；Strategy Freeze（v1→v2）；Cost Freeze（5 vs 1）；Parameter Stability（number/integer/enum/boolean/多窗口/单参数/变化/deterministic）；PBO（N=4/N=6/奇数拒绝/候选不足/非法指标/tie-break/确定性/明显过拟合/相对稳定/[0,1] 范围）；Assessment（low/medium/high/insufficient_data/reasons/deterministic/不修改输入/方向一致 degradation）。

## 16. Regression

| 项 | 结果 |
| --- | --- |
| Feature → Strategy | PASS |
| Future Leakage | PASS |
| Decision-time Leakage | PASS |
| Risk | PASS |
| T+1 Execution | PASS |
| Determinism | PASS |
| Legacy Simulator Boundary | PASS |
| Production → Research dependency（engine/strategy/risk 无反向 import research） | PASS（grep 确认 0 命中） |

全量 `npm test`：**765 passed / 15 failed（780）**。15 个失败**精确命中历史环境基线**（customSector=1、watchStatus=4、marketData=4、sync page=2、tushare token=1、tushare calendar=3），**新增失败 = 0**，与 STEP 6.3/6.4 基线一致，未把历史环境问题计入 6.5 regression。

## 17. Findings

- **WFO 与 PBO 边界清晰分离（§三十）**：WFO 关注时间滚动样本外稳定性，PBO 关注大量候选下的 selection bias。`WalkForwardResult` 分别暴露 `windows/aggregateMetrics`、`parameterStability`、`validationOosAnalysis`、`pbo`、`overfittingAssessment`，而非合并成单一 `Overfitting Score`。
- **明显过拟合合成数据 → PBO=1.0**、**稳定单调占优 → PBO=0.0**，两端边界行为符合预期。
- rolling WFO 在 `stepSize = oosSize` 时，窗口 N 的 OOS 区间与窗口 N+1 的 Validation 区间重合（这是 rolling 的固有性质，非泄漏：Selection 仍只消费本窗口 Validation）。

## 18. P0 / P1 / P2 / P3

- **P0 = 0**、**P1 = 0**、**P2 = 0**。
- **P3（文档化设计决策，非缺陷）**：
  1. WFO 时间粒度用**日历天**（系统无交易日索引）；
  2. PBO 的 Train/Test 聚合用**算术平均**（各分区等权）；
  3. 缺省 `parameterSpaceFingerprint` 由候选参数集派生（与 sweep 的 `parameterSpaceFingerprint` 语义不同，可显式传入对齐）；
  4. 未新增 DB 表（§三十七 优先不扩 Scope），结果可完整 JSON 序列化。

## 19. Scope Control

未实现（§四十 Scope 禁止项，全部严格遵守）：新 Strategy ✗ / 新 Factor ✗ / 新 Feature ✗ / 新 Backtest/Risk/Execution Engine ✗ / Portfolio Optimization ✗ / ML Training ✗ / Bayesian/GA ✗ / 自动参数优化 ✗ / 自动策略淘汰 ✗ / Paper/Live Trading ✗ / Auto Deploy ✗ / Production WFO/PBO API ✗ / 根据 PBO 自动改参数 ✗。

## 20. Final Status

- **STEP 6.5 = COMPLETE（PASS）**
- **STEP 7 = READY**
- P0 = 0 / P1 = 0 / P2 = 0

---

**STEP 6.5 STATUS: PASS**

**NEXT: STEP 7**
