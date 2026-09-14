/**
 * 探针：**库里到底存的是哪一层** —— `StrategyDocument.definition`（Canonical）还是 v1 兼容视图？
 * 零写入、只读。
 *
 * 为什么必须先问这一句：
 *   `StrategyDocument` 同时有
 *     ① v1 视图字段 `entryRules` / `exitRules` / `riskRules` / `positionSizing` / `parameters`
 *        （`DeclaredRule.field` 是**审计用自由文本**，不参与任何执行）；
 *     ② `definition?: StrategyDefinition`（Canonical：`entry.conditions` 才是真正进回测的条件）。
 *   两者是「definition ──单向派生──► 视图」的关系，且组装层 `alignDefinitionViews` 的
 *   `fillOrCheck` 规则是「缺则补、**冲突则响亮报 `SCHEMA_DEFINITION_VIEW_CONFLICT`**」。
 *
 *   ⇒ 这直接决定策略详情页能不能改成「编辑 definition」：
 *       - 库里**有** definition：客户端若继续送 v1 视图（哪怕一个字段），保存就会响亮失败；
 *       - 库里**没有** definition：definition 侧根本没有可编辑的权威内容，得先有别的办法生成。
 *   这是「凭记忆必错」的第 N 例，所以用真实库实测，而不是读代码猜。
 *
 * 同时把 definition 的**真实形状**打出来（键集 / 各区计数 / 关键枚举值），
 * 供前端表单按真实字段建模 —— 尤其要确认 `entry.conditions` 是否真的非空
 * （空 ⇒ 界面上做得再漂亮，回测依然没有条件可用）。
 *
 * 纪律：只调 `list` / `load` / `loadVersion`（读端点），**绝不调 save / createVersion / delete**；
 * 结尾 `process.exit`（连接池会拖住 event loop）。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_strategy_definition_shape.mts`
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appRouter } from "../../server/routers";

const OUT = "docs/evidence/_probe_strategy_definition_shape.json";

const adminUser = {
  id: 1,
  openId: "probe-strategy-definition-shape",
  name: "probe-strategy-definition-shape",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({
  req: {} as never,
  res: {} as never,
  user: adminUser,
});

const asRec = (v: unknown): Record<string, unknown> =>
  (typeof v === "object" && v !== null && !Array.isArray(v)
    ? v
    : {}) as Record<string, unknown>;

/** 对象键集（排序，便于人眼比对）。 */
const keysOf = (v: unknown): string[] =>
  Object.keys(asRec(v)).filter((k) => asRec(v)[k] !== undefined).sort();

function summarizeDefinition(definition: unknown): Record<string, unknown> {
  const d = asRec(definition);
  const entry = asRec(d.entry);
  const event = asRec(entry.event);
  const win = asRec(entry.observationWindow);
  const trigger = asRec(entry.trigger);
  const conditions = Array.isArray(entry.conditions) ? entry.conditions : [];
  const exit = asRec(d.exit);
  const exitRules = Array.isArray(exit.rules) ? exit.rules : [];
  const position = asRec(d.position);
  const risk = asRec(d.risk);
  const execution = asRec(d.execution);
  const parameters = Array.isArray(d.parameters) ? d.parameters : [];
  const datasets = Array.isArray(d.datasets) ? d.datasets : [];

  return {
    schemaVersion: d.schemaVersion ?? null,
    definitionKeys: keysOf(definition),
    entryKeys: keysOf(entry),
    eventType: event.type ?? null,
    eventParamsKeys: keysOf(event.params),
    observationWindow: {
      start: win.start ?? null,
      end: win.end ?? null,
      unit: win.unit ?? null,
    },
    triggerType: trigger.type ?? null,
    conditionCount: conditions.length,
    /** 前 3 条条件原文 —— 这是「真正进回测」的那一层，必须眼见为实。 */
    conditionSample: conditions.slice(0, 3).map((c) => {
      const row = asRec(c);
      return {
        field: row.field ?? null,
        operator: row.operator ?? null,
        value: row.value ?? null,
        valueType: row.valueType ?? null,
        enabled: row.enabled ?? null,
      };
    }),
    exitRuleCount: exitRules.length,
    exitRuleSample: exitRules.slice(0, 4).map((r) => {
      const row = asRec(r);
      return {
        type: row.type ?? null,
        trigger: row.trigger ?? null,
        threshold: row.threshold ?? null,
        thresholdUnit: row.thresholdUnit ?? null,
        priority: row.priority ?? null,
        enabled: row.enabled ?? null,
      };
    }),
    position: {
      sizingMethod: position.sizingMethod ?? null,
      maxPositions: position.maxPositions ?? null,
      positionRatio: position.positionRatio ?? null,
      maxExposure: position.maxExposure ?? null,
      maxSinglePosition: position.maxSinglePosition ?? null,
    },
    riskKeys: keysOf(risk),
    risk: Object.fromEntries(keysOf(risk).map((k) => [k, risk[k]])),
    execution,
    parameterCount: parameters.length,
    parameterSample: parameters.slice(0, 3).map((p) => {
      const row = asRec(p);
      return {
        code: row.code ?? null,
        dataType: row.dataType ?? null,
        parameterRole: row.parameterRole ?? null,
        required: row.required ?? null,
      };
    }),
    datasetCount: datasets.length,
    datasets,
  };
}

