/**
 * 回答：「T日首板 → 未来5日为观察日 → 符合条件就买入」如何在现有模型里表达？
 * 只读，不写库。
 */
import { resolveSignalTimeline, parseStrategyFieldReference } from "../../server/research/strategySchema/definition";
import { validateCanonicalStrategyDefinition } from "../../server/research/strategySchema/definitionValidation";

console.log("=== A. resolveSignalTimeline(trigger, window) 语义 ===");
const triggers = ["FIRST_VALID_DAY", "LAST_VALID_DAY", "EVERY_VALID_DAY", "NEXT_TRADING_DAY"] as const;
for (const trigger of triggers) {
  const t = resolveSignalTimeline(trigger, { start: 1, end: 5, unit: "TRADING_DAY" });
  console.log("  " + trigger.padEnd(18) + " window 1..5 -> earliestSignalOffset=T+" + t.earliestSignalOffset);
}
console.log("=== 对照 CALENDAR_DAY ===");
{
  const t = resolveSignalTimeline("FIRST_VALID_DAY", { start: 1, end: 5, unit: "CALENDAR_DAY" });
  console.log("  CALENDAR_DAY resolvable=" + t.resolvable + " (false => 前视引用一律拒绝)");
}

console.log("\n=== B. 字段引用形态解析 ===");
const fields = [
  "prefix.rd0.open", "prefix.rd-1.close", "event.limitUpPrice", "bar.low", "bar.close",
  "post.rd1.low", "post.rd3.close", "post.rd6.high", "path.closeFromEventClose", "outcome.maxReturn",
];
for (const f of fields) {
  const r: any = parseStrategyFieldReference(f);
  const rd = r.relativeDay !== undefined ? " rd=" + r.relativeDay : "";
  console.log("  " + f.padEnd(26) + " -> kind=" + r.kind + rd);
}

console.log("\n=== C. 用「观察5日、满足条件买入」构造定义并校验 ===");
const base: any = {
  version: "1.0.0",
  metadata: { name: "observe5-test", description: "t" },
  event: { type: "FIRST_LIMIT_UP" },
  entry: {
    event: { type: "FIRST_LIMIT_UP" },
    observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
    conditions: [
      { field: "bar.low", operator: "GTE", value: "prefix.rd0.open", valueType: "FIELD_REFERENCE", enabled: true },
    ],
    trigger: { type: "FIRST_VALID_DAY" },
  },
  exit: { rules: [] },
  position: { sizingMethod: "FIXED_AMOUNT", quantityMethod: "FIXED_AMOUNT", lotSize: 100, maxPositions: 5, initialCapital: 100000 },
  costs: { commissionRate: 0.0003, stampDutyRate: 0.001, transferFeeRate: 0.00001, slippageBps: 10, minCommission: 5, lotSize: 100 },
};
const res: any = validateCanonicalStrategyDefinition(base);
const errs = (res.issues ?? []).filter((i: any) => i.severity === "error" || !i.severity);
console.log("  合法条件 bar.low >= prefix.rd0.open => errors=" + errs.length);
for (const e of errs.slice(0, 8)) console.log("     [" + e.code + "] " + e.path + " :: " + String(e.message).slice(0, 100));

console.log("\n=== D. 故意引用未来的 post.rd6 ( > earliestSignalOffset=1 ) ===");
const bad: any = JSON.parse(JSON.stringify(base));
bad.entry.conditions = [{ field: "post.rd6.high", operator: "GTE", value: 10, valueType: "CONSTANT", enabled: true }];
const res2: any = validateCanonicalStrategyDefinition(bad);
const errs2 = (res2.issues ?? []).filter((i: any) => i.code === "INVALID_FUTURE_REFERENCE");
console.log("  INVALID_FUTURE_REFERENCE 命中 " + errs2.length + " 条");
for (const e of errs2) console.log("     " + e.path + " :: " + String(e.message).slice(0, 130));

console.log("\n=== E. 对照：trigger=FIRST_VALID_DAY 时允许引用到 post.rd1 ===");
const ok1: any = JSON.parse(JSON.stringify(base));
ok1.entry.conditions = [{ field: "post.rd1.low", operator: "GTE", value: "prefix.rd0.open", valueType: "FIELD_REFERENCE", enabled: true }];
const res3: any = validateCanonicalStrategyDefinition(ok1);
const fut3 = (res3.issues ?? []).filter((i: any) => i.code === "INVALID_FUTURE_REFERENCE");
console.log("  post.rd1 (<= T+1) => INVALID_FUTURE_REFERENCE 命中 " + fut3.length + " 条（0 = 放行）");

console.log("\n=== 完成（只读，零写入）===");
process.exit(0);
