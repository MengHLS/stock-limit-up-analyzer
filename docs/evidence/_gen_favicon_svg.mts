/**
 * 生成 client/public/favicon.svg —— 首页左上角侧栏 Logo 的矢量复刻。
 *
 * 为什么要「生成」而不是手写：
 *  1. 颜色事实源在 node_modules/tailwindcss/theme.css（Tailwind v4 用 oklch 字面量），
 *     升级 Tailwind 后调色板可能变，手写 hex 会静默过期；
 *  2. 页面的 bg-gradient-to-br 在 CSS Color 4 下默认按 **oklab** 插值，而 SVG 渐变只能按
 *     sRGB 插值（两端相同、中调最多差 13/255，实测）。因此把 oklab 曲线采样成多段 sRGB
 *     折线（即塞中间色标），实测可把中调误差压到 ≤1/255。
 *
 * 输入（全部只读）：
 *   node_modules/tailwindcss/theme.css                     调色板令牌
 *   client/src/index.css                                   --radius 令牌
 *   client/src/components/AppShell.tsx                     侧栏 Logo 的类名与图标名
 *   node_modules/lucide-react/dist/esm/icons/<icon>.js     字形节点
 * 输出：client/public/favicon.svg（纯 LF）
 *
 * 生成后必须依次跑：
 *   node_modules/.bin/tsx docs/evidence/_gen_favicon_svg.mts    ← 本文件
 *   node                        docs/evidence/_gen_favicon_assets.mjs
 *   node                        docs/evidence/_probe_favicon_render.mjs   ← 与真机实拍对拍
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const CANVAS = 32; // 侧栏 h-8 w-8 ⇒ 32px
/** 初始均匀段数（随后按偏差自适应插点） */
const SEGMENTS = Number(process.env.SEGMENTS ?? 8);
/** 可接受的逼近偏差上限（单通道，0~255）；真曲线在色域边界有折角，均匀分段压不下去 */
const TARGET_ERROR = 1;

// ---------------------------------------------------------------- 取令牌
function readCss(cssPath: string): string {
  return readFileSync(resolve(ROOT, cssPath), "utf8");
}
function readToken(css: string, token: string, where: string): string {
  const hit = css.match(new RegExp(`--${token}:\\s*([^;]+);`));
  if (!hit) throw new Error(`未在 ${where} 找到令牌 --${token}`);
  return hit[1].trim();
}

type Oklch = { L: number; C: number; H: number };
function parseOklch(value: string, where: string): Oklch {
  // Tailwind 写的是 oklch(70.5% 0.213 47.604)：亮度带百分号，须折算成 0~1
  const hit = value.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (!hit) throw new Error(`${where} 不是可解析的 oklch：${value}`);
  const L = Number((Number(hit[1]) / (hit[2] === "%" ? 100 : 1)).toFixed(6));
  return { L, C: Number(hit[3]), H: Number(hit[4]) };
}

// ------------------------------------------------------- OKLab → sRGB（纯数学）
function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  }) as [number, number, number];
}

/** 页面上渐变的真值：在 oklab 直角坐标里对两端做线性插值。 */
function gradientAt(from: Oklch, to: Oklch, t: number): [number, number, number] {
  const rad = (h: number) => (h * Math.PI) / 180;
  const a1 = from.C * Math.cos(rad(from.H));
  const b1 = from.C * Math.sin(rad(from.H));
  const a2 = to.C * Math.cos(rad(to.H));
  const b2 = to.C * Math.sin(rad(to.H));
  return oklabToRgb(from.L + (to.L - from.L) * t, a1 + (a2 - a1) * t, b1 + (b2 - b1) * t);
}

/** SVG 渲染时的实际行为：相邻色标之间按 sRGB 线性插值（色标位置可不等距）。 */
function svgPiecewise(
  stops: [number, number, number][],
  offsets: number[],
  t: number,
): [number, number, number] {
  let i = 0;
  while (i < offsets.length - 2 && t > offsets[i + 1]) i++;
  const span = offsets[i + 1] - offsets[i];
  const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - offsets[i]) / span));
  return [0, 1, 2].map((k) =>
    Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f),
  ) as [number, number, number];
}

/** 在 [0,1] 上密集采样，返回最大单通道偏差及其发生位置。 */
function worstError(
  from: Oklch,
  to: Oklch,
  stops: [number, number, number][],
  offsets: number[],
  step = 2000,
) {
  let worst = 0;
  let worstT = 0;
  for (let i = 0; i <= step; i++) {
    const t = i / step;
    const truth = gradientAt(from, to, t);
    const approx = svgPiecewise(stops, offsets, t);
    const err = Math.max(...[0, 1, 2].map((k) => Math.abs(truth[k] - approx[k])));
    if (err > worst) {
      worst = err;
      worstT = t;
    }
  }
  return { worst, worstT };
}

