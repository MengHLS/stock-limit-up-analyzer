import { syncCandidateDailyPrices } from "../server/stockPriceSync.ts";

const result = await syncCandidateDailyPrices("full");
console.log(JSON.stringify(result, null, 2));
