# -*- coding: utf-8 -*-
"""收尾脚本 4：MEMORY.md 最后 ~60 字符（含删除一条 PROJECT_RULES.md 已有的重复条），并补做日志追加。"""
import io
import os
import sys

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
MEM = os.path.join(ROOT, r".workbuddy\memory\MEMORY.md")
LOG = os.path.join(ROOT, r".workbuddy\memory\2026-09-13.md")

REPLACE = [
    (
        "- 🔴 **测试 = 仓库根 `tests/`**；**5 类位置敏感写法漏改即静默失效**（细则见「测试文件布局」）。",
        "- 🔴 **测试 = 仓库根 `tests/`**；**5 类位置敏感写法漏改即静默失效**。",
    ),
    (
        "## 🔴 实测基线（完整表在 `ROADMAP.md` §44.5）",
        "## 🔴 实测基线（表见 §44.5）",
    ),
    (
        "- 🔴 **先测速再动刀；用户给的方向是线索不是结论。**\n",
        "",
    ),
]

LOG_ENTRY = """
## 2026-09-13 21:32 · 「策略工作台」页面重设计（纯 `client/**`，VALIDATED）

- 触发 = 用户「**重新设计策略工作台页面，现在过于混乱**」。
- 交付：`/strategy-editor` 由 **4 页签平铺 → 3 页签**（策略定义 / 运行回测 / 版本与状态）；新增 `StrategyHeader`（策略 + 版本选择器取代首屏表格、状态徽章改读**真实后端 status**）、`StrategyVersionPanel`（接出 `listVersions` / `compare` / `setVersionStatus` 三个后端早已可用的能力）、`StrategyAdvancedTools`（`bump` 结果可一键「采用」回填 + §23 账本收进折叠区并**标注不落库**）；删除 `RunResultPlaceholder`（未运行就渲染 6 个空页签）；默认载入改为**自动选真实库最新策略**；新增 URL 入口 `?strategyId=…&version=…`；UI 文案里的 `FE-4` / `STEP 13/15/16` **全部移除**。
- 🔴 同轮抓到**真实行为缺陷**：`load()` 返回**裸 `StrategyDocument`**，而 `loadVersion()` 返回 **§17 记录（文档嵌在 `.strategy` 下）** ⇒ 直接喂编辑器会**静默读到空文档**；已用 `toStrategyDocument()` 归一 + 探针独立证明「剥壳后等价」。附带修掉「反复点已缓存版本 ⇒ 返回同一引用 ⇒ effect 不再触发 ⇒ `pendingLoad` 永不清空」。
- 验收四层：`npx tsc --noEmit` **exit 0**；`npx vitest run tests/client` **21 文件 / 519 例全通过**（基线 20/515）；`npx vite build` **exit 0**；真实库探针 `docs/evidence/_e2e_strategy_workbench.mts` **23/23 PASS**（`list` = 9 条真实策略）。⚠️ 无浏览器截图（本机无 `agent-browser`、仓库无 jsdom）。
- 总控更新：`ROADMAP.md` §44 头部（覆盖式插入 + 旧条降为「上轮实查」）、§44.5 新增 **`9af.`**、`ROADMAP-CHANGELOG.md` 末尾追加 1 条。复核 `git diff --numstat` = ROADMAP **5 插入 / 1 删除**（4 新增行 + 1 行降级改写）、CHANGELOG **39 插入 / 0 删除**。
- ⚠️ **并行会话撞车两起（均未覆盖，已保留对方内容）**：① §44.5 **`9v` 编号重复**（行 2221 / 2227），且 `9ae` 因插入顺序落在 `9v` **之前** ⇒ **编号非严格递增，新编号须按「下一个未占用」判定、禁「末条 +1」**；② 本轮写 `MEMORY.md` 时读到并行会话新增的「两个 UI 开关已移除（`useRealData` / `dataReady`）」⇒ 已保留。
- 🔴 **`MEMORY.md` 体积治理（实测数据）**：注入上限 ≈ **8,000 字符** —— HEAD 版 17,849 字符在 **7,967** 处被截断（比对被截断文本与原文定位所得）。已压到 ≤8,000，并把超出的「配方与参数」细则**移入 `PROJECT_RULES.md`**（非注入文件，内容零丢失）。
"""


def read(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def main():
    mem = read(MEM)
    start = len(mem)
    for old, new in REPLACE:
        n = mem.count(old)
        assert n == 1, "锚点匹配数 != 1（%d）：%s" % (n, old[:40])
        mem = mem.replace(old, new, 1)
    with io.open(MEM, "w", encoding="utf-8", newline="") as f:
        f.write(mem)
    end = len(read(MEM))
    print("[1/2] MEMORY.md 再压 %d 字符：%d -> %d → %s"
          % (start - end, start, end, "✅ ≤8000" if end <= 8000 else "❌ 超 %d" % (end - 8000)))
    assert end <= 8000, "仍超 %d" % (end - 8000)

    before = read(LOG)
    assert before.endswith("\n"), "日志结尾非换行"
    assert "「策略工作台」页面重设计" not in before, "日志已有本轮记录，禁重复追加"
    with io.open(LOG, "a", encoding="utf-8", newline="") as f:
        f.write(LOG_ENTRY)
    after = read(LOG)
    assert after.startswith(before) and after[len(before):] == LOG_ENTRY, "追加校验失败"
    print("[2/2] 2026-09-13.md += 本轮记录 ✅ 字符 %d -> %d（+%d）"
          % (len(before), len(after), len(after) - len(before)))


if __name__ == "__main__":
    main()
    sys.exit(0)
