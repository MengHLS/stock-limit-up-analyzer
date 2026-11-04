/**
 * RESEARCH-EXPERIMENT-004 — Object Key 规范（规格 §9）。
 *
 * ## 唯一规则（**稳定、可预测**）
 *
 * ```
 * experiments/<group>/<key>/runs/<runId>/manifest.json
 * experiments/<group>/<key>/runs/<runId>/result.json
 * experiments/<group>/<key>/runs/<runId>/tables/<name>
 * experiments/<group>/<key>/runs/<runId>/charts/<name>
 * experiments/<group>/<key>/runs/<runId>/logs/<name>
 * experiments/<group>/<key>/runs/<runId>/artifacts/<name>
 * ```
 *
 * 其中 `<group>/<key>` = 实验 id（与 `research-experiments/<组>/<实验>/` 目录一致）。
 *
 * ## 三条刻意的决定
 *
 *   1. **不用随机路径**：对象的位置由 (实验, Run, 角色, 名字) **完全决定** ⇒
 *      「这条 Run 的产物在哪」不需要查库、也不需要列举目录就能推出来，
 *      而且**同一 Run 重复 finalize 会写到同一个 Key**（幂等的前提）；
 *   2. **`runId` 里不允许出现 `/`、`..`、反斜杠**：否则调用方可以用一个 runId
 *      把对象写到别人的前缀下（key 注入）。这里**结构级拒绝**，不靠纪律；
 *   3. **角色段（tables/charts/logs/artifacts）是固定的**：前端据 Manifest 取对象，
 *      不猜路径；固定角色段让 `list(prefix)` 的语义也稳定。
 *
 * 🔴 本文件是 Object Key 的**唯一产生点**。任何其它地方都不许手拼 Key
 *    （手拼 = 第二套规则 = 迟早漂移）。
 */

import { ARTIFACT_STORAGE_ERROR, ArtifactStorageError } from "./types";

/** 实验 id：两段小写 kebab-case（与 `server/researchExperiments/registry.ts` 同形态）。 */
const EXPERIMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Run id：只允许 `[A-Za-z0-9._-]`，且不得以 `.` 开头（挡掉 `.` / `..`）。 */
const RUN_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** 实验 id 段 → 校验（不通过即抛，不「修一修再用」）。 */
export function assertExperimentIdForObjectKey(experimentId: string): string {
  if (!EXPERIMENT_ID_PATTERN.test(experimentId)) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `实验 id "${experimentId}" 不符合 Object Key 规范（应为两段小写 kebab-case，形如 \`<group>/<key>\`）`,
      { experimentId },
    );
  }
  return experimentId;
}

/** Run id 段 → 校验（挡 key 注入）。 */
export function assertRunIdForObjectKey(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `runId "${runId}" 不符合 Object Key 规范（只允许 [A-Za-z0-9._-]，且不得含 ".."）`,
      { runId },
    );
  }
  return runId;
}

/** Object Key 里 `runId` 之后的**固定角色段**。 */
export const EXPERIMENT_KEY_ROLES = ["tables", "charts", "logs", "artifacts"] as const;
export type ExperimentKeyRole = (typeof EXPERIMENT_KEY_ROLES)[number];

/** 文件名（相对 Name 段）校验：不得越界、不得为空、不得出现反斜杠 / 控制字符。 */
export function assertSafeRelativeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ArtifactStorageError(ARTIFACT_STORAGE_ERROR.KEY_INVALID, "Artifact 名字不得为空");
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Artifact 名字 "${name}" 不得以斜杠开头（它是相对 Run 前缀的名字，不是绝对路径）`,
      { name },
    );
  }
  if (trimmed.includes("\\")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Artifact 名字 "${name}" 不得含反斜杠（对象存储的层级一律用 "/"）`,
      { name },
    );
  }
  if (trimmed.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Artifact 名字 "${name}" 含越界段（"." / ".." / 空段）`,
      { name },
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Artifact 名字 "${name}" 含控制字符`,
      { name },
    );
  }
  return trimmed;
}

