# -*- coding: utf-8 -*-
"""ROADMAP 三处收尾（覆盖式 §44 头部 + §44.5 队列追加 + CHANGELOG 末尾追加）。

纪律（见 PROJECT_RULES / MEMORY）：
  - §44 头部 = **覆盖式**：新条目插到当前「最后实查」之上，并把那一行降级为「上轮实查」；
  - §44.5 = **append-only**：新编号按「**下一个未占用**」判定（末位 `9af` ⇒ `9ag`），
    **禁「末条 +1」**（该队列编号非严格递增，且存在 `9v` 重复、`9ae` 错位）；
  - CHANGELOG = **只在文件末尾追加**，绝不改写历史。

🔴 换行处理（本项目首次踩到的坑，已固化）：
  `ROADMAP.md` 是 **CRLF**。**禁 `raw.split("\\n")` + `"\\r\\n".join(...)` 这种「切开与拼回不一致」的写法** ——
  它会给每行叠加一个多余的 `\\r`，并把多重集断言污染成一堆假差异。
  正确做法 = `splitlines(keepends=True)` 保留每行**原有**结尾，修改时只给新行补 `nl`，最后 `"".join` 拼回；
  断言用「**去掉行尾后的行多重集**」，与换行风格彻底解耦。
"""
import io
import os
import re
import sys
from collections import Counter

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
R = os.path.join(ROOT, "ROADMAP.md")
C = os.path.join(ROOT, "ROADMAP-CHANGELOG.md")

TS = "2026-09-13 22:07 GMT+8"
DEMOTE_FROM = "> 最后实查：**2026-09-13 21:32"
DEMOTE_TO = "> 上轮实查：**2026-09-13 21:32"

