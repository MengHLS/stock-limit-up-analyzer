# -*- coding: utf-8 -*-
"""
一次性收尾脚本（只做三件事，全部可断言）：
  1) ROADMAP.md §44 头部：在 `> 最后实查：**2026-09-13 20:30 GMT+8**` 之前插入本轮条目，
     并把那一行由「最后实查」降级为「上轮实查」。
  2) ROADMAP.md §44.5 队列：在 `9ad.` 之后追加 `9af.` 条目（编号按「下一个未占用」判定）。
  3) ROADMAP-CHANGELOG.md：仅在文件末尾追加一条（append-only）。

安全网：
  - 每步都先断言锚点唯一、且 `9af` 尚未被占用；
  - 写入前用「多重集等式」证明变更只等于「删 1 行 + 加 N 行」；
  - 写入后复读校验，并打印行数差。
"""
import io
import os
import sys
from collections import Counter

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
P_ROADMAP = os.path.join(ROOT, "ROADMAP.md")
P_CHANGELOG = os.path.join(ROOT, "ROADMAP-CHANGELOG.md")

HEADER_ANCHOR = "> 最后实查：**2026-09-13 20:30 GMT+8**"
QUEUE_ANCHOR = "   - **9ad. （前端线）策略工作台「运行」入口收敛"


def read(path):
    with io.open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def detect_nl(raw):
    return "\r\n" if "\r\n" in raw else "\n"


# ---------------------------------------------------------------- §44 头部
NEW_HEADER = (
    "> 最后实查：**2026-09-13 21:32 GMT+8**（**「策略工作台页面重设计」—— 从「4 页签平铺 + 假状态 + 空结果占位」收敛为"
    "「3 页签按工作流分层 + 真实状态 + 三个此前前端看不见的能力」，纯 `client/**`（3 改 1 新增 1 删除）+ "
    "`docs/evidence/**` 1 个端到端探针；**`server/**` 一行未改、零迁移、零新端点、零新依赖**）。触发 = 用户"
    "「**重新设计策略工作台页面，现在过于混乱**」。"
    "**一、先把「混乱」量化（读源码，非观感）**：页面 `/strategy-editor` 原为 **4 个平铺页签**（editor / workbench / "
    "versions / lifecycle）⇒ 把「日常三件事」（改策略 → 跑回测 → 看结果）与「元数据家务」（版本 / 状态 / 账本）"
    "压在同一层级；**首屏被「已保存策略」表格占据**，两个高频动作（载入 / 运行）反而埋在下方；页头状态徽章是**假的**"
    "（硬编码 `useState(\"Draft\")`，**从不反映 DB**）；默认载入**硬编码模板** `TEMPLATE_DOCUMENT`（`limit-up-baseline@1.0.0`），"
    "而真实库最新是 **`1.1.0`**；结果区 `RunResultPlaceholder` 在**未运行**时就渲染 **6 个空子页签**；"
    "UI 文案里直接暴露开发编号（`FE-4` / `STEP 13/15/16` / `§16·§17·§23`）。"
    "**二、改了什么**：① 页签收敛为 **「策略定义 / 运行回测 / 版本与状态」**；② 新增 `StrategyHeader`（当前策略上下文条）"
    "—— **策略选择器 + 版本选择器取代首屏表格**，徽章改读**真实后端 status**，动作收敛为「校验 / 保存 / 另存为新版本」；"
    "③ 新增 `StrategyVersionPanel` —— 把**三个后端早已可用、前端却看不见**的能力接出来：`listVersions`（版本历史）、"
    "`compare`（草稿 ↔ 已落库 diff，**不再手贴 JSON**）、`setVersionStatus`（真实状态写入）；"
    "④ 新增 `StrategyAdvancedTools` —— `bump`（语义化版本提升，结果可**一键「采用」回填**）+ §23 生命周期账本"
    "（收进默认折叠的「技术细节」，并**明确标注账本不落库**：`applyLifecycleTransition` 是纯函数）；"
    "⑤ 删除 `RunResultPlaceholder`（未运行时的 6 个空页签）⇒ 改为诚实空态；"
    "⑥ 默认载入改为**自动选真实库最新策略**（消费一次；`touched` / `pendingLoad` / `loadedTarget` / URL 参数任一存在即让位）；"
    "⑦ 新增 URL 入口 `?strategyId=…&version=…`（`useSearch`，消费一次；**不新增第二个策略页**）；"
    "⑧ 开发编号从 UI 文案中**全部移除**（只留在代码注释）。"
    "**三、本轮抓到一个真实行为缺陷（非样式问题）**：`load` 返回**裸 `StrategyDocument`**，而 `loadVersion` 返回 "
    "**§17 版本记录（文档嵌在 `.strategy` 下）** ⇒ 若直接把 `loadVersion` 的返回喂编辑器，界面会**读到一个空文档**；"
    "已用 `toStrategyDocument()` 归一，并由探针独立证明「`load` 的文档 == `loadVersion(.strategy)` **剥壳后等价**」。"
    "**附带**：反复点击同一**已缓存**版本会返回**同一对象引用** ⇒ 依赖该引用的 effect 不再触发 ⇒ `pendingLoad` 永不清空；"
    "已改为按 `pendingLoad + loadFetching` 收敛。"
    "**四、`client/**` 的硬边界**：**不能 import `server/**` / `shared/**` 的运行时值**（会把 `zod` 打进前端包）⇒ "
    "8 态状态词表改用「**本地常量表 + 表比对测试**」做漂移哨兵（新增 `tests/client/src/lib/statusVocabulary.test.ts` **4 例**）。"
    "**五、验收（四层全绿）**：`npx tsc --noEmit` **exit 0 / 零输出**；`npx vitest run tests/client` **21 文件 / 519 例全通过**"
    "（基线 20/515，**+4 新例、0 新失败**）；`npx vite build` **exit 0**（3029 modules / `index-D5OwfrZD.js` 2,557.21 kB，"
    "gzip 626.72 kB）；真实库端到端探针 `docs/evidence/_e2e_strategy_workbench.mts` **23/23 PASS** —— `list` 返回 **9 条**"
    "真实策略（`cand-360008@1.0.0(Draft)` … `limit-up-baseline@1.1.0(Draft)`）、`load` 裸文档 / `loadVersion` 剥壳、"
    "往返后 `compare.equal=true`、VM 读出关键字段（名称 `[CAND-4GROUPS] ④-c 回撤深度≤10%（深回踩） · 守线+缩量≤30%`、"
    "入场规则 2 条）；产物符号核对：新文案在包内、旧文案**已消失**（`FE-4 · STEP 13/15/16` ×0）。"
    "⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**，前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。"
    "**六、登记（不在本轮范围）**：§44.5 队列存在 **`9v` 编号重复**（行 2221 / 2227，并行会话撞号），且 `9ae` 因插入顺序落在 "
    "`9v` **之前** ⇒ **§44.5 编号非严格递增**，新编号必须按「**下一个未占用**」判定、**禁按「末条 +1」**。"
)

