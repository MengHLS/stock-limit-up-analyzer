import type { RegulationEventType } from "./types";

const PATTERNS: Array<{ type: RegulationEventType; re: RegExp }> = [
  { type: "severe_abnormal_volatility", re: /严重异常波动/ },
  { type: "abnormal_volatility", re: /异常波动/ },
  { type: "risk_warning", re: /风险提示/ },
  { type: "regulatory_inquiry_or_letter", re: /问询函|关注函|监管函/ },
  { type: "verification_after_abnormal", re: /异常波动.*核查|核查.*异常波动/ },
  { type: "resumption", re: /复牌/ },
];

/**
 * 标题级分类器只用于公告元数据筛选，不作为最终法律/监管性质认定。
 * 同一标题可以命中多个类型；主类型按以下顺序确定：
 * severe > abnormal > inquiry/letter > risk warning > verification > resumption。
 */
export function classifyRegulationAnnouncement(title: string): RegulationEventType[] {
  return PATTERNS.filter((item) => item.re.test(title)).map((item) => item.type);
}

export function primaryRegulationEventType(types: readonly RegulationEventType[]): RegulationEventType | null {
  const order: RegulationEventType[] = [
    "severe_abnormal_volatility",
    "abnormal_volatility",
    "regulatory_inquiry_or_letter",
    "risk_warning",
    "verification_after_abnormal",
    "resumption",
  ];
  return order.find((type) => types.includes(type)) ?? null;
}