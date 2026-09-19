/**
 * OOS-001 §16 T2 / T3 / §2 — 静态守卫（**把纪律变成可执行事实，而不是注释承诺**）。
 *
 * ## 为什么需要「静态」这一层
 *
 * 运行时证据（`_e2e_oos_validation.mts`）只能证明「**这一次**没污染源、真的重跑了」；
 * 静态守卫证明的是「**不可能**做错」：本域的 import 集与写点集被钉死，
 * 任何人想在本域里「顺手加一次参数搜索」或「顺手 UPDATE 一下源结果」，
 * 都会让守卫变红，而不是悄悄混过审阅。
 *
 * ## 与 ROBUSTNESS-001 守卫的**镜像关系**（务必对照阅读）
 *
 * | 域 | 核心主张 | 守卫形态 |
 * |---|---|---|
 * | `searchRobustness/**` | 零重跑 | **黑名单**：import 里不得出现回测 / 评估端口 |
 * | `oosValidation/**`（本域） | **必须重跑** | **白名单 + 必含清单**：必须 import 回测桥与指标投影，且不得 import 搜索写路径 |
 *
 * 两者的守卫方向**恰好相反** —— 这不是笔误，而是两个域的语义本身相反。
 *
 * ## 守卫自身必须做负例自测
 *
 * 「全绿」若检测器本身是空转的，就什么都证明不了。每个检测器都先喂一个**已知违规样例**，
 * 抓到才算数。
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../../", import.meta.url);
const MODULE_DIR = new URL("../../../../server/research/oosValidation/", import.meta.url);
const CONTRACTS = new URL("../../../../shared/oosValidationContracts.ts", import.meta.url);
const ROUTER = new URL("../../../../server/paramSearchRouter.ts", import.meta.url);

function read(url: URL): string {
  return readFileSync(fileURLToPath(url), "utf8");
}

/** 模块内全部 `.ts`（不含 barrel —— barrel 只是 re-export，无逻辑）。 */
function moduleFiles(): string[] {
  return readdirSync(fileURLToPath(MODULE_DIR))
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();
}

/** 剥注释（`//` 行内 + `/* *\/` 块）—— 注释里引用禁令原文是允许的。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 取一个文件的全部 import 说明符（静态 + 动态）。 */
function importsOf(source: string): string[] {
  const body = stripComments(source);
  return [...body.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------------------
// T3 — 写点白名单：本域只写 oos_validation_* 两表
// ---------------------------------------------------------------------------

/** 本域**允许**写入的表（drizzle 变量名）。 */
const ALLOWED_WRITE_TARGETS = ["oosValidationRun", "oosValidationResult"];

/** 找出 `insert(x)` / `update(x)` / `delete(x)` 里的目标标识符。 */
function findWriteTargets(files: Array<{ name: string; source: string }>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    // 🔴 词边界很重要：不能把 `updateOosValidationRun(` / `.onDuplicateKeyUpdate({` 误判成写操作。
    for (const match of stripComments(file.source).matchAll(/\b(?:insert|update|delete)\s*\(\s*([A-Za-z0-9_]+)\s*[,)]/g)) {
      hits.push(`${file.name}: ${match[1] ?? ""}`);
    }
  }
  return hits;
}

describe("T3 写点白名单：本域只写 oos_validation_* 两表（不碰源）", () => {
  it("负例自测：检测器确实抓得到对源表的写操作", () => {
    expect(
      findWriteTargets([{ name: "x.ts", source: "await db.insert(parameterSearchResult).values({});" }]),
    ).toEqual(["x.ts: parameterSearchResult"]);
    expect(
      findWriteTargets([{ name: "x.ts", source: "await db.update(parameterSearchRun).set({ status: 'X' });" }]),
    ).toEqual(["x.ts: parameterSearchRun"]);
    // 干净样例不误报
    expect(
      findWriteTargets([{ name: "x.ts", source: "await db.update(oosValidationRun).set({ status: 'RUNNING' });" }]),
    ).toEqual(["x.ts: oosValidationRun"]);
    // 「同名函数」不得被误判成写操作
    expect(
      findWriteTargets([{ name: "x.ts", source: "await updateOosValidationRun(id, patch); insertOosValidationRun(input);" }]),
    ).toEqual([]);
  });

  it("真实模块的写目标全部属于白名单", () => {
    const offenders = findWriteTargets(
      moduleFiles().map((name) => ({ name: `oosValidation/${name}`, source: read(new URL(name, MODULE_DIR)) })),
    ).filter((hit) => {
      const target = hit.split(": ")[1] ?? "";
      return !ALLOWED_WRITE_TARGETS.includes(target);
    });
    expect(offenders).toEqual([]);
  });

  it("写点确实存在（否则上面的白名单检查是空转的）", () => {
    const hits = findWriteTargets(
      moduleFiles().map((name) => ({ name: `oosValidation/${name}`, source: read(new URL(name, MODULE_DIR)) })),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((h) => h.split(": ")[1])).size).toBe(ALLOWED_WRITE_TARGETS.length);
  });
});

