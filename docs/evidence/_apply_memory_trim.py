# -*- coding: utf-8 -*-
"""MEMORY.md 收尾：字符裁剪 + 恢复 ECONNRESET 记号（只改字，不动结构/换行）。

背景：MEMORY.md 会被注入 context，实测注入上限约 7,967 字符。
上一轮收尾写入后 len = 8034（仍是「失败闭环」：超出上限的那部分会被静默截断，
而截断点落在哪一段是不可控的 ⇒ 必须压到上限以内并留余量）。

判据（任一不成立即 ABORT，文件保持原样）：
  ① 每处替换必须**恰好命中 1 次**（0 次 = 静默 no-op，2 次 = 换错了地方）；
  ② 改后 len(text) <= 7900（留 ~67 字符余量）；
  ③ 关键记号（硬判据词）改后仍在 —— 防「裁字裁掉判据本身」。
"""

from pathlib import Path
import sys

MEM = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\MEMORY.md")
TARGET = 7900

# (编号说明, old, new) —— old/new 都不含换行符 ⇒ 天然不碰 CRLF/LF 差异
EDITS = [
    ("CRLF 注释压缩",
     "（会给每行叠 `\\r` 并污染多重集断言；已踩两次，均被断言拦下未写坏）。",
     "（叠 `\\r` 污染多重集；已踩两次、均被断言拦下）。"),

    ("运行工作台标题瘦身",
     "## 🔴 运行工作台（细则 →「直读定案」/「等很久的真实账」/「已知地雷」）",
     "## 🔴 运行工作台（细则 →「直读定案」/「已知地雷」）"),

    ("函数实例路径缩写",
     "（`FeatureProvider.compute`/`SignalBuilder`）",
     "（`compute`/`SignalBuilder`）"),

    ("观察日角色判据压缩",
     "区别不是「是否未来」而是「**是否在信号时点可见**」；",
     "判据 = **是否在信号时点可见**；"),

    ("开关移除日期去掉",
     "✅ **两个 UI 开关已移除（2026-09-13）**：",
     "✅ **两个 UI 开关已移除**："),

    ("列表页文件名缩写",
     "（`pages/StrategyList.tsx`）",
     "（`StrategyList`）"),

    ("详情页文件名缩写",
     "（`pages/StrategyDetail.tsx`，版本在",
     "（`StrategyDetail`，版本在"),

    ("原生支持句式压缩",
     "✅ **「T日首板 → 未来5日观察 → 满足条件买入」原生支持**：",
     "✅ **「首板→观察5日→买入」原生支持**："),

    ("rows[] 缩写",
     "（`ResearchDataset.rows[]` 无 `bars` ⇒ 得 0 候选）",
     "（`rows[]` 无 `bars` ⇒ 得 0 候选）"),

    ("热调用判据压缩",
     "（号称有缓存但热调用 23.7s = 等于没缓存）",
     "（热调用 23.7s = 没缓存）"),

    ("误写案例压缩",
     "（曾据单次采样误写「3.45× 惩罚」，交错实测 **0.96×**）",
     "（曾误写「3.45×」，交错实测 **0.96×**）"),

    ("恢复 ECONNRESET 记号",
     "**跨境只读瞬时错误是常态**",
     "**跨境只读瞬时错误（`ECONNRESET`）是常态**"),

    ("实测基线标题瘦身",
     "## 🔴 实测基线（表见 §44.5）",
     "## 🔴 实测基线"),

    ("回撤结论压缩",
     "⇒ **「回撤浅」不是好条件，「没回撤」才是**。",
     "⇒「回撤浅」不是好条件、「没回撤」才是。"),

    ("页面坐标标题瘦身",
     "## 🔴 页面坐标（2026-09-13 策略页分家）",
     "## 🔴 页面坐标（策略页分家）"),

    ("Drizzle 判据压缩",
     "（复现查询仅 229~587ms）",
     "（复现 229~587ms）"),

    ("已有件列表去空格",
     "✅ 已有 `DEFAULT_RUN_WINDOW` + `precheckRunConfig()` + `humanizeRunError()`。",
     "✅ 已有 `DEFAULT_RUN_WINDOW`+`precheckRunConfig()`+`humanizeRunError()`。"),

    ("PROJECT_RULES 字数更正",
     "（43k 字）",
     "（47k 字）"),
]

# 改后必须仍在的关键记号（防裁字裁掉判据本身）
KEEP_TOKENS = [
    "splitlines(keepends=True)",
    "gated",
    "availableFromOffset",
    "columnProjection",
    "LegacyStrategyRedirect",
    "/strategies/:strategyId",
    "新建草稿必须清空",
    "热调用 ≈0ms",
    "免责声明",
    "ECONNRESET",
    "9ah",
]

raw = MEM.read_bytes()
crlf = raw.count(b"\r\n")
text = raw.decode("utf-8")
before = len(text)

print(f"读入 MEMORY.md：{before} 字符 | bytes={len(raw)} | CRLF行={crlf}")

total_delta = 0
for i, (label, old, new) in enumerate(EDITS, 1):
    n = text.count(old)
    if n != 1:
        print(f"❌ #{i} {label}：命中 {n} 次（须恰好 1 次）⇒ ABORT，文件未写")
        sys.exit(1)
    delta = len(new) - len(old)
    total_delta += delta
    text = text.replace(old, new)
    print(f"OK  #{i:2d} {label:<18} 命中1次  {delta:+d} 字符")

after = len(text)
print(f"\n合计 {total_delta:+d} 字符：{before} → {after}（目标 <= {TARGET}）")

# ③ 关键记号仍在（在「已改」的文本上判定，写盘前）
missing = [t for t in KEEP_TOKENS if t not in text]
if missing:
    print(f"❌ 关键记号丢失：{missing} ⇒ ABORT，文件未写")
    sys.exit(1)

if after > TARGET:
    print(f"❌ 仍超出目标 {TARGET}（实得 {after}）⇒ ABORT，文件未写")
    sys.exit(1)

# ② 结构不变量：只改字、不动结构。
#   注意：本轮**故意**改写了 3 个标题的文案（运行工作台 / 实测基线 / 页面坐标），
#   所以不能比标题整行文本 —— 只能比「标题标记序列」（即有没有增删标题、
#   有没有把 h2 降级成 h3），这才是「结构」的本义。
def heading_markers(s: str) -> list[str]:
    out = []
    for ln in s.splitlines():
        if ln.startswith("#"):
            out.append(ln.split(" ")[0])  # 只取 "#"/"##"/"###" 前缀
    return out


old_text = raw.decode("utf-8")
old_h, new_h = heading_markers(old_text), heading_markers(text)
if old_h != new_h:
    print(f"❌ 标题结构被改动（{len(old_h)} → {len(new_h)}）⇒ ABORT，文件未写")
    sys.exit(1)
if len(text.splitlines()) != len(old_text.splitlines()):
    print("❌ 行数被改动 ⇒ ABORT，文件未写")
    sys.exit(1)

MEM.write_bytes(text.encode("utf-8"))
print(f"\n✅ 已写盘 {MEM}")
print(f"   {before} → {after} 字符 | 行数 {len(text.splitlines())} 不变 | 标题 {len(new_h)} 个不变")
print(f"   余量 {TARGET - after} 字符")
