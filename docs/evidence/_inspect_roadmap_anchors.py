# -*- coding: utf-8 -*-
"""只读检查 ROADMAP.md 的 §44 头部 / §44.5 队列锚点（零写入）。"""
import io

P = "ROADMAP.md"
lines = io.open(P, encoding="utf-8", newline="").read().split("\n")

print("total_lines =", len(lines))

hits = [i for i, l in enumerate(lines) if "最后实查" in l or "上轮实查" in l]
print("\n== 含 最后实查/上轮实查 的行 ==")
for i in hits:
    tag = "最后实查" if "最后实查" in lines[i] else "上轮实查"
    print("  line", i + 1, "[", tag, "] len=", len(lines[i]))
    print("    HEAD:", lines[i][:160].replace("\n", "\\n"))
    print("    TAIL:", lines[i][-120:].replace("\n", "\\n"))

print("\n== §44 各小节标题 ==")
for i, l in enumerate(lines):
    if l.startswith("## 44") or l.startswith("## 43") or l.startswith("## 45"):
        print("  line", i + 1, l[:80])

print("\n== 含 '44.5' 定位 ==")
for i, l in enumerate(lines):
    if "44.5" in l:
        print("  line", i + 1, l[:120])

# §44.5 的 9x 条目
print("\n== §44.5 的 9x 条目 ==")
import re
for i, l in enumerate(lines):
    m = re.match(r"^   - \*\*(9[a-z]+)\.", l)
    if m:
        print("  line", i + 1, m.group(1), "|", l[:110].replace("\n", "\\n"))

print("\n== §44.5 区段尾部（2185..2260） ==")
for i in range(2184, min(2262, len(lines))):
    print("  %4d | %s" % (i + 1, lines[i][:130].replace("\n", "\\n")))
