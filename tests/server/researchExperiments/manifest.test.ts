/**
 * RESEARCH-EXPERIMENT-001 · 真实清单 + 前端页面注册表的一致性测试
 *
 * 三条容易漏、且漏了不会报错的接缝，全部钉在这里：
 *   1. 清单里每个实验的定义都**能通过注册**（`validateExperimentDescriptor`）；
 *   2. 清单里每个实验的 `pageKey` 都在**前端页面注册表**里有组件
 *      —— 漏登记不会白屏（会降级），但会静默丢掉「实验自己的页面」，必须被测试抓住；
 *   3. 前端注册表里**没有多余条目**（映射指向了不存在的实验，说明改名后没同步）。
 *
 * 同时验证「独立实验体系不与旧 Research 结构耦合」这条边界（规格 §14）：
 * 新体系的源码里**不得**出现旧链路的结构字段名。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPERIMENT_DEFINITIONS } from "../../../research-experiments/manifest";
import { EXPERIMENT_PAGES, experimentPageOf } from "../../../client/src/researchExperiments/pages";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * 唯一的有界例外（RESEARCH-EXPERIMENT-002）：Experiment → Strategy 桥必须构造一个
 * 「旧行形状的载体」才能复用既有唯一转换器；该文件里旧字段只允许取 `null` / `0`
 * （补偿断言见对应用例），因此**不构成**对旧 Research 运行时的耦合。
 */
const BRIDGE_EXEMPTION_FILE = "server/researchExperiments/strategyBridge.ts";

/** 递归收集某目录下的源码文件（只收 .ts / .tsx，不含测试与 md）。 */
function collectSources(absoluteDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absoluteDir)) {
    const full = path.join(absoluteDir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSources(full));
      continue;
    }
    if (/\.(ts|tsx)$/u.test(entry)) out.push(full);
  }
  return out;
}

