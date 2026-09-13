/**
 * 只读探针：核准新注册的「首板回踩 · 守线 + 缩量」配方**真实可用**。
 *
 * 要证明的四件事：
 *   ① 注册表里现在有 2 个配方，新配方在其中；
 *   ② 由参数集构造出的信号构造器**真的执行门槛**（守线 / 缩量 / 红盘三类拒绝都能触发）；
 *   ③ 参数**真的驱动门槛**（改 `max_volume_ratio` 会改变通过集合）—— 防「参数声明了但不生效」；
 *   ④ 既有 `leader-candidate-baseline` 行为**逐字未变**（回归护栏）。
 */
import {
  registeredStrategyRecipeIds,
  resolveStrategyRecipeById,
  PULLBACK_FEATURE_IDS,
  PULLBACK_PARAMETER_IDS,
} from "../../server/research/recipeRegistry";
import { makeWeightedSignalBuilder } from "../../server/research/framework/signal";

console.log("=== ① 已注册配方 ===");
const ids = registeredStrategyRecipeIds();
for (const id of ids) console.log(`  · ${id}`);
if (!ids.includes("first-limit-pullback-hold-shrink")) throw new Error("新配方未注册");

console.log("\n=== ② 门槛真的生效（三类拒绝）===");
const runtime = resolveStrategyRecipeById("first-limit-pullback-hold-shrink");
console.log(`  特征数 = ${runtime.features.length}: ${runtime.features.map((f) => `${f.featureId}@${f.version}`).join(", ")}`);

const params = {
  [PULLBACK_PARAMETER_IDS.maxVolumeRatio]: 0.5,
  [PULLBACK_PARAMETER_IDS.maxDrawdown]: 0.02,
  [PULLBACK_PARAMETER_IDS.requireBullish]: 1,
};
const builder = runtime.buildSignalBuilder(params);

const mk = (haircut: number, volumeRatio: number, isBullish: number) => ({
  securityId: "600000.SH",
  date: "2024-03-15",
  features: {
    [PULLBACK_FEATURE_IDS.haircut]: haircut,
    [PULLBACK_FEATURE_IDS.volumeRatio]: volumeRatio,
    [PULLBACK_FEATURE_IDS.isBullish]: isBullish,
    [PULLBACK_FEATURE_IDS.momentum]: 0.1,
  } as Record<string, number | null>,
});

const cases: Array<[string, ReturnType<typeof mk>, boolean]> = [
  ["守线✅ 缩量✅ 红盘✅ ⇒ 通过", mk(0.01, 0.4, 1), true],
  ["守线❌（回撤 5% > 2%）⇒ 拒绝", mk(0.05, 0.4, 1), false],
  ["缩量❌（量比 0.8 > 0.5）⇒ 拒绝", mk(0.01, 0.8, 1), false],
  ["红盘❌（阴线）⇒ 拒绝", mk(0.01, 0.4, 0), false],
  ["特征缺失（量能 null）⇒ 拒绝", { ...mk(0.01, 0.4, 1), features: { ...mk(0.01, 0.4, 1).features, [PULLBACK_FEATURE_IDS.volumeRatio]: null } }, false],
];
let ok = true;
for (const [label, input, expectPass] of cases) {
  const out = builder(input);
  const passed = out !== null;
  const mark = passed === expectPass ? "✅" : "🔴";
  if (passed !== expectPass) ok = false;
  console.log(`  ${mark} ${label} ⇒ ${passed ? "有信号" : "null"}`);
}
if (!ok) throw new Error("门槛语义与预期不符");

console.log("\n=== ③ 参数真的驱动门槛（防「参数声明了但不生效」）===");
const strict = runtime.buildSignalBuilder({ ...params, [PULLBACK_PARAMETER_IDS.maxVolumeRatio]: 0.3 });
const loose = runtime.buildSignalBuilder({ ...params, [PULLBACK_PARAMETER_IDS.maxVolumeRatio]: 0.5 });
const probe = mk(0.01, 0.4, 1);
console.log(`  max_volume_ratio=0.3, 量比 0.4 ⇒ ${strict(probe) === null ? "拒绝（✅ 0.4 > 0.3）" : "通过（🔴 参数未生效）"}`);
console.log(`  max_volume_ratio=0.5, 量比 0.4 ⇒ ${loose(probe) === null ? "拒绝（🔴）" : "通过（✅ 0.4 ≤ 0.5）"}`);
if (strict(probe) !== null) throw new Error("🔴 max_volume_ratio 未生效");
if (loose(probe) === null) throw new Error("🔴 max_volume_ratio 未生效");

const noBullish = runtime.buildSignalBuilder({ ...params, [PULLBACK_PARAMETER_IDS.requireBullish]: 0 });
const bearish = mk(0.01, 0.4, 0);
console.log(`  require_bullish=0, 阴线 ⇒ ${noBullish(bearish) === null ? "拒绝（🔴 红盘门槛未按参数关闭）" : "通过（✅）"}`);
if (noBullish(bearish) === null) throw new Error("🔴 require_bullish 未生效");

console.log("\n=== ④ 既有配方回归（行为未变）===");
const legacy = resolveStrategyRecipeById("leader-candidate-baseline");
const legacyBuilder = legacy.buildSignalBuilder({});
const legacySame = makeWeightedSignalBuilder({ pctChange: 1 });
const legacyInput = { securityId: "600000.SH", date: "2024-03-15", features: { pctChange: 0.05 } as Record<string, number | null> };
const a = JSON.stringify(legacyBuilder(legacyInput));
const b = JSON.stringify(legacySame(legacyInput));
console.log(`  工厂产物 = ${a}`);
console.log(`  原构造器 = ${b}`);
if (a !== b) throw new Error("🔴 既有配方行为变了");

console.log("\n全部断言通过。");
