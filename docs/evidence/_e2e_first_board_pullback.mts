/**
 * 前端验收（**真实库往返**）：目标策略「**T 日首板 → 观察 1–5 交易日 → 缩量回踩不破首板日开盘价 → 买入**」
 * 能否被**结构化草图表单**完整表达、真实落库、原样读回。
 *
 * 与 `_e2e_sketch_roundtrip.mts` 的分工：
 *   旧探针证明「一张一般性的五块草图能往返」；本探针证明**用户实际要的那条策略**能往返，
 *   并且产出的 `entry.conditions` 与仓库唯一的权威表达 **`FIRST_BOARD_PULLBACK_DEFINITION`
 *   （`server/research/strategySchema/goldenSample.ts`）逐字一致** —— 不是我自己编的口径。
 *
 * 三个层次（依次增强证据强度）：
 *   A. 表单层：`toSketchDrafts` 五块全部可结构化、无 raw 降级、缺口/错误/警告全空；
 *   B. 持久层：真实 tRPC `update` → `get` 读回，逐块相等 + 两条条件逐字相等；
 *   C. **转换层**：调用**真实**转正转换器 `buildStrategyDefinition`（纯函数、不查库），
 *      证明落库的草图真的会变成 golden sample 形状的 `entry.conditions`；
 *      并顺带给出后端缺陷的活证据 —— `OR` 被**静默压成 AND**（见末尾 §7 注释）。
 *
 * 复用组件真实使用的纯函数（`candidateForm.ts` / `candidateSketchForm.ts`，均 React-free），
 * 不另写一套口径（PROJECT_RULES §前端判据）。只碰自己新建的那一行候选；结束前删除并断言行数守恒。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import type { ResearchStrategyCandidate } from "../../server/researchCore";
import { appRouter } from "../../server/routers";
import {
  buildUpdateCandidatePatch,
  candidateEditOriginalOf,
  createDefaultEditForm,
} from "../../client/src/components/research/candidateForm";
import {
  canonicalSketchJson,
  conditionsUseNonConjunction,
  describeFilterGroups,
  SKETCH_BLOCK_HOME_SEGMENT,
  SKETCH_BLOCK_LABELS,
  sketchValuesEqual,
  summarizeSketchSegment,
  toSketchDrafts,
  validateSketchDrafts,
} from "../../client/src/components/research/candidateSketchForm";
import { buildStrategyDefinition } from "../../server/research/strategyCandidate/definitionBuild";
import { FIRST_BOARD_PULLBACK_DEFINITION } from "../../server/research/strategySchema/goldenSample";

const SKETCH_KEYS = ["entryRule", "filterRule", "exitRule", "riskRule", "parameterSpace"] as const;
const PROBE_NAME = "__e2e_first_board_pullback__";

let failures = 0;
let checks = 0;
function check(label: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// 目标：仓库唯一一份「首板回踩」权威表达里那两条买入条件
// ---------------------------------------------------------------------------
/**
 * golden sample 的两条条件 —— **Strategy 侧字面量**（运算符是**长名** `GREATER_THAN_OR_EQUAL`）。
 * 从权威 fixture 里取字面量，不复制语义。
 */
const GOLDEN_CONDITIONS = FIRST_BOARD_PULLBACK_DEFINITION.entry.conditions as ReadonlyArray<{
  field: string;
  operator: string;
  value: string;
  valueType: string;
}>;

/**
 * Research 侧**符号**运算符 → Strategy 侧**长名** —— 与
 * `definitionBuild.ts#CONDITION_OPERATOR_MAP` 同表。
 *
 * 🔴 这层映射是真缺口：**表单里填的是符号**（`>=`，与 `ResearchConditionSet` 同形），
 * 而 `StrategyDefinition.entry.conditions.operator` 用的是长名。二者靠这张表对齐，
 * 所以本探针**两层各断言一次**：落库层比符号、转换层比长名 —— 顺带把这张表锁住。
 */
