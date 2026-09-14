/**
 * 探针：**定义编辑器的新保存路径在真实库上是否真的可用**。
 * 零写入、只读（只调 `list` / `load`；装配层函数是纯函数，不落库）。
 *
 * 为什么要有它：
 *   本轮把策略详情页的规则编辑从「JSON 高级模式」换成了「定义七段表单」，
 *   并把提交路径改成 `viewModelToStrategy(vm, { definition, executionAssumptions })`
 *   —— 即**只送 definition，不送五个 v1 视图**（与 `patchToInput` / `cloneStrategyDocument`
 *   同纪律）。这件事对不对，不能靠读代码认定，因为组装层
 *   `assembleStrategyDocument → alignDefinitionViews` 的判据是「缺则补、冲突则响亮报错」：
 *     ① 传 definition 又传（哪怕一个）v1 视图 ⇒ `SCHEMA_DEFINITION_VIEW_CONFLICT`
 *     ② doc 级 `datasetVersion` / `datasetVersionId` 与 definition.datasets 的 PRIMARY 绑定
 *        不一致 ⇒ `..._DATASET_VERSION(_ID)_MISMATCH`
 *     ③ 有 definition 而 `executionAssumptions.backtestConfig` / `.costModel` 缺失 ⇒
 *        `..._EXECUTION_ASSUMPTIONS_REQUIRED`
 *   这三条都只在**组装**时才会响，所以必须拿真实库的文档真的跑一遍组装。
 *
 * 组装入口用 `createStrategyDocument`（公开导出，内部就是 `assembleStrategyDocument`）。
 * 它**不做**「有 definition 就丢掉视图」的兜底 ⇒ 正好可以分别模拟：
 *   - OLD（旧客户端口径）：视图 + 改过的 definition 一起送 ⇒ 应当**响亮失败**
 *   - NEW（本客户端口径）：只送 definition + 同步过坐标的绑定 ⇒ 应当**成功**
 * `createStrategyDocument` 是纯函数（不落库、不碰连接池），因此本探针全程只读。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_definition_editor_save.mts`
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createStrategyDocument } from "../../server/research/strategySchema/map";
import {
  backtestConfigFromDrafts,
  costModelFromDrafts,
  definitionToDrafts,
  draftsToDefinition,
  syncPrimaryDatasetBinding,
  uneditedKeysOf,
  validateDefinitionDrafts,
  withDocumentLevelDrafts,
} from "../../client/src/components/strategy/definitionDraft";
import { appRouter } from "../../server/routers";

const OUT = "docs/evidence/_probe_definition_editor_save.json";

const adminUser = {
  id: 1,
  openId: "probe-definition-editor-save",
  name: "probe-definition-editor-save",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });

const asRec = (v: unknown): Record<string, unknown> =>
  (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;

/** 键序无关的规范序列化 —— 否则「同一个对象」会因为键序不同而被判成不同。 */
function canon(value: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === "object") {
      const src = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = walk(src[key]);
      return out;
    }
    return x;
  };
  return JSON.stringify(walk(value));
}

/** 叶子级差异路径（把「往返哪里不一样」说到能直接定位）。 */
function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (canon(a) === canon(b)) return [];
  const bothAreRecords =
    a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b);
  if (bothAreRecords) {
    const keys = new Set([...Object.keys(asRec(a)), ...Object.keys(asRec(b))]);
    return [...keys].flatMap((key) => diffPaths(asRec(a)[key], asRec(b)[key], `${prefix}.${key}`));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, index) => diffPaths(item, b[index], `${prefix}[${index}]`));
  }
  return [`${prefix || "<root>"}: ${canon(a)} → ${canon(b)}`];
}

/** 只取文档级输入键 —— 形状与 `patchToInput` 一致，避免把 fingerprint 等书签键混进去。 */
const DOCUMENT_INPUT_KEYS = [
  "strategyId",
  "version",
  "name",
  "description",
  "universe",
  "datasetVersion",
  "datasetVersionId",
  "executionAssumptions",
  "recipe",
  "metadata",
] as const;

function documentInputFrom(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DOCUMENT_INPUT_KEYS) if (doc[key] !== undefined) out[key] = doc[key];
  return out;
}

