/**
 * 独立研究实验 · 注册清单（**唯一**需要人工改动的注册点之一）。
 *
 * ## 新增一个实验：两步
 *
 * 1. 本文件：加 1 行 `import`，并在 `EXPERIMENT_DEFINITIONS` 数组里加 1 项；
 * 2. `client/src/researchExperiments/pages.ts`：加 1 行页面注册（`pageKey → 组件`）。
 *
 * 两步之外**不需要**改任何核心代码（不改 Research Core、不改 Strategy Core、
 * 不改 tRPC 路由、不改数据库）。详见 `docs/research/EXPERIMENT-CODE-SPEC.md`。
 *
 * ## 为什么是显式清单而不是目录扫描
 *
 * 本仓库约定「**无目录扫描、无 `import.meta.glob`、无 codegen**」
 * （先例：`server/research/patternLibrary/patterns/index.ts`）。
 * 显式清单可 diff、可 code review、在 vitest / esbuild 下行为确定 ——
 * 对研究平台来说，「可复现」优先于「魔法自动发现」。
 */

import type { ExperimentDefinition } from "../server/researchExperiments/types";
import { entryDayExperiment } from "./first-board-pullback/entry-day/experiment";
import { fundamentalStudyExperiment } from "./first-board-pullback/fundamental-study/experiment";

/** 全部已注册实验（顺序不参与任何计算；registry 内部按 id 排序输出）。 */
export const EXPERIMENT_DEFINITIONS: readonly ExperimentDefinition[] = [
  entryDayExperiment,
  fundamentalStudyExperiment,
];
