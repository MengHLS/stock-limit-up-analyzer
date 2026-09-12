/**
 * 候选 UI ↔ 后端 API 契约测试（静态扫源码，不需要浏览器 / jsdom）。
 *
 * 为什么需要它：本机 `agent-browser` 不可用、仓库也没有 `jsdom` / `@testing-library`
 * ⇒ 「UI 真的调了哪个端点」无法靠渲染测试证明。退而求其次且**更强**的做法是
 * 「扫真实源码里出现的 procedure 路径 + 用真实 `appRouter` 断言它们存在」：
 *   - 端点名写错、调用一个不存在的 procedure → 本测试直接失败；
 *   - 前端偷偷出现第二个 Candidate → Strategy 转换入口（例如自己拼 StrategyDefinition、
 *     或在候选 UI 里直接调 `strategy.create`）→ 本测试直接失败；
 *   - `promote` 被**转正弹窗以外**的文件调用（＝出现第二处转换入口）→ 本测试直接失败；
 *   - 溯源读取必须是**只读**（不存在 `update/delete/setProvenance` 端点）。
 *
 * 扫描纪律：只认**真实调用写法** `trpc.research.strategyCandidate.<x>`。
 * 只在注释 / 文档里提到某个端点名**不算调用** —— 否则「把禁令写进注释」反而会让测试误报。
 *
 * ⚠️ 这是**静态契约**而非行为测试：它证明「连得上」，不证明「渲染长什么样」。
 * 行为证据由 `scripts/verifyResearch00641Promote.mts`（真实 TiDB 全链）与
 * `strategyCandidateAdapter.test.ts` / `candidateForm.test.ts` / `promoteForm.test.ts`（纯函数）承担。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "../../../../server/routers";

const CLIENT_SRC = path.resolve(import.meta.dirname, "../..");

/**
 * 真实发起候选 API 调用的文件（出现 `trpc.research.strategyCandidate.*`）。
 * 006.4.1-B 新增两项：转正弹窗（`promote`）与溯源只读区（`getVersionProvenance`）。
 */
const CANDIDATE_CALL_SITE_FILES = [
  "components/research/CandidateLifecycleActions.tsx",
  "components/research/CreateCandidateDialog.tsx",
  "components/research/EditCandidateDialog.tsx",
  "components/research/PromoteCandidateDialog.tsx",
  "components/research/StrategyResearchProvenancePanel.tsx",
  "pages/research/StrategyCandidateDetail.tsx",
] as const;

/**
 * 候选 UI 相关文件全集（含只做编排 / 展示 / 纯函数的）：
 *   - `ConclusionPanel.tsx` 只嵌入 `CreateCandidateDialog`（自身不发候选请求）；
 *   - `CandidatesPanel.tsx` 用实验维度的既有只读端点 `researchEngine.listCandidates`；
 *   - `promoteForm.ts` / `candidateForm.ts` / 适配层是纯函数模块，不发请求；
 *   - `pages/StrategyEditor.tsx` 只**渲染**溯源区（请求由面板组件发出），故不算调用点。
 * 「禁止词汇」与「不得直写 Strategy」扫描用这份全集。
 */
const CANDIDATE_UI_FILES = [
  ...CANDIDATE_CALL_SITE_FILES,
  "components/research/CandidatesPanel.tsx",
  "components/research/CandidateSketchCard.tsx",
  "components/research/CandidateSketchFields.tsx",
  "components/research/ConclusionPanel.tsx",
  "components/research/candidateForm.ts",
  "components/research/candidateSketchForm.ts",
  "components/research/candidateSketchVocabulary.ts",
  "components/research/candidateSketchCostPreset.ts",
  "components/research/promoteForm.ts",
  "adapters/strategyCandidateAdapter.ts",
] as const;

