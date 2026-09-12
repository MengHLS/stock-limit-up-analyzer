/**
 * RESEARCH-002 · PERF — 研究装配的**列投影**（列裁剪的唯一事实来源）。
 *
 * ## 为什么需要它
 *
 * 装配阶段的成本模型是一句话：`耗时 ≈ 传输字节 ÷ 吞吐`。跨境 TiDB 实测 RTT≈208ms 但
 * 「RTT × 往返次数」只占总耗时约 2%，即**吞吐受限**而非延迟受限 —— 于是只有两个杠杆：
 * 少传字节（压缩协议）、少传列（列裁剪）。原实现是 `SELECT *`：prefix 13 列 / path 15 列
 * 整行搬回 Node，而变量解析实际只读其中 2~6 列（受控 A/B 实测裁剪 **3.27×**）。
 *
 * ## 设计原则：**不靠人记得声明**
 *
 * 列裁剪最危险的失败模式是「漏列 → 静默变 null」：`variables.ts` 的 `resolve` 普遍以
 * `?? null` 收口，少查一列不会报错，只会让某个特征悄悄变成一堆 null，在结果层几乎不可见。
 * 因此本模块不要求任何变量手写「我用到哪些列」，而是让**读取行为本身成为声明**：
 *
 *   1. **自动派生**（`deriveColumnProjection`）：用「记录访问」代理（tracking proxy）跑一遍
 *      变量目录里每个 `resolve`，`resolve` 读过哪些列，投影就取哪些列。变量定义改动后
 *      投影自动跟随，不可能漂移 —— 因为两者读的是同一份代码。
 *   2. **越界即失败**（`guardProjectedRows`）：真实数据上把「读了未投影的列」变成
 *      `PROJECTION_MISSING_COLUMN` 异常，专门捕获「只在特定取值下才走到的隐藏分支」。
 *   3. **差分测试**：`columnProjection.test.ts` 对每个变量比对「全列取值」与「投影后取值」，
 *      二者必须逐位相等（等价于「裁剪没有改变任何口径」的可执行证明）。
 *
 * ## 边界（本模块不做的事）
 *
 *   - **不改变任何取值口径**：只决定 SELECT 哪些列，不改 WHERE / ORDER BY / LIMIT / 行数；
 *   - 不读 DB、不写 DB、不落任何副本；
 *   - 不参与 PIT 判定（PIT 由 `variables.ts` 的 FeatureSources / OutcomeSources 结构保证）。
 */

import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import {
  DATASET_EVENT_COLUMNS,
  DATASET_OUTCOME_COLUMNS,
  DATASET_PATH_COLUMNS,
  DATASET_PREFIX_COLUMNS,
} from "../datasetRegistry/query";
import { engineAssert } from "./errors";
import {
  resolveDimensionValue,
  type FeatureSources,
  type FeatureVariableDefinition,
  type OutcomeSources,
  type OutcomeVariableDefinition,
} from "./variables";

/** 四张物理表的角色（与 Dataset Registry 的分层一一对应）。 */
export type ProjectionRole = "event" | "prefix" | "path" | "outcome";

/** 各角色全部列名（从 drizzle 表对象派生，见 datasetRegistry/query.ts）。 */
export const PROJECTION_FULL_COLUMNS: Readonly<Record<ProjectionRole, readonly string[]>> = Object.freeze({
  event: DATASET_EVENT_COLUMNS,
  prefix: DATASET_PREFIX_COLUMNS,
  path: DATASET_PATH_COLUMNS,
  outcome: DATASET_OUTCOME_COLUMNS,
});

/**
 * 结构性列：无论变量怎么声明都必须取。
 *
 * 理由：这些列不是「变量输入」，而是装配器自己的骨架 —— 没有 `eventId` 就无法把
 * prefix / path / outcome 归并回事件，没有 `relativeDay` / `horizon` 就无法定位取值位置，
 * 没有 `tradeDate` / `symbol` 就无法构造 `ResearchSample`。
 */
const STRUCTURAL_COLUMNS: Readonly<Record<ProjectionRole, readonly string[]>> = Object.freeze({
  event: ["datasetVersionId", "eventId", "symbol", "tradeDate"],
  prefix: ["datasetVersionId", "eventId", "relativeDay"],
  path: ["datasetVersionId", "eventId", "relativeDay"],
  outcome: ["datasetVersionId", "eventId", "horizon"],
});

/** 访问代理会顺带看到的非列属性（原型链上的通用方法）——不属于「读了某一列」，直接忽略。 */
const IGNORED_PROBE_KEYS = new Set([
  "then",
  "toJSON",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "inspect",
]);

/** 一次装配实际需要加载的列清单（四张表各一份）。 */
export interface ResearchColumnProjection {
  readonly event: readonly string[];
  readonly prefix: readonly string[];
  readonly path: readonly string[];
  readonly outcome: readonly string[];
}

/** 全列投影（= 不裁剪；供 A/B 对照与测试使用）。 */
export function fullColumnProjection(): ResearchColumnProjection {
  return {
    event: PROJECTION_FULL_COLUMNS.event,
    prefix: PROJECTION_FULL_COLUMNS.prefix,
    path: PROJECTION_FULL_COLUMNS.path,
    outcome: PROJECTION_FULL_COLUMNS.outcome,
  };
}

