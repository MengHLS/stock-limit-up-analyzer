import type {
  ExperimentDefinition,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  buildFirstBoardPullbackFoundation,
  mergeFoundationIntoPayload,
  type FoundationBuildOptions,
} from "./foundation";
import {
  FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL,
  FIRST_BOARD_PULLBACK_DATASET_CODE,
  FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY,
} from "./types";

const POST_DAYS = Array.from(
  { length: FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY },
  (_, index) => index + 1
);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function augmentFirstBoardRequirement(
  requirement: ExperimentDefinition["descriptor"]["datasetRequirement"]
): ExperimentDefinition["descriptor"]["datasetRequirement"] {
  return {
    ...requirement,
    datasetCode: FIRST_BOARD_PULLBACK_DATASET_CODE,
    requiredDatasetVersionLabel:
      FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL,
    requiredColumns: {
      events: unique([
        ...(requirement.requiredColumns.events ?? []),
        "isFirstLimit",
        "boardType",
        "market",
        "previousClose",
        "limitUpPrice",
        "turnover",
        "floatMarketCap",
      ]),
      feature: unique([
        ...(requirement.requiredColumns.feature ?? []),
        "open",
        "high",
        "low",
        "close",
      ]),
      observation: unique([
        ...(requirement.requiredColumns.observation ?? []),
        "open",
        "high",
        "low",
        "close",
        "preClose",
        "limitUpPrice",
        "limitDownPrice",
        "barPresent",
        "suspensionStatus",
        "canBuyAtOpen",
        "canSellAtClose",
      ]),
    },
    prefixRelativeDays: unique([
      ...(requirement.prefixRelativeDays ?? []),
      0,
    ]),
    postRelativeDays: unique([
      ...(requirement.postRelativeDays ?? []),
      ...POST_DAYS,
    ]),
    usesForwardData: true,
    forwardDataPurpose:
      `${requirement.forwardDataPurpose ?? "原实验未来数据用途"}；` +
      "公共底座追加 entryDay × exitDay 面板、commonSample 和逐日净收益曲线。",
  };
}

/**
 * 给所有首板回撤核心实验提供统一公共底座。
 *
 * 包装后的实验：
 * - 只接受 Dataset version `v5`；
 * - 保留原实验结果；
 * - 追加公共 sample accounting、entry-aligned curve、anchor bootstrap、lineage；
 * - 把 entryDay × exitDay 长表写成按 entryMode/year 分片的 gzip CSV artifact。
 */
export function withFirstBoardPullbackFoundation(
  definition: ExperimentDefinition,
  options: FoundationBuildOptions = {}
): ExperimentDefinition {
  return {
    ...definition,
    descriptor: {
      ...definition.descriptor,
      tags: unique([
        ...(definition.descriptor.tags ?? []),
        "foundation-v5",
        "common-sample",
        "entry-exit-panel",
      ]),
      datasetRequirement: augmentFirstBoardRequirement(
        definition.descriptor.datasetRequirement
      ),
    },
    run: async (context: ExperimentRunContext) => {
      let selectionFrozen = false;
      let selectedEventIds: readonly string[] | null = null;
      const wrappedContext: ExperimentRunContext = {
        ...context,
        freezeSelection: eventIds => {
          selectionFrozen = true;
          selectedEventIds = [...eventIds];
          context.freezeSelection(eventIds);
        },
      };
      const payload = await definition.run(wrappedContext);
      if (!selectionFrozen) {
        const events = await context.dataset.events();
        selectedEventIds = events.map(event => event.eventId);
        context.freezeSelection(selectedEventIds);
      }
      const foundation = await buildFirstBoardPullbackFoundation(
        context,
        {
          ...options,
          eventIds: options.eventIds ?? selectedEventIds ?? undefined,
        }
      );
      context.log(
        `公共底座：v5 lineage=${foundation.lineage.code_digest}；` +
          `曲线 ${foundation.curveRows.length} 行；panel artifacts ${foundation.artifactNames.length} 个`
      );
      return mergeFoundationIntoPayload(payload, foundation, options);
    },
  };
}