const OPERATOR_SYMBOL_TO_LONG: Readonly<Record<string, string>> = {
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  IN: "IN",
  NOT_IN: "NOT_IN",
};

/** 用户在表单里实际会填的形状：**符号**运算符（= `ResearchConditionSet` 的字面量）。 */
const SKETCH_CONDITIONS = [
  { field: "bar.low", operator: ">=", value: "prefix.rd0.open" },
  { field: "bar.volume", operator: "<", value: "prefix.rd0.volume" },
] as const;

/**
 * 一份**能被表单完整表达**的「首板回踩」草图。
 *
 * `filterRule` 这一段是本探针的重点：
 *   `bar.low >= prefix.rd0.open`  —— 回踩当日最低价不低于首板日开盘价
 *   `bar.volume < prefix.rd0.volume` —— 回踩当日缩量
 * 两条都是「满足才买」（`entry.conditions`），**不是**「剔除条件」。
 */
const TARGET_SKETCH: Record<string, unknown> = {
  entryRule: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    extra: {
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      trigger: "FIRST_VALID_DAY",
      // 事件参数键名服务端**不做白名单**，原样透传；这里用 golden sample 的 limitUpRatio。
      eventParams: { limitUpRatio: 0.1 },
      execution: {
        quantityMethod: "FIXED_SHARES",
        lotSize: 100,
        slippageModel: "BPS",
        executionConstraints: ["no_open_limit_up", "skip_suspended"],
      },
      // ⚠️ 不写 position.maxSinglePosition：它与 riskRule.maxPositionWeight 声明同一事实，
      //    转换器会以「重复声明，只能二选一」明确拒绝（唯一权威是 riskRule）。
      position: { sizingMethod: "EQUAL_WEIGHT" },
      risk: { stopLoss: 0.05, maxDrawdown: 0.2, extensions: { maxBoardHeight: 3 } },
      document: {
        backtestConfig: { initialCapital: 1000000, maxPositions: 10 },
        costModel: {
          commissionRate: 0.0003,
          stampDutyRate: 0.001,
          transferFeeRate: 0.00001,
          slippageBps: 5,
          lotSize: 100,
          minCommission: 5,
        },
      },
    },
  },
  filterRule: {
    groups: [
      {
        groupNo: 0,
        groupLogicalOperator: "AND",
        conditions: SKETCH_CONDITIONS.map((condition, index) => ({
          groupNo: 0,
          sortOrder: index,
          fieldName: condition.field,
          operator: condition.operator,
          value: condition.value,
          logicalOperator: "AND",
          groupLogicalOperator: "AND",
        })),
      },
    ],
  },
  exitRule: { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 3 },
  riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
  parameterSpace: {
    pullbackWindow: { type: "number", min: 1, max: 10, step: 1 },
    holdingDays: { type: "number", min: 1, max: 20, step: 1 },
  },
};

/** 把草图五块包成一个「能喂给真实转换器」的候选对象（转换器只读这五个字段 + id）。 */
function asCandidate(sketch: Record<string, unknown>): ResearchStrategyCandidate {
  return { id: 0, ...sketch } as unknown as ResearchStrategyCandidate;
}

/** 真实执行数据集绑定（本探针只验证转换，不落 Strategy 表 ⇒ 用占位值即可）。 */
const EXEC_DATASET = {
  datasetVersionId: 1,
  datasetVersionLabel: "v1",
  datasetCode: "first_limit_pullback",
} as const;

const adminUser = {
  id: 1,
  openId: "verify-first-board-pullback",
  name: "verify-first-board-pullback",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });
const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

async function candidateCount(): Promise<number> {
  const [rows] = await conn.query("SELECT COUNT(*) n FROM research_strategy_candidate");
  return Number((rows as Array<{ n: number }>)[0]?.n ?? -1);
}

// ---------------------------------------------------------------------------
section("0. 前置（先清掉上一次失败留下的同名探针行）");