// ---------------------------------------------------------------------------
// 记录访问代理（派生投影的核心）
// ---------------------------------------------------------------------------

/** 包一层记录访问的代理：任何属性读取都记进 `seen`，再原样交由原对象回答。 */
function trackAccess<T extends object>(target: T, seen: Set<string>): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "string" && !IGNORED_PROBE_KEYS.has(prop)) seen.add(prop);
      return Reflect.get(t, prop, receiver);
    },
  });
}

/** 构造一条「所有列都在、且取值合法」的探针行；结构列用真实类型，好让 resolve 走完整条路径。 */
function buildProbeRow(
  role: ProjectionRole,
  seen: Set<string>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  // 所有列先给一个有限数值：变量里的 `Number.isFinite` 守卫才会继续往下走，
  // 否则 resolve 会提前 return null 而少读若干列（探针不完整 → 投影偏小 → 运行期静默 null）。
  for (const column of PROJECTION_FULL_COLUMNS[role]) row[column] = 1;
  Object.assign(row, overrides);
  return trackAccess(row, seen);
}

/**
 * 事件探针。`tradeDate` / `boardType` / `market` / `industryCode` 必须是正确类型：
 * 维度解析（year / month / quarter）会对 `tradeDate` 做 `slice`，给数字会抛错而中断记录。
 */
const EVENT_PROBE_OVERRIDES: Record<string, unknown> = {
  datasetVersionId: 1,
  eventId: "probe-event",
  symbol: "600000.SH",
  tradeDate: "2024-03-15",
  market: "SH",
  industryCode: "450",
  boardType: "MAIN",
  previousLimitDate: "2024-03-14",
  isFirstLimit: true,
};

function buildProbeSources(
  params: {
    prefixDays: readonly number[];
    pathDays: readonly number[];
    outcomeHorizons: readonly number[];
  },
  seen: Record<ProjectionRole, Set<string>>,
): { featureSources: FeatureSources; outcomeSources: OutcomeSources } {
  const event = buildProbeRow("event", seen.event, EVENT_PROBE_OVERRIDES) as unknown as FirstLimitPullbackEvent;

  const prefixBars = new Map<number, FirstLimitPullbackRawBar>();
  for (const relativeDay of params.prefixDays) {
    prefixBars.set(
      relativeDay,
      buildProbeRow("prefix", seen.prefix, {
        datasetVersionId: 1,
        eventId: "probe-event",
        symbol: "600000.SH",
        tradeDate: "2024-03-15",
        relativeDay,
      }) as unknown as FirstLimitPullbackRawBar,
    );
  }

  const pathRows = new Map<number, FirstLimitPullbackPath>();
  for (const relativeDay of params.pathDays) {
    pathRows.set(
      relativeDay,
      buildProbeRow("path", seen.path, {
        datasetVersionId: 1,
        eventId: "probe-event",
        symbol: "600000.SH",
        tradeDate: "2024-03-15",
        relativeDay,
      }) as unknown as FirstLimitPullbackPath,
    );
  }

  const outcomeRows = new Map<number, FirstLimitPullbackOutcome>();
  for (const horizon of params.outcomeHorizons) {
    outcomeRows.set(
      horizon,
      buildProbeRow("outcome", seen.outcome, {
        datasetVersionId: 1,
        eventId: "probe-event",
        horizon,
      }) as unknown as FirstLimitPullbackOutcome,
    );
  }

  // 事件日 K 线探针：**无条件提供**，与 outcomeDefs 是否真声明 `needsEventBar` 无关。
  // 理由：本函数的目标是「把 resolve 会读到的列全部记下来」。若因调用方漏传 rd=0 而让
  // eventBar 为 undefined，带 `needsEventBar` 的 resolve 会提前 `return null`，low/close
  // 两列就不会被记录 ⇒ 投影偏小 ⇒ 真实装配时被裁掉 ⇒ 变量在真实数据上静默全 null。
  // 给探针补一行 rd=0 即可闭环，且不依赖调用方是否记得传 0。
  const eventBarProbe =
    prefixBars.get(0) ??
    (buildProbeRow("prefix", seen.prefix, {
      datasetVersionId: 1,
      eventId: "probe-event",
      symbol: "600000.SH",
      tradeDate: "2024-03-15",
      relativeDay: 0,
    }) as unknown as FirstLimitPullbackRawBar);

  return {
    featureSources: { event, prefixBars },
    outcomeSources: { pathRows, outcomeRows, eventBar: eventBarProbe },
  };
}

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

export interface DeriveColumnProjectionInput {
  /** 本次装配用到的特征变量定义（已过变量目录校验）。 */
  readonly featureDefs: readonly FeatureVariableDefinition[];
  /** 本次装配用到的结果变量定义（已过变量目录校验）。 */
  readonly outcomeDefs: readonly OutcomeVariableDefinition[];
  /** 需要额外解析的分组维度键（year / board / regime…）。 */
  readonly dimensionKeys: readonly string[];
  /** 需要用到的 prefix 相对日（并集）。 */
  readonly prefixDays: readonly number[];
  /** 需要用到的 path 相对日（并集）。 */
  readonly pathDays: readonly number[];
  /** 需要用到的 outcome 视界（并集）。 */
  readonly outcomeHorizons: readonly number[];
}

