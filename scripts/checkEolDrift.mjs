#!/usr/bin/env node
/**
 * EOL 漂移哨兵 —— 检测「工作区行尾 ≠ HEAD blob 行尾」的已跟踪文件。
 *
 * 背景（2026-09-17 实测代价）：
 *   本仓 `core.autocrlf=false` ⇒ 工作区行尾 = 磁盘真身；HEAD blob 内部一律 LF（仓库仅 3 个文件是有意 CRLF：
 *   `.workbuddy/memory/PROJECT_RULES.md`、`client/src/App.tsx`、`client/src/components/AppShell.tsx`）。
 *   一旦某个文件被外部工具/脚本翻成 CRLF，`git diff --numstat` 会显示「增删数 ≈ 文件行数」，
 *   真实改动被淹没、评审无法进行 —— 2026-09-17 的 STEP 0 就踩到过（`server/_core/index.ts` +228/-197、
 *   `tests/.../engine.test.ts` +420/-418，真实改动其实只有 +31 与 +5/-3）。
 *
 * 原理（两次 git diff 即可定位，秒级，不依赖逐文件 cat-file）：
 *   `--ignore-cr-at-eol` 会忽略行尾 CR ⇒ 若某文件在普通 diff 里「整文件重写」，而在该开关下几乎无变化，
 *   就说明差异主要来自行尾。
 *
 * 用法：
 *   node scripts/checkEolDrift.mjs          # 只报告；发现漂移 exit 1
 *   node scripts/checkEolDrift.mjs --fix    # 按 HEAD blob 的行尾归一化漂移文件（原子替换）
 *   node scripts/checkEolDrift.mjs --strict # 未跟踪的新文件若为 CRLF 也判失败
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(process.cwd());
const args = new Set(process.argv.slice(2));
const DO_FIX = args.has("--fix");
const STRICT = args.has("--strict");

function git(gitArgs, { encoding = "utf8", input } = {}) {
  return execFileSync("git", gitArgs, { cwd: REPO, encoding, input, maxBuffer: 1 << 28 });
}

/** 解析 `git diff --numstat`；二进制行会显示 `-`，一并容错。 */
function numstat(extraArgs) {
  const out = git(["diff", "--numstat", ...extraArgs]);
  const map = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, d, p] = parts;
    map.set(p, [a === "-" ? -1 : Number(a), d === "-" ? -1 : Number(d)]);
  }
  return map;
}

/** 把 Buffer 归类成行尾形态。 */
function classify(buf) {
  const crlf = (buf.toString("latin1").match(/\r\n/g) || []).length;
  const lf = (buf.toString("latin1").match(/\n/g) || []).length;
  if (lf === 0) return "none";
  if (crlf === 0) return "LF";
  if (crlf === lf) return "CRLF";
  return `MIX(crlf=${crlf},lf=${lf})`;
}

/** 检测漂移：普通 diff 与「忽略行尾 CR」后的改动量对比。 */
function detectDrift() {
  const plain = numstat([]);
  const lenient = numstat(["--ignore-cr-at-eol"]);

  const found = [];
  for (const [p, [pa, pd]] of plain) {
    const soft = lenient.get(p);
    const total = pa + pd;
    const softTotal = soft ? soft[0] + soft[1] : 0;
    // 判据：普通 diff 改动量显著大于「忽略行尾 CR」后的改动量。
    // 阈值 = 至少多出 20 行，且多出量占普通 diff 的一半以上 —— 避免把「既有换行改动又有真实改动」误报。
    const extra = total - softTotal;
    if (extra >= 20 && extra * 2 >= total) {
      found.push({ path: p, plain: [pa, pd], soft: soft ?? [0, 0] });
    }
  }
  return found;
}

const drifted = detectDrift();

const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split("\n")
  .filter((x) => x.trim());

const badNewFiles = [];
for (const p of untracked) {
  if (!/\.(ts|tsx|mts|mjs|cjs|js|json|md|css|sql|yaml|yml)$/i.test(p)) continue;
  let buf;
  try {
    buf = readFileSync(path.join(REPO, p));
  } catch {
    continue;
  }
  const kind = classify(buf);
  if (kind === "CRLF") badNewFiles.push({ path: p, kind });
}

// ---- 报告 ----
console.log(`repo = ${REPO}`);
console.log(`已跟踪文件中疑似行尾漂移：${drifted.length}`);
for (const d of drifted) {
  console.log(`  ${d.path}   普通 diff +${d.plain[0]}/-${d.plain[1]}   忽略 CR 后 +${d.soft[0]}/-${d.soft[1]}`);
}
console.log(`未跟踪新文件中 CRLF（仓库默认 LF）：${badNewFiles.length}`);
for (const d of badNewFiles) console.log(`  ${d.path}   ${d.kind}`);

// ---- 修复 ----
let remaining = drifted;
if (DO_FIX && drifted.length > 0) {
  let fixed = 0;
  for (const d of drifted) {
    const full = path.join(REPO, d.path);
    const head = git(["cat-file", "-p", `HEAD:${d.path}`], { encoding: "buffer" });
    const target = classify(head);
    if (target !== "LF" && target !== "CRLF") {
      console.log(`  跳过 ${d.path}：HEAD blob 行尾为 ${target}，无法据以归一化`);
      continue;
    }
    const raw = readFileSync(full);
    let next;
    if (target === "LF") {
      next = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    } else {
      next = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "latin1");
    }
    if (next.equals(raw)) continue;
    const tmp = `${full}.eoldrift.tmp`;
    writeFileSync(tmp, next);
    renameSync(tmp, full);
    console.log(`  已归一化 ${d.path} -> ${target}（${raw.length} -> ${next.length} B）`);
    fixed += 1;
  }
  console.log(`归一化完成：${fixed} 个文件`);
  // 修复后重新检测，据此决定退出码 —— `--fix` 修干净即视为成功。
  remaining = detectDrift();
  console.log(`修复后复查：剩余疑似漂移 ${remaining.length}`);
  for (const d of remaining) console.log(`  ${d.path}   普通 diff +${d.plain[0]}/-${d.plain[1]}`);
}

const failed = remaining.length > 0 || (STRICT && badNewFiles.length > 0);
process.exit(failed ? 1 : 0);
