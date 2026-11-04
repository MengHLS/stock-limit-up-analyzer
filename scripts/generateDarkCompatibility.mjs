/**
 * 生成 `client/src/theme/darkCompatibility.css`（暗色兼容层）。
 *
 * 用法（仓库根目录）：node scripts/generateDarkCompatibility.mjs
 *
 * 做法：扫 client/src 里遗留的「硬编码调色板类」，按「utility 族 + 色阶」映射成暗色值。
 *
 * 设计要点：
 *  - Tailwind v4 的工具类一律引用 var(--color-*)，但**变量是跨角色共享的**
 *    （bg-slate-800 选中药丸 与 text-slate-800 正文共用一个变量，暗色下诉求相反），
 *    因此只能按「utility 族 + 色阶」逐类映射，不能改调色板变量。
 *  - 兼容层必须是**无 layer** 的规则（Tailwind 工具类在 @layer utilities 里，
 *    任何 @layer 都比它低优先级，只有无 layer 才能覆盖）。
 *  - 每条规则带 :not([class*="dark:<族>-"]) 守卫，把优先级让给上游已显式写好的 dark: 变体。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = "client/src";

const HUES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];
const NEUTRALS = ["slate", "gray"];

const FAMILIES = ["bg", "text", "border", "divide", "ring", "from", "via", "to", "fill", "stroke", "placeholder", "decoration", "outline", "shadow"];

// ---------- 1. 扫描源码 ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const tokenRe = new RegExp(
  String.raw`((?:[a-z0-9_.\[\]=%,#()\/-]+:)+)?(${FAMILIES.join("|")})-(${[...HUES, ...NEUTRALS].join("|")})-(\d{2,3})(\/(\d{1,3}))?`,
  "g"
);

/** key: `${family}|${hue}|${shade}` -> { alpha:Set, variants:Set } */
const inv = new Map();

for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(tokenRe)) {
    const [, rawVariants, family, hue, shadeStr, , alphaStr] = m;
    const shade = Number(shadeStr);
    // 变体前缀：只保留单层、已知的伪类/分组变体（本项目实测只有这几种命中目标色族）
    let variant = null;
    if (rawVariants) {
      const v = rawVariants.slice(0, -1); // 去掉结尾 ':'
      if (["hover", "focus", "focus-visible", "disabled", "group-hover"].includes(v)) variant = v;
      else continue; // 其他变体（dark:/md: 等）不在兼容层职责内
    }
    if (family === "text" && hue === "white") continue;
    const key = `${family}|${hue}|${shade}`;
    let e = inv.get(key);
    if (!e) inv.set(key, (e = { alpha: new Set(), variants: new Set() }));
    // 必须记录「朴素形式」本身：一个类若既出现过 bg-slate-50 又出现过 bg-slate-50/70，
    // 只记变体会漏掉朴素用法（曾因此漏掉 133 处 text-slate-600）。
    e.alpha.add(alphaStr ? Number(alphaStr) : null);
    e.variants.add(variant ?? null);
  }
}

// ---------- 2. 映射表 ----------
// 中性：按“角色”映射，不是简单反相（保持亮色下「编号越大越重」的层级方向）
const NEUTRAL_BG = {
  50: "var(--dk-n1)", 100: "var(--dk-n2)", 200: "var(--dk-n3)", 300: "var(--dk-n3)",
  400: "var(--dk-n4)", 700: "var(--dk-e2)", 800: "var(--dk-e1)", 900: "var(--dk-e0)",
};
const NEUTRAL_TEXT = {
  50: "var(--dk-t8)", 300: "var(--dk-t1)", 400: "var(--dk-t2)", 500: "var(--dk-t3)",
  600: "var(--dk-t4)", 700: "var(--dk-t5)", 800: "var(--dk-t6)", 900: "var(--dk-t7)", 950: "var(--dk-t8)",
};
const NEUTRAL_LINE = { 100: "var(--dk-l1)", 200: "var(--dk-l2)", 300: "var(--dk-l3)", 400: "var(--dk-l4)" };
// 中性渐变端点：浅档 = 比页面略亮的「面」；深档（400~600，亮色下是选中态深灰药丸）
// 在暗色下要反过来靠「比卡片更亮」表达选中 ⇒ 落到 e 系。
const NEUTRAL_GRAD = { 50: "var(--dk-n1)", 100: "var(--dk-n2)", 200: "var(--dk-n3)", 300: "var(--dk-n3)", 400: "var(--dk-e0)", 500: "var(--dk-e1)", 600: "var(--dk-e1)", 700: "var(--dk-e2)" };

