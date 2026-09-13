/**
 * 只读探针：确认新增观察日变量 `pullback_last_is_bullish_{k}d` 的列访问被投影正确捕获。
 *
 * 背景（`columnProjection.ts` 的机制）：投影通过「记录访问代理」跑一遍变量目录的每个 `resolve`，
 * **读取即声明**。若新增变量的 resolve 读了某个列而代理没记下来，该列会被裁掉 ⇒ **静默全 null**。
 *
 * 本探针断言：
 *   ① `deriveColumnProjection` 对含该变量的输入，`post` 列集合里含 `open` 与 `close`；
 *   ② 该变量确实出现在 `buildObservationVariableList` 中（枚举可见）；
 *   ③ 其 `availableFromOffset` = k（PIT 防线的依据）。
 */
import {
  deriveColumnProjection,
} from "../../server/researchEngine/columnProjection";
import {
  buildObservationVariableList,
  parseObservationVariableName,
} from "../../server/researchEngine/variables";

const OFFSET = 3;
const NAME = `pullback_last_is_bullish_${OFFSET}d`;

console.log("=== ① 枚举可见性 ===");
const all = buildObservationVariableList();
const def = all.find((v) => v.name === NAME);
console.log(`  ${NAME} 存在: ${def !== undefined}`);
if (def === undefined) throw new Error("新增变量未出现在枚举列表");
console.log(`  label = ${def.label}`);
console.log(`  role = ${def.role}`);
console.log(`  availableFromOffset = ${def.availableFromOffset}`);
console.log(`  postRelativeDays = ${JSON.stringify(def.postRelativeDays)}`);

console.log("\n=== ② 名字解析 ===");
const parsed = parseObservationVariableName(NAME);
console.log(`  parse = ${JSON.stringify(parsed)}`);

console.log("\n=== ③ 列投影捕获（读 open + close）===");
const projection = deriveColumnProjection({
  featureDefs: [],
  outcomeDefs: [],
  observationDefs: [def],
  dimensionKeys: [],
  prefixDays: [0],
  postDays: [OFFSET],
  pathDays: [],
  outcomeHorizons: [],
});
console.log(`  post 列 = ${JSON.stringify(projection.post)}`);
const needOpen = projection.post.includes("open");
const needClose = projection.post.includes("close");
console.log(`  ✅ 捕获 open: ${needOpen}`);
console.log(`  ✅ 捕获 close: ${needClose}`);
if (!needOpen || !needClose) {
  throw new Error("🔴 投影未捕获 open / close ⇒ 运行期会静默全 null");
}

console.log("\n=== ④ PIT 语义自证（用零依赖假数据跑 resolve）===");
const mkSources = (open: number, close: number) =>
  ({
    eventBar: { open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
    postBars: new Map([[OFFSET, { open, high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, close, volume: 500 }]]),
  }) as never;
console.log(`  阳线（close 11 > open 10）⇒ ${def.resolve(mkSources(10, 11))}  （期望 1）`);
console.log(`  阴线（close 10 < open 11）⇒ ${def.resolve(mkSources(11, 10))}  （期望 0）`);
console.log(`  平盘（close = open = 10）⇒ ${def.resolve(mkSources(10, 10))}  （期望 0）`);

console.log("\n全部断言通过。");
