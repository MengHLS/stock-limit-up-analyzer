/**
 * SCOPE-002 §2.3 A6 —— 策略创作「与目标版本等价」的字段级 diff。
 *
 * ✅ 裁定 Q3：**不注册 tRPC 端点**。本文件是**纯函数**（无 DB / 无 IO / 无 Date.now / 无随机），
 * 只在 `tests/**` 与（可选）dev-only 页使用；生产策略页不引用。
 *
 * 用途：把「前端构建出的文档」与「S0 冻结的 `3570001` golden」做**机器可判定**的等价比较，
 * 支撑 `SCOPE-002` §0.1 的 DoD（纯前端构建 ⇒ `definition` + `recipe` 逐字段相等）。
 *
 * 纪律：
 *   - 只比 `definition` + `recipe`。身份字段（`strategyId` / `version` / `name` / `description`）
 *     天然不在比较面内 ⇒ 无需白名单参数；
 *   - **不比较 `fingerprint`**：身份字段不同会改变指纹，指纹相等既非必要也非充分条件；
 *   - 差异按 JSON Pointer 路径**字典序**返回 ⇒ 同输入必得同输出（可复现）；
 *   - `right` = 目标 golden，`left` = 本次文档。`MISSING` = 目标有、本次没有；
 *     `EXTRA` = 本次有、目标没有；`VALUE` = 两侧都有但值不同。
 */

/** 目标 golden 的最小面（S0 冻结的 `3570001` fixture 即为该形状）。 */
export interface StrategyAuthoringGolden {
  readonly definition: unknown;
  readonly recipe: unknown;
}

/** 待比较的文档面；`StrategyDocument` 结构上满足它（`definition?` / `recipe?`）。 */
export interface StrategyAuthoringDocumentView {
  readonly definition?: unknown;
  readonly recipe?: unknown;
}

/** 一条差异。`path` 为 RFC 6901 JSON Pointer。 */
export interface StrategyDefinitionDifference {
  readonly path: string;
  readonly left: unknown;
  readonly right: unknown;
  readonly kind: "MISSING" | "EXTRA" | "VALUE";
}

export interface DiffAgainstVersionResult {
  readonly equal: boolean;
  /** 实际比较到的叶子节点数（防「两侧都缺 ⇒ 误判相等」）。 */
  readonly comparedPaths: number;
  readonly differences: readonly StrategyDefinitionDifference[];
}

export interface DiffAgainstVersionInput {
  readonly document: StrategyAuthoringDocumentView;
  readonly target: StrategyAuthoringGolden;
  /**
   * 在**任意层级**忽略的字段名（默认 `["description", "note"]`）。
   *
   * 为什么默认忽略它们：两者都是**审计用的人读文案**，不是执行语义 ——
   *   - `description`：规则/策略的人读说明；
   *   - `note`：Dataset 绑定上的备注（候选转正会写"由 RESEARCH-006.3 promote 绑定…"，
   *     而创作路径没有这条来源，也不应伪造）。
   * 两份**语义完全相同**的定义，文案不可能逐字一致。因此"逐字段相等"的判据取**语义字段**。
   */
  readonly ignoreFieldNames?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 6901 转义：`~` → `~0`，`/` → `~1`。 */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

interface DiffAccumulator {
  readonly differences: StrategyDefinitionDifference[];
  comparedPaths: number;
}

function collectDifferences(
  left: unknown,
  right: unknown,
  path: string,
  acc: DiffAccumulator,
  ignored: ReadonlySet<string>,
): void {
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter(key => !ignored.has(key))
      .sort();
    for (const key of keys) {
      const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
      const hasRight = Object.prototype.hasOwnProperty.call(right, key);
      const childPath = `${path}/${escapePointerSegment(key)}`;
      if (!hasLeft) {
        acc.differences.push({ path: childPath, left: undefined, right: right[key], kind: "MISSING" });
      } else if (!hasRight) {
        acc.differences.push({ path: childPath, left: left[key], right: undefined, kind: "EXTRA" });
      } else {
        collectDifferences(left[key], right[key], childPath, acc, ignored);
      }
    }
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) {
      const childPath = `${path}/${String(index)}`;
      if (index >= left.length) {
        acc.differences.push({ path: childPath, left: undefined, right: right[index], kind: "MISSING" });
      } else if (index >= right.length) {
        acc.differences.push({ path: childPath, left: left[index], right: undefined, kind: "EXTRA" });
      } else {
        collectDifferences(left[index], right[index], childPath, acc, ignored);
      }
    }
    return;
  }
  acc.comparedPaths += 1;
  // JSON 值域内不含 NaN；`-0 === 0` 视为相等（JSON 无法区分）。
  if (left !== right) {
    acc.differences.push({ path, left, right, kind: "VALUE" });
  }
}

/**
 * 比较「本次文档」与「目标 golden」的 `definition` + `recipe`。
 *
 * 同输入 ⇒ 同输出（差异已按路径排序）。`equal: true` 当且仅当两侧零差异。
 */
export function diffAgainstVersion(input: DiffAgainstVersionInput): DiffAgainstVersionResult {
  const acc: DiffAccumulator = { differences: [], comparedPaths: 0 };
  const ignored = new Set(input.ignoreFieldNames ?? ["description", "note"]);
  collectDifferences(input.document.definition, input.target.definition, "/definition", acc, ignored);
  collectDifferences(input.document.recipe, input.target.recipe, "/recipe", acc, ignored);
  acc.differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    equal: acc.differences.length === 0,
    comparedPaths: acc.comparedPaths,
    differences: acc.differences,
  };
}