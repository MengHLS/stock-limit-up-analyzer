/**
 * STEP 19 / C-19.1 — Walk-Forward Optimization（WFO）：滚动窗口划分 + 冻结纪律 + 逐窗编排。
 *
 * 本模块是类型契约的权威源。职责边界（ROADMAP §21「STEP 19 — Walk-Forward / OOS」）：
 *
 *   Train → Optimize → Freeze → Test → Move Window
 *
 * 1. **窗口划分（windows.ts）**：基于交易日序列生成 Train / Test（OOS）成对窗口；支持
 *    rolling（滑动）与 anchored（扩张）两种模式、可配 trainWindow / testWindow / step、
 *    可选 gap（train 末与 test 首之间的空档交易日）与 embargo（train 尾部被禁用的交易日，
 *    防标签重叠泄漏：A 股 T+1 与持有期场景下，train 末尾若干交易日的标签会延伸到 test 段）。
 *    **Test 段必须严格位于 Train 段之后且无重叠**——由窗口几何 + assertWalkForwardSplitInvariants
 *    双重保证（不是注释承诺，是运行时断言）。
 * 2. **冻结纪律（freeze.ts）**：Optimize 阶段产出的参数在 Test 之前冻结：
 *      - 结构解耦：optimize 上下文（WalkForwardOptimizeContext）**不含任何 test 交易日**，
 *        test 评估器工厂（WalkForwardTestContext）**不含任何 search 结果**；
 *      - Test 阶段以「冻结参数的深冻结副本」为唯一入参调用（deepFreezeParameterSet +
 *        Object.isFrozen 实测记档），test 阶段无法再访问 optimizer 结果以外的信息；
 *      - verifyWalkForwardFreezeDiscipline / assertWalkForwardFreezeDiscipline 对整条 Run
 *        做机器检查：每窗 test 阶段实际使用参数集键 === 冻结参数集键，且传入对象已深冻结。
 * 3. **编排（run.ts）**：逐窗 train 搜索（复用 C-17.1 runParameterSearch，import 只读）
 *    → 冻结 → test 评估（evaluator 注入，本模块不跑真实回测）→ 推进下一窗；
 *    产出 WalkForwardRun 完整记录（窗口划分配置、每窗 train/test 区间与参数、冻结证据、
 *    OOS 分段最小聚合、sha256 指纹、createdAt 注入）。
 *
 * ## 与相邻任务的边界（诚实划分）
 *   - **C-17.2（rollingOptimization）**：只做「按时间窗滚动、逐窗全量参数搜索 + 描述性跨窗
 *     一致」，无 Train/Test 三段、无冻结、无 OOS 评测。本模块复用其 `rollingParameterSetKey`
 *     （参数集 canonical 键，import 只读），窗口生成逻辑**不复用也不可复用**——C-17.2 只有
 *     单段 windowLength/stepLength，没有 Train/Test 成对语义与 gap/embargo；两者的窗口几何
 *     由单测 `与 C-17.2 窗口函数对照` 显式锁定差异（见测试文件）。
 *   - **C-17.1（parameterSearch）**：窗内优化直接调用 runParameterSearch（grid / random），
 *     稳定区判定 analyzeCandidateRegion 的「合格区、非 argmax、拒绝高收益坏点」语义原样继承；
 *     冻结参数从合格区成员中按**下中位数**（lower median）选取，显式非 argmax。
 *   - **STEP 6.5 walkForward.ts / walkForwardService.ts**：生产 WFO 服务形态（日历天、异步
 *     EvaluationService、候选淘汰赛）。本模块**仅参考其哲学，不 import**（研究链路交易日锚定、
 *     纯函数、同步、evaluator 注入）。命名上本模块全部符号带 `WalkForward*` / `WFO19_*`
 *     域前缀并已完成全库查重，与 STEP 6.5 的 `WalkForwardConfig` / `WalkForwardWindow` /
 *     `WalkForwardService` / `WFO_*` 错误码不冲突（错误码前缀取 WFO19_ 明确区分）。
 *   - **C-19.2（留给后续）**：样本内/外隔离记录的**持久化存储**（window id / train / test /
 *     params / result / metrics 的归档表）与 **OOS 结果聚合报告**（分段 OOS 曲线拼接、退化
 *     归因、报告导出）。本模块只产出内存态 WalkForwardRun 记录与**编排自描述所需的最小
 *     OOS 聚合**（WalkForwardAggregate：计数 + 均值/中位数/极值 + IS-OOS 对照），不建表、
 *     不归档、不出报告。
 *
 * ## 铁律
 *   - PIT 安全：窗口只看 T 及之前数据；OOS 段严禁参与优化/参数选择（结构解耦 + 断言）。
 *   - 确定性：纯函数、readonly 入参、无 Date.now() / Math.random() / IO；runId / createdAt
 *     由调用方注入（缺省才取运行实例值）；日期处理用字符串 / 索引（无 Date 对象）。
 *   - 指纹防篡改：canonicalStringify（server/researchDataset/version.ts）+ sha256 +
 *     serialize / deserialize / validate round-trip。
 *   - FAIL FAST：窗口不足 / 参数非法 / 日期乱序 / 窗口重叠 → 响亮抛错（稳定 error code）。
 *   - 诚实结论：**不做 promotion**（不把候选升为 Final / Production，本模块不产候选策略记录，
 *     不含任何 lifecycle / promotion 代码）；窗不可评估时显式记录 skipped + reasonCode。
 */

