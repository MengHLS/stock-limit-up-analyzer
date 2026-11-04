import type { TradingCalendar } from "../../security/tradingCalendar";
import { classifyRegulationAnnouncement, primaryRegulationEventType } from "./announcementClassifier";
import { computeResetDate, resolveRegulationRuleVersion } from "./exchangeRules";
import type {
  CninfoAnnouncement,
  RegulationEvent,
  RegulationExchange,
  SuspensionWindow,
} from "./types";

export * from "./types";
export * from "./cninfo";
export * from "./announcementClassifier";
export * from "./exchangeRules";

export interface BuildRegulationEventsInput {
  announcements: readonly CninfoAnnouncement[];
  exchange: RegulationExchange;
  calendar: TradingCalendar;
  suspensionWindows?: readonly SuspensionWindow[];
}

export function buildRegulationEvents(input: BuildRegulationEventsInput): RegulationEvent[] {
  const events: RegulationEvent[] = [];
  for (const announcement of input.announcements) {
    const eventTypes = classifyRegulationAnnouncement(announcement.title);
    const primaryEventType = primaryRegulationEventType(eventTypes);
    if (!primaryEventType) continue;

    const rule = resolveRegulationRuleVersion(input.exchange, announcement.announcementDate);
    const reset = computeResetDate(announcement.announcementDate, input.calendar, input.suspensionWindows);
    events.push({
      ...announcement,
      exchange: input.exchange,
      ruleVersionId: rule.id,
      eventTypes,
      primaryEventType,
      announcementTradingDate: reset.announcementTradingDate,
      resetDate: reset.resetDate,
      resetDueToResumption: reset.resetDueToResumption,
      pitNote:
        "announcementTime 为日期级；T 使用 resetDate / 次一交易日。事件前窗口不得使用公告日之后的信息。",
    });
  }
  return events.sort((a, b) =>
    a.announcementDate.localeCompare(b.announcementDate) ||
    a.announcementId.localeCompare(b.announcementId),
  );
}