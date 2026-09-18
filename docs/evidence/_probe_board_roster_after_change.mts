/**
 * 改造后 `getBoardRoster` 的字段与分组对账（**只读**）。
 *
 * 首页「连板梯队」换成附件图片版式后，前端只做纯渲染，分组逻辑在页面里。
 * 本探针直接打印服务端名录里「分组前」的全部字段，用来核对三件事：
 *   ① `firstBoardStocks` 是否补齐（首板(N) 那一格的来源）；
 *   ② 连板股 / 首板股的 `oneWordBoard`、断板股的 `changePct` 是否真的有值；
 *   ③ 按「高度 × 涨停在前、断板在后」分组后，各组的格数是否与 metrics 对得上。
 *
 * 用法：npx tsx docs/evidence/_probe_board_roster_after_change.mts
 */
import "dotenv/config";
import { getBoardRoster } from "../../server/boardRoster";
import { getDistinctDates } from "../../server/db";

const dates = await getDistinctDates();
const latest = dates[0] ?? "";

const roster = await getBoardRoster(latest);
if (!roster) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const brief = (row: (typeof roster.connectionStocks)[number]) => ({
  code: row.stockCode,
  name: row.stockName,
  sector: row.sector,
  boards: row.boards,
  time: row.limitUpTime,
  changePct: row.changePct,
  oneWordBoard: row.oneWordBoard,
  brokenKind: row.brokenKind ?? null,
});

type Group = { label: string; items: unknown[] };
const groups: Group[] = [];
// 与页面同一套分组上界：断板股板数是上一记录日口径，可能高于当日最高板。
const topBoards = Math.max(
  2,
  ...roster.connectionStocks.map((row) => row.boards),
  ...roster.brokenStocks.map((row) => row.boards),
);
for (let boards = topBoards; boards >= 2; boards -= 1) {
  const up = roster.connectionStocks.filter((row) => row.boards === boards);
  const cut = roster.brokenStocks.filter((row) => row.boards === boards);
  if (up.length === 0 && cut.length === 0) continue;
  groups.push({ label: `${boards} 板`, items: [...up.map(brief), ...cut.map(brief)] });
}
groups.push({
  label: `首板(${roster.firstBoardStocks.length})`,
  items: [
    ...roster.firstBoardStocks.map(brief),
    ...roster.brokenStocks.filter((row) => row.boards === 1).map(brief),
  ],
});

const brokenWithQuote = roster.brokenStocks.filter((row) => row.changePct !== null).length;
const upWithQuote = [...roster.connectionStocks, ...roster.firstBoardStocks].filter(
  (row) => row.oneWordBoard !== null,
).length;
const oneWordList = [...roster.connectionStocks, ...roster.firstBoardStocks]
  .filter((row) => row.oneWordBoard === true)
  .map((row) => `${row.stockName}(${row.stockCode})`);

console.log(
  JSON.stringify(
    {
      date: latest,
      prevDate: roster.prevDate,
      metrics: roster.metrics,
      window: roster.window,
      counts: {
        connectionStocks: roster.connectionStocks.length,
        firstBoardStocks: roster.firstBoardStocks.length,
        brokenStocks: roster.brokenStocks.length,
        brokenKindConnection: roster.brokenStocks.filter((row) => row.brokenKind === "connection").length,
        brokenKindFirst: roster.brokenStocks.filter((row) => row.brokenKind === "first").length,
      },
      quoteCoverage: {
        brokenWithChangePct: `${brokenWithQuote}/${roster.brokenStocks.length}`,
        upWithOneWordFlag: `${upWithQuote}/${roster.connectionStocks.length + roster.firstBoardStocks.length}`,
        oneWordStocks: oneWordList,
      },
      groups: groups.map((group) => ({ label: group.label, cellCount: group.items.length })),
      groupsFull: groups,
    },
    null,
    2,
  ),
);
process.exit(0);