// ---------------------------------------------------------------------------
// T3 — 源只读：只能从源域取**只读**函数
// ---------------------------------------------------------------------------

/**
 * 允许从 `parameterSearch/persistence` 取的名字。
 *
 * 🔴 三类，**都不得含写操作**：
 *   ① SELECT 读函数（`get*Row` / `list*Rows` / `readDatasetVersionWindow`）；
 *   ② 行类型（`type *Row`，供本域的类型标注，不产生行为）；
 *   ③ `finiteOrNull` —— 纯数值守卫（防 NaN 静默变 null 的唯一权威）。
 *      它不是「读源」，而是本仓共享的数值纪律实现；自己再写一份必然漂移。
 */
const ALLOWED_SOURCE_READS = [
  "getParameterSearchRunRow",
  "listParameterSearchCombinationRows",
  "listParameterSearchResultRows",
  "readDatasetVersionWindow",
  "finiteOrNull",
  // 行类型（`type ` 前缀已在解析时剥掉，这里用裸名比对）
  "ParameterSearchCombinationRow",
  "ParameterSearchResultRow",
  "ParameterSearchRunRow",
];

describe("T3 源只读：从 parameterSearch 只取读函数", () => {
  /** 抽出「从 X 模块导入的名字」清单。 */
  function importedNamesFrom(source: string, specifier: string): string[] {
    const names: string[] = [];
    for (const match of stripComments(source).matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+"([^"]+)"/g)) {
      if (match[2] !== specifier) continue;
      for (const raw of (match[1] ?? "").split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (name !== "") names.push(name);
      }
    }
    return names;
  }

  it("parameterSearch/persistence 的导入名全部属于只读白名单", () => {
    const offenders: string[] = [];
    for (const name of moduleFiles()) {
      const source = read(new URL(name, MODULE_DIR));
      for (const imported of importedNamesFrom(source, "../parameterSearch/persistence")) {
        if (!ALLOWED_SOURCE_READS.some((allowed) => allowed === imported)) {
          offenders.push(`${name}: ${imported}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("🔴 从 parameterSearch/executor 只能取 `toResultView`（那是唯一的 IS 结果行投影）", () => {
    const offenders: string[] = [];
    for (const name of moduleFiles()) {
      const source = read(new URL(name, MODULE_DIR));
      for (const imported of importedNamesFrom(source, "../parameterSearch/executor")) {
        if (imported !== "toResultView") offenders.push(`${name}: ${imported}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("🔴 本域不得 import 任何**创建 / 执行 / 重试搜索**的函数（否则就是「再搜一次参数」）", () => {
    const FORBIDDEN_SEARCH_WRITERS = [
      "createParameterSearchRun",
      "executeParameterSearchRun",
      "retryParameterSearchCombination",
      "cancelParameterSearchRun",
      "deriveParameterSpaceFromDocument",
      "createSearchRobustnessRun",
      "startSearchRobustnessRun",
    ];
    const offenders: string[] = [];
    for (const name of moduleFiles()) {
      const source = stripComments(read(new URL(name, MODULE_DIR)));
      for (const fn of FORBIDDEN_SEARCH_WRITERS) {
        // 出现即违规：无论是 import 还是调用。
        if (new RegExp(`\\b${fn}\\b`).test(source)) offenders.push(`${name}: ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 / §9 — 「必须重跑」是结构事实（与 ROBUSTNESS-001 守卫镜像相反）
// ---------------------------------------------------------------------------

describe("§2/§9 真重跑是结构事实：本域**必须**持有回测桥与指标投影的入口", () => {
  it("至少一个模块 import 了 createStrategyBacktestBridge（回测唯一入口）", () => {
    const found = moduleFiles().filter((name) =>
      importsOf(read(new URL(name, MODULE_DIR))).some((spec) => spec.endsWith("strategyEvaluation/backtestBridge")),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("至少一个模块 import 了 projectCanonicalMetrics（canonical 读数唯一投影）", () => {
    const found = moduleFiles().filter((name) =>
      read(new URL(name, MODULE_DIR)).includes("projectCanonicalMetrics"),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("镜像对照：本域**允许**出现回测 / 评估端口（searchRobustness 域被钉死禁止）", () => {
    const rerunTokens = ["strategyEvaluation", "closedLoop", "backtest"];
    const specs = moduleFiles().flatMap((name) => importsOf(read(new URL(name, MODULE_DIR))));
    expect(specs.some((spec) => rerunTokens.some((token) => spec.includes(token)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10 / §15 — 措辞守卫
// ---------------------------------------------------------------------------

const FORBIDDEN = ["最佳", "最优", "推荐", "winner", "best", "optimal", "recommend"];

function findForbiddenClaims(files: Array<{ name: string; source: string }>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const code = stripComments(file.source).toLowerCase();
    for (const word of FORBIDDEN) {
      if (code.includes(word.toLowerCase())) hits.push(`${file.name}: ${word}`);
    }
  }
  return hits;
}

describe("§10/§15 不产出「最佳 / 最优 / 推荐」型结论", () => {
  it("负例自测：检测器确实抓得到违规（否则「全绿」证明不了任何事）", () => {
    expect(findForbiddenClaims([{ name: "synthetic.ts", source: "const x = '最佳参数';" }])).toEqual([
      "synthetic.ts: 最佳",
    ]);
    expect(findForbiddenClaims([{ name: "synthetic.ts", source: "return 'Winner';" }]).length).toBe(1);
    expect(
      findForbiddenClaims([{ name: "synthetic.ts", source: "// 本域严禁输出「最佳 / 最优 / 推荐」\nconst x = 1;" }]),
    ).toEqual([]);
  });

  it("OOS 域模块 + shared 契约零命中", () => {
    const files = [
      ...moduleFiles().map((name) => ({ name: `oosValidation/${name}`, source: read(new URL(name, MODULE_DIR)) })),
      { name: "oosValidation/index.ts", source: read(new URL("index.ts", MODULE_DIR)) },
      { name: "shared/oosValidationContracts.ts", source: read(CONTRACTS) },
    ];
    expect(findForbiddenClaims(files)).toEqual([]);
  });

  it("paramSearchRouter 的 OOS-001 端点段零命中", () => {
    const router = read(ROUTER);
    const marker = "OOS-001 — Out-of-Sample Validation（消费冻结结果";
    const start = router.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    expect(findForbiddenClaims([{ name: "paramSearchRouter.ts#oos", source: router.slice(start) }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 命名不遮蔽守卫（本轮实建时踩到的真实坑）
// ---------------------------------------------------------------------------

/**
 * 🔴 为什么要有这条守卫
 *
 * 本仓在 OOS-001 之前已有 `validationSelection.ts#FrozenOosCandidate`（STEP 6.4），
 * 且它经 `server/research/index.ts` 全域 re-export。ESM 的 `export *` 遇到**同名导出**
 * 会**静默不导出**那个名字（不报错）⇒ 消费者 `import { FrozenOosCandidate }` 会
 * 在某个 barrel 上拿不到 / 在另一个 barrel 上拿到**语义不同**的同名类型。
 *
 * 本轮实建时确实撞上了（`FrozenOosCandidate` / `fingerprintOf` / `calendarDaysBetween`
 * 三个名字），因此把「本域不得与仓内既有顶层导出重名」钉成结构事实。
 */
describe("命名不遮蔽守卫：本域顶层导出名不得与仓内既有声明重名", () => {
  /** 收集某段文本里的顶层 `export` 声明名。 */
  function topLevelExports(source: string): string[] {
    return [...stripComments(source).matchAll(
      /^export\s+(?:type|interface|const|function|async function|class)\s+([A-Za-z0-9_]+)/gm,
    )].map((m) => m[1] ?? "");
  }

  /** 递归列出某个目录下的全部 `.ts` / `.tsx`。 */
  function sourceFilesUnder(dir: URL): URL[] {
    const base = fileURLToPath(dir);
    return readdirSync(base, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => pathToFileURL(`${entry.parentPath}\\${entry.name}`));
  }

  it("负例自测：确实能发现重名", () => {
    const a = topLevelExports("export interface SameName {}\n");
    const b = topLevelExports("export interface SameName {}\n");
    expect(a.filter((n) => b.includes(n))).toEqual(["SameName"]);
  });

  it("本域导出名与 server/** + shared/** 其余文件的顶层导出名**零交集**", () => {
    const own = new Set(
      moduleFiles().flatMap((name) => topLevelExports(read(new URL(name, MODULE_DIR)))),
    );
    /** `index.ts` 只有 re-export，不产生新名；`.d.ts` 也不在本仓。 */
    const collisions: string[] = [];
    for (const url of [...sourceFilesUnder(new URL("../../../../server/", import.meta.url)), ...sourceFilesUnder(new URL("../../../../shared/", import.meta.url))]) {
      const posix = url.pathname;
      if (posix.includes("/server/research/oosValidation/")) continue;
      for (const name of topLevelExports(read(url))) {
        if (own.has(name)) collisions.push(`${name} ← ${posix.split("/").slice(-3).join("/")}`);
      }
    }
    expect([...new Set(collisions)]).toEqual([]);
  });
});
