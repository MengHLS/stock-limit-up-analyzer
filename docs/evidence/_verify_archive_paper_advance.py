# -*- coding: utf-8 -*-
"""回读校验本轮归档改动（只读）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")


def stat(p):
    b = open(p, "rb").read()
    t = b.decode("utf-8")
    L = t.splitlines(keepends=True)
    crlf = sum(1 for l in L if l.endswith("\r\n"))
    bare = sum(1 for l in L if l.endswith("\n") and not l.endswith("\r\n"))
    print(f"{p} | chars {len(t)} | lines {len(L)} | CRLF {crlf} | bareLF {bare}")
    return t, L


def check(label, cond):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    return cond


ok = True
t, L = stat("ROADMAP.md")
ok &= check("§44 新条目已插入（17:38）", any(l.startswith("> 上轮实查：**2026-09-14 17:38") for l in L))
ok &= check("§44.5 新条目 9ao", sum(1 for l in L if "9ao." in l) == 1)
ok &= check("15:05 旧条目仍在（只插入未改写）", any(l.startswith("> 上轮实查：**2026-09-14 15:05") for l in L))
joined = "".join(L)
for tag in ["9aj.", "9ak.", "9al.", "9am.", "9an."]:
    ok &= check(f"旧队列条目 {tag} 仍在", tag in joined)
ok &= check("9an 仍在 9ao 之前", joined.index("9an.") < joined.index("9ao."))
ok &= check("ROADMAP 纯 CRLF", "".join(L).count("\n") - "".join(L).count("\r\n") == 0)

t, L = stat("ROADMAP-CHANGELOG.md")
ok &= check("changelog 末尾 = 9ao 条", t.rstrip().endswith("见 `ROADMAP.md` §44 / §44.5 第 9ao 条。"))
ok &= check("changelog 纯 LF", t.count("\r\n") == 0)

t, L = stat("docs/evidence/README.md")
ok &= check("README 新分组 papertradingadvance", "### `papertradingadvance`" in t)
for f in ["_probe_paper_trading_state.mts", "_probe_paper_trading_advance_dryrun.mts",
          "_probe_index_daily_freshness.mts", "_probe_paper_advance_e2e.mts",
          "_probe_paper_create_guard.mts", "_append_memory_paper_advance_diag.py"]:
    ok &= check(f"README 登记 {f}", f in t)
ok &= check("README 纯 LF", t.count("\r\n") == 0)

t, L = stat(".workbuddy/memory/PROJECT_RULES.md")
ok &= check("PROJECT_RULES 新节", "## 🔴 前向纸面交易「推进」恒 no-op 却报成功" in t)
ok &= check("PROJECT_RULES 数据源补条目", "全仓无自动同步" in t)
ok &= check("PROJECT_RULES 纯 LF", t.count("\r\n") == 0)

t, L = stat(".workbuddy/memory/MEMORY.md")
ok &= check("MEMORY 编号更新为 9ao", "已用到 `9ao`" in t)
ok &= check("MEMORY 新增「前向纸面交易」节", "## 前向纸面交易（`/paper-trading`）" in t)

print("\nRESULT:", "ALL PASS" if ok else "HAS FAILURES")
sys.exit(0 if ok else 1)
