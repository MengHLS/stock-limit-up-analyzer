"""追加本轮记录到 ROADMAP-CHANGELOG.md 与当日工作日志（两者都是**纯 LF**，append-only）。

纪律：
- 两个文件均为纯 LF ⇒ 写盘前后断言 `crlf == 0`；
- append-only：只在末尾追加，不改写任何历史行。

用法：python docs/evidence/_append_changelog_seclabels.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRY = "--dry-run" in sys.argv

CHANGELOG = ROOT / "ROADMAP-CHANGELOG.md"
DAILY = ROOT / ".workbuddy" / "memory" / "2026-09-14.md"

CHANGELOG_ENTRY = """
## 2026-09-14 13:58 GMT+8 — 成交明细展示「证券名称 + 代码」：闭环面板从 `sec_<uuid>` 改为「名称 + canonical 代码」（`SECURITY-LABELS-001` · 跨层 · CODE_READY）

**用户输入**：「**成交明细我需要展示股票的名称及代码**」。

### 一、实查（读真库 / 读代码，不是推断）

| # | 事实 | 证据 |
| --- | --- | --- |
| ① | 闭环结果 `trades[].securityId` 是 Research canonical identity **`sec_<uuid>`**（如 `sec_d93df65f-fede-4788-a058-8cc4978d3bd2`），**不是** 6 位股票代码 | `docs/evidence/_probe_symbol_name_source.mts` |
| ② | 真实库 **60 张表里没有证券名称主数据表**；`research_securities` **不含 name**（schema 注释原文：「identifier history 与 name history 严格独立（本表不含 name）」） | `_probe_name_tables.mts` |
| ③ | 全库**唯一**承载股票名称的列 = `limit_up_records.stockName`（另一处 `stock_watchlist.stockName` 仅 **6 行**，不构成数据源） | 同上 |
| ④ | `securityId ⇄ 代码` 由 `research_security_identifier_history` 桥接，**primary 标识实测 251/251 全覆盖**、且 `distinctIds == distinctCodes == 5552`（无 code reuse） | `_probe_symbol_identity_bridge.mts` |

⇒ 该表格此前**名称、代码都没有**（只印一串 uuid）。

### 二、交付（一个事实一个来源）

- **服务端**：新增 `server/closedLoopBacktestRun/securityLabels.ts` —— 纯函数 `buildSecurityLabels(securityIds, identifiers, nameRecords)` + 取数 `loadSecurityLabels(securityIds)`；**只按涉及代码查名称源**（`WHERE stockCode IN (...)`），**不整表扫 9.9 万行**。
- **契约**：`shared/researchContracts.ts` 新增 `securityLabelSchema` / `securityLabelsInputSchema`（**1..500**）/ `securityLabelsOutputSchema`（`z.record`）。
- **端点**：`researchRun.securityLabels`（**只读**，带 `output()` 契约）。
- **前端**：`client/src/hooks/useSecurityLabels.ts`（`staleTime` 5 min、`retry:false`、**查询失败不抛错 ⇒ 表格回退显示原始 id**）+ `ClosedLoopRunResultPanel.tsx` 的 `SecurityCell`（**名称在上、canonical 代码在下 mono 灰色小字** —— 与 legacy `/backtest` 页既有规范**逐字一致**）。
- **单测**：`tests/server/closedLoopBacktestRun/securityLabels.test.ts` **9 例**（含「名称缺失不得连带丢代码」「代码与交易所冲突必须置 null」等）。

### 三、实证（`docs/evidence/_probe_security_labels_e2e.mts` · **0 失败 / PASS**）

- 真实留档 **3** 行 / 成交 **388** 笔 / 唯一 identity **251**；
- **251/251** 翻译成 canonical 代码，**格式与交易所冲突 0**；
- 名称覆盖 **158/251 = 62.9%**，缺口 **93**；
- 空数组 / **501** 个 id **实测被 zod 拒**（契约不是摆设）；端点与仓储直调**逐条零差异**。

### 四、诚实登记

- ⚠️ **名称覆盖 62.9%，不是 100%**：`limit_up_records` 只收录有过涨停记录的股票（**4,324** 个 distinct code），而回测 universe 是全市场（**5,552** 只）。缺口**集中在创业板 / 科创板**（实查：创业板 300/301 缺 **74/152**、科创板 688 缺 **19/35**；沪主板 60x **0/30**、深主板 00x **0/34** 全有）。
- ⚠️ **根因不在实现**：93 个缺失代码去 `limit_up_records` 精确查 **0 命中** ⇒ **收录口径问题，非键匹配 bug**（`_probe_name_gap_diagnosis.mts`）。缺口一律显示「—」，**绝不用代码冒充名称**。
- ⚠️ 绩效页 `PerformanceDashboard` 的「交易明细」其 `securityId` 取 `t.stockCode`（**本身就是代码**）⇒ 只缺名称、**本轮未改**（同一 hook 即可接上）。
- ⚠️ 无浏览器截图（本机 `agent-browser` 不可用、仓库无 `jsdom`）⇒ 前端验收 = 真实 tRPC 取数 + 纯函数单测 + 真实库。
- 登记：§44.5 新编号取 **`9ak`**（按「**下一个未占用**」判定 —— `9ak` 全仓库未占用；**非「末条 +1」**）。

### 五、顺手查实的一个真坑

- 🔴 **`server/security/code.ts#canonicalCode` 只做字符串拼接、不做交易所一致性校验**：`canonicalCode({ digits: "000001", exchange: "SH" })` 会返回 `"000001.SH"`（拼得出来的**错代码**）且**不抛错**；一致性校验只存在于 `parseSecurityCode` 的 `assertConsistent`。
  ⇒ 本轮改走 **`normalizeSecurityCode`**（= `parseSecurityCode` 带后缀路径），冲突即抛错 ⇒ 宁可 `code = null` 也**不产出错代码**（错代码会顺带查错名称）。此坑由单测 G 例逼出来（原实现返回了 `000001.SH`）。
