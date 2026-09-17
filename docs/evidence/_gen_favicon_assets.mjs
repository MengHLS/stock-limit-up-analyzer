/**
 * 生成 favicon 位图资产（PNG / ICO / apple-touch-icon）。
 *
 * 为什么需要生成器：`client/public/favicon.svg` 是唯一矢量源，但 Safari 老版本与
 * 部分爬虫只认 PNG/ICO，iOS 主屏只认 PNG 的 apple-touch-icon。本项目禁止新增依赖
 * （无 Pillow / ImageMagick），因此改用「无头 Chrome 把 SVG 画进 canvas，再导出 PNG」
 * ——用浏览器自己的栅格化器，保证位图与矢量源逐像素同源。
 *
 * 只读输入：client/public/favicon.svg
 * 只写输出：client/public/{favicon-16x16.png,favicon-32x32.png,favicon.ico,apple-touch-icon.png}
 * 不访问数据库、不发外部请求。
 *
 * 用法：node docs/evidence/_gen_favicon_assets.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9391);
const SVG_IN = resolve("client/public/favicon.svg");
const OUT_DIR = resolve("client/public");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把若干尺寸的 PNG 字节装进 ICO 容器（PNG 内嵌式，Vista+ 兼容）。 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4);

  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dir = Buffer.alloc(dirSize);
  entries.forEach((entry, index) => {
    const base = index * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 0); // width
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1); // height
    dir.writeUInt8(0, base + 2); // 调色板数
    dir.writeUInt8(0, base + 3); // reserved
    dir.writeUInt16LE(1, base + 4); // color planes
    dir.writeUInt16LE(32, base + 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, base + 8); // 数据长度
    dir.writeUInt32LE(offset, base + 12); // 数据偏移
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

async function main() {
  const svgText = readFileSync(SVG_IN, "utf8");
  // data URL 走 encodeURIComponent（SVG 含中文注释，不能直接 btoa）
  const roundedUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  // iOS 主屏图标由系统统一裁圆角 ⇒ 用满幅（去掉 rx）版本，避免二次圆角出现白边
  const fullBleedUrl =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svgText.replace('<rect width="32" height="32" rx="8"', '<rect width="32" height="32"'));

  const profile = mkdtempSync(join(tmpdir(), "chrome-favicon-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-proxy-server",
      "--no-first-run",
      "--disable-extensions",
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
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");

  /** 在浏览器里把 SVG 画进指定尺寸的 canvas，取回 PNG 的 base64。 */
  const rasterize = async (url, size) => {
    const res = await send("Runtime.evaluate", {
      expression: `(async () => {
        const img = new Image();
        img.decoding = "sync";
        await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("SVG 解码失败")); img.src = ${JSON.stringify(url)}; });
        const c = document.createElement("canvas");
        c.width = ${size}; c.height = ${size};
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        return c.toDataURL("image/png").split(",")[1];
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = res.result?.result?.value;
    if (typeof value !== "string") {
      // 页面内异常会以 exceptionDetails 回来（Promise 被拒时 result.value 是个空对象，
      // 直接丢给 Buffer.from 只会得到含糊的 “Received an instance of Object”，故在此显式取原文）
      const detail = res.result?.exceptionDetails;
      throw new Error(
        `栅格化失败（${size}px）：${detail?.exception?.description ?? detail?.text ?? "返回值不是字符串"}`,
      );
    }
    return Buffer.from(value, "base64");
  };

  const png16 = await rasterize(roundedUrl, 16);
  const png32 = await rasterize(roundedUrl, 32);
  const png180 = await rasterize(fullBleedUrl, 180);

  const writes = [
    ["favicon-16x16.png", png16],
    ["favicon-32x32.png", png32],
    ["apple-touch-icon.png", png180],
    ["favicon.ico", buildIco([{ size: 16, png: png16 }, { size: 32, png: png32 }])],
  ];
  for (const [name, bytes] of writes) {
    writeFileSync(join(OUT_DIR, name), bytes);
    console.log(`写入 client/public/${name}  ${bytes.length} 字节`);
  }

  ws.close();
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("生成失败：", err.message);
  process.exit(2);
});
