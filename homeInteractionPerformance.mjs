import fs from "node:fs";

const debugPort = process.argv[2] ?? "9243";
const debugUrl = `http://127.0.0.1:${debugPort}/json`;
const pageUrl = "http://127.0.0.1:3000/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await (await fetch(debugUrl)).json();
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("找不到Chromium调试页面");
}

const ws = new WebSocket(await findPage());
let sequence = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression });
  return result.result?.value;
}

async function waitFor(expression, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(80);
  }
  return null;
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.navigate", { url: pageUrl });
await waitFor("document.body?.innerText.includes('涨停股票')", 10000);
await sleep(300);

const initial = await evaluate(`(() => ({
  heading: document.body.innerText.match(/涨停股票\\s*\\d+\\s*只/)?.[0] ?? null,
  stockCode: document.querySelector('.font-mono')?.textContent?.trim() ?? null,
  dateButtons: [...document.querySelectorAll('[role="gridcell"] button, button[aria-label]')]
    .map((button) => ({ text: button.textContent?.trim() ?? '', label: button.getAttribute('aria-label') ?? '' }))
    .filter((item) => item.text || item.label)
    .slice(0, 80),
} ))()`);

const searchStart = Date.now();
await evaluate(`(() => {
  const input = document.querySelector('input[placeholder="搜索股票代码或名称..."]');
  if (!input) return false;
  input.focus();
  return true;
})()`);
if (initial.stockCode) await cdp("Input.insertText", { text: initial.stockCode });
const searchReady = await waitFor("document.body?.innerText.includes('搜索结果')", 5000);
const searchMs = Date.now() - searchStart;

const firstBoardStart = Date.now();
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '当日首板');
  if (!button) return false;
  button.click();
  return true;
})()`);
const firstBoardHeading = await waitFor("document.body?.innerText.match(/涨停股票\\s*\\d+\\s*只/)?.[0] ?? null", 1500);
const firstBoardMs = Date.now() - firstBoardStart;

await evaluate(`(() => {
  const input = document.querySelector('input[placeholder="搜索股票代码或名称..."]');
  if (!input) return false;
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(300);

const dateStart = Date.now();
const initialDateHeading = await evaluate("document.body?.innerText.match(/20\\d{2}-\\d{2}-\\d{2} 题材统计/)?.[0] ?? null");
const dateButton = await evaluate(`(() => {
  const candidate = [...document.querySelectorAll('[role="gridcell"] button[aria-label]')]
    .find((button) => {
      const label = button.getAttribute('aria-label') ?? '';
      return label && !label.includes('selected') && !button.disabled;
    });
  if (!candidate) return null;
  candidate.click();
  return candidate.getAttribute('aria-label') ?? candidate.textContent?.trim() ?? null;
})()`);
const dateHeading = await waitFor(`(() => {
  const heading = document.body?.innerText.match(/20\\d{2}-\\d{2}-\\d{2} 题材统计/)?.[0] ?? null;
  return heading && heading !== ${JSON.stringify(initialDateHeading)} ? heading : null;
})()`, 3000);
const dateMs = Date.now() - dateStart;

const result = {
  initial,
  search: { stockCode: initial.stockCode, completed: Boolean(searchReady), durationMs: searchMs },
  firstBoard: { completed: Boolean(firstBoardHeading), heading: firstBoardHeading, durationMs: firstBoardMs },
  date: { clicked: dateButton, completed: Boolean(dateHeading), heading: dateHeading, durationMs: dateMs },
};
fs.writeFileSync("home-interaction-performance.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
ws.close();
