# -*- coding: utf-8 -*-
"""只读：列出 §44.5 的 9x 编号占用、最大值、以及队列尾部结构。"""
import io
import re

lines = io.open("ROADMAP.md", encoding="utf-8", newline="").read().split("\n")

ids = []
for i, l in enumerate(lines):
    m = re.match(r"^   - \*\*(9[a-z]+)\.", l)
    if m:
        ids.append((m.group(1), i + 1))

print("9x 条目总数 =", len(ids))
print("占用编号：", ", ".join(x[0] for x in ids))

# 计算序号（a=1 ... z=26, aa=27 ...），取最大
def rank(s):
    body = s[1:]
    n = 0
    for ch in body:
        n = n * 26 + (ord(ch) - ord("a") + 1)
    return n

ids_sorted = sorted(ids, key=lambda x: rank(x[0]))
print("\n按序号排序：", ", ".join(x[0] for x in ids_sorted))
print("最大编号 =", ids_sorted[-1][0], "序号 =", rank(ids_sorted[-1][0]))
nxt = rank(ids_sorted[-1][0]) + 1
# 序号 → 编号
s = ""
n = nxt
while n > 0:
    n, r = divmod(n - 1, 26)
    s = chr(ord("a") + r) + s
print("下一个可用编号 = 9" + s)

print("\n== lines 2236..2252 ==")
for i in range(2235, min(2252, len(lines))):
    print("%4d| %s" % (i + 1, lines[i][:150].replace("\n", "\\n")))