/** 跑一次组装，返回「成功 + 派生视图」或「失败 + 错误码」。 */
function tryAssemble(input: Record<string, unknown>): {
  ok: boolean;
  code: string | null;
  message: string | null;
  derived: { entryRules: number; exitRules: number; riskRules: number; positionSizingKind: unknown } | null;
} {
  try {
    const doc = asRec(createStrategyDocument(input as never));
    return {
      ok: true,
      code: null,
      message: null,
      derived: {
        entryRules: Array.isArray(doc.entryRules) ? doc.entryRules.length : -1,
        exitRules: Array.isArray(doc.exitRules) ? doc.exitRules.length : -1,
        riskRules: Array.isArray(doc.riskRules) ? doc.riskRules.length : -1,
        positionSizingKind: asRec(doc.positionSizing).kind ?? null,
      },
    };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown; issues?: unknown };
    const issues = Array.isArray(e.issues) ? e.issues : [];
    const firstIssue = asRec(issues[0]);
    const issueCode = typeof firstIssue.code === "string" ? firstIssue.code : null;
    return {
      ok: false,
      code: issueCode ?? (typeof e.code === "string" ? e.code : null),
      message: String(e.message ?? err),
      derived: null,
    };
  }
}

interface Report {
  strategyId: string;
  version: string;
  kind: "definition" | "legacy";
  roundTripExact: boolean | null;
  roundTripDiffs: string[];
  assumptionsExact: boolean | null;
  executionModelDerived: { derived: unknown; original: unknown; exact: boolean; error?: string } | null;
  editorErrors: string[];
  editorWarnings: string[];
  editorGaps: string[];
  uneditedKeys: string[];
  bindingBefore: Record<string, unknown> | null;
  docLevelCoordinate: { datasetVersion: unknown; datasetVersionId: unknown };
  oldPath: ReturnType<typeof tryAssemble> | null;
  newPath: ReturnType<typeof tryAssemble> | null;
  datasetSwitchWithoutSync: ReturnType<typeof tryAssemble> | null;
  datasetSwitchWithSync: ReturnType<typeof tryAssemble> | null;
  datasetSwitchAllThree: ReturnType<typeof tryAssemble> | null;
  legacyStillSavesUnchanged: ReturnType<typeof tryAssemble> | null;
}

