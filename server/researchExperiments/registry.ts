/**
 * RESEARCH-EXPERIMENT-001 — 实验注册表（**最小 Registry**，规格 §11）。
 *
 * ## 为什么不是「文件系统自动发现」
 *
 * 本仓库已固化一条约定：**无目录扫描、无 `import.meta.glob`、无 codegen**
 * （`docs/research/PLAN-STRATEGY-MODULE-EXTENSION-001.md`；先例 = `server/research/patternLibrary/patterns/index.ts`
 * 的「显式清单：新增一种交易模式只需要在这里加一行」）。理由是可复现性 > 架构完整性：
 * 显式清单可 diff、可 code review、在 vitest / esbuild 下行为确定。
 *
 * 因此本体系按同构方式实现（规格 §11 明确允许「最小 Registry」）：
 *
 * ```
 * research-experiments/manifest.ts        ← 新增实验：加 1 行 import + 1 行数组项
 * client/src/researchExperiments/pages.ts ← 新增实验：加 1 行页面注册（卡片式页面）
 * ```
 *
 * **零核心引擎改动**：`register()` 只在注册表内部写一个 Map，
 * 没有 switch/case、没有需要跟着改的 `ResearchCore` / `StrategyCore`。
 *
 * ## 注册时即校验元数据
 *
 * 「注册」是唯一能保证「元数据自洽」的时机 —— 与其等到用户点运行时才炸，
 * 不如让不合规的定义**根本注册不进来**（`EXPERIMENT_METADATA_INVALID`）。
 */

import {
  DATASET_CODE_PATTERN,
} from "../../shared/datasetRegistryContracts";
import type { ExperimentDescriptor } from "@shared/researchExperimentsContracts";
import { ExperimentError, experimentAssert } from "./errors";
import type { ExperimentDefinition } from "./types";

/** 实验 id 形态：`<group>/<key>`，两段都是小写 kebab-case。 */
const EXPERIMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 校验实验描述符（**元数据契约测试的权威实现**）。
 *
 * 校验项与「为什么必须在这里拒绝」：
 *   1. `id` 形态 —— 前端要用它作 URL 片段与页面注册键，形态漂移会让深链失效；
 *   2. 参数 code 唯一 —— 重复 code 会让「参数归并默认值」静默丢掉一个；
 *   3. 非必填参数必须有 `defaultValue` —— 否则运行时会出现「没有值的参数」，只能靠默认 0 兜底；
 *   4. `ENUM` 必须有 `allowedValues`，且默认值必须落在其中 —— 否则该参数永远无法合法取值；
 *   5. `bounds.min ≤ bounds.max`；
 *   6. `datasetCode` 必须符合 Dataset 域命名规范（复用**既有**正则，不新造）；
 *   7. 声明了 post 相对日 ⇒ 必须 `usesForwardData: true`（否则就是「偷偷读未来数据」）；
 *   8. `usesForwardData: true` ⇒ 必须写 `forwardDataPurpose`（用途要进留档，不能只写在注释里）；
 *   9. 至少要声明一个要读的列（不读数据的实验没有意义，多半是写错了）。
 */