# ---------------------------------------------------------------- §44.5 队列
NEW_QUEUE = (
    "   - **9af. （前端线）策略工作台页面重设计：4 页签平铺 → 3 页签按工作流分层 + 接出三个「后端早已可用但前端看不见」的真实能力** "
    "✅ **已完成（2026-09-13 21:32，VALIDATED · 纯 `client/**`）**：触发 = 用户「**重新设计策略工作台页面，现在过于混乱**」。"
    "**判据先行**：先量化混乱（4 页签同层级；首屏被「已保存策略」表格占据；页头状态是硬编码 `useState(\"Draft\")` 的**假状态**；"
    "默认载入硬编码 `limit-up-baseline@1.0.0` 而真实库最新是 `1.1.0`；未运行就渲染 6 个空结果页签；UI 暴露 `FE-4` / `STEP 13/15/16`），"
    "再收敛为 **策略定义 / 运行回测 / 版本与状态**，并把 `listVersions` / `compare` / `setVersionStatus` 三个**真实能力**接进 UI"
    "（`compare` **取代手贴 JSON**；`bump` 结果可一键「采用」回填）。"
    "**同轮抓到一个真实行为缺陷**：`load` 返回裸文档、`loadVersion` 返回 §17 记录（文档在 `.strategy` 下）⇒ 直接用会读到**空文档**；"
    "已用 `toStrategyDocument()` 归一 + 探针证明「剥壳后等价」；另修掉「已缓存版本返回同一引用 ⇒ effect 不再触发 ⇒ `pendingLoad` 不清空」。"
    "**验收**：`tsc --noEmit` exit 0；`tests/client` **21 文件 / 519 例**（基线 20/515）；`vite build` exit 0；"
    "真实库探针 `docs/evidence/_e2e_strategy_workbench.mts` **23/23 PASS**（`list` 9 条真实策略）。"
    "**边界**：`server/**` 一行未改、零迁移、零新端点、零新依赖；**无浏览器截图**（本机 `agent-browser` 不可用、仓库无 `jsdom`）。"
)

