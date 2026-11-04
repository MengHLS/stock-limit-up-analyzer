/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **通用实验模板**（唯一入口）。
 *
 * 新增一个组合因子实验 = **一次调用**：
 *
 * ```ts
 * export const myCompositeExperiment = defineCompositeFactorExperiment({
 *   id: "first-board-pullback/my-composite-study",
 *   name: "我的组合因子研究",
 *   description: "……",
 *   members: [ { code: "turnover", direction: "LOW" }, … ],
 *   normalization: "BUCKET_POSITIONAL",
 *   weighting: { mode: "EQUAL" },
 * });
 * ```
 *
 * 之后只需要 `manifest.ts` + `client/src/researchExperiments/pages.ts` 各加一行
 * （仓库约定：无目录扫描、无 codegen）。**不需要**写任何交易 / 结果 / PIT / Benchmark 代码
 * —— 那些都在 `shared/singleFactor/**`（SINGLE_FACTOR_EXPERIMENT_V1）里，
 * 本模板只是**多了一个合成键**。
 *
 * ## 这个文件里有什么
 *
 * 只有「装配顺序」和「样本构造」两件事：
 *
 * ```
 * derive.ts（冻结入池池 + 12 因子原始值）
 *   → 合成分（scoring.ts）
 *   → PIT 日期 + 统一入场退出（singleFactor: pitAccess / entryExit）
 *   → 逐笔对拍（价格 / 净收益 与公共底座逐位一致，否则 Run 失败）
 *   → 评估（analyse.ts → singleFactor: ranker / positionCost / benchmark / metrics）
 *   → 装配（assemble.ts）
 * ```
 */

import type {
  ExperimentDefinition,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  DECISION_OFFSET_DAYS,
  POST_RELATIVE_DAYS,
  PREFIX_RELATIVE_DAYS,
  deriveTwelveFactorSamples,
} from "../../first-board-pullback/twelve-factor-composite-study/derive";
import { analyseComposite } from "./analyse";
import {
  COMPUTATION_VERSION,
  assembleCompositeFactorResult,
  compositeFactorSchema,
} from "./assemble";
import {
  assertTemplateCoordinate,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
} from "../singleFactor/coordinate";
import {
  assertEntryExitAgreement,
  holdingDaysOf,
  resolveEntryExit,
  resolveSignalDate,
} from "../singleFactor/entryExit";
import { assertPitDatesResolved, loadPitAccess } from "../singleFactor/pitAccess";
import { roundTripCostRatio } from "../singleFactor/positionCost";
import type { SingleFactorSample } from "../singleFactor/types";
import {
  OBSERVATION_RELATIVE_DAYS,
  PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
} from "../singleFactor/types";
import {
  assertMemberDirections,
  assertMembersUsable,
  compositionBucketFingerprint,
  resolveCompositeMember,
} from "./members";
import {
  buildScoringPlan,
  scoreSamples,
  summarizeCompositeScores,
} from "./scoring";
import {
  COMPOSITE_FACTOR_EXPERIMENT_TYPE,
  COMPOSITE_FACTOR_TEMPLATE_ID,
  COMPOSITE_TOP_N_SIZES,
  DAY_SCOPES,
  DEFAULT_NORMALIZATION_METHOD,
  DEFAULT_WEIGHTING,
  NORMALIZATION_LABELS,
  defineCompositeTemplateSpec,
  type CompositeDayScope,
  type CompositeMemberSpec,
  type CompositeTopNSize,
  type NormalizationMethod,
  type WeightingSpec,
} from "./types";

/** 组合模板的 Dataset 声明（与 12F 实验逐字一致 —— 同一份入池池就要求同一份声明）。 */
const COMPOSITE_DATASET_REQUIREMENT = {
  datasetCode: "first_limit_pullback",
  requiredColumns: {
    events: [
      "isFirstLimit",
      "boardType",
      "market",
      "previousClose",
      "limitUpPrice",
      "turnover",
      "historicalLimitCount",
      "daysSincePreviousLimit",
    ],
    feature: ["open", "high", "low", "close", "volume", "amount"],
    observation: [
      "open",
      "high",
      "low",
      "close",
      "volume",
      "limitUpPrice",
      "barPresent",
      "suspensionStatus",
      "canBuyAtOpen",
      "canSellAtClose",
    ],
  },
  prefixRelativeDays: [...PREFIX_RELATIVE_DAYS],
  postRelativeDays: POST_RELATIVE_DAYS,
  decisionOffsetDays: DECISION_OFFSET_DAYS,
  usesForwardData: true,
  forwardDataPurpose:
    `在 T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY} 收盘确定合成分并按当日前 N 名建仓，` +
    `于 T+${ENTRY_DAY} 开盘等权买入、T+${EXIT_RELATIVE_DAY} 收盘卖出，` +
    `研究「多个因子合成的排序键」能否在首板候选池里挑出前几名。`,
  eventScanPolicy: "FULL_DATASET" as const,
};