NEW_HEADER = (
    "> 最后实查：**" + TS + "**（**「策略」页**列表与详情分家 —— 单页（列表塞进下拉框）→ "
    "`/strategies` 列表页 + `/strategies/:strategyId` 详情页，并清掉 44 处解释性长文案；"
    "纯 `client/**`（新增 2 / 改写 4 / 删除 1）+ `docs/evidence/**` 1 个端到端探针 + `tests/**` 1 改 1 增；"
    "**`server/**` 一行未改、零迁移、零新端点、零新依赖**）。触发 = 用户接续反馈「**不是，你把策略列表跟策略详情给分开啊，"
    "这是什么乱七八糟的页面，能不能从用户体感上来设计，还有太多无用的文字说明**」。"
    "**一、上一版错在哪（用户的判断是对的）**：2026-09-13 21:32 那轮把「已保存策略大表」换成了**详情页顶部的一个策略下拉框** —— "
    "治的是「表格占首屏」，没治「两类活动混在一页」：页面一打开就自动塞进某个「最近更新」的策略，用户既看不到库里有哪几条，"
    "也不知道自己为什么停在这一条上。**列表（浏览全库）与详情（编辑一条）本质是两件事**，挤在同一页必然是「乱七八糟」。"
    "**二、改了什么**：① 新增 `client/src/pages/StrategyList.tsx`（`/strategies`）—— 卡片网格列出全库策略"
    "（名称 / 状态徽标 / 策略 ID / 最新版本 / 更新时间），整卡可点进详情，右上角「新建策略」→ `/strategies/new`；"
    "② 新增 `client/src/pages/StrategyDetail.tsx`（`/strategies/:strategyId`）—— **删掉策略下拉框**"
    "（详情页不再承载全库浏览），只保留版本选择器，加「← 策略列表」返回入口，标题行 + 元信息行由 3 行压到 2 行"
    "（`策略ID · v版本 · 数据集 · 校验` 合并成一行等宽文本）；③ **URL 成为唯一坐标源**：`strategyId` 进路径、`version` 进查询参数 "
    "⇒ 换版本 = 改 URL（可回退 / 可分享 / 可刷新），彻底移除旧实现里 `pendingLoad` / `loadLatest` / `loadPinned` / `urlHandled` / "
    "`autoPicked` / `touched` **六个互相牵制的本地状态**；④ 外层以 `key={strategyId}` 挂载 ⇒ **换策略即重挂载**，"
    "草稿与脏标记自然归零（不再手写「路由变了要清哪些 state」）；⑤ 旧 `/strategy-editor?strategyId=&version=` **保留为兼容路由**"
    "（`LegacyStrategyRedirect` 做静态改写，**不渲染第二套页面**）⇒ 候选转正页的历史深链与书签继续可用；"
    "⑥ 侧边导航「策略工作台」→ **「策略」（`/strategies`）**；深链生成器 `strategyVersionPath` 改指详情路由，"
    "并同步更新 `scripts/verifyResearch00641Promote.mts` 的落点断言。**三、文案治理（用户第二个诉求，逐条可回指）**："
    "先用只读探针把**用户可见**长文案量化（连续 ≥10 汉字的行：`RunConfigPanel` 219 字、旧详情页 224 字、"
    "`ClosedLoopRunResultPanel` 121 字、`StrategyVersionPanel` 104 字、`PositionSizingEditor` 58 字、溯源面板 57 字，合计 **867 字**），"
    "再按「**只删解释性长句，不删硬事实**」逐条处理 —— 共 **44 处**替换 / **13 个文件**，并用「**每条必须恰好命中 1 次**」的断言脚本执行"
    "（0 次即报错退出，杜绝静默 no-op）。删掉的是同义反复的副标题（「策略 → 数据集 → 回测配置 → 运行 → 结果」）、"
    "把常识说一遍的提示（「回测账户起点资金，用于计算仓位数与收益率」）、未运行时的两段姿势说明；"
    "**保留**的是后端契约硬事实（「窗口须落在 2024-09-01 ~ 2026-09-01 内」「保存时后端校验存在且 READY」）、失败 / 阻塞的真实原因、"
    "`⚠️ 真实写库` 警告。**四、顺手修掉两条会误导人的过期文案**：`ClosedLoopRunResultPanel` 的两条阻塞原因仍在说"
    "「**未开启「使用真实数据」**」「**「数据完整性已确认」未勾选**」，而这两个开关已于 2026-09-13 从 UI 移除 ⇒ 用户会去找不存在的开关；"
    "已按真实语义改写（`CL_DATASET_GATE_NOT_PASS` = 库内 `dataset_version.status` 非 READY）。**五、新建流程的一个真实陷阱**："
    "模板 `TEMPLATE_DOCUMENT` 的 `strategyId`（`limit-up-baseline`）**确实已存在于真实库**（探针第 3 节实证）⇒ "
    "直接拿模板开新策略保存会**变成给既有策略加版本**而不是新建；已改为新增草稿**清空身份字段**（`strategyId` / `name` / `description`）。"
    "**六、验收（四层全绿，均为真实数字）**：`npx tsc --noEmit` **exit 0 / 零输出**；`npx vitest run tests/client` "
    "**22 文件 / 528 例全通过**（基线 21/519 ⇒ +1 文件 / +9 例、0 新失败）；**完整回归 `npx vitest run` = 235 文件（7 失败 / 228 通过）**，"
    "失败**文件集合**与登记基线**逐项相同**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / "
    "`tushare.secret` / `tushareTradingCalendar`，16 例）⇒ **零新增回归**；`npx vite build` **exit 0**（3024 modules，"
    "`index-C81AAFbW.js` **2,549.40 kB** / gzip 623.74 kB —— 比上一版 2,557.21 kB **减少 7.81 kB**，与文案精简方向一致）；"
    "真实库端到端探针 `docs/evidence/_e2e_strategy_list_detail.mts` **14/14 PASS** —— `list` **9 条**真实策略且 5 字段齐备、"
    "`updatedAt` 形如 `YYYY-MM-DD…`（证明列表页「只截前 10 位、不做时区换算」合法）、排序可复现、全部 `status` 落在客户端 8 态词表内、"
    "`limit-up-baseline` **确实在库**、`load` 裸文档 / `loadVersion` §17 记录且**剥壳后同坐标**、"
    "深链 `/strategies/cand-360008?version=1.0.0` 解析后 `loadVersion` 命中**同一版本**。"
    "**七、本轮新增的结构契约测试**（本机无 `agent-browser`、仓库无 `jsdom` ⇒ 沿用「扫真实源码 + 真实 `appRouter` 断言端点」口径）："
    "列表 / 详情两条独立路由、旧路由仍可达且**页面目录里已无 `StrategyEditor.tsx`**（防「分家」退化成「两套页面并存」）、"
    "导航指向列表页、深链生成器不产出旧地址、**详情页不调 `research.strategy.list`**（结构性地不承载全库浏览）、"
    "7 个端点真实存在、新建草稿清空身份、已移除开关不再出现在用户可见文案里。"
    "⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**，前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。"
)

