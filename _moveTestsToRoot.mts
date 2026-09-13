/**
 * 测试文件收拢到仓库根 tests/（镜像源结构）。
 *
 * 结构：server/<a>/<b>/x.test.ts  ->  tests/server/<a>/<b>/x.test.ts
 *       client/src/<a>/y.test.ts  ->  tests/client/src/<a>/y.test.ts
 *       shared/z.test.ts          ->  tests/shared/z.test.ts
 *
 * 路径改写规则（逐文件精确计算，非字符串替换）：
 *   对原文件 F 位于 <SRC_TOP>/<dir>/，其 import 目标写为 R（以 ./ 或 ../ 开头）：
 *     原始目标绝对位置 = <SRC_TOP>/<dir>/R
 *     新文件位于 tests/<SRC_TOP>/<dir>/
 *     新相对路径 = relative(tests/<SRC_TOP>/<dir>, <SRC_TOP>/<dir>/R)
 *
 *   例（server/research/a.test.ts 里的 from "./b"）：
 *     目标 = server/research/b
 *     新文件目录 = tests/server/research
 *     => ../../server/research/b
 *
 *   ✅ 因 tests/ 与 src 顶级目录同级，前缀恒为 "../" * 2（从 tests/<top>/<dir> 回到根）
 *      再拼上 <top>/<dir>/R 归一化后的路径。
 *
 * dirname 类基准：resolve(import.meta.dirname, X)
 *   原语义：dirname = <top>/<subDir>，X 相对它解析。
 *   新语义：dirname = tests/<top>/<subDir>，比原来多一层前缀 tests/。
 *   要保持 X 仍解析到同一位置，必须先把基准「回退」到原目录：
 *     回退段 = relative(tests/<top>/<subDir>, <top>/<subDir>)
 *   由 tests/ 与 src 同级 ⇒ 该值恒为 ".." * (1 + <subDir 层数>) 再斜向下 <top>/<subDir>
 *   例：tests/server/research  ->  server/research   为 ../../server/research
 *       tests/shared           ->  shared           为 ../shared
 *   然后按原样拼接 X 的参数（多个参数用 spread 会改变语义，故改为把这些参数
 *   合并成一个 path.join，保证 resolve 只有一个 path 参数）。
 */
import "dotenv/config";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, normalize } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const TOPS = ["server", "client/src", "shared"];
const MASK = "\u0000DNAME\u0000";

