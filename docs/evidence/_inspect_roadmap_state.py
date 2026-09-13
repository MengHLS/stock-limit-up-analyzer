# -*- coding: utf-8 -*-
"""只读探针：定位 ROADMAP.md §44 头部 / §44.5 队列末号，以及 CHANGELOG 首尾。"""
import io
import os
import re

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
R = os.path.join(ROOT, "ROADMAP.md")
C = os.path.join(ROOT, "ROADMAP-CHANGELOG.md")

lines = io.open(R, encoding="utf-8").read().split("\n")
print("ROADMAP 行数 =", len(lines))

print("\n=== 所有 `> 最后实查：` / `> 上轮实查：` 行 ===")
for i, ln in enumerate(lines, 1):
    if ln.startswith("> 最后实查：") or ln.startswith("> 上轮实查："):
        print("%5d | %s" % (i, ln[:96]))

print("\n=== 首个 `> 最后实查：` 的前后各 4 行（确认插入点）===")
idx = next((i for i, ln in enumerate(lines) if ln.startswith("> 最后实查：")), None)
if idx is not None:
    for i in range(max(0, idx - 4), min(len(lines), idx + 5)):
        print("%5d | %s" % (i + 1, lines[i][:110]))

print("\n=== §44.5 队列条目（9x 编号，按文件顺序）===")
ids = []
for i, ln in enumerate(lines, 1):
    mm = re.match(r"^\s*- \*\*(9[a-z]+)\.", ln)
    if mm:
        ids.append((mm.group(1), i, ln[:70]))
for x in ids:
    print("  %-5s 行 %5d | %s" % (x[0], x[1], x[2]))
print("条目数 =", len(ids), "| 文件顺序末条 =", ids[-1][0] if ids else None)
occupied = {x[0] for x in ids}
nxt = None
for suf in "abcdefghijklmnopqrstuvwxyz":
    cand = "9" + suf
    if cand not in occupied:
        nxt = cand
        break
print("按「下一个未占用」判定 =", nxt)

print("\n=== §44.5 队列末 6 行原文 ===")
last_id_line = ids[-1][1] if ids else 0
for i in range(max(0, last_id_line - 1), min(len(lines), last_id_line + 6)):
    print("%5d | %s" % (i + 1, lines[i][:150]))

print("\n=== CHANGELOG 首 3 行 / 尾 3 行 ===")
craw = io.open(C, encoding="utf-8", newline="").read()
clines = craw.split("\n")
print("CHANGELOG 行数 =", len(clines), "| 结尾有换行 =", craw.endswith("\n"))
for i in range(0, 3):
    print("  head %5d | %s" % (i + 1, clines[i][:110]))
for i in range(len(clines) - 4, len(clines)):
    print("  tail %5d | %s" % (i + 1, clines[i][:110]))
