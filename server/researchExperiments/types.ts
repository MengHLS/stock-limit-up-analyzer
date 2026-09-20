/**
 * RESEARCH-EXPERIMENT-001 — 独立研究实验体系：服务端类型面。
 *
 * ## 这个文件现在是**薄转出口**
 *
 * 实验作者契约（`ExperimentDefinition` / `ExperimentRunContext` / 取数句柄 /
 * `ExperimentResultPayload` / …）已迁移到 **`shared/researchExperimentsContracts.ts`**。
 *
 * 为什么迁移：实验目录位于仓库根 `research-experiments/<组>/<实验>/`，**层级不固定**
 * （模板在 2 层、示例在 3 层）⇒ 用相对路径 import 服务端类型会因**复制目录而静默失效**
 * （`TS2307` 只在 `tsc` 时才暴露）。放在 `shared` 里，实验一律写
 * `import type { … } from "@shared/researchExperimentsContracts"`，**与目录深度无关**。
 *
 * 本文件保留为「服务端内部统一类型入口」：`server/researchExperiments/**` 继续
 * `import type { … } from "./types"`，不因为契约搬家而到处改 import 路径。
 */

export type {
  ExperimentBarRow,
  ExperimentDatasetAccess,
  ExperimentDatasetFacts,
  ExperimentDeclaredRow,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