/**
 * 派生一次装配所需的列投影。
 *
 * 纯函数、无 I/O：跑一遍变量目录的 `resolve` 收集列访问，再与「结构性列」求并集。
 * 返回顺序固定为 **schema 声明顺序**（便于日志 / 快照比对）。
 */
export function deriveColumnProjection(input: DeriveColumnProjectionInput): ResearchColumnProjection {
  const seen: Record<ProjectionRole, Set<string>> = {
    event: new Set<string>(),
    prefix: new Set<string>(),
    path: new Set<string>(),
    outcome: new Set<string>(),
  };

  const { featureSources, outcomeSources } = buildProbeSources(input, seen);

  // 取值本身不重要（探针数据没有业务含义），重要的是「读了哪些列」。
  // resolve 抛错也不吞掉整条派生流程 —— 只记录已发生的访问。真正的口径错误由分析层负责暴露。
  for (const def of input.featureDefs) {
    try {
      def.resolve(featureSources);
    } catch {
      /* 仅为收集列访问；取值失败不影响投影 */
    }
  }
  for (const def of input.outcomeDefs) {
    try {
      def.resolve(outcomeSources);
    } catch {
      /* 同上 */
    }
  }
  for (const key of input.dimensionKeys) {
    try {
      resolveDimensionValue(key, featureSources, undefined);
    } catch {
      /* 同上 */
    }
  }

  return {
    event: finalizeRole("event", seen.event),
    prefix: finalizeRole("prefix", seen.prefix),
    path: finalizeRole("path", seen.path),
    outcome: finalizeRole("outcome", seen.outcome),
  };
}

/** 结构性列 ∪ 实际访问列；访问到非列属性 → 当场失败（那是变量定义写错了列名）。 */
function finalizeRole(role: ProjectionRole, seen: ReadonlySet<string>): readonly string[] {
  const full = PROJECTION_FULL_COLUMNS[role];
  const wanted = new Set<string>(STRUCTURAL_COLUMNS[role]);
  for (const key of seen) {
    engineAssert(
      full.includes(key),
      "PROJECTION_MISSING_COLUMN",
      `变量解析读取了 ${role} 表上不存在的列 "${key}"。这通常意味着变量定义里列名写错` +
        `（例如把 close 写成 clsoe）——若不在此处失败，该变量会永远解析出 null。`,
      { role, column: key, knownColumns: full },
    );
    wanted.add(key);
  }
  // 按 schema 声明顺序输出，保证同输入同输出（便于快照/日志比对）。
  return full.filter((column) => wanted.has(column));
}

// ---------------------------------------------------------------------------
// 投影守卫（运行期兜底）
// ---------------------------------------------------------------------------

/**
 * 守卫策略。
 *   - `"off"`：不做检查（投影由 `deriveColumnProjection` 保证，信任派生）；
 *   - `"first-chunk"`（默认）：只守卫首批事件 —— 真实数据 + 极低成本，
 *     用于捕获「只在特定取值下才读某列」的分支；
 *   - `"all"`：全部批次都守卫（调试 / 验证用，有可测量的代理开销）。
 */
export type ProjectionGuardMode = "off" | "first-chunk" | "all";

function normalizeGuardMode(raw: string | undefined): ProjectionGuardMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "off" || value === "0" || value === "false" || value === "none") return "off";
  if (value === "all" || value === "always") return "all";
  return "first-chunk";
}

/** 从环境变量读取守卫策略（默认 `first-chunk`）。 */
export function resolveGuardMode(raw: string | undefined = process.env.RESEARCH_PROJECTION_GUARD): ProjectionGuardMode {
  return normalizeGuardMode(raw);
}

/**
 * 把一行数据包成「越界读取即抛错」的代理。
 *
 * 判定精确到「**该表的真实列、且不在本次投影里**」：因此
 *   - 读取已投影列（哪怕是 null）→ 放行；
 *   - 读取未投影列 → `PROJECTION_MISSING_COLUMN`；
 *   - 读取与列无关的属性（如原型方法）→ 放行。
 */
export function guardProjectedRow<T extends object>(
  row: T,
  role: ProjectionRole,
  projected: readonly string[],
): T {
  const selected = new Set(projected);
  const full = PROJECTION_FULL_COLUMNS[role];
  return new Proxy(row, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !selected.has(prop) && full.includes(prop)) {
        engineAssert(
          false,
          "PROJECTION_MISSING_COLUMN",
          `变量解析读取了未投影的 ${role} 列 "${prop}"（本次投影被裁剪掉了它）。` +
            `若该列确实被需要，请检查变量定义是否为「取值相关的条件读取」——` +
            `派生的投影只覆盖探针取值下真实发生的访问。`,
          { role, column: prop, projected: [...selected] },
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
