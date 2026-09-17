/**
 * legacy 生产回测 → **策略评估** 的桥（STEP B 落点② · 唯一实现）。
 *
 * ## 为什么需要它
 *
 * `paramSearchRouter` / `walkForwardRouter` 原本用 `getLeaderCandidateBacktest`
 * （legacy 生产回测）算「参数集 → 绩效标量」。那有三个问题：
 *   1. **参数只认 8 个 legacy 字段**（`MAPPABLE_PARAMETER_DICTIONARY`），其余维度落
 *      `switch` 的 `default: break` ⇒ **静默忽略**；
 *   2. **不读策略文档** —— `strategyId` 只是记录标签，换个策略数字不变；
 *   3. **不是研究口径** —— 两个 router 自己的 `describe` note 都写着
 *      「评估标量由生产回测 realisticSimulation 同步查表注入，**非 RESEARCH_READY 口径（R7）**」。
 *
 * 本桥提供**同一形态**的替代实现：内部走 `evaluateStrategyParameters`（真实闭环
 * `data → research → strategy → backtest → evaluation`），从而让「参数搜索 / 走查」
 * 跑在**策略文档**上。
 *
 * ## 硬纪律
 *
 * 1. **禁第二套子链**：本模块**不**手写 dataset→signalEngine→simulator→evaluate，
 *    只调评估端口（端口内部已复用闭环既有执行器）。
 * 2. **数据集复用按「区间」缓存**：同一区间内的 N 个参数集共用一份数据集
 *    （注入路径 `datasetSource = injected`）；区间不同则回落到
 *    `datasetVersionId` **直读**（不重建）。这是我们既往实测的决定性差异 ——
 *    注入复用与「重建后直读」在标量上**逐位一致**（`_probe_step_b_evaluation_port`）。
 * 3. **失败必须结构化**：契约是 `{status:"failed", error}` —— 单个参数集失败
 *    不应中断整批搜索，但也**绝不编造标量**。
 * 4. `dataReady: true` **必须显式传**：`runAudit.ts:74` 缺省 `false` ⇒ 不传就永远
 *    拿不到 `gate = PASS`，闭环 `data` 阶段会以 `CL_DATASET_GATE_NOT_PASS` 阻塞
 *    （本仓曾实测误判成「数据链就绪认证未达成」—— 详见 `PROJECT_RULES.md`）。
 */

import type { EquityPoint } from "../../backtest/types";
import type { ParameterSearchSampleOutcome } from "../parameterSearch/types";
import type { StrategyDocument } from "../strategySchema/types";
import type { ResearchParameterSet } from "../types";
import { evaluateStrategyParameters } from "./evaluate";

/** 一次评估的产物：绩效标量 + 该次撮合的权益曲线（走查需要曲线做 OOS 拼接）。 */
export interface StrategyBacktestSample {
  readonly outcome: ParameterSearchSampleOutcome;
  readonly equityCurve: readonly EquityPoint[];
}

export interface StrategyBacktestBridgeOptions {
  /** 真实读出的策略文档（**由调用方读库后传入** —— 本模块不做 IO）。 */
  readonly document: StrategyDocument;
  readonly codeVersion: string;
  /** 已绑定的 Dataset Registry 坐标；给了就直读已落库 `ds_*`（区间变化时靠它避免重建）。 */
  readonly datasetVersionId?: number;
  /** 缺省区间（调用方未给 range 时用它）。 */
  readonly defaultRange: { readonly startDate: string; readonly endDate: string };
  /** 注入式时间戳（同一批评估用同一个，保证 id 可复现）。 */
  readonly createdAt: string;
  /** 同区间数据集缓存的容量上限（按区间分桶；缺省 8 —— 走查逐窗场景够用）。 */
  readonly maxCachedRanges?: number;
}

