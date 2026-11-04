// P1-T2 — Data Foundation 版本快照冻结（READ-ONLY，幂等）。
// 从 step12_certify_gate.mjs 的最新输出 research_ready_gate.json 提取「数据地基」（G0）内容，
// 剔除快照生成时刻（capturedAt），做键排序稳定序列化后计算 SHA-256 fingerprint，
// 生成版本化冻结快照，作为后续研究数据集（G2）追溯的数据版本基线。
//
// 铁律：fingerprint 只依赖「数据内容」，不依赖「快照生成时刻」→ 同输入必得同 fingerprint。
//
// 输出：docs/quantRoadmap/snapshots/data-foundation-v1.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const gatePath = new URL("../docs/researchReadyGate/research_ready_gate.json", import.meta.url);
const gate = JSON.parse(readFileSync(gatePath, "utf8"));

// 键排序稳定序列化（保证同数据 → 同字符串 → 同 hash）
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// 提取数据地基内容：G0 判定 + 15 项 dataScope 检查 + snapshot（剔除 capturedAt）
const { capturedAt: _snapCaptured, ...snapRest } = gate.snapshot ?? {};
const foundation = {
  dataFoundationReady: gate.dataFoundationReady,
  gateG0: gate.gates?.G0 ?? null,
  dataScopeChecks: (gate.checks ?? []).filter((c) => c.dataScope),
  snapshot: snapRest,
  thresholds: gate.thresholds ?? {},
};

const fingerprint = createHash("sha256").update(stableStringify(foundation)).digest("hex");

const version = "v1";
const out = {
  version,
  fingerprint,
  capturedAt: new Date().toISOString(),
  kind: "DATA_FOUNDATION_SNAPSHOT",
  source: "docs/researchReadyGate/research_ready_gate.json",
  dataFoundationReady: gate.dataFoundationReady,
  frozen: foundation,
};

const dir = new URL("../docs/quantRoadmap/snapshots/", import.meta.url);
mkdirSync(dir, { recursive: true });
const outPath = new URL(`../docs/quantRoadmap/snapshots/data-foundation-${version}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(out, null, 2));

const checks = (gate.checks ?? []).filter((c) => c.dataScope);
console.log("frozen snapshot written to:", outPath.pathname);
console.log("dataFoundationReady:", gate.dataFoundationReady);
console.log("fingerprint(sha256):", fingerprint);
console.log("G0 checks:", checks.map((c) => `${c.id}:${c.status}`).join(" "));
