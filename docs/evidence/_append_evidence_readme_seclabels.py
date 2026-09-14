"""给 docs/evidence/README.md 追加本轮 `seclabels` 分组（append-only，纯 LF）。

用法：python docs/evidence/_append_evidence_readme_seclabels.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "docs" / "evidence" / "README.md"
DRY = "--dry-run" in sys.argv

SECTION = """
### `seclabels` —— 5 个（2026-09-14 成交明细「证券名称 + 代码」）

> 触发 = 用户「**成交明细我需要展示股票的名称及代码**」（2026-09-14）。
> 核心事实：闭环结果 `trades[].securityId` 是 `sec_<uuid>`（**不是**代码），而真实库
> **没有证券名称主数据表** ⇒ 必须两步解析（`identifier_history` → `limit_up_records`）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_symbol_name_source.mts` + `.log` | 🔴 **键形状取证**：`trades[].securityId` 实测为 **`sec_<uuid>`**（3 次留档共 **388** 笔 / **251** 个唯一值），与 `limit_up_records.stockCode`（`603439.SH` 形式）**匹配率 0** ⇒ 直接印在表格里毫无可读性；`Trade` 字段并集 = 11 个、**不含任何名称类字段**；`limit_up_records` = **99,617** 行 / **4,324** 个 distinct code | 本轮 `ROADMAP.md` §44 |
| `_probe_symbol_identity_bridge.mts` + `.log` | ✅ **身份桥可用性**：`research_securities` **5,552** 行、`research_security_identifier_history` **5,552** 行（`distinctIds == distinctCodes` ⇒ **无 code reuse**）⇒ `sec_<uuid>` → 代码 **251/251 全覆盖**；经名称源后 **158/251** 能取到名称 | 同上 |
| `_probe_name_tables.mts` + `.log` | 🔴 **名称源穷举**：真实库 **60 张表**中，含 name 的列共 **26** 个，其中**只有** `limit_up_records.stockName` 承载股票名称（`stock_watchlist.stockName` 仅 6 行）；**确认不存在证券名称主数据表** | 同上 |
| `_probe_name_gap_diagnosis.mts` + `.log` | 🔴 **缺口根因**：93 个缺名称的代码去 `limit_up_records` 精确查 **0 命中** ⇒ **收录口径问题、非键匹配 bug**；缺口集中在**创业板 300/301（74/152）与科创板 688（19/35）**，而沪主板 **0/30**、深主板 **0/34** 全有 | 同上 |
| `_probe_security_labels_e2e.mts` + `.json` + `.log` | ✅ **端到端（真实 tRPC + 真库）· 0 失败 PASS**：端点返回 251 条与入参去重数一致；**251/251** 译成 canonical 代码、**格式/交易所冲突 0**；名称覆盖 **158/251 = 62.9%**（缺口 93，且缺口内**非法代码 0** ⇒ 是收录问题）；空数组与 **501** 个 id **实测被 zod 拒**；端点与仓储直调**逐条零差异** | 同上 |
"""

data = TARGET.read_bytes().decode("utf-8")
assert data.count("\r\n") == 0, "README.md 不是纯 LF"
ANCHOR = "| `_probe_clbr_rows.mts` | 🔧 **留档行巡检 / 残留清理**"
assert ANCHOR in data, "README 尾部锚点丢失"
before = data.count("\n")

out = data + SECTION
assert out.count("\r\n") == 0, "写入后出现 CRLF"
assert out.count("\n") == before + SECTION.count("\n"), "行数增量异常"

if not DRY:
    TARGET.write_bytes(out.encode("utf-8"))
print(f"[ok] README.md: {before} → {out.count(chr(10))} 行（+{SECTION.count(chr(10))}）")
print("[dry-run] 未写盘" if DRY else "[written] 已追加 seclabels 分组")
