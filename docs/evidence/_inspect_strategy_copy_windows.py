# -*- coding: utf-8 -*-
"""只读探针：按行窗口打印待改文案的**逐字原文**（供精确 Edit 使用）。不修改任何文件。"""
import io
import os

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
WINDOWS = [
    (r"client\src\components\strategy\StrategyVersionPanel.tsx", [(55, 95), (150, 180), (235, 300), (318, 345), (368, 392)]),
    (r"client\src\components\strategy\ClosedLoopRunResultPanel.tsx", [(45, 95), (105, 132)]),
    (r"client\src\components\strategy\StrategyBasicInfo.tsx", [(218, 305)]),
    (r"client\src\components\strategy\RuleEditor.tsx", [(228, 249)]),
    (r"client\src\components\strategy\PositionSizingEditor.tsx", [(50, 155)]),
    (r"client\src\components\strategy\StrategyJsonEditor.tsx", [(58, 100)]),
    (r"client\src\components\strategy\StrategyAdvancedTools.tsx", [(160, 185), (235, 255), (405, 425)]),
]

for rel, spans in WINDOWS:
    p = os.path.join(ROOT, rel)
    lines = io.open(p, encoding="utf-8").read().split("\n")
    print("\n" + "=" * 78)
    print("FILE " + rel + "  (共 %d 行)" % len(lines))
    for a, b in spans:
        print("---- [%d, %d] ----" % (a, b))
        for i in range(a - 1, min(b, len(lines))):
            print("%4d|%s" % (i + 1, lines[i]))
