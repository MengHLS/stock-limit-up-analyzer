/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` —— 入场观察规则库（barrel）。
 *
 * 规则文本：`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md`。
 */
export * from "./types";
export {
  evaluateEarlyEntry,
  evaluateEarlyEntries,
  observationScores,
  triggerOn,
} from "./entry";
