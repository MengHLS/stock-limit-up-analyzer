/**
 * 取证（**只读**）— BRIDGE-CONDITION-EXPRESSION-001：条件「算术右值」被静默降级成字符串常量。
 *
 * 背景：Promote 的转换器 `definitionBuild#resolveConditionValueType` 旧实现把无法判定的右值
 * **一律降级成 `CONSTANT`**，于是 `"prefix.rd0.volume * 0.3"` 这种算术表达式被原样写成一个
 * **字符串常量** —— 数值字段与字符串比较（语义无意义），且与配方门槛（`volumeRatio <= max_volume_ratio`）
 * 口径不一致：**声明说 A、执行做 B**。2026-09-16 已改为**响亮失败**。
 *
 * 本探针在真库上做**前后取证**（不写任何表；无 INSERT / UPDATE / DELETE）：
 *
 *   §1 「前」= 历史残留（已落库的真相）
 *      `strategy_versions.strategyDocumentJson.definition.entry.conditions` 里
 *      `valueType = CONSTANT` 的条目**原样列出**（原始证据，不做判断）；
 *      其中形如算术表达式的，另用**复刻判据**单独标出（该判据仅用于盘点，权威判定见 §2 重放，
 *      见下方 `looksLikeExpressionAttempt` 注释）。
 *
 *   §2 「后」= 修正生效（**重放**，用真转换器）
 *      把真库里每条候选的 `filterRuleJson` **原样**喂给**真转换器** `buildStrategyDefinition`，
 *      其余字段用已知良好脚手架补齐（避免被无关缺项挡住）：
 *        - 产出成功 ⇒ 逐条打印 `field / operator / value / valueType`（`valueType` 可判定）；
 *        - 响亮失败 ⇒ 打印领域码 + 路径（证明「不再静默降级」）。
 *
 *   §3 对齐不变量（真数据上复核）
 *      已转正策略里 `bar.<x>` 形式的声明字段，`<x>` 必须属于配方 `PULLBACK_FEATURE_IDS`
 *      （否则「执行有、声明表达不了」的漂移会再次发生）。
 *
 * 退出码恒为 0（除非连不上库）—— 本探针是**盘点**，不是闸门。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { buildStrategyDefinition } from "../../server/research/strategyCandidate/definitionBuild";
import { STRATEGY_BAR_FIELDS, STRATEGY_CURRENT_BAR_FIELDS } from "../../server/research/strategySchema/definition";
import { PULLBACK_FEATURE_IDS, PULLBACK_PARAMETER_IDS } from "../../server/research/recipeRegistry";

const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/**
 * 「看起来像算术表达式尝试」的**复刻判据** —— 与 `definitionBuild#expressionAttemptOf` 同两条规则：
 *   ① 以合法字段引用开头、但整串不是合法引用（有多余尾巴）—— 如 `prefix.rd0.volume * 0.3`；
 *   ② 串里**同时**出现字段引用与算术运算符 —— 如 `(1 - 0.05) * prefix.rd0.close`。
 *
 * ⚠️ 这里复刻是因为原函数是**内部诊断实现**（未导出）。它**只用于 §1 的盘点计数与标注**；
 * 任何「会不会被拒」的**权威结论一律来自 §2 的真转换器重放**，不依赖本函数。
 */
const FIELD_REFERENCE_LEADING_RE =
  /^(?:prefix\.rd-?\d+|post\.rd\d+|bar|event|path|outcome)\.[A-Za-z][A-Za-z0-9_]*/;
const FIELD_REFERENCE_TOKEN_RE =
  /(?:prefix\.rd-?\d+|post\.rd\d+|bar|event|path|outcome)\.[A-Za-z][A-Za-z0-9_]*/;
const ARITHMETIC_OPERATOR_RE = /[*+\/-]/;
function looksLikeExpressionAttempt(text: string): string | null {
  const trimmed = text.trim();
  const leading = FIELD_REFERENCE_LEADING_RE.exec(trimmed);
  if (leading !== null && leading[0].length < trimmed.length) return leading[0];
  if (ARITHMETIC_OPERATOR_RE.test(trimmed) && FIELD_REFERENCE_TOKEN_RE.test(trimmed)) {
    const token = FIELD_REFERENCE_TOKEN_RE.exec(trimmed);
    return token === null ? trimmed : token[0];
  }
  return null;
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown; } catch { return null; }
  }
  return value;
}

