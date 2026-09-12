/**
 * STEP DATASET-001 — Dataset 物理表命名规范（唯一权威来源，纯函数）。
 *
 * 全局规范：`ds_{dataset_code}_{role}`
 *   - `ds_`：固定前缀，表示 Dataset Data Layer。
 *   - `dataset_code`：稳定、语义明确、业务唯一的代码（lowercase snake_case，
 *     不含 version / 日期 / 环境名 / 随机 UUID，不随 Version 变化）。
 *   - `role`：event / prefix / post / path / outcome / feature。
 *
 * 事件窗口五表分层（DATABASE_REDESIGN §2.1）：
 *   - `event`   时点身份（不含逐日行情）
 *   - `prefix`  原始行情，`relativeDay ∈ [-preWindowDays, 0]`（后视，PIT 安全特征）
 *   - `post`    原始行情，`relativeDay ∈ [1, postWindowDays]`（前视，回测撮合 / 标签）
 *   - `path`    衍生指标，`relativeDay ∈ [1, postWindowDays]`（前视，仅打标签）
 *   - `outcome` 按 horizon 聚合结果
 * prefix / post **严格同构**（仅相对日区间不同），由同一段 DDL 生成器产出。
 *
 * 反例（禁止）：
 *   ds_first_limit_pullback_v1_event（含 version）
 *   ds_first_limit_pullback_202609_event（含日期）
 *   ds_first_limit_pullback_test_event（含环境）
 *   dataset_001_event（非 ds_ 前缀、含序号）
 *
 * 本模块只做命名规则与校验，不承载 IO / 策略 / 因子逻辑。
 */

import {
  DATASET_CODE_FORBIDDEN_PATTERNS,
  DATASET_CODE_PATTERN,
  DATASET_VERSION_LABEL_PATTERN,
} from "../../shared/datasetRegistryContracts";

/**
 * Dataset 物理表角色。
 *
 * 顺序即「事件窗口」的天然层级（身份 → 后视事实 → 前视事实 → 前视衍生 → 聚合 → 可选特征），
 * `resolveDefinitionTables` 依赖该顺序输出稳定的表清单。
 */
export const DATASET_ROLES = ["event", "prefix", "post", "path", "outcome", "feature"] as const;
export type DatasetRole = (typeof DATASET_ROLES)[number];

/** dataset_code 正则：lowercase snake_case（与 shared 契约同源，前后端零漂移）。 */
const DATASET_CODE_RE = DATASET_CODE_PATTERN;

/** dataset_code 禁止出现的模式（与 shared 契约同源）。 */
const DATASET_CODE_FORBIDDEN = DATASET_CODE_FORBIDDEN_PATTERNS;

/** dataset_code 是否合法（合法 = 匹配格式且不含禁止模式）。 */
export function isValidDatasetCode(code: string): boolean {
  if (!DATASET_CODE_RE.test(code)) return false;
  return !DATASET_CODE_FORBIDDEN.some(({ pattern }) => pattern.test(code));
}

/** 校验 dataset_code，返回确定性错误列表（空 = 合法）。 */
export function validateDatasetCode(code: string): string[] {
  const issues: string[] = [];
  if (!code) {
    issues.push("datasetCode 不能为空");
    return issues;
  }
  if (!DATASET_CODE_RE.test(code)) {
    issues.push(`datasetCode 必须是 lowercase snake_case（如 first_limit_pullback），实际："${code}"`);
  }
  for (const { pattern, message } of DATASET_CODE_FORBIDDEN) {
    if (pattern.test(code)) issues.push(`datasetCode ${message}`);
  }
  return issues;
}

/**
 * 校验逻辑版本标签（version）。
 * 版本是 dataset_version 内的业务标签（如 `v1` / `2024-full`），**不参与物理表命名**
 * （物理表只由 dataset_code 决定），因此规则比 datasetCode 宽松：
 * 允许字母/数字/`.`/`_`/`-`，须以字母或数字开头，长度 1..32。
 * 正则与 `shared/datasetRegistryContracts.ts` 同源，防前后端校验漂移。
 */
export function validateVersionLabel(version: string): string[] {
  if (!version) return ["version 不能为空"];
  if (!DATASET_VERSION_LABEL_PATTERN.test(version)) {
    return [`version 须为 1..32 位字母/数字/._-，且以字母或数字开头，实际："${version}"`];
  }
  return [];
}

/** 由 dataset_code + role 生成物理表名（ds_{dataset_code}_{role}）。 */
export function buildDatasetTableName(datasetCode: string, role: DatasetRole): string {
  return `ds_${datasetCode}_${role}`;
}

/** 校验并生成物理表名；非法 code 抛错（供创建定义时使用）。 */
export function assertBuildDatasetTableName(datasetCode: string, role: DatasetRole): string {
  const issues = validateDatasetCode(datasetCode);
  if (issues.length > 0) {
    throw new Error(`非法 datasetCode："${datasetCode}"；${issues.join("；")}`);
  }
  return buildDatasetTableName(datasetCode, role);
}

/** 解析物理表名 → { datasetCode, role }；不符合 ds_{code}_{role} 规范返回 null。 */
export function parseDatasetTableName(tableName: string): { datasetCode: string; role: DatasetRole } | null {
  if (!tableName.startsWith("ds_")) return null;
  const rest = tableName.slice(3);
  const parts = rest.split("_");
  if (parts.length < 2) return null;
  const role = parts[parts.length - 1]!;
  if (!(DATASET_ROLES as readonly string[]).includes(role)) return null;
  const datasetCode = parts.slice(0, -1).join("_");
  if (!isValidDatasetCode(datasetCode)) return null;
  return { datasetCode, role: role as DatasetRole };
}

/**
 * 一组定义应覆盖的物理表名（event/prefix/post/path/outcome 固定，feature 可选）。
 * 用于定义创建时的「表名显式落库」与命名自检（§8：不运行时猜表名）。
 */
export function buildDatasetTableNames(datasetCode: string): {
  event: string;
  prefix: string;
  post: string;
  path: string;
  outcome: string;
  feature: string;
} {
  return {
    event: buildDatasetTableName(datasetCode, "event"),
    prefix: buildDatasetTableName(datasetCode, "prefix"),
    post: buildDatasetTableName(datasetCode, "post"),
    path: buildDatasetTableName(datasetCode, "path"),
    outcome: buildDatasetTableName(datasetCode, "outcome"),
    feature: buildDatasetTableName(datasetCode, "feature"),
  };
}
