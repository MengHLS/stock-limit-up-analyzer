/**
 * STEP 13 / C-13.3 — Experiment Lineage：code_version 解析（注入式纯函数）。
 *
 * §28 的 code_version 用于回答「这段结果是用哪个代码版本产生的」。本模块只提供
 * 「给定来源事实 → 规范化 code_version」的纯函数：
 *   - 事实（package.json version / git HEAD 短哈希 / 工作树是否干净）由调用方在入口
 *     解析后注入（测试传假值）；本模块禁止直接执行 git / 读文件系统（无 IO 铁律）；
 *   - 同输入必同输出（确定性），输出可直接进 ExperimentLineageRecord.codeVersion。
 *
 * code_version 编码约定（canonical）：
 *   - 仅 package + git 提交短哈希且干净  → `1.0.0+g2b786f7`
 *   - 有未提交变更（dirty=true）或未校验（dirty=null，无法确认干净，保守按 dirty）→ `1.0.0+g2b786f7.dirty`
 *   - 有 package 但无提交信息             → `1.0.0+gunknown`
 *   - 无 package 但有提交信息             → `unknown+g2b786f7`（提交信息仍可复现代码树）
 *   - 两者皆无                           → `unknown`
 *
 * 可复现性说明：`.dirty` 意味着代码树存在无法由 git 提交复现的未提交变更；
 * dirty=null（未跑 status）无法确认干净，按 dirty 保守标记，绝不伪装 clean。
 */

/** 无任何来源信息时的 code_version（合法 resolved 值，非 missing）。 */
export const CODE_VERSION_UNKNOWN = "unknown" as const;

/** git HEAD 事实（来源事实，非本模块自行探测）。 */
export interface GitHeadInfo {
  /** git HEAD 短哈希（通常 ≥7 hex）；非 git 仓库 / 不可得为 null。 */
  readonly commitShortHash: string | null;
  /** 工作树是否干净：false=确认无未提交变更；true=有变更；null=未校验（按 dirty 保守处理）。 */
  readonly dirty: boolean | null;
}

/** code_version 来源事实（全部由入口注入）。 */
export interface CodeVersionSource {
  /** package.json version（如 "1.0.0"）；不可得为 null。 */
  readonly packageVersion: string | null;
  readonly git: GitHeadInfo;
}

/** code_version 正则：第一段不能含空白 / '+'；可选 `+g<commit>|<unknown>[.dirty]`。 */
export const CODE_VERSION_FORMAT_RE = /^[^\s+]+(?:\+g(?:[0-9a-f]{7,40}|unknown)(?:\.dirty)?)?$/;

/** 值是否符合本模块约定的 code_version 形态（供 validator / 测试复用）。 */
export function isValidCodeVersionFormat(value: string): boolean {
  return CODE_VERSION_FORMAT_RE.test(value);
}

/**
 * 由来源事实组合出规范 code_version。
 * packageVersion 若含 '+' 会破坏 `+g` 分隔约定，直接响亮抛错（不静默截断）。
 */
export function composeCodeVersion(source: CodeVersionSource): string {
  const pkg = source.packageVersion === null ? null : source.packageVersion.trim();
  const commit = source.git.commitShortHash === null ? null : source.git.commitShortHash.trim();
  if (pkg === null && (commit === null || commit === "")) {
    return CODE_VERSION_UNKNOWN;
  }
  if (pkg !== null && pkg === "") {
    throw new Error("composeCodeVersion: packageVersion 为空串（应传 null 表示不可得，禁止空字符串冒充版本）");
  }
  if (pkg !== null && pkg.includes("+")) {
    throw new Error(`composeCodeVersion: packageVersion 含 '+'（${pkg}）会破坏 code_version 分隔约定，请修正版本号`);
  }
  if (commit !== null && commit !== "" && !/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new Error(`composeCodeVersion: git 短哈希非法（${commit}），应为 7~40 位 hex`);
  }

  const base = pkg === null ? CODE_VERSION_UNKNOWN : pkg;
  if (commit === null || commit === "") {
    return `${base}+gunknown`;
  }
  // dirty=true 或 dirty=null（未校验）一律保守标记 dirty；仅显式 false 视为干净。
  const dirtySuffix = source.git.dirty === false ? "" : ".dirty";
  return `${base}+g${commit}${dirtySuffix}`;
}
