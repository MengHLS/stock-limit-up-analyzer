"""把本轮「成交明细展示证券名称 + 代码」写入 ROADMAP.md。

纪律（PROJECT_RULES）：
- `ROADMAP.md` 是**纯 CRLF** ⇒ 写盘前后都断言 `裸 LF == 0`；
- §44 体例 = 「**只插入、不改写旧条目**」（`> 上轮实查：` 每轮都保留）；
- §44.5 编号按「**下一个未占用**」判定（本轮 `9ak` 全仓库未占用），**禁「末条 +1」**。

用法：python docs/evidence/_apply_roadmap_seclabels.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "ROADMAP.md"
DRY = "--dry-run" in sys.argv

raw = TARGET.read_bytes().decode("utf-8")

# ---------- 前置断言 ----------
assert raw.count("\n") - raw.count("\r\n") == 0, "ROADMAP.md 不是纯 CRLF"
assert raw.count("9ak") == 0, "编号 9ak 已被占用（不能按「末条 +1」猜）"

SEC44_ANCHOR = (
    "> 上轮实查：**2026-09-14 13:22 GMT+8 · 闭环回测「每次都有结果、且有地方可看」"
)
assert raw.count(SEC44_ANCHOR) == 1, f"§44 锚点出现次数异常：{raw.count(SEC44_ANCHOR)}"

SEC445_ANCHOR = (
    "   - **9aj. （闭环回测线 · `CLOSED-LOOP-BACKTEST-PERSIST-001`）"
)
assert raw.count(SEC445_ANCHOR) == 1, f"§44.5 锚点（9aj）出现次数异常：{raw.count(SEC445_ANCHOR)}"

before_recent = raw.count("> 上轮实查：")

# ---------- 1) §44：在既有最近条目**之前**插入本轮条目 ----------
NEW_44 = (
    "> 上轮实查：**2026-09-14 13:58 GMT+8 · 成交明细展示「证券名称 + 代码」（闭环面板此前只印 `sec_<uuid>`）· 状态 CODE_READY**（`SECURITY-LABELS-001`）。"
    "触发 = 用户「**成交明细我需要展示股票的名称及代码**」。"
    "**一、实查（读真库/代码，不是推断）**：闭环结果 `trades[].securityId` 是 Research canonical identity **`sec_<uuid>`**（如 `sec_d93df65f-…`），**不是** 6 位代码 ⇒ 该表格此前**名称、代码都没有**；"
    "真实库 **60 张表里没有证券名称主数据表**（`research_securities` **不含 name**，schema 注释明确「name history 与 identifier history 严格独立」），全库**唯一**名称源 = `limit_up_records.stockName`。"
    "**二、链路（两步、全复用既有实现）**：① `sec_<uuid>` → 代码读 `research_security_identifier_history` 的 **primary** 标识（实测 **251/251** 全覆盖）；"
    "② 代码 → 名称复用 `shared/stockDataNormalization.ts#buildLatestStockNameMap`。"
    "🔴 **`canonicalCode` 只做字符串拼接、不校验交易所一致性**（会把 `000001` + `SH` 拼成错代码 `000001.SH`，再顺带查错名称）⇒ **必须用 `normalizeSecurityCode`**，冲突即置 `null`。"
    "**三、交付**：`server/closedLoopBacktestRun/securityLabels.ts`（纯函数 `buildSecurityLabels` + 取数 `loadSecurityLabels`，**只按涉及代码查名称源、不整表扫 9.9 万行**）+ 契约 3 个（入参 **1..500**）+ 端点 `researchRun.securityLabels`"
    " + 前端 `hooks/useSecurityLabels.ts`（`staleTime` 5 min、`retry:false`、**查询失败不抛错 ⇒ 回退显示原始 id**）+ `SecurityCell`（**名称在上、canonical 代码在下**，与 legacy `/backtest` 页既有规范**逐字一致**）。"
    "**四、实证（`docs/evidence/_probe_security_labels_e2e.mts` 0 失败 PASS）**：留档 **3** 行 / 成交 **388** 笔 / 唯一 identity **251**；**251/251** 可译成代码、格式与交易所冲突 **0**；"
    "名称覆盖 **158/251 = 62.9%**、缺口 **93**（**创业板 300/301 缺 74/152、科创板 688 缺 19/35；沪深主板 0/30、0/34 全有**）；93 个缺失代码去 `limit_up_records` 精确查 **0 命中** ⇒ **收录口径问题、非键匹配 bug**；"
    "空数组 / 501 个 id **实测被 zod 拒**；端点与仓储直调**逐条零差异**。"
    "**五、诚实登记**：名称 **62.9%** 覆盖是**数据现实**（名称源只收录涨停过的股票，回测 universe 是全市场）⇒ 缺口**如实显示「—」、代码照常显示**，**绝不用代码冒充名称**；"
    "绩效页 `PerformanceDashboard` 的「交易明细」其 `securityId` 取 `t.stockCode`（**本身就是代码**）⇒ 只缺名称、**本轮未改**。\r\n"
    ">\r\n"
)

idx44 = raw.index(SEC44_ANCHOR)
raw2 = raw[:idx44] + NEW_44 + raw[idx44:]

# ---------- 2) §44.5：在 9aj 条目**之后**插入 9ak（前置一个空行，与 9ai→9aj 间距一致） ----------
NEW_445 = (
    "\r\n"
    "   - **9ak. （闭环回测线 · `SECURITY-LABELS-001`）成交明细展示「证券名称 + 代码」：`sec_<uuid>` → canonical 代码 → 名称** ✅ **已完成（2026-09-14 13:58 GMT+8，CODE_READY）**："
    "触发 = 用户「**成交明细我需要展示股票的名称及代码**」。"
    "**根因（实查）** = 闭环 `trades[].securityId` 是 **`sec_<uuid>`**（不是代码）⇒ 面板只印一串 uuid；且库里**无证券名称主数据表**，唯一名称源是 `limit_up_records.stockName`。"
    "**做法** = 新增 `server/closedLoopBacktestRun/securityLabels.ts` → 端点 `researchRun.securityLabels`（**1..500**）→ hook `useSecurityLabels`（**失败不抛错**）→ `SecurityCell`（名称在上、代码在下，**与 legacy `/backtest` 规范逐字一致**）；"
    "🔴 代码解析走 `normalizeSecurityCode`（`canonicalCode` 不校验交易所、会产出错代码）。"
    "**实证** = **251/251** 可译成代码、冲突 **0**、名称覆盖 **158/251（62.9%）**、缺口 93（**创业板 74/152、科创板 19/35、沪深主板 0 缺**）且 **`limit_up_records` 精确查 0 命中** ⇒ 收录口径问题；"
    "`tsc` exit 0 / `vite build` exit 0 / 新增单测 **9 例**全通过 / 全量 vitest **零新增失败**。"
    "**诚实缺口** = 名称非 100%（数据现实），缺口显示「—」**不用代码冒充**；绩效页同类表格**本轮未改**。\r\n"
)

idx445 = raw2.index(SEC445_ANCHOR)
end_of_line = raw2.index("\r\n", idx445) + 2
raw3 = raw2[:end_of_line] + NEW_445 + raw2[end_of_line:]

# ---------- 写后断言 ----------
assert raw3.count("\n") - raw3.count("\r\n") == 0, "写入后出现裸 LF"
assert raw3.count(SEC44_ANCHOR) == 1, "写入后 §44 既有锚点丢失"
assert raw3.count(SEC445_ANCHOR) == 1, "写入后 §44.5 既有锚点（9aj）丢失"
assert raw3.count("> 上轮实查：") == before_recent + 1, (
    f"「上轮实查」条数应恰 +1：{before_recent} → {raw3.count('> 上轮实查：')}"
)
assert raw3.count("9ak.") == 1, f"9ak 出现次数异常：{raw3.count('9ak.')}"
assert raw3.count("9aj.") == 1, "9aj 条目被破坏"
assert "# 44. 项目真实状态映射（数据快照）" in raw3, "§44 标题丢失"

delta_lines = raw3.count("\n") - raw.count("\n")
print(f"[ok] §44 新增 1 条（+{NEW_44.count(chr(10))} 行）；§44.5 新增 `9ak.`（+{NEW_445.count(chr(10))} 行）")
print(f"[ok] 总行数 {raw.count(chr(10))} → {raw3.count(chr(10))}（Δ {delta_lines:+d}）")
print(f"[ok] 裸 LF = {raw3.count(chr(10)) - raw3.count(chr(13) + chr(10))}（应为 0）")
print(f"[ok] 「上轮实查」条数 {before_recent} → {raw3.count('> 上轮实查：')}")

if DRY:
    print("[dry-run] 未写盘")
else:
    TARGET.write_bytes(raw3.encode("utf-8"))
    print("[written] ROADMAP.md 已更新")
