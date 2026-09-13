/**
 * 回滚：把测试文件从 tests/ 还原回各自 server/ / client/src/ / shared/ 的原位置。
 *
 * 背景：2026-09-13 把全仓 230 个测试文件收拢到仓库根 `tests/`（镜像源结构），
 *       迁移脚本 = `_moveTestsToRoot.mts`。本脚本是它的物理逆操作。
 *
 * ⚠️ 本脚本**只做物理搬运**；import 路径改写、`import.meta.dirname` 基准、
 *    `vi.mock` 说明符、`vitest.config.ts` / `tsconfig.json` 都必须另行改回。
 *    因此**首选 git 回滚**（一步到位且不会漏改）：
 *        git checkout -- server client/src shared
 *        git clean -fd tests
 *
 * 仅当测试文件已被提交、无法用 checkout 时，才用本脚本搬运，
 * 之后仍需手工（或另写脚本）把路径改回去。
 */
import { readdirSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const TOPS = ["server", "client/src", "shared"];
const APPLY = process.argv.includes("--apply");

function walk(dir, out = []) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return out;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const rel = join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) walk(rel, out);
    else if (/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const files = TOPS.flatMap((t) => walk(`tests/${t}`));
const plan = files.map((rel) => ({ from: rel, to: rel.replace(/^tests\//, "") }));

for (const p of plan) console.log(`  ${p.from}\n    -> ${p.to}`);
console.log(`\n共 ${plan.length} 个文件${APPLY ? "" : "（预演，未落盘）"}`);

if (!APPLY) {
  console.log("\n加 --apply 执行物理搬运。");
  console.log("⚠️ 记得同步改回 import 路径与 vitest.config.ts / tsconfig.json。");
  process.exit(0);
}

for (const p of plan) {
  const to = join(ROOT, p.to);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(join(ROOT, p.from), to);
}
console.log(`已搬回 ${plan.length} 个文件。`);
