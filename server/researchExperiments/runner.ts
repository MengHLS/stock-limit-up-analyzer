/**
 * RESEARCH-EXPERIMENT-001 — Experiment Runner（规格 §12）。
 *
 * ## 边界（本文件**不**理解任何实验业务）
 *
 * ```
 * Runner:      load / validate / resolve dataset / validate parameters / execute
 *              / capture result / capture error / return execution metadata
 * Experiment:  「具体研究什么、怎么算」（`research-experiments/**` 里的 run()）
 * ```
 *
 * ## 两类失败，两条不同的出口（这条分界是刻意的）
 *
 * | 何时 | 例子 | 行为 |
 * | --- | --- | --- |
 * | **执行前**就能判定 | 实验未注册 / 参数越界 / 版本不是 READY / 相对日超视界 | **抛领域错误**（→ tRPC 错误，`[CODE] …`） |
 * | **执行中**才发生 | `run()` 抛异常 / 结果不符契约 | **返回 `runStatus: FAILED` 的 outcome**（`result: null` + `error` 如实回报） |
 *
 * 理由：前者是「这次请求本身不成立」，调用方应当看到参数化错误；
 * 后者是「请求成立但这次跑失败了」，属于**执行事实**，页面上要能同时看到
 * 「用了哪个 Dataset 版本 / 什么参数 / 跑了多久 / 失败码」。
 */

import {
  experimentResultEnvelopeSchema,
  type ExperimentDescriptor,
  type ExperimentResultEnvelope,
  type ExperimentParameterValues,
  type ExperimentRunOutcome,
} from "@shared/researchExperimentsContracts";
import { ExperimentError, toExperimentError } from "./errors";
import type { ExperimentDatasetPort } from "./datasetPort";
import {
  assertDatasetCodeMatches,
  assertRelativeDaysWithinHorizon,
  assertVersionReady,
} from "./datasetPort";
import type { ExperimentRegistry } from "./registry";
import type { ExperimentDefinition, ExperimentResultPayload, ExperimentRunContext } from "./types";

/** Runner 入参。 */
export interface ExperimentRunRequest {
  experimentId: string;
  datasetVersionId: number;
  parameters?: ExperimentParameterValues;
}

/** Runner 依赖（一律注入 ⇒ 单测可用内存替身，不必连真库）。 */
export interface ExperimentRunnerDeps {
  registry: ExperimentRegistry;
  datasetPort: ExperimentDatasetPort;
  /** 可注入的时钟（默认 `() => new Date()`）；测试用它固定耗时。 */
  now?: () => Date;
}

export interface ExperimentRunner {
  /** 已注册实验的描述符列表（升序）。 */
  listDescriptors(): ExperimentDescriptor[];
  /** 取描述符；不存在 → 抛 `EXPERIMENT_NOT_FOUND`。 */
  requireDescriptor(experimentId: string): ExperimentDescriptor;
  /** 参数校验 + 默认值归并（**唯一**实现；router 与 run 共用）。 */
  resolveParameters(descriptor: ExperimentDescriptor, provided?: ExperimentParameterValues): ExperimentParameterValues;
  /** 只做「执行前」的全部校验（含 Dataset 解析）；不合规即抛。 */
  prepare(request: ExperimentRunRequest): Promise<PreparedExperimentRun>;
  /** 完整执行一次实验。 */
  run(request: ExperimentRunRequest): Promise<ExperimentRunOutcome>;
}

/** 执行前的准备结果（页面上「即将用什么跑」的那一组事实）。 */
export interface PreparedExperimentRun {
  definition: ExperimentDefinition;
  descriptor: ExperimentDescriptor;
  resolvedParameters: ExperimentParameterValues;
  /** 已解析的 Dataset 事实（避免 `run()` 里再解析一次，浪费一次跨境查询）。 */
  facts: import("./types").ExperimentDatasetFacts;
}

