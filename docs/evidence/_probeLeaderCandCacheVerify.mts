import "dotenv/config";
import { getDb, getLeaderCandidates, invalidateLeaderCandidateBacktestCaches, getLeaderCandidateMarketFactorRows } from "../../server/db";

const db = await getDb();
if (!db) { console.log("NO DB"); process.exit(1); }

async function t(label: string, fn: () => Promise<any>) {
  const s = Date.now();
  const r = await fn();
  console.log("[" + label + "] " + (Date.now() - s) + "ms");
  return r;
}

// 冷 → 热
const a = await t("candidates #1 (cold)", () => getLeaderCandidates());
const b = await t("candidates #2 (warm)", () => getLeaderCandidates());
console.log("identity shared on TTL hit =", a === b);

// 内容一致性：冷热两次结果必须逐字节等价
console.log("cold==warm JSON =", JSON.stringify(a) === JSON.stringify(b));

// 失效后必须重算（正确性：上传新数据后页面必须刷新）
invalidateLeaderCandidateBacktestCaches();
const c = await t("candidates #3 (after invalidate)", () => getLeaderCandidates());
console.log("post-invalidate recomputed =", c !== b);
console.log("post-invalidate content identical =", JSON.stringify(c) === JSON.stringify(b));

// marketFactor 缓存同样生效
const m1 = await t("marketFactorRows #1", () => getLeaderCandidateMarketFactorRows());
const m2 = await t("marketFactorRows #2 (cached)", () => getLeaderCandidateMarketFactorRows());
console.log("marketFactor shared identity =", m1 === m2, "| rows =", m1.length);

// 并发单飞
invalidateLeaderCandidateBacktestCaches();
const s4 = Date.now();
const many = await Promise.all(Array.from({ length: 6 }, () => getLeaderCandidates()));
console.log("[6x concurrent] " + (Date.now() - s4) + "ms | all share identity =", many.every((x) => x === many[0]));

console.log("date =", a?.date, "| candidates =", a?.candidates?.length, "| allScored =", a?.allScoredStocks?.length);
process.exit(0);
