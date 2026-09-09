/**
 * STEP DATASET-001 — Dataset 物理表命名规范（唯一权威来源，纯函数）。
 *
 * 全局规范：`ds_{dataset_code}_{role}`
 *   - `ds_`：固定前缀，表示 Dataset Data Layer。
 *   - `dataset_code`：稳定、语义明确、业务唯一的代码（lowercase snake_case，
 *     不含 version / 日期 / 环境名 / 随机 UUID，不随 Version 变化）。
 *   - `role`：event / path / outcome / feature。
 *
 * 反例（禁止）：
 *   ds_first_limit_pullback_v1_event（含 version）
 *   ds_first_limit_pullback_202609_event（含日期）
 *   ds_first_limit_pullback_test_event（含环境）
 *   dataset_001_event（非 ds_ 前缀、含序号）
 *
 * 本模块只做命名规则与校验，不承载 IO / 策略 / 因子逻辑。
 */

/** Dataset 物理表角色（第一阶段支持四种）。 */
export const DATASET_ROLES = ["event", "path", "outcome", "feature"] as const;
export type DatasetRole = (typeof DATASET_ROLES)[number];

/** dataset_code 正则：lowercase snake_case（小写字母开头，可含数字与下划线，数字不能与字母边界粘连异常）。 */
const DATASET_CODE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** dataset_code 禁止出现的模式（version / 序号 / 日期 / 环境 / uuid）。单一事实来源，isValid 与 validate 共用。 */
const DATASET_CODE_FORBIDDEN: ReadonlyArray<{ re: RegExp; message: string }> = [
  { re: /_v\d+$/, message: "禁止包含版本（如 _v1）" },
  { re: /_\d+$/, message: "禁止以数字序号/日期结尾（如 _001 / _202609）" },
  { re: /_(test|staging|prod|dev|local)$/i, message: "禁止包含环境名（test/staging/prod/dev/local）" },
  { re: /[0-9a-f]{8}-[0-9a-f]{4}-/i, message: "禁止包含 UUID" },
];

/** dataset_code 是否合法（合法 = 匹配格式且不含禁止模式）。 */
export function isValidDatasetCode(code: string): boolean {
  if (!DATASET_CODE_RE.test(code)) return false;
  return !DATASET_CODE_FORBIDDEN.some(({ re }) => re.test(code));
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
  for (const { re, message } of DATASET_CODE_FORBIDDEN) {
    if (re.test(code)) issues.push(`datasetCode ${message}`);
  }
  return issues;
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
 * 一组定义应覆盖的物理表名（event/path/outcome 固定，feature 可选）。
 * 用于定义创建时的「表名显式落库」与命名自检（§8：不运行时猜表名）。
 */
export function buildDatasetTableNames(datasetCode: string): {
  event: string;
  path: string;
  outcome: string;
  feature: string;
} {
  return {
    event: buildDatasetTableName(datasetCode, "event"),
    path: buildDatasetTableName(datasetCode, "path"),
    outcome: buildDatasetTableName(datasetCode, "outcome"),
    feature: buildDatasetTableName(datasetCode, "feature"),
  };
}