/**
 * 从错误里抠领域码。
 *
 * ⚠️ `StrategyCandidateError` 把码放在**属性** `code` 上（message 里**没有** `[CODE]` 前缀），
 * 因此先读属性，再退回「message 里带 `[CODE]`」的一般情形（tRPC 传输后的形态）。
 */
function domainCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code;
  const message = err instanceof Error ? err.message : String(err);
  const matched = /\[([A-Z_]{3,})\]/u.exec(message);
  return matched ? matched[1] : "(无领域码)";
}

/** 配方特征 id 序列（`PULLBACK_FEATURE_IDS` 是「语义键 → id」对象，取值即 id）。 */
const FEATURE_IDS: readonly string[] = Object.values(PULLBACK_FEATURE_IDS);
/** 配方参数 id 序列（同上）。 */
const PARAMETER_IDS: readonly string[] = Object.values(PULLBACK_PARAMETER_IDS);

// ---------------------------------------------------------------------------
section("0. 真实库存量与坐标");
// ---------------------------------------------------------------------------
const strategyRows = (await conn.query(
  "SELECT v.id AS versionId, v.strategyId, v.version, v.status AS versionStatus, "
  + "v.datasetVersionId, v.strategyDocumentJson AS doc, "
  + "(SELECT COUNT(*) FROM strategies s WHERE s.strategyId = v.strategyId) AS strategyCount "
  + "FROM strategy_versions v ORDER BY v.id",
))[0] as Array<{
  versionId: number; strategyId: string; version: string; versionStatus: string;
  datasetVersionId: number | null; doc: string; strategyCount: number;
}>;
const candidateRows = (await conn.query(
  "SELECT id, name, status, strategyDefinitionId, filterRuleJson, parameterSpaceJson "
  + "FROM research_strategy_candidate ORDER BY id",
))[0] as Array<{
  id: number; name: string; status: string; strategyDefinitionId: string | null;
  filterRuleJson: string | null; parameterSpaceJson: string | null;
}>;
console.log(`  strategy_versions 行数 = ${strategyRows.length}`);
console.log(`  research_strategy_candidate 行数 = ${candidateRows.length}`);
console.log(`  配方特征 ${FEATURE_IDS.join(" / ")}`);
console.log(`  配方参数 ${PARAMETER_IDS.join(" / ")}`);
console.log(`  bar.* 声明白名单 = ${STRATEGY_CURRENT_BAR_FIELDS.join(" / ")}`);

// ---------------------------------------------------------------------------
section("1. 「前」历史残留：已落库的 entry.conditions（原样列出）");
// ---------------------------------------------------------------------------
let persistedConditions = 0;
let persistedExpressionish = 0;
let persistedFieldRef = 0;
let persistedParamRef = 0;

for (const row of strategyRows) {
  const doc = parseJson(row.doc) as { definition?: { entry?: { conditions?: unknown[] } } } | null;
  const conditions = doc?.definition?.entry?.conditions;
  console.log(
    `\n  [versionId=${row.versionId}] ${row.strategyId}@${row.version} `
    + `status=${row.versionStatus} datasetVersionId=${String(row.datasetVersionId)} `
    + `conditions=${Array.isArray(conditions) ? conditions.length : 0}`,
  );
  if (!Array.isArray(conditions) || conditions.length === 0) {
    console.log("    （无 entry.conditions）");
    continue;
  }
  conditions.forEach((raw, index) => {
    const condition = raw as {
      field?: unknown; operator?: unknown; value?: unknown; valueType?: unknown;
    };
    persistedConditions += 1;
    if (condition.valueType === "FIELD_REFERENCE") persistedFieldRef += 1;
    if (condition.valueType === "PARAMETER_REFERENCE") persistedParamRef += 1;
    const expressed = typeof condition.value === "string"
      ? looksLikeExpressionAttempt(condition.value)
      : null;
    if (expressed !== null) persistedExpressionish += 1;
    const flag = expressed !== null ? "  <<< 形如算术表达式（已落库）" : "";
    console.log(
      `    #${index} ${String(condition.field)} ${String(condition.operator)} `
      + `${JSON.stringify(condition.value)} [valueType=${String(condition.valueType)}]${flag}`,
    );
    if (expressed !== null) {
      console.log(`         命中字段引用片段 = ${JSON.stringify(expressed)}`);
    }
  });
}
console.log(
  `\n  小结：条件总数=${persistedConditions}（FIELD_REFERENCE=${persistedFieldRef} / `
  + `PARAMETER_REFERENCE=${persistedParamRef} / CONSTANT=${persistedConditions - persistedFieldRef - persistedParamRef}）`,
);
console.log(`  其中「形如算术表达式」的历史残留 = ${persistedExpressionish} 条`);