async function main() {
  const rows = await caller.research.strategy.list();
  console.log(`策略总数：${rows.length}\n`);

  const report: Report[] = [];

  for (const row of rows) {
    const strategyId = String(asRec(row).strategyId ?? "");
    if (strategyId === "") continue;

    const doc = asRec(await caller.research.strategy.load({ strategyId }));
    const hasDefinition = doc.definition !== undefined && doc.definition !== null;
    const base = documentInputFrom(doc);

    const entry: Report = {
      strategyId,
      version: String(doc.version ?? ""),
      kind: hasDefinition ? "definition" : "legacy",
      roundTripExact: null,
      roundTripDiffs: [],
      assumptionsExact: null,
      executionModelDerived: null,
      editorErrors: [],
      editorWarnings: [],
      editorGaps: [],
      uneditedKeys: [],
      bindingBefore: null,
      docLevelCoordinate: { datasetVersion: doc.datasetVersion, datasetVersionId: doc.datasetVersionId },
      oldPath: null,
      newPath: null,
      datasetSwitchWithoutSync: null,
      datasetSwitchWithSync: null,
      datasetSwitchAllThree: null,
      legacyStillSavesUnchanged: null,
    };

    if (!hasDefinition) {
      // 无 definition 的历史文档：编辑器**应当**拒绝编造一份（否则会凭空造出必填缺口 + 视图冲突）。
      const state = definitionToDrafts(doc.definition);
      entry.uneditedKeys = [`定义态=${state.kind}`];
      if (state.kind === "raw") entry.editorWarnings.push(state.reason);
      // 顺带证明：这份历史文档在「不动定义」的路径下仍然存得下（不要因为本轮改动伤了老路径）。
      entry.legacyStillSavesUnchanged = tryAssemble({
        ...base,
        entryRules: doc.entryRules,
        exitRules: doc.exitRules,
        riskRules: doc.riskRules,
        positionSizing: doc.positionSizing,
        parameters: doc.parameters,
      });
      report.push(entry);
      continue;
    }

    // ---- ① 编辑器读 + 往返 ----
    const state = withDocumentLevelDrafts(definitionToDrafts(doc.definition), doc.executionAssumptions);
    if (state.kind !== "structured") {
      entry.editorErrors.push(`编辑器把真实 definition 判成不可结构化：${state.reason}`);
      report.push(entry);
      continue;
    }

    const synced = syncPrimaryDatasetBinding(state.drafts, {
      datasetVersionId: typeof doc.datasetVersionId === "number" ? doc.datasetVersionId : null,
      datasetVersion: String(doc.datasetVersion ?? ""),
    });
    const rebuilt = draftsToDefinition(synced);
    const diffs = diffPaths(rebuilt, doc.definition);
    entry.roundTripExact = diffs.length === 0;
    entry.roundTripDiffs = diffs.slice(0, 12);

    const assumptions = {
      costModel: costModelFromDrafts(synced),
      backtestConfig: backtestConfigFromDrafts(synced),
    };
    /**
     * 成本 / 回测配置两块必须逐字往返。
     *
     * ⚠️ `executionModel` **故意不送**：`map.ts#alignDefinitionViews:188-198` 写明它是
     * **派生视图** —— 客户端不送 ⇒ 组装层从 `definition.execution` 的时序对派生；
     * 送了且与派生结果不符 ⇒ `SCHEMA_DEFINITION_EXECUTION_MODEL_MISMATCH`。
     * 所以「不送」不是丢数据，而是唯一正确姿势。这里不靠推理认定，而是**组装后回看**：
     * 见下面的 `executionModelDerivedExact`。
     */
    const assumptionDiffs = diffPaths(assumptions, {
      costModel: asRec(doc.executionAssumptions).costModel,
      backtestConfig: asRec(doc.executionAssumptions).backtestConfig,
    });
    entry.assumptionsExact = assumptionDiffs.length === 0;
    entry.roundTripDiffs.push(...assumptionDiffs.slice(0, 6).map((d) => `executionAssumptions${d}`));

    // ---- ② 编辑器对真实文档的校验输出（用户一打开就会看到的东西）----
    const validation = validateDefinitionDrafts(synced);
    entry.editorErrors = validation.errors;
    entry.editorWarnings = validation.warnings;
    entry.editorGaps = validation.gaps.map((g) => `${g.segment}:${g.label}`);
    entry.uneditedKeys = uneditedKeysOf(synced);
    const binding = (rebuilt.datasets as unknown[] | undefined)?.[0];
    entry.bindingBefore = asRec(binding);

    // ---- ③ 保存路径对照实验 ----
    // 扰动一处**视图能派生出来**的字段（保证 OLD 侧真的会冲突）。
    const perturbed = JSON.parse(canon(rebuilt)) as Record<string, unknown>;
    const position = asRec(perturbed.position);
    if (typeof position.maxPositions === "number") position.maxPositions += 1;
    else asRec(perturbed.execution).lotSize = 999;
    perturbed.position = position;

    entry.oldPath = tryAssemble({
      ...base,
      entryRules: doc.entryRules,
      exitRules: doc.exitRules,
      riskRules: doc.riskRules,
      positionSizing: doc.positionSizing,
      parameters: doc.parameters,
      definition: perturbed,
    });

    entry.newPath = tryAssemble({ ...base, definition: perturbed, executionAssumptions: assumptions });

    /**
     * 🔴 「省略 executionModel」必须**可证无损**：拿组装产出的文档回看，
     * 它的 `executionAssumptions.executionModel` 是否仍等于库里原值。
     * 这一条比「不送」本身重要 —— 它把「派生」从口头约定变成实测。
     */
    try {
      const assembled = asRec(createStrategyDocument({ ...base, definition: rebuilt, executionAssumptions: assumptions } as never));
      const derived = asRec(assembled.executionAssumptions).executionModel;
      const original = asRec(doc.executionAssumptions).executionModel;
      entry.executionModelDerived = { derived: derived ?? null, original: original ?? null, exact: canon(derived) === canon(original) };
    } catch (err) {
      entry.executionModelDerived = { derived: null, original: null, exact: false, error: String(err) };
    }

    // ---- ④ 「基础信息里换了数据集」这件事的两条路径 ----
    const nextCoordinate = {
      datasetVersionId: (typeof doc.datasetVersionId === "number" ? doc.datasetVersionId : 0) + 1,
      datasetVersion: `${String(doc.datasetVersion ?? "")}-probe-next`,
    };
    /**
     * ⚠️ 换数据集要同时动**三处**，缺一处都会被组装层拒：
     *   ① doc 级 `datasetVersion` / `datasetVersionId`
     *   ② `definition.datasets` 的 PRIMARY 绑定（本客户端由 `syncPrimaryDatasetBinding` 负责）
     *   ③ `universe.universeId`（= `research-dataset:<datasetVersion>`，由 `StrategyBasicInfo` 负责）
     * 第一组实验刻意**只动 ①②**，用来暴露 ③ 漏了会怎样。
     */
    // 不过同步函数：doc 级坐标变了，绑定行没变 ⇒ 应当报 MISMATCH（这正是用户从界面上看不出原因的坑）
    entry.datasetSwitchWithoutSync = tryAssemble({
      ...base,
      datasetVersion: nextCoordinate.datasetVersion,
      datasetVersionId: nextCoordinate.datasetVersionId,
      definition: rebuilt,
      executionAssumptions: assumptions,
    });
    // 过了同步函数：绑定行跟着坐标一起改 ⇒ 应当成功
    const switched = syncPrimaryDatasetBinding(synced, nextCoordinate);
    entry.datasetSwitchWithSync = tryAssemble({
      ...base,
      datasetVersion: nextCoordinate.datasetVersion,
      datasetVersionId: nextCoordinate.datasetVersionId,
      universe: { ...asRec(doc.universe), universeId: `research-dataset:${nextCoordinate.datasetVersion}` },
      definition: draftsToDefinition(switched),
      executionAssumptions: assumptions,
    });
    // 三处都动齐（含 universe）—— 与 `StrategyBasicInfo` 的真实行为一致，应当成功
    entry.datasetSwitchAllThree = tryAssemble({
      ...base,
      datasetVersion: nextCoordinate.datasetVersion,
      datasetVersionId: nextCoordinate.datasetVersionId,
      universe: { ...asRec(doc.universe), universeId: `research-dataset:${nextCoordinate.datasetVersion}` },
      definition: draftsToDefinition(switched),
      executionAssumptions: assumptions,
    });

    report.push(entry);
  }

  const defined = report.filter((r) => r.kind === "definition");
  const legacy = report.filter((r) => r.kind === "legacy");

  console.log("=== ① 往返保真（真实库文档 → 编辑器草稿 → definition）===");
  for (const r of defined) {
    const em = r.executionModelDerived;
    console.log(
      `  ${r.strategyId}@${r.version}  definition逐字往返=${r.roundTripExact ? "YES" : "NO"}`
        + `  成本/回测往返=${r.assumptionsExact ? "YES" : "NO"}`
        + `  executionModel(派生)=${em === null ? "n/a" : em.exact ? `YES(${String(em.derived)})` : "NO"}`,
    );
    for (const d of r.roundTripDiffs) console.log(`      · ${d}`);
  }

  console.log("\n=== ② 编辑器校验输出（用户打开就能看到的）===");
  for (const r of defined) {
    console.log(
      `  ${r.strategyId}  errors=${r.editorErrors.length}  warnings=${r.editorWarnings.length}  gaps=${r.editorGaps.length}`,
    );
    for (const e of r.editorErrors.slice(0, 3)) console.log(`      ✗ ${e}`);
    for (const g of r.editorGaps.slice(0, 3)) console.log(`      ○ ${g}`);
  }

  console.log("\n=== ③ 保存路径对照（旧口径 vs 本客户端口径）===");
  for (const r of defined) {
    console.log(
      `  ${r.strategyId}  OLD=${r.oldPath?.ok ? "通过(!)" : r.oldPath?.code}  NEW=${r.newPath?.ok ? "通过" : `失败(${r.newPath?.code})`}`,
    );
  }

  console.log("\n=== ④ 「基础信息换数据集」需要同时动三处 ===");
  for (const r of defined) {
    console.log(
      `  ${r.strategyId}`
        + `  只动doc级坐标=${r.datasetSwitchWithoutSync?.ok ? "通过(!)" : r.datasetSwitchWithoutSync?.code}`
        + `  再同步绑定行=${r.datasetSwitchWithSync?.ok ? "通过" : r.datasetSwitchWithSync?.code}`
        + `  三处齐(=含universe)=${r.datasetSwitchAllThree?.ok ? "通过" : r.datasetSwitchAllThree?.code}`,
    );
  }

  console.log("\n=== ⑤ 无 definition 的历史文档 ===");
  for (const r of legacy) {
    console.log(
      `  ${r.strategyId}@${r.version}  编辑态=${r.uneditedKeys[0]}  原样保存=${r.legacyStillSavesUnchanged?.ok ? "通过" : `失败(${r.legacyStillSavesUnchanged?.code})`}`,
    );
    for (const w of r.editorWarnings) console.log(`      · ${w}`);
  }

  const summary = {
    definedCount: defined.length,
    legacyCount: legacy.length,
    roundTripExactAll: defined.every((r) => r.roundTripExact === true),
    assumptionsExactAll: defined.every((r) => r.assumptionsExact === true),
    executionModelDerivedExactAll: defined.every((r) => r.executionModelDerived?.exact === true),
    newPathAllOk: defined.every((r) => r.newPath?.ok === true),
    oldPathAllConflict: defined.every((r) => r.oldPath?.ok !== true),
    oldPathCodes: [...new Set(defined.map((r) => r.oldPath?.code))],
    editorErrorsZeroAll: defined.every((r) => r.editorErrors.length === 0),
    datasetSwitchWithoutSyncAllFail: defined.every((r) => r.datasetSwitchWithoutSync?.ok !== true),
    datasetSwitchAllThreeAllOk: defined.every((r) => r.datasetSwitchAllThree?.ok === true),
    legacySameAsBeforeOk: legacy.every((r) => r.legacyStillSavesUnchanged?.ok === true),
  };

  console.log("\n=== 汇总 ===");
  console.log(JSON.stringify(summary, null, 2));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ summary, report }, null, 2), "utf8");
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
