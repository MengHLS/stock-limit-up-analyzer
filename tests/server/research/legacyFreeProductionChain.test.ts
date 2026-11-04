/**
 * RESEARCH-EXPERIMENT-002 · **依赖 Gate**（可执行形态）。
 *
 * ## 本文件回答的问题（规格 §13 的核心）
 *
 * > 「旧 Analysis / Finding / Conclusion **删除**后，Strategy / Parameter Search / Backtest /
 * > OOS / WFA / Robustness 会不会失败？」
 *
 * 答案必须由**结构事实**给出，而不是靠 review 结论。因此这里从生产链入口出发做
 * **本地 import 图可达性**：
 *
 * ```text
 * 入口（paramSearch / walkForward / strategyEvaluation / researchRun / db / assemble …）
 *   ↓ 逐跳跟随**运行时** import（`import` 与 `export … from` 都算；纯类型不算）
 * 全可达文件集合
 *   ↓ 断言
 * ① 其中**没有**任何 `server/researchCore/**` 或 `server/researchEngine/**` 文件；
 * ② 其中**没有**任何文件从 `drizzle/schema` import 旧 Research 表对象。
 * ```
 *
 * ## 为什么要走图而不是逐文件 grep（本轮实测）
 *
 * 解耦前真实存在一条**传递**依赖：
 * `assemble.ts → patternLibrary/strategyConsumption → patternLibrary/index →（再导出）
 * patternLibrary/project → researchEngine/planner/moduleRegistry`。
 * 逐文件看谁都「不认识旧 Research」—— 只有走图才看得见。
 *
 * ## 判据实现本身的两个坑（都真踩过，写在这里防重犯）
 *
 * 1. **不能用正则抓 import**：会漏掉 `export { … } from "./x"` 这类再导出
 *    ⇒ 把「经 barrel 再导出」的传递依赖判成不可达（**假 PASS**）。故 `_importGraph.ts`
 *    用 TS AST。
 * 2. **不能拿正则扫源码判「引用了旧表」**：`assemble.ts` 的**注释**里出现 `researchRun.loopRun`
 *    （那是 router key，不是表对象）⇒ 正则会把注释命中误判成依赖。故只看 **import 声明**。
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  collectReachable,
  namedImportsFrom,
  rel,
  shortestPathTo,
} from "./_importGraph";

/** 生产链入口（= 002 要解耦的全部对象）。 */
const PRODUCTION_ENTRIES = [
  "server/db.ts",
  "server/runWorkbenchAssembly/datasetFromRegistry.ts",
  "server/runWorkbenchAssembly/assemble.ts",
  "server/research/strategyEvaluation/evaluate.ts",
  "server/research/strategyEvaluation/backtestBridge.ts",
  "server/research/parameterSearch/executor.ts",
  "server/research/oosValidation/executor.ts",
  "server/research/walkForward/executor.ts",
  "server/research/searchRobustness/executor.ts",
  "server/closedLoopBacktestRun/repository.ts",
  "server/reviewRouter.ts",
  "server/paramSearchRouter.ts",
  "server/walkForwardRouter.ts",
  "server/researchRunRouter.ts",
  /**
   * 🔴 **不把 `server/researchExperiments/strategyBridge.ts` 放进本 Gate 的入口**。
   *
   * 理由（本轮实测定性）：它是一座**边界适配器**，为了复用既有唯一
   * `Candidate → StrategyDefinition` 转换器，必须持有旧 Research 的**行形状**载体
   * ⇒ 它的可达集里必然有 `researchCore`（与既有 `server/research/strategyCandidate/**`
   * 同一性质：全仓**允许**同时看见两侧的边界层）。
   *
   * 它不是「生产计算链」：只在 `experimentStrategy.createFromExperiment` 被调用时才执行，
   * **不参与** PS / Backtest / OOS / WFA / Robustness 的任何一次运行。
   * 它的边界另有专属断言（见文件尾「桥是边界层」一节）。
   */
];

const LEGACY_DIR_PREFIXES = ["server/researchCore/", "server/researchEngine/"];

/** 旧 Research 表对象名（drizzle/schema 导出）。 */
const LEGACY_TABLE_OBJECTS = [
  "researchExperiment",
  "researchRun",
  "researchAnalysis",
  "researchAnalysisCondition",
  "researchResult",
  "researchFinding",
  "researchConclusion",
  "researchArtifact",
  "researchStrategyCandidate",
];

