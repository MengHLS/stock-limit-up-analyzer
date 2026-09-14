"""把「成交明细：证券名称 + 代码」的实测判据追加进 PROJECT_RULES.md（append-only）。

纪律：PROJECT_RULES.md 是**纯 LF** ⇒ 写盘前后断言 `crlf == 0`；并断言原尾部锚点仍在。
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".workbuddy" / "memory" / "PROJECT_RULES.md"

raw = TARGET.read_text(encoding="utf-8")

# 前置断言：纯 LF、尾部锚点存在
assert raw.count("\r\n") == 0, f"PROJECT_RULES.md 出现 CRLF：{raw.count(chr(13) + chr(10))}"
TAIL_ANCHOR = (
    "- ⚠️ **探针必须自清理，且清理判据要绑「可识别命名域」而不是「本次 `runId`」**"
)
assert TAIL_ANCHOR in raw, "尾部锚点丢失"
before_lines = raw.count("\n")

SECTION = """
## 🔴 成交明细「证券名称 + 代码」（2026-09-14 实查 · 三处口径对齐）

背景：闭环回测结果里的「成交明细」表格此前只印 `trades[].securityId`，而该字段是
Research canonical identity **`sec_<uuid>`**（不是股票代码）⇒ 用户读不懂。

**唯一链路（两步，都复用既有实现，禁造第二套）**：
1. `sec_<uuid>` → 6 位代码：读 `research_security_identifier_history` 的 **primary** 标识
   （语义 = `server/security/engineKeyBridge.ts`）。
2. 代码 → 名称：**全库唯一的名称源是 `limit_up_records.stockName`**（真实库 60 张表里
   **没有**证券名称主数据表；`research_securities` **不含 name**，schema 注释明确
   「name history 与 identifier history 严格独立」）。复用既有纯函数
   `shared/stockDataNormalization.ts#buildLatestStockNameMap`。

🔴 **`canonicalCode` 只做字符串拼接、不校验交易所一致性**（它会产出 `000001.SH` 这种错代码）；
**必须用 `normalizeSecurityCode`**（= `parseSecurityCode` 带后缀路径，冲突即抛错）⇒ 宁可
`code = null` 也不产出错代码（错代码会顺带查错名称）。

🔴 **名称覆盖率 62.9%（158/251）是数据现实，不是实现缺陷**：`limit_up_records` 只收录
有过涨停记录的股票（4,324 个 distinct code），回测 universe 是全市场（5,552 只）。
缺口**集中在创业板/科创板**（实查：创业板 300/301 缺 **74/152**、科创板 688 缺 **19/35**；
沪主板 60x **0/30**、深主板 00x **0/34** 全有）。根因判据：93 个缺失代码去
`limit_up_records` 精确查 **0 命中** ⇒ **收录口径问题，非键匹配 bug**（诊断脚本
`docs/evidence/_probe_name_gap_diagnosis.mts`）。

🔴 **绝不用代码冒充名称**：取不到就 `name = null`，UI 显示「—」，**代码照常显示**。

**落点**：
- 服务端 `server/closedLoopBacktestRun/securityLabels.ts`（纯函数 `buildSecurityLabels` +
  取数 `loadSecurityLabels`，**只按涉及代码查名称源，不整表扫 9.9 万行**）；
- 契约 `shared/researchContracts.ts`（`securityLabelSchema` / `securityLabelsInputSchema`
  **1..500** / `securityLabelsOutputSchema` = `z.record`）；
- 端点 `researchRun.securityLabels`（**只读**；output 契约真实校验：空数组 / 501 个 id 实测被拒）；
- 前端 `client/src/hooks/useSecurityLabels.ts`（`staleTime` 5 分钟、`retry: false`、
  **查询失败不抛错** ⇒ 表格回退显示原始 `securityId`，不让「查不到名字」带崩整块结果）；
- 展示 `SecurityCell`（`ClosedLoopRunResultPanel.tsx` 内）= **名称在上、canonical 代码在下
  （mono 灰色小字）** —— 与 legacy `/backtest` 页既有规范**逐字一致**。

🔴 **三处「成交明细」的现状必须分清（勿重复造）**：
| 位置 | 键 | 名称状态 |
| --- | --- | --- |
| 闭环面板 `ClosedLoopRunResultPanel` | `sec_<uuid>` | **本轮修**（此前名称、代码都没有） |
| legacy `/backtest` 页 | `stockCode` | **早已**是「名称 + 代码」 |
| 绩效页 `PerformanceDashboard` | `t.stockCode`（**本身就是代码**） | 只缺名称，**本轮未改** |
"""

raw2 = raw + SECTION
assert raw2.count("\r\n") == 0, "写入后出现 CRLF"
assert TAIL_ANCHOR in raw2, "写入后尾部锚点丢失"
assert raw2.count("\n") == before_lines + SECTION.count("\n"), "行数增量与预期不符"

TARGET.write_text(raw2, encoding="utf-8", newline="")
print(f"[ok] PROJECT_RULES.md 追加 {SECTION.count(chr(10))} 行；总行数 {before_lines} → {raw2.count(chr(10))}")
print(f"[ok] crlf = {raw2.count(chr(13) + chr(10))}（应为 0）")
