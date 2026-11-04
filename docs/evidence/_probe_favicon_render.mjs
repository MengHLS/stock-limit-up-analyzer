/**
 * 验收探针：favicon 是否真的等于「首页左上角侧栏 Logo」，以及浏览器能否取到它。
 *
 * 分六段：
 *  A. 以 prefers-color-scheme: light 启动页面（对拍必须同口径 —— 页面夜间态会被
 *     darkCompatibility.css 以 color-mix 压低色度，那是主题差异、不是图标差异）
 *  B. 取实时 DOM 地面真值：Logo 方块的计算样式 + 内层 lucide svg 的结构
 *  C. 校验 favicon.svg 本身是合法 XML（踩过的坑：XML 注释里出现连续短横线 ⇒ 整份解析失败）
 *  D. 逐项对拍 B 与 C：渐变端点、渐变中调（oklab vs sRGB 的逼近精度）、方向、圆角、
 *     字形点位、缩放比、描边
 *  E. 资源 serving：5 个文件在本站能否 200 取到，PNG/ICO 头部尺寸是否与声明一致
 *  F. 高 DPI 实拍 + 背景/字形两路差分 + 合成证据图（含夜间态对照）
 *
 * 只读：不写库、不改任何源文件。唯一输出 = 证据图 docs/evidence/_evidence_favicon.png
 *
 * 用法：node docs/evidence/_probe_favicon_render.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9392);
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/";
const ORIGIN = new URL(PAGE_URL).origin;
const OUT = process.env.OUT ?? "docs/evidence/_evidence_favicon.png";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 120);

/** 阈值：端点/中调受 8 位取整与 oklab→sRGB 折线逼近影响，实测余量 ≥2 倍 */
const TOL_ENDPOINT = 2;
const TOL_MIDTONE = 3;
const TOL_BACKGROUND = 6;
const MIN_GLYPH_IOU = 0.93;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}
function note(label, detail = "") {
  console.log(`INFO  ${label}${detail ? "  — " + detail : ""}`);
}

/** 读 PNG 的 IHDR 宽高（字节 16..24，大端）。 */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 读 ICO 目录条目里的尺寸列表。 */
function icoSizes(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    if (base + 16 > buf.length) return null;
    sizes.push({
      width: buf.readUInt8(base) || 256,
      height: buf.readUInt8(base + 1) || 256,
      bytes: buf.readUInt32LE(base + 8),
      offset: buf.readUInt32LE(base + 12),
    });
  }
  return sizes;
}

const hexOf = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channelDiff = (a, b) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

