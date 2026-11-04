/**
 * 模块测试文档生成器 —— `pnpm run docs:tests`
 *
 * 把 `tests/**` 的现状（文件 / 用例树 / 被测源码 / 标记）归集成 `docs/testing/**`，
 * 目录结构**镜像 `tests/`**，每个测试目录一份 `_index.md`。
 *
 * 纪律：
 * - 只读 `tests/**` 与源码路径存在性，不跑测试、不碰 DB；
 * - 生成物**禁手改**（改了会被下一次生成覆盖）；要改内容请改这里的模板；
 * - 新增测试后重跑本脚本，`docs/testing` 即同步。
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const TESTS_DIR = join(ROOT, "tests");
const OUT_DIR = join(ROOT, "docs", "testing");

/**
 * 当前全量跑**仍在失败**、但**不是**环境依赖的测试（基线成员，本轮按用户裁定不动）。
 * ⚠️ 这是**手工登记的现状**，不是自动判定：每次改测试或修 bug 后请复核本表并在 README 写明核验日期。
 */
const KNOWN_FAILING: Record<string, string> = {
  "tests/server/research/parameterSearch/parameterSearchEffectiveness.test.ts":
    "PARAMETER-002 §10(N-05)：期望旧派生器 `parameterSpaceFromDocument.ts` 头注释带 `LEGACY / PREVIEW` 标记，该文件当前没有（HEAD 现状，属 parameterSearch 在研区，本轮未处置）",
};

/** 未列入上表但**确实是环境依赖**的测试（真 MySQL / 真 Tushare 网络 / 真实证据文件）—— 离线不可能通过。
 *  登记依据见 `docs/testing/README.md` 的「环境依赖登记表」；新增请同时补依据。 */
const INTEGRATION_TESTS: Record<string, string> = {
  "tests/server/marketData.test.ts": "真实 MySQL（`server/db.ts` 的 upsert / 查询）",
  "tests/server/limitUp.test.ts": "真实 MySQL（自选板块落库 + 日统计）",
  "tests/server/limitUp.watch.test.ts": "真实 MySQL（`stockWatchlist` 读写）",
  "tests/server/image.uploadAndRecognize.test.ts": "真实 MySQL + 路由落库",
  "tests/server/tushare.secret.test.ts": "真实 Tushare 网络 + `TUSHARE_TOKEN`",
  "tests/server/tushareTradingCalendar.test.ts": "真实 Tushare 网络（交易日历，5s 超时）",
  "tests/server/dataHealth.test.ts": "真实证据文件 `docs/researchReadyGate/research_ready_gate.json`",
};

const ALIASES: Array<[string, string]> = [
  ["@/", "client/src/"],
  ["@shared/", "shared/"],
  ["@assets/", "attached_assets/"],
];

/**
 * 模块粒度：把测试目录**收口**到「源码模块」这一层，避免 `tests/server/research/**` 的
 * 28 个子目录各生成一份文档（文档爆炸）。规则与 `tests/` 的镜像布局同向：
 *   - `tests/server/<a>/…`      → `server/<a>`（`tests/server/*.test.ts` → `server`）
 *   - `tests/client/src/<a>/…`  → `client/src/<a>`
 *   - `tests/shared/…`          → `shared`
 */
function moduleOf(dirRel: string): string {
  if (dirRel === ".") return ".";
  const segs = dirRel.split("/");
  const cap = segs[0] === "client" ? 3 : 2;
  return segs.slice(0, cap).join("/");
}

type TestNode = { kind: "suite" | "test"; title: string; depth: number };

function calleePath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const left = calleePath(node.expression);
    return left ? [...left, node.name.text] : null;
  }
  if (ts.isCallExpression(node)) return calleePath(node.expression);
  return null;
}