/** 全量 Object Key 校验（下载入口用它挡任意对象读取）。 */
export function assertSafeObjectKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new ArtifactStorageError(ARTIFACT_STORAGE_ERROR.KEY_INVALID, "Object Key 不得为空");
  }
  if (trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Object Key "${key}" 必须是相对键（不得以 "/" 开头、不得含反斜杠）`,
      { key },
    );
  }
  if (trimmed.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new ArtifactStorageError(
      ARTIFACT_STORAGE_ERROR.KEY_INVALID,
      `Object Key "${key}" 含越界段（"." / ".." / 空段）`,
      { key },
    );
  }
  return trimmed;
}

/** 一次 Run 的对象前缀（**所有**该 Run 的产物都在它下面）。 */
export function experimentRunKeyPrefix(experimentId: string, runId: string): string {
  assertExperimentIdForObjectKey(experimentId);
  assertRunIdForObjectKey(runId);
  return `experiments/${experimentId}/runs/${runId}`;
}

/** `manifest.json`（本次 Run 的 Artifact 索引）。 */
export function manifestObjectKey(experimentId: string, runId: string): string {
  return `${experimentRunKeyPrefix(experimentId, runId)}/manifest.json`;
}

/** `result.json`（结果信封本体）。 */
export function resultObjectKey(experimentId: string, runId: string): string {
  return `${experimentRunKeyPrefix(experimentId, runId)}/result.json`;
}

/** 固定角色段下的对象 Key。 */
export function roleObjectKey(
  experimentId: string,
  runId: string,
  role: ExperimentKeyRole,
  name: string,
): string {
  return `${experimentRunKeyPrefix(experimentId, runId)}/${role}/${assertSafeRelativeName(name)}`;
}

/** 表格产物（CSV / Parquet / …）。 */
export function tableObjectKey(experimentId: string, runId: string, name: string): string {
  return roleObjectKey(experimentId, runId, "tables", name);
}

/** 图表产物（svg / png / json 图表描述）。 */
export function chartObjectKey(experimentId: string, runId: string, name: string): string {
  return roleObjectKey(experimentId, runId, "charts", name);
}

/** 日志产物。 */
export function logObjectKey(experimentId: string, runId: string, name: string): string {
  return roleObjectKey(experimentId, runId, "logs", name);
}

/** 其它产物（图片 / 大型中间结果 / …）。 */
export function artifactObjectKey(experimentId: string, runId: string, name: string): string {
  return roleObjectKey(experimentId, runId, "artifacts", name);
}

/**
 * 某 Key 是否**结构上属于**这次 Run（在 `experiments/<group>/<key>/runs/<runId>/` 之下）。
 *
 * 🔴 这是下载入口的第一道闸：它只挡「走到别的 Run / 别的地方」；
 *    **真正的授权判据是「该 Key 出现在这条 Run 的 Manifest 里」**（见路由层），
 *    两道一起用 —— 结构闸挡穿越，Manifest 闸挡越权。
 */
export function isObjectKeyUnderRun(key: string, experimentId: string, runId: string): boolean {
  let prefix: string;
  try {
    prefix = `${experimentRunKeyPrefix(experimentId, runId)}/`;
  } catch {
    return false;
  }
  return key.startsWith(prefix);
}

/** 人读的 Key 规则说明（报告 / 诊断用；**不**参与任何判定）。 */
export function describeObjectKeyRule(): string {
  return [
    "experiments/{group}/{key}/runs/{runId}/manifest.json",
    "experiments/{group}/{key}/runs/{runId}/result.json",
    `experiments/{group}/{key}/runs/{runId}/{${EXPERIMENT_KEY_ROLES.join("|")}}/{name}`,
  ].join(" | ");
}
