/**
 * 前端验收（等价证据）：真实 TiDB 上的候选草图**结构化表单无损性**验证。
 *
 * 为什么这样验收：本机 `agent-browser` 不可用、仓库无 jsdom（PROJECT_RULES §前端），
 * 前端组件不能用渲染测试证明行为。等价且更强的证据 = 复用**组件真实使用的纯函数模块**
 * （`client/src/components/research/candidateForm.ts` / `candidateSketchForm.ts`，
 * 两者都是 React-free 纯函数），喂**真实 tRPC 取回来的真实候选**，断言：
 *
 *   1. 打开编辑、什么都不改 ⇒ 补丁构造器必须报「没有任何字段被修改」（**不产生假改动**）；
 *   2. 每个能被结构化解析的块，草稿 → JSON 的重建结果必须与原值**逐字节语义相等**
 *      （证明表单无损、不丢键、不擅自补默认）；
 *   3. 解析不了的块必须降级 `raw`，且 `raw` 块**永不进入补丁**；
 *   4. 改动一个字段 ⇒ 补丁只含该块，且键 ⊆ 后端白名单。
 *
 * 只读：本脚本不写任何表。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { appRouter } from "../../server/routers";
import {
  buildUpdateCandidatePatch,
  candidateEditOriginalOf,
  createDefaultEditForm,
} from "../../client/src/components/research/candidateForm";
import {
  canonicalSketchJson,
  sketchValuesEqual,
  toSketchDrafts,
  SKETCH_BLOCK_LABELS,
  type CandidateSketchDrafts,
} from "../../client/src/components/research/candidateSketchForm";

const SKETCH_KEYS = ["entryRule", "filterRule", "exitRule", "riskRule", "parameterSpace"] as const;
const WHITELIST = [...SKETCH_KEYS, "name", "description"];

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

const adminUser = {
  id: 1,
  openId: "verify-sketch-form",
  name: "verify-sketch-form",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: adminUser });

// ---------------------------------------------------------------------------
// 取真实候选（走详情页同一个 procedure）
// ---------------------------------------------------------------------------
section("0. 取真实候选（id 用裸 SQL 取，内容走详情页同一个 procedure）");

const conn = await mysql.createConnection(process.env.DATABASE_URL as string);
const [idRows] = await conn.query(
  "SELECT id, status, name FROM research_strategy_candidate ORDER BY id",
);
const candidates = idRows as Array<{ id: number; status: string; name: string }>;
console.log(
  `  库内候选 ${candidates.length} 条：${candidates.map((c) => `${c.id}(${c.status})`).join(", ") || "<无>"}`,
);
check("库内至少 1 条候选可用于验证", candidates.length > 0);

// 每块覆盖率统计（跨候选汇总）
const blockCoverage: Record<string, { structured: number; raw: number; empty: number }> = {
  entryRule: { structured: 0, raw: 0, empty: 0 },
  filterRule: { structured: 0, raw: 0, empty: 0 },
  exitRule: { structured: 0, raw: 0, empty: 0 },
  riskRule: { structured: 0, raw: 0, empty: 0 },
  parameterSpace: { structured: 0, raw: 0, empty: 0 },
};

for (const { id } of candidates) {
  const view = (await caller.research.strategyCandidate.get({ candidateId: id })) as {
    candidate: Record<string, unknown>;
  };
  // 详情页给对话框的就是 `detail.data.candidate`（`CandidateDetailBody raw` 那一份）。
  const c = view.candidate;
  section(`候选 ${id} — ${String(c.name)} (${String(c.status)})`);

  const original = candidateEditOriginalOf(c as never);
  const form = createDefaultEditForm(c as never);

  // ---- 1. 无损性：逐块重建 == 原值 ----
  const states = toSketchDrafts(c as never);
  const rawBlocks: string[] = [];
  for (const key of SKETCH_KEYS) {
    const state = states[key];
    const label = SKETCH_BLOCK_LABELS[key];
    if (state.kind === "empty") {
      blockCoverage[key].empty += 1;
      continue;
    }
    if (state.kind === "raw") {
      blockCoverage[key].raw += 1;
      rawBlocks.push(key);
      console.log(`  [${label}] 降级 raw —— ${state.reason}`);
      check(`  [${label}] raw 块不参与提交`, canonicalSketchJson(key, state) === undefined);
      continue;
    }
    blockCoverage[key].structured += 1;
    const rebuilt = canonicalSketchJson(key, state);
    const before = original.sketchJson[key] ?? null;
    const equal = sketchValuesEqual(before, rebuilt);
    check(
      `  [${label}] 草稿重建 == 原值（无损）`,
      equal,
      equal ? "" : `\n      before=${JSON.stringify(before)}\n      after =${JSON.stringify(rebuilt)}`,
    );
  }

  // ---- 2. 打开编辑什么都不改 ⇒ 不产生假改动 ----
  const noop = buildUpdateCandidatePatch(original, form);
  check(
    "打开编辑、什么都不改 ⇒ 不产生假改动",
    noop.ok === false && noop.errors.some((e) => e.includes("没有任何字段被修改")),
    noop.ok ? `误判改动: ${JSON.stringify(noop.patch)}` : noop.errors.join(" / "),
  );

  // ---- 3. 改一个字段 ⇒ 补丁只含该块 ----
  const editableKeys = SKETCH_KEYS.filter((k) => states[k].kind === "structured");
  let mutated: CandidateSketchDrafts | null = null;
  let target: (typeof SKETCH_KEYS)[number] = "riskRule";
  if (states.riskRule.kind === "structured") {
    const next = structuredClone(states.riskRule.draft) as { maxPositions: string };
    next.maxPositions = next.maxPositions === "3" ? "4" : "3";
    mutated = { ...states, riskRule: { kind: "structured", draft: next } } as CandidateSketchDrafts;
  } else if (states.parameterSpace.kind === "structured") {
    target = "parameterSpace";
    const next = structuredClone(states.parameterSpace.draft) as unknown as Array<Record<string, unknown>>;
    next.push({ code: "__e2e_probe__", type: "number", min: "1", max: "2", step: "", allowedValuesText: "" });
    mutated = { ...states, parameterSpace: { kind: "structured", draft: next } } as CandidateSketchDrafts;
  }

  if (mutated) {
    const res = buildUpdateCandidatePatch(original, { ...form, sketch: mutated });
    check(`改动 [${SKETCH_BLOCK_LABELS[target]}] ⇒ 补丁成功`, res.ok, res.ok ? "" : res.errors.join(" / "));
    if (res.ok) {
      const keys = Object.keys(res.patch);
      check(
        `补丁只含 [${SKETCH_BLOCK_LABELS[target]}]`,
        keys.length === 1 && keys[0] === target,
        `实际 keys=${JSON.stringify(keys)}`,
      );
      check("补丁键 ⊆ 后端白名单", keys.every((k) => WHITELIST.includes(k as never)));
    }
  } else {
    console.log(`  (跳过改动验证：没有可结构化的 riskRule / parameterSpace；可结构化的块 = ${editableKeys.join(", ") || "无"})`);
  }

  // ---- 4. name / description 白名单 ----
  const renamed = buildUpdateCandidatePatch(original, { ...form, name: `${form.name}__e2e` });
  check(
    "改名 ⇒ 补丁只有 name",
    renamed.ok && Object.keys(renamed.patch).length === 1 && "name" in renamed.patch,
    renamed.ok ? JSON.stringify(Object.keys(renamed.patch)) : renamed.errors.join(" / "),
  );

  console.log(`  小结：raw 块 = ${rawBlocks.length === 0 ? "无（五块全部可结构化编辑）" : rawBlocks.join(", ")}`);
}

await conn.end();

section("五块可结构化覆盖（跨全部候选）");
let structuredTotal = 0;
let rawTotal = 0;
for (const key of SKETCH_KEYS) {
  const c = blockCoverage[key];
  structuredTotal += c.structured;
  rawTotal += c.raw;
  console.log(
    `  ${SKETCH_BLOCK_LABELS[key].padEnd(6, " ")} 可结构化 ${c.structured} / 降级 raw ${c.raw} / 空 ${c.empty}`,
  );
}
check("没有任何块被降级为只读 raw（表单能表达库内全部真实形态）", rawTotal === 0, `raw 次数=${rawTotal}`);

console.log(`\n=== 汇总：${checks - failures}/${checks} 通过，失败 ${failures} ===`);
process.exit(failures ? 1 : 0);
