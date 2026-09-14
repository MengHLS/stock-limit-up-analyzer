# -*- coding: utf-8 -*-
"""修正 docs/evidence/README.md 的 papertradingadvance 分组：
  ① 去掉两个并不存在的 `+ .log` 伴生文件（诚实：索引必须可重跑）
  ② 补登 `_append_memory_paper_advance_fix.py`（17:38 修复小节）
  ③ 归档脚本行补 2 个脚本
  ④ 分组计数 6 → 7
纪律：README 纯 LF ⇒ read_bytes().decode() + write_bytes()，写前后断言。
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
P = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\docs\evidence\README.md")

EDITS = [
    # ① 去掉不存在的 .log 伴生声明
    ("| `_probe_paper_advance_e2e.mts` + `.log` |", "| `_probe_paper_advance_e2e.mts` |"),
    ("| `_probe_paper_create_guard.mts` + `.log` |", "| `_probe_paper_create_guard.mts` |"),
    # ② 补登修复小节的追加脚本
    (
        "| `_append_memory_paper_advance_diag.py` | 当日日志追加脚本（append-only + 纯 LF 双向断言） | `.workbuddy/memory/2026-09-14.md` |",
        "| `_append_memory_paper_advance_diag.py` | 17:15 **诊断**小节追加脚本（append-only + 纯 LF 双向断言） | `.workbuddy/memory/2026-09-14.md` |\n"
        "| `_append_memory_paper_advance_fix.py` | 17:38 **修复 + 实证 + 归档**小节追加脚本（同上纪律，含前缀不变断言「非 append-only」） | 同上 |",
    ),
    # ④ 计数
    ("### `papertradingadvance` —— 6 个", "### `papertradingadvance` —— 7 个"),
    # ③ 归档脚本行补 2 个
    (
        "`_append_rules_paper_advance.py`（`PROJECT_RULES.md`：数据源与回填补一条 + 新增一节）。",
        "`_append_rules_paper_advance.py`（`PROJECT_RULES.md`：数据源与回填补一条 + 新增一节）、\n"
        "`_append_memory_paper_advance_diag.py` / `_append_memory_paper_advance_fix.py`（当日日志 append）、\n"
        "`_verify_archive_paper_advance.py`（**回读校验**：锚点 / 编号先后 / 行尾 / 旧条目零改写，**ALL PASS**）。",
    ),
]

raw = P.read_bytes()
text = raw.decode("utf-8")
before = len(text)
assert "\r\n" not in text, "README 出现 CRLF"

for old, new in EDITS:
    assert old in text, f"缺少锚点：{old[:60]!r}"
    assert text.count(old) == 1, f"锚点不唯一：{old[:60]!r}"
    text = text.replace(old, new, 1)

P.write_bytes(text.encode("utf-8"))
back = P.read_bytes().decode("utf-8")
assert "\r\n" not in back, "回读出现 CRLF"
assert "+ `.log`" not in back.split("### `papertradingadvance`")[1], "仍有 .log 伴生声明"
assert "_verify_archive_paper_advance.py" in back
assert len(back) > before
print(f"OK README.md: {before} -> {len(back)} chars (+{len(back) - before})")
print("DONE")