export interface CompositeFactorExperimentConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly pageTitle: string;
  readonly members: readonly CompositeMemberSpec[];
  readonly normalization?: NormalizationMethod;
  readonly weighting?: WeightingSpec;
  readonly topNSizes?: readonly CompositeTopNSize[];
  readonly dayScopes?: readonly CompositeDayScope[];
  readonly version?: string;
}

/**
 * 定义（并返回）一个组合因子实验。
 *
 * 返回值是**普通** `ExperimentDefinition`：`first-board-pullback/*` 的实验会被
 * `manifest.ts` 自动套上公共底座（`withFirstBoardPullbackFoundation`），
 * 本模板不重复包一层。
 */
export function defineCompositeFactorExperiment(
  config: CompositeFactorExperimentConfig
): ExperimentDefinition {
  const spec = defineCompositeTemplateSpec({
    members: config.members,
    normalization: config.normalization ?? DEFAULT_NORMALIZATION_METHOD,
    weighting: config.weighting ?? DEFAULT_WEIGHTING,
    topNSizes: config.topNSizes ?? COMPOSITE_TOP_N_SIZES,
    dayScopes: config.dayScopes ?? DAY_SCOPES,
  });

  return {
    descriptor: {
      id: config.id,
      name: config.name,
      version: config.version ?? COMPUTATION_VERSION,
      description: config.description,
      source: config.source,
      tags: [...config.tags],
      parameters: [],
      datasetRequirement: COMPOSITE_DATASET_REQUIREMENT,
      pageKey: config.id,
      pageTitle: config.pageTitle,
    },
    resultSchema: compositeFactorSchema,
    run: async (context: ExperimentRunContext) => {
      // 0) 坐标不变量：入场 T+6 / 退出 T+10 / 成本 20bps 必须与冻结契约一致。
      assertTemplateCoordinate();

      // 1) 成员解析 + 方向 / 可用性硬校验（方向不允许在组合里重估）。
      const members = spec.members.map(resolveCompositeMember);
      assertMemberDirections(members);
      assertMembersUsable(members, spec.normalization);

      // 2) 冻结入池池 + 12 因子原始值（与 12F / Top-N / 单因子共用同一份派生）。
      const derivation = await deriveTwelveFactorSamples(context);
      const window = derivation.evaluationWindow;
      context.log(
        (context.protocol === null
          ? "协议 EXPLORATORY（读全窗）"
          : `协议 ${context.protocol.phase}｜窗口 ${window === null ? "(无)" : `${window.startDate}..${window.endDate}`}`) +
          `；候选 ${derivation.candidateCount}；严格涨停 ${derivation.exactLimitUpCloseCount}；` +
          `12 因子完备用例 ${derivation.samples.length}；前置窗口缺失 ${derivation.prefixWindowMissingCount}`
      );
      if (derivation.samples.length === 0) {
        throw new Error("候选池为空：无可评分样本（拒绝产出一份没有样本的「结果」）");
      }

      // 3) 合成分：Factor Value → Direction → Normalization → Weight → Composite。
      const plan = buildScoringPlan({
        members,
        normalization: spec.normalization,
        weighting: spec.weighting,
        samples: derivation.samples,
      });
      const scoring = scoreSamples({ plan, samples: derivation.samples });
      context.log(
        `合成分：方法 ${spec.normalization}；可评估 ${scoring.scored.length} / ` +
          `完备用例 ${derivation.samples.length}；${plan.weighting.disclosure}`
      );
      if (scoring.scored.length === 0) {
        throw new Error("合成分全部不可评估（拒绝产出一份没有样本的「结果」）");
      }

      // 4) PIT：真实交易日 + 统一入场退出，并与公共底座逐笔对拍。
      const pit = await loadPitAccess(
        context,
        scoring.scored.map(item => item.sample.eventId)
      );
      const dateEntries: {
        eventId: string;
        eventDate: string;
        signalDate: string | null;
        entryDate: string | null;
      }[] = [];
      const rankable: SingleFactorSample[] = scoring.scored.map(item => {
        const access = pit.byEventId.get(item.sample.eventId);
        if (!access) throw new Error(`PIT 视图缺失事件 ${item.sample.eventId}`);
        const signalDate = resolveSignalDate(access);
        const entryRelativeDay = ENTRY_DAY;
        const entryDate = access.tradeDateAt(entryRelativeDay);
        dateEntries.push({
          eventId: item.sample.eventId,
          eventDate: item.sample.eventDate,
          signalDate,
          entryDate,
        });
        const resolution = resolveEntryExit(access);
        if (!resolution.ok) {
          throw new Error(
            `入场/退出对拍失败：事件 ${item.sample.eventId} 在公共底座里是可用样本，` +
              `但本模板解出 ${resolution.reason}（两套语义已漂移）`
          );
        }
        const entryPrice = resolution.entry.price;
        const exitPrice = resolution.exit.price;
        const cost = roundTripCostRatio();
        const grossReturn = exitPrice / entryPrice - 1;
        const netReturn = grossReturn - cost;
        const sample: SingleFactorSample = {
          eventId: item.sample.eventId,
          stockCode: access.executionBarAt(entryRelativeDay)?.symbol ?? "",
          eventDate: item.sample.eventDate,
          signalDate: signalDate ?? "",
          entryDate: resolution.entry.date,
          exitDate: resolution.exit.date,
          entryRelativeDay,
          exitRelativeDay: resolution.exit.relativeDay,
          holdingDays: holdingDaysOf(
            entryRelativeDay,
            resolution.exit.relativeDay
          ),
          entryPrice,
          exitPrice,
          grossReturn,
          cost,
          costBps: ROUND_TRIP_COST_BPS,
          netReturn,
          year: Number(item.sample.eventDate.slice(0, 4)),
          // 🔴 排序键 = 合成分：下游单因子引擎只认这一个字段。
          factorValue: item.compositeScore,
        };
        // 与公共底座逐笔对拍（相对日 / 价格 / 日期必须逐位一致）。
        assertEntryExitAgreement(sample, resolution);
        if (Math.abs(netReturn - item.sample.netReturn) > 1e-12) {
          throw new Error(
            `净收益对拍失败：事件 ${item.sample.eventId} 本模板 ${netReturn} ≠ ` +
              `公共底座 ${item.sample.netReturn}（成本口径已漂移）`
          );
        }
        return sample;
      });
      assertPitDatesResolved(dateEntries);
      context.log(
        `PIT 对拍通过：${rankable.length} 笔；读了相对日 [${pit.readRelativeDays.join(", ")}]`
      );

      // 5) 评估（排序 / 取头 / 等权 / 基准 / 指标 / 显著性 / 时间切片）。
      const analysis = analyseComposite({
        rankable,
        combos: spec.topNSizes.map(size => ({
          id: `N${size}`,
          size,
          label: `Top-${size}`,
        })),
        dayScopes: spec.dayScopes,
        fixedDayMinSize: Math.max(...spec.topNSizes),
      });

      // 6) 装配（表 / 统计 / 产物 / 自有载荷）。
      return assembleCompositeFactorResult({
        context,
        spec,
        members,
        weighting: plan.weighting,
        scored: scoring.scored,
        compositeSummary: summarizeCompositeScores(
          scoring.scored.map(item => item.compositeScore)
        ),
        missingByMember: scoring.missingByMember,
        derivation,
        analysis,
        coordinate: {
          entryDay: ENTRY_DAY,
          exitRelativeDay: EXIT_RELATIVE_DAY,
          roundTripCostBps: ROUND_TRIP_COST_BPS,
          decisionOffsetDays: DECISION_OFFSET_DAYS,
          informationCutoffRelativeDay: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
          observationRelativeDays: OBSERVATION_RELATIVE_DAYS,
        },
        rankedKey: "composite",
        normalizationLabel: NORMALIZATION_LABELS[spec.normalization],
        normalizationDisclosure:
          spec.normalization === "BUCKET_POSITIONAL"
            ? "桶位分取自 FROZEN-BUCKET-CONTRACT-001 §3.1（(idx+0.5)/k，桶位中点）；" +
              "方向表取自同契约 §3.2。边界与方向均不在组合里重估。"
            : "同日横截面百分位 count(peer ≤ v)/N（peer = 同一决策日内该成员的全部可取值）；" +
              "适用于尚无冻结桶词表的因子，与 12F 的桶位分口径**不同**，结果不可混引。",
        bucketFingerprint: compositionBucketFingerprint(members),
        protocol: context.protocol,
      });
    },
  };
}

export { COMPOSITE_FACTOR_EXPERIMENT_TYPE, COMPOSITE_FACTOR_TEMPLATE_ID };
export { COMPUTATION_VERSION };
