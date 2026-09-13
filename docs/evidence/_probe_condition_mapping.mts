/**
 * _probe_condition_mapping.mts —— 只读探针（不写库、不改生产代码）
 *
 * 目的：把用户给出的「首板回踩」策略规格（量/价/时三维过滤）逐条翻译为
 *       策略字段引用，并实查**每条今天能否表达**。
 *
 * 三问：
 *   A. 安全前置：research_runs 有无在途 Run；ds_* 事实列清单
 *   B. 字段引用解析：每条条件的左值/右值解析出的 kind / relativeDay / 是否合法
 *   C. 定义级校验：构造完整 StrategyDefinition 跑 validateCanonicalStrategyDefinition
 *
 * 用法（必须在项目根目录）：npx tsx docs/evidence/_probe_condition_mapping.mts
 */
import mysql2 from "mysql2/promise";
import dotenv from "dotenv";
import {
  parseStrategyFieldReference,
  isKnownFieldReference,
  resolveFieldTimeDomain,
  resolveSignalTimeline,
  STRATEGY_CONDITION_OPERATORS,
} from "../../server/research/strategySchema/definition";
import { validateCanonicalStrategyDefinition } from "../../server/research/strategySchema/definitionValidation";

dotenv.config();

const url = process.env.DATABASE_URL!;
const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/)!;
const conn = await mysql2.createConnection({
  host: m[3],
  port: Number(m[4]),
  user: m[1],
  password: decodeURIComponent(m[2]),
  database: m[5],
  ssl: { rejectUnauthorized: false },
});

// ── A. 安全前置 ─────────────────────────────────────────────
const [rows] = await conn.query<any[]>(
  "select status, count(*) n from research_runs group by status order by n desc",
);
console.log("=== A. research_runs 在途检查 ===");
for (const r of rows) console.log(`  ${r.status}: ${r.n}`);
const inflight = rows
  .filter((r: any) => ["RUNNING", "QUEUED", "PENDING"].includes(r.status))
  .reduce((s: number, r: any) => s + Number(r.n), 0);
console.log(`INFLIGHT = ${inflight}  => ${inflight === 0 ? "SAFE" : "BLOCKED"}\n`);

// ── A2. ds_* 事实列（验证「条件所需数据是否有地方取」） ──────
const [cols] = await conn.query<any[]>(
  `select table_name as t, column_name as c, data_type as d
     from information_schema.columns
    where table_schema = database()
      and table_name in ('ds_first_limit_pullback_event',
                         'ds_first_limit_pullback_prefix',
                         'ds_first_limit_pullback_post')
    order by table_name, ordinal_position`,
);
console.log("=== A2. ds_* 事实列 ===");
let cur = "";
for (const c of cols) {
  if (c.t !== cur) {
    cur = c.t;
    console.log(`  [${cur.replace("ds_first_limit_pullback_", "")}]`);
  }
  console.log(`    ${c.c} : ${c.d}`);
}
await conn.end();

// ── B. 逐条条件的字段引用解析 ───────────────────────────────
console.log("\n=== B. 字段引用解析（用户规格 → 策略引用） ===");

/** 用户规格逐条（左值 / 右侧是否也是字段） */
const MAPPINGS: Array<{ spec: string; left: string; right?: string; note: string }> = [
  { spec: "首板日 = 20~30 交易日内首次涨停", left: "event.daysSincePreviousLimit", note: "≥ 20（事件日属性）" },
  { spec: "排除连续涨停（首板判定）", left: "event.isFirstLimit", note: "= true（事件日属性）" },
  { spec: "实体涨停：收盘价 = 最高价", left: "prefix.rd0.close", right: "prefix.rd0.high", note: "rd=0 即首板日" },
  {
    spec: "封板量能：首板日量 ≥ 5 日均量 × 1.5",
    left: "prefix.rd0.volume",
    note: "🔴 右侧「前5日均量」需要 rd=-5..-1 的均值 ⇒ 单一字段引用表达不了",
  },
  {
    spec: "价格底线：回调期最低价 ≥ 首板日最低价",
    left: "bar.low",
    right: "prefix.rd0.low",
    note: "🔴 左侧「回调期间的最低」是窗口聚合，bar.low 只是当前那一天",
  },
  {
    spec: "量能特征：缩量 ≤ 首板日成交量 50%",
    left: "bar.volume",
    right: "prefix.rd0.volume",
    note: "🔴 右侧是字段可以；但 bar.volume 只代表当前观察日当天",
  },
  { spec: "回调时间 2~5 交易日", left: "(window)", note: "observationWindow {2,5} 或 {1,5}" },
  { spec: "信号B：放量阳线反包前一日实体", left: "bar.close", right: "prefix?!", note: "🔴「前一日」在观察窗口内是 T+k-1，窗口内相对引用表达不了" },
  { spec: "硬止损：收盘价跌破首板日最低价", left: "bar.close", right: "prefix.rd0.low", note: "exitRule.condition 可用" },
  { spec: "分时企稳", left: "—", note: "🔴 分时数据不在 ds_*（日线级），不可表达" },
];

