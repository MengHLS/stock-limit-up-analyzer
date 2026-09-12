/**
 * candidateSketchCostPreset — 「一套成本假设」的取值、人话描述与本机记忆。
 *
 * 为什么需要它：转正时 `StrategyDefinition` 文档级的 `executionAssumptions` 要求
 * `backtestConfig.initialCapital` 与六项 `costModel` **全部显式给出**
 * （`server/research/strategyCandidate/definitionBuild.ts` 绝不补默认值）。
 * 这七项对同一个人、同一套账户几乎每次都一样，逐次手填纯属浪费。
 *
 * ## 纪律边界（重要，别读漏）
 *
 *   - 本模块**不产生任何隐式默认**。预设只有在用户**显式点击「套用」**时才写进草稿；
 *     写进去之后它就是「用户在草稿里声明的成本假设」，而不是「系统替他猜的值」。
 *     这与「Promote 不补默认值」并不冲突 —— 那条约束的是**转正转换器**（`026.3 §8`），
 *     不是编辑器；编辑器替用户填的前提是用户按了那个按钮。
 *   - 预设数值 = 仓库**既有口径**，不另立第二套：
 *     `client/src/adapters/strategyAdapter.ts#parseCostModel` 的兜底值与
 *     `client/src/pages/StrategyEditor.tsx` 模板的 `executionAssumptions` 用的是同一组数字。
 *     任何一处改动都应视为「口径变更」，三处一起看。
 *   - 本机记忆走 `localStorage`。读写失败（隐私模式 / 配额 / 非浏览器环境）一律**静默降级**
 *     为「没有记忆」，绝不因此阻断编辑。
 */

// ---------------------------------------------------------------------------
// 取值形状
// ---------------------------------------------------------------------------

/**
 * 一份「成本与资金」假设。字段与草图 `entryRule.extra.document` 草稿**结构同形**，
 * 因此 `EntryRuleDraft["document"]` 可以直接传进来（无需转换）。
 */
export interface CostAssumptionValues {
  initialCapital: string;
  /** ⚠️ 不属于「成本预设」的七个字段之一：它只影响回测，不参与 `matchCostPreset`。 */
  maxPositions: string;
  commissionRate: string;
  stampDutyRate: string;
  transferFeeRate: string;
  slippageBps: string;
  lotSize: string;
  minCommission: string;
}

/**
 * 成本预设**恰好**覆盖的七个字段（`maxPositions` 不在内）。
 *
 * 单列出来是为了让「套用」只碰这七项：`backtestConfig.maxPositions` 是另一个概念，
 * 不能因为套用成本预设而被清掉。
 */
export const COST_ASSUMPTION_FIELDS = [
  "initialCapital",
  "commissionRate",
  "stampDutyRate",
  "transferFeeRate",
  "slippageBps",
  "lotSize",
  "minCommission",
] as const;

export type CostAssumptionField = (typeof COST_ASSUMPTION_FIELDS)[number];

export interface CostPreset {
  readonly id: string;
  readonly name: string;
  readonly values: CostAssumptionValues;
}

// ---------------------------------------------------------------------------
// 人话格式化
// ---------------------------------------------------------------------------

function trimNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * 比例 → A 股交易员读法：`0.001` → `千1`、`0.0003` → `万3`、`0.00001` → `万0.1`。
 *
 * 分界在「千分之一」：**≥ 0.001 一律用千**，以下才降到万。
 * 顺序不能反 —— `0.001` 也可以写成「万10」，但没人这么说；
 * 而 `0.0015` 写成「万15」同样别扭，所以千位不要求整除，只要求量级对。
 */
export function formatCostRate(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  const perThousand = n * 1000;
  if (perThousand >= 1) return `千${trimNumber(perThousand)}`;
  const perTenThousand = Number((n * 10000).toFixed(4));
  if (Math.abs(perTenThousand * 10 - Math.round(perTenThousand * 10)) < 1e-9) {
    return `万${trimNumber(perTenThousand)}`;
  }
  return `${trimNumber(Number((n * 100).toFixed(4)))}%`;
}

/** 金额 → 人话：`100000` → `10 万`，`150000` → `15 万`，其余加千分位。 */
export function formatCapital(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  if (n >= 10000 && n % 10000 === 0) return `${trimNumber(n / 10000)} 万`;
  return n.toLocaleString("zh-CN");
}

