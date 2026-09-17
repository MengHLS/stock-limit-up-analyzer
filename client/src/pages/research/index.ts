/**
 * Research 工作台页面 barrel（RESEARCH-002 前端 / RESEARCH-006.4.1 候选详情）。
 */

export { default as ResearchList } from "./ResearchList";
// RESEARCH-PLANNER-001 — 默认模式：只填 Dataset + 一句话即可发起研究。
export { default as ResearchAsk } from "./ResearchAsk";
export { default as ResearchDetail } from "./ResearchDetail";
// RESEARCH-006.4.1 — Strategy Candidate（研究 → 策略桥）详情页。
// ⚠️ 命名区分：与涨停链路的「龙头候选」页面无关。
export { default as StrategyCandidateDetail } from "./StrategyCandidateDetail";
