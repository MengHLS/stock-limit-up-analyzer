/**
 * STEP 12 串行回填编排器（BaoStock 单 Session 串行约束 §30）。
 *
 * 职责：等 G（行业）完成后，自动串行启动 C+E（状态+流动性）、D（公司行为+复权），
 * 全程写日志，步骤失败自动重试（各 CLI 内部幂等/resume，重试安全）。
 *
 * 用法（在项目根目录，nohup 后台跨会话运行）：
 *   nohup node scripts/orchestrate_backfill.mjs > scripts/_orchestrate.log 2>&1 &
 *
 * 串行链：G(已在跑,轮询等待) → C+E(backfillStatusLiquidity) → D(backfillCorporateActionsBaostock)
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PY = "C:/Users/A/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const G_MIN_INDUSTRY = 5400; // 行业覆盖阈值（全市场约 5552，留出无行业归属股票）
const POLL_MS = 60_000; // 轮询间隔
const STEP_MAX_RETRY = 3; // 每个步骤最多重试次数

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 日志只走 stdout，由 nohup 统一重定向到 scripts/_orchestrate.log
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 读 DATABASE_URL 并建立连接（复用 step12_certify_gate.mjs 的连接逻辑）
function getDbConfig() {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: +u.port,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: true },
    connectTimeout: 15000,
  };
}

async function getIndustryCover() {
  const conn = await mysql.createConnection(getDbConfig());
  try {
    const [r] = await conn.query("SELECT COUNT(DISTINCT securityCode) c FROM industry_assignments");
    return Number(r[0].c);
  } finally {
    await conn.end();
  }
}

/** 轮询等待 G 行业回填完成；若连续停滞（G 进程可能崩溃），自动重启 G（resume 幂等）。 */
async function waitForIndustry(minSec) {
  log(`[等待G] 轮询 industry_assignments 覆盖，阈值 >= ${minSec} 只`);
  let lastCover = -1;
  let stallRounds = 0;
  const STALL_LIMIT = 5; // 连续 5 轮（每轮 60s）覆盖数不变 → 判定 G 停滞
  while (true) {
    let cover = -1;
    try {
      cover = await getIndustryCover();
      log(`[等待G] industry 覆盖 ${cover} 只（目标 ${minSec}，停滞 ${stallRounds}/${STALL_LIMIT} 轮）`);
    } catch (e) {
      log(`[等待G] 轮询失败（${e instanceof Error ? e.message : e}），继续等待`);
      await sleep(POLL_MS);
      continue;
    }

    if (cover >= minSec) {
      log(`[等待G] 完成：industry 覆盖 ${cover} 只 >= ${minSec}`);
      return;
    }

    if (cover === lastCover) {
      stallRounds += 1;
      if (stallRounds >= STALL_LIMIT) {
        log(`[等待G] 覆盖数连续 ${STALL_LIMIT} 轮未增长，判定 G 停滞，自动重启 G 回填（resume）`);
        await runStep(
          "G-restart",
          ["scripts/backfillIndustry.ts", "--universe-from-db"],
          {},
        );
        stallRounds = 0;
        lastCover = -1; // 重启后重新校准基线
        continue;
      }
    } else {
      stallRounds = 0;
    }
    lastCover = cover;
    await sleep(POLL_MS);
  }
}

/** 运行一个回填 CLI，返回 exit code。 */
function runCli(name, args, extraEnv = {}) {
  return new Promise((resolve) => {
    log(`[${name}] 启动：npx tsx ${args.join(" ")}`);
    const child = spawn("npx", ["tsx", ...args], {
      cwd: ROOT,
      env: { ...process.env, MARKETDATA_PYTHON: PY, BAOSTOCK_PYTHON: PY, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let tail = "";
    const cap = (buf) => {
      tail = (tail + buf.toString()).slice(-4000);
    };
    child.stdout.on("data", (d) => {
      process.stdout.write(`[${name}] ${d}`);
      cap(d);
    });
    child.stderr.on("data", (d) => {
      process.stderr.write(`[${name}:err] ${d}`);
      cap(d);
    });
    child.on("error", (e) => {
      log(`[${name}] spawn 错误：${e.message}`);
      resolve(-1);
    });
    child.on("close", (code) => {
      log(`[${name}] 退出 code=${code}${code !== 0 ? `；尾部输出：${tail.slice(-1500)}` : ""}`);
      resolve(code ?? -1);
    });
  });
}

/** 带重试地运行一个步骤。 */
async function runStep(name, args, extraEnv) {
  for (let attempt = 1; attempt <= STEP_MAX_RETRY; attempt += 1) {
    log(`[${name}] 第 ${attempt}/${STEP_MAX_RETRY} 次尝试`);
    const code = await runCli(name, args, extraEnv);
    if (code === 0) {
      log(`[${name}] 成功（第 ${attempt} 次）`);
      return true;
    }
    log(`[${name}] 失败（code=${code}），${attempt < STEP_MAX_RETRY ? "60s 后重试" : "放弃"}`);
    if (attempt < STEP_MAX_RETRY) await sleep(60_000);
  }
  return false;
}

async function main() {
  log("========== STEP 12 串行回填编排器启动 ==========");

  // 1. 等待 G 完成
  await waitForIndustry(G_MIN_INDUSTRY);

  // 2. C+E（状态 + 流动性）
  const ceOk = await runStep(
    "C+E",
    [
      "scripts/backfillStatusLiquidity.ts",
      "--universe-from-db",
      "--from=2019-01-01",
      "--to=2026-09-04",
    ],
    {},
  );
  if (!ceOk) {
    log("[C+E] 多次失败，跳过 D，编排器终止（可手工重跑）");
    return;
  }

  // 3. D（公司行为 + 复权因子）
  await runStep(
    "D",
    [
      "scripts/backfillCorporateActionsBaostock.ts",
      "--phase=both",
      "--from=2019-01-01",
    ],
    {},
  );

  log("========== 串行回填编排器结束 ==========");
}

main().catch((e) => {
  log(`编排器异常：${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