NEW_QUEUE = (
    "   - **9ag. （前端线）「策略」页列表 / 详情分家：单页（列表塞进下拉框）→ `/strategies` + "
    "`/strategies/:strategyId`，并清掉 44 处解释性长文案** ✅ **已完成（" + TS + "，VALIDATED · 纯 `client/**`）**："
    "触发 = 用户「**不是，你把策略列表跟策略详情给分开啊，这是什么乱七八糟的页面，能不能从用户体感上来设计，"
    "还有太多无用的文字说明**」。要点：① **删掉详情页的策略下拉框** —— 详情页只处理一个策略，「挑策略」归列表页"
    "（上一版把两者塞进同一页正是「乱」的来源）；② **URL 成为唯一坐标源**（`strategyId` 进路径、`version` 进查询参数）"
    "⇒ 换版本 = 改 URL，彻底移除 `pendingLoad` / `loadLatest` / `loadPinned` / `urlHandled` / `autoPicked` / `touched` "
    "六个互相牵制的本地状态；③ 外层 `key={strategyId}` ⇒ 换策略即重挂载，草稿与脏标记自然归零；"
    "④ 旧 `/strategy-editor` 保留为兼容改写路由（候选转正深链 / 书签可用，且不渲染第二套页面）；"
    "⑤ 文案按「只删解释性长句、不删硬事实」治理 **44 处 / 13 文件**，以「每条恰好命中 1 次」断言脚本执行；"
    "⑥ **顺手修正两条过期阻塞文案**（仍在说已移除的「使用真实数据」「数据完整性已确认」开关）；"
    "⑦ **新建草稿清空身份** —— 模板 id `limit-up-baseline` 经探针实证**已在真实库中**，原样保存会变成给既有策略加版本。"
    "验收：`tsc` exit 0；`vitest run tests/client` **22 文件 / 528 例全通过**（基线 21/519）；完整回归失败文件集合 = 基线 7 文件；"
    "`vite build` exit 0（bundle 2,557.21 → **2,549.40 kB**，−7.81 kB）；真实库探针 **14/14 PASS**。"
    "⚠️ 无浏览器截图（本机无 `agent-browser`、仓库无 `jsdom`）。"
)

CHANGELOG_HEADING = (
    "## " + TS + " — 「策略」页列表 / 详情分家：单页（列表塞进下拉框）→ `/strategies` + `/strategies/:strategyId`，"
    "并清掉 44 处解释性长文案（纯 `client/**`，VALIDATED）"
)

