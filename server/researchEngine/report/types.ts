/**
 * PHASE-A-001 —— Research Report 产物类型（纯数据契约，零 IO）。
 *
 * 分层（严格单向）：
 *   service（装配 + 幂等落库）
 *     → generator（**纯投影**：Result / Finding / Conclusion → markdown 正文 + metadata + checksum）
 *       → types（本文件）
 *
 * 反模式检查（本模块**不含**）：
 *   - 不 import 任何 Repository / datasetReader / engine（generator 是纯函数，见 `generator.ts` 头注释）；
 *   - 不重新查询原始股票数据、不重算收益 / 条件统计 / Finding；
 *   - 不新增第二套 Result / Finding / Conclusion / Artifact 体系（只消费既有四张表）；
 *   - 不做 PDF / 图表 / 对象存储 / 报告编辑器。
 */

import type {
  ResearchAnalysis,
  ResearchArtifact,
  ResearchConclusion,
  ResearchExperiment,
  ResearchFinding,
  ResearchResult,
} from "../../researchCore/types";
import type { ResearchDatasetVersionContext } from "../types";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 报告产物的 `artifactType`。取值必须落在 `RESEARCH_ARTIFACT_TYPES` 内（不新增类型）。 */
export const REPORT_ARTIFACT_TYPE = "REPORT" as const;

/**
 * 报告产物 `storageType`。
 *
 * 为什么是 `INLINE` 而不是 `FILE`：`research_artifact` 的既定语义是
 * 「INLINE = 小体积内容直接落 `metadataJson`，不引入对象存储」（RESEARCH-001-SCHEMA §storageType）。
 * 本任务明确禁止对象存储，且报告是**派生文本**（可由同 run 的既有结果重放得到），
 * 落库即完整，不需要外部文件的生命周期管理。
 */
export const REPORT_STORAGE_TYPE = "INLINE" as const;

/** 报告正文格式。第一版只做 markdown，不做 PDF / 图表。 */
export const REPORT_FORMAT = "markdown" as const;

/** 报告正文 MIME。 */
export const REPORT_MEDIA_TYPE = "text/markdown" as const;

/**
 * 生成器版本。
 *
 * 它参与 `metadataJson.generatorVersion`，用于回答「这份报告是哪一版投影逻辑产出的」。
 * 🔴 只允许在**正文渲染口径发生有意义变化**时递增 —— 它不参与 checksum（见 `generator.ts`），
 * 因此改了它不会让历史报告凭空重新生成。
 */
export const REPORT_GENERATOR_VERSION = "1.0.0" as const;

/** checksum 覆盖范围说明（写进 metadata，供人工复核「hash 到底是哪一段的」）。 */
export const REPORT_CHECKSUM_SCOPE = "report-body-utf8" as const;

/**
 * INLINE 产物的 `uri` 形态。
 *
 * 它是**稳定的逻辑定位符**（同一 Run 永远得到同一 uri），不是可 fetch 的 URL ——
 * INLINE 的正文在 `metadataJson.report.body`，`uri` 只承担「这份产物是谁」的标识作用。
 * 稳定性是刻意的：它让「同 run ⇒ 同 uri」可被断言，从而支撑幂等验收（A-2）。
 */
export function buildReportUri(runId: number): string {
  return `inline://research-report/run/${runId}`;
}

// ---------------------------------------------------------------------------
// 投影输入（全部来自已落库的只读快照）
// ---------------------------------------------------------------------------

