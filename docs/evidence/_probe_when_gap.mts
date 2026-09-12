/**
 * 验证探针：**零写入** —— 用真实候选行证明「永远还差一项」这个卡点已经说得清、且能填平。
 *
 * 不做任何 UPDATE / INSERT。三件事：
 *   ① 复算真实行的缺口，确认 `when` 那一项被**指名**（含机器可读落点 `anchors`）；
 *   ② 打印编辑器现在会渲染的「差哪一项」清单（顶部 + 段内 + 要套琥珀圈的输入框）；
 *   ③ 模拟用户选中「次一交易日开盘买入」：缺口归零、`buildUpdateCandidatePatch` 立刻产出
 *      一个**只含 entryRule** 的补丁 —— 也就是「保存」按钮此刻变成可点，且只写这一块。
 *
 * 复用组件真实使用的纯函数（`candidateSketchForm.ts` / `candidateForm.ts`），不另立口径。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import {
  sketchSegmentStatuses,
  toSketchDrafts,
  validateSketchDrafts,
  type CandidateSketchDrafts,
} from "../../client/src/components/research/candidateSketchForm";
import {
  buildUpdateCandidatePatch,
  candidateEditOriginalOf,
  createDefaultEditForm,
} from "../../client/src/components/research/candidateForm";

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

function parseJson(text: unknown): unknown {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 编辑器顶部横幅 + 段内清单 + 琥珀标记，在真实行上会长成什么样。 */
function describeEditorView(drafts: CandidateSketchDrafts): void {
  const { gapDetails } = validateSketchDrafts(drafts);
  const statuses = sketchSegmentStatuses(drafts);
  const total = gapDetails.length;
  if (total === 0) {
    console.log("  （横幅不出现：距离「可转正」没有缺口）");
    return;
  }
  console.log(`  ┌ 顶部横幅：距离「可转正」还差 ${total} 项（不影响保存；点一下跳到那一段）`);
  for (const status of statuses.filter((item) => item.gapCount > 0)) {
    console.log(`  │  ${status.title}：${status.gaps.map((item) => item.label).join("；")}`);
  }
  console.log("  └");
  for (const status of statuses.filter((item) => item.gapCount > 0)) {
    console.log(`  段【${status.title}】展开后首行 = 琥珀清单：`);
    status.gaps.forEach((item, index) => console.log(`     ${index + 1}. ${item.label}`));
    const anchors = [...new Set(status.gaps.flatMap((item) => item.anchors))];
    console.log(
      anchors.length === 0
        ? "     （整块级缺口，无单一输入框落点）"
        : `     → 套琥珀圈「必填未填」的输入框：${anchors.join("、")}`,
    );
  }
}

(async () => {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await connection.query(
    "SELECT id, name, description, status, entryRuleJson, filterRuleJson, exitRuleJson, riskRuleJson,"
      + " parameterSpaceJson FROM research_strategy_candidate ORDER BY id LIMIT 1",
  );
  await connection.end();

  const row = (rows as Array<Record<string, unknown>>)[0];
  if (row === undefined) {
    console.log("库里没有候选行，跳过。");
    return;
  }

  const candidate = {
    id: Number(row.id),
    name: String(row.name ?? ""),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    entryRule: parseJson(row.entryRuleJson),
    filterRule: parseJson(row.filterRuleJson),
    exitRule: parseJson(row.exitRuleJson),
    riskRule: parseJson(row.riskRuleJson),
    parameterSpace: parseJson(row.parameterSpaceJson),
  };

  section(`1. 真实候选 #${candidate.id} 的现状`);
  console.log(`  status=${row.status}  name=${JSON.stringify(candidate.name)}`);
  console.log(`  entryRule = ${JSON.stringify(candidate.entryRule)}`);
  const drafts = toSketchDrafts(candidate);
  const before = validateSketchDrafts(drafts);
  console.log(`  errors=${before.errors.length}  warnings=${before.warnings.length}  gaps=${before.gaps.length}`);
  check("内容合法（能保存）—— 所以卡点不是「填错了」", before.errors.length === 0 && before.warnings.length === 0);

  section("2. 缺口现在被指名到什么程度");
  describeEditorView(drafts);
  const whenBefore = sketchSegmentStatuses(drafts).find((status) => status.segment === "when");
  check("「什么价买」段恰好 1 项缺口", whenBefore?.gapCount === 1, `gapCount=${whenBefore?.gapCount}`);
  check(
    "该缺口带中文名字：入场时点",
    whenBefore?.gaps[0]?.label.includes("入场时点") === true,
    whenBefore?.gaps[0]?.label ?? "(无)",
  );
  check(
    "该缺口带机器可读落点 entryRule.timing（编辑器据此给那个下拉套琥珀圈）",
    whenBefore?.gaps[0]?.anchors.includes("entryRule.timing") === true,
    JSON.stringify(whenBefore?.gaps[0]?.anchors ?? []),
  );

  section("3. 模拟用户选中「次一交易日开盘买入」");
  if (drafts.entryRule.kind !== "structured") {
    console.log("  entryRule 不是可结构化状态，跳过。");
  } else {
    const filled: CandidateSketchDrafts = {
      ...drafts,
      entryRule: { kind: "structured", draft: { ...drafts.entryRule.draft, timing: "NEXT_OPEN" } },
    };
    const after = validateSketchDrafts(filled);
    check("缺口总数 1 → 0", after.gaps.length === 0, `gaps=${after.gaps.length}`);
    check("errors 仍为 0（新填的值合法）", after.errors.length === 0, after.errors.join("；"));
    check(
      "「什么价买」段徽标从「还差 1 项」变成「齐了」",
      sketchSegmentStatuses(filled).find((status) => status.segment === "when")?.gapCount === 0,
    );

    section("4. 保存按钮此刻的判定（纯函数，不写库）");
    const original = candidateEditOriginalOf(candidate);
    const form = { ...createDefaultEditForm(candidate), sketch: filled };
    const result = buildUpdateCandidatePatch(original, form);
    check("补丁可产出（「保存」按钮从 disabled 变为可点）", result.ok, result.ok ? "" : result.errors.join("；"));
    if (result.ok) {
      check(
        "补丁只含改动的那一块：entryRule",
        JSON.stringify(Object.keys(result.patch)) === JSON.stringify(["entryRule"]),
        Object.keys(result.patch).join("、"),
      );
      const patchEntry = result.patch.entryRule as Record<string, unknown> | undefined;
      check("补丁里的 entryRule.timing = NEXT_OPEN", patchEntry?.timing === "NEXT_OPEN", JSON.stringify(patchEntry?.timing));
      check(
        "补丁保留了原有 entryRule.extra（没有把窗口/触发/成本冲掉）",
        JSON.stringify(patchEntry?.extra) === JSON.stringify((candidate.entryRule as { extra?: unknown }).extra),
      );
    }

    // 幂等：什么都不改再点一次 ⇒ 拒绝空补丁（不会白写一次库）。
    const unchanged = buildUpdateCandidatePatch(candidateEditOriginalOf(candidate), {
      ...createDefaultEditForm(candidate),
      sketch: drafts,
    });
    check("不改任何东西 ⇒ 拒绝空补丁（零写入）", unchanged.ok === false && unchanged.errors[0]?.includes("没有任何字段被修改") === true);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(failures === 0 ? `全部通过：${checks}/${checks}` : `失败 ${failures} / ${checks}`);
  if (failures > 0) process.exit(1);
})().catch((error) => {
  console.error("ERR", error);
  process.exit(1);
});
