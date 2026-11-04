/**
 * WALK-FORWARD-001 §19 / §22 — 静态守卫（把「编排层不做引擎的事」变成**可执行事实**）。
 *
 * ## 本域的守卫形态（与既有两域**都不同**，这是第三个方向）
 *
 * | 域 | 核心主张 | 守卫方向 |
 * |---|---|---|
 * | `searchRobustness/**` | 零重跑 | **黑名单**：不得 import 回测 / 评估端口 |
 * | `oosValidation/**` | **必须重跑** | **必含清单**：必须 import 回测桥 + 指标投影 |
 * | `walkForward/**`（本域） | **编排层：既不自跑，也不重跑** | **黑名单 + 「执行只能经由注入钩子」** |
 *
 * Walk-Forward 的每一次搜索与每一次样本外都由**组合根**（`paramSearchRouter`）
 * 用既有 PS / OOS application service 完成，本域只拿到**归一化读数**。
 * ⇒ 只要本域的 import 面被钉死，「Walk-Forward 顺手自己跑一次回测」在结构上就不可能发生。
 *
 * ## 守卫自身必须做负例自测
 *
 * 「全绿」若检测器本身空转，就什么都证明不了 ⇒ 每个检测器先喂已知违规样例。
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE_DIR = new URL("../../../../server/research/walkForward/", import.meta.url);
const CONTRACTS = new URL("../../../../shared/walkForwardContracts.ts", import.meta.url);
const ROUTER = new URL("../../../../server/paramSearchRouter.ts", import.meta.url);
const APPLY_SCRIPT = new URL("../../../../scripts/applyWalkForward.mjs", import.meta.url);
const SQL_FILE = new URL("../../../../drizzle/0044_walk_forward.sql", import.meta.url);

function read(url: URL): string {
  return readFileSync(fileURLToPath(url), "utf8");
}

/** 域内全部 `.ts`（排除 barrel：它只是 re-export，无逻辑）。 */
function moduleFiles(): string[] {
  return readdirSync(fileURLToPath(MODULE_DIR))
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .sort();
}

function moduleSources(): Array<{ name: string; source: string }> {
  return moduleFiles().map((name) => ({
    name: `walkForward/${name}`,
    source: read(new URL(name, MODULE_DIR)),
  }));
}