const hex = (rgb: [number, number, number]) =>
  "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

// ------------------------------------------------------------ 取几何与字形
const shellPath = "client/src/components/AppShell.tsx";
const shell = readCss(shellPath);
/** Logo 的「渐变方块 + 内层图标」两行结构 */
const tileBlock = shell.match(
  /<div className="([^"]*bg-gradient-to-br[^"]*)">\s*\n\s*<(\w+) className="([^"]*)" \/>/,
);
if (!tileBlock) {
  throw new Error(
    `${shellPath} 未匹配到「渐变方块 + 内层图标」结构 —— 侧栏 Logo 可能被改过，请人工确认后再改本生成器`,
  );
}
const [, tileClasses, iconName, iconClasses] = tileBlock;
const pick = (classes: string, prefix: string, where: string) => {
  const hit = classes.split(/\s+/).find((c) => c.startsWith(prefix));
  if (!hit) throw new Error(`${where} 的类名里找不到 ${prefix}*：${classes}`);
  return hit;
};

/** Tailwind 间距刻度 → px（刻度 1 = 0.25rem = 4px） */
const spacing = (cls: string) => Number(cls.replace(/^[hw]-/, "")) * 4;
const tileWidth = spacing(pick(tileClasses, "w-", "方块"));
const tileHeight = spacing(pick(tileClasses, "h-", "方块"));
if (tileWidth !== CANVAS || tileHeight !== CANVAS) {
  throw new Error(`方块实测 ${tileWidth}×${tileHeight} 与假定画布 ${CANVAS} 不一致`);
}
const iconSize = spacing(pick(iconClasses, "w-", "图标"));
const iconHeight = spacing(pick(iconClasses, "h-", "图标"));
if (iconSize !== iconHeight) throw new Error(`图标宽高不等：${iconSize}/${iconHeight}`);

// rounded-lg ⇒ --radius-lg ⇒ var(--radius)；三者任一被改都要立刻停手
const indexCss = readCss("client/src/index.css");
if (!/--radius-lg:\s*var\(--radius\)/.test(indexCss)) {
  throw new Error("client/src/index.css 里 --radius-lg 不再等于 var(--radius)，圆角换算失效");
}
const radiusRem = Number(readToken(indexCss, "radius", "client/src/index.css").replace("rem", ""));
if (!Number.isFinite(radiusRem)) throw new Error("--radius 不是 rem 数值，无法换算");
const radiusPx = radiusRem * 16; // 0.5rem = 8px

const offset = (CANVAS - iconSize) / 2;
const glyphScale = Number((iconSize / 24).toFixed(4)); // lucide viewBox = 24 单位
const strokeWidth = 2; // lucide-react 默认描边宽度（探针会对拍真机计算样式）
const strokeToken = pick(iconClasses, "text-", "图标");
if (strokeToken !== "text-white") {
  throw new Error(`图标描边色只处理过 text-white，遇到 ${strokeToken} 请补充映射`);
}
const strokeHex = "#ffffff";

const fromToken = pick(tileClasses, "from-", "方块").slice("from-".length);
const toToken = pick(tileClasses, "to-", "方块").slice("to-".length);
const themeCss = readCss("node_modules/tailwindcss/theme.css");
const from = parseOklch(readToken(themeCss, `color-${fromToken}`, "theme.css"), fromToken);
const to = parseOklch(readToken(themeCss, `color-${toToken}`, "theme.css"), toToken);

const iconFile =
  "node_modules/lucide-react/dist/esm/icons/" +
  iconName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() +
  ".js";
const iconSrc = readCss(iconFile);
const glyphNodes = [...iconSrc.matchAll(/\["(\w+)",\s*\{([^}]*)\}\]/g)].map(([, kind, attrsRaw]) => {
  const attrs: string[] = [];
  for (const pair of attrsRaw.matchAll(/(\w+):\s*"([^"]*)"/g)) {
    if (pair[1] === "key") continue; // lucide 内部的 key 只用于 React，不进 SVG
    attrs.push(`${pair[1]}="${pair[2]}"`);
  }
  return `<${kind} ${attrs.join(" ")} />`;
});
if (!glyphNodes.length) throw new Error(`${iconFile} 里没解析出图形节点`);

