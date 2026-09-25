/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Dataset / Universe Resolver**（通用基础之七）。
 *
 * ## 职责
 *
 * 把「Dataset 语义代码 + 版本」解析成「首板回踩候选池里的**可排名样本**」：
 *
 * ```
 * ① 复用 deriveTwelveFactorSamples()  ← 样本口径的唯一实现（与 12F / Top-N 逐字相同）
 *      候选 → 入池（Pass A~D）→ 12 因子值 + 入场价/退出价/净收益
 * ② 读 PIT 视图（pitAccess）        ← 真实交易日 + 成交侧行情
 * ③ 逐笔对拍（entryExit）           ← 本模板解出的入场/退出必须与公共底座一致
 * ④ 施加"因子可评估"过滤            ← factorValue 为 null 的样本不可排名
 * ```
 *
 * ## 🔴 Universe 口径（必须披露）
 *
 * 本模板的池子 = **12F 的入池池**（要求 12 个因子全部可评估），
 * 而不是「只要求目标因子可评估」。这样做有三个理由：
 *
 * 1. **可比性**：12 个单因子实验必须跑在**同一个池**上，否则「哪个因子更能挑」
 *    这个问题会被「每个因子的池子不一样」污染；
 * 2. **不重复建设**：池子口径（Pass A~D 的入池条件）只有 `derive.ts` 一份实现，
 *    再写一份必然漂移，而漂移是静默的；
 * 3. **可对拍**：与 12F / Top-N 的样本账（候选 73,003 / 入池 70,236@v5）逐项相等，
 *    任何一处不一致都能被立刻发现。
 *
 * 代价同样明确：目标因子之外的 11 个因子缺失会导致样本减少 ⇒ 见 `UNIVERSE_POLICY_DISCLOSURE`。
 */

import type { ExperimentRunContext } from "@shared/researchExperimentsContracts";
import { deriveTwelveFactorSamples } from "../../first-board-pullback/twelve-factor-composite-study/derive";
import {
  assertEntryExitAgreement,
  holdingDaysOf,
  resolveEntryExit,
  resolveSignalDate,
} from "./entryExit";
import type { SingleFactorCatalogEntry } from "./factorResolver";
import { loadPitAccess, assertPitDatesResolved } from "./pitAccess";
import { roundTripCostRatio } from "./positionCost";
import type { SingleFactorSample } from "./types";
import { ENTRY_DAY } from "./coordinate";

export const UNIVERSE_LABEL = "首板回踩候选池";
export const UNIVERSE_POLICY_DISCLOSURE =
  "池子 = 12F 的入池池（要求 12 个因子全部可评估），而不是「只要求目标因子可评估」。" +
  "目的：让 12 个单因子实验跑在同一份样本上，「哪个因子更能挑」这个问题才成立；" +
  "代价：目标因子之外的因子缺失会减少样本（记 MISSING_FACTOR / FACTOR_VALUE_MISSING）。";

/** 因子不可评估的剔除原因码。 */
export const FACTOR_VALUE_MISSING_REASON = "FACTOR_VALUE_MISSING";

export interface SingleFactorUniverseResult {
  factor: SingleFactorCatalogEntry;
  /** 已入池 + 因子可评估 + 入场退出对拍通过的样本（按决策日、eventId 升序）。 */
  samples: readonly SingleFactorSample[];
  /** 公共底座侧的入池样本数（= 12F eligibleCount）。 */
  eligibleCountBeforeFactorFilter: number;
  candidateCount: number;
  excludedByReason: Record<string, number>;
  factorMissingByCode: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  crossSectionPeerCount: number;
  /** PIT 读行数与对拍证词。 */
  pitObservationRowCount: number;
  pitExecutionRowCount: number;
  /** 因子不可评估而被剔的样本数。 */
  factorValueMissingCount: number;
}

/**
 * 解析候选池。
 *
 * 顺序不可调换：`derive` 会先 `freezeSelection`（平台硬约束：未来数据只能服务于
 * 已冻结样本的结果观察），随后才读 `observation`。
 */