// ---------------------------------------------------------------------------
section("2. 「后」修正生效：用**真转换器**重放真库草稿的 filterRule");
// ---------------------------------------------------------------------------
/**
 * 已知良好脚手架 —— 只补 `entryRule` / `exitRule` / `riskRule` 三段无关字段，
 * 让 `filterRule`（**待审对象**）成为唯一变量。脚手架内容与 `_e2e_research_strategy_bridge.mts`
 * 的 `HYPOTHESIS_SKETCH` 同源（= 真库里那条「首板回踩」假设），不含任何算术右值。
 */
const SCAFFOLD_ENTRY_RULE = {
  event: "FIRST_LIMIT_UP",
  timing: "NEXT_OPEN",
  extra: {
    observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
    trigger: "FIRST_VALID_DAY",
    eventParams: { limitUpRatio: 0.1 },
    execution: { quantityMethod: "TARGET_WEIGHT", lotSize: 100, slippageModel: "BPS", commissionModel: "BPS" },
    position: { sizingMethod: "EQUAL_WEIGHT" },
    document: {
      backtestConfig: { initialCapital: 100000 },
      costModel: {
        commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001,
        slippageBps: 10, lotSize: 100, minCommission: 5,
      },
    },
    recipe: {
      kind: "signalEngine",
      recipeId: "first-limit-pullback-hold-shrink",
      point: "close",
      signalFrequency: "daily",
      featureVersions: FEATURE_IDS.map((featureId) => ({ featureId, version: "1.0.0" })),
      rankingConfig: { higherIsBetter: true },
      selectionConfig: { method: { kind: "topN", n: 5 } },
      requiredData: ["OHLCV"],
    },
  },
} as const;
const SCAFFOLD_EXIT_RULE = { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 5 } as const;
const SCAFFOLD_RISK_RULE = { maxPositions: 5, maxPositionWeight: 0.2 } as const;
const SCAFFOLD_PARAMETER_SPACE = {
  max_volume_ratio: { type: "number", min: 0.05, max: 1, step: 0.05, defaultValue: 0.3 },
  max_drawdown: { type: "number", min: 0, max: 0.3, step: 0.01, defaultValue: 0.06 },
  require_bullish: { type: "number", min: 0, max: 1, step: 1, defaultValue: 1 },
} as const;
const EXECUTION_DATASET = {
  datasetVersionId: 390002,
  datasetVersionLabel: "v2",
  datasetCode: "first_limit_pullback",
} as const;

let replayOk = 0;
let replayRejected = 0;
let replayOtherError = 0;
/** 重放中被**响亮拒绝**的候选（= 修正后会被拦下的草稿）。 */
const loudlyRejected: Array<{ id: number; name: string; status: string }> = [];

