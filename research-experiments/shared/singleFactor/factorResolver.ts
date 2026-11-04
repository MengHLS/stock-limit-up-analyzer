/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Factor Resolver**（通用基础之一）。
 *
 * ## 职责
 *
 * 把「一个因子」抽象成**一份可枚举的目录项**，让模板与具体因子解耦：
 *
 * - 模板只知道 `SingleFactorCatalogEntry`（取值函数 + 留档元数据）；
 * - 12 个现有因子由**适配器**从 `FROZEN-BUCKET-CONTRACT-001` 的唯一落地处读取
 *   （`twelve-factor-composite-study/result.ts`）——**零修改**那份定义；
 * - 新增因子只需往目录里加一项（`valueOf` 从样本的 `factors` 记录里取值），
 *   模板代码一行不用改。
 *
 * ## 🔴 本模块**不使用**桶边界做排序
 *
 * 每个目录项都带着冻结的 `buckets` / `orientation`，但它们在这里的作用只有两个：
 * ① 进结果留档（证明「跑的是哪一版因子契约」）；② `fingerprint` 用于事后审计。
 * **单因子排名用的是因子的原始值**（`factorValue`），不是桶位分 ——
 * 桶位分是「分桶研究」的口径，与「横截面取头部」不是同一个问题，
 * 两者混用会让「Top-3」这种档位的含义变得不可解释。
 */

import {
  TWELVE_FACTOR_DEFINITIONS,
  BUCKET_CONTRACT_ID,
  type TwelveFactorSample,
} from "../../first-board-pullback/twelve-factor-composite-study/result";

/** 一个可被本模板研究的因子。 */
export interface SingleFactorCatalogEntry {
  /** 因子代码（12 个现有因子即契约里的 code）。 */
  code: string;
  label: string;
  /** 出处实验（留档用）。 */
  source: string;
  /** 契约 §3.2 的先验方向：+1 = 桶越大分越高。-1 = 桶越小分越高。 */
  orientation: 1 | -1;
  /** false = 「先验未验证方向」（契约 §3.2 的三条）。 */
  priorVerified: boolean;
  /** 冻结桶标签（升序）；仅留档，不参与排名。 */
  buckets: readonly string[];
  /** 从已入池样本取该因子的原始值；`null` = 本样本在此因子上不可评估。 */
  valueOf: (sample: TwelveFactorSample) => number | null;
}

/**
 * 12 个现有因子的目录（**适配器**，不是复制品）。
 *
 * 每一项的 `label / source / orientation / priorVerified / buckets` 都**直接引用**
 * 冻结契约里的同一个对象；`valueOf` 只是读 `sample.factors[code]`。
 * ⇒ 契约改了这里自动跟着改，不存在「第二份定义」。
 */
export const FROZEN_TWELVE_FACTOR_CATALOG: readonly SingleFactorCatalogEntry[] =
  TWELVE_FACTOR_DEFINITIONS.map(
    (definition): SingleFactorCatalogEntry => ({
      code: definition.code,
      label: definition.label,
      source: definition.source,
      orientation: definition.orientation,
      priorVerified: definition.priorVerified,
      buckets: definition.buckets,
      valueOf: sample => {
        const value = sample.factors[definition.code];
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      },
    })
  );

/**
 * 模板默认可用的因子目录。
 *
 * 新增因子：在本数组后面追加目录项即可（`valueOf` 从 `sample.factors` 的某个键取值）。
 * ⚠️ 若新因子的**原始值**还不存在于 `TwelveFactorSample.factors` 里，
 * 则必须先扩展 `twelve-factor-composite-study/derive.ts` 的因子计算，
 * 否则 `valueOf` 永远返回 `null`（该因子会把全部样本判为不可排名，Run 会响亮失败）。
 */
export const SINGLE_FACTOR_CATALOG: readonly SingleFactorCatalogEntry[] =
  FROZEN_TWELVE_FACTOR_CATALOG;

export const SINGLE_FACTOR_CATALOG_CODES: readonly string[] =
  SINGLE_FACTOR_CATALOG.map(entry => entry.code);

const CATALOG_BY_CODE: ReadonlyMap<string, SingleFactorCatalogEntry> = new Map(
  SINGLE_FACTOR_CATALOG.map(entry => [entry.code, entry])
);

/** 解析一个因子；未登记即响亮失败（不允许「跑一个不存在的因子」）。 */
export function resolveSingleFactor(code: string): SingleFactorCatalogEntry {
  const entry = CATALOG_BY_CODE.get(code);
  if (!entry) {
    throw new Error(
      `未登记的因子 code：${code}。可用因子：${SINGLE_FACTOR_CATALOG_CODES.join(", ")}`
    );
  }
  return entry;
}

/**
 * 因子契约指纹（FNV-1a 32 位）。
 *
 * 覆盖该因子的 `code | orientation | priorVerified | buckets` ——
 * 用于事后审计「本次 Run 读到的因子定义与契约是否一致」。
 * 与 12F/Top-N 的 `bucketFingerprintOf()` 同算法、但**只覆盖一个因子**
 * （单因子实验里，别的因子的桶词表与本 Run 无关）。
 */
export function factorContractFingerprintOf(entry: SingleFactorCatalogEntry): string {
  const canonical =
    `${BUCKET_CONTRACT_ID}|${entry.code}|${entry.orientation}|` +
    `${entry.priorVerified ? 1 : 0}|${entry.buckets.join(",")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** 因子契约留档（写进 `customPayload.factorContract`）。 */
export function factorContractRecordOf(entry: SingleFactorCatalogEntry): {
  code: string;
  label: string;
  source: string;
  orientation: number;
  priorVerified: boolean;
  bucketCount: number;
  buckets: readonly string[];
  contractId: string;
  fingerprint: string;
} {
  return {
    code: entry.code,
    label: entry.label,
    source: entry.source,
    orientation: entry.orientation,
    priorVerified: entry.priorVerified,
    bucketCount: entry.buckets.length,
    buckets: entry.buckets,
    contractId: BUCKET_CONTRACT_ID,
    fingerprint: factorContractFingerprintOf(entry),
  };
}
