# -*- coding: utf-8 -*-
"""只读探针：清点策略工作台相关的**用户可见文案**（连续 >=10 个汉字的行）。

用途：用户反馈「太多无用的文字说明」⇒ 先量化，再逐条决定删/缩。
本脚本不修改任何文件。
"""
import io
import os
import re

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
TARGETS = [
    r"client\src\pages\StrategyEditor.tsx",
    r"client\src\components\strategy\StrategyHeader.tsx",
    r"client\src\components\strategy\StrategyBasicInfo.tsx",
    r"client\src\components\strategy\RuleEditor.tsx",
    r"client\src\components\strategy\PositionSizingEditor.tsx",
    r"client\src\components\strategy\StrategyJsonEditor.tsx",
    r"client\src\components\strategy\RunConfigPanel.tsx",
    r"client\src\components\strategy\ClosedLoopRunResultPanel.tsx",
    r"client\src\components\strategy\StrategyVersionPanel.tsx",
    r"client\src\components\strategy\StrategyAdvancedTools.tsx",
    r"client\src\components\research\StrategyResearchProvenancePanel.tsx",
    r"client\src\components\common\EmptyState.tsx",
    r"client\src\components\common\SectionCard.tsx",
]

HAN = re.compile(r"[\u4e00-\u9fff]")
RUN = re.compile(r"[\u4e00-\u9fff]{10,}")

total = 0
for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print("MISSING|%s" % rel)
        continue
    lines = io.open(p, encoding="utf-8").read().split("\n")
    hits = []
    in_block_comment = False
    for i, ln in enumerate(lines, 1):
        s = ln.strip()
        # 粗判：跳过纯注释行（但保留 JSX 属性 / 文案）
        if s.startswith("*") or s.startswith("/*") or s.startswith("//"):
            continue
        for m in RUN.finditer(ln):
            hits.append((i, m.group(0)))
    n = sum(len(h[1]) for h in hits)
    total += n
    print("\n### %s  汉字文案 %d 处 / %d 字" % (rel, len(hits), n))
    for i, t in hits:
        print("  %4d | %s" % (i, t[:88]))

print("\n=== 合计汉字文案字数 = %d ===" % total)