import type { ParameterSpace } from "../parameterSpace";
import type { ResearchParameterSet } from "../types";
import type {
  ParameterSearchMethod,
  ParameterSearchRun,
  ParameterSearchSampleOutcome,
  RegionAnalysisConfig,
  ResolvedRegionAnalysisConfig,
} from "../parameterSearch";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** WalkForwardRun 记录种类标签（供序列化 / 反序列化判别）。 */
export const WALK_FORWARD_RUN_RECORD_KIND = "WALK_FORWARD_RUN" as const;

/** WalkForwardRun schema 版本：字段语义变更必须递增。 */
export const WALK_FORWARD_RUN_RECORD_VERSION = 1 as const;

/** WalkForwardRun ID 前缀（`WFA-YYYYMMDD-XXXXXXXX`，风格对齐 SEARCH-* / ROLLING-*）。 */
export const WALK_FORWARD_RUN_ID_PREFIX = "WFA" as const;

// ---------------------------------------------------------------------------
// 窗口划分配置
// ---------------------------------------------------------------------------

/**
 * 窗口模式：
 *   - `rolling`：Train 段长度固定为 trainWindow，起点按 step 逐窗推进（常规 WFO）；
 *   - `anchored`：Train 段起点恒为序列首日、长度随窗扩张（expanding window，样本累积）。
 */
export type WalkForwardSplitMode = "rolling" | "anchored";

/**
 * WFO 窗口划分配置（单位全部是**交易日个数**，锚定数据集实际交易日序列）。
 *
 * 窗口几何（rolling，索引基于 tradeDates）：
 *   trainStart_i      = i * step
 *   trainEnd_i        = trainStart_i + trainWindow            （不含）
 *   testStart_i       = trainEnd_i + gap
 *   testEnd_i         = testStart_i + testWindow              （不含）
 *   完整窗口条件：testEnd_i <= tradeDates.length
 *
 * 窗口几何（anchored）：trainStart_i 恒为 0，trainEnd_i = i * step + trainWindow（Train
 * 段随窗扩张），test 段同上；完整窗口条件相同。
 *
 * embargo（防标签重叠泄漏）：Train 段**尾部** `embargo` 个交易日不参与优化（optimizationDates
 *  = trainDates 去掉尾部 embargo 个），但仍在 trainDates 内记档。理由：A 股 T+1 与持有期
 * 场景下，train 末尾若干交易日的收益标签会跨到 test 段，参与优化即构成泄漏。
 *
 * gap（空档）：train 段末与 test 段首之间跳过的交易日数，进一步拉开标签边界。
 *
 * 约束：trainWindow - embargo >= 1（优化段至少一个交易日）；testWindow >= 1；step >= 1；
 * gap >= 0；embargo >= 0；maxWindows 为 null 或 >= 1。
 */