// ---------------------------------------------------------------- 生成色标
// 先均匀分段，再在偏差最大处插点，直到整体偏差 ≤ TARGET_ERROR（上限 40 个点防跑飞）
const offsets: number[] = [];
for (let i = 0; i <= SEGMENTS; i++) offsets.push(i / SEGMENTS);
let stops = offsets.map((t) => gradientAt(from, to, t));
let err = worstError(from, to, stops, offsets);
let inserted = 0;
while (err.worst > TARGET_ERROR && offsets.length < 40) {
  const t = Number(err.worstT.toFixed(5));
  if (offsets.some((o) => Math.abs(o - t) < 1e-4)) break; // 已有点，避免死循环
  offsets.push(t);
  offsets.sort((a, b) => a - b);
  stops = offsets.map((v) => gradientAt(from, to, v));
  err = worstError(from, to, stops, offsets);
  inserted++;
}
const naiveMid = [0, 1, 2].map((k) =>
  Math.round(stops[0][k] + (stops[stops.length - 1][k] - stops[0][k]) * 0.5),
);
const naiveMidErr = Math.max(
  ...[0, 1, 2].map((k) => Math.abs(gradientAt(from, to, 0.5)[k] - naiveMid[k])),
);

const glyphMarkup = glyphNodes.map((line) => "    " + line).join("\n");
const fmtOffset = (v: number) => String(Number(v.toFixed(4)));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="涨停复盘助手">
  <title>涨停复盘助手</title>
  <!-- 本文件由 docs/evidence/_gen_favicon_svg.mts 生成，请勿手改；改动请重跑生成器与验收探针。
       来源 = client/src/components/AppShell.tsx 的侧栏 Logo，逐项对应（数值均取自实测）：
         方块 ${tileWidth}×${tileHeight}；圆角类 rounded-lg 指向令牌 radius = ${radiusRem}rem ⇒ ${radiusPx}px
         渐变类 bg-gradient-to-br（左上到右下）${fromToken} → ${toToken}
           令牌值 oklch(${from.L} ${from.C} ${from.H}) / oklch(${to.L} ${to.C} ${to.H})
           页面按 oklab 插值而 SVG 只能 sRGB，故用 ${stops.length} 个色标做折线逼近（实测偏差 ≤${err.worst}/255）
         字形 lucide-react ${iconName}，渲染 ${iconSize}×${iconSize}，描边 ${strokeHex}
           24 单位 viewBox 缩放 ${glyphScale} 后居中，偏移 (${CANVAS} − ${iconSize}) ÷ 2 = ${offset}
       注意：XML 注释内不得出现连续两个短横线，否则整份解析失败、图标不显示。 -->
  <defs>
    <linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${CANVAS}" y2="${CANVAS}">
${stops
  .map((c, i) => `      <stop offset="${fmtOffset(offsets[i])}" stop-color="${hex(c)}" />`)
  .join("\n")}
    </linearGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" rx="${radiusPx}" fill="url(#tile)" />
  <g
    transform="translate(${offset} ${offset}) scale(${glyphScale})"
    fill="none"
    stroke="${strokeHex}"
    stroke-width="${strokeWidth}"
    stroke-linecap="round"
    stroke-linejoin="round">
${glyphMarkup}
  </g>
</svg>
`;

// ---------------------------------------------------------------- 落盘 + 自检
const outPath = resolve(ROOT, "client/public/favicon.svg");
writeFileSync(outPath, svg, "utf8");
const back = readFileSync(outPath, "utf8");
if (back !== svg) throw new Error("回读与写入内容不一致");
if (back.includes("\r")) throw new Error("输出夹带了回车符，应为纯 LF");
for (const body of back.match(/<!--([\s\S]*?)-->/g) ?? []) {
  if (body.slice(4, -3).includes("--")) throw new Error("XML 注释体内出现连续两个短横线，SVG 将解析失败");
}

console.log("已生成 client/public/favicon.svg");
console.log(
  `  方块 ${tileWidth}×${tileHeight} 圆角 ${radiusPx}px · 字形 ${iconName} ${iconSize}×${iconSize} scale=${glyphScale} offset=${offset}`,
);
console.log(
  `  渐变 ${fromToken} ${hex(stops[0])} → ${toToken} ${hex(stops[stops.length - 1])}：均匀 ${SEGMENTS} 段后自适应插了 ${inserted} 个点，共 ${stops.length} 个色标`,
);
console.log("    " + stops.map((c, i) => `${fmtOffset(offsets[i])} ${hex(c)}`).join("  "));
console.log(`  折线逼近最大偏差 ${err.worst}/255（@t=${err.worstT.toFixed(4)}）`);
console.log(`  对照：只用 2 个色标按 sRGB 插值时，中调偏差为 ${naiveMidErr}/255`);