function literalText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** 用 TS AST 抽取 describe / it 的嵌套树（精确，不靠正则猜括号深度）。 */
function parseTree(filePath: string, text: string): TestNode[] {
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out: TestNode[] = [];

  const visit = (node: ts.Node, depth: number) => {
    if (ts.isCallExpression(node)) {
      const path = calleePath(node.expression);
      const root = path?.[0];
      const title = literalText(node.arguments[0]);
      if (title && (root === "describe" || root === "it" || root === "test")) {
        const kind: "suite" | "test" = root === "describe" ? "suite" : "test";
        out.push({ kind, title, depth });
        for (const child of node.arguments) visit(child, depth + 1);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, depth));
  };

  visit(sf, 0);
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
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const SPEC_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

function readRepoFile(relPath: string): string {
  return readFileSync(join(ROOT, relPath.split("/").join(sep)), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.test\.tsx?$|\.spec\.ts$/.test(name)) out.push(p);
  }
  return out;
}

type Row = {
  rel: string;
  moduleDir: string;
  lines: number;
  cases: number;
  suites: number;
  hasEach: boolean;
  targets: string[];
  tree: TestNode[];
  integration: string | null;
  knownFail: string | null;
  textAssert: boolean;
};

// 生成物目录整体重建：保证「模块粒度调整 / 测试被删」后不残留旧文档。
if (!OUT_DIR.endsWith(join("docs", "testing"))) throw new Error(`拒绝清理非 docs/testing 目录：${OUT_DIR}`);
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const files = walk(TESTS_DIR).sort();
const rows: Row[] = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  const text = readFileSync(abs, "utf8");
  const moduleDir = moduleOf(relative(TESTS_DIR, dirname(abs)).split(sep).join("/") || ".");
  const tree = parseTree(abs, text);

  let m: RegExpExecArray | null;
  const specs = new Set<string>();
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) specs.add(m[1]);
  const targets: string[] = [];
  for (const spec of specs) {
    const r = resolveSpecifier(abs, spec);
    if (r) targets.push(relative(ROOT, r).split(sep).join("/"));
  }

  rows.push({
    rel,
    moduleDir,
    lines: text.split("\n").length,
    cases: tree.filter((t) => t.kind === "test").length,
    suites: tree.filter((t) => t.kind === "suite").length,
    hasEach: /\.each\s*[(<]/.test(text),
    targets: [...new Set(targets)],
    tree,
    integration: INTEGRATION_TESTS[rel] ?? null,
    knownFail: KNOWN_FAILING[rel] ?? null,
    textAssert: /readFileSync/.test(text) && /toContain\(|toMatch\(/.test(text),
  });
}

// ---------- 渲染 ----------

const EOL = "\n";
const generatedHeader = (what: string) =>
  [
    `<!-- 由 \`scripts/genTestDocs.mts\` 生成（\`pnpm run docs:tests\`），禁手改。 -->`,
    ``,
    `# ${what}`,
    ``,
  ].join(EOL);

function renderTree(tree: TestNode[]): string[] {
  const lines: string[] = [];
  for (const node of tree) {
    const indent = "  ".repeat(node.depth);
    lines.push(`${indent}- ${node.kind === "suite" ? "**" + node.title + "**" : node.title}`);
  }
  return lines;
}

const byModule = new Map<string, Row[]>();
for (const r of rows) {
  if (!byModule.has(r.moduleDir)) byModule.set(r.moduleDir, []);
  byModule.get(r.moduleDir)!.push(r);
}

const moduleDirs = [...byModule.keys()].sort();

function moduleDocPath(moduleDir: string): string {
  if (moduleDir === ".") return join(OUT_DIR, "_index.md");
  return join(OUT_DIR, ...moduleDir.split("/"), "_index.md");
}

function moduleSlug(moduleDir: string): string {
  return moduleDir === "." ? "tests 根" : `tests/${moduleDir}`;
}

const summary: Array<{ moduleDir: string; files: number; cases: number; integration: number; textAssert: number }> = [];

for (const moduleDir of moduleDirs) {
  const group = byModule.get(moduleDir)!.sort((a, b) => a.rel.localeCompare(b.rel));
  const totalCases = group.reduce((n, r) => n + r.cases, 0);
  const integrationCount = group.filter((r) => r.integration).length;
  const textAssertCount = group.filter((r) => r.textAssert).length;
  summary.push({ moduleDir, files: group.length, cases: totalCases, integration: integrationCount, textAssert: textAssertCount });

  const srcDirs = [...new Set(group.flatMap((r) => r.targets.map((t) => t.split("/").slice(0, -1).join("/"))))]
    .filter((d) => d.length > 0)
    .sort();

  const out: string[] = [];
  out.push(generatedHeader(`测试模块：${moduleSlug(moduleDir)}`));
  out.push(`- 测试文件 **${group.length}** 个 ｜ 用例声明 **${totalCases}** 个`);
  out.push(`- 涉及源码目录：${srcDirs.length ? srcDirs.map((d) => `\`${d}/\``).join(" · ") : "（无：本组测试不 import 源码，靠读文件或内联构造）"}`);
  out.push("");
  // vitest 的位置过滤是「路径子串匹配」，用目录而非 shell glob（`**` 在 bash 默认不递归）。
  const filterPath = moduleDir === "." ? "tests" : `tests/${moduleDir}`;

  out.push(`## 怎么跑`);
  out.push("");
  out.push("```bash");
  out.push(`pnpm exec vitest run ${filterPath}                   # 本模块（vitest 位置过滤 = 路径子串匹配）`);
  out.push(`pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）`);
  out.push(`pnpm run test:changed                                  # 只跑改动相关（日常推荐）`);
  out.push("```");
  out.push("");
  if (moduleDir === "server") {
    out.push("> ⚠️ 本组是**直接落在 `tests/server/` 直下**的散装测试，vitest 的路径过滤圈不出这一层");
    out.push("> （`tests/server` 会连带 `tests/server/**` 全部子模块）。要只跑本层，用上面的逐文件命令，或直接用 `test:changed`。");
    out.push("");
  }
  if (moduleDir === "client/src/components") {
    out.push("> ℹ️ 本组含 `components/research` / `components/strategy` / `components/datasetRegistry` 三个子目录，文档按文件全路径区分。");
    out.push("");
  }
  if (integrationCount > 0) {
    out.push(`> ⚠️ 本模块有 **${integrationCount}** 个环境依赖测试（真库 / 真网络 / 真证据文件），离线**必然失败**；`);
    out.push(`> 全量跑时它们会稳定出现在失败集合里，属**已知基线**，见 \`docs/testing/README.md\` 的登记表。`);
    out.push("");
  }
  if (textAssertCount > 0) {
    out.push(`> ℹ️ 本模块有 **${textAssertCount}** 个「源码文本断言」测试（\`readFileSync\` 源码 + 字符串匹配），`);
    out.push(`> 改个变量名就可能变红，且不验证行为；详见 \`docs/testing/README.md\` 的「测试分类」一节。`);
    out.push("");
  }
  out.push("## 逐文件");
  out.push("");

  for (const r of group) {
    out.push(`### \`${r.rel}\``);
    const flags: string[] = [];
    if (r.integration) flags.push("🔌 环境依赖");
    if (r.knownFail) flags.push("⛔ 基线失败");
    if (r.textAssert) flags.push("📄 源码文本断言");
    out.push(`- ${r.lines} 行 ｜ 用例声明 ${r.cases}${r.hasEach ? "（含 `.each` 展开）" : ""} ｜ describe ${r.suites}${flags.length ? ` ｜ ${flags.join(" ｜ ")}` : ""}`);
    if (r.integration) out.push(`- ⚠️ 外部依赖：${r.integration}`);
    if (r.knownFail) out.push(`- ⛔ 基线失败原因：${r.knownFail}`);
    if (r.targets.length) {
      out.push(`- 被测源码：${r.targets.map((t) => `\`${t}\``).join(" · ")}`);
    } else {
      out.push(`- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）`);
    }
    out.push(`- 单跑：\`pnpm exec vitest run ${r.rel}\``);
    if (r.tree.length) {
      out.push(`- 用例树：`);
      out.push(...renderTree(r.tree));
    }
    out.push("");
  }

  const p = moduleDocPath(moduleDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, out.join(EOL), "utf8");
}