export interface WalkForwardSplitConfig {
  /** 窗口模式（缺省 "rolling"）。 */
  readonly mode?: WalkForwardSplitMode;
  /** Train 段交易日个数（>= 1，必填，无缺省值）。 */
  readonly trainWindow: number;
  /** Test（OOS）段交易日个数（>= 1，必填，无缺省值）。 */
  readonly testWindow: number;
  /** 相邻窗起点推进的交易日个数（>= 1，必填，无缺省值）。 */
  readonly step: number;
  /** Train 末与 Test 首之间跳过的交易日数（>= 0，缺省 0）。 */
  readonly gap?: number;
  /** Train 段尾部被禁用（不参与优化）的交易日数（>= 0，缺省 0）。 */
  readonly embargo?: number;
  /** 窗口数上限（null / 缺省 = 不限）；仅限制记录体积与计算量，不改变窗口语义。 */
  readonly maxWindows?: number | null;
}

/** 解析后的窗口划分配置（全字段自描述，记录在 WalkForwardRun 内）。 */
export interface ResolvedWalkForwardSplitConfig {
  readonly mode: WalkForwardSplitMode;
  readonly trainWindow: number;
  readonly testWindow: number;
  readonly step: number;
  readonly gap: number;
  readonly embargo: number;
  readonly maxWindows: number | null;
}

// ---------------------------------------------------------------------------
// 生成的窗口（Train / Test 成对；纯几何，不含搜索内容）
// ---------------------------------------------------------------------------

/** 一个 WFO 窗口的 Train / Test 划分（交易日锚定，deterministic）。 */
export interface WalkForwardSplit {
  /** 窗口序号（从 0 起，按时间递增）。 */
  readonly windowIndex: number;
  readonly mode: WalkForwardSplitMode;
  /** Train 段在 tradeDates 中的起始下标（anchored 恒为 0）。 */
  readonly trainStartIndex: number;
  /** Train 段完整交易日（含被 embargo 剔除的尾部）。 */
  readonly trainDates: readonly string[];
  /** 实际参与优化的 Train 交易日（= trainDates 去掉尾部 embargo 个）。 */
  readonly optimizationDates: readonly string[];
  /** 被 embargo 剔除的 Train 尾部交易日（不参与优化，仅记档）。 */
  readonly embargoDates: readonly string[];
  /** Train 末与 Test 首之间跳过的交易日（gap 段，两段都不属于）。 */
  readonly gapDates: readonly string[];
  /** Test（OOS）段交易日。 */
  readonly testDates: readonly string[];
  readonly firstTrainDate: string;
  readonly lastTrainDate: string;
  readonly firstTestDate: string;
  readonly lastTestDate: string;
  readonly trainDayCount: number;
  readonly optimizationDayCount: number;
  readonly embargoDayCount: number;
  readonly gapDayCount: number;
  readonly testDayCount: number;
  /** 该窗在 tradeDates 上覆盖的总跨度（含 gap）。 */
  readonly spanDayCount: number;
}

// ---------------------------------------------------------------------------
// 注入式评估契约（Optimize 阶段 / Test 阶段）
// ---------------------------------------------------------------------------

/**
 * Optimize（Train）阶段上下文：交给调用方构造窗内参数评估器。
 *
 * **结构解耦要点**：本上下文**不包含任何 test 交易日 / test 区间信息**——窗内优化在类型
 * 层面就无法看到 OOS 数据。single test 的存在由单测断言（`Object.keys(ctx)` 不含 test
 * 相关键）实证锁定，而非注释承诺。
 */
export interface WalkForwardOptimizeContext {
  /** 窗口 ID（`${runId}-w${windowIndex}`）。 */
  readonly windowId: string;
  readonly windowIndex: number;
  readonly mode: WalkForwardSplitMode;
  /** 实际参与优化的 Train 交易日（已扣除 embargo 尾部）。 */
  readonly optimizationDates: readonly string[];
  readonly firstTrainDate: string;
  readonly lastTrainDate: string;
  readonly trainDayCount: number;
  readonly optimizationDayCount: number;
  /** 被 embargo 剔除的尾部交易日（不参与优化）。 */
  readonly embargoDates: readonly string[];
  readonly embargoDayCount: number;
}

