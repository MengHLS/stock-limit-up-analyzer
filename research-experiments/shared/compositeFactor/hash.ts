/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **稳定哈希**（Bootstrap 种子的唯一来源）。
 *
 * ## 为什么要一个「稳定」种子
 *
 * 12F / Top-N 两个既有实验的桶级 CI 种子是**游标式**的
 * （`BOOTSTRAP_SEED + 10 × 第几个组合`，见 `twelve-factor-topn-ranking-study/result.ts:914-927`）。
 * 游标式的后果是：**加入或删除一个排名键，其余所有档位的 CI 端点都会变**
 * —— 同样的数据、同样的口径，只因为游标挪了一位，区间就不一样。
 *
 * 本模板改用**按组合名做稳定哈希**：
 *
 * ```
 * seed = BASE + (fnv1a32(`${contractId}|${comboId}|${purpose}`) % 100_000)
 * ```
 *
 * ⇒ 种子只取决于「这是哪个模板、哪一档、哪个用途」，与组合的**个数、顺序**无关。
 *
 * ⚠️ 代价（必须披露，不能藏）：与既有 Top-N 实验的 CI 端点**不会逐位相同**。
 *    但 CI 只是不确定性区间，**点估计（组合均值 / 基准均值 / 超额均值 / 笔数 / 胜率）
 *    与种子无关，可以逐位对拍** —— 模板正确性的判据建立在那批量上（见实例 README §对拍）。
 */

/** FNV-1a 32 位。与仓库里既有的桶词表指纹同算法（便于人工比对手算结果）。 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Bootstrap 种子基数（与 12F / Top-N 同一量级，避免与既有 Run 的流重叠）。 */
export const COMPOSITE_BOOTSTRAP_SEED_BASE = 20_260_925;

export type CompositeSeedPurpose =
  | "portfolio"
  | "benchmark"
  | "excess"
  | "random";

/**
 * 稳定种子。
 *
 * `comboId` 用「档位 id + 日集」拼成（如 `N5/FIXED`），因此同一档位在两种日集下
 * 拿到不同种子（它们本来就是两个不同的估计量）。
 */
export function compositeBootstrapSeed(args: {
  contractId: string;
  comboId: string;
  purpose: CompositeSeedPurpose;
}): number {
  const canonical = `${args.contractId}|${args.comboId}|${args.purpose}`;
  return COMPOSITE_BOOTSTRAP_SEED_BASE + (fnv1a32(canonical) % 100_000);
}
