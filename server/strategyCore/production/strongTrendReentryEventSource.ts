import { StrategyCoreError, type CoreScalar } from "../types";
import type { EventOccurrenceResolver, RuntimeContext } from "../runtime";
import type { ProductionEventResolver } from "./eventSource";

export const STRONG_TREND_REENTRY_EVENT_TYPE = "CUSTOM_EVENT" as const;
export const STRONG_TREND_REENTRY_EVENT_CODE = "STRONG_TREND_REENTRY_V1" as const;
export const STRONG_TREND_REENTRY_MULTIPLE = 2 as const;

export interface StrongTrendReentryEventSourceDeclaration {
  readonly eventAnchored: boolean;
  readonly eventTypes: readonly string[];
  readonly declaredBy: string;
  readonly eventCode?: string;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function readEventCode(params: Readonly<Record<string, CoreScalar>>): string | null {
  const raw = params["eventCode"];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

export function judgeStrongTrendReentryEvent(context: RuntimeContext, expectedEventCode: string = STRONG_TREND_REENTRY_EVENT_CODE): boolean | "UNDECIDABLE" {
  const currentRelativeDay = context.currentRelativeDay;
  if (currentRelativeDay === undefined) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1：RuntimeContext 缺少 currentRelativeDay。");
  const bars = [...context.visibleData.bars].sort((a, b) => a.relativeDay - b.relativeDay);
  const futureBar = bars.find(bar => bar.relativeDay > currentRelativeDay);
  if (futureBar !== undefined) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1 收到 relativeDay > currentRelativeDay 的 bar：事件解析器拒绝读取未来数据。", { currentRelativeDay, futureRelativeDay: futureBar.relativeDay });
  const eventBar = bars.find(bar => bar.relativeDay === 0);
  if (eventBar === undefined) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1：可见窗口缺少 rd=0 的首板事件 bar，拒绝判定。", { expectedEventCode });
  if (!finitePositive(eventBar.close)) return "UNDECIDABLE";
  const eventClose = eventBar.close;
  const strongBar = bars.find(bar => bar.relativeDay > 0 && finitePositive(bar.high) && bar.high >= STRONG_TREND_REENTRY_MULTIPLE * eventClose);
  if (strongBar === undefined) return false;
  if (!finitePositive(strongBar.close)) return "UNDECIDABLE";
  const strongClose = strongBar.close;
  const pullbackBar = bars.find(bar => bar.relativeDay > strongBar.relativeDay && typeof bar.low === "number" && Number.isFinite(bar.low) && bar.low < strongClose);
  if (pullbackBar === undefined) return false;
  const reclaimBar = bars.find(bar => bar.relativeDay > pullbackBar.relativeDay && finitePositive(bar.close) && bar.close >= strongClose);
  if (reclaimBar === undefined) return false;
  return reclaimBar.relativeDay === currentRelativeDay;
}

export function createStrongTrendReentryEventResolver(declaration: StrongTrendReentryEventSourceDeclaration): ProductionEventResolver {
  if (!declaration.eventAnchored || declaration.eventTypes.length === 0) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1 事件源声明非法：必须 eventAnchored=true 且 eventTypes 非空。", { declaredBy: declaration.declaredBy });
  const expectedEventCode = declaration.eventCode ?? STRONG_TREND_REENTRY_EVENT_CODE;
  let undecidable = 0, occurred = 0, notOccurred = 0;
  const judge = (eventType: string, params: Readonly<Record<string, CoreScalar>>, context: RuntimeContext): boolean | "UNDECIDABLE" => {
    if (eventType !== STRONG_TREND_REENTRY_EVENT_TYPE) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1 解析器只接受 eventType=CUSTOM_EVENT，实际 " + eventType, { eventType });
    const eventCode = readEventCode(params);
    if (eventCode !== expectedEventCode) throw new StrategyCoreError("CORE_DEFINITION_INVALID", "STRONG_TREND_REENTRY_V1 解析器收到未支持 eventCode，拒绝静默返回 false。期望=" + expectedEventCode + "，实际=" + String(eventCode), { eventCode });
    return judgeStrongTrendReentryEvent(context, expectedEventCode);
  };
  const counting: EventOccurrenceResolver = (eventType, params, context) => {
    const verdict = judge(eventType, params, context);
    if (verdict === "UNDECIDABLE") { undecidable += 1; return false; }
    if (verdict) occurred += 1; else notOccurred += 1;
    return verdict;
  };
  return { resolve: counting, resolveQuiet: (eventType, params, context) => judge(eventType, params, context) === true, undecidableCount: () => undecidable, occurredCount: () => occurred, notOccurredCount: () => notOccurred, notes: ["事件解析器口径：STRONG_TREND_REENTRY_V1（" + declaration.declaredBy + "）", "S = 首板 rd0.close 之后首次 high >= 2 × rd0.close；Pullback 必须严格晚于 S；RECLAIM = Pullback 后首次 close >= S.close。", "事件只在 RECLAIM 当日成立；读取 visibleData 时拒绝 relativeDay > currentRelativeDay。"] };
}