export interface StrategyBacktestBridge {
  /** 来源标记（如实写进返回值，供调用方与审计分辨口径）。 */
  readonly source: "strategy-document";
  readonly evaluate: (
    parameterSet: ResearchParameterSet,
    range?: { readonly startDate: string; readonly endDate: string },
  ) => Promise<StrategyBacktestSample>;
  /** 审计计数：真正构建/直读数据集的次数（缓存命中则不计）。 */
  readonly stats: () => { readonly datasetLoadCount: number; readonly evaluationCount: number };
}

const DEFAULT_MAX_CACHED_RANGES = 8;

function rangeKeyOf(range: { readonly startDate: string; readonly endDate: string }): string {
  return `${range.startDate}..${range.endDate}`;
}

/**
 * 构造「参数集 × 区间 → 绩效标量 + 权益曲线」的**同步可用**桥（⚠️ 评估本身是 async：
 * 它要解析数据集；闭环内的**同步**评估器请用 `createStrategyParameterEvaluator`）。
 */
export function createStrategyBacktestBridge(
  options: StrategyBacktestBridgeOptions,
): StrategyBacktestBridge {
  const cache = new Map<string, Parameters<typeof evaluateStrategyParameters>[0]["dataset"]>();
  const maxCached = options.maxCachedRanges ?? DEFAULT_MAX_CACHED_RANGES;
  let datasetLoadCount = 0;
  let evaluationCount = 0;

  const evaluate = async (
    parameterSet: ResearchParameterSet,
    range?: { readonly startDate: string; readonly endDate: string },
  ): Promise<StrategyBacktestSample> => {
    const effective = range ?? options.defaultRange;
    const key = rangeKeyOf(effective);
    const cached = cache.get(key);

    try {
      evaluationCount += 1;
      const result = await evaluateStrategyParameters({
        strategyDocument: options.document,
        parameterOverrides: parameterSet,
        dateRange: { startDate: effective.startDate, endDate: effective.endDate },
        createdAt: options.createdAt,
        codeVersion: options.codeVersion,
        // 🔴 显式声明数据链就绪（缺省 false 会让 data 阶段 gate=INCONCLUSIVE 而阻塞）
        dataReady: true,
        ...(cached !== undefined ? { dataset: cached } : {}),
        ...(options.datasetVersionId !== undefined
          ? { datasetVersionId: options.datasetVersionId }
          : {}),
      });

      // 缓存该区间的数据集供**同区间**的后续参数集复用（首次必然 miss ⇒ 计一次加载）
      if (cached === undefined) {
        datasetLoadCount += 1;
        if (cache.size >= maxCached) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
        cache.set(key, result.dataset);
      } else if (cache.get(key) !== result.dataset) {
        // 极少见：注入被端口忽略（例如端口内部重新解析）⇒ 以端口返回的为准并如实计数
        datasetLoadCount += 1;
        cache.set(key, result.dataset);
      }

      const performance = result.evaluation.performance;
      const totalReturnPct = performance?.totalReturnPct ?? null;
      const maxDrawdownPct = performance?.maxDrawdownPct ?? null;
      if (totalReturnPct === null || maxDrawdownPct === null) {
        return {
          outcome: {
            status: "failed",
            error:
              `evaluationRef.performance 缺失 totalReturnPct / maxDrawdownPct` +
              `（策略 ${options.document.strategyId}@${options.document.version}；拒绝编造标量）`,
          },
          equityCurve: result.equityCurve,
        };
      }
      return {
        outcome: {
          status: "succeeded",
          metrics: {
            totalReturnPct,
            maxDrawdownPct,
            tradeCount: result.evaluation.tradeQuality?.completedTradeCount ?? null,
          },
        },
        equityCurve: result.equityCurve,
      };
    } catch (error) {
      // 契约要求结构化失败（不抛错）：单个参数集失败不应中断整批搜索
      return {
        outcome: {
          status: "failed",
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
        equityCurve: [],
      };
    }
  };

  return {
    source: "strategy-document",
    evaluate,
    stats: () => ({ datasetLoadCount, evaluationCount }),
  };
}