export async function resolveSingleFactorUniverse(
  context: ExperimentRunContext,
  factor: SingleFactorCatalogEntry
): Promise<SingleFactorUniverseResult> {
  const derivation = await deriveTwelveFactorSamples(context);
  const eventIds = derivation.samples.map(sample => sample.eventId);

  const pit = await loadPitAccess(context, eventIds);

  const pending: {
    eventId: string;
    eventDate: string;
    signalDate: string | null;
    entryDate: string | null;
  }[] = [];
  const samples: SingleFactorSample[] = [];
  const factorMissingByCode: Record<string, number> = {};
  let factorValueMissingCount = 0;
  const cost = roundTripCostRatio();

  for (const derived of derivation.samples) {
    const access = pit.byEventId.get(derived.eventId);
    const fact = derivation.universeFacts.get(derived.eventId);
    if (access === undefined || fact === undefined) {
      throw new Error(
        `结构不一致：事件 ${derived.eventId} 在公共底座里是入池样本，但缺少 PIT 视图或事件元数据。` +
          `请检查 derive.ts 的 universeFacts 是否被破坏。`
      );
    }
    const signalDate = resolveSignalDate(access);
    pending.push({
      eventId: derived.eventId,
      eventDate: derived.eventDate,
      signalDate,
      entryDate: fact.entryDate,
    });

    // 🔴 双读对拍：本模板独立解一次入场/退出，必须与公共底座逐笔一致。
    const resolution = resolveEntryExit(access);
    const sampleForCheck: SingleFactorSample = {
      eventId: derived.eventId,
      stockCode: fact.stockCode,
      eventDate: derived.eventDate,
      signalDate: signalDate ?? "",
      entryDate: fact.entryDate,
      exitDate: fact.exitDate,
      entryRelativeDay: ENTRY_DAY,
      exitRelativeDay: fact.exitRelativeDay,
      holdingDays: holdingDaysOf(ENTRY_DAY, fact.exitRelativeDay),
      entryPrice: derived.entryOpen,
      exitPrice: derived.exitPrice,
      grossReturn: derived.exitPrice / derived.entryOpen - 1,
      cost,
      costBps: cost * 10_000,
      netReturn: derived.netReturn,
      year: derived.year,
      factorValue: Number.NaN,
    };
    assertEntryExitAgreement(sampleForCheck, resolution);

    const factorValue = factor.valueOf(derived);
    if (factorValue === null) {
      factorValueMissingCount += 1;
      factorMissingByCode[factor.code] = (factorMissingByCode[factor.code] ?? 0) + 1;
      continue;
    }
    samples.push({ ...sampleForCheck, factorValue });
  }

  assertPitDatesResolved(pending);

  samples.sort((left, right) =>
    left.eventDate === right.eventDate
      ? left.eventId.localeCompare(right.eventId)
      : left.eventDate.localeCompare(right.eventDate)
  );

  const excludedByReason: Record<string, number> = { ...derivation.excludedByReason };
  for (const reason of Object.keys(factorMissingByCode)) {
    excludedByReason[FACTOR_VALUE_MISSING_REASON] =
      (excludedByReason[FACTOR_VALUE_MISSING_REASON] ?? 0) + factorMissingByCode[reason]!;
  }

  return {
    factor,
    samples,
    eligibleCountBeforeFactorFilter: derivation.samples.length,
    candidateCount: derivation.candidateCount,
    excludedByReason,
    factorMissingByCode,
    datasetEventCount: derivation.datasetEventCount,
    unscannedEventCount: derivation.unscannedEventCount,
    duplicateEventIdCount: derivation.duplicateEventIdCount,
    crossSectionPeerCount: derivation.crossSectionPeerCount,
    pitObservationRowCount: pit.observationRowCount,
    pitExecutionRowCount: pit.executionRowCount,
    factorValueMissingCount,
  };
}