# ---------------------------------------------------------------- CHANGELOG
CHANGELOG_HEADING = (
    "## 2026-09-13 21:32 — 「策略工作台」页面重设计：4 页签平铺 → 3 页签按工作流分层，"
    "并接出三个「后端早已可用、前端却看不见」的真实能力（纯 `client/**`，VALIDATED）"
)

NEW_CHANGELOG = "\n---\n\n" + CHANGELOG_HEADING + """

用户指令：「**重新设计策略工作台页面，现在过于混乱**」。页面坐标 = `/strategy-editor`（`AppShell.tsx` 的「策略工作台」）。

### 一、先把「混乱」量化（读源码，不是观感）

| 具体问题 | 证据 |
| --- | --- |
| 「日常三件事」与「元数据家务」压在同一层级 | 4 个**平铺**页签 `editor` / `workbench` / `versions` / `lifecycle` |
| 高频动作被埋 | 首屏被「已保存策略」表格占据，**载入 / 运行**在下方 |
| 页头状态是**假的** | 硬编码 `useState("Draft")`，**从不反映 DB** |
| 默认载入的不是真实最新版 | 硬编码 `TEMPLATE_DOCUMENT`（`limit-up-baseline@1.0.0`），真实库最新 = **`1.1.0`** |
| 未运行先给 6 个空页签 | `RunResultPlaceholder` |
| UI 暴露开发编号 | `FE-4` / `STEP 13/15/16` / `§16·§17·§23` |

### 二、改法（纯 `client/**`：3 改 + 1 新增 + 1 删除）

把页签收敛为 **「策略定义 / 运行回测 / 版本与状态」**，并新增 `StrategyHeader`（当前策略上下文条，**策略选择器 + 版本选择器取代首屏表格**，徽章改读**真实后端 status**）、`StrategyVersionPanel`（把 `listVersions` / `compare` / `setVersionStatus` 三个**真实能力**接出来，`compare` **取代手贴 JSON**）、`StrategyAdvancedTools`（`bump` 结果可**一键「采用」回填** + §23 生命周期账本，收进默认折叠的「技术细节」并**明确标注账本不落库**）；删除 `RunResultPlaceholder` 改为诚实空态；默认载入改为**自动选真实库最新策略**（消费一次）；新增 URL 入口 `?strategyId=…&version=…`（**不新增第二个策略页**）；开发编号从 UI 文案**全部移除**。

### 三、顺带抓到一个真实行为缺陷（不是样式问题）

`load` 返回**裸 `StrategyDocument`**，而 `loadVersion` 返回 **§17 版本记录（文档嵌在 `.strategy` 下）** ⇒ 若直接把 `loadVersion` 的返回喂编辑器，界面会**读到一个空文档**。已用 `toStrategyDocument()` 归一，并由探针**独立证明**「`load` 的文档 == `loadVersion(.strategy)` 剥壳后等价」。附带修掉：「反复点击同一**已缓存**版本 ⇒ 返回**同一对象引用** ⇒ 依赖该引用的 effect 不再触发 ⇒ `pendingLoad` 永不清空」。

### 四、`client/**` 的硬边界（本轮复用到）

**不能 import `server/**` / `shared/**` 的运行时值**（会把 `zod` 打进前端包）⇒ 8 态状态词表用「**本地常量表 + 表比对测试**」当漂移哨兵（新增 `tests/client/src/lib/statusVocabulary.test.ts` 4 例）。

### 五、验收（四层全绿）

`npx tsc --noEmit` **exit 0 / 零输出**；`npx vitest run tests/client` **21 文件 / 519 例全通过**（基线 20 文件 / 515 例，**+4 新例、0 新失败**）；`npx vite build` **exit 0**（3029 modules / `index-D5OwfrZD.js` 2,557.21 kB，gzip 626.72 kB）。真实库端到端探针 `docs/evidence/_e2e_strategy_workbench.mts` **23/23 PASS**：`list` 返回 **9 条**真实策略（`cand-360008@1.0.0(Draft)` … `limit-up-baseline@1.1.0(Draft)`）、`load` 裸文档 / `loadVersion` 剥壳、往返后 `compare.equal=true`、VM 读出关键字段（入场规则 2 条）。产物符号核对：新文案在包内、旧文案已消失（`FE-4 · STEP 13/15/16` ×0）。

### 六、边界与诚实登记

- `server/**` **一行未改**、零迁移 / 零新端点 / 零新依赖；本轮只改 `client/**` 3 文件 + 新增 2 文件 + 删除 1 文件 + 新增 1 探针 + 1 测试。
- ⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**；前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。
- 登记（非本轮范围）：§44.5 队列存在 **`9v` 编号重复**（行 2221 / 2227，并行会话撞号），且 `9ae` 因插入顺序落在 `9v` 之前 ⇒ **§44.5 编号非严格递增**，新编号须按「下一个未占用」判定、**禁按「末条 +1」**。
"""


