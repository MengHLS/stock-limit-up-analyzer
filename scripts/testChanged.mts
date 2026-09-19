/**
 * 增量测试入口 —— `pnpm run test:changed`
 *
 * 意图（事项 rFCOuv 第 3 条）：**不要再「每个任务完成就跑全量」**。
 * 本脚本从 git 工作区找出改动文件，经**反向依赖图**推出受影响的测试文件，只跑这些。
 *
 * 用法：
 *   pnpm run test:changed                # 比对工作区未提交改动（含未跟踪文件）
 *   pnpm run test:changed -- --base HEAD~1
 *   pnpm run test:changed -- --list      # 只列出会跑哪些，不执行（全量回退路径只报数量）
 *   pnpm run test:changed -- --all       # 强制全量
 *   pnpm run test:changed -- --seed server/foo.ts --list   # 验依赖图（绕过 git，调试用）
 *
 * 回退规则（任一命中即全量，避免漏测）：
 *   - `vitest.config.ts` / `tsconfig.json` / `package.json` / `pnpm-lock.yaml` 变更
 *   - 拿不到 git（未安装 / 不在 PATH）
 *   - 受影响测试数 ≥ 全量的 `FULL_RUN_RATIO`
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const TESTS_DIR = join(ROOT, "tests");
const VITEST_BIN = join(ROOT, "node_modules", "vitest", "vitest.mjs");

/** 这些文件一改就全量：它们影响所有测试的编译/收集。 */
const GLOBAL_TRIGGERS = new Set([
  "vitest.config.ts",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.ts",
]);

/** 受影响测试占比达到该值就直接全量（增量已无意义）。 */
const FULL_RUN_RATIO = 0.6;

/** 纳入依赖图的源码根（测试文件也在其中，便于「改测试 → 跑该测试」）。 */
const GRAPH_ROOTS = ["server", "client/src", "shared", "drizzle", "tests"];

const ALIASES: Array<[string, string]> = [
  ["@/", "client/src/"],
  ["@shared/", "shared/"],
  ["@assets/", "attached_assets/"],
];

const CODE_EXT = /\.(ts|tsx|mts|mjs|js|json)$/;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
/** 可重复的 `--seed <仓库相对路径>`：绕过 git，直接验依赖图（调试用）。 */
const seeds: string[] = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--seed" && i + 1 < argv.length) seeds.push(argv[i + 1].split(sep).join("/"));
}

function toRel(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}
function toAbs(rel: string): string {
  return join(ROOT, rel.split("/").join(sep));
}
function isTestFile(rel: string): boolean {
  return rel.startsWith("tests/") && /\.(test|spec)\.tsx?$/.test(rel);
}

function git(args: string[]): { ok: boolean; lines: string[] } {
  const bin = process.env.GIT_BIN ?? "git";
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: "utf8" });
  if (r.error || r.status !== 0) return { ok: false, lines: [] };
  return { ok: true, lines: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) };
}

function walkFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (CODE_EXT.test(name)) out.push(p);
  }
  return out;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else {
    for (const [alias, target] of ALIASES) {
      if (spec === alias.slice(0, -1) || spec.startsWith(alias)) {
        base = join(ROOT, target, spec.slice(alias.length));
        break;
      }
    }
  }
  if (!base) return null;
  const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

// ---------- 1) 改动文件 ----------

const allTests = walkFiles(TESTS_DIR).map(toRel).filter(isTestFile).sort();
const baselineAll = [...allTests];

function changedFiles(): { files: string[]; source: string } {
  const base = opt("--base");
  const diffArgs = base ? ["diff", "--name-only", "--diff-filter=ACMR", base] : ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];
  const tracked = git([...diffArgs, "--", "."]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (!tracked.ok && !untracked.ok) return { files: [], source: "git-unavailable" };
  // 已暂存但相对 HEAD 的新增文件已含在 diff HEAD 里；psuh 场景再兜一层。
  const set = new Set<string>([...tracked.lines, ...untracked.lines]);
  return { files: [...set].sort(), source: base ? `diff vs ${base}` : "工作区 vs HEAD + 未跟踪" };
}

// ---------- 2) 反向依赖图 ----------