/** 一套成本假设的一行描述（用于折叠态摘要与按钮副标题）。 */
export function describeCostPreset(preset: CostPreset): string {
  const v = preset.values;
  return [
    `本金 ${formatCapital(v.initialCapital)}`,
    `佣金 ${formatCostRate(v.commissionRate)}`,
    `印花税 ${formatCostRate(v.stampDutyRate)}`,
    `过户 ${formatCostRate(v.transferFeeRate)}`,
    `滑点 ${v.slippageBps}bp`,
    `${v.lotSize} 股/手`,
    `最低 ${v.minCommission} 元`,
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// 预设
// ---------------------------------------------------------------------------

/**
 * A 股标准口径 —— 与仓库既有数字**逐项相同**（见文件头「纪律边界」）。
 *
 * `maxPositions` 故意留空：预设只声明成本与本金，不替用户决定同时持有几只。
 */
export const A_SHARE_COST_PRESET: CostPreset = {
  id: "a-share-standard",
  name: "A 股标准",
  values: {
    initialCapital: "100000",
    maxPositions: "",
    commissionRate: "0.0003",
    stampDutyRate: "0.001",
    transferFeeRate: "0.00001",
    slippageBps: "10",
    lotSize: "100",
    minCommission: "5",
  },
};

export const COST_PRESETS: readonly CostPreset[] = [A_SHARE_COST_PRESET];

function sameNumericText(a: string, b: string): boolean {
  const na = Number(a.trim());
  const nb = Number(b.trim());
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim() === b.trim();
}

/** 七项是否都已填写（转正对它们的要求是「全都要有」）。 */
export function isCostAssumptionComplete(values: CostAssumptionValues): boolean {
  return COST_ASSUMPTION_FIELDS.every((field) => String(values[field] ?? "").trim() !== "");
}

/** 命中哪个预设（七项逐一按数值比较）；都不命中 ⇒ `null`（即「自定义」）。 */
export function matchCostPreset(values: CostAssumptionValues): CostPreset | null {
  for (const preset of COST_PRESETS) {
    if (COST_ASSUMPTION_FIELDS.every((field) => sameNumericText(values[field] ?? "", preset.values[field]))) {
      return preset;
    }
  }
  return null;
}

/**
 * 把预设套到当前草稿上。
 *
 * 🔴 **只覆盖 `COST_ASSUMPTION_FIELDS` 这七项**，其余字段（尤其 `maxPositions`）原样保留 ——
 * 套一次成本预设不该把回测最大持仓数清空。
 */
export function applyCostPreset(
  current: CostAssumptionValues,
  preset: CostPreset,
): CostAssumptionValues {
  const next: CostAssumptionValues = { ...current };
  for (const field of COST_ASSUMPTION_FIELDS) {
    next[field] = preset.values[field];
  }
  return next;
}

// ---------------------------------------------------------------------------
// 本机记忆（localStorage；失败一律降级为「没有记忆」）
// ---------------------------------------------------------------------------

const COST_PRESET_STORAGE_KEY = "stock-limit-up-analyzer:candidate-sketch:cost-assumption";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读出上次显式记下的成本假设。
 *
 * 只接受「七个字段都是字符串且齐全」的记录：缺项的记忆没有意义，
 * 用它去套用反而会把草稿打回半填状态。
 */
export function readRememberedCostAssumption(): CostAssumptionValues | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(COST_PRESET_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const out: CostAssumptionValues = {
      initialCapital: "",
      maxPositions: "",
      commissionRate: "",
      stampDutyRate: "",
      transferFeeRate: "",
      slippageBps: "",
      lotSize: "",
      minCommission: "",
    };
    for (const field of COST_ASSUMPTION_FIELDS) {
      const value = record[field];
      if (typeof value !== "string" || value.trim() === "") return null;
      out[field] = value;
    }
    return out;
  } catch {
    return null;
  }
}

/** 记下这套成本假设（仅在七项齐全时才有意义；不齐全 ⇒ 删掉旧记忆）。 */
export function rememberCostAssumption(values: CostAssumptionValues): void {
  const store = storage();
  if (store === null) return;
  try {
    if (!isCostAssumptionComplete(values)) {
      store.removeItem(COST_PRESET_STORAGE_KEY);
      return;
    }
    const payload: Record<string, string> = {};
    for (const field of COST_ASSUMPTION_FIELDS) payload[field] = values[field];
    store.setItem(COST_PRESET_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 配额 / 隐私模式：记忆是锦上添花，静默放弃。
  }
}

export function forgetRememberedCostAssumption(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(COST_PRESET_STORAGE_KEY);
  } catch {
    // 同上。
  }
}

/** 上次记下的那套（作为可套用的预设形态）；没有记忆 ⇒ `null`。 */
export function rememberedCostPreset(): CostPreset | null {
  const values = readRememberedCostAssumption();
  return values === null ? null : { id: "remembered", name: "上次用的这套", values };
}

/**
 * 「套用」按钮默认指向哪一套：**有记忆就用记忆，没有就用 A 股标准**。
 *
 * 注意这只是按钮上写着的那套，**不会自动写入草稿** —— 仍然要用户点一下。
 */
export function preferredCostPreset(): CostPreset {
  return rememberedCostPreset() ?? A_SHARE_COST_PRESET;
}
