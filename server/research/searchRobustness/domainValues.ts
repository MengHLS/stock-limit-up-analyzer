/**
 * ROBUSTNESS-001 §3.2 / §7 — 冻结搜索域的**有序取值序列**展开。
 *
 * ## 为什么需要它
 *
 * 邻域稳定性（§3.2）要回答「把 `entryDay` 从 3 挪到 2 或 4 会怎样」⇒ 必须先知道
 * **这个参数在冻结快照里有哪些取值、顺序是什么**。唯一权威来源 = 源 Search Run 的
 * `parameterSpaceJson`（**冻结快照**），**不是**当前策略文档、更不是参数名的猜测。
 *
 * ## 取值顺序的唯一口径（决定「相邻」是什么意思）
 *
 * - `ENUM`          → 按 `values` **声明顺序**（不重排：声明顺序就是枚举的语义顺序，
 *                     如 `["main","gem","star"]`；重排成字典序会改变「相邻」的含义）；
 * - `INTEGER_RANGE` → `min, min+step, …, <= max`（升序）；
 * - `DECIMAL_RANGE` → 同上，但按 `step` 的小数位数做**定点取整**（`0.1+0.2` 类浮点漂移
 *                     会让「同一个取值」算出两个 double ⇒ 邻域查找恒失败）；
 * - `FIXED`         → 单元素（`FIXED` 不进搜索空间，这里只为「如实返回、不抛错」）。
 *
 * ## 诚实边界
 *
 * - `step <= 0` / 非有限数 / `min > max` ⇒ **抛错**（`ROBUSTNESS_SNAPSHOT_INVALID`），
 *   不静默修复、不夹取；
 * - 展开结果去重（按稳定字符串键）后仍是**有序**的；重复取值会被**合并**并计入 `notes`
 *   由调用方如实登记（不静默丢）。
 */

import type { ParameterSearchDomain } from "../../../shared/parameterSearchContracts";
import { ResearchValidationError } from "../experimentValidation";
import type { RobustnessParameterValue } from "./types";

/** 参数取值的稳定字符串键（唯一权威；邻域查找 / 去重 / 指纹共用，不各写一份）。 */
export function domainValueKey(value: RobustnessParameterValue): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    // 🔴 数值键必须归一：`-0` 与 `0`、`1` 与 `1.0` 必须同键，否则同值会被当成两个取值。
    return `n:${Object.is(value, -0) ? "0" : String(value)}`;
  }
  if (typeof value === "boolean") return `b:${String(value)}`;
  return `s:${value}`;
}

/** 由 `step` 推出小数位数（用于定点取整；`0.01` → 2，`1` → 0，`1e-4` → 4）。 */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  if (dot < 0) {
    // 科学计数法（如 1e-7）：按指数推算。
    const match = /e-(\d+)$/i.exec(text);
    return match === null ? 0 : Number(match[1]);
  }
  return text.length - dot - 1;
}