function walkTests(dir: string, out: string[]): void {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return;
  for (const e of readdirSync(full, { withFileTypes: true })) {
    const rel = join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      walkTests(rel, out);
    } else if (/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
}

/** 原文件所在顶级目录（server / client/src / shared）及其下的子目录 */
function splitTop(rel: string): { top: string; sub: string } {
  for (const t of TOPS) {
    if (rel === t || rel.startsWith(t + "/")) {
      return { top: t, sub: rel.slice(t.length + 1) };
    }
  }
  throw new Error(`不在已知顶级目录下: ${rel}`);
}

/** 计算新文件路径 */
function newPath(rel: string): string {
  const { top, sub } = splitTop(rel);
  return `tests/${top}/${sub}`;
}

/**
 * 改写一个测试文件的源码。
 * @param src 原文
 * @param srcRel 原文件仓库相对路径（如 server/research/a.test.ts）
 */
function rewrite(
  src: string,
  srcRel: string,
): { out: string; imports: number; dirnames: number } {
  const { top, sub } = splitTop(srcRel);

  // 新文件位于 tests/<top>/<subDir>/ ；<subDir> = sub 去掉文件名
  const subDir = sub.includes("/") ? sub.slice(0, sub.lastIndexOf("/")) : "";
  // 新文件目录（仓库相对）: tests/<top>/<subDir>
  const newDir = subDir ? `tests/${top}/${subDir}` : `tests/${top}`;
  // 原文件目录（仓库相对）: <top>/<subDir>
  const oldDir = subDir ? `${top}/${subDir}` : top;

  // 1) 屏蔽 dirname 调用点
  let masked = src.replace(/resolve\(\s*import\.meta\.dirname\s*,/g, (m) =>
    m.replace("import.meta.dirname", MASK),
  );
  const dCount = (masked.match(new RegExp(MASK, "g")) ?? []).length;

  // 2) 改写相对 import
  let imports = 0;
  masked = masked.replace(
    /(from\s+|import\s*\(\s*)(["'])(\.\.?\/[^"']*)\2/g,
    (_m, head: string, q: string, spec: string) => {
      // 原始目标（仓库相对，已归一化）
      const targetAbs = normalize(join(oldDir, spec));
      // 新相对路径
      let np = relative(newDir, targetAbs).replace(/\\/g, "/");
      if (!np.startsWith(".")) np = "./" + np;
      imports++;
      return `${head}${q}${np}${q}`;
    },
  );

  // 3) dirname 基准：在 import.meta.dirname 之后插入「回退段」，
  //    使其解析结果仍等于原目录（<top>/<subDir>）。
  //    resolve() 接受任意多个 path 片段，插入一个纯 path 片段不改变语义。
  const retreat = relative(newDir, oldDir).replace(/\\/g, "/") || ".";
  let out = masked;
  for (let i = 0; i < dCount; i++) {
    out = out.replace(
      new RegExp(`${MASK}\\s*,`),
      `import.meta.dirname, ${JSON.stringify(retreat)},`,
    );
  }
  out = out.split(MASK).join("import.meta.dirname");

  return { out, imports, dirnames: dCount };
}

function main(): void {
  const files: string[] = [];
  for (const t of TOPS) walkTests(t, files);
  files.sort();

  console.log(`=== 待收拢测试文件：${files.length} 个 ===\n`);

  const plan = files.map((rel) => {
    const r = rewrite(readFileSync(join(ROOT, rel), "utf8"), rel);
    return { from: rel, to: newPath(rel), imports: r.imports, dirnames: r.dirnames };
  });

  const byTop = new Map<string, number>();
  for (const p of plan) {
    const t = p.to.split("/")[1];
    byTop.set(t, (byTop.get(t) ?? 0) + 1);
  }
  console.log("=== 目标分布 ===");
  for (const [t, n] of byTop) console.log(`  tests/${t}  (+${n})`);
  console.log(`\n相对 import 改写：${plan.reduce((a, p) => a + p.imports, 0)} 处`);
  console.log(`dirname 基准改写：${plan.reduce((a, p) => a + p.dirnames, 0)} 处`);

  console.log("\n=== 抽样：改写效果（含 dirname 的全部）===");
  for (const p of plan.filter((x) => x.dirnames > 0)) {
    const r = rewrite(readFileSync(join(ROOT, p.from), "utf8"), p.from);
    console.log(`\n  ${p.from}\n    -> ${p.to}`);
    r.out
      .split("\n")
      .filter((l) => l.includes("import.meta.dirname"))
      .forEach((l) => console.log(`      ${l.trim()}`));
  }

  console.log("\n=== 抽样：普通 import ===");
  for (const p of plan.filter((x) => x.imports > 0).slice(0, 4)) {
    const r = rewrite(readFileSync(join(ROOT, p.from), "utf8"), p.from);
    console.log(`\n  ${p.from}\n    -> ${p.to}`);
    r.out
      .split("\n")
      .filter((l) => /^\s*import .*from ["']\./.test(l))
      .slice(0, 4)
      .forEach((l) => console.log(`      ${l.trim()}`));
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] 未落盘。加 --apply 执行。");
    return;
  }

  console.log("\n=== 执行迁移 ===");
  let moved = 0;
  const failed: string[] = [];
  for (const p of plan) {
    try {
      const from = join(ROOT, p.from);
      const to = join(ROOT, p.to);
      const r = rewrite(readFileSync(from, "utf8"), p.from);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, r.out, "utf8");
      unlinkSync(from);
      moved++;
    } catch (e) {
      failed.push(`${p.from}: ${String(e)}`);
    }
  }
  console.log(`迁移完成：${moved} / ${plan.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
  }
}

main();
