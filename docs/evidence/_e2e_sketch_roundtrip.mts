/**
 * 前端验收（**真实库往返**）：候选草图「结构化表单 → 补丁 → 真实 tRPC → 真实 TiDB → 真实读回 → 草稿」
 * 的端到端一致性 —— 自建自清。
 *
 * 为什么需要它（而不是只靠单测）：
 *   单测证明的是「我自己的 fixture 能往返」。这里证明的是**另一件事**：
 *   结构化表单产出的 JSON 形状，**真实后端接受并原样落库、原样读回、表单能原样重建**。
 *   少了这一步，「表单能表达」就只是自说自话。
 *
 * 复用组件真实使用的纯函数（`candidateForm.ts` / `candidateSketchForm.ts`，均 React-free），
 * 不另写一套口径（PROJECT_RULES §前端判据）。
 *
 * 只碰自己新建的那一行候选；结束前删除并断言行数守恒。
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
  validateSketchDrafts,
  SKETCH_BLOCK_LABELS,
} from "../../client/src/components/research/candidateSketchForm";

const SKETCH_KEYS = ["entryRule", "filterRule", "exitRule", "riskRule", "parameterSpace"] as const;
const PROBE_NAME = "__e2e_sketch_roundtrip__";

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

/**
 * 一份**能被表单完整表达**的草图（与 `candidateSketchForm.test.ts` 的 `FULL_SKETCH` 同形）。
 * 之所以在探针里内联而不是 import 测试文件：测试文件顶层有 vitest 的 `describe`，
 * 运行时会炸；夹具是纯字面量，内联不复制任何「口径」。
 */
const TARGET_SKETCH: Record<string, unknown> = {
  entryRule: {
    event: "FIRST_LIMIT_UP",
    timing: "NEXT_OPEN",
    extra: {
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      trigger: "FIRST_VALID_DAY",
      eventParams: { eventCode: "FIRST_BOARD", minBoards: 1, strict: true },
      execution: {
        quantityMethod: "FIXED_SHARES",
        lotSize: 100,
        slippageModel: "BPS",
        executionConstraints: ["no_open_limit_up", "skip_suspended"],
      },
      position: { sizingMethod: "EQUAL_WEIGHT", maxSinglePosition: 0.2 },
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
        conditions: [
          {
            groupNo: 0,
            sortOrder: 0,
            fieldName: "prefix.rd0.close",
            operator: ">=",
            value: 5,
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
          {
            groupNo: 0,
            sortOrder: 1,
            fieldName: "event.turnover",
            operator: "NOT_IN",
            value: ["st", "delisted"],
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
          },
        ],
      },
    ],
  },
  exitRule: { stopLoss: 0.05, takeProfit: 0.1, holdingDays: 3 },
  riskRule: { maxPositions: 5, maxPositionWeight: 0.2 },
  parameterSpace: {
    turnoverLow: { type: "number", min: 5, max: 12, step: 1 },
    boardPool: { type: "string", allowedValues: ["main", "chinext"] },
  },
};

const adminUser = {
  id: 1,
  openId: "verify-sketch-roundtrip",
  name: "verify-sketch-roundtrip",
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
console.log(`  预清理：删除同名残留 ${(leftover[0] as { affectedRows?: number })?.affectedRows ?? 0} 行`);

const beforeCount = await candidateCount();
console.log(`  前置：候选行数 = ${beforeCount}`);

// 找一个「还没有候选」的可用结论（DRAFT / FINAL），避免撞唯一约束。
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
    description: "结构化草图往返验收（自建自清）",
  })) as { candidate?: { id?: number } };
  probeId = Number(created.candidate?.id ?? 0);
  check("登记成功并拿到 id", probeId > 0, `id=${probeId}`);

  const fresh = (await caller.research.strategyCandidate.get({ candidateId: probeId })) as {
    candidate: Record<string, unknown>;
  };
  check("新候选五块均为空", SKETCH_KEYS.every((k) => (fresh.candidate[k] ?? null) === null));

  // ---- 2. 表单表示目标草图 ----
  section("2. 目标草图 → 结构化草稿");
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
  check("转正缺口为空（表单填满即满足 promote 必填）", validateSketchDrafts(states).gaps.length === 0,
    validateSketchDrafts(states).gaps.join(" / "));
  check("无校验错误", validateSketchDrafts(states).errors.length === 0,
    validateSketchDrafts(states).errors.join(" / "));

  // ---- 3. 真实提交补丁 ----
  section("3. update（真实写，走组件同一条补丁路径）");
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
  check(
    "update 被后端接受",
    Number(updated.id ?? updated.candidate?.id ?? 0) === probeId,
  );

  // ---- 4. 真实读回 ----
  section("4. get（真实读回）→ 逐块比对");
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

  // ---- 5. 只改一个块 ----
  section("5. 只改一块 ⇒ 补丁只含该块（真实往返）");
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
} finally {
  // ---- 6. 自清 + 守恒 ----
  section("6. 自清与守恒");
  if (probeId > 0) {
    await conn.query("DELETE FROM research_strategy_candidate WHERE id = ?", [probeId]);
  }
  // 兜底：即使中途 id 没解析到，也按唯一探针名清干净。
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