const leftover = await conn.query("DELETE FROM research_strategy_candidate WHERE name = ?", [PROBE_NAME]);
console.log(`  预清理：删除同名残留 ${(leftover[0] as { affectedRows?: number }).affectedRows ?? 0} 行`);

const beforeCount = await candidateCount();
console.log(`  前置：候选行数 = ${beforeCount}`);

const [row] = await conn.query(
  "SELECT c.id FROM research_conclusion c LEFT JOIN research_strategy_candidate k ON k.conclusionId = c.id "
    + "WHERE c.status IN ('DRAFT','FINAL') AND k.id IS NULL ORDER BY c.id DESC LIMIT 1",
);
const conclusionId = Number((row as Array<{ id: number }>)[0]?.id ?? 0);
check("找到可用结论", conclusionId > 0, `conclusionId=${conclusionId}`);

let probeId = 0;
try {
  // ---- 1. 真实登记 ----
  section("1. createFromConclusion（真实写）");
  const created = (await caller.research.strategyCandidate.createFromConclusion({
    conclusionId,
    name: PROBE_NAME,
    description: "首板回踩 端到端往返验收（自建自清）",
  })) as { candidate?: { id?: number } };
  probeId = Number(created.candidate?.id ?? 0);
  check("登记成功并拿到 id", probeId > 0, `id=${probeId}`);

  const fresh = (await caller.research.strategyCandidate.get({ candidateId: probeId })) as {
    candidate: Record<string, unknown>;
  };
  check("新候选五块均为空", SKETCH_KEYS.every((k) => (fresh.candidate[k] ?? null) === null));

  // ---- 2. 表单层：目标草图 → 结构化草稿 ----
  section("2. 目标草图（首板回踩）→ 结构化草稿");
  const states = toSketchDrafts(TARGET_SKETCH);
  const rawBlocks = SKETCH_KEYS.filter((k) => states[k].kind === "raw");
  check(
    "五块全部可结构化（无 raw 降级）",
    rawBlocks.length === 0,
    rawBlocks.map((k) => `${SKETCH_BLOCK_LABELS[k]}:${(states[k] as { reason: string }).reason}`).join(" | "),
  );
  check(
    "草稿重建 == 目标（表单无损）",
    SKETCH_KEYS.every((k) => sketchValuesEqual(canonicalSketchJson(k, states[k]), TARGET_SKETCH[k])),
  );
  const validation = validateSketchDrafts(states);
  check("转正缺口为空（表单填满即满足 promote 必填）", validation.gaps.length === 0, validation.gaps.join(" / "));
  check("无校验错误", validation.errors.length === 0, validation.errors.join(" / "));
  check("🔴 无警告（两条条件都是「且」，转正不会改变语义）", validation.warnings.length === 0,
    validation.warnings.join(" / "));

  // ---- 3. 语义与文案：这一段到底问的是「满足才买」还是「剔除」 ----
  section("3. 段归属 / 标签 / 人话（语义方向核对）");
  check(
    "`filterRule` 的中文标签是「买入条件」而不是「剔除条件」",
    SKETCH_BLOCK_LABELS.filterRule === "买入条件",
    SKETCH_BLOCK_LABELS.filterRule,
  );
  check(
    "`filterRule` 的归属段是 `when`（什么价买），不是 `what`（买什么）",
    SKETCH_BLOCK_HOME_SEGMENT.filterRule === "when",
    SKETCH_BLOCK_HOME_SEGMENT.filterRule,
  );
  if (states.filterRule.kind !== "structured") throw new Error("filterRule 未结构化，终止");
  const humanText = describeFilterGroups(states.filterRule.draft);
  console.log(`  人话整句：${humanText}`);
  check("人话里出现「大于等于」（第一条）", humanText.includes("大于等于"));
  check("人话里出现「小于」（第二条）", humanText.includes("小于"));
  check("人话里出现首板日开盘价锚点", humanText.includes("事件日当天（rd0）的开盘价"));
  check("两条之间用「且」连接（不是「或」）", humanText.includes(" 且 ") && !humanText.includes(" 或 "));
  check("`when` 段摘要带上「买入条件：」前缀", summarizeSketchSegment(states, "when").includes("买入条件："),
    summarizeSketchSegment(states, "when"));
  check("`what` 段摘要**不再**出现条件（条件已归属 when）",
    !summarizeSketchSegment(states, "what").includes("买入条件"),
    summarizeSketchSegment(states, "what"));

  // ---- 4. 真实提交补丁 ----
  section("4. update（真实写，走组件同一条补丁路径）");
  const emptyOriginal = candidateEditOriginalOf(fresh.candidate as never);
  const patchResult = buildUpdateCandidatePatch(emptyOriginal, {
    ...createDefaultEditForm(fresh.candidate as never),
    sketch: states,
  });
  check("补丁构造成功", patchResult.ok, patchResult.ok ? "" : patchResult.errors.join(" / "));
  if (!patchResult.ok) throw new Error("补丁构造失败，终止");

  const patchKeys = Object.keys(patchResult.patch);
  console.log(`  补丁键：${JSON.stringify(patchKeys)}`);
  check(
    "补丁只含五块草图（空块不提交）",
    patchKeys.every((k) => (SKETCH_KEYS as readonly string[]).includes(k)),
  );

  const updated = (await caller.research.strategyCandidate.update({
    candidateId: probeId,
    patch: patchResult.patch,
  })) as { id?: number; candidate?: { id?: number } };
  check("update 被后端接受", Number(updated.id ?? updated.candidate?.id ?? 0) === probeId);

  // ---- 5. 真实读回 ----
  section("5. get（真实读回）→ 逐块比对 + 两条条件逐字比对");
  const back = (await caller.research.strategyCandidate.get({ candidateId: probeId })) as {
    candidate: Record<string, unknown>;
  };
  for (const key of SKETCH_KEYS) {
    const stored = back.candidate[key] ?? null;
    const ok = sketchValuesEqual(stored, TARGET_SKETCH[key]);
    check(
      `  [${SKETCH_BLOCK_LABELS[key]}] 落库值 == 目标值`,
      ok,
      ok ? "" : `\n      stored=${JSON.stringify(stored)}\n      target=${JSON.stringify(TARGET_SKETCH[key])}`,
    );
  }

  // 逐字比对：落库的两条条件 vs 表单里填的那两条（**符号**运算符 = ResearchConditionSet 字面量）
  const storedFilter = back.candidate.filterRule as
    | { groups: Array<{ conditions: Array<Record<string, unknown>> }> }
    | null;
  const storedConditions = storedFilter?.groups?.[0]?.conditions ?? [];
  check("落库条件数 == 2", storedConditions.length === 2, `实际 ${storedConditions.length}`);
  SKETCH_CONDITIONS.forEach((sketch, index) => {
    const stored = storedConditions[index] ?? {};
    const ok = stored.fieldName === sketch.field && stored.operator === sketch.operator && stored.value === sketch.value;
    check(
      `  条件 ${index + 1} 落库 == 表单填写（field/operator/value）`,
      ok,
      ok ? "" : `\n      stored = ${JSON.stringify({ fieldName: stored.fieldName, operator: stored.operator, value: stored.value })}`
        + `\n      sketch = ${JSON.stringify(sketch)}`,
    );
    const mapped = OPERATOR_SYMBOL_TO_LONG[sketch.operator] === GOLDEN_CONDITIONS[index]?.operator
      && sketch.field === GOLDEN_CONDITIONS[index]?.field
      && sketch.value === GOLDEN_CONDITIONS[index]?.value;
    check(
      `  条件 ${index + 1} 的符号运算符按映射表 == golden sample 的长名`,
      mapped,
      mapped ? "" : `${sketch.operator} → ${OPERATOR_SYMBOL_TO_LONG[sketch.operator]} / golden=${GOLDEN_CONDITIONS[index]?.operator}`,
    );
  });

  const reopened = toSketchDrafts(back.candidate);
  check(
    "读回后五块仍全部可结构化",
    SKETCH_KEYS.every((k) => reopened[k].kind === "structured"),
    SKETCH_KEYS.filter((k) => reopened[k].kind !== "structured")
      .map((k) => `${SKETCH_BLOCK_LABELS[k]}=${reopened[k].kind}`)
      .join(", "),
  );
  check(
    "读回 → 草稿 → JSON 幂等（再打开编辑不会产生改动）",
    SKETCH_KEYS.every((k) => sketchValuesEqual(canonicalSketchJson(k, reopened[k]), TARGET_SKETCH[k])),
  );

  const noop = buildUpdateCandidatePatch(
    candidateEditOriginalOf(back.candidate as never),
    createDefaultEditForm(back.candidate as never),
  );
  check(
    "打开编辑、什么都不改 ⇒ 不产生假改动",
    noop.ok === false && noop.errors.some((e) => e.includes("没有任何字段被修改")),
    noop.ok ? `误判改动 ${JSON.stringify(noop.patch)}` : noop.errors.join(" / "),
  );

  // ---- 6. 只改一个块 ----
  section("6. 只改一块 ⇒ 补丁只含该块（真实往返）");
  const onlyRisk = {
    ...reopened,
    riskRule: { kind: "structured", draft: { maxPositions: "4", maxPositionWeight: "0.25" } },
  } as typeof reopened;
  const onePatch = buildUpdateCandidatePatch(candidateEditOriginalOf(back.candidate as never), {
    ...createDefaultEditForm(back.candidate as never),
    sketch: onlyRisk,
  });
  check("单块补丁构造成功", onePatch.ok, onePatch.ok ? "" : onePatch.errors.join(" / "));
  if (onePatch.ok) {
    const keys = Object.keys(onePatch.patch);
    check("补丁只含 riskRule", keys.length === 1 && keys[0] === "riskRule", JSON.stringify(keys));
    await caller.research.strategyCandidate.update({ candidateId: probeId, patch: onePatch.patch });
    const after = (await caller.research.strategyCandidate.get({ candidateId: probeId })) as {
      candidate: Record<string, unknown>;
    };
    check(
      "riskRule 落库为新值",
      sketchValuesEqual(after.candidate.riskRule, { maxPositions: 4, maxPositionWeight: 0.25 }),
      JSON.stringify(after.candidate.riskRule),
    );
    check(
      "其余四块**未被触碰**（仍是目标值）",
      (["entryRule", "filterRule", "exitRule", "parameterSpace"] as const).every((k) =>
        sketchValuesEqual(after.candidate[k] ?? null, TARGET_SKETCH[k]),
      ),
    );
  }
  // ---- 7. 转换层：真实转正转换器（纯函数、不查库、无副作用）----
  section("7. 真实转换器 buildStrategyDefinition：草图 → entry.conditions");
  const andDefinition = buildStrategyDefinition({
    candidate: asCandidate(TARGET_SKETCH),
    executionDataset: EXEC_DATASET,
  });
  const builtConditions = andDefinition.entry.conditions as ReadonlyArray<{
    field: string;
    operator: string;
    value: unknown;
    valueType: string;
  }>;
  console.log(`  产出条件：${JSON.stringify(builtConditions)}`);
  check("转换器产出 2 条条件", builtConditions.length === 2, `实际 ${builtConditions.length}`);
  GOLDEN_CONDITIONS.forEach((golden, index) => {
    const built = builtConditions[index] ?? ({} as (typeof builtConditions)[number]);
    const ok = built.field === golden.field
      && built.operator === golden.operator
      && built.value === golden.value
      && built.valueType === golden.valueType;
    check(
      `  条件 ${index + 1} 与服务端 golden sample 逐字一致（field/operator/value/valueType）`,
      ok,
      ok ? "" : `\n      built   = ${JSON.stringify(built)}\n      golden  = ${JSON.stringify(golden)}`,
    );
  });
  check(
    "观察窗口 1–5 交易日原样带出",
    andDefinition.entry.observationWindow.start === 1 && andDefinition.entry.observationWindow.end === 5,
    JSON.stringify(andDefinition.entry.observationWindow),
  );
  check(
    "事件参数 limitUpRatio 原样透传（键名不受白名单限制）",
    sketchValuesEqual(andDefinition.entry.event.params, { limitUpRatio: 0.1 }),
    JSON.stringify(andDefinition.entry.event.params),
  );
  check(
    "触发时点 FIRST_VALID_DAY 原样带出",
    (andDefinition.entry.trigger as { type?: string }).type === "FIRST_VALID_DAY",
    JSON.stringify(andDefinition.entry.trigger),
  );

  /**
   * 🔴 后端缺陷的**活证据**（只证明、不改代码）。
   *
   * `buildConditions` 把所有条件组扁平化成 `ConditionDefinition[]`，而
   * `ConditionDefinition` **没有逻辑运算符字段** ⇒ 草稿里的 `OR` / `NOT` 会被**静默压成 AND**：
   * 不报错、不留痕迹，策略却被改成另一个意思。
   *
   * 这里构造一个「两条条件用『或』连接」的草稿，前端已能识别并给出 warning；
   * 而真实转换器产出的 conditions 与全「且」版本**逐字节相同** —— 这就是「静默」二字的证据。
   */
  section("7b. 🔴 OR 静默压成 AND 的证据（后端缺陷，仅证明不修）");
  const orSketch = JSON.parse(JSON.stringify(TARGET_SKETCH)) as Record<string, unknown>;
  const orGroups = (orSketch.filterRule as { groups: Array<{ conditions: Array<Record<string, unknown>> }> }).groups;
  orGroups[0].conditions[1].logicalOperator = "OR";

  const orStates = toSketchDrafts(orSketch);
  check(
    "前端能识别出「或」（`conditionsUseNonConjunction`）",
    orStates.filterRule.kind === "structured" && conditionsUseNonConjunction(orStates.filterRule.draft),
  );
  const orValidation = validateSketchDrafts(orStates);
  check("「或」只产生 warning，不产生 error（保存与转正都不会被拦）", orValidation.warnings.length > 0 && orValidation.errors.length === 0,
    `warnings=${orValidation.warnings.length} errors=${orValidation.errors.length}`);
  console.log(`  警告原文：${orValidation.warnings[0] ?? "(无)"}`);

  const orDefinition = buildStrategyDefinition({
    candidate: asCandidate(orSketch),
    executionDataset: EXEC_DATASET,
  });
  check(
    "🔴 真实转换器对「或」**不报错**（静默）",
    true,
    "未抛 PROMOTE_SKETCH_INVALID / INCOMPLETE",
  );
  check(
    "🔴 「或」版本与「且」版本产出的 conditions **逐字节相同** ⇒ 语义被静默改变",
    JSON.stringify(orDefinition.entry.conditions) === JSON.stringify(andDefinition.entry.conditions),
    JSON.stringify(orDefinition.entry.conditions),
  );
} finally {
  // ---- 8. 自清 + 守恒 ----
  section("8. 自清与守恒");
  if (probeId > 0) {
    await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [probeId]);
  }
  await conn.query("DELETE FROM research_strategy_candidate WHERE name = ?", [PROBE_NAME]);
  const residual = await conn.query(
    "SELECT id FROM research_strategy_candidate WHERE name = ?",
    [PROBE_NAME],
  );
  check("探针候选已删除", (residual[0] as unknown[]).length === 0);
  const afterCount = await candidateCount();
  check("候选行数守恒", afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`);
  await conn.end();
}

console.log(`\n=== 汇总：${checks - failures}/${checks} 通过，失败 ${failures} ===`);
process.exit(failures ? 1 : 0);
