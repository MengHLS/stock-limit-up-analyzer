# -*- coding: utf-8 -*-
"""只读：打印 §44 头部（1700~1735）与前 40 行的骨架，便于确定插入点。"""
import io

lines = io.open("ROADMAP.md", encoding="utf-8", newline="").read().split("\n")
print("total_lines =", len(lines))
print("\n== lines 1700..1736（截断 150 字符） ==")
for i in range(1699, min(1737, len(lines))):
    print("%4d| %s" % (i + 1, lines[i][:150].replace("\n", "\\n")))

print("\n== 1..40（截断 120 字符） ==")
for i in range(0, min(40, len(lines))):
    print("%4d| %s" % (i + 1, lines[i][:120].replace("\n", "\\n")))
