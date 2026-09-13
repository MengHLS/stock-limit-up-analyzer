/**
 * 在既有 Experiment #240002 的 Run #570001（PENDING）下，新建一组
 * **观察日条件分析（OBSERVATION）**——即用户策略规格里的「量、价、时」三维过滤。
 *
 * 与既有分析的区别（这是本组分析存在的全部理由）：
 *   - 既有分析用 `holds_event_low_5d`，那是 **OUTCOME**（事后标签）：
 *     「T+1..T+5 有没有跌破」只有到 T+5 收盘才知道 ⇒ 拿它筛样本是**事后条件**；
 *   - 本组用 `pullback_*_{k}d` / `obs_{k}d.*`，那是 **OBSERVATION**（当时可见）：
 *     「到 T+3 为止有没有跌破」在 T+3 收盘就能判定 ⇒ 可以构成**可交易的买入条件**。
 *   两者数值可能相同（同源 post/path K 线），**语义与时点完全不同**，故必须分别成组。
 *
 * 本脚本写库（research_analysis + research_analysis_condition），**不跑引擎**：
 * 跑引擎由用户在页面上点「运行」触发，或由 CLI 显式触发。
 *
 * 运行：`npx tsx docs/evidence/_create_observation_analyses.mts`
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

dotenv.config();
const url = process.env.DATABASE_URL ?? "";
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(url);
if (m === null) throw new Error("DATABASE_URL 解析失败");
const [, user, password, host, port, database] = m as unknown as string[];

const conn = await mysql.createConnection({
  host: host.trim(),
  port: Number(port),
  user: user.trim(),
  password: decodeURIComponent(password!),
  database: database.trim(),
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

const RUN_ID = Number(process.env.OBS_RUN_ID ?? 570001);

// ---- 前置：确认 Run 存在且 PENDING（不打断在途执行） ----
const [runRows] = await conn.query(
  `SELECT id, experimentId, status FROM research_run WHERE id = ?`,
  [RUN_ID],
);
const run = (runRows as Array<Record<string, unknown>>)[0];
if (run === undefined) throw new Error(`Run #${RUN_ID} 不存在`);
if (run.status === "RUNNING" || run.status === "QUEUED") {
  throw new Error(`Run #${RUN_ID} 正在执行（${run.status}），拒绝并发写入。`);
}
console.log(`目标 Run #${run.id}（experiment=${run.experimentId}, status=${run.status}）`);

// ---- 分析定义（条件即用户策略规格的三维过滤） ----
interface CondSpec {
  fieldName: string;
  operator: string;
  value: unknown;
  logicalOperator?: "AND" | "OR" | "NOT";
}

interface AnalysisSpec {
  name: string;
  target: string;
  /** 每组是一个独立条件组（组间 OR）。单组时即 AND 组合。 */
  groups: CondSpec[][];
  note: string;
}

/**
 * 目标变量约定：既有的「首板后回撤」分析用 `future_return_{h}d`（path 锚定 T 日收盘）。
 * 跟随同一约定，使新旧结果可直接对照。
 */