CHANGELOG_BODY = [
    "用户指令：「**不是，你把策略列表跟策略详情给分开啊，这是什么乱七八糟的页面，能不能从用户体感上来设计，"
    "还有太多无用的文字说明**」。",
    "- **上一版错在哪（用户判断正确）**：2026-09-13 21:32 那轮把「已保存策略大表」换成了**详情页顶部的一个策略下拉框** —— "
    "治了「表格占首屏」，没治「两类活动混在一页」：进页面就被自动塞进某个「最近更新」的策略，既看不到库里有哪几条，"
    "也不知道为什么停在这一条上。**列表（浏览全库）与详情（编辑一条）本质是两件事**。",
    "- **改动清单**：新增 `client/src/pages/StrategyList.tsx`（`/strategies`，卡片网格：名称 / 状态 / 策略 ID / 最新版本 / 更新时间，"
    "整卡可点，右上「新建策略」）+ 新增 `client/src/pages/StrategyDetail.tsx`（`/strategies/:strategyId`，**删掉策略下拉框**、"
    "保留版本选择器、加「← 策略列表」、标题 + 元信息压到 2 行）；`App.tsx` 新增两条路由并把旧 `/strategy-editor` 变为"
    "`LegacyStrategyRedirect`（静态改写，不渲染第二套页面）；`AppShell.tsx` 导航「策略工作台」→「策略」(`/strategies`)；"
    "`strategyCandidateAdapter.ts` 的 `strategyVersionPath` 改指详情路由；删除 `pages/StrategyEditor.tsx`。",
    "- **状态机简化（可验证）**：URL 成为唯一坐标源（`strategyId` 进路径、`version` 进查询参数）⇒ 旧实现里 "
    "`pendingLoad` / `loadLatest` / `loadPinned` / `urlHandled` / `autoPicked` / `touched` **六个互相牵制的本地状态全部移除**；"
    "外层 `key={strategyId}` ⇒ 换策略即重挂载，草稿 / 脏标记自然归零。",
    "- **文案治理（第二个诉求，量化后逐条）**：只读探针先量化用户可见长文案（连续 ≥10 汉字行：`RunConfigPanel` 219 字、"
    "旧详情页 224 字、`ClosedLoopRunResultPanel` 121 字、`StrategyVersionPanel` 104 字、`PositionSizingEditor` 58 字、"
    "溯源面板 57 字，合计 **867 字**）；再按「只删解释性长句、不删硬事实」执行 **44 处 / 13 文件**替换，"
    "并以「**每条恰好命中 1 次**」断言脚本落地（0 次报错退出，杜绝静默 no-op）；保留后端契约硬事实、失败 / 阻塞真实原因、"
    "`⚠️ 真实写库` 警告。",
    "- **顺手修正两条过期文案（会误导用户）**：`ClosedLoopRunResultPanel` 的阻塞原因原写「未开启「使用真实数据」」"
    "「「数据完整性已确认」未勾选」，而这两个开关已于 2026-09-13 从 UI 移除 ⇒ 用户会去找不存在的开关；已按真实语义改写"
    "（`CL_DATASET_GATE_NOT_PASS` = 库内 `dataset_version.status` 非 READY）。",
    "- **新建流程陷阱（探针实证）**：模板 `strategyId` = `limit-up-baseline` **确实已在真实库中** ⇒ 原样保存会变成"
    "「给既有策略加版本」；已改为新增草稿清空 `strategyId` / `name` / `description`，由用户显式填写。",
    "- **验收（四层全绿，真实数字）**：`npx tsc --noEmit` **exit 0 / 零输出**；`npx vitest run tests/client` "
    "**22 文件 / 528 例全通过**（基线 21/519 ⇒ +1 文件 / +9 例、0 新失败）；**完整回归 `npx vitest run` = 235 文件"
    "（7 失败 / 228 通过，16 例失败）**，失败**文件集合**与登记基线**逐项相同**"
    "（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / "
    "`tushareTradingCalendar`）⇒ **零新增回归**；`npx vite build` **exit 0**（3024 modules，`index-C81AAFbW.js` "
    "**2,549.40 kB** / gzip 623.74 kB，比上一版 2,557.21 kB **−7.81 kB**）；真实库探针 "
    "`docs/evidence/_e2e_strategy_list_detail.mts` **14/14 PASS**（`list` 9 条、5 字段齐备、`updatedAt` 形如 "
    "`YYYY-MM-DD…`、排序可复现、status 全在客户端 8 态词表内、`limit-up-baseline` 在库、`load` 裸文档 vs `loadVersion` "
    "§17 剥壳同坐标、深链命中同一版本）。",
    "- **新增结构契约测试** `tests/client/src/pages/strategyListDetailSplit.test.ts`（9 例）：两条独立路由、旧路由仍可达且"
    "页面目录**已无 `StrategyEditor.tsx`**（防退化成两套页面）、导航指向列表页、深链不产出旧地址、详情页**不调 "
    "`research.strategy.list`**、7 端点真实存在、新建草稿清空身份、已移除开关不再出现在用户可见文案。",
    "- `server/**` **一行未改**、零迁移 / 零新端点 / 零新依赖；本轮改 `client/**` 4 文件 + 新增 2 文件 + 删除 1 文件 + "
    "新增 1 探针 + 1 测试（另更新 1 测试断言与 1 验证脚本落点断言）。",
    "- ⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**；前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。",
    "- 登记：§44.5 队列编号非严格递增（存在 `9v` 重复、`9ae` 因插入顺序错位于 `9v` 之前）⇒ 新编号必须按「**下一个未占用**」判定，"
    "**禁「末条 +1」**；本轮取 `9ag`（`9af` 已被上一轮占用）。",
]


def split_kept(path):
    """读文件：同时给出【保留行尾的物理行】与【去掉行尾的逻辑行】。"""
    raw = io.open(path, encoding="utf-8", newline="").read()
    physical = raw.splitlines(keepends=True)
    nl = "\r\n" if "\r\n" in raw else "\n"
    logical = [ln.rstrip("\r\n") for ln in physical]
    return raw, physical, logical, nl


