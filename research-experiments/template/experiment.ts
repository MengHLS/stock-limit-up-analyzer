/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  模板实验 —— 复制这个目录开始写你自己的实验
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 怎么用（4 步）
 *
 * 1. 把整个 `template/` 目录复制成 `research-experiments/<你的组>/<你的实验>/`；
 * 2. 改 `descriptor.id` 为 `<你的组>/<你的实验>`（**必须**与目录一致，小写 kebab-case）；
 * 3. 改 `pageKey`（通常与 id 相同），在 `client/src/researchExperiments/pages.ts` 里登记；
 * 4. 在 `research-experiments/manifest.ts` 的数组里加一行。
 *
 * ## 这个模板刻意做了什么
 *
 * - **不使用未来数据**（`usesForwardData: false`）—— 最安全、最不容易写错的起点。
 *   若你的研究必须看事件日之后的行情，请照 `first-board-pullback/entry-day` 的写法显式声明；
 * - **只读 `events` 与 `prefix(rd=0)`** —— 演示「列投影 + 相对日白名单」怎么声明；
 * - **一个 ENUM 参数 + 一个 INT 参数** —— 演示参数定义怎么写（默认值 / 边界 / 枚举）；
 * - **样本账做平** —— `eligible + excluded === candidate` 且 `Σ excludedByReason === excluded`，
 *   这是 runner 会校验的硬约束，账不平整会直接 `EXPERIMENT_RESULT_INVALID`；
 * - **演示一次产物声明（RESEARCH-EXPERIMENT-004）** —— 调 `context.artifact(...)` 把分组统计
 *   另存一份 CSV 到对象存储。这是**可选**能力：不调用也会自动持久化
 *   `result.json` + `logs/run.log` + `manifest.json`，但只有显式声明的文件才会出现在
 *   Run 详情的产物清单里。见规范 §P。
 *
 * 契约全文（含所有可用字段与禁止事项）见 `docs/research/EXPERIMENT-CODE-SPEC.md`。
 */

import type { ExperimentDefinition, ExperimentRunContext } from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  assembleTemplateResult,
  templateCustomPayloadSchema,
  type GroupCount,
} from "./result";

/** 分组维度（唯一来源 = 参数定义里的 allowedValues）。 */
const GROUP_KEYS = ["boardType", "market"] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

export const templateExperiment: ExperimentDefinition = {
  descriptor: {
    // 🔴 改成你自己的 `<组>/<实验>`（必须与目录路径一致）。
    id: "template/demo",
    name: "模板实验 · 按分组维度统计事件数",
    version: COMPUTATION_VERSION,
    description:
      "模板：只读首板事件表与首板日（rd=0）行情，按选定维度统计事件数与占比。" +
      "**不使用事件日之后的数据**，因此天然满足 PIT。复制本目录即可开始写新实验。",
    source: "stock-limit-up-analyzer/template",
    tags: ["template"],
    parameters: [
      {
        code: "groupBy",
        label: "分组维度",
        description: "按事件表的哪个维度分组统计。",
        kind: "ENUM",
        required: false,
        defaultValue: "boardType",
        allowedValues: [...GROUP_KEYS],
      },
      {
        code: "sampleLimit",
        label: "样本上限",
        description: "最多统计多少个事件（按事件日升序取前 N 个）；超出部分会登记剔除原因。",
        kind: "INT",
        required: false,
        defaultValue: 1000,
        bounds: { min: 10, max: 20000 },
        unit: "个事件",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        // 声明什么列，就只能读到什么列（未声明的列在结构上不存在）。
        events: ["boardType", "market", "isFirstLimit"],
        feature: ["close"],
      },
      prefixRelativeDays: [0],
      // 不读事件日之后的数据 ⇒ postRelativeDays 为空、usesForwardData 为 false。
      postRelativeDays: [],
      decisionOffsetDays: null,
      usesForwardData: false,
    },
    // 🔴 改成你自己的 pageKey，并在 client/src/researchExperiments/pages.ts 里登记。
    pageKey: "template/demo",
    pageTitle: "模板实验",
  },

  /** 本实验自有结果结构的校验 schema（与 result.ts 里的组装函数放在一起，防漂移）。 */
  resultSchema: templateCustomPayloadSchema,

  run(context: ExperimentRunContext) {
    const { dataset, parameters, log, artifact } = context;
    const groupBy = parameters.groupBy as GroupKey;
    const sampleLimit = parameters.sampleLimit as number;

    return (async () => {
      // 取数：事件 + 首板日行情（rd=0）。未声明的列读出来恒为 null / undefined。
      const events = await dataset.events();
      const eventDayBars = await dataset.feature(0);
      log(`事件 ${events.length} 条 · rd=0 行情 ${eventDayBars.length} 行`);

      const closeByEvent = new Map<string, number | null>();
      for (const bar of eventDayBars) {
        const close = bar.values.close;
        closeByEvent.set(bar.eventId, typeof close === "number" && Number.isFinite(close) ? close : null);
      }

      // 样本账：单位 = 一个事件。
      const candidateCount = events.length;
      const used = events.slice(0, sampleLimit);
      const droppedByLimit = candidateCount - used.length;

      const excludedByReason: Record<string, number> = {};
      if (droppedByLimit > 0) excludedByReason.SAMPLE_LIMIT = droppedByLimit;

      const counts = new Map<string, number>();
      let withPrice = 0;
      for (const event of used) {
        const raw = event.values[groupBy];
        const key = raw === null || raw === undefined || raw === "" ? "(未知)" : String(raw);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (closeByEvent.get(event.eventId) !== null) withPrice += 1;
      }
      const groups: GroupCount[] = [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        // 🔴 只按分组键排序（稳定、机械），**不按数量排序** —— 按数量排序等价于隐式评级。
        .sort((a, b) => a.key.localeCompare(b.key));

      const eligibleCount = used.length;
      log(`分组 ${groups.length} 个 · 有首板日收盘价 ${withPrice} 条`);

      // ── RESEARCH-EXPERIMENT-004：把分组统计另存一份 CSV 到对象存储 ──
      // 🔴 这里只是**演示写法**（这么小的数据其实放进返回值的 `tables` 就够了）。
      //    真实场景用它落「大到不该塞进结果信封」的文件（逐事件明细 / 图片 / 大块数据）。
      // 🔴 `name` 是 Run 前缀下的相对名字，**必须不含角色段** ——
      //    Object Key = `…/runs/{runId}/{role}/{name}`，`tables/` / `charts/` 由 `role` 拼。
      //    写成 `name: "tables/group-counts.csv"` 且 `role: "table"` 会落成
      //    `tables/tables/group-counts.csv`（角色段重复，EXP-001 真机实测踩过）。
      //    非法名字（绝对路径 / 含 `..`）会**当场抛**。
      artifact({
        name: "group-counts.csv",
        role: "table",
        body: ["key,count", ...groups.map((item) => `"${item.key}",${item.count}`)].join("\n"),
        contentType: "text/csv",
        label: "分组统计（CSV）",
        description: "按 groupBy 维度统计的事件数，与结果信封里的表格同源。",
      });

      return assembleTemplateResult({
        groupBy,
        groups,
        candidateCount,
        eligibleCount,
        excludedByReason,
        usedEventCount: used.length,
        withPriceCount: withPrice,
        datasetEventCount: dataset.facts.totalEvents,
      });
    })();
  },
};

export default templateExperiment;