describe("清单 · 每个实验都能注册", () => {
  it("真实清单里至少有一个实验（示例必须存在，否则体系没有被验证过）", () => {
    expect(EXPERIMENT_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("逐个注册成功（元数据 / 参数 / Dataset 声明全部自洽）", () => {
    const registry = new ExperimentRegistry();
    for (const definition of EXPERIMENT_DEFINITIONS) {
      expect(() => registry.register(definition)).not.toThrow();
    }
    expect(registry.listIds().length).toBe(EXPERIMENT_DEFINITIONS.length);
  });

  it("示例实验的 id 与目录约定一致（`<组>/<实验>`）且 pageKey 与 id 相同", () => {
    const example = EXPERIMENT_DEFINITIONS.find((d) => d.descriptor.id === "first-board-pullback/entry-day");
    expect(example).toBeDefined();
    expect(example!.descriptor.pageKey).toBe("first-board-pullback/entry-day");
    // 示例必须使用真实数据（规格 §10 禁 mock）：声明的是真实数据集语义代码
    expect(example!.descriptor.datasetRequirement.datasetCode).toBe("first_limit_pullback");
    expect(example!.descriptor.datasetRequirement.usesForwardData).toBe(true);
  });
});

describe("接缝 · 服务端清单 ⇄ 前端页面注册表", () => {
  it("每个已注册实验的 pageKey 都能找到页面组件（漏登记会被这条抓住）", () => {
    for (const definition of EXPERIMENT_DEFINITIONS) {
      const pageKey = definition.descriptor.pageKey;
      expect(experimentPageOf(pageKey), `pageKey "${pageKey}" 未在前端注册`).not.toBeNull();
    }
  });

  it("前端注册表没有指向不存在实验的多余条目（改名后没同步会被这条抓住）", () => {
    const known = new Set(EXPERIMENT_DEFINITIONS.map((d) => d.descriptor.pageKey));
    for (const pageKey of Object.keys(EXPERIMENT_PAGES)) {
      expect(known.has(pageKey), `前端注册表里的 "${pageKey}" 没有任何实验使用它`).toBe(true);
    }
  });

  it("未知 pageKey 返回 null（由平台降级为通用渲染器）", () => {
    expect(experimentPageOf("no/such-page")).toBeNull();
  });
});

describe("边界 · 新体系不得耦合旧 Research 结构（规格 §14）", () => {
  const newSystemDirs = ["server/researchExperiments", "shared/researchExperimentsContracts.ts", "research-experiments"];

  it("源码里不出现旧链路的结构字段名与表名", () => {
    // 🔴 判据必须是**结构形态**，不能是裸子串 —— 契约文件的注释里**刻意引用了**
    //    `analysisId` / `findingIds` 等词来说明「禁止这些字段」。裸子串断言在这种情况下
    //    命中的是「否定式说明」，证明不了任何事（本会话第一版判据就是这么错的）。
    //
    //    因此这里只认两种形态：
    //      ① **字段声明**：`analysisId:` / `candidateId?:` —— 真的把它写进结构才会命中；
    //      ② **表名字符串字面量**：`"research_conclusion"` 这种真的引用了旧表的写法。
    const fieldDeclaration = /\b(findingIds\w*|conclusionId|analysisId|candidateId)\s*[:?]/u;
    const legacyTableLiteral = /["'`]research_(conclusion|finding|analysis|strategy_candidate)["'`]/u;
    const hits: string[] = [];
    for (const relative of newSystemDirs) {
      const absolute = path.join(REPO_ROOT, relative);
      const files = statSync(absolute).isDirectory() ? collectSources(absolute) : [absolute];
      for (const file of files) {
        const repoRelative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
        const text = readFileSync(file, "utf8");
        for (const [label, pattern] of [
          ["旧结构字段声明", fieldDeclaration],
          ["旧表名字面量", legacyTableLiteral],
        ] as const) {
          const match = pattern.exec(text);
          if (!match) continue;
          /**
           * 🔴 **一处有界的例外（RESEARCH-EXPERIMENT-002）**：
           *   `server/researchExperiments/strategyBridge.ts` 为了**复用既有唯一**
           *   `Candidate → StrategyDefinition` 转换器（`definitionBuild.ts`，其入参类型是旧
           *   Research 的**行类型**），必须构造一个「载体」对象 —— 它要填 `conclusionId` 这类
           *   字段名，但**从不写库、从不传真实旧 id**。
           *
           *   例外不是靠注释放行，而是**带补偿断言**：该文件里这些字段只允许取 `null` / `0`。
           *   一旦有人把真实旧 id 塞进来（= 真的耦合了旧 Research 坐标），本断言立刻变红。
           */
          if (repoRelative === BRIDGE_EXEMPTION_FILE) {
            /**
             * 🔴 补偿断言的写法有坑（本会话实测）：`\s*(?!null\b|0\b)` 会因为外层 `\s*`
             *    可以**回溯成零宽**，让负向断言落在「空格」上而**假通过** ⇒ 必须把空白也放进
             *    负向断言内部（`\s*(?!\s*(?:null\b|0\b))`）。
             */
            const strictPattern =
              /\b(findingIds\w*|conclusionId|analysisId|candidateId)\s*[:?]\s*(?!\s*(?:null\b|0\b))/u;
            const strictMatch = strictPattern.exec(text);
            if (strictMatch) {
              hits.push(`${repoRelative} → 例外文件里出现了**真实旧 id**（补偿断言）：${strictMatch[0]}`);
            }
            continue;
          }
          hits.push(`${repoRelative} → ${label}：${match[0]}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("不做文件系统发现（无 import.meta.glob / 无目录扫描调用）", () => {
    // 同样只认**调用形态**（带括号），不认注释里出现的词 ——
    // 两个文件的注释都写着「无 `import.meta.glob`」，裸子串断言会误报。
    // 实验同样**不得**做任何文件 IO：数据只能来自 Dataset 契约。
    const globCall = /import\.meta\.glob\s*\(/u;
    const fsCall = /\b(readdir|readdirSync|opendir|createReadStream|readFile|readFileSync)\s*\(/u;
    const hits: string[] = [];
    for (const relative of newSystemDirs) {
      const absolute = path.join(REPO_ROOT, relative);
      const files = statSync(absolute).isDirectory() ? collectSources(absolute) : [absolute];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        if (globCall.test(text)) hits.push(`${path.relative(REPO_ROOT, file)} (import.meta.glob)`);
        if (fsCall.test(text)) hits.push(`${path.relative(REPO_ROOT, file)} (文件 IO 调用)`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("实验页面不 import server/** 运行时（页面跑在浏览器里）", () => {
    const experimentRoot = path.join(REPO_ROOT, "research-experiments");
    const pages = collectSources(experimentRoot).filter((file) => file.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    for (const file of pages) {
      const text = readFileSync(file, "utf8");
      const runtimeImports = text
        .split("\n")
        .filter((line) => /^\s*import\s/u.test(line) && !/^\s*import\s+type\s/u.test(line));
      const offenders = runtimeImports.filter((line) => line.includes("server/"));
      expect(offenders, `${path.relative(REPO_ROOT, file)} 引入了 server 运行时`).toEqual([]);
      // 页面不得运行时 import experiment.ts（会把服务端计算带进 bundle）
      const experimentImports = runtimeImports.filter((line) => /["'][^"']*\/experiment["']/u.test(line));
      expect(experimentImports, `${path.relative(REPO_ROOT, file)} 运行时引入了 experiment.ts`).toEqual([]);
    }
  });
});