const SPECS: AnalysisSpec[] = [
  // ---------- A. 用户策略的「核心条件」单因子 ----------
  {
    name: "观察日·T+3 未破首板最低价（买入条件线） → 之后5日收益",
    target: "future_return_5d",
    groups: [[{ fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 }]],
    note: "这是策略的『生命线』：到 T+3 收盘仍站在首板日最低价上方 ⇒ T+4 开盘可考虑。",
  },
  {
    name: "观察日·T+3 已破首板最低价（逻辑证伪） → 之后5日收益",
    target: "future_return_5d",
    groups: [[{ fieldName: "pullback_holds_event_low_3d", operator: "==", value: 0 }]],
    note: "对照组：破位后的表现。用来检验『破位 = 逻辑失效』是否真的成立。",
  },

  // ---------- B. 「价」：回撤深度分层 ----------
  {
    name: "观察日·T+3 回撤 0~2%（浅回踩）且未破位 → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_close_ratio_3d", operator: ">=", value: 0.98 },
      { fieldName: "pullback_close_ratio_3d", operator: "<=", value: 1.0 },
    ]],
    note: "浅回踩：几乎没跌。可能洗盘不充分（用户「误区」段的自我提醒）。",
  },
  {
    name: "观察日·T+3 回撤 2~5%（标准回踩）且未破位 → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_close_ratio_3d", operator: ">=", value: 0.95 },
      { fieldName: "pullback_close_ratio_3d", operator: "<=", value: 0.98 },
    ]],
    note: "用户规格里的「2-5 个交易日、洗盘充分」的理想形态区间。",
  },
  {
    name: "观察日·T+3 回撤 5%+ 且未破位 → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_close_ratio_3d", operator: "<", value: 0.95 },
    ]],
    note: "深回踩但守住生命线：支撑最受考验的一组。",
  },

  // ---------- C. 「量」：缩量验证（用户规格：≤50% 甚至 25-30%） ----------
  //
  // 口径说明：用 `pullback_min_volume_ratio_{k}d`（= min(volume[T+1..T+k]) / volume(T)），
  // 而**不是** `min_volume` —— 后者是绝对股数，与 0.5 比较恒为假。
  // 这是「跨字段比较压成一个变量」的又一例（同 holds_event_low 的设计理由）。
  {
    name: "观察日·T+3 未破位 且 缩量≤50%（缩量洗盘验证） → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_3d", operator: "<=", value: 0.5 },
    ]],
    note: "用户规格的主力条件：守住生命线 + 量能萎缩到首板日一半以下。",
  },
  {
    name: "观察日·T+3 未破位 且 极致缩量≤30% → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_3d", operator: "<=", value: 0.3 },
    ]],
    note: "用户规格里的「极致缩量 25%-30% 以下」。样本会很少（真实库约 3.6%），稳健性需看样本量。",
  },
  {
    name: "观察日·T+3 未破位 但 未缩量（>50%） → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_3d", operator: ">", value: 0.5 },
    ]],
    note: "对照组：守住支撑但没缩量 —— 用来检验「缩量」这个条件是否真的带来增量。",
  },

  // ---------- D. 「量价共振」：策略真正的信号（这是最有价值的一组） ----------
  {
    name: "观察日·T+3 未破位 且 缩量≤50% 且 收盘已高于首板日收盘 → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_3d", operator: "<=", value: 0.5 },
      { fieldName: "pullback_close_ratio_3d", operator: ">=", value: 1.0 },
    ]],
    note: "三维共振（量缩 + 守线 + 价强）：最接近用户「缩量洗盘 → 企稳进攻」的完整形态。",
  },
  {
    name: "观察日·T+3 未破位 且 缩量≤50% 且 末日放量（量能比>1） → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_3d", operator: "<=", value: 0.5 },
      { fieldName: "pullback_last_volume_ratio_3d", operator: ">", value: 1 },
    ]],
    note: "用户「信号B（稳健）」：先缩量洗盘，再放量启动。这是全套规格里最具体的一条。",
  },
  {
    name: "观察日·T+3 未破位 且 收盘相对首板日为正（守线 + 翻红） → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_3d", operator: "==", value: 1 },
      { fieldName: "obs_3d.return_from_event_close", operator: ">", value: 0 },
    ]],
    note: "「守线 + 已翻红」：最接近用户所说的『企稳阳线』的可表达形式（阳线本身需跨字段比较，本条件只能拿到涨跌幅）。",
  },

  // ---------- E. 「时」：时间窗口（2-5 日 vs 更长） ----------
  {
    name: "观察日·T+2 未破位（早确认） → 之后5日收益",
    target: "future_return_5d",
    groups: [[{ fieldName: "pullback_holds_event_low_2d", operator: "==", value: 1 }]],
    note: "早确认组：T+2 就守住。与 T+3/T+5 组对照，看『等更久』是否值得。",
  },
  {
    name: "观察日·T+5 未破位 且 缩量≤50%（5日窗口） → 之后5日收益",
    target: "future_return_5d",
    groups: [[
      { fieldName: "pullback_holds_event_low_5d", operator: "==", value: 1 },
      { fieldName: "pullback_min_volume_ratio_5d", operator: "<=", value: 0.5 },
    ]],
    note: "时 + 量：拉长到 T+5 再确认。对照 T+3 组，检验用户「2-5 个交易日为佳」里 5 日这一端是否真的更差。",
  },
];

// ---- 写入 ----
let created = 0;
for (const spec of SPECS) {
  // 重名检查（同 Run 内）
  const [dup] = await conn.query(
    `SELECT id FROM research_analysis WHERE runId = ? AND name = ?`,
    [RUN_ID, spec.name],
  );
  if ((dup as unknown[]).length > 0) {
    console.log(`  跳过（已存在）：${spec.name}`);
    continue;
  }

  const [ins] = await conn.query(
    `INSERT INTO research_analysis (runId, analysisType, name, target, configJson, status)
     VALUES (?, 'CONDITIONAL', ?, ?, ?, 'PENDING')`,
    [RUN_ID, spec.name, spec.target, JSON.stringify({ targetField: spec.target })],
  );
  const analysisId = (ins as { insertId: number }).insertId;

  const rows: unknown[][] = [];
  spec.groups.forEach((group, gi) => {
    group.forEach((cond, ci) => {
      rows.push([
        analysisId,
        gi,
        ci,
        cond.fieldName,
        cond.operator,
        JSON.stringify(cond.value),
        cond.logicalOperator ?? "AND",
        "AND",
      ]);
    });
  });

  for (const r of rows) {
    await conn.query(
      `INSERT INTO research_analysis_condition
         (analysisId, groupNo, sortOrder, fieldName, operator, valueJson, logicalOperator, groupLogicalOperator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      r,
    );
  }
  created += 1;
  console.log(`  ✅ #${analysisId} ${spec.name}（${rows.length} 条条件）`);
}

console.log(`\n新建 ${created} 条 CONDITIONAL 分析，挂在 Run #${RUN_ID}。`);
console.log("下一步：在页面点「运行引擎」执行该 Run，或在 CLI 侧触发。");
await conn.end();