// 彩色：同色相内把亮度带搬到暗色可读区间（保留层级方向）。
// 「柔和」优先于「鲜艳」：暗色下大字号/大面积用 300/400 档会显得霓虹刺眼，
// 故文字整体比首版下沉一档（600→500、700/800→400、900→300）。
const COLOR_TEXT = { 500: 400, 600: 500, 700: 400, 800: 400, 900: 300, 950: 300 };
// 边框：400/500 在亮色下是「强调边框」，暗色下应保持/变亮，故不下沉
const COLOR_BORDER = { 100: 900, 200: 800, 300: 700, 400: 500 };
// 🔴 焦点环 / 高亮环**必须变亮**：原实现把 100/200/300 压到 900/800/700（暗色）⇒
// 在暗底上「今日」格子环、「缺失」标记环、「选中 tab」环全部**看不见**。环是 1~2px 细线，
// 亮度就是可见性，故浅档一律抬到 400 档。
const COLOR_RING = { 100: 400, 200: 400, 300: 400 };

/**
 * 彩色文字降饱和。
 *
 * 直接使用 Tailwind 的 300/400 档是暗色文字「霓虹感」的根源 —— 实测 `text-orange-600`
 * 经映射后落到 `orange-400`，其 sRGB 色度 = **0.98**（几乎纯饱和橙，如 `#ff8904`）；
 * `text-amber-600` → `amber-400` 色度 = **1.00**（理论最大值）。这类颜色放在近黑底上，
 * 小字也像在发光（俗称 "glow text"）。
 *
 * 做法：与一个中性亮灰（--dk-t5）按 62/38 混合 ⇒ 色度砍到约 6 成、亮度略抬，
 * 色相与层级方向都不变，但不再是霓虹。
 */
const calmText = (colorVar) => `color-mix(in oklab, ${colorVar} 62%, var(--dk-t5))`;

/**
 * 彩色「面」（bg / 渐变端点）→ 低饱和「色偏暗面」。
 *
 * 为什么不直接落 *-900 / *-950：那是**高饱和深色块**（实测 `bg-orange-50` → `orange-900`
 * 的色度 = 0.123、`blue-900` = 0.146）。单看一块还行，但本页有**整屏**级的用途：
 * 涨停复盘明细页（`LimitUpReview.tsx`，原 `Home.tsx`）包裹层
 * `from-slate-50 via-blue-50 to-indigo-50` 覆盖 1136×1323 px ⇒ 整块内容区
 * 变成一条高饱和蓝→紫渐变；卡片标题条同样是大面积饱和色带 ⇒ 观感「又闷又刺」。
 *
 * 做法：把该色相的 500 档按小比例混进 `--background`。色度随之降到 0.02~0.09，
 * 色相暗示仍在，但不抢眼；且混色同时把亮度压到背景附近 ⇒ 面积再大也不会「发光」。
 * 比例按亮色档位单调递增，保持「编号越大越实」的层级方向。
 */
const TINT_BASE = "var(--background)";
const TINT_PCT = { 50: 8, 100: 11, 200: 15, 300: 20, 400: 28, 500: 42, 600: 52 };
const tintOf = (hue, shade) => {
  const p = TINT_PCT[shade];
  return p ? `color-mix(in oklab, var(--color-${hue}-500) ${p}%, ${TINT_BASE})` : undefined;
};