/** 剥注释（注释里引用禁令原文是允许的）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 取一个文件的全部 import 说明符。 */
function importsOf(source: string): string[] {
  return [...stripComments(source).matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------------------
// §22 写点白名单：本域只写 walk_forward_* 两张表
// ---------------------------------------------------------------------------

const ALLOWED_WRITE_TARGETS = ["walkForwardRun", "walkForwardFold"];

function findWriteTargets(files: Array<{ name: string; source: string }>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    // 词边界很重要：不能把 `updateWalkForwardRun(` / `.onDuplicateKeyUpdate({` 误判成写操作
    for (const match of stripComments(file.source).matchAll(
      /\b(?:insert|update|delete)\s*\(\s*([A-Za-z0-9_]+)\s*[,)]/g,
    )) {
      hits.push(`${file.name}: ${match[1] ?? ""}`);
    }
  }
  return hits;
}

describe("§22 写点白名单：本域只写 walk_forward_* 两表（不碰历史 Search / OOS 结果）", () => {
  it("负例自测：检测器确实抓得到对历史表的写操作", () => {
    expect(
      findWriteTargets([{ name: "x.ts", source: "await db.update(oosValidationRun).set({ status: 'X' });" }]),
    ).toEqual(["x.ts: oosValidationRun"]);
    expect(
      findWriteTargets([{ name: "x.ts", source: "await db.insert(parameterSearchResult).values({});" }]),
    ).toEqual(["x.ts: parameterSearchResult"]);
    // 同名函数不得被误判
    expect(
      findWriteTargets([
        { name: "x.ts", source: "await updateWalkForwardFold(a, b, patch); insertWalkForwardRun(input);" },
      ]),
    ).toEqual([]);
  });

  it("真实模块的写目标全部属于白名单，且两个表都被真正写入", () => {
    const hits = findWriteTargets(moduleSources());
    expect(hits.length).toBeGreaterThan(0);
    expect([...new Set(hits.map((hit) => hit.split(": ")[1] ?? ""))].sort()).toEqual(
      [...ALLOWED_WRITE_TARGETS].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// §22 冻结列：更新面在**类型层**就够不到几何 / 指纹
// ---------------------------------------------------------------------------

/** 抽出某个 interface 的正文。 */
function interfaceBody(source: string, name: string): string {
  const match = new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(stripComments(source));
  expect(match, `找不到 interface ${name}`).not.toBeNull();
  return match![1] ?? "";
}

/** 抽出某处 `.set({ ... })` 的正文（第一个匹配）。 */
function setBodyAfter(source: string, marker: string): string {
  const body = stripComments(source);
  const start = body.indexOf(marker);
  expect(start, `找不到标记 ${marker}`).toBeGreaterThan(-1);
  const open = body.indexOf("set({", start);
  expect(open).toBeGreaterThan(-1);
  const end = body.indexOf("})", open);
  return body.slice(open, end);
}

const FROZEN_FOLD_COLUMNS = [
  "isStart",
  "isEnd",
  "oosStart",
  "oosEnd",
  "strategyVersionId",
  "strategyFingerprint",
  "datasetVersionId",
  "executionFingerprint",
];

describe("§10/§11 冻结列在类型层不可更新（窗口与身份不因重放 / 重执行而改变）", () => {
  it("`UpdateWalkForwardFoldInput` 完全不含几何 / 身份 / 执行指纹字段", () => {
    const body = interfaceBody(read(new URL("persistence.ts", MODULE_DIR)), "UpdateWalkForwardFoldInput");
    for (const column of FROZEN_FOLD_COLUMNS) {
      expect(body.includes(column), `UpdateWalkForwardFoldInput 不应包含 ${column}`).toBe(false);
    }
    // 但它**必须**能写结果类字段（否则冻结面之外什么也写不了）
    for (const mutable of ["status", "outcome", "parameterHash", "oosMetricsJson"]) {
      expect(body.includes(mutable)).toBe(true);
    }
  });

  it("`UpdateWalkForwardRunInput` 不含排程 / 选择策略 / 运行指纹（创建时冻结）", () => {
    const body = interfaceBody(read(new URL("persistence.ts", MODULE_DIR)), "UpdateWalkForwardRunInput");
    for (const column of ["scheduleJson", "selectionPolicyJson", "runFingerprint", "strategyFingerprint"]) {
      expect(body.includes(column), `UpdateWalkForwardRunInput 不应包含 ${column}`).toBe(false);
    }
    expect(body.includes("status")).toBe(true);
    expect(body.includes("aggregateJson")).toBe(true);
  });

  it("两处幂等建行的 `ON DUPLICATE KEY UPDATE` 只刷 `updatedAt`", () => {
    const source = read(new URL("persistence.ts", MODULE_DIR));
    const body = stripComments(source);
    const matches = [...body.matchAll(/onDuplicateKeyUpdate\(\{\s*set:\s*\{([\s\S]*?)\}\s*\}\)/g)].map(
      (m) => (m[1] ?? "").trim(),
    );
    expect(matches.length).toBe(2);
    for (const set of matches) {
      expect(set).toBe("updatedAt: sql`now()`");
    }
  });

  it("重执行重置（`resetWalkForwardFoldForExecution`）只清结果列，不动几何 / 指纹", () => {
    const source = read(new URL("persistence.ts", MODULE_DIR));
    const set = setBodyAfter(source, "export async function resetWalkForwardFoldForExecution");
    for (const column of FROZEN_FOLD_COLUMNS) {
      expect(set.includes(`${column}:`), `重置不得写 ${column}`).toBe(false);
    }
    expect(set.includes("status: \"WINDOW_CREATED\"")).toBe(true);
    expect(set.includes("resolvedParameterSetJson: null")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §19 / §22 import 黑名单：编排层不得持有任何引擎
// ---------------------------------------------------------------------------

/** 本域**禁止**出现的 import 说明符片段（出现即违规）。 */
const FORBIDDEN_IMPORT_TOKENS = [
  // 策略语义 / 执行 / 成本 / 持仓 —— 全都有唯一权威，本域不得持有
  "strategyCore",
  "strategyEvaluation",
  "closedLoop",
  "backtest",
  "leaderCandidates",
  "researchEngine",
  "runWorkbenchAssembly",
  // 另两个验证域（本域不得直接调用，必须经钩子）
  "oosValidation",
  "searchRobustness",
  "stochasticRobustness",
  "robustness",
  // 搜索的执行 / 持久化面（只能由组合根持有）
  "parameterSearch/executor",
  "parameterSearch/persistence",
  // C-19.1 的其它模块（只允许 windows / types）+ 全域 barrel
  "walkForwardRun/aggregate",
  "walkForwardRun/run",
  "walkForwardRun/serialize",
  "walkForwardRun/freeze",
  "walkForwardRun/index",
];

/**
 * 黑名单的**窄豁免**（逐条后缀匹配，必须写明理由）。
 *
 * 🔴 只有「版本自述常量」可豁免 —— 指标口径与引擎版本在本域**不得自造**：
 *   本域的 Fold-OOS 是被 OOS 流水线真跑出来的，因此 `metricsVersion` /
 *   `engineVersion` 的**唯一权威就是 OOS 域**。若本域自己写一份字面量，
 *   两边就会各自漂移（这正是 §6「禁止新建 WalkForwardMetrics」要防的事）。
 *
 * ⚠️ 豁免是**路径后缀**级，不是目录级：`../oosValidation`（barrel）与
 *   `../oosValidation/executor` 依旧命中黑名单 ⇒ 引擎仍然够不到。
 */
const ALLOWED_IMPORT_EXCEPTIONS = ["/oosValidation/types"];

function isForbiddenImport(spec: string): boolean {
  if (ALLOWED_IMPORT_EXCEPTIONS.some((allowed) => spec.endsWith(allowed))) return false;
  return FORBIDDEN_IMPORT_TOKENS.some((token) => spec.includes(token));
}

describe("§19/§22 import 黑名单：本域不持有回测 / 评估 / 搜索执行器", () => {
  it("负例自测：黑名单确实拦得住", () => {
    expect(isForbiddenImport("../oosValidation/executor")).toBe(true);
    expect(isForbiddenImport("../oosValidation")).toBe(true);
    expect(isForbiddenImport("../oosValidation/persistence")).toBe(true);
    expect(isForbiddenImport("../parameterSearch/executor")).toBe(true);
    expect(isForbiddenImport("../../strategyCore/ruleGraph")).toBe(true);
    // 允许的四条：窗口几何 + 参数 hash 纯函数 + 数据集坐标 + OOS 版本自述
    expect(isForbiddenImport("../walkForwardRun/windows")).toBe(false);
    expect(isForbiddenImport("../parameterSearch/parameterHash")).toBe(false);
    expect(isForbiddenImport("../../researchDataset/version")).toBe(false);
    expect(isForbiddenImport("../oosValidation/types")).toBe(false);
  });

  it("域内模块的 import 全部不在黑名单上", () => {
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      for (const spec of importsOf(file.source)) {
        if (isForbiddenImport(spec)) {
          offenders.push(`${file.name}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("🔴 豁免面必须是最小的：全仓只有版本自述常量经此进入", () => {
    const exempted = moduleSources()
      .flatMap((file) => importsOf(file.source))
      .filter((spec) => ALLOWED_IMPORT_EXCEPTIONS.some((allowed) => spec.endsWith(allowed)));
    expect([...new Set(exempted)].sort()).toEqual(["../oosValidation/types"]);
  });

  it("🔴 域内**不存在**任何「自己建搜索 / 自己跑样本外」的调用点", () => {
    const EXECUTION_TOKENS = [
      "createParameterSearchRun",
      "executeParameterSearchRun",
      "retryParameterSearchCombination",
      "createOosValidationRun",
      "startOosValidationRun",
      "createStrategyBacktestBridge",
      "projectCanonicalMetrics",
    ];
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      const code = stripComments(file.source);
      for (const token of EXECUTION_TOKENS) {
        if (new RegExp(`\\b${token}\\b`).test(code)) offenders.push(`${file.name}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("🔴 执行只能经由注入钩子：executor 调用 hooks，types 声明钩子契约", () => {
    const executor = stripComments(read(new URL("executor.ts", MODULE_DIR)));
    expect(executor.includes("hooks.runFoldSearch")).toBe(true);
    expect(executor.includes("hooks.runFoldOos")).toBe(true);
    expect(executor.includes("hooks.readCurrentContext")).toBe(true);
    const types = stripComments(read(new URL("types.ts", MODULE_DIR)));
    expect(types).toContain("export interface WalkForwardExecutionHooks");
    expect(types).toContain("readonly runFoldSearch");
    expect(types).toContain("readonly runFoldOos");
    // 组合根确实装配了钩子（否则「只能经钩子」在运行时根本没实现）
    expect(read(ROUTER)).toContain("buildWalkForwardExecutionHooks");
  });
});

// ---------------------------------------------------------------------------
// §2.4 / §16 复用纪律：窗口几何与 canonical 序列化必须复用，不得重写
// ---------------------------------------------------------------------------

describe("§2.4/§16 复用是结构事实：窗口几何与 canonical 序列化必须有唯一来源", () => {
  const allImports: string[] = moduleSources().flatMap((file) => importsOf(file.source));

  it("必须 import 既有窗口几何 `walkForwardRun/windows`（本域不重写 rolling / anchored）", () => {
    expect(allImports.some((spec) => spec === "../walkForwardRun/windows")).toBe(true);
  });

  it("必须 import 既有 canonical 序列化 `researchDataset/version`", () => {
    expect(allImports.some((spec) => spec === "../../researchDataset/version")).toBe(true);
  });

  it("🔴 本域**不得**自己实现窗口生成（不得出现 `generateWindows` / `splitWindows` 之类的自造几何）", () => {
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      const code = stripComments(file.source);
      for (const token of ["generateWindows", "splitWindows", "buildWindows", "WindowSpec"]) {
        if (new RegExp(`\\b${token}\\b`).test(code)) offenders.push(`${file.name}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("本域**不得**发 HTTP / 自调用 tRPC（规格 §15：禁 WalkForward → HTTP → OOS API）", () => {
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      const code = stripComments(file.source);
      for (const spec of importsOf(file.source)) {
        if (/^(https?:|node:http|axios)/.test(spec) || spec.includes("_core/trpc") || spec.includes("trpc")) {
          offenders.push(`${file.name}: import ${spec}`);
        }
      }
      if (/\b(?:fetch|axios)\s*\(/.test(code)) offenders.push(`${file.name}: fetch/axios 调用`);
    }
    expect(offenders).toEqual([]);
  });

  it("本域**不得**注册路由（端点一律挂在既有 Router 上；规格 §13）", () => {
    const offenders: string[] = [];
    for (const file of moduleSources()) {
      const code = stripComments(file.source);
      for (const token of ["router(", "publicProcedure", "protectedProcedure", "adminProcedure"]) {
        if (code.includes(token)) offenders.push(`${file.name}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §13 无死旋钮：创建入参的每一个键都必须真的被消费
// ---------------------------------------------------------------------------

/** 抽出 `createWalkForwardValidationInputSchema` 的键名。 */
function createInputKeys(): string[] {
  const source = stripComments(read(CONTRACTS));
  const start = source.indexOf("createWalkForwardValidationInputSchema = z.object({");
  expect(start, "找不到创建入参 schema").toBeGreaterThan(-1);
  const end = source.indexOf("});", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]!);
}

describe("§13 无死旋钮：创建入参不得有「被接受但从未生效」的字段", () => {
  const keys = createInputKeys();

  it("负例自测：键抽取器确实抓得到字段", () => {
    expect(keys.length).toBeGreaterThanOrEqual(6);
    expect(keys).toContain("windowConfig");
    expect(keys).toContain("selectionPolicy");
  });

  it("每个创建入参键都在域执行器（`request.`）或本 Router 端点段（`input.`）里被真的读到", () => {
    const executor = stripComments(read(new URL("executor.ts", MODULE_DIR)));
    const router = read(ROUTER);
    const wfEndpoints = router.slice(router.indexOf("WALK-FORWARD-001 — Walk-Forward 验证（时间滚动编排；规格 §13）"));

    const unread = keys.filter(
      (key) => !executor.includes(`request.${key}`) && !wfEndpoints.includes(`input.${key}`),
    );
    expect(
      unread,
      `以下字段被 schema 接受却从未影响执行 ⇒ 静默失效的旋钮：${unread.join(", ")}`,
    ).toEqual([]);
  });

  it("🔴 契约里不再有「参数空间覆盖」入参（搜索空间唯一来源 = 策略文档派生）", () => {
    expect(keys).not.toContain("parameterSearchSpace");
    expect(keys).not.toContain("parameterSpace");
  });
});

// ---------------------------------------------------------------------------
// §7 / §12 措辞守卫
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

describe("§7/§12 本域不产出「最佳 / 最优 / 推荐」型结论", () => {
  it("负例自测：检测器确实抓得到违规", () => {
    expect(findForbiddenClaims([{ name: "synthetic.ts", source: "const x = '最佳 Fold';" }])).toEqual([
      "synthetic.ts: 最佳",
    ]);
    expect(findForbiddenClaims([{ name: "synthetic.ts", source: "return 'Winner';" }]).length).toBe(1);
    expect(
      findForbiddenClaims([
        { name: "synthetic.ts", source: "// 本域严禁输出「最佳 / 最优 / 推荐」\nconst x = 1;" },
      ]),
    ).toEqual([]);
  });

  it("域内模块 + 域内 barrel + shared 契约零命中", () => {
    const files = [
      ...moduleSources(),
      { name: "walkForward/index.ts", source: read(new URL("index.ts", MODULE_DIR)) },
      { name: "shared/walkForwardContracts.ts", source: read(CONTRACTS) },
    ];
    expect(findForbiddenClaims(files)).toEqual([]);
  });

  it("本域契约与汇总对象里**没有**排序 / 评级 / 推荐字段", () => {
    const keys = (read(CONTRACTS).match(/^\s{2}([A-Za-z0-9_]+):/gm) ?? []).map((line) => line.trim());
    const joined = keys.join(" ").toLowerCase();
    for (const forbidden of ["best", "worst", "optimal", "recommend", "winner", "rank"]) {
      expect(joined.includes(forbidden), `契约字段不应含 ${forbidden}`).toBe(false);
    }
  });

  it("paramSearchRouter 的 Walk-Forward 端点段零命中", () => {
    const router = read(ROUTER);
    const start = router.indexOf("WALK-FORWARD-001 — Walk-Forward 验证（时间滚动编排；规格 §13）");
    expect(start).toBeGreaterThan(0);
    expect(findForbiddenClaims([{ name: "paramSearchRouter.ts#walkForward", source: router.slice(start) }])).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// §9 DB 纪律：只建两张表、零 DML、零外键
// ---------------------------------------------------------------------------

describe("§9 DB 纪律：migration 只建两张表、零 DML、零外键、可重复执行", () => {
  const sql = read(SQL_FILE);

  /** 剥**整行**注释（`-- @guard:` 之类）。行内 `--` 不剥：可能落在字符串字面量里。 */
  function stripLineComments(source: string): string {
    return source.replace(/^[ \t]*--[^\n]*$/gm, "");
  }

  /**
   * 抓 DML / 破坏性 DDL —— 只在**语句起点**判定。
   *
   * 🔴 为什么不能直接 `includes("UPDATE ")`：列定义里的
   *   `` `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP **ON UPDATE** CURRENT_TIMESTAMP ``
   *   是 **DDL**（自动维护时间戳），不是 `UPDATE t SET ...`。把两者混为一谈会逼着
   *   「为了让守卫变绿」去削弱表定义，那是本末倒置。守卫要钉的是「不写数据、不动已有结构」，
   *   而「语句起点」才是这两件事的准确边界。
   */
  function findDmlStatements(source: string): string[] {
    return [...stripLineComments(source).matchAll(
      /(?:^|;)[ \t]*(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/gim,
    )].map((m) => (m[1] ?? "").toUpperCase());
  }

  it("只 CREATE 两张 walk_forward_* 表（不多建第三张）", () => {
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?([A-Za-z0-9_]+)`?/gi)].map(
      (m) => m[1] ?? "",
    );
    expect(created.sort()).toEqual(["walk_forward_fold", "walk_forward_run"]);
  });

  it("负例自测：语句起点检测器抓得到真 DML，且不误伤 `ON UPDATE CURRENT_TIMESTAMP`", () => {
    expect(findDmlStatements("UPDATE walk_forward_run SET status = 'X';")).toEqual(["UPDATE"]);
    expect(findDmlStatements("CREATE TABLE t (id int);\nDELETE FROM walk_forward_fold;")).toEqual(["DELETE"]);
    expect(findDmlStatements("DROP TABLE walk_forward_run;")).toEqual(["DROP"]);
    // 列定义里的自动时间戳是 DDL，不得误伤
    expect(
      findDmlStatements(
        "CREATE TABLE t (\n  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP\n);",
      ),
    ).toEqual([]);
    // 注释里的 DML 不算
    expect(findDmlStatements("-- UPDATE nope\nCREATE TABLE t (id int);")).toEqual([]);
  });

  it("零 DML / 零 DDL 破坏性语句 / 零外键", () => {
    expect(findDmlStatements(sql)).toEqual([]);
    expect(/\bFOREIGN\s+KEY\b/i.test(sql)).toBe(false);
    expect(/\bREFERENCES\b/i.test(sql)).toBe(false);
  });

  it("apply 脚本自带零 DML 断言与幂等模式（--check / --dry-run / apply）", () => {
    const script = read(APPLY_SCRIPT);
    expect(script).toContain("--check");
    expect(script).toContain("--dry-run");
    expect(script).toContain("zeroDml");
    expect(script).toContain("0044_walk_forward.sql");
  });
});

// ---------------------------------------------------------------------------
// §14 前端：不排序 / 不评级 + 深链可达 + 长请求换文案
// ---------------------------------------------------------------------------

describe("§14 前端：面板不产出排序 / 评级，且按正常导航真的够得到", () => {
  const PANEL = new URL("../../../../client/src/components/walkForward/WalkForwardPanel.tsx", import.meta.url);
  const PAGE = new URL("../../../../client/src/pages/ParameterSearch.tsx", import.meta.url);
  const panel = read(PANEL);

  it("面板文件存在且被挂在既有页面里（接线完成 ≠ 够得到）", () => {
    const page = read(PAGE);
    expect(page).toContain("@/components/walkForward/WalkForwardPanel");
    expect(page).toContain("<WalkForwardPanel />");
  });

  it("🔴 面板源码（剥注释后）零「最佳 / 最优 / 推荐 / winner / best / optimal / recommend」", () => {
    expect(findForbiddenClaims([{ name: "WalkForwardPanel.tsx", source: panel }])).toEqual([]);
  });

  it("🔴 面板里没有任何**按指标**的排序（`sort` 只用于 Fold 序号与字典键）", () => {
    const code = stripComments(panel);
    /**
     * ⚠️ 不能用 `\.sort\(([^)]*)\)` 取参数：回调里本身带括号（`(a, b) => …`）会被提前截断。
     *   取「`sort(` 到行尾」才拿得到完整参数文本。
     */
    const sortArgs = [...code.matchAll(/\.sort\(([^\n]*)/g)].map((m) => (m[1] ?? ""));
    expect(sortArgs.length).toBeGreaterThan(0);
    expect(sortArgs.some((arg) => arg.includes("foldIndex"))).toBe(true);
    for (const arg of sortArgs) {
      for (const metric of [
        "totalReturnPct",
        "annualizedReturnPct",
        "maxDrawdownPct",
        "tradeCount",
        "winRatePct",
        "profitFactor",
        "mean",
        "median",
      ]) {
        expect(arg.includes(metric), `排序回调里不得出现指标字段 ${metric}`).toBe(false);
      }
    }
  });

  it("深链：选中 Run / Fold 必须写进 URL（刷新 / 分享可回到同一份详情）", () => {
    const code = stripComments(panel);
    expect(code).toContain("walkForwardRunId");
    expect(code).toContain("foldIndex");
    expect(code).toContain("setLocation");
    // 能读到 URL 上的深链参数（而不是只有内存态）
    expect(code).toContain("new URLSearchParams(search)");
  });

  it("🔴 长请求按钮 pending 必须换文案（执行是分钟级的逐 Fold 真实回测）", () => {
    const code = stripComments(panel);
    expect(code).toContain("isPending");
    expect(code).toContain("执行中…");
    expect(code).toContain("逐 Fold");
  });

  it("🔴 客户端不得 import `server/**`（前端只经 tRPC 取数）", () => {
    const offenders = importsOf(panel).filter((spec) => spec.includes("server/") || spec.startsWith("../../../../server"));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 命名不遮蔽守卫（本仓有多个 `export *` 全域 barrel）
// ---------------------------------------------------------------------------

describe("命名不遮蔽守卫：本域顶层导出名不得与仓内既有声明重名", () => {
  function topLevelExports(source: string): string[] {
    return [...stripComments(source).matchAll(
      /^export\s+(?:type|interface|const|function|async function|class)\s+([A-Za-z0-9_]+)/gm,
    )].map((m) => m[1] ?? "");
  }

  function sourceFilesUnder(dir: URL): URL[] {
    const base = fileURLToPath(dir);
    return readdirSync(base, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => pathToFileURL(`${entry.parentPath}\\${entry.name}`));
  }

  it("负例自测：确实能发现重名", () => {
    const a = topLevelExports("export interface SameName {}\n");
    const b = topLevelExports("export interface SameName {}\n");
    expect(a.filter((name) => b.includes(name))).toEqual(["SameName"]);
  });

  it("本域导出名与 server/** + shared/** 其余文件的顶层导出名零交集（`WALK_FORWARD_RUN_ID_PREFIX` 类坑）", () => {
    const own = new Set(moduleFiles().flatMap((name) => topLevelExports(read(new URL(name, MODULE_DIR)))));
    expect(own.size).toBeGreaterThan(20);
    const collisions: string[] = [];
    for (const url of [
      ...sourceFilesUnder(new URL("../../../../server/", import.meta.url)),
      ...sourceFilesUnder(new URL("../../../../shared/", import.meta.url)),
    ]) {
      const posix = url.pathname;
      if (posix.includes("/server/research/walkForward/")) continue;
      for (const name of topLevelExports(read(url))) {
        if (own.has(name)) collisions.push(`${name} ← ${posix.split("/").slice(-3).join("/")}`);
      }
    }
    expect([...new Set(collisions)]).toEqual([]);
  });

  it("🔴 本域 Run ID 前缀与 C-19.1 的 `WFA` 必须不同（否则留档无法区分两个域）", () => {
    const contract = stripComments(read(CONTRACTS));
    expect(contract).toContain('WALK_FORWARD_VALIDATION_RUN_ID_PREFIX = "WFV"');
    const c191 = stripComments(read(new URL("../../../../server/research/walkForwardRun/types.ts", import.meta.url)));
    expect(c191).toContain('WALK_FORWARD_RUN_ID_PREFIX = "WFA"');
    expect(c191).not.toContain('WALK_FORWARD_RUN_ID_PREFIX = "WFV"');
  });
});
