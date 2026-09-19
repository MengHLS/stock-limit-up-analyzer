/**
 * 真库只读探针 —— 前向纸面运行的「止损参数快照」与「出清原因分布」。
 *
 * 为什么需要它：纸面运行的退出规则来自创建时写入的 `paramsJson`（含 realistic 的
 * stopLossPercent / trailing* / maxHoldingDays 等，以及 2026-09-18 起新增的 paperTrading 设置块）。
 * 创建入口（routers.ts createPaperTradingRun）允许传 options，但前端 PaperTrading.tsx 只传
 * {label, strategyKey, initialCapital} ⇒ 恒为空 options ⇒ 永远是服务端硬编码缺省。
 * 本探针读真库核对：① 现存运行实际用了什么参数；② 实际出清里有几种原因、
 * 开盘分支有没有在真库里落地过。
 *
 * 🔴 读本探针输出时必须分清两件事（2026-09-18 `9be` 更新）：
 *   - 「分支**存在**吗」⇒ 看源码（`grep -c "开盘触发止损" server/paperTrading.ts`，`9be` 后 >0）；
 *     也可看 `_probe_stoploss_divergence.mts` 的同路径对拍。
 *   - 「历史上**触发过**吗」⇒ 看本探针。纸面状态逐日推进并落库，**已推进过的日子不可回溯**，
 *     因此 `9be` 修复前的历史里出现 0 次是**历史事实**，不代表分支仍缺失。
 *
 * 只读：仅 SELECT，不写库、不改源码。输出同时落盘 `_probe_paper_run_params.out.txt`。
 * 运行：node_modules/.bin/tsx docs/evidence/_probe_paper_run_params.mts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createConnection } from "mysql2/promise";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "_probe_paper_run_params.out.txt");

const lines: string[] = [];
const log = (text = "") => { lines.push(text); };

/** 从 .env 读取 DATABASE_URL（只取键值，不回显内容）。 */
function readDatabaseUrl(): string | null {
  const envPath = join(HERE, "..", "..", ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * 与 `server/db.ts:140-165` 同一套解析：`?ssl={"rejectUnauthorized":true}` 必须从原始
 * 字符串里按 JSON 提取后**以对象**传给 mysql2，否则 mysql2 会把它当成 SSL profile 名，
 * 报 `Unknown SSL profile` 或 `insecure transport are prohibited`。
 */
function parseConnection(raw: string) {
  const sslMatch = raw.match(/[?&]ssl=(\{[^&]*\})/);
  let ssl: { rejectUnauthorized?: boolean } | undefined;
  if (sslMatch) {
    try {
      const parsed = JSON.parse(sslMatch[1]) as unknown;
      if (parsed && typeof parsed === "object") ssl = parsed as { rejectUnauthorized?: boolean };
    } catch { ssl = undefined; }
  }
  const withoutSsl = raw.replace(/[?&]ssl=\{[^&]*\}/, "");
  const parsed = new URL(withoutSsl);
  return {
    host: parsed.hostname,
    // 与 `server/db.ts:161` 一致：缺省端口取 4000（TiDB Cloud），不是 MySQL 默认 3306。
    port: parsed.port ? Number(parsed.port) : 4000,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    connectTimeout: 20_000,
    enableKeepAlive: true,
    ...(ssl ? { ssl } : {}),
  };
}

/** 回测独有 / 共有 / 纸面专属的退出原因关键字。⚠️ `find` 取**首个**命中 ⇒ 顺序即优先级，勿随意挪动。 */
const REASONS = [
  "开盘触发止损",
  "盘中触及止损",
  "收盘触发止损",
  "动态回撤止盈",
  "强势续持",
  "达到最多续持",
  "一字跌停",
  // 纸面专属（`9be` 新增）；放在最后是因为它不会与上面任何一条互为子串。
  "组合止损",
];

async function main() {
  const url = readDatabaseUrl();
  if (!url) { log("未找到 DATABASE_URL，跳过真库核对。"); return; }
  const connection = await createConnection(parseConnection(url));
  try {
    const [runs] = await connection.query(
      "SELECT id, label, strategyKey, paramsJson, initialCapital, status, lastProcessedDate "
      + "FROM paper_trading_runs ORDER BY id DESC LIMIT 20",
    );
    const runRows = runs as Array<Record<string, unknown>>;
    log(`=== 前向纸面运行（真库，最近 ${runRows.length} 条）===`);
    log();
    if (runRows.length === 0) log("（库里暂无纸面运行记录）");

    const reasonTally = new Map<string, number>();
    let totalExited = 0;

    for (const row of runRows) {
      let options: Record<string, unknown> = {};
      try { options = JSON.parse(String(row.paramsJson ?? "{}")); } catch { options = {}; }
      const realistic = (options.realistic ?? {}) as Record<string, unknown>;
      const keys = Object.keys(realistic);
      log(`#${row.id} ${row.label}`);
      log(`  策略=${row.strategyKey} 状态=${row.status} 最近处理日=${row.lastProcessedDate ?? "（未推进）"} 初始资金=${row.initialCapital}`);
      log(`  paramsJson 顶层键 = ${JSON.stringify(Object.keys(options))}`);
      log(`  realistic 实际键 = ${keys.length === 0 ? "（空 ⇒ 全部走服务端硬编码缺省）" : JSON.stringify(keys)}`);
      const paperBlock = (options.paperTrading ?? {}) as Record<string, unknown>;
      const paperKeys = Object.keys(paperBlock);
      log(`  paperTrading 实际键 = ${paperKeys.length === 0 ? "（空 ⇒ 按缺省解析：判定时点=开盘+收盘 / 组合止损=3%）" : JSON.stringify(paperKeys)}`);
      for (const key of ["exitJudgementPhase", "portfolioStopLossPercent"]) {
        const value = paperBlock[key];
        log(`    paperTrading.${key.padEnd(26)} = ${value === undefined ? "（缺省回落）" : JSON.stringify(value)}`);
      }
      log("  生效的退出参数：");
      for (const key of ["stopLossPercent", "trailingProfitActivationPercent", "trailingDrawdownPercent",
        "strongHoldMinReturn", "maxHoldingDays", "enableIntradayStopLoss", "blockLimitDownSells"]) {
        const value = realistic[key];
        log(`    ${key.padEnd(32)} = ${value === undefined ? "（缺省）" : JSON.stringify(value)}`);
      }
    }

    // 出清原因分布：从 stateJson 的 orders 里统计。
    const [states] = await connection.query(
      "SELECT id, stateJson FROM paper_trading_runs ORDER BY id DESC LIMIT 20",
    );
    for (const row of states as Array<Record<string, unknown>>) {
      let state: { orders?: Array<{ status?: string; reason?: string | null }> } = {};
      try { state = JSON.parse(String(row.stateJson ?? "{}")); } catch { continue; }
      for (const order of state.orders ?? []) {
        if (order.status !== "exited") continue;
        totalExited += 1;
        const reason = String(order.reason ?? "");
        const hit = REASONS.find((needle) => reason.includes(needle)) ?? "（其他/空）";
        reasonTally.set(hit, (reasonTally.get(hit) ?? 0) + 1);
      }
    }

    log();
    log(`=== 已出清订单的退出原因分布（共 ${totalExited} 笔）===`);
    if (totalExited === 0) log("（暂无可统计的已出清订单）");
    for (const [reason, count] of Array.from(reasonTally.entries()).sort((a, b) => b[1] - a[1])) {
      log(`  ${reason.padEnd(16)} ${count}`);
    }
    log();
    const openStopCount = reasonTally.get("开盘触发止损") ?? 0;
    const portfolioStopCount = reasonTally.get("组合止损") ?? 0;
    log(`⇒ 真库历史中「开盘触发止损」出现 ${openStopCount} 次、「组合止损」出现 ${portfolioStopCount} 次。`);
    log("   判读规则（勿混淆）：这两个数只说明**历史上触发过没有**。纸面状态逐日推进并落库，");
    log("   已推进过的日子不可回溯 ⇒ 修复前（2026-09-18 `9be` 之前）的历史必然是 0 次；");
    log("   分支**是否存在**请看源码断言（grep -c \"开盘触发止损\" server/paperTrading.ts）与");
    log("   _probe_stoploss_divergence.mts 的同路径对拍，不要用本数字下结论。");
  } finally {
    await connection.end();
  }
}

main()
  .catch((error: unknown) => { log(`探针异常：${error instanceof Error ? error.message : String(error)}`); })
  .finally(() => {
    const text = lines.join("\n") + "\n";
    writeFileSync(OUT_PATH, text, "utf8");
    process.stdout.write(text);
  });