export function validateExperimentDescriptor(
  descriptor: ExperimentDescriptor,
): void {
  const fail = (message: string, detail?: unknown): never => {
    throw new ExperimentError("EXPERIMENT_METADATA_INVALID", message, detail);
  };

  if (!EXPERIMENT_ID_PATTERN.test(descriptor.id)) {
    fail(
      `实验 id "${descriptor.id}" 形态非法：必须是 <group>/<key>，两段均为小写 kebab-case`,
      { id: descriptor.id },
    );
  }
  if (descriptor.version.trim() === "") fail("实验 version 不得为空", { id: descriptor.id });
  if (descriptor.source.trim() === "") fail("实验 source 不得为空", { id: descriptor.id });
  if (descriptor.pageKey.trim() === "") fail("实验 pageKey 不得为空", { id: descriptor.id });

  // ---- 参数定义 ----
  const codes = new Set<string>();
  for (const param of descriptor.parameters) {
    if (codes.has(param.code)) {
      fail(`参数 code 重复："${param.code}"（重复会让默认值归并静默丢项）`, { code: param.code });
    }
    codes.add(param.code);
    const required = param.required === true;
    if (!required && param.defaultValue === undefined) {
      fail(`参数 "${param.code}" 非必填却没有 defaultValue`, { code: param.code });
    }
    if (param.kind === "ENUM") {
      const allowed = param.allowedValues ?? [];
      if (allowed.length === 0) {
        fail(`ENUM 参数 "${param.code}" 必须给出 allowedValues`, { code: param.code });
      }
      if (typeof param.defaultValue === "string" && !allowed.includes(param.defaultValue)) {
        fail(
          `ENUM 参数 "${param.code}" 的 defaultValue "${param.defaultValue}" 不在 allowedValues 内`,
          { code: param.code, allowed },
        );
      }
    }
    if (param.kind !== "ENUM" && (param.allowedValues ?? []).length > 0) {
      fail(`非 ENUM 参数 "${param.code}" 不得声明 allowedValues`, { code: param.code });
    }
    const bounds = param.bounds ?? null;
    if (bounds && bounds.min !== null && bounds.min !== undefined && bounds.max !== null && bounds.max !== undefined) {
      if (bounds.min > bounds.max) {
        fail(`参数 "${param.code}" 的 bounds.min > bounds.max`, { code: param.code, bounds });
      }
    }
  }

  // ---- Dataset 需求 ----
  const req = descriptor.datasetRequirement;
  if (!DATASET_CODE_PATTERN.test(req.datasetCode)) {
    fail(`datasetCode "${req.datasetCode}" 不符合 Dataset 命名规范`, { datasetCode: req.datasetCode });
  }
  for (const day of req.prefixRelativeDays ?? []) {
    if (!Number.isInteger(day) || day > 0) {
      fail(`prefixRelativeDays 只允许 ≤ 0 的整数，实际 ${day}`, { day });
    }
  }
  for (const day of req.postRelativeDays ?? []) {
    if (!Number.isInteger(day) || day < 1) {
      fail(`postRelativeDays 只允许 ≥ 1 的整数，实际 ${day}`, { day });
    }
  }
  if ((req.postRelativeDays ?? []).length > 0 && req.usesForwardData !== true) {
    fail(
      "声明了 postRelativeDays（rd ≥ 1）却没有 usesForwardData: true —— 读事件日之后的数据必须显式声明",
      { postRelativeDays: req.postRelativeDays },
    );
  }
  if (req.usesForwardData === true && (req.forwardDataPurpose ?? "").trim() === "") {
    fail("usesForwardData: true 时必须写 forwardDataPurpose（这些未来数据用来做什么）");
  }
  if (req.decisionOffsetDays !== null && req.decisionOffsetDays < 1) {
    fail(`decisionOffsetDays 必须 ≥ 1 或为 null，实际 ${String(req.decisionOffsetDays)}`);
  }
  const declaredColumns =
    (req.requiredColumns.events ?? []).length +
    (req.requiredColumns.feature ?? []).length +
    (req.requiredColumns.observation ?? []).length;
  if (declaredColumns === 0) {
    fail("requiredColumns 至少要声明一个要读的列（events / feature / observation）");
  }

  const aliases = new Set<string>();
  for (const auxiliary of descriptor.auxiliaryDatasetRequirements ?? []) {
    if (auxiliary.alias === "primary") {
      fail(`辅助 Dataset alias 不得使用保留名 "primary"`, { alias: auxiliary.alias });
    }
    if (aliases.has(auxiliary.alias)) {
      fail(`辅助 Dataset alias 重复："${auxiliary.alias}"`, { alias: auxiliary.alias });
    }
    aliases.add(auxiliary.alias);
  }
}

/** 实验注册表（注册即校验；重复注册具名拒绝，不静默覆盖）。 */
export class ExperimentRegistry {
  private readonly experiments = new Map<string, ExperimentDefinition>();

  register(definition: ExperimentDefinition): void {
    const { descriptor } = definition;
    experimentAssert(
      typeof definition.run === "function",
      "EXPERIMENT_METADATA_INVALID",
      `实验 "${descriptor.id}" 的 run() 不是函数`,
    );
    if (this.experiments.has(descriptor.id)) {
      throw new ExperimentError(
        "EXPERIMENT_METADATA_INVALID",
        `实验已注册，禁止覆盖：${descriptor.id}`,
      );
    }
    validateExperimentDescriptor(descriptor);
    this.experiments.set(descriptor.id, definition);
  }

  has(id: string): boolean {
    return this.experiments.has(id);
  }

  get(id: string): ExperimentDefinition | undefined {
    return this.experiments.get(id);
  }

  /** 取实验；不存在 → 抛领域错误（不返回 undefined 让调用方猜）。 */
  require(id: string): ExperimentDefinition {
    const found = this.experiments.get(id);
    if (found === undefined) {
      throw new ExperimentError(
        "EXPERIMENT_NOT_FOUND",
        `未注册的实验："${id}"（已注册：${this.listIds().join(" / ") || "（空）"}）`,
        { experimentId: id, registered: this.listIds() },
      );
    }
    return found;
  }

  /** 已注册实验 id（升序，稳定）。 */
  listIds(): string[] {
    return [...this.experiments.keys()].sort((a, b) => a.localeCompare(b));
  }

  /** 已注册实验定义（按 id 升序）。 */
  list(): ExperimentDefinition[] {
    return this.listIds().map((id) => this.experiments.get(id)!);
  }
}
