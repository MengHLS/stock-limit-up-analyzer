/**
 * _probe_line_endings.mts — 全仓行尾实测（只读，不改任何文件）
 *
 * 用途：行尾是本项目反复踩的地雷（虚假 diff、断言方向写反、规则文件记载与磁盘不符）。
 * 本探针把「逐文件实测」自动化，输出可直接作为规则文件的判据来源。
 *
 * 运行（必须在项目根目录）：npx tsx docs/evidence/_probe_line_endings.mts
 * 输出：同目录 _probe_line_endings.out.txt（同步落盘，防异步 pipe 被截断）
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "_probe_line_endings.out.txt");

const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

/** 规则文件里被点名过的文件 —— 逐一核对记载是否与磁盘一致 */
const NAMED = [
  "ROADMAP.md",
  "ROADMAP-CHANGELOG.md",
  "README.MD",
  "drizzle/schema.ts",
  "client/src/App.tsx",
  "client/src/components/AppShell.tsx",
  "client/src/index.css",
  "vite.config.ts",
  "server/_core/index.ts",
  ".workbuddy/memory/PROJECT_RULES.md",
  ".workbuddy/memory/MEMORY.md",
];

type Kind = "PURE_CRLF" | "PURE_LF" | "MIXED" | "EMPTY";

function classify(buf: Buffer): Kind {
  if (buf.length === 0) return "EMPTY";
  const crlf = buf.toString("latin1").split("\r\n").length - 1;
  const lf = buf.toString("latin1").split("\n").length - 1;
  if (crlf === 0) return "PURE_LF";
  if (crlf === lf) return "PURE_CRLF";
  return "MIXED";
}

function counts(buf: Buffer) {
  return {
    crlf: buf.toString("latin1").split("\r\n").length - 1,
    lf: buf.toString("latin1").split("\n").length - 1,
  };
}

const tracked = execSync("git ls-files -z", { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter(Boolean);

const byDir = new Map<string, Map<Kind, number>>();
const crlfFiles: string[] = [];
const mixedFiles: string[] = [];
const tally: Record<Kind, number> = { PURE_CRLF: 0, PURE_LF: 0, MIXED: 0, EMPTY: 0 };

for (const f of tracked) {
  let buf: Buffer;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  const kind = classify(buf);
  tally[kind] += 1;
  const top = f.includes("/") ? f.split("/")[0] : "(repo root)";
  const m = byDir.get(top) ?? new Map<Kind, number>();
  m.set(kind, (m.get(kind) ?? 0) + 1);
  byDir.set(top, m);
  if (kind === "PURE_CRLF") crlfFiles.push(f);
  if (kind === "MIXED") {
    const c = counts(buf);
    mixedFiles.push(`${f} (crlf=${c.crlf} lf=${c.lf})`);
  }
}

say("=== 全仓行尾实测（工作区磁盘字节）===");
say(`tracked 文件总数 = ${tracked.length}`);
say(
  `PURE_LF=${tally.PURE_LF}  PURE_CRLF=${tally.PURE_CRLF}  MIXED=${tally.MIXED}  EMPTY=${tally.EMPTY}`,
);
say(`仓库本地 core.autocrlf = ${execSync("git config core.autocrlf", { encoding: "utf8" }).trim() || "(未设置)"}`);
say(`.gitattributes 是否存在 = ${(() => { try { readFileSync(".gitattributes"); return "存在"; } catch { return "不存在（无过滤器 ⇒ 工作区==blob）"; } })()}`);
say();

say(`--- 按顶层目录 ---`);
for (const [d, m] of [...byDir.entries()].sort((a, b) => {
  const s = (x: Map<Kind, number>) => [...x.values()].reduce((p, c) => p + c, 0);
  return s(b[1]) - s(a[1]);
})) {
  const parts = [...m.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
  say(`  ${d.padEnd(18)} ${parts}`);
}
say();

say(`--- PURE_CRLF 文件清单（共 ${crlfFiles.length} 个）---`);
for (const f of crlfFiles) {
  const c = counts(readFileSync(f));
  say(`  ✔ ${f}  (crlf=${c.crlf} lf=${c.lf})`);
}
say();

say(`--- MIXED 文件清单（共 ${mixedFiles.length} 个，应为 0）---`);
for (const f of mixedFiles) say(`  ⚠ ${f}`);
say();

say("--- 规则文件点名过的文件（记载 vs 磁盘）---");
const expected: Record<string, Kind> = {
  "ROADMAP.md": "PURE_LF",
  "ROADMAP-CHANGELOG.md": "PURE_LF",
  "README.MD": "PURE_LF",
  "drizzle/schema.ts": "PURE_LF",
  "client/src/App.tsx": "PURE_CRLF",
  "client/src/components/AppShell.tsx": "PURE_CRLF",
  "client/src/index.css": "PURE_LF",
  "vite.config.ts": "PURE_LF",
  "server/_core/index.ts": "PURE_LF",
  ".workbuddy/memory/PROJECT_RULES.md": "PURE_CRLF",
  ".workbuddy/memory/MEMORY.md": "PURE_LF",
};
let mismatch = 0;
for (const f of NAMED) {
  let buf: Buffer;
  try {
    buf = readFileSync(f);
  } catch {
    say(`  -  ${f.padEnd(44)} (不存在/未跟踪)`);
    continue;
  }
  const kind = classify(buf);
  const c = counts(buf);
  const exp = expected[f];
  const ok = exp === undefined || exp === kind;
  if (!ok) mismatch += 1;
  say(
    `  ${ok ? "✔" : "✘"} ${f.padEnd(44)} crlf=${String(c.crlf).padEnd(5)} lf=${String(c.lf).padEnd(5)} ${kind}${ok ? "" : `  ← 期望 ${exp}`}`,
  );
}
say();

const verdict = tally.MIXED === 0 && mismatch === 0 ? "ALL CONSISTENT" : "MISMATCH FOUND";
say(`=== ${verdict} === mismatch=${mismatch} mixed=${tally.MIXED}`);

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`\n[written] ${OUT}`);