for (const mm of MAPPINGS) {
  const parts: string[] = [];
  const l = mm.left.startsWith("(") ? null : parseStrategyFieldReference(mm.left);
  if (l) parts.push(`L ${mm.left} → ${l.kind}${"relativeDay" in l ? ` rd=${(l as any).relativeDay}` : ""} known=${isKnownFieldReference(l)} domain=${resolveFieldTimeDomain(l)}`);
  if (mm.right && mm.right !== "prefix?!") {
    const r = parseStrategyFieldReference(mm.right);
    parts.push(`R ${mm.right} → ${r.kind}${"relativeDay" in r ? ` rd=${(r as any).relativeDay}` : ""} known=${isKnownFieldReference(r)}`);
  }
  console.log(`  • ${mm.spec}`);
  for (const p of parts) console.log(`      ${p}`);
  console.log(`      ↳ ${mm.note}`);
}

// ── C. 定义级校验（把能表达的搭成一个真实定义） ─────────────
console.log("\n=== C. 完整定义校验（window {1,5} + FIRST_VALID_DAY） ===");
const timeline = resolveSignalTimeline("FIRST_VALID_DAY", { start: 1, end: 5, unit: "TRADING_DAY" });
console.log(
  `  timeline: window=${timeline.windowStart}..${timeline.windowEnd} earliestSignalOffset=${timeline.earliestSignalOffset} resolvable=${timeline.resolvable}`,
);

const cond = (field: string, operator: string, value: any, valueType: string, desc: string) => ({
  field,
  operator,
  value,
  valueType,
  description: desc,
  enabled: true,
});

const definition: any = {
  schemaVersion: "1.0",
  meta: {
    name: "首板回踩缩量企稳",
    description: "T日首板 → 回调2~5日 → 缩量不破首板日最低 → 企稳确认买入",
    tags: [],
  },
  entry: {
    event: { type: "FIRST_LIMIT_UP" },
    observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
    conditions: [
      cond("event.daysSincePreviousLimit", "GREATER_THAN_OR_EQUAL", 20, "CONSTANT", "20日内无涨停"),
      cond("prefix.rd0.close", "EQUAL", "prefix.rd0.high", "FIELD_REFERENCE", "实体涨停"),
      cond("bar.low", "GREATER_THAN_OR_EQUAL", "prefix.rd0.low", "FIELD_REFERENCE", "不破首板日最低（生命线）"),
      cond("bar.volume", "LESS_THAN_OR_EQUAL", "prefix.rd0.volume", "FIELD_REFERENCE", "缩量"),
      cond("bar.close", "GREATER_THAN", "prefix.rd0.close", "FIELD_REFERENCE", "企稳阳线"),
    ],
    trigger: { type: "FIRST_VALID_DAY" },
  },
  exit: {
    rules: [
      {
        id: "hard-stop",
        type: "STOP_LOSS",
        trigger: "ON_CLOSE",
        threshold: 0.08,
        thresholdUnit: "RATIO",
        priority: 1,
        enabled: true,
        condition: cond("bar.close", "LESS_THAN", "prefix.rd0.low", "FIELD_REFERENCE", "跌破首板日最低无条件离场"),
        description: "硬止损",
      },
      {
        id: "time-exit",
        type: "TIME_EXIT",
        trigger: "ON_CLOSE",
        threshold: 5,
        thresholdUnit: "TRADING_DAY",
        priority: 2,
        enabled: true,
        description: "5日未启动则平仓",
      },
    ],
  },
  position: {
    sizingMethod: "FIXED_RATIO",
    positionRatio: 0.2,
    maxPositions: 5,
  },
  risk: { stopLoss: 0.08, maxPositions: 5 },
  execution: {
    signalTiming: "T_CLOSE",
    executionTiming: "T_PLUS_1_OPEN",
    priceType: "OPEN",
    quantityMethod: "TARGET_WEIGHT",
    lotSize: 100,
  },
  parameters: [],
  variables: [],
  datasets: [
    {
      datasetId: "first_limit_pullback",
      datasetVersionId: 390002,
      datasetVersion: "v1",
      role: "PRIMARY",
    },
  ],
};

const result: any = validateCanonicalStrategyDefinition(definition);
const issues: any[] = result.issues ?? result.errors ?? [];
console.log(`  valid = ${result.valid}   issues = ${issues.length}`);
if (!result.valid) {
  for (const e of issues) {
    console.log(`  ✗ [${e.code}] ${e.path ?? ""} ${e.message}`);
  }
} else {
  console.log("  ✅ 定义通过校验（5 条入场条件 + 硬止损 + 时间止损）");
}
console.log(`  operators 白名单: ${STRATEGY_CONDITION_OPERATORS.join(" / ")}`);