/**
 * Optimize 阶段评估器工厂：window 上下文 → C-17.1 参数评估器。
 * 工厂必须是纯函数（无 IO / 无 Date.now / 无 Math.random）；真实回测由调用方在工厂内部
 * 按 optimizationDates 切片窗内数据后注入。
 */
export type WalkForwardOptimizeEvaluatorFactory = (
  context: WalkForwardOptimizeContext,
) => (parameterSet: ResearchParameterSet) => ParameterSearchSampleOutcome;

/**
 * Test（OOS）阶段上下文：交给调用方构造 OOS 评估器。
 *
 * **结构解耦要点**：本上下文**不包含 searchRun / 候选 / 参数空间**——test 阶段在类型层面
 * 就无法访问 optimizer 结果；唯一能拿到的是「被冻结的参数集」本身（作为评估器入参传入）。
 */
export interface WalkForwardTestContext {
  readonly windowId: string;
  readonly windowIndex: number;
  readonly mode: WalkForwardSplitMode;
  /** Test（OOS）段交易日。 */
  readonly testDates: readonly string[];
  readonly firstTestDate: string;
  readonly lastTestDate: string;
  readonly testDayCount: number;
  /** Train 段末交易日（PIT 边界提示：test 严格晚于该日）。 */
  readonly lastTrainDate: string;
}

/** Test 阶段评估器：入参恒为「冻结参数集」的深冻结副本。 */
export type WalkForwardTestEvaluator = (
  parameterSet: ResearchParameterSet,
) => ParameterSearchSampleOutcome;

/** Test 阶段评估器工厂（纯函数）。 */
export type WalkForwardTestEvaluatorFactory = (
  context: WalkForwardTestContext,
) => WalkForwardTestEvaluator;

// ---------------------------------------------------------------------------
// 冻结参数（Freeze 阶段产物）
// ---------------------------------------------------------------------------

/** 冻结参数的选择口径（记录用；当前唯一实现 = 合格区下中位数，显式非 argmax）。 */
export type WalkForwardFreezeSelection = "median-qualified";

/** 默认冻结选择口径：合格区**下中位数**（区域中心，拒绝历史收益最高的极值点）。 */
export const DEFAULT_WALK_FORWARD_FREEZE_SELECTION: WalkForwardFreezeSelection = "median-qualified";

/**
 * 被冻结的参数集（Optimize 阶段结束、Test 阶段开始之前锁定）。
 *
 * 冻结纪律：
 *   - `parameterSet` 是 Train 段稳定区选出的参数，Test 阶段**只读**；
 *   - `parameterSetKey` 是 canonical 键（复用 C-17.2 rollingParameterSetKey），供 test 阶段
 *     记录与事后机器比对；
 *   - Test 阶段实际拿到的是 `deepFreezeParameterSet` 产出的深冻结副本（不可写），且
 *     `testStage.parameterSetFrozen` 实测 Object.isFrozen 记档。
 */