"""

DAILY_ENTRY = """
## 13:58 GMT+8 — 成交明细展示「证券名称 + 代码」（`SECURITY-LABELS-001` · CODE_READY）

**用户输入**：「**成交明细我需要展示股票的名称及代码**」。

### 一、先查清「成交明细」在哪、缺什么（三处，别搞错）

| 位置 | `securityId` 实际是什么 | 名称状态 |
| --- | --- | --- |
| 闭环面板 `ClosedLoopRunResultPanel`（表头就叫「**成交明细**」） | **`sec_<uuid>`**（canonical identity） | **名称、代码都没有** ⇒ **本轮修** |
| legacy `/backtest` 页「全部模拟订单」 | `stockCode` | **早已**是「名称 + 代码」 |
| 绩效页 `PerformanceDashboard`「交易明细」 | `t.stockCode`（**本身就是代码**） | 只缺名称、**本轮未改** |

⇒ 用户用词「成交明细」与闭环面板表头**逐字一致**，那正是他看的地方。

### 二、链路（两步，全复用既有实现）

1. `sec_<uuid>` → 6 位代码：读 `research_security_identifier_history` 的 **primary** 标识（实测 **251/251** 全覆盖；`distinctIds == distinctCodes == 5552` ⇒ **无 code reuse**，解析无歧义）；
2. 代码 → 名称：**全库唯一名称源** = `limit_up_records.stockName`（真实库 **60 张表没有证券名称主数据表**，`research_securities` 不含 name）；复用既有纯函数 `buildLatestStockNameMap`。

### 三、交付

- `server/closedLoopBacktestRun/securityLabels.ts`（纯函数 + 取数；**只按涉及代码查名称源**）
- `shared/researchContracts.ts` 3 个契约（入参 **1..500**）
- `researchRun.securityLabels`（只读端点）
- `client/src/hooks/useSecurityLabels.ts`（**失败不抛错**，回退原始 id）
- `ClosedLoopRunResultPanel.tsx#SecurityCell`（名称在上、代码在下 —— 与 legacy `/backtest` 规范**逐字一致**）
- `tests/server/closedLoopBacktestRun/securityLabels.test.ts`（**9 例**）

### 四、实证

- `_probe_security_labels_e2e.mts`：**0 失败 / PASS** —— 留档 3 行 / 成交 **388** 笔 / 唯一 identity **251**；**251/251** 译成代码、冲突 **0**；名称覆盖 **158/251（62.9%）**；空数组与 501 个 id **实测被拒**；端点 vs 仓储**逐条零差异**。
- `_probe_name_gap_diagnosis.mts`：93 个缺失代码去 `limit_up_records` **0 命中** ⇒ **收录口径问题**，非实现 bug；缺口集中在**创业板 74/152、科创板 19/35**（沪深主板 **0 缺**）。
- `npx tsc --noEmit` **exit 0**；`npx vite build` **exit 0**（25.80 s，`index-BIbiZwvN.js` 2,658.57 kB / gzip 650.62 kB）；全量 `vitest` = **239 文件 / 7 失败**，失败**文件集合**逐项 = 既有基线 ⇒ **零新增失败**。

### 五、可复用的坑（都很值钱）

- 🔴 **`canonicalCode` 只拼接、不校验**：`canonicalCode({digits:"000001", exchange:"SH"})` → `"000001.SH"`（错代码）且**不抛错**；一致性校验只在 `parseSecurityCode`。改用 `normalizeSecurityCode`，冲突即置 `null`。**这条是单测逼出来的**（原实现真的返回了错代码）。
- 🔴 **`Path.read_text()` / `read_text(encoding=...)` 有「通用换行转换」**：它会把 CRLF **静默变成 LF** ⇒ 我的「纯 CRLF 断言」在**读**这一步就被它破了（真文件其实纯 CRLF）。**总控脚本必须 `read_bytes().decode()` + `write_bytes(...)`**。
- 🔴 **`Edit` 工具在本仓库出现过「报告成功但内容未变」（本会话 2 次）**：一次在 `server/closedLoopBacktestRun/securityLabels.ts` 的 import 行、一次在 `_apply_roadmap_seclabels.py`（改了 `write_text` 却没改 `read_text`，导致断言误报「ROADMAP 不是纯 CRLF」）。⇒ **每次 Edit 后必须回读（grep/Read）验证**，尤其在排查一个「说不通」的报错时，先怀疑工具没落地。
"""


def append_lf(path: Path, entry: str, anchor: str) -> None:
    data = path.read_bytes().decode("utf-8")
    assert data.count("\r\n") == 0, f"{path.name} 不是纯 LF"
    assert anchor in data, f"{path.name} 尾部锚点丢失：{anchor}"
    before = data.count("\n")
    out = data + entry
    assert out.count("\r\n") == 0, f"{path.name} 写入后出现 CRLF"
    assert out.count("\n") == before + entry.count("\n"), f"{path.name} 行数增量异常"
    if not DRY:
        path.write_bytes(out.encode("utf-8"))
    print(f"[ok] {path.name}: {before} → {out.count(chr(10))} 行（+{entry.count(chr(10))}）")


append_lf(
    CHANGELOG,
    CHANGELOG_ENTRY,
    "新增探针（`docs/evidence/`，不进 `tsc` / vitest）：`_probe_closed_loop_persist_e2e.mts`",
)
append_lf(
    DAILY,
    DAILY_ENTRY,
    "本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**",
)
print("[dry-run] 未写盘" if DRY else "[written] 两个文件已追加")