function mappedValue(family, hue, shade) {
  const isNeutral = NEUTRALS.includes(hue);
  if (isNeutral) {
    if (family === "bg") return NEUTRAL_BG[shade];
    if (family === "text") return NEUTRAL_TEXT[shade];
    if (family === "border" || family === "divide" || family === "ring") return NEUTRAL_LINE[shade];
    if (["from", "via", "to"].includes(family)) return NEUTRAL_GRAD[shade];
    return undefined;
  }
  if (family === "text") { const t = COLOR_TEXT[shade]; return t && calmText(`var(--color-${hue}-${t})`); }
  if (family === "border" || family === "divide") { const t = COLOR_BORDER[shade]; return t && `var(--color-${hue}-${t})`; }
  if (family === "ring") { const t = COLOR_RING[shade]; return t && `var(--color-${hue}-${t})`; }
  if (family === "bg" || ["from", "via", "to"].includes(family)) return tintOf(hue, shade);
  return undefined;
}

const PROP = { bg: "background-color", text: "color", border: "border-color", divide: "border-color", ring: "--tw-ring-color", from: "--tw-gradient-from", via: "--tw-gradient-via", to: "--tw-gradient-to" };

function esc(cls) {
  return cls.replace(/[.:/%#()[\],=]/g, (c) => `\\${c}`);
}
const PSEUDO = { hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", disabled: ":disabled" };

// ---------- 3. 生成 ----------
const rules = [];
const fq = (family, hue, shade, alpha, variant) => {
  let cls = `${family}-${hue}-${shade}`;
  if (alpha) cls += `/${alpha}`;
  if (variant) cls = `${variant}:${cls}`;
  return cls;
};

for (const [key, meta] of inv) {
  const [family, hue, shadeStr] = key.split("|");
  const shade = Number(shadeStr);
  const base = mappedValue(family, hue, shade);
  if (!base) continue;
  const prop = PROP[family];
  if (!prop) continue;

  const alphas = [...meta.alpha];
  const variants = [...meta.variants];

  for (const alpha of alphas) {
    const val = alpha ? `color-mix(in oklab, ${base} ${alpha}%, transparent)` : base;
    for (const variant of variants) {
      const cls = fq(family, hue, shade, alpha, variant);
      let sel;
      if (variant === "group-hover") sel = `.dark .group:hover .${esc(cls)}`;
      else if (PSEUDO[variant]) sel = `.dark .${esc(cls)}${PSEUDO[variant]}`;
      else sel = `.dark .${esc(cls)}`;
      // 让位给上游显式 dark: 变体
      const guardKey = variant === "group-hover" ? `dark:${family}-` : `dark:${family}-`;
      sel += `:not([class*="${guardKey}"])`;
      rules.push({ sel, prop, val, cls });
    }
  }
}

// 特殊：白色底 / 白色渐变端点（白不在色相表里，需手工列出）
const WHITE_RULES = [
  [".dark .bg-white:not([class*=\"dark:bg-\"])", "background-color", "var(--card)"],
  [".dark .bg-white\\/80:not([class*=\"dark:bg-\"])", "background-color", "color-mix(in oklab, var(--card) 80%, transparent)"],
  [".dark .bg-white\\/85:not([class*=\"dark:bg-\"])", "background-color", "color-mix(in oklab, var(--card) 85%, transparent)"],
  [".dark .bg-white\\/90:not([class*=\"dark:bg-\"])", "background-color", "color-mix(in oklab, var(--card) 90%, transparent)"],
  [".dark .bg-white\\/60:not([class*=\"dark:bg-\"])", "background-color", "color-mix(in oklab, var(--card) 60%, transparent)"],
  [".dark .from-white:not([class*=\"dark:from-\"])", "--tw-gradient-from", "var(--card)"],
];

const groups = new Map();
for (const r of [...WHITE_RULES.map(([sel, prop, val]) => ({ sel, prop, val })), ...rules]) {
  const k = `${r.prop}||${r.val}`;
  if (!groups.has(k)) groups.set(k, { prop: r.prop, val: r.val, sels: [] });
  groups.get(k).sels.push(r.sel);
}

let out = "";
for (const { prop, val, sels } of groups.values()) {
  out += sels.join(",\n") + " {\n  " + prop + ": " + val + ";\n}\n";
}

const HEADER = `/**
 * 暗色兼容层（dark compatibility shim）
 * ------------------------------------------------------------------
 * 背景：本项目的设计令牌（--background/--card/--muted/... 与 \`.dark\` 覆盖）本身是暗色就绪的，
 * 但页面与业务组件里散落着约 1900 处**硬编码调色板类**（bg-white / text-slate-700 /
 * text-amber-700 / border-slate-200 …），它们不随主题变化。逐文件改写这 40 个组件文件代价大、
 * 且会与上游仓库同步产生大量冲突，因此改为在本层**按工具类名一次性重映射**。
 *
 * 原理：
 *   1. Tailwind v4 生成的工具类一律写成 \`background-color: var(--color-amber-50)\` 这类形式，
 *      颜色值集中在调色板变量里 —— 这是本层可以「按类名覆盖」的前提。
 *   2. 但调色板变量是**跨角色共享**的：\`bg-slate-800\`（选中态深色药丸，配白字）与
 *      \`text-slate-800\`（深色正文）在暗色下诉求**相反**。所以不能简单地改调色板变量，
 *      必须按「utility 族 + 色阶」分别映射（bg / text / border / ring / 渐变色标 各一套表）。
 *   3. 映射方向不是「亮度反相」，而是**把整条色阶搬进暗色可读区间并保持层级方向**：
 *      亮色下「编号越大越重」在暗色下仍是「编号越大越亮/越实」。
 *
 * 与上游显式 dark: 变体的关系：
 *   上游已在部分位置手写了 \`dark:text-amber-400\`、\`dark:bg-amber-950/50\` 这类配对。
 *   本层每条规则都带 \`:not([class*="dark:<族>-"])\` 守卫，遇到显式声明**主动让位**。
 *
 * 维护方式：
 *   本文件由 \`scripts/generateDarkCompatibility.mjs\` 按「源码中实际出现的类名清单」生成后固化。
 *   改了页面、新增了硬编码色类之后，重跑一次即可增量补齐：
 *       node scripts/generateDarkCompatibility.mjs
 *   生成器只做机械映射；若要调整某个色阶的去向，改脚本里的映射表（NEUTRAL_* / COLOR_*）再重跑。
 *
 * 已知未覆盖（有意为之）：
 *   - \`text-white\`：用作彩色渐变按钮/药丸上的白字，暗色下必须保持白色。
 *   - \`bg-black/50\`：遮罩层，暗色下同样需要。
 *   - 500/600 档的实心强调色（bg-red-500、bg-sky-700、from-orange-500 …）：暗色下本就清晰。
 */

/* ---- 暗色专用中性档位（供下面的规则引用；与语义令牌同层，随 .dark 生效）---- */
.dark {
  /* 面：编号越大越「实」（对应亮色 slate-50 → 200）。整体比 --card(0.245) 略亮，
     使「浅底面板」在暗色下仍读作"卡片上再叠一层"，而不是陷进卡片里。 */
  --dk-n1: oklch(0.275 0.005 286);
  --dk-n2: oklch(0.305 0.005 286);
  --dk-n3: oklch(0.345 0.006 286);
  --dk-n4: oklch(0.415 0.007 286);
  /* 强调面：亮色里靠「比底色更深」表达选中；暗色里反过来靠「比底色更亮」表达 */
  --dk-e0: oklch(0.355 0.007 286);
  --dk-e1: oklch(0.425 0.007 286);
  --dk-e2: oklch(0.485 0.008 286);
  /* 文字：亮色下编号越大越重（越深）；暗色下编号越大越亮，层级方向保持一致 */
  --dk-t1: oklch(0.620 0.014 286);
  --dk-t2: oklch(0.680 0.014 286);
  --dk-t3: oklch(0.730 0.014 286);
  --dk-t4: oklch(0.790 0.011 286);
  --dk-t5: oklch(0.840 0.010 286);
  --dk-t6: oklch(0.885 0.008 286);
  --dk-t7: oklch(0.920 0.006 286);
  --dk-t8: oklch(0.955 0.004 286);
  /* 分隔线 */
  --dk-l1: oklch(0.285 0.005 286);
  --dk-l2: oklch(0.325 0.005 286);
  --dk-l3: oklch(0.385 0.006 286);
  --dk-l4: oklch(0.450 0.007 286);
}

/* ---- 映射规则（按声明合并，来源见文件头说明）---- */
`;

const TRAILER = `
/* ---- 日历（涨停复盘明细页「选择日期」自定义 DayButton）----
 * LimitUpReview.tsx（原 Home.tsx）的 CustomDayButton 里选中态硬编码了亮渐变 from-orange-400 via-orange-500 to-red-500
 * （400/500 档本层有意不覆盖），暗色下依旧全亮，是整页最刺眼的一块之一。
 *
 * ⚠️ 不能用 [data-selected-single="true"] 定位：该属性由 shadcn 的 DayButton 输出，
 * 而 LimitUpReview.tsx 用 CustomDayButton **整个替换**了 DayButton，自定义实现并不输出这个属性
 * ⇒ 写了也永远匹配不到（曾据此写了一版，实测零命中）。改为认它真正渲染出来的渐变类。
 */
.dark .rdp-day button[class*="from-orange-400"] {
  --tw-gradient-from: color-mix(in oklab, var(--color-orange-500) 46%, var(--background));
  --tw-gradient-via: color-mix(in oklab, var(--color-orange-500) 40%, var(--background));
  --tw-gradient-to: color-mix(in oklab, var(--color-red-500) 48%, var(--background));
  border-color: color-mix(in oklab, var(--color-orange-500) 34%, var(--background));
  box-shadow: none;
}
.dark .rdp-day button[class*="from-orange-400"] span:first-child {
  color: oklch(0.94 0.02 60);
}
.dark .rdp-day button[class*="from-orange-400"] span:last-child {
  color: oklch(0.86 0.03 60);
}

/* ---- 图表（recharts）----
 * recharts 把颜色写成了 SVG 表现属性（stroke="#e2e8f0" / fill="#64748b"），
 * CSS 无法改 JS 里的字面量，但**表现属性的优先级低于任意 CSS 规则**，所以在此统一收敛。
 * 数据系列色（蓝/橙/紫）本身在暗色下足够清晰，保留不动。
 */
.dark .recharts-cartesian-grid line {
  stroke: var(--dk-l2);
}
.dark .recharts-cartesian-axis-line,
.dark .recharts-cartesian-axis-tick-line {
  stroke: var(--dk-l2);
}
.dark .recharts-cartesian-axis-tick-value,
.dark .recharts-text {
  fill: var(--dk-t3);
}
.dark .recharts-reference-line line {
  stroke: var(--dk-l3);
}
.dark .recharts-label {
  fill: var(--dk-t4);
}
/* recharts 默认 tooltip 用内联样式写死了白底，必须 !important */
.dark .recharts-default-tooltip {
  background-color: var(--popover) !important;
  border-color: var(--border) !important;
}
.dark .recharts-tooltip-label,
.dark .recharts-tooltip-item {
  color: var(--popover-foreground) !important;
}
.dark .recharts-legend-item-text {
  color: var(--dk-t4) !important;
}
.dark .recharts-pie-label-text {
  fill: var(--dk-t4);
}
.dark .recharts-sector.recharts-pie-sector + text {
  fill: var(--dk-t4);
}

/* ---- 原生控件与滚动条 ---- */
.dark {
  /* 让浏览器把原生控件（滚动条、日期选择器、下拉箭头）也切到暗色 */
  color-scheme: dark;
}

/* ---- 页面底色（避免过滚动/加载瞬间露出白底）---- */
html {
  background-color: var(--background);
}
html.dark {
  background-color: var(--background);
}
`;

const full = HEADER + out + TRAILER;
writeFileSync("client/src/theme/darkCompatibility.css", full, "utf8");
const famCount = {};
for (const [key] of inv) { const f = key.split("|")[0]; famCount[f] = (famCount[f] ?? 0) + 1; }

console.log("扫描文件数:", files.length);
console.log("盘到的 (族|色相|色阶) 组合:", inv.size);
console.log("族分布:", JSON.stringify(famCount, null, 2));
console.log("命中映射的组合:", rules.length);
console.log("生成规则数(按声明合并后):", groups.size);
console.log("输出 client/src/theme/darkCompatibility.css 字节:", full.length);
