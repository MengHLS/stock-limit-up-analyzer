# -*- coding: utf-8 -*-
"""只读探针：定位 ROADMAP.md 的 §44 头部插入点 与 §44.5 队列尾部插入点。"""
import io, re, sys, collections

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
p = ROOT + r"\ROADMAP.md"

with io.open(p, "r", encoding="utf-8") as f:
    lines = f.read().split("\n")

print("总行数 =", len(lines))

# 1) §44 头部：找 最后实查 / 上轮实查
for i, ln in enumerate(lines, 1):
    if "最后实查" in ln or "上轮实查" in ln:
        print("HEAD|%d|%s" % (i, ln[:220]))

# 2) §44.5 队列：找 9x 条目
ids = []
for i, ln in enumerate(lines, 1):
    m = re.match(r"^   - \*\*(9[a-z]+)\.", ln)
    if m:
        ids.append((m.group(1), i))
print("9x 条目总数 =", len(ids))
if ids:
    print("最大编号 =", ids[-1][0], "行号 =", ids[-1][1])
    print("末三条 =", ids[-3:])

# 3) §44.5 段落末尾附近
for i, ln in enumerate(lines, 1):
    if ln.startswith("## §45") or ln.startswith("## §46") or ln.startswith("## 45") or ln.startswith("## 46"):
        print("SEC|%d|%s" % (i, ln[:160]))

print("--- 文件末尾 5 行 ---")
for j in range(max(0, len(lines) - 5), len(lines)):
    print("%d|%s" % (j + 1, lines[j][:200]))

pc = ROOT + r"\ROADMAP-CHANGELOG.md"
with io.open(pc, "r", encoding="utf-8") as f:
    cl = f.read().split("\n")
print("CHANGELOG 总行数 =", len(cl))
print("CHANGELOG 末 3 行长度 =", [len(x) for x in cl[-3:]])
print("CHANGELOG 末行前 300 字 =", cl[-2][:300] if len(cl) >= 2 else "")