def main():
    raw = read(P_ROADMAP)
    nl = detect_nl(raw)
    old_lines = raw.split(nl)

    # ---- 锚点唯一性 ----
    h_idx = [i for i, ln in enumerate(old_lines) if ln.startswith(HEADER_ANCHOR)]
    q_idx = [i for i, ln in enumerate(old_lines) if ln.startswith(QUEUE_ANCHOR)]
    assert len(h_idx) == 1, "§44 头部锚点不唯一: %r" % (h_idx,)
    assert len(q_idx) == 1, "§44.5 队列锚点不唯一: %r" % (q_idx,)
    h0, q0 = h_idx[0], q_idx[0]
    assert "9af." not in raw, "9af 已被占用，请改用下一个未占用编号"
    assert "9ae." in raw, "9ae 应以存在（编号顺序论断的前提）"

    # ---- §44 头部：插入新条目 + 降级上一行 ----
    changed_header = old_lines[h0].replace("> 最后实查：", "> 上轮实查：", 1)
    assert changed_header != old_lines[h0]

    added = [NEW_HEADER, ">"] + [NEW_QUEUE, ""]

    new_lines = (
        old_lines[:h0]
        + [NEW_HEADER, ">"]
        + old_lines[h0:h0 + 1]
        + old_lines[h0 + 1:]
    )
    # 上面的写法会把旧行原样留在原位，这里再把它替换成降级版
    # （用 h0+2 定位，因为新增了 2 行在前）
    assert new_lines[h0 + 2] == old_lines[h0]
    new_lines[h0 + 2] = changed_header

    # ---- §44.5 队列：在 9ad 之后插入 ----
    q1 = [i for i, ln in enumerate(new_lines) if ln.startswith(QUEUE_ANCHOR)]
    assert len(q1) == 1, "插入 §44 后队列锚点不再唯一: %r" % (q1,)
    qi = q1[0]
    new_lines = new_lines[:qi + 1] + [NEW_QUEUE, ""] + new_lines[qi + 1:]

    # ---- 多重集不变式：新 = 旧 - {旧头部行} + {降级头部行} + 新增行 ----
    expect = Counter(old_lines) - Counter([old_lines[h0]]) + Counter([changed_header]) + Counter(added)
    got = Counter(new_lines)
    assert expect == got, (
        "多重集不变式失败\n  多出 = %r\n  缺少 = %r"
        % ((got - expect), (expect - got))
    )

    write(P_ROADMAP, nl.join(new_lines))
    print("[1/3] ROADMAP.md §44 头部：插入 1 条 + 降级 1 行  ✅")
    print("[2/3] ROADMAP.md §44.5：追加 `9af.`             ✅")
    print("      行数 %d -> %d（+%d）" % (len(old_lines), len(new_lines), len(new_lines) - len(old_lines)))

    # ---- 复读校验 ----
    chk = read(P_ROADMAP)
    assert NEW_HEADER in chk, "复读失败：新头部不在文件里"
    assert NEW_QUEUE in chk, "复读失败：9af 不在文件里"
    assert HEADER_ANCHOR.replace("> 最后实查：", "> 上轮实查：") in chk, "复读失败：降级未生效"
    assert chk.count("9af.") == 1, "`9af.` 出现次数异常: %d" % chk.count("9af.")
    assert chk.count("\n## 44.5 下一任务队列（§38 优先级）") == 1

    # ---- CHANGELOG append-only ----
    craw = read(P_CHANGELOG)
    cnl = detect_nl(craw)
    assert craw.endswith(cnl), "CHANGELOG 结尾非换行，追加前先确认结构"
    assert CHANGELOG_HEADING not in craw, "CHANGELOG 已有同一条，禁重复追加"
    before_len = len(craw)
    with io.open(P_CHANGELOG, "a", encoding="utf-8", newline="") as f:
        f.write(NEW_CHANGELOG.replace("\n", cnl))
    after = read(P_CHANGELOG)
    assert after.startswith(craw), "CHANGELOG 前缀被破坏（append-only 违规）"
    assert after[before_len:] == NEW_CHANGELOG.replace("\n", cnl), "追加内容不一致"
    print("[3/3] ROADMAP-CHANGELOG.md：末尾追加 1 条      ✅")
    print("      字符 %d -> %d（+%d）" % (before_len, len(after), len(after) - before_len))


if __name__ == "__main__":
    main()
    sys.exit(0)