/** 报告投影的**唯一输入**。字段全部来自既有表，缺失即 `null`，禁止伪造。 */
export interface ResearchReportSource {
  experiment: ResearchExperiment;
  run: {
    id: number;
    runNo: number;
    status: string;
    sampleCount: number | null;
    startedAt: string | null;
    completedAt: string | null;
    /** 执行时冻结的输入快照（`research_run.inputSnapshot`），原文引用不改写。 */
    inputSnapshot: unknown;
  };
  /** Dataset 版本上下文；取不到即 `null`（报告里如实写「不可达」，不编造）。 */
  dataset: ResearchDatasetVersionContext | null;
  /** 本 Run 下实际存在的分析（按 id 升序）。**不得凭空生成不存在的 Analysis**。 */
  analyses: ResearchAnalysis[];
  /** 结果行，按 `analysisId` 分组；键只允许来自 `analyses`。 */
  resultsByAnalysisId: ReadonlyMap<number, ResearchResult[]>;
  /** 本 Run 下实际存在的 Finding（按 id 升序）。 */
  findings: ResearchFinding[];
  /**
   * 归属本 Run 的结论。
   *
   * `research_conclusion` **无 `runId` 列**，只能经 `evidence.primaryAnalysis.analysisId →
   * research_analysis.runId` 两跳解析；解析不出即 `null`（禁止伪造），
   * 同时把原因写进 `metadata.unresolvedTraceFields`。
   */
  conclusion: ResearchConclusion | null;
  /** 由 `analysis.moduleKey` 反查出的交易模式（patternLibrary 代码声明库）；反查不到即空数组。 */
  patterns: Array<{ patternId: string; label: string }>;
  /** 结论归属的解析说明（人读），如「证据未携带 primaryAnalysis」/「多候选，按 id 取最大」。 */
  conclusionResolution: string | null;
}

// ---------------------------------------------------------------------------
// 投影输出
// ---------------------------------------------------------------------------

/** 可追溯元数据。键名遵循 PHASE-A-001 §7（`patternId` 之外额外给出 `patternIds`，见下方注释）。 */
export interface ResearchReportMetadata {
  /** `research_experiment.datasetVersionId` → 报告引用的数据坐标。 */
  datasetVersionId: number | null;
  runId: number;
  experimentId: number | null;
  /** 本 Run 真正执行过的分析 id（升序）。 */
  analysisIds: number[];
  /** 本 Run 真正落库的 Finding id（升序）。 */
  findingIds: number[];
  /** 归属本 Run 的结论 id；解析不出为 `null`。 */
  conclusionId: number | null;
  /**
   * 交易模式 id。
   *
   * 只在**恰好反查出 1 个**模式时非空；一个 Run 可能同时跑多个 module
   * （实测 Run 750003 = `PULLBACK_EFFECTIVENESS` + `EVENT_RETURN_RESEARCH`），
   * 此时单值字段无法诚实表达，故置 `null` 并把全集放进 `patternIds`。
   */
  patternId: string | null;
  /** 由 `analysis.moduleKey` 反查出的全部模式 id（升序、去重）。 */
  patternIds: string[];
  generatorVersion: string;
  /** 报告正文载荷（INLINE 语义：正文落 metadataJson）。 */
  report: {
    format: typeof REPORT_FORMAT;
    mediaType: typeof REPORT_MEDIA_TYPE;
    /** 正文字节数（UTF-8）。 */
    bytes: number;
    body: string;
  };
  /** checksum 覆盖范围与算法（可复核）。 */
  checksum: {
    algorithm: "sha256";
    scope: typeof REPORT_CHECKSUM_SCOPE;
    value: string;
  };
  /** 结论归属的解析说明（解析不出时的原因也写在这里）。 */
  conclusionResolution: string | null;
  /**
   * 当前数据**无法可靠取得**的溯源字段（PHASE-A-001 §7 / §16 纪律）。
   *
   * 存在的意义：把「这里本该有值但取不到」显式化，避免下游把 `null` 误读成
   * 「业务上就是没有」。报告正文里也有一节原样展示。
   */
  unresolvedTraceFields: string[];
}

/** Generator 的完整输出。 */
export interface ResearchReportDraft {
  /** markdown 正文（**待落库的产物本体**）。 */
  body: string;
  format: typeof REPORT_FORMAT;
  generatorVersion: string;
  /** 正文的 SHA-256 hex（幂等依据：同 run + 同正文 ⇒ 同 checksum）。 */
  checksum: string;
  metadata: ResearchReportMetadata;
  /** 投影过程中产生的可读告警（如「某分析无结果行」），供 service 记日志。 */
  warnings: string[];
}

/** 从 artifact 的 `metadataJson` 里取回正文载荷（供 API / 前端消费）。 */
export interface ResearchReportPayload {
  format: string;
  mediaType: string;
  bytes: number;
  body: string;
}