// ---------- 总索引 ----------

const grandFiles = rows.length;
const grandCases = rows.reduce((n, r) => n + r.cases, 0);
const grandIntegration = rows.filter((r) => r.integration).length;
const grandTextAssert = rows.filter((r) => r.textAssert).length;
const grandKnownFail = rows.filter((r) => r.knownFail).length;

const readme: string[] = [];
readme.push(generatedHeader("测试资产总览（tests/ 与 docs/testing/ 的唯一索引）"));
readme.push(`全仓测试文件 **${grandFiles}** 个 ｜ 用例声明 **${grandCases}** 个 ｜ 模块 **${moduleDirs.length}** 个`);
readme.push(`其中：环境依赖（离线必失败）**${grandIntegration}** 个 ｜ 已知失效 **${grandKnownFail}** 个 ｜ 源码文本断言 **${grandTextAssert}** 个`);
readme.push("");
readme.push("> 本目录由 `pnpm run docs:tests` 生成，**禁手改**；改测试后重跑即同步。");
readme.push("");
readme.push("## 目录约定");
readme.push("");
readme.push("`docs/testing/**` **镜像 `tests/**`**：`tests/server/research/foo.test.ts` 的说明在 `docs/testing/server/research/_index.md`。");
readme.push("找不到就按测试文件的目录往下找，目录名一一对应。");
readme.push("");
readme.push("## 三条测试命令");
readme.push("");
readme.push("| 命令 | 范围 | 什么时候用 |");
readme.push("|---|---|---|");
readme.push("| `pnpm run test:changed` | **只跑与本次改动相关的测试** | 日常开发 / 每个任务收尾（**默认**） |");
readme.push("| `pnpm exec vitest run <文件或目录>` | 指定文件或模块 | 改某个模块时 |");
readme.push("| `pnpm test` | 全量 277 个文件 | 只在大版本验收 / 合并前跑一次 |");
readme.push("");
readme.push("🔴 **不要再「任务完成就跑全量」**——全量恒定 **" + (grandIntegration + grandKnownFail) + "** 个失败文件（" + grandIntegration + " 环境依赖 + " + grandKnownFail + " 已知失效），恒红，跑它只会让「基线零新增」退化成人工比对。日常请用 `test:changed`。");
readme.push("");
readme.push("## 测试分类");
readme.push("");
readme.push("### ① 单元测试（默认，离线稳定）");
readme.push("纯函数 / 内存实现 / 假 DB 注入，不依赖外部资源。这是 `pnpm test` 里应当全绿的部分。");
readme.push("");
readme.push("### ② 🔌 环境依赖测试（离线**必然失败**，登记为基线）");
readme.push("");
readme.push("| 测试文件 | 外部依赖 |");
readme.push("|---|---|");
for (const [f, why] of Object.entries(INTEGRATION_TESTS)) readme.push(`| \`${f}\` | ${why} |`);
readme.push("");
readme.push("处置口径（2026-09-19 用户裁定）：**保持现状**，不删除、不改期望、不加 skip；");
readme.push("只在本文档登记，跑全量时把它们从「失败」里剔除后再判「基线零新增」。");
readme.push("");
readme.push("### 📌 当前全量基线（核验：2026-09-19 20:36）");
readme.push("");
readme.push("`pnpm test` 实测 = **277 文件 → 8 failed / 269 passed**；**4597 用例 → 17 failed / 4580 passed**（耗时 47s）。");
readme.push("");
readme.push(`失败文件 **${grandIntegration + grandKnownFail}** 个 = 上表 **${grandIntegration}** 个环境依赖 + 下表 **${grandKnownFail}** 个已知失效：`);
readme.push("");
readme.push("| 测试文件 | 失败原因 |");
readme.push("|---|---|");
for (const [f, why] of Object.entries(KNOWN_FAILING)) readme.push(`| \`${f}\` | ${why} |`);
readme.push("");
readme.push("🔴 **判据 = 失败文件集合，不是案数**（案数会 ±1 抖动）。");
readme.push("同日把 `tests/server/researchCore/candidates.updateBoundary.test.ts` **移出了失败集**（源码按 RESEARCH-PLANNER-001 给 `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` 加了 `sourceResearchPlanId`，期望已同步，该文件 15/15 通过）；");
readme.push("同期 parameterSearch 的提交**新增**了上表这条。两件事都要按集合增减来读，不要只看「还是 8」。");
readme.push("");
readme.push("### ③ 📄 源码文本断言测试（接线哨兵）");
readme.push("");
readme.push("这些文件用 `readFileSync` 读**仓库源码**，再用 `toContain` / `toMatch` 断言字符串，用来守「路由 / 入口 / 端点确实接上了」。");
readme.push("它们**不验证行为**、改个变量名或挪一行就会红。处置口径（同日用户裁定）：**保留**，但集中在本表管理，");
readme.push("改对应源码时优先用 `pnpm run test:changed` 把这一组一起跑掉。");
readme.push("");
readme.push("| 测试文件 |");
readme.push("|---|");
for (const r of rows.filter((x) => x.textAssert).sort((a, b) => a.rel.localeCompare(b.rel))) readme.push(`| \`${r.rel}\` |`);
readme.push("");
readme.push("## 模块索引");
readme.push("");
readme.push("| 模块 | 文档 | 测试文件 | 用例声明 | 环境依赖 | 文本断言 |");
readme.push("|---|---|---|---|---|---|");
for (const s of summary.sort((a, b) => a.moduleDir.localeCompare(b.moduleDir))) {
  const docRel = relative(OUT_DIR, moduleDocPath(s.moduleDir)).split(sep).join("/");
  const label = s.moduleDir === "." ? "`tests/` 根" : `\`${s.moduleDir}\``;
  readme.push(`| ${label} | [\`${docRel}\`](${docRel}) | ${s.files} | ${s.cases} | ${s.integration || "-"} | ${s.textAssert || "-"} |`);
}
readme.push("");
readme.push("## 布局铁律（改测试前必读）");
readme.push("");
readme.push("- **唯一坐标 = 仓库根 `tests/`**，镜像源码结构：`server/<a>/x.test.ts` → `tests/server/<a>/x.test.ts`；`client/src/**` → `tests/client/src/**`；`shared/**` → `tests/shared/**`。");
readme.push("- **禁再往源码目录写新测试**（会立刻破坏布局一致性）；`scripts/**` 仍是脚本验证区、不进 vitest。");
readme.push("- `vitest.config.ts#include` = `tests/**/*.test.ts` + `tests/**/*.test.tsx` + `tests/**/*.spec.ts`。");
readme.push("- 迁移 / 新增测试时必须处理 5 类「位置敏感」写法（相对 import、`import.meta.dirname` 基准、`import.meta.url` 派生基准、裸 `from \".\"`、`vi.mock` 说明符）；逐条细则见 `.workbuddy/memory/PROJECT_RULES.md` 的「测试文件布局」章。");
readme.push("");
readme.push("## 重新生成");
readme.push("");
readme.push("```bash");
readme.push("pnpm run docs:tests");
readme.push("```");
readme.push("");
readme.push("生成自仓库根目录。本文件只描述 `tests/**` 的现状，不含任何本机路径。");
readme.push("");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "README.md"), readme.join(EOL), "utf8");

console.log(`[genTestDocs] 模块 ${moduleDirs.length} 个｜测试文件 ${grandFiles} 个｜用例声明 ${grandCases} 个`);
console.log(`[genTestDocs] 环境依赖 ${grandIntegration} 个｜文本断言 ${grandTextAssert} 个`);
console.log(`[genTestDocs] 输出目录 ${OUT_DIR}`);