describe("依赖 Gate · 生产链不传递依赖旧 Research", () => {
  it("可达集里没有 server/researchCore/** 或 server/researchEngine/**（走 import 图，非逐文件 grep）", () => {
    const { files } = collectReachable(PRODUCTION_ENTRIES);
    const reachable = [...files].map(rel);
    const legacy = reachable.filter((file) =>
      LEGACY_DIR_PREFIXES.some((prefix) => file.startsWith(prefix)),
    );
    // 失败时给出「它是怎么被拉进来的」——否则排查要从头走一遍图。
    const chains = legacy.map((file) => shortestPathTo(PRODUCTION_ENTRIES, (item) => item === file));
    expect(legacy, `可达的旧 Research 文件及其路径：\n${JSON.stringify(chains, null, 2)}`).toEqual([]);
  });

  it("可达集里没有任何文件从 drizzle/schema import 旧 Research 表对象", () => {
    const { files } = collectReachable(PRODUCTION_ENTRIES);
    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) === "drizzle/schema.ts") continue;
      const imported = namedImportsFrom(file, "drizzle/schema");
      const hits = imported.filter((name) => LEGACY_TABLE_OBJECTS.includes(name));
      if (hits.length > 0) offenders.push(`${rel(file)} → ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("入口自身存在于仓库（清单写错会让上两条**假通过**）", () => {
    const { files } = collectReachable(PRODUCTION_ENTRIES);
    // 若某个入口路径写错，可达集会静默少一棵子树 ⇒ 必须显式断言入口都被解析到了。
    expect(files.size).toBeGreaterThan(100);
    for (const entry of PRODUCTION_ENTRIES) {
      const absolute = `${REPO_ROOT}\\${entry.split("/").join("\\")}`;
      expect([...files].some((file) => file === absolute), `入口未解析：${entry}`).toBe(true);
    }
  });

  it("旧 Research 的**入口文件已不存在**（RESEARCH-EXPERIMENT-003 起：目录已整体删除）", () => {
    // 🔴 判据已被 RESEARCH-EXPERIMENT-003 **反转**。
    //
    // 002 时这条断言是「旧 Research 子图确实存在（否则本 Gate 是空断言）」——那时的逻辑是：
    // 「可达集里没有旧 Research」只有在其**真的还在**时才有意义。
    // 003 把 `server/researchCore/**` 与 `server/researchEngine/**` **整体删除**之后，
    // 这条反空断言的目标变成了「确认它们**真的没了**」——否则上两条会变成
    // 「什么都没检查」的假绿（例如有人误把目录恢复回来而没被任何断言发现）。
    expect(existsSync(join(REPO_ROOT, "server", "researchCore", "index.ts"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "server", "researchEngine", "engine.ts"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "server", "researchEngineRouter.ts"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "server", "researchPlannerRouter.ts"))).toBe(false);
  });
});

/**
 * 桥的边界：它是**有意为之的边界层**（与 `server/research/strategyCandidate/**` 同纪律），
 * 因此对它的要求不是「够不到旧 Research」，而是「**只有允许的文件可以够到**」——
 * 与既有 `importBoundary.test.ts` 的白名单同构（这里只钉新体系这一侧）。
 */
/**
 * 新体系**内部的边界**：允许够到旧 Research 目录的文件必须是**具名白名单**。
 *
 * 为什么需要这一层：001 的 Experiment 体系有两条**有意为之**的旧目录依赖 ——
 *   ① `datasetPort.ts` 复用 **Research 侧唯一 Dataset 读取层**（`researchEngine/datasetReader`）
 *      —— 那是「读取层」，不是旧 Research 的**分析实体**；
 *   ② `strategyBridge.ts` 为复用**唯一** `Candidate → StrategyDefinition` 转换器而持有旧行形状载体。
 * 两者都会让「文件 → 旧目录」在图上可达。若不做白名单，将来任何人在新体系里随手 import
 * 一个旧 Research 的分析模块也**不会被发现**。
 */
describe("依赖 Gate · 新体系够到旧 Research 目录的通道是具名白名单", () => {
  /** 允许可达旧目录的新体系文件（**新增成员必须显式改这里**，等于一次 code review）。 */
  const ALLOWED = new Set([
    "server/researchExperiments/datasetPort.ts", // ① 复用 Dataset 读取层
    "server/researchExperiments/strategyBridge.ts", // ② 复用唯一转换器
    "server/researchExperiments/defaults.ts", // 装配（含 Dataset 读取层与桥）
    "server/researchExperiments/runner.ts", // 经 datasetPort 的类型/校验函数
    "server/researchExperiments/router.ts", // barrel 级装配
    "server/researchExperiments/strategyBridgeRouter.ts", // 经桥
    "server/researchExperiments/index.ts", // barrel（再导出以上）
    "server/researchExperiments/registryDefaults.ts", // 纯清单（当前不可达旧目录，留作稳定）
  ]);

  it("除白名单外，新体系文件不得够到 server/researchCore/** 或 server/researchEngine/**", () => {
    const { files } = collectReachable(["server/researchExperiments/index.ts"]);
    const scoped = [...files].map(rel).filter((file) => file.startsWith("server/researchExperiments/"));
    const offenders: string[] = [];
    for (const file of scoped) {
      if (ALLOWED.has(file)) continue;
      const sub = collectReachable([file]);
      const legacy = [...sub.files]
        .map(rel)
        .filter((item) => item.startsWith("server/researchCore/") || item.startsWith("server/researchEngine/"));
      if (legacy.length > 0) offenders.push(`${file} → ${legacy.slice(0, 3).join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("新体系**自己的文件**没有从 drizzle/schema import 旧 Research 表对象（结构事实）", () => {
    const { files } = collectReachable(["server/researchExperiments/index.ts"]);
    const offenders: string[] = [];
    for (const file of files) {
      // 🔴 只看**新体系自己的文件**：可达集里包含旧 Research（经白名单那两处通道），
      //    而旧文件**本来就会** import 自己的表对象 —— 把它算作违规是判据口径错（本会话踩过）。
      const relative = rel(file);
      if (
        !relative.startsWith("server/researchExperiments/")
        && !relative.startsWith("research-experiments/")
      ) {
        continue;
      }
      if (relative === "drizzle/schema.ts") continue;
      const hits = namedImportsFrom(file, "drizzle/schema").filter((name) =>
        LEGACY_TABLE_OBJECTS.includes(name),
      );
      if (hits.length > 0) offenders.push(`${relative} → ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("桥的旧字段只允许取 null / 0（补偿断言：不得传真实旧 id）", () => {
    const source = readFileSync(`${REPO_ROOT}/server/researchExperiments/strategyBridge.ts`, "utf8");
    const strict = /\b(findingIds\w*|conclusionId|analysisId|candidateId)\s*[:?]\s*(?!\s*(?:null\b|0\b))/u;
    expect(strict.exec(source)?.[0] ?? null).toBeNull();
  });
});