/** 定点取整（避免 `min + i*step` 的浮点漂移把同一取值算成两个 double）。 */
function roundTo(value: number, decimals: number): number {
  if (decimals <= 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 区间展开（升序；`step > 0`；`min > max` 抛错）。 */
function expandRange(domain: {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}, path: string): number[] {
  const { min, max, step } = domain;
  for (const [field, value] of [["min", min], ["max", max], ["step", step]] as const) {
    if (!Number.isFinite(value)) {
      throw new ResearchValidationError([
        {
          code: "ROBUSTNESS_SNAPSHOT_INVALID",
          path: `${path}.${field}`,
          message: `冻结搜索域 ${path} 的 ${field} 不是有限数（${String(value)}）—— 快照损坏，拒绝继续分析。`,
        },
      ]);
    }
  }
  if (step <= 0) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SNAPSHOT_INVALID",
        path: `${path}.step`,
        message: `冻结搜索域 ${path} 的 step = ${String(step)} 必须 > 0；不静默夹取为 1（那会改变「相邻」的含义）。`,
      },
    ]);
  }
  if (min > max) {
    throw new ResearchValidationError([
      {
        code: "ROBUSTNESS_SNAPSHOT_INVALID",
        path: `${path}.min`,
        message: `冻结搜索域 ${path} 的 min(${String(min)}) > max(${String(max)})—— 快照损坏，拒绝继续分析。`,
      },
    ]);
  }
  const decimals = Math.max(decimalsOf(min), decimalsOf(max), decimalsOf(step));
  // 用「步数」驱动而不是「累加」，避免误差累积。
  const span = max - min;
  const stepCount = Math.floor(span / step + 1e-9);
  const values: number[] = [];
  for (let index = 0; index <= stepCount; index += 1) {
    const value = roundTo(min + index * step, decimals);
    if (value > max + 1e-9) break;
    values.push(value);
  }
  // 右端点若因浮点舍入未落上，补一次（只在确实等于 max 的语义下）。
  const last = values[values.length - 1];
  if (last !== undefined && Math.abs(last - max) < 1e-9 && last !== max) {
    values[values.length - 1] = max;
  }
  return values;
}

/** 展开结果（含去重说明）。 */
export interface ExpandedDomainValues {
  readonly values: readonly RobustnessParameterValue[];
  readonly domainMode: string;
  /** 数值型（决定敏感性是否给相对变化）。`FIXED` 为 `false`（固定值不参与搜索）。 */
  readonly numeric: boolean;
  /** 因重复被合并的取值键（空 = 无重复）。 */
  readonly duplicateKeys: readonly string[];
  /**
   * 该域**是否参与搜索**。`FIXED` ⇒ `false`（`search` 字段本应对 TUNABLE 缺省；
   * 若冻结快照里出现了带 `search` 的 `FIXED`，本函数仍然展开，但调用方必须据此排除）。
   */
  readonly searchable: boolean;
}

/**
 * 把冻结搜索域展开为**有序取值序列**（纯函数；不改入参）。
 *
 * @param domain 冻结快照里的 `search` 字段（唯一权威来源）
 * @param path   报错用的字段路径（如 `parameters[0].search`）
 */
export function expandSearchDomainValues(
  domain: ParameterSearchDomain,
  path = "search",
): ExpandedDomainValues {
  const raw: RobustnessParameterValue[] = [];
  let numeric = false;
  let searchable = true;

  switch (domain.mode) {
    case "FIXED":
      raw.push(domain.value);
      searchable = false;
      break;
    case "ENUM":
      for (const value of domain.values) raw.push(value);
      break;
    case "INTEGER_RANGE":
    case "DECIMAL_RANGE":
      for (const value of expandRange(domain, path)) raw.push(value);
      numeric = true;
      break;
    default: {
      // 穷尽性检查：新增 domain 形态时这里必须编译失败。
      const exhaustive: never = domain;
      throw new ResearchValidationError([
        {
          code: "ROBUSTNESS_SNAPSHOT_INVALID",
          path,
          message: `未知搜索域形态：${JSON.stringify(exhaustive)}`,
        },
      ]);
    }
  }

  const values: RobustnessParameterValue[] = [];
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const value of raw) {
    const key = domainValueKey(value);
    if (seen.has(key)) {
      duplicateKeys.push(key);
      continue;
    }
    seen.add(key);
    values.push(value);
  }

  return { values, domainMode: domain.mode, numeric, duplicateKeys, searchable };
}

/** 在有序取值序列里定位某个取值（**唯一权威查找**；找不到返回 −1，不猜）。 */
export function indexOfDomainValue(
  values: readonly RobustnessParameterValue[],
  target: RobustnessParameterValue,
): number {
  const key = domainValueKey(target);
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (current !== undefined && domainValueKey(current) === key) return index;
  }
  return -1;
}
