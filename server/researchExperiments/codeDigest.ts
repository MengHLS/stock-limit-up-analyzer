/**
 * 独立实验定义指纹。
 *
 * 这是 `experimentVersion` 之外的执行身份：作者忘记升版本时，Run 仍能证明
 * 当时注册到 Runner 的 descriptor / run() / resultSchema 与其它 Run 不同。
 *
 * 边界：函数源码指纹能覆盖实验文件内的直接改动；被 run() 引用的外部 helper
 * 若单独变化，仍需通过实验版本升级或后续构建产物指纹补齐。
 */

import { createHash } from "node:crypto";
import { serializeCanonical } from "../research/searchRobustness/canonical";
import type { ExperimentDefinition } from "./types";

export const EXPERIMENT_CODE_DIGEST_PREFIX = "exp-code-sha256:";

export function computeExperimentCodeDigest(definition: ExperimentDefinition): string {
  const payload = {
    descriptor: definition.descriptor,
    runSource: definition.run.toString(),
    resultSchemaSource: definition.resultSchema.toString(),
  };
  const digest = createHash("sha256")
    .update(serializeCanonical(payload))
    .digest("hex");
  return `${EXPERIMENT_CODE_DIGEST_PREFIX}${digest}`;
}