/** 🔴 唯一允许出现 `promote` 调用的文件（＝唯一 Candidate → Strategy 入口）。 */
const PROMOTE_CALL_SITE_FILES = ["components/research/PromoteCandidateDialog.tsx"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 扫全前端（排除测试文件），收集 `trpc.research.strategyCandidate.<name>` **真实调用**。 */
function collectCandidateCallSites(): Array<{ rel: string; procedure: string }> {
  const sites: Array<{ rel: string; procedure: string }> = [];
  for (const file of walk(CLIENT_SRC)) {
    if (file.includes(".test.")) continue;
    const source = readFileSync(file, "utf8");
    const re = /trpc\s*\.\s*research\s*\.\s*strategyCandidate\s*\.\s*([A-Za-z]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      sites.push({
        rel: path.relative(CLIENT_SRC, file).split(path.sep).join("/"),
        procedure: `research.strategyCandidate.${match[1]!}`,
      });
    }
  }
  return sites;
}

const PROCEDURES = Object.keys(appRouter._def.procedures);
const CANDIDATE_PROCEDURES = PROCEDURES.filter((p) => p.startsWith("research.strategyCandidate."));

describe("候选 / 转正 UI ↔ 后端端点契约", () => {
  it("1) 前端调用的每个候选端点都真实存在（端点名写错会当场失败）", () => {
    const sites = collectCandidateCallSites();
    expect(sites.length).toBeGreaterThan(0);
    const unknown = sites.filter((s) => !PROCEDURES.includes(s.procedure));
    expect(unknown).toEqual([]);
  });

  it("2) 调用点全部落在声明的文件内（没有鬼祟的第二处调用）", () => {
    const files = [...new Set(collectCandidateCallSites().map((s) => s.rel))].sort();
    expect(files).toEqual([...CANDIDATE_CALL_SITE_FILES].sort());
  });

  it("3) 后端共开放 6 个候选端点：4 个候选能力 + 唯一 promote + 只读溯源", () => {
    expect([...CANDIDATE_PROCEDURES].sort()).toEqual([
      "research.strategyCandidate.createFromConclusion",
      "research.strategyCandidate.get",
      "research.strategyCandidate.getVersionProvenance",
      "research.strategyCandidate.promote",
      "research.strategyCandidate.transition",
      "research.strategyCandidate.update",
    ]);
  });

  it("4) 转正以外不存在任何「转换 / 克隆 / 发布 / 继承」端点（防第二套转换逻辑）", () => {
    const suspicious = CANDIDATE_PROCEDURES.filter((p) =>
      /convert|publish|inherit|clone|materialize|draft/i.test(p),
    );
    expect(suspicious).toEqual([]);
  });

  it("5) 🔴 promote 只被**唯一一个**文件调用（转正弹窗）—— 不存在第二处转换入口", () => {
    const files = [
      ...new Set(
        collectCandidateCallSites()
          .filter((s) => s.procedure === "research.strategyCandidate.promote")
          .map((s) => s.rel),
      ),
    ].sort();
    expect(files).toEqual([...PROMOTE_CALL_SITE_FILES].sort());
  });

  it("6) 溯源读取是**只读**的：不存在 update / delete / setProvenance 端点", () => {
    const mutating = CANDIDATE_PROCEDURES.filter((p) =>
      /provenance/i.test(p) && !/getVersionProvenance$/i.test(p),
    );
    expect(mutating).toEqual([]);
    // 且确实存在那一个只读端点（防「把只读端点删了、这一条却恒真」）。
    expect(CANDIDATE_PROCEDURES).toContain("research.strategyCandidate.getVersionProvenance");
  });

  it("7) 候选 UI 不直接写 Strategy（不给「绕过候选桥」留后门）", () => {
    const offenders: string[] = [];
    for (const rel of CANDIDATE_UI_FILES) {
      const source = readFileSync(path.join(CLIENT_SRC, rel), "utf8");
      if (/trpc\s*\.\s*research\s*\.\s*strategy\s*\.\s*(create|save|createVersion|cloneVersion)\b/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("8) 禁止词汇：候选 / 转正 UI 不出现 researchDataset / rd-* 当坐标 / strategy_drafts / 第二套定义列", () => {
    const offenders: string[] = [];
    for (const rel of CANDIDATE_UI_FILES) {
      const source = readFileSync(path.join(CLIENT_SRC, rel), "utf8");
      for (const token of ["researchDataset", "strategy_drafts", "candidate_definition_json"]) {
        if (source.includes(token)) offenders.push(`${rel} → ${token}`);
      }
      // `rd-*` 只允许作为「Registry label 长这样」的说明出现；这里禁止把它当坐标使用。
      if (/datasetId\s*===?\s*["'`]rd-/.test(source)) offenders.push(`${rel} → 把 rd-* 当坐标比对`);
    }
    expect(offenders).toEqual([]);
  });

  it("9) 转正提交体不得携带 StrategyDefinition（前端永远不构造定义）", () => {
    const offenders: string[] = [];
    for (const rel of CANDIDATE_UI_FILES) {
      const source = readFileSync(path.join(CLIENT_SRC, rel), "utf8");
      // 真实构造入参才会出现这些键；注释里提到不算（只匹配对象字面量键写法）。
      for (const key of ["strategyDefinition", "strategyDocumentJson"]) {
        if (new RegExp(`\\b${key}\\s*:`, "u").test(source)) offenders.push(`${rel} → ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
