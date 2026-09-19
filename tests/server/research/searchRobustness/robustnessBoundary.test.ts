/**
 * ROBUSTNESS-001 §4 / §21 A·B — 静态守卫（**把两条纪律变成可执行事实，而不是文档承诺**）。
 *
 * ## 守卫 1：`searchRobustness/**` 不得 import 任何「会重跑」的模块
 *
 * 规格 §21 A/B 要求「没有重跑 Backtest、没有重算 canonical metrics」。运行时证据由
 * `_e2e_robustness_search.mts` 给出（源结果 digset 逐字节不变）；本守卫给的是**结构性证据**：
 * 该模块**根本拿不到**回测 / 评估端口的入口。
 *
 * 🔴 为什么两条都要：运行时证据只能证明「这一次没重跑」，静态守卫证明「**不可能**重跑」。
 *
 * ## 守卫 2：不得出现「最佳 / 最优 / 推荐 / winner / best / optimal」结论性词汇
 *
 * 规格 §4 明确禁止把描述性排序包装成投资建议。本守卫扫描**剥掉注释后的源码**
 * （注释里引用禁令原文是允许的，代码与用户可见文案不允许）。
 *
 * 🔴 守卫自身必须做**负例自测**（正例能被抓到、干净样例不误报）——否则「全绿」证明不了任何事。
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE_DIR = new URL("../../../../server/research/searchRobustness/", import.meta.url);
const CONTRACTS = new URL("../../../../shared/searchRobustnessContracts.ts", import.meta.url);
const PANEL = new URL("../../../../client/src/components/robustness/SearchRobustnessPanel.tsx", import.meta.url);
const ROUTER = new URL("../../../../server/paramSearchRouter.ts", import.meta.url);

/** 读文件（LF 文本）。 */
function read(url: URL): string {
  return readFileSync(fileURLToPath(url), "utf8");
}

/** 模块内全部 `.ts` 文件路径。 */
function moduleFiles(): string[] {
  return readdirSync(fileURLToPath(MODULE_DIR))
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

/**
 * 剥注释（`//` 行内 + `/* *\/` 块）。
 *
 * ⚠️ 刻意**不**用「按行首是否 `//`」的简化版：块注释与行尾注释都会漏掉，
 *   而那正是禁令原文最可能出现的位置（文件头说明）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 结论性禁用词（中英）。 */
const FORBIDDEN = ["最佳", "最优", "推荐", "winner", "best", "optimal", "recommend"];

/** 在剥注释后的源码里找禁用词（返回 `文件: 命中词` 列表）。 */
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

// ---------------------------------------------------------------------------
// 守卫 1：结构上拿不到「会重跑」的入口
// ---------------------------------------------------------------------------

describe("静态守卫：稳健性域结构性不可重跑（§21 A/B）", () => {
  /** 这些模块一旦被 import，就等于把「重跑回测 / 重算指标」的入口带了进来。 */
  const RERUN_MODULES = [
    "research/backtest",
    "backtest/types",
    "strategyEvaluation",
    "closedLoop",
    "realisticBacktest",
    "strategyCore",
    "runWorkbenchAssembly",
    "researchEngine",
    "leaderCandidates",
  ];

  it("模块内**任何** import 路径都不指向回测 / 评估端口", () => {
    const offenders: string[] = [];
    for (const name of moduleFiles()) {
      const source = read(new URL(name, MODULE_DIR));
      const body = stripComments(source);
      // 静态 import + 动态 import 都要查。
      const specs = [...body.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
      for (const spec of specs) {
        if (RERUN_MODULES.some((token) => spec.includes(token))) {
          offenders.push(`${name} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("模块只从既有的三处只读来源读数据（parameterSearch 读函数 / 本体 schema / shared 契约）", () => {
    const allowedPrefixes = [
      "../../../shared/", // 契约（唯一权威）+ shared/quant-stats（统计唯一权威）
      "../../../drizzle/schema", // 表定义（drizzle 类型）
      "drizzle-orm", // SQL 构造器（与既有仓储同款）
      "../../db", // getDb
      "../../researchDataset/version", // canonicalStringify（唯一权威）
      "../experimentValidation", // ResearchValidationError（唯一权威）
      "../types", // 研究域参数值类型（与既有 ResearchParameterSet 同域）
      "../parameterSearch/", // 既有读函数与状态机（唯一权威）
      "./", // 模块内部
      "node:", // 标准库
    ];
    const unexpected: string[] = [];
    for (const name of moduleFiles()) {
      const body = stripComments(read(new URL(name, MODULE_DIR)));
      const specs = [...body.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
      for (const spec of specs) {
        if (!allowedPrefixes.some((prefix) => spec.startsWith(prefix))) {
          unexpected.push(`${name} → ${spec}`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 守卫 2：不得产出「最佳 / 最优 / 推荐」型结论
// ---------------------------------------------------------------------------

describe("静态守卫：不产出「最佳 / 最优 / 推荐」（§4）", () => {
  it("负例自测：检测器确实抓得到违规（否则下面的「全绿」证明不了任何事）", () => {
    expect(findForbiddenClaims([{ name: "synthetic.ts", source: "const x = '综合评分最高的最佳参数';" }])).toEqual([
      "synthetic.ts: 最佳",
    ]);
    expect(
      findForbiddenClaims([{ name: "synthetic.ts", source: "if (score > 0) return 'Winner';" }]).length,
    ).toBe(1);
    // 注释里引用禁令原文**不算**违规（剥注释后不看）
    expect(
      findForbiddenClaims([{ name: "synthetic.ts", source: "// 本模块严禁输出「最佳 / 最优 / 推荐」\nconst x = 1;" }]),
    ).toEqual([]);
  });

  it("搜索稳健性域（模块 + 契约 + 前端面板）零命中", () => {
    const files: Array<{ name: string; source: string }> = [
      ...moduleFiles().map((name) => ({ name: `searchRobustness/${name}`, source: read(new URL(name, MODULE_DIR)) })),
      { name: "shared/searchRobustnessContracts.ts", source: read(CONTRACTS) },
      { name: "client/.../SearchRobustnessPanel.tsx", source: read(PANEL) },
    ];
    expect(findForbiddenClaims(files)).toEqual([]);
  });

  it("paramSearchRouter 的 ROBUSTNESS-001 端点段零命中", () => {
    const router = read(ROUTER);
    const marker = "ROBUSTNESS-001 — Search-Result Robustness Analysis（消费冻结结果";
    const start = router.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    const segment = router.slice(start);
    expect(findForbiddenClaims([{ name: "paramSearchRouter.ts#robustness", source: segment }])).toEqual([]);
  });
});
