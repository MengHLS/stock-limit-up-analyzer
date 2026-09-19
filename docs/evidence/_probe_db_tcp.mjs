/**
 * 只读诊断：跨境 TiDB 的 **TCP 可达性**（不涉及任何业务查询、不打印凭据）。
 *
 * 背景：2026-09-19 22:14 起，dev server 的龙头候选重端点连续 500：
 *   ① 22:12  `Connection lost: The server closed the connection.`（169.7s，栈顶 loadBacktestPriceRows）
 *   ② 22:15  `connect ETIMEDOUT`（119.9s）
 * 独立探针新建连接 3/3 失败。本脚本只回答「TCP 层是否还通」。
 *
 * 用法：node docs/evidence/_probe_db_tcp.mjs
 */
import { readFileSync } from "node:fs";
import net from "node:net";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const raw = env.DATABASE_URL ?? "";
const u = new URL(raw);
const host = u.hostname;
const port = u.port ? Number(u.port) : 4000;
console.log(`目标：host=${host} port=${port}（凭据不打印）`);

function tcpProbe(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (verdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ verdict, ms: Date.now() - t0 });
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done("CONNECTED"));
    socket.on("timeout", () => done("TIMEOUT"));
    socket.on("error", (e) => done(`ERROR:${e.code ?? e.message}`));
  });
}

console.log("\n=== TCP 连通性（连续 4 次，间隔 2s） ===");
for (let i = 1; i <= 4; i += 1) {
  const r = await tcpProbe();
  console.log(`第 ${i} 次：${r.verdict}  ${r.ms}ms`);
  if (i < 4) await new Promise((r2) => setTimeout(r2, 2000));
}

/* 对照组：同机对公网 HTTP 的可达性（判断是本机出网问题还是目标侧问题） */
console.log("\n=== 对照组：公网 HTTPS（判断本机出网是否正常） ===");
for (const url of ["https://www.baidu.com/", "https://api.github.com/"]) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    console.log(`${url}  →  HTTP ${res.status}  ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`${url}  →  ERR ${e.name}: ${e.message}  ${Date.now() - t0}ms`);
  }
}