async function main() {
  const rows = await caller.research.strategy.list();
  console.log(`策略总数：${rows.length}`);
  console.log(`列表行键：${JSON.stringify(keysOf(rows[0]))}\n`);

  const report: Record<string, unknown> = {};
  const summaryLines: string[] = [];

  for (const row of rows) {
    const r = asRec(row);
    const strategyId = String(r.strategyId ?? "");
    if (strategyId === "") continue;

    let doc: Record<string, unknown>;
    try {
      doc = asRec(await caller.research.strategy.load({ strategyId }));
    } catch (err) {
      summaryLines.push(`${strategyId}: LOAD_FAILED ${String(err)}`);
      report[strategyId] = { loadFailed: String(err) };
      continue;
    }

    const hasDefinition =
      Object.prototype.hasOwnProperty.call(doc, "definition") &&
      doc.definition !== undefined &&
      doc.definition !== null;

    const v1 = {
      entryRules: Array.isArray(doc.entryRules) ? doc.entryRules.length : null,
      exitRules: Array.isArray(doc.exitRules) ? doc.exitRules.length : null,
      riskRules: Array.isArray(doc.riskRules) ? doc.riskRules.length : null,
      positionSizingKind: asRec(doc.positionSizing).kind ?? null,
      parametersCount:
        Array.isArray(asRec(doc.parameters).parameters)
          ? (asRec(doc.parameters).parameters as unknown[]).length
          : null,
    };

    /**
     * v1 视图与 definition 的**派生关系**是否成立（决定「客户端能不能继续送视图」）。
     *
     * 判据只取一处最稳的：`positionSizing.maxPositions` vs `definition.position.maxPositions`。
     * 若两者不等 ⇒ 客户端只要原样回送这份文档就会撞 `SCHEMA_DEFINITION_VIEW_CONFLICT`。
     */
    const derivedEqual = (() => {
      if (!hasDefinition) return null;
      const d = asRec(doc.definition);
      const defMax = asRec(d.position).maxPositions ?? null;
      const viewMax = asRec(doc.positionSizing).maxPositions ?? null;
      return defMax !== null && viewMax !== null ? defMax === viewMax : null;
    })();

    const entry: Record<string, unknown> = {
      strategyId,
      version: doc.version ?? null,
      recordKind: doc.recordKind ?? null,
      documentKeys: keysOf(doc),
      hasDefinition,
      hasRecipe: doc.recipe !== undefined && doc.recipe !== null,
      datasetVersion: doc.datasetVersion ?? null,
      datasetVersionId: doc.datasetVersionId ?? null,
      v1Views: v1,
      v1PositionSizingMaxPositions: asRec(doc.positionSizing).maxPositions ?? null,
      /** null = 无从比较；false = definition 与视图**已经不一致**（客户端回送即失败）。 */
      v1ViewsMatchDefinition: derivedEqual,
    };
    if (hasDefinition) entry.definition = summarizeDefinition(doc.definition);

    report[strategyId] = entry;

    const cond = hasDefinition
      ? (summarizeDefinition(doc.definition).conditionCount as number)
      : null;
    summaryLines.push(
      `${strategyId}@${String(doc.version)}  definition=${hasDefinition ? "YES" : "no"}`
        + `  entryConditions=${cond === null ? "n/a" : cond}`
        + `  v1(entry/exit/risk)=${v1.entryRules}/${v1.exitRules}/${v1.riskRules}`
        + `  datasetVersionId=${String(entry.datasetVersionId)}`,
    );
  }

  console.log("=== 逐策略结论 ===");
  for (const line of summaryLines) console.log(`  ${line}`);

  const withDef = Object.values(report).filter(
    (v) => asRec(v).hasDefinition === true,
  ).length;
  const withoutDef = Object.values(report).filter(
    (v) => asRec(v).hasDefinition === false,
  ).length;
  console.log(
    `\n汇总：有 definition ${withDef} 个 / 无 definition ${withoutDef} 个`,
  );

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n已写出 ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // 铁律：顶层 catch 必须摊开 cause 链，否则只剩「Failed query」看不到根因。
    let cur: unknown = err;
    for (let depth = 0; depth < 6 && cur !== undefined && cur !== null; depth += 1) {
      const e = cur as Record<string, unknown>;
      console.error(
        `[depth ${depth}] ${String(e.constructor?.name ?? typeof cur)}`,
        JSON.stringify({
          message: e.message,
          code: e.code,
          errno: e.errno,
          sqlState: e.sqlState,
          sqlMessage: e.sqlMessage,
        }),
      );
      cur = e.cause;
    }
    process.exit(1);
  });