for (const row of candidateRows) {
  const filterRule = parseJson(row.filterRuleJson);
  const parameterSpace = parseJson(row.parameterSpaceJson) ?? SCAFFOLD_PARAMETER_SPACE;
  const promoted = row.strategyDefinitionId !== null;
  console.log(
    `\n  [candidateId=${row.id}] "${row.name}" status=${row.status} `
    + `strategyDefinitionId=${String(row.strategyDefinitionId)}${promoted ? "（已转正）" : ""}`,
  );
  if (filterRule === null) {
    console.log("    （无 filterRuleJson，跳过重放）");
    continue;
  }
  try {
    const definition = buildStrategyDefinition({
      candidate: {
        entryRule: SCAFFOLD_ENTRY_RULE,
        filterRule,
        exitRule: SCAFFOLD_EXIT_RULE,
        riskRule: SCAFFOLD_RISK_RULE,
        parameterSpace,
      } as never,
      executionDataset: EXECUTION_DATASET,
    } as never);
    const conditions = (definition as unknown as {
      entry: { conditions: Array<{ field: string; operator: string; value: unknown; valueType: string }> };
    }).entry.conditions;
    replayOk += 1;
    console.log(`    重放结果 = 产出成功（${conditions.length} 条条件，valueType 均可判定）`);
    conditions.forEach((condition, index) => {
      console.log(
        `      #${index} ${condition.field} ${condition.operator} `
        + `${JSON.stringify(condition.value)} [valueType=${condition.valueType}]`,
      );
    });
  } catch (err) {
    const code = domainCodeOf(err);
    const message = err instanceof Error ? err.message : String(err);
    if (code === "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID") {
      replayRejected += 1;
      loudlyRejected.push({ id: row.id, name: row.name, status: row.status });
      console.log("    重放结果 = **响亮失败** STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID");
      console.log(`      路径/原因 = ${message.replace(/\s+/gu, " ").slice(0, 320)}`);
    } else {
      replayOtherError += 1;
      console.log(`    重放结果 = 其他失败 ${code}`);
      console.log(`      原因 = ${message.replace(/\s+/gu, " ").slice(0, 240)}`);
    }
  }
}
console.log(
  `\n  小结：重放成功=${replayOk} / 响亮拒绝(PROMOTE_SKETCH_INVALID)=${replayRejected} / 其他失败=${replayOtherError}`,
);
if (loudlyRejected.length > 0) {
  console.log("  被响亮拒绝的草稿（修正后的新增拦截面）：");
  loudlyRejected.forEach((item) => console.log(`    candidateId=${item.id} "${item.name}" status=${item.status}`));
}

// ---------------------------------------------------------------------------
section("3. 对齐不变量复核：派生声明 bar.<x> 与配方 featureIds 同名；原始列照旧合法");
// ---------------------------------------------------------------------------
const rawBarFields = new Set<string>(STRATEGY_BAR_FIELDS);
const derivedBarFields = new Set<string>(FEATURE_IDS);
const parameterSet = new Set<string>(PARAMETER_IDS);

/**
 * 不变量本身（在**真代码**上）—— 「执行有、声明表达不了」正是本次事故的根因，
 * 故配方每个门槛特征都必须能在 `bar.*` 上声明；否则本行非空即代表漂移再生。
 */
const undeclarable = FEATURE_IDS.filter((id) => !STRATEGY_CURRENT_BAR_FIELDS.includes(id));
console.log(
  `  不变量：配方 featureIds ⊆ bar.* 声明白名单 —— 不可声明者 = `
  + `${undeclarable.length === 0 ? "无（对齐）" : undeclarable.join(" / ")}`,
);

let declaredRaw = 0;
let declaredDerived = 0;
let driftedDeclarations = 0;
let driftedParams = 0;

for (const row of strategyRows) {
  const doc = parseJson(row.doc) as { definition?: { entry?: { conditions?: unknown[] } } } | null;
  const conditions = doc?.definition?.entry?.conditions;
  if (!Array.isArray(conditions)) continue;
  conditions.forEach((raw) => {
    const condition = raw as { field?: unknown; value?: unknown; valueType?: unknown };
    const field = typeof condition.field === "string" ? condition.field : "";
    const matched = /^bar\.([A-Za-z][A-Za-z0-9_]*)$/u.exec(field);
    if (matched === null) return;
    const name = matched[1];
    if (rawBarFields.has(name)) {
      declaredRaw += 1;
    } else if (derivedBarFields.has(name)) {
      declaredDerived += 1;
    } else {
      driftedDeclarations += 1;
      console.log(
        `  [versionId=${row.versionId}] 声明 bar.${name} —— 既不是原始 OHLCV 列、也不是配方 featureId（声明 ↔ 执行漂移）`,
      );
    }
    if (condition.valueType === "PARAMETER_REFERENCE" && typeof condition.value === "string"
      && !parameterSet.has(condition.value)) {
      driftedParams += 1;
      console.log(
        `  [versionId=${row.versionId}] 参数引用 ${JSON.stringify(condition.value)} —— 配方参数表里没有（漂移）`,
      );
    }
  });
}
const declaredTotal = declaredRaw + declaredDerived + driftedDeclarations;
console.log(
  `  已落库策略中 bar.<x> 声明 = ${declaredTotal} 条`
  + `（原始 OHLCV 列=${declaredRaw} / 配方派生字段=${declaredDerived} / 漂移=${driftedDeclarations}）`,
);
console.log(`  参数引用指向未声明的配方参数 = ${driftedParams} 条`);

console.log("\n== 取证完成（只读，未写任何表） ==");
await conn.end();