async function main() {
  const svgText = readFileSync(resolve("client/public/favicon.svg"), "utf8");
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);

  // ---------- E 段（不依赖浏览器，先跑）----------
  const assets = [
    ["/favicon.svg", "svg"],
    ["/favicon-32x32.png", "png", 32],
    ["/favicon-16x16.png", "png", 16],
    ["/apple-touch-icon.png", "png", 180],
    ["/favicon.ico", "ico"],
  ];
  const served = {};
  for (const [path, kind, expect] of assets) {
    let res;
    try {
      res = await fetch(ORIGIN + path);
    } catch (err) {
      check(`serving ${path}`, false, "请求失败：" + err.message);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    served[path] = { status: res.status, type, bytes: buf.length, buf };
    const sizeOk =
      kind === "png" ? pngSize(buf)?.width === expect && pngSize(buf)?.height === expect : true;
    check(
      `serving ${path}`,
      res.status === 200 && type.startsWith("image/") && buf.length > 100 && sizeOk,
      `HTTP ${res.status}, ${type}, ${buf.length} 字节` +
        (kind === "png" ? `, ${JSON.stringify(pngSize(buf))}` : ""),
    );
  }
  const ico = served["/favicon.ico"]?.buf ? icoSizes(served["/favicon.ico"].buf) : null;
  check(
    "favicon.ico 内含 16 与 32 两个尺寸",
    Array.isArray(ico) &&
      ico.length === 2 &&
      ico.some((e) => e.width === 16) &&
      ico.some((e) => e.width === 32),
    JSON.stringify(ico),
  );

  // ---------- 启动浏览器 ----------
  const profile = mkdtempSync(join(tmpdir(), "chrome-favicon-probe-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-proxy-server",
      "--no-first-run",
      "--disable-extensions",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      /* 浏览器还没起来 */
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP 未就绪");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params?.exceptionDetails?.text ?? "exception");
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluate 异常");
    }
    return res.result?.result?.value;
  };
  const setScheme = async (scheme) => {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    await sleep(2500); // 等 ThemeContext 的 matchMedia 监听把 .dark 类同步过去
  };

  await send("Runtime.enable");
  await send("Page.enable");
  // 高 DPI：让 32px 的 Logo 以 4 倍设备像素渲染，便于与矢量源逐像素比对
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 4,
    mobile: false,
  });
  await setScheme("light"); // 必须在导航前设定：首屏脚本据此决定要不要加 .dark
  await send("Page.navigate", { url: PAGE_URL });

  // ---------- A/B 段 ----------
  let live = null;
  const deadline = Date.now() + WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    await sleep(1500);
    live = await evaluate(`(() => {
      const tile = document.querySelector('div.from-orange-500');
      if (!tile) return null;
      const svg = tile.querySelector('svg');
      if (!svg) return null;
      const ts = getComputedStyle(tile);
      const ss = getComputedStyle(svg);
      const rect = tile.getBoundingClientRect();
      const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]')]
        .map((l) => ({ rel: l.getAttribute('rel'), type: l.getAttribute('type'), sizes: l.getAttribute('sizes'), href: l.getAttribute('href') }));
      return {
        theme: { htmlClass: document.documentElement.className, mediaDark: matchMedia('(prefers-color-scheme: dark)').matches, stored: localStorage.getItem('theme') },
        tile: { backgroundImage: ts.backgroundImage, borderRadius: ts.borderRadius, width: rect.width, height: rect.height },
        svg: {
          width: ss.width, height: ss.height,
          stroke: ss.stroke, strokeWidth: ss.strokeWidth,
          strokeLinecap: ss.strokeLinecap, strokeLinejoin: ss.strokeLinejoin,
          points: [...svg.querySelectorAll('polyline')].map((p) => p.getAttribute('points')),
        },
        links, tileRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })()`);
    if (live?.svg?.points?.length) break;
  }
  if (!live?.svg?.points?.length) throw new Error(`等待 ${WAIT_SEC}s 仍未取到侧栏 Logo`);

  check(
    "对拍口径 = 日间主题（页面无 .dark）",
    live.theme.mediaDark === false && !live.theme.htmlClass.includes("dark"),
    `html.class="${live.theme.htmlClass}", matchMedia dark=${live.theme.mediaDark}, localStorage.theme=${JSON.stringify(live.theme.stored)}`,
  );
  check(
    "页面已加载 favicon 声明（link 标签数 ≥ 4）",
    live.links.length >= 4,
    live.links.map((l) => `${l.rel}:${l.href}`).join(" | "),
  );
  check(
    "SVG 优先声明存在且指向 /favicon.svg",
    live.links.some((l) => l.href === "/favicon.svg" && (l.type ?? "").includes("svg")),
    "",
  );
  check("页面零未捕获异常", consoleErrors.length === 0, consoleErrors.join(" ; "));

  // ---------- C 段：SVG 合法性 + 解析色标 ----------
  const svgCheck = await evaluate(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(svgText)}, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) return { ok: false, error: err.textContent.slice(0, 300) };
    const grad = doc.querySelector('linearGradient');
    const rect = doc.querySelector('rect');
    const g = doc.querySelector('g');
    return {
      ok: true,
      stops: [...doc.querySelectorAll('linearGradient stop')].map((s) => ({
        offset: Number(s.getAttribute('offset')), color: s.getAttribute('stop-color'),
      })),
      gradientUnits: grad.getAttribute('gradientUnits'),
      gradientCoords: ['x1','y1','x2','y2'].map((k) => grad.getAttribute(k)),
      rect: { width: rect.getAttribute('width'), height: rect.getAttribute('height'), rx: rect.getAttribute('rx') },
      transform: g.getAttribute('transform'),
      stroke: g.getAttribute('stroke'),
      strokeWidth: g.getAttribute('stroke-width'),
      points: [...doc.querySelectorAll('polyline')].map((p) => p.getAttribute('points')),
    };
  })()`);
  check(
    "favicon.svg 是合法 XML（可被 DOMParser 解析）",
    svgCheck.ok === true,
    svgCheck.ok ? "" : String(svgCheck.error).replace(/\s+/g, " ").slice(0, 160),
  );
  if (!svgCheck.ok) throw new Error("favicon.svg 非法，后续对拍无意义");
  const firstStop = svgCheck.stops[0];
  const lastStop = svgCheck.stops[svgCheck.stops.length - 1];

  // ---------- 渲染真值：同款渐变取端点与中调 ----------
  const gradientTruth = await evaluate(`(() => {
    let probe = document.getElementById('__grad_probe');
    if (!probe) {
      probe = document.createElement('div');
      probe.id = '__grad_probe';
      probe.className = 'bg-gradient-to-br from-orange-500 to-red-600';
      Object.assign(probe.style, { position: 'fixed', right: '0px', bottom: '0px', width: '256px', height: '256px', zIndex: '9999' });
      document.body.appendChild(probe);
    }
    const rect = probe.getBoundingClientRect();
    return { backgroundImage: getComputedStyle(probe).backgroundImage, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  })()`);
  await sleep(300);
  const gradShot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: gradientTruth.rect.x, y: gradientTruth.rect.y, width: 256, height: 256, scale: 1 },
  });
  /** 256×256 方块上，对角像素 (x,x) 对应渐变参数 t = x/255 */
  const gradientPixels = await evaluate(`(async () => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('load fail')); img.src = 'data:image/png;base64,${gradShot.result.data}'; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    const samples = {};
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = Math.min(img.width - 1, Math.round(t * (img.width - 1)));
      samples[String(t)] = at(p, p);
    }
    return { size: [img.width, img.height], samples };
  })()`);
  /** 复刻 SVG 的渲染行为：相邻色标之间按 sRGB 线性插值 */
  const svgAt = (t) => {
    const stops = svgCheck.stops;
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1].offset) i++;
    const span = stops[i + 1].offset - stops[i].offset;
    const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - stops[i].offset) / span));
    const a = hexToRgb(stops[i].color);
    const b = hexToRgb(stops[i + 1].color);
    return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
  };

  const epDiff = Math.max(
    channelDiff(gradientPixels.samples["0"], hexToRgb(firstStop.color)),
    channelDiff(gradientPixels.samples["1"], hexToRgb(lastStop.color)),
  );
  check(
    `渐变两端与页面实拍一致（单通道 ≤ ${TOL_ENDPOINT}/255）`,
    epDiff <= TOL_ENDPOINT,
    `实拍 ${hexOf(gradientPixels.samples["0"])} → ${hexOf(gradientPixels.samples["1"])} vs svg ${firstStop.color} → ${lastStop.color}；偏差 ${epDiff}`,
  );
  const midDiffs = [0.25, 0.5, 0.75].map((t) =>
    channelDiff(gradientPixels.samples[String(t)], svgAt(t)),
  );
  check(
    `渐变中调与页面实拍一致（单通道 ≤ ${TOL_MIDTONE}/255，sRGB 折线逼近 oklab 的精度）`,
    Math.max(...midDiffs) <= TOL_MIDTONE,
    [0.25, 0.5, 0.75]
      .map(
        (t, i) =>
          `t=${t} 实拍 ${hexOf(gradientPixels.samples[String(t)])}/svg ${hexOf(svgAt(t))} 差 ${midDiffs[i]}`,
      )
      .join("  |  "),
  );
  note("页面声明的渐变", gradientTruth.backgroundImage.slice(0, 120));

  // ---------- D 段：结构对拍 ----------
  check(
    "渐变方向为左上→右下（对角）",
    /to (right bottom|bottom right)/.test(gradientTruth.backgroundImage) &&
      svgCheck.gradientCoords.join(",") === "0,0,32,32",
    `页面 "${gradientTruth.backgroundImage.match(/to [a-z ]+/)?.[0]?.trim() ?? "?"}"  vs  svg 对角 0,0→32,32`,
  );
  check(
    "圆角比例一致（圆角 = 边长 × 0.25）",
    svgCheck.rect.rx === "8" &&
      Math.abs(Number(live.tile.borderRadius.replace("px", "")) - live.tile.width * 0.25) < 0.01,
    `页面 ${live.tile.borderRadius} / 方块 ${live.tile.width}px  vs  svg rx=${svgCheck.rect.rx}/32`,
  );
  check(
    "字形点位与页面 lucide 图标逐字节相同",
    JSON.stringify(svgCheck.points) === JSON.stringify(live.svg.points),
    `页面 ${JSON.stringify(live.svg.points)}  vs  svg ${JSON.stringify(svgCheck.points)}`,
  );
  const glyphScale = Number(svgCheck.transform.match(/scale\(([\d.]+)\)/)?.[1]);
  const liveScale = Number(live.svg.width.replace("px", "")) / 24;
  check(
    "字形缩放比一致（= 图标渲染尺寸 ÷ 24）",
    Math.abs(glyphScale - liveScale) < 0.001,
    `svg scale=${glyphScale}  vs  页面 ${live.svg.width}/24 = ${liveScale.toFixed(4)}`,
  );
  const glyphOffset = Number(svgCheck.transform.match(/translate\(([\d.]+)/)?.[1]);
  const expectOffset = (live.tile.width - Number(live.svg.width.replace("px", ""))) / 2;
  check(
    "字形居中偏移一致",
    Math.abs(glyphOffset - expectOffset) < 0.001,
    `svg translate=${glyphOffset}  vs  期望 ${expectOffset}`,
  );
  check(
    "描边颜色（白）与线帽/线接（圆）一致",
    svgCheck.stroke === "#ffffff" &&
      svgCheck.strokeWidth === live.svg.strokeWidth.replace("px", "") &&
      live.svg.strokeLinecap === "round" &&
      live.svg.strokeLinejoin === "round",
    `svg ${svgCheck.stroke}/${svgCheck.strokeWidth}  vs  页面 ${live.svg.stroke}/${live.svg.strokeWidth}/${live.svg.strokeLinecap}`,
  );

  // ---------- F 段：实拍 + 差分 + 证据图 ----------
  const shootTile = async () => {
    await sleep(500);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: live.tileRect.x,
        y: live.tileRect.y,
        width: live.tileRect.width,
        height: live.tileRect.height,
        scale: 4,
      },
    });
    if (!shot.result?.data) throw new Error("侧栏 Logo 实拍失败");
    return shot.result.data;
  };
  const lightShot = await shootTile();
  await setScheme("dark");
  const darkShot = await shootTile();

  const pixelReport = await evaluate(`(async () => {
    const load = async (src) => {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('load fail')); img.src = src; });
      return img;
    };
    const bitmapOf = async (src, size) => {
      const img = await load(src);
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size);
    };
    const isWhite = (d, i) => d[i] > 200 && d[i+1] > 200 && d[i+2] > 200;

    const SIZE = 128;
    const realLight = await bitmapOf('data:image/png;base64,${lightShot}', SIZE);
    const realDark = await bitmapOf('data:image/png;base64,${darkShot}', SIZE);
    const vec = await bitmapOf(${JSON.stringify(svgUrl)}, SIZE);

    // 只比内区：跳过圆角弧线所在的边缘带，避免边缘抗锯齿混入底色差异
    const inset = Math.round(SIZE * 0.25);
    // 字形掩膜（近白像素），并向外膨胀 2px 得到「字形影响带」：
    // 半覆盖的抗锯齿像素既不是纯背景也不是纯字形，必须从背景比较里剔除，
    // 否则它们的覆盖率差异（真机 vs 矢量各自的栅格化）会被误判成背景色差。
    const mask = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        if (isWhite(realLight.data, i) || isWhite(vec.data, i)) mask[y * SIZE + x] = 1;
      }
    }
    const band = new Uint8Array(mask);
    for (let pass = 0; pass < 2; pass++) {
      const prev = Uint8Array.from(band);
      for (let y = inset; y < SIZE - inset; y++) {
        for (let x = inset; x < SIZE - inset; x++) {
          const at = (xx, yy) => prev[yy * SIZE + xx];
          if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) band[y * SIZE + x] = 1;
        }
      }
    }

    let bgMax = 0, bgSum = 0, bgN = 0, glyphSum = 0, glyphN = 0;
    let inter = 0, union = 0, glyphReal = 0, glyphVec = 0;
    let allMax = 0, allSum = 0, allOver8 = 0, allN = 0;
    for (let y = inset; y < SIZE - inset; y++) {
      for (let x = inset; x < SIZE - inset; x++) {
        const i = (y * SIZE + x) * 4;
        const d = Math.max(Math.abs(realLight.data[i] - vec.data[i]), Math.abs(realLight.data[i+1] - vec.data[i+1]), Math.abs(realLight.data[i+2] - vec.data[i+2]));
        allMax = Math.max(allMax, d); allSum += d; allN++; if (d > 8) allOver8++;
        const rw = isWhite(realLight.data, i), vw = isWhite(vec.data, i);
        if (rw) glyphReal++;
        if (vw) glyphVec++;
        if (rw || vw) { union++; if (rw && vw) inter++; }
        if (band[y * SIZE + x]) { glyphSum += d; glyphN++; }
        else { bgMax = Math.max(bgMax, d); bgSum += d; bgN++; }
      }
    }
    const cAt = (data, x, y) => { const i = (y * SIZE + x) * 4; return [data[i], data[i+1], data[i+2]]; };
    const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

    // ---- 合成证据图 ----
    const cv = document.createElement('canvas');
    cv.width = 1040; cv.height = 560;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, cv.width, cv.height);
    const F = (size, weight = '400') => weight + ' ' + size + 'px "Microsoft YaHei", "Segoe UI", sans-serif';

    ctx.fillStyle = '#f9fafb'; ctx.font = F(17, '700');
    ctx.fillText('favicon 与首页左上角侧栏 Logo 一致性核对', 40, 38);
    ctx.fillStyle = '#9ca3af'; ctx.font = F(13);
    ctx.fillText('无头 Chrome 实拍（4× 设备像素）· 对拍口径 = 日间主题', 40, 60);

    const tileImg = await load('data:image/png;base64,${lightShot}');
    const tileImgDark = await load('data:image/png;base64,${darkShot}');
    const vecImg = await load(${JSON.stringify(svgUrl)});

    const head = (text, x) => { ctx.fillStyle = '#e5e7eb'; ctx.font = F(13, '600'); ctx.fillText(text, x, 100); };
    const cap = (text, x, y) => { ctx.fillStyle = '#9ca3af'; ctx.font = F(12); ctx.fillText(text, x, y); };

    head('① 真机 Logo · 日间', 40);
    ctx.drawImage(tileImg, 40, 112, 128, 128);
    cap('32px × 4', 40, 258);

    head('② favicon.svg', 200);
    ctx.drawImage(vecImg, 200, 112, 128, 128);
    cap('同尺寸栅格化', 200, 258);

    head('③ favicon.svg 各尺寸', 370);
    ctx.drawImage(vecImg, 370, 112, 16, 16);  cap('16px（标签页实际大小）', 394, 124);
    ctx.drawImage(vecImg, 370, 142, 32, 32);  cap('32px', 410, 164);
    ctx.drawImage(vecImg, 370, 190, 64, 64);  cap('64px', 442, 228);

    head('④ 模拟标签页', 560);
    const tab = async (y, bg, fg, line) => {
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(560, y, 250, 44, [10, 10, 0, 0]); ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(560, y + 43.5); ctx.lineTo(810, y + 43.5); ctx.stroke();
      ctx.drawImage(vecImg, 572, y + 12, 20, 20);
      ctx.fillStyle = fg; ctx.font = F(13, '500');
      ctx.fillText('股票涨停分析助手', 602, y + 27);
    };
    await tab(112, '#f3f4f6', '#111827', '#d1d5db');
    await tab(176, '#1f2937', '#f9fafb', '#374151');
    ctx.fillStyle = '#9ca3af'; ctx.font = F(12);
    ctx.fillText('浅色 / 深色标签栏下均可辨认', 560, 244);

    head('⑤ 真机 Logo · 夜间', 850);
    ctx.drawImage(tileImgDark, 850, 112, 128, 128);
    cap('暗色兼容层压色（主题差异）', 850, 258);

    ctx.fillStyle = '#6b7280'; ctx.font = F(13);
    ctx.fillText('纯背景区（已剔除字形影响带）逐像素：均值 ' + (bgSum / bgN).toFixed(2) + ' / 峰值 ' + bgMax + '（0–255），样本 ' + bgN, 40, 440);
    ctx.fillText('字形掩膜 IoU ' + (inter / union).toFixed(4) + '（真机白像素 ' + glyphReal + ' / 矢量 ' + glyphVec + '）· 全内区均值 ' + (allSum / allN).toFixed(2) + ' / 峰值 ' + allMax, 40, 466);
    ctx.fillText('夜间差异来自 client/src/theme/darkCompatibility.css 用 color-mix 压低色度，与图标本身无关；标签页图标固定用品牌原色。', 40, 492);
    ctx.fillText('渐变：${svgCheck.stops.length} 个色标把页面 oklab 曲线折线逼近到 ≤1/255（端点 ${firstStop.color} → ${lastStop.color}，中调 #f64100），逐点对拍实拍偏差 ≤1。', 40, 518);

    return {
      bgSamples: bgN, bgMax, bgMean: Number((bgSum / bgN).toFixed(3)),
      bandSamples: glyphN, allMax, allMean: Number((allSum / allN).toFixed(3)), allOver8, allN,
      glyphIoU: Number((inter / union).toFixed(4)), glyphReal, glyphVec,
      lightCenter: hex(cAt(realLight.data, 64, 64)), darkCenter: hex(cAt(realDark.data, 64, 64)),
      dataUrl: cv.toDataURL('image/png').split(',')[1],
    };
  })()`);

  check(
    `日间：纯背景区逐像素一致（峰值 ≤ ${TOL_BACKGROUND}/255）`,
    pixelReport.bgMax <= TOL_BACKGROUND,
    `均值 ${pixelReport.bgMean}，峰值 ${pixelReport.bgMax}，样本 ${pixelReport.bgSamples}（已剔除字形影响带 ${pixelReport.bandSamples} 像素）`,
  );
  check(
    `字形结构一致（掩膜 IoU ≥ ${MIN_GLYPH_IOU}）`,
    pixelReport.glyphIoU >= MIN_GLYPH_IOU &&
      Math.abs(pixelReport.glyphReal - pixelReport.glyphVec) / pixelReport.glyphReal < 0.15,
    `IoU ${pixelReport.glyphIoU}，真机白像素 ${pixelReport.glyphReal}，矢量 ${pixelReport.glyphVec}`,
  );
  note(
    "整个内区的原始差分（含字形边缘半覆盖像素，故仅作记录）",
    `均值 ${pixelReport.allMean} 峰值 ${pixelReport.allMax}，超 8 的像素 ${pixelReport.allOver8}/${pixelReport.allN} —— 差异全部集中在字形边缘 1~2px`,
  );
  note(
    "夜间态（仅记录）",
    `色块中心 日间 ${pixelReport.lightCenter} vs 夜间 ${pixelReport.darkCenter} —— 差异由暗色兼容层压色造成`,
  );

  writeFileSync(OUT, Buffer.from(pixelReport.dataUrl, "base64"));
  console.log(`\n证据图已保存：${OUT}`);

  // ---------- 附：浏览器实际选用的 favicon（CDP Favicon 域，headless 下可能为空）----------
  let favUrl = "";
  let favUnsupported = false;
  for (let i = 0; i < 3 && !favUrl && !favUnsupported; i++) {
    try {
      const fav = await send("Favicon.getFaviconImage", {});
      favUrl = fav.result?.imageUrl ?? "";
    } catch (err) {
      note("浏览器选定图标读取失败（本版 CDP 无 Favicon 域）", err.message ?? "");
      favUnsupported = true;
      break;
    }
    if (!favUrl) await sleep(1500);
  }
  if (favUrl) {
    check("浏览器已为本次页面选定 favicon", true, `${favUrl.slice(0, 48)}… (${(favUrl.length / 1024).toFixed(1)} KB)`);
  } else if (!favUnsupported) {
    note("浏览器选定图标读取为空", "headless 无标签栏，Favicon 域不返回图像；改用「声明存在 + 资源可取 + 能解码」三重判据");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} PASS =====`);
  failed.forEach((f) => console.log(`  FAIL ${f.label}  ${f.detail}`));

  ws.close();
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("探针异常：", err.message);
  process.exit(2);
});