// ---------------------------------------------------------------------------
// 参数校验 / 默认值归并
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 参数校验 + 默认值归并。
 *
 * 🔴 前端表单的校验**不是权威** —— 后端在这里独立重做一遍（规格 §17 的 ux 纪律）。
 * 三条硬规则：
 *   1. **未知参数键一律拒绝**（打错参数名不该静默无效）；
 *   2. 缺必填 ⇒ 拒绝（**不用 0 / 空串兜底**）；
 *   3. 越界 / 类型不符 ⇒ 拒绝（**不夹取** —— 夹取等于悄悄改窄实验）。
 */
export function resolveExperimentParameters(
  descriptor: ExperimentDescriptor,
  provided?: ExperimentParameterValues,
): ExperimentParameterValues {
  const supplied = provided ?? {};
  const declaredCodes = new Set(descriptor.parameters.map((p) => p.code));

  for (const key of Object.keys(supplied)) {
    if (!declaredCodes.has(key)) {
      throw new ExperimentError(
        "EXPERIMENT_PARAMETER_INVALID",
        `实验 "${descriptor.id}" 不存在参数 "${key}"（已声明：[${[...declaredCodes].sort().join(", ")}]）` +
          `—— 打错的参数名会被静默忽略，因此在此拒绝`,
        { key, declared: [...declaredCodes] },
      );
    }
  }

  const resolved: ExperimentParameterValues = {};
  for (const param of descriptor.parameters) {
    const raw = Object.prototype.hasOwnProperty.call(supplied, param.code)
      ? supplied[param.code]
      : param.defaultValue;
    const required = param.required === true;

    if (raw === undefined || raw === null) {
      if (required) {
        throw new ExperimentError(
          "EXPERIMENT_PARAMETER_INVALID",
          `参数 "${param.code}"（${param.label}）为必填，但本次没有提供`,
          { code: param.code },
        );
      }
      // 非必填参数在注册时已保证有 defaultValue ⇒ 回落到它。
      resolved[param.code] = param.defaultValue as never;
      continue;
    }

    const bounds = param.bounds ?? null;
    const assertBounds = (value: number, label: string): void => {
      if (!bounds) return;
      const { min, max } = bounds;
      if (min !== null && min !== undefined && value < min) {
        throw new ExperimentError(
          "EXPERIMENT_PARAMETER_INVALID",
          `参数 "${param.code}"${label} = ${value} 小于下界 ${min}（**不夹取**）`,
          { code: param.code, value, min },
        );
      }
      if (max !== null && max !== undefined && value > max) {
        throw new ExperimentError(
          "EXPERIMENT_PARAMETER_INVALID",
          `参数 "${param.code}"${label} = ${value} 大于上界 ${max}（**不夹取**）`,
          { code: param.code, value, max },
        );
      }
    };

    switch (param.kind) {
      case "INT": {
        if (!isFiniteNumber(raw) || !Number.isInteger(raw)) {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 必须是整数，实际 ${JSON.stringify(raw)}`,
            { code: param.code, value: raw },
          );
        }
        assertBounds(raw, "");
        resolved[param.code] = raw;
        break;
      }
      case "NUMBER": {
        if (!isFiniteNumber(raw)) {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 必须是有限数值，实际 ${JSON.stringify(raw)}`,
            { code: param.code, value: raw },
          );
        }
        assertBounds(raw, "");
        resolved[param.code] = raw;
        break;
      }
      case "BOOLEAN": {
        if (typeof raw !== "boolean") {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 必须是布尔值，实际 ${JSON.stringify(raw)}`,
            { code: param.code, value: raw },
          );
        }
        resolved[param.code] = raw;
        break;
      }
      case "ENUM": {
        const allowed = param.allowedValues ?? [];
        if (typeof raw !== "string" || !allowed.includes(raw)) {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 必须是 [${allowed.join(", ")}] 之一，实际 ${JSON.stringify(raw)}`,
            { code: param.code, value: raw, allowed },
          );
        }
        resolved[param.code] = raw;
        break;
      }
      case "INT_LIST": {
        if (!Array.isArray(raw) || raw.some((v) => !isFiniteNumber(v) || !Number.isInteger(v))) {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 必须是整数数组，实际 ${JSON.stringify(raw)}`,
            { code: param.code, value: raw },
          );
        }
        if (raw.length === 0) {
          throw new ExperimentError(
            "EXPERIMENT_PARAMETER_INVALID",
            `参数 "${param.code}" 不得为空数组`,
            { code: param.code },
          );
        }
        for (const value of raw) assertBounds(value, " 的元素");
        resolved[param.code] = raw;
        break;
      }
      default: {
        // 穷尽性保护：新增 kind 而未在此处理 ⇒ 响亮拒绝（不静默放过）。
        throw new ExperimentError(
          "EXPERIMENT_METADATA_INVALID",
          `参数 "${param.code}" 的种类 ${String(param.kind)} 未被 runner 支持`,
          { code: param.code, kind: param.kind },
        );
      }
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// 结果校验
// ---------------------------------------------------------------------------

/**
 * 结果信封的一致性校验（**结构诚实性**）。
 *
 * 除了 zod 形状校验，额外钉两条账目相等的断言 —— 它们是「样本量为什么是这个数」
 * 的唯一诊断线索，账不平就意味着有样本被静默吞掉：
 *   1. `eligibleCount + excludedCount === candidateCount`；
 *   2. `Σ excludedByReason === excludedCount`。
 */
export function validateExperimentResultEnvelope(
  envelope: ExperimentResultEnvelope,
  experimentId: string,
): void {
  const parsed = experimentResultEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new ExperimentError(
      "EXPERIMENT_RESULT_INVALID",
      `实验 "${experimentId}" 的结果不符合信封契约：${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("；")}`,
      { issues: parsed.error.issues.slice(0, 20) },
    );
  }
  const summary = parsed.data.sampleSummary;
  if (summary.eligibleCount + summary.excludedCount !== summary.candidateCount) {
    throw new ExperimentError(
      "EXPERIMENT_RESULT_INVALID",
      `实验 "${experimentId}" 的样本账不平：eligible(${summary.eligibleCount}) + ` +
        `excluded(${summary.excludedCount}) ≠ candidate(${summary.candidateCount})`,
      { summary },
    );
  }
  const reasonSum = Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0);
  if (reasonSum !== summary.excludedCount) {
    throw new ExperimentError(
      "EXPERIMENT_RESULT_INVALID",
      `实验 "${experimentId}" 的剔除原因合计 ${reasonSum} ≠ excludedCount ${summary.excludedCount}` +
        `（剔除原因必须逐项如实，否则「为什么样本变少」无从诊断）`,
      { reasonSum, summary },
    );
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** 运行日志上限（防止实验写出无界日志撑爆响应体）。 */
export const MAX_EXPERIMENT_LOG_LINES = 200;

/**
 * 构造 Runner（纯注入，无隐藏单例）。
 */
export function createExperimentRunner(deps: ExperimentRunnerDeps): ExperimentRunner {
  const { registry, datasetPort } = deps;
  const now = deps.now ?? (() => new Date());

  function requireDescriptor(experimentId: string): ExperimentDescriptor {
    return registry.require(experimentId).descriptor;
  }

  async function prepare(request: ExperimentRunRequest): Promise<PreparedExperimentRun> {
    // 1) load（未注册 ⇒ EXPERIMENT_NOT_FOUND）
    const definition = registry.require(request.experimentId);
    const descriptor = definition.descriptor;

    // 2) validate parameters（含默认值归并）
    const resolvedParameters = resolveExperimentParameters(descriptor, request.parameters);

    // 3) resolve dataset
    const facts = await datasetPort.getVersionFacts(request.datasetVersionId);
    if (facts === null) {
      throw new ExperimentError(
        "EXPERIMENT_DATASET_VERSION_NOT_FOUND",
        `数据集版本 ${request.datasetVersionId} 不存在`,
        { datasetVersionId: request.datasetVersionId },
      );
    }
    assertVersionReady(facts);
    assertDatasetCodeMatches(descriptor, facts);
    assertRelativeDaysWithinHorizon(descriptor, facts);

    return { definition, descriptor, resolvedParameters, facts };
  }

  return {
    listDescriptors() {
      return registry.list().map((d) => d.descriptor);
    },

    requireDescriptor,

    resolveParameters(descriptor, provided) {
      return resolveExperimentParameters(descriptor, provided);
    },

    prepare,

    async run(request: ExperimentRunRequest): Promise<ExperimentRunOutcome> {
      // ---- 执行前：不合规即抛（调用方看到的是参数化领域错误）----
      const prepared = await prepare(request);
      const { definition, descriptor, resolvedParameters, facts } = prepared;

      const { access, stats } = datasetPort.createAccess({ descriptor, facts });
      const logs: string[] = [];
      const context: ExperimentRunContext = {
        descriptor,
        parameters: resolvedParameters,
        dataset: access,
        log: (message: string) => {
          if (logs.length < MAX_EXPERIMENT_LOG_LINES) logs.push(message);
        },
      };

      const startedAt = now();
      let payload: ExperimentResultPayload | null = null;
      let envelope: ExperimentResultEnvelope | null = null;
      let failure: ExperimentError | null = null;

      try {
        // 4) execute
        payload = await definition.run(context);
        // 5) capture result（信封由平台填 metadata / parameters，实验无法谎报坐标）
        envelope = {
          metadata: {
            experimentId: descriptor.id,
            experimentName: descriptor.name,
            experimentVersion: descriptor.version,
            datasetVersionId: facts.datasetVersionId,
            datasetCode: facts.datasetCode,
            datasetVersionLabel: facts.datasetVersionLabel,
            datasetStartDate: facts.startDate,
            datasetEndDate: facts.endDate,
            computationVersion: descriptor.version,
          },
          parameters: resolvedParameters,
          sampleSummary: payload.sampleSummary,
          ...(payload.tables !== undefined ? { tables: [...payload.tables] } : {}),
          ...(payload.statistics !== undefined ? { statistics: [...payload.statistics] } : {}),
          ...(payload.distributions !== undefined ? { distributions: [...payload.distributions] } : {}),
          ...(payload.comparisons !== undefined ? { comparisons: [...payload.comparisons] } : {}),
          ...(payload.charts !== undefined ? { charts: [...payload.charts] } : {}),
          ...(payload.customPayload !== undefined ? { customPayload: payload.customPayload } : {}),
        };
        validateExperimentResultEnvelope(envelope, descriptor.id);
        const custom = definition.resultSchema.safeParse(payload.customPayload);
        if (!custom.success) {
          throw new ExperimentError(
            "EXPERIMENT_RESULT_INVALID",
            `实验 "${descriptor.id}" 的 customPayload 不符合本实验自己的 resultSchema：${custom.error.issues
              .slice(0, 5)
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("；")}`,
            { issues: custom.error.issues.slice(0, 20) },
          );
        }
      } catch (error) {
        // 6) capture error（执行期失败：如实回报，不吞错、也不抛出）
        failure = toExperimentError(error);
        envelope = null;
      }

      const finishedAt = now();

      return {
        runStatus: failure === null ? "SUCCEEDED" : "FAILED",
        descriptor,
        execution: {
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          resolvedParameters,
          /** 实验自己写的运行日志（有界；让「跑到哪一步了」在失败时也看得到）。 */
          logs,
          datasetFacts: {
            datasetVersionId: facts.datasetVersionId,
            datasetCode: facts.datasetCode,
            datasetVersionLabel: facts.datasetVersionLabel,
            status: facts.status,
            startDate: facts.startDate,
            endDate: facts.endDate,
            datasetTotalEvents: facts.totalEvents,
            eventCount: stats.eventCount,
            prefixRowCount: stats.prefixRowCount,
            postRowCount: stats.postRowCount,
            maxPostRelativeDayRead: stats.maxPostRelativeDayRead,
            decisionOffsetDays: descriptor.datasetRequirement.decisionOffsetDays,
            forwardDataRead: stats.postRowCount > 0,
          },
        },
        result: envelope,
        error:
          failure === null
            ? null
            : {
                code: failure.code,
                message: failure.message,
                ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
              },
      };
    },
  };
}
