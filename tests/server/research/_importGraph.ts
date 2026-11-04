/**
 * RESEARCH-EXPERIMENT-002 — **本地 import 图可达性**工具（判据形态，唯一实现）。
 *
 * ## 为什么需要「图可达」而不是「逐文件 grep」
 *
 * 本轮审计实测到一条**传递性**依赖：生产回测端口
 * `server/research/strategyEvaluation/evaluate.ts` 自己不认识旧 Research，但它 →
 * `runWorkbenchAssembly/assemble.ts` → `research/patternLibrary/strategyConsumption` →
 * `patternLibrary/index` →（**`export { … } from "./project"` 再导出**）→
 * `patternLibrary/project` → `researchEngine/planner/moduleRegistry` → `researchCore`。
 * 逐文件看一眼是发现不了的 —— 必须走图。
 *
 * 同理 `server/db.ts` 曾 `import { withReadRetry } from './researchEngine/readRetry'`：
 * 一行工具 import 就让「整个库的入口」与旧 Research 子图挂在一起。
 *
 * ## 🔴 判据实现本身的两个坑（本会话真踩第一个）
 *
 * 1. **必须用 TS AST，不能用正则**：第一版只用 `/import … from "x"/` 抓边，
 *    **漏掉了 `export { … } from "./project"` 这类再导出** ⇒ 把「经 barrel 再导出」
 *    的传递依赖判成「不可达」（假 PASS）。AST 也能精确区分 `import type` /
 *    `{ type X }` / `export type`，正则做不到。
 * 2. **只跟随运行时边**：纯类型 import 不构成运行时依赖，必须排除；否则会把
 *    「只借类型」的文件误判成依赖方。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** 一条本地运行时 import / 再导出边。 */
export interface LocalImportEdge {
  readonly from: string;
  readonly specifier: string;
  readonly resolved: string;
  /** `import` 或 `export`（再导出）。 */
  readonly kind: "import" | "export";
}

/** 判断一条具名子句是否**全部**是 type-only（`{ type A, type B }`）。 */
function allNamedTypeOnly(elements: readonly ts.ImportSpecifier[] | readonly ts.ExportSpecifier[]): boolean {
  if (elements.length === 0) return false;
  return elements.every((element) => element.isTypeOnly);
}

/**
 * 抽取一个文件的**运行时**本地模块说明符。
 *
 * 排除（不产生运行时边）：`import type …` / `{ type X }` / `export type { … } from`。
 */
export function runtimeLocalSpecifiers(file: string): Array<{ specifier: string; kind: "import" | "export" }> {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  const out: Array<{ specifier: string; kind: "import" | "export" }> = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) continue;
      const clause = statement.importClause;
      if (clause !== undefined) {
        if (clause.isTypeOnly) continue;
        const bindings = clause.namedBindings;
        // `import { type A } from "x"` —— 具名子句全是 type ⇒ 无运行时边。
        if (
          bindings !== undefined
          && ts.isNamedImports(bindings)
          && clause.name === undefined
          && allNamedTypeOnly(bindings.elements)
        ) {
          continue;
        }
      }
      out.push({ specifier: specifier.text, kind: "import" });
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause) && allNamedTypeOnly(clause.elements)) continue;
      out.push({ specifier: specifier.text, kind: "export" });
    }
  }
  return out;
}

/** 把 import 说明符解析成仓库内的真实文件；不是本地文件/不存在 ⇒ null。 */
export function resolveLocalSpecifier(fromFile: string, specifier: string): string | null {
  let base: string | null = null;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@shared/")) {
    base = path.join(REPO_ROOT, "shared", specifier.slice("@shared/".length));
  } else if (specifier.startsWith("@experiments/")) {
    base = path.join(REPO_ROOT, "research-experiments", specifier.slice("@experiments/".length));
  } else {
    // 包名（react / drizzle-orm / zod …）与本仓库内的相对路径无关 ⇒ 忽略。
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** 一个文件在仓库内的全部本地运行时边。 */
export function localRuntimeEdges(file: string): Array<LocalImportEdge & { readonly from: string }> {
  const edges: Array<LocalImportEdge & { readonly from: string }> = [];
  for (const { specifier, kind } of runtimeLocalSpecifiers(file)) {
    const resolved = resolveLocalSpecifier(file, specifier);
    if (resolved !== null) edges.push({ from: file, specifier, resolved, kind });
  }
  return edges;
}

/** 从若干入口出发，收集**全部可达的本地文件**（含入口自身）。 */
export function collectReachable(entries: readonly string[]): {
  readonly files: ReadonlySet<string>;
  readonly edges: readonly (LocalImportEdge & { readonly from: string })[];
} {
  const files = new Set<string>();
  const edges: Array<LocalImportEdge & { readonly from: string }> = [];
  const queue: string[] = [];
  for (const entry of entries) {
    const absolute = path.isAbsolute(entry) ? entry : path.join(REPO_ROOT, entry);
    if (existsSync(absolute)) queue.push(absolute);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (files.has(current)) continue;
    files.add(current);
    for (const edge of localRuntimeEdges(current)) {
      edges.push(edge);
      if (!files.has(edge.resolved)) queue.push(edge.resolved);
    }
  }
  return { files, edges };
}

/** 把绝对路径转成仓库相对路径（`/` 分隔，便于断言）。 */
export function rel(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

/**
 * 取一个文件从某个模块**实际 import 的具名符号**（AST 级，不看注释）。
 *
 * 为什么不能拿正则扫源码：`server/runWorkbenchAssembly/assemble.ts` 的**注释**里
 * 出现了 `researchRun.loopRun`（那是 router key，不是表对象），正则会把注释命中的
 * 误判成「引用了旧 Research 表」—— 判据必须只看 import 声明本身。
 */
export function namedImportsFrom(file: string, moduleSpecifierSuffix: string): string[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const out: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.endsWith(moduleSpecifierSuffix)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) out.push(element.name.text);
    } else {
      // `import * as ns from "…"` ⇒ 命名空间导入，无法逐名枚举，如实标记。
      out.push("*");
    }
  }
  return out;
}

/** 从入口到命中文件的**最短路径**（失败时给出「它是怎么被拉进来的」）。 */
export function shortestPathTo(
  entries: readonly string[],
  predicate: (relativePath: string) => boolean,
): string[] | null {
  const start = entries
    .map((entry) => (path.isAbsolute(entry) ? entry : path.join(REPO_ROOT, entry)))
    .filter((entry) => existsSync(entry));
  const visited = new Set<string>(start);
  const parent = new Map<string, string | null>();
  for (const item of start) parent.set(item, null);
  const queue = [...start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (predicate(rel(current))) {
      const chain: string[] = [];
      let node: string | null = current;
      while (node !== null) {
        chain.unshift(rel(node));
        node = parent.get(node) ?? null;
      }
      return chain;
    }
    for (const edge of localRuntimeEdges(current)) {
      if (visited.has(edge.resolved)) continue;
      visited.add(edge.resolved);
      parent.set(edge.resolved, current);
      queue.push(edge.resolved);
    }
  }
  return null;
}