def apply_roadmap():
    raw, physical, logical, nl = split_kept(R)
    print("    ROADMAP 诊断：CRLF=%s  cr=%d  lf=%d  物理行=%d"
          % ("\r\n" in raw, raw.count("\r"), raw.count("\n"), len(physical)))

    idxs = [k for k, ln in enumerate(logical) if ln.startswith(DEMOTE_FROM)]
    if any(ln.startswith("> 最后实查：**" + TS) for ln in logical):
        # 幂等：本轮条目已在文件里（上一次已写入）⇒ 不再插入，避免重复
        print("SKIP  ROADMAP.md：本轮条目已存在（幂等跳过，绝不重复插入）")
        return nl
    assert len(idxs) == 1, "期望恰好 1 行 `%s`，实得 %d" % (DEMOTE_FROM, len(idxs))
    i = idxs[0]
    old_line = logical[i]
    demoted = DEMOTE_TO + old_line[len(DEMOTE_FROM):]
    assert demoted != old_line, "降级行与原行相同（标签没变）"

    jdxs = [k for k, ln in enumerate(logical) if re.match(r"^\s*- \*\*9af\.", ln)]
    assert len(jdxs) == 1, "期望恰好 1 条 `9af.` 队列条目，实得 %d" % len(jdxs)
    j = jdxs[0]
    assert not any("9ag." in ln for ln in logical), "编号 9ag 已被占用"

    new_physical = list(physical)
    # 先插靠后的队列行，再插靠前的头部行 ⇒ 前者的下标不受影响
    new_physical.insert(j + 1, NEW_QUEUE + nl)
    new_physical[i:i + 1] = [NEW_HEADER + nl, ">" + nl, demoted + nl]

    new_logical = [ln.rstrip("\r\n") for ln in new_physical]

    added = Counter([NEW_HEADER, ">", NEW_QUEUE, demoted])
    removed = Counter([old_line])
    assert Counter(new_logical) - Counter(logical) == added - removed, (
        "多重集不变量不成立（新增侧）：\n  多出 %s\n  少了 %s"
        % (dict((Counter(new_logical) - Counter(logical)) - (added - removed)) or {},
           dict((added - removed) - (Counter(new_logical) - Counter(logical))) or {})
    )
    assert Counter(logical) - Counter(new_logical) == removed, "被删行不止那一行标签降级"
    assert len(new_physical) - len(physical) == 3, "行数增量应为 3，实得 %d" % (len(new_physical) - len(physical))

    new_text = "".join(new_physical)
    # 结尾风格与原文一致 + 除插入点外前后缀逐字不变
    assert new_physical[0] == physical[0] and new_physical[-1] == physical[-1], "首/末行被动到"
    assert new_text.startswith(physical[0]), "前缀被破坏"
    assert new_text.endswith(physical[-1]), "后缀被破坏"

    io.open(R, "w", encoding="utf-8", newline="").write(new_text)
    print("OK  ROADMAP.md：§44 头部插入 2 行 + 标签降级 1 行；§44.5 追加 1 行（9ag）")
    print("    行数 %d → %d；多重集不变量 ✓（**只增 3 行 + 1 处标签降级**）" % (len(physical), len(new_physical)))
    return nl


def apply_changelog():
    raw, physical, logical, nl = split_kept(C)
    print("    CHANGELOG 诊断：CRLF=%s  物理行=%d" % ("\r\n" in raw, len(physical)))
    assert CHANGELOG_HEADING not in raw, "CHANGELOG 已存在同一条目，禁重复追加"
    assert raw.endswith(nl), "CHANGELOG 末尾无换行，追加策略需重新确认"

    block = [CHANGELOG_HEADING, ""] + CHANGELOG_BODY
    # 追加块 = 空行 + `---` + 空行 + 标题 + 空行 + 逐条 bullet，末尾补一个换行
    appended = nl + nl.join(["---", ""] + block) + nl
    new_text = raw + appended
    new_logical = [ln.rstrip("\r\n") for ln in new_text.splitlines(keepends=True)]
    added_lines = [""] + ["---", ""] + block

    assert new_text[: len(raw)] == raw, "前缀被破坏（append-only 违规）"
    assert Counter(new_logical) - Counter(logical) == Counter(added_lines), (
        "追加行集合不符：\n  多 %s\n  少 %s"
        % (dict((Counter(new_logical) - Counter(logical)) - Counter(added_lines)) or {},
           dict(Counter(added_lines) - (Counter(new_logical) - Counter(logical))) or {})
    )
    assert Counter(logical) - Counter(new_logical) == Counter(), "append-only 却删了原有行"

    io.open(C, "w", encoding="utf-8", newline="").write(new_text)
    print("OK  ROADMAP-CHANGELOG.md：末尾追加 1 条（%d 行）" % len(block))
    print("    prefix 逐字不变 ✓；行数 %d → %d" % (len(logical), len(new_logical)))


if __name__ == "__main__":
    apply_roadmap()
    apply_changelog()
    print("\n完成。核验：git diff --numstat -- ROADMAP.md ROADMAP-CHANGELOG.md")
    sys.exit(0)