export interface WalkForwardFrozenParameters {
  /** 参数集 canonical 键（键排序 + JSON；与 test 阶段记录比对用）。 */
  readonly parameterSetKey: string;
  readonly parameterSet: ResearchParameterSet;
  /** 选择口径（当前恒为 median-qualified，显式非 argmax）。 */
  readonly selection: WalkForwardFreezeSelection;
  /** 该参数在 Train 段的评估绩效（IS 对照，来自 searchRun 中被选中的样本）。 */
  readonly trainTotalReturnPct: number | null;
  readonly trainMaxDrawdownPct: number | null;
  readonly trainTradeCount: number | null;
  /** Train 段稳定区结论（诚实记档：degraded 区域也会冻结，但结论可见）。 */
  readonly regionVerdict: string;
  /** Train 段稳定区合格成员数（选择池大小）。 */
  readonly qualifiedMemberCount: number;
  /** 选中成员在合格区 members 中的下标（溯源）。 */
  readonly memberIndex: number;
  /** 冻结来源 SearchRun ID（溯源）。 */
  readonly sourceSearchRunId: string;
  /** 冻结时刻（ISO-8601 UTC；由 run 注入 createdAt，非独立时钟）。 */
  readonly frozenAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 逐窗记录
// ---------------------------------------------------------------------------

/** 窗不可评估的原因码（显式记录，绝不静默跳过）。 */
export type WalkForwardSkipReasonCode =
  /** Train 段稳定区无合格样本（无参数可冻结）。 */
  | "WFO19_NO_QUALIFIED_PARAMETERS"
  /** Test 段为空（几何异常，防御性）。 */
  | "WFO19_TEST_WINDOW_EMPTY"
  /** Test 评估器抛错。 */
  | "WFO19_TEST_EVALUATOR_THREW"
  /** Test 评估器返回 failed。 */
  | "WFO19_TEST_EVALUATION_FAILED"
  /** Test 评估产物非法（NaN / 负回撤等）。 */
  | "WFO19_TEST_METRICS_INVALID";

/** 全部跳过原因码（供校验 / 文档化）。 */
export const WALK_FORWARD_SKIP_REASON_CODES: readonly WalkForwardSkipReasonCode[] = [
  "WFO19_NO_QUALIFIED_PARAMETERS",
  "WFO19_TEST_WINDOW_EMPTY",
  "WFO19_TEST_EVALUATOR_THREW",
  "WFO19_TEST_EVALUATION_FAILED",
  "WFO19_TEST_METRICS_INVALID",
];

/** Train（Optimize）阶段记录。 */
export interface WalkForwardTrainStage {
  readonly windowId: string;
  readonly windowIndex: number;
  readonly mode: WalkForwardSplitMode;
  readonly trainStartIndex: number;
  readonly firstTrainDate: string;
  readonly lastTrainDate: string;
  readonly trainDayCount: number;
  readonly optimizationDayCount: number;
  readonly embargoDayCount: number;
  readonly firstOptimizationDate: string;
  readonly lastOptimizationDate: string;
  /** 该窗完整 C-17.1 SearchRun（含 evaluatedSamples / 稳定区结论 / 窗内候选，可审计）。 */
  readonly searchRun: ParameterSearchRun;
}

/** Test（OOS）阶段记录。 */
export interface WalkForwardTestStage {
  readonly windowId: string;
  readonly windowIndex: number;
  readonly firstTestDate: string;
  readonly lastTestDate: string;
  readonly testDayCount: number;
  /** 阶段状态：succeeded（有 OOS 绩效）/ skipped（未评估，见 skipReasonCode）。 */
  readonly status: "succeeded" | "skipped";
  /** Test 阶段实际使用的参数集（= 冻结参数的深冻结副本，逐字段记档）。 */
  readonly parameterSet: ResearchParameterSet | null;
  /** Test 阶段实际使用参数集的 canonical 键（与 frozen.parameterSetKey 比对用）。 */
  readonly parameterSetKey: string | null;
  /** 传入 test 评估器的对象是否深冻结（Object.isFrozen 实测；false = 冻结纪律被破坏）。 */
  readonly parameterSetFrozen: boolean | null;
  readonly totalReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  readonly error: string | null;
  readonly skipReasonCode: WalkForwardSkipReasonCode | null;
}

/** 单个 WFO 窗口的完整记录（Train + Freeze + Test 三阶段）。 */
export interface WalkForwardWindowRecord {
  readonly windowId: string;
  readonly windowIndex: number;
  readonly mode: WalkForwardSplitMode;
  /** Train / Optimize 阶段。 */
  readonly train: WalkForwardTrainStage;
  /** Freeze 阶段产物（无合格参数时为 null，test 相应 skipped）。 */
  readonly frozen: WalkForwardFrozenParameters | null;
  /** Test / OOS 阶段。 */
  readonly test: WalkForwardTestStage;
}

// ---------------------------------------------------------------------------
// 冻结纪律审计
// ---------------------------------------------------------------------------

/**
 * 冻结纪律机器检查结果（对整条 Run）。
 *
 * 检查项（任一失败 → violations 非空、passed=false）：
 *   - 每个 succeeded 的 test 阶段：parameterSetKey === frozen.parameterSetKey；
 *   - 每个 succeeded 的 test 阶段：parameterSetFrozen === true（传入对象已深冻结）；
 *   - 每个 succeeded 的 test 阶段：test 首交易日严格晚于 train 末交易日（PIT 边界）；
 *   - 每个 succeeded 的 test 阶段：冻结参数集与 test 记录参数集逐字段相等。
 */
export interface WalkForwardFreezeAudit {
  readonly windowCount: number;
  readonly frozenWindowCount: number;
  readonly testedWindowCount: number;
  readonly allTestStageKeysMatchFrozen: boolean;
  readonly allTestStageParametersFrozen: boolean;
  readonly allTestWindowsAfterTrain: boolean;
  readonly violations: readonly string[];
  readonly passed: boolean;
}

// ---------------------------------------------------------------------------
// OOS 分段聚合（编排自描述最小集；完整 OOS 聚合报告属 C-19.2）
// ---------------------------------------------------------------------------

/**
 * OOS 分段绩效聚合（**最小集**）。
 *
 * 范围纪律：本结构只服务于「一次 WFO 编排自身的自描述」（每窗结果如何汇总），不做
 * OOS 曲线拼接、不做退化归因、不做结论判定（那是 C-20 过拟合检测的职责），也不落库
 * 归档（C-19.2）。`oosDegradationPp` 只是 IS/OOS 均值差的如实呈现，**不是通过/失败判定**。
 */
export interface WalkForwardAggregate {
  /** 计划窗口数（= splits.length）。 */
  readonly plannedWindowCount: number;
  /** 完成 Train 优化的窗口数。 */
  readonly optimizedWindowCount: number;
  /** 成功冻结参数的窗口数。 */
  readonly frozenWindowCount: number;
  /** 产生 OOS 绩效的窗口数（test.status === "succeeded"）。 */
  readonly testedWindowCount: number;
  /** 被跳过（未评估）的窗口数。 */
  readonly skippedWindowCount: number;
  /** 样本内（Train）绩效均值（%，冻结参数在其 train 段的样本绩效）。 */
  readonly meanTrainTotalReturnPct: number | null;
  readonly meanTrainMaxDrawdownPct: number | null;
  /** 样本外（OOS）绩效聚合（%）。 */
  readonly meanTestTotalReturnPct: number | null;
  readonly medianTestTotalReturnPct: number | null;
  readonly minTestTotalReturnPct: number | null;
  readonly maxTestTotalReturnPct: number | null;
  readonly meanTestMaxDrawdownPct: number | null;
  readonly maxTestMaxDrawdownPct: number | null;
  /** 分段 OOS 累计收益（%，各窗 OOS 收益连乘 − 1；无 OOS 窗 → null）。 */
  readonly cumulatedTestReturnPct: number | null;
  /** IS→OOS 均值退化（百分点，meanTest − meanTrain；负 = OOS 更差；无对照 → null）。 */
  readonly oosDegradationPp: number | null;
}

// ---------------------------------------------------------------------------
// WalkForwardRun（一次 WFO 的完整记录）
// ---------------------------------------------------------------------------

/**
 * 一次 Walk-Forward Optimization 的完整记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 内容：
 *   - 运行身份：runId / strategyId@strategyVersion / method / seed / budget / createdAt；
 *   - 输入快照：tradeDates + 指纹、parameterSpace + 指纹、splitConfig、analysisConfig；
 *   - 逐窗结果：windows[]（Train 完整 C-17.1 SearchRun + 冻结参数 + OOS 绩效 / skip 原因）；
 *   - 冻结纪律：freezeIntegrity（机器检查结果，violations 为空才成立）；
 *   - OOS 聚合：aggregate（最小集，完整报告属 C-19.2）；
 *   - 元数据：createdAt（注入）+ fingerprint。
 *
 * **无 promotion**：本记录不含候选策略 / 生命周期状态 / Final|Production 标记——WFO 结果
 * 止于「每窗样本外绩效」这一事实，任何升级由 C-21.1 生命周期在人类决策后执行。
 */
export interface WalkForwardRun {
  readonly recordKind: typeof WALK_FORWARD_RUN_RECORD_KIND;
  readonly recordVersion: typeof WALK_FORWARD_RUN_RECORD_VERSION;
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 窗内优化方法（全 run 一致；复用 C-17.1 口径）。 */
  readonly method: ParameterSearchMethod;
  /** random：基准 seed（整数；逐窗派生 seed = seed + windowIndex）；grid：null。 */
  readonly seed: number | null;
  /** 请求预算（random = 每窗采样预算；grid = 每窗全组合基数）。 */
  readonly requestedBudget: number;
  /** 参数空间（冻结快照；逐窗搜索共用）。 */
  readonly parameterSpace: ParameterSpace;
  /** 参数空间 canonical fingerprint（桥接 sweep.computeParameterSpaceFingerprint）。 */
  readonly parameterSpaceFingerprint: string;
  /** 交易日历（升序、无重复；窗口锚定于此）。 */
  readonly tradeDates: readonly string[];
  /** 交易日历内容指纹（sha256，canonical）。 */
  readonly tradeDatesFingerprint: string;
  /** 窗口划分配置（解析后）。 */
  readonly splitConfig: ResolvedWalkForwardSplitConfig;
  /** 逐窗稳定区判定口径（解析后，全窗一致）。 */
  readonly analysisConfig: ResolvedRegionAnalysisConfig;
  /** 冻结参数选择口径。 */
  readonly freezeSelection: WalkForwardFreezeSelection;
  /** 计划窗口数。 */
  readonly windowCount: number;
  /** 逐窗结果（windowIndex 升序）。 */
  readonly windows: readonly WalkForwardWindowRecord[];
  /** 冻结纪律机器检查。 */
  readonly freezeIntegrity: WalkForwardFreezeAudit;
  /** OOS 分段聚合（最小集）。 */
  readonly aggregate: WalkForwardAggregate;
  /** 运行记录创建时间（ISO-8601 UTC；由调用方/入口注入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/** 一次 Walk-Forward Optimization 请求。 */
export interface WalkForwardRequest {
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 窗内优化方法（全 run 一致）。 */
  readonly method: ParameterSearchMethod;
  /** 参数空间（冻结使用，不修改入参；逐窗共用）。 */
  readonly parameterSpace: ParameterSpace;
  /** 数据集交易日序列（升序、无重复、YYYY-MM-DD；窗口锚定于此）。 */
  readonly tradeDates: readonly string[];
  /** Train / Optimize 阶段评估器工厂（纯函数；上下文不含 test 数据）。 */
  readonly optimizeEvaluatorFactory: WalkForwardOptimizeEvaluatorFactory;
  /** Test / OOS 阶段评估器工厂（纯函数；上下文不含 search 结果）。 */
  readonly testEvaluatorFactory: WalkForwardTestEvaluatorFactory;
  /** 窗口划分配置（trainWindow / testWindow / step 必填；gap / embargo 可选）。 */
  readonly splitConfig: WalkForwardSplitConfig;
  /** 稳定区判定口径（缺省 = C-17.1 DEFAULT_REGION_ANALYSIS_CONFIG，逐窗一致）。 */
  readonly analysis?: RegionAnalysisConfig;
  /** 冻结参数选择口径（缺省 median-qualified）。 */
  readonly freezeSelection?: WalkForwardFreezeSelection;
  /** random：基准 seed（整数；逐窗 seed = seed + windowIndex）；grid：忽略。 */
  readonly seed?: number;
  /** random：每窗采样预算（>= 1）；grid：忽略。 */
  readonly budget?: number;
  /** grid：全组合上限（>= 1）；random：忽略。 */
  readonly maxCombinations?: number;
  /** runId（缺省自动生成 WFA-YYYYMMDD-XXXXXXXX；注入则确定性）。 */
  readonly runId?: string;
  /** 创建时间（ISO-8601 UTC；缺省当前时间；元数据非复现输入）。 */
  readonly createdAt?: string;
}
