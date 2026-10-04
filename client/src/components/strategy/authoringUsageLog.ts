/**
 * FE-PLAN-003 §8 **P5** —— 策略定义页的**本地用量计数**（"每块方案被换 / 参数被改"频率）。
 *
 * ## 为什么是"本地"，不是"埋点上报"
 *
 * 本仓目前**没有任何**分析/遥测基建（既无 `sendBeacon` 也无第三方 SDK），而这是一个
 * **个人研究平台** —— 为了"两周后重排默认项"去引一个上报通道，收益远小于代价
 * （隐私 / 合规 / 一条新的跨域依赖）。所以本模块只做**本机计数**：
 *
 *   - 只写 `localStorage`，**绝不发网络请求**；
 *   - 只记 `slot / presetId / 改动了几项` 这类**结构性**信息，不记策略名、不记数值；
 *   - 任何异常（隐私模式 / 配额 / 非浏览器）一律**静默降级**为"没有计数"。
 *
 * ## 用途与纪律
 *
 * - 用途**仅限**：攒够 ≥2 周数据后，决定每块默认展示哪几个方案（`FE-PLAN-003` §8 P5）。
 * - 在做出"是否真的要重排"的决定**之前**，不得把它接到任何上报通道 —— 那是产品决策，
 *   不是实现细节。
 * - 可随时清空（`clearAuthoringUsage()`），用户数据不该有"删不掉的历史"。
 */

const STORAGE_KEY = "stock-limit-up-analyzer:strategy-authoring:usage";
const RECORD_VERSION = 1;

export interface AuthoringSlotUsage {
  /** 换到过哪些方案、各几次（presetId → 次数）。 */
  readonly selections: Readonly<Record<string, number>>;
  /** 该块"参数被改过"的累计次数（每次进/改参数算一次）。 */
  readonly parameterEditSessions: number;
  /** 累计改动项数（同一参数反复改会累计；只做量级参考）。 */
  readonly parameterEditCount: number;
}

export interface AuthoringUsageLog {
  readonly version: number;
  /** 首次记录时间（ISO）—— 用来判"是否已攒够 ≥2 周"。 */
  readonly firstRecordedAt: string;
  readonly lastRecordedAt: string;
  readonly slots: Readonly<Record<string, AuthoringSlotUsage>>;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function emptySlot(): AuthoringSlotUsage {
  return { selections: {}, parameterEditSessions: 0, parameterEditCount: 0 };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读计数；没有 / 形状不符 / 读失败 ⇒ `null`（不猜、不造一份空的糊弄调用方）。 */
export function readAuthoringUsage(): AuthoringUsageLog | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || parsed.version !== RECORD_VERSION) return null;
    if (typeof parsed.firstRecordedAt !== "string" || typeof parsed.lastRecordedAt !== "string") return null;
    if (!isPlainRecord(parsed.slots)) return null;
    const slots: Record<string, AuthoringSlotUsage> = {};
    for (const [slot, value] of Object.entries(parsed.slots)) {
      if (!isPlainRecord(value)) return null;
      const selections: Record<string, number> = {};
      const rawSelections = isPlainRecord(value.selections) ? value.selections : {};
      for (const [presetId, count] of Object.entries(rawSelections)) {
        if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
        selections[presetId] = count;
      }
      slots[slot] = {
        selections,
        parameterEditSessions: typeof value.parameterEditSessions === "number" ? value.parameterEditSessions : 0,
        parameterEditCount: typeof value.parameterEditCount === "number" ? value.parameterEditCount : 0,
      };
    }
    return {
      version: RECORD_VERSION,
      firstRecordedAt: parsed.firstRecordedAt,
      lastRecordedAt: parsed.lastRecordedAt,
      slots,
    };
  } catch {
    return null;
  }
}

function write(log: AuthoringUsageLog): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // 配额 / 隐私模式：计数是锦上添花，静默放弃（绝不因此阻断编辑）。
  }
}

/**
 * 记一次"某块的方案/参数被用了一次"。
 *
 * @param slotKey       块标识（如 `RECIPE` / `POSITION`）
 * @param presetId      选中的方案
 * @param changedParams **相对该方案默认值**改了几项（0 = 没动参数）
 * @param nowIso        注入时钟（测试用；不传取当前时间）
 */
export function recordPresetUsage(
  slotKey: string,
  presetId: string,
  changedParams: number,
  nowIso: string = new Date().toISOString(),
): void {
  const previous = readAuthoringUsage();
  const base: AuthoringUsageLog = previous ?? {
    version: RECORD_VERSION,
    firstRecordedAt: nowIso,
    lastRecordedAt: nowIso,
    slots: {},
  };
  const current = base.slots[slotKey] ?? emptySlot();
  const nextSlot: AuthoringSlotUsage = {
    selections: {
      ...current.selections,
      [presetId]: (current.selections[presetId] ?? 0) + 1,
    },
    parameterEditSessions: current.parameterEditSessions + (changedParams > 0 ? 1 : 0),
    parameterEditCount: current.parameterEditCount + Math.max(0, changedParams),
  };
  write({
    version: RECORD_VERSION,
    firstRecordedAt: base.firstRecordedAt,
    lastRecordedAt: nowIso,
    slots: { ...base.slots, [slotKey]: nextSlot },
  });
}

/** 清空计数（用户随时可以删掉这份历史）。 */
export function clearAuthoringUsage(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // 同上。
  }
}

/** 攒了几天（用于判断是否够 ≥2 周再重排默认项）；没有记录 ⇒ `null`。 */
export function authoringUsageAgeDays(nowIso: string = new Date().toISOString()): number | null {
  const log = readAuthoringUsage();
  if (log === null) return null;
  const from = Date.parse(log.firstRecordedAt);
  const to = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / 86_400_000);
}