/** 取调用表达式最左侧标识符路径（`vi.mock` → ["vi","mock"]）。 */
function calleePath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const left = calleePath(node.expression);
    return left ? [...left, node.name.text] : null;
  }
  return null;
}

/**
 * 🔴 只收**运行时**依赖，剔除纯类型引用。
 *
 * 依据：客户端全仓对 `server/**` 的引用都是 `import type { AppRouter }`（`client/src/lib/trpc.ts`
 * 等 10 处实测），若把类型边也算进去，任何一个 server 文件的改动都会把 `client/**` 全部拉成
 * 「受影响」，增量就退化成全量。vitest 走 esbuild 转译**不做类型检查**，类型边确实不影响用例结果。
 */
function runtimeSpecifiers(abs: string, text: string): string[] {
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const allNamedAreTypes =
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly);
      const typeOnly = clause?.isTypeOnly === true || (allNamedAreTypes && clause?.name === undefined);
      if (!typeOnly && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        out.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const path = calleePath(node.expression);
      const viMock = path?.[0] === "vi" && path?.[1] === "mock";
      const first = node.arguments[0];
      if ((dynamicImport || viMock) && first && ts.isStringLiteral(first)) out.push(first.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/**
 * 🔴 第二路依赖：**字符串里的仓库路径**。
 *
 * 本项目有 21 个「源码文本断言」测试（`readFileSync(resolve(root, "client/src/pages/Backtest.tsx"))`）
 * 靠**字符串路径**读源码，AST 的 import 边完全看不到它们 ⇒ 只走 import 边会漏测。
 * 这里扫所有字符串字面量，命中 `client|server|shared|drizzle|tests` 下的 `.ts/.tsx` 且文件真实存在才建边。
 */
const REPO_PATH_RE = /^(?:\.{1,2}\/)*((?:client|server|shared|drizzle|tests)\/[A-Za-z0-9_.\/-]+\.tsx?)$/;

function pathLiteralTargets(abs: string, text: string): string[] {
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const m = REPO_PATH_RE.exec(node.text.trim());
      if (m) {
        const tail = m[1].split("/").join(sep);
        const cands = [join(ROOT, tail), resolve(dirname(abs), tail)];
        for (const c of cands) {
          if (existsSync(c) && statSync(c).isFile()) {
            out.push(c);
            break;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const graphFiles = GRAPH_ROOTS.flatMap((r) => walkFiles(join(ROOT, r.split("/").join(sep))));

/** import 边（**可传递**）：`target` 被 `rel` 引用，改动 target 会连带影响 rel。 */
const dependents = new Map<string, Set<string>>();
/** reads 边（**只认直接命中**）：测试文件用字符串路径读源码，只对被读的那个文件本身敏感。 */
const readers = new Map<string, Set<string>>();
const testFilesSet = new Set(allTests);

function addEdge(map: Map<string, Set<string>>, target: string, from: string) {
  if (!map.has(target)) map.set(target, new Set());
  map.get(target)!.add(from);
}

for (const abs of graphFiles) {
  const rel = toRel(abs);
  if (!CODE_EXT.test(rel)) continue;
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const seen = new Set<string>();
  for (const spec of runtimeSpecifiers(abs, text)) {
    if (seen.has(spec)) continue;
    seen.add(spec);
    const target = resolveSpecifier(abs, spec);
    if (target) addEdge(dependents, toRel(target), rel);
  }

  // 字符串里的仓库路径：测试文件 → 「reads」（只直接命中）；非测试文件 → 视同 import（可传递）。
  for (const target of pathLiteralTargets(abs, text)) {
    const trel = toRel(target);
    if (testFilesSet.has(rel)) addEdge(readers, trel, rel);
    else addEdge(dependents, trel, rel);
  }
}

/** 从改动文件出发向上收集受影响测试（广度优先，带 visited 防环）。 */
function affectedTests(seeds: string[]): Set<string> {
  const found = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const s of seeds) {
    if (isTestFile(s) && existsSync(toAbs(s))) found.add(s);
    // reads 边：只对直接命中生效，不参与传递
    for (const r of readers.get(s) ?? []) if (existsSync(toAbs(r))) found.add(r);
    queue.push(s);
    visited.add(s);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const up of dependents.get(cur) ?? []) {
      if (visited.has(up)) continue;
      visited.add(up);
      if (testFilesSet.has(up) && existsSync(toAbs(up))) found.add(up);
      queue.push(up);
    }
  }
  return found;
}

// ---------- 3) 主流程 ----------

function runVitest(files: string[]): number {
  if (!existsSync(VITEST_BIN)) {
    console.error(`[test:changed] 找不到 vitest 入口：${VITEST_BIN}（请先 pnpm install）`);
    return 1;
  }
  const args = [VITEST_BIN, "run", ...files];
  console.log(`[test:changed] ${process.execPath} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  return r.status ?? 1;
}

/**
 * 🔴 「决定跑什么」的**每一条**分支都必须经此函数。
 *
 * `--list` 是 dry-run，不能只在最后一条分支生效 —— 否则 `--list` 一旦撞上
 * 「`--all` / 命中全局触发文件 / 拿不到 git / 受影响达阈值」四条**回退全量**路径，
 * 就会**真的跑全量**（2026-09-19 实测：`--list` 触发了 47s 全量，含真 MySQL / 真 Tushare / 真证据文件测试）。
 */
function runOrList(files: string[], reason: string): number {
  if (flag("--list")) {
    const n = files.length === 0 ? baselineAll.length : files.length;
    console.log(`[test:changed] --list：${reason} ⇒ 会跑 ${n} 个文件（**未执行**）`);
    for (const f of files) console.log(`  - ${f}`);
    return 0;
  }
  return runVitest(files);
}

if (flag("--all")) {
  console.log(`[test:changed] --all：跑全量 ${baselineAll.length} 个测试文件`);
  process.exit(runOrList([], "--all"));
}

const { files: changed, source } = seeds.length ? { files: seeds, source: "--seed（调试用，绕过 git）" } : changedFiles();

if (source === "git-unavailable") {
  console.warn("[test:changed] 拿不到 git（未安装或不在 PATH）⇒ 回退全量。可用 GIT_BIN 指定 git 绝对路径。");
  process.exit(runOrList([], "拿不到 git ⇒ 回退全量"));
}

if (changed.length === 0) {
  console.log(`[test:changed] 无改动（${source}）⇒ 不跑测试。`);
  process.exit(0);
}

const globals = changed.filter((f) => GLOBAL_TRIGGERS.has(f));
if (globals.length) {
  console.log(`[test:changed] 命中全局触发文件 ${globals.join(", ")} ⇒ 回退全量 ${baselineAll.length} 个`);
  process.exit(runOrList([], `命中全局触发文件 ${globals.join(", ")} ⇒ 回退全量`));
}

const relevant = changed.filter(
  (f) =>
    existsSync(toAbs(f)) &&
    (f.startsWith("server/") || f.startsWith("client/") || f.startsWith("shared/") || f.startsWith("drizzle/") || isTestFile(f)),
);

if (relevant.length === 0) {
  console.log(`[test:changed] 改动 ${changed.length} 个，但无一落在 server/ client/ shared/ drizzle/ tests/ ⇒ 不跑测试。`);
  console.log(`[test:changed] 改动清单：${changed.join(", ")}`);
  process.exit(0);
}

const affected = [...affectedTests(relevant)].sort();

console.log(`[test:changed] 比对口径：${source}`);
console.log(`[test:changed] 改动文件 ${relevant.length} 个：${relevant.join(", ")}`);

if (affected.length === 0) {
  console.log("[test:changed] 无测试文件依赖这些改动 ⇒ 不跑测试。（若改动是被测源码，请确认反向依赖图未漏边）");
  process.exit(0);
}

if (affected.length / baselineAll.length >= FULL_RUN_RATIO) {
  console.log(`[test:changed] 受影响测试 ${affected.length}/${baselineAll.length} 达阈值 ${FULL_RUN_RATIO} ⇒ 回退全量`);
  process.exit(runOrList([], `受影响 ${affected.length}/${baselineAll.length} 达阈值 ⇒ 回退全量`));
}

console.log(`[test:changed] 受影响测试 ${affected.length}/${baselineAll.length} 个：`);
for (const f of affected) console.log(`  - ${f}`);

if (flag("--list")) process.exit(0);
process.exit(runVitest(affected));
