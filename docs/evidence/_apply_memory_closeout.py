# -*- coding: utf-8 -*-
"""
收尾脚本 2（记忆层）：
  1) `PROJECT_RULES.md` 末尾新增「配方与参数」章节（承接从 MEMORY.md 移出的细则）；
  2) `MEMORY.md` 的「配方与参数」章节压成「判据 + 指针」，使全文 ≤ 8000 字符（注入上限）；
  3) `.workbuddy/memory/2026-09-13.md` 末尾追加本轮工作记录（append-only）。
每步都断言：锚点唯一 / 前缀不被破坏 / 结果满足预期。
"""
import io
import os
import sys

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
MEM = os.path.join(ROOT, r".workbuddy\memory\MEMORY.md")
RULES = os.path.join(ROOT, r".workbuddy\memory\PROJECT_RULES.md")
LOG = os.path.join(ROOT, r".workbuddy\memory\2026-09-13.md")

# ---------------------------------------------------------------- 1) 移入 PROJECT_RULES.md
RULES_SECTION = """
## 🔴 配方与参数（`recipeRegistry.ts` 与配方契约）

> 2026-09-13 由 `MEMORY.md` 移入（该项目为「注入上限 ~8000 字符」的体积治理，内容零丢失）。

- 已注册 **2 个**配方：`leader-candidate-baseline`（`weighted`，`pctChange` + `topN:5`）；**`first-limit-pullback-hold-shrink`**（`gated`，4 特征 + 3 参数 `max_volume_ratio` / `max_drawdown` / `require_bullish`）。
- 🔴 **门槛型条件必须用 `gated`**：加权和里「守线失败」只让分数变小、**不剔除** ⇒ 属**口径错误**（不是实现 bug，是配方类型选错）。
- 🔴 **`requireRecipe` 的优先级**：**文档已声明 `recipe` ⇒ 文档优先**，显式传入的 `recipeId` **不得覆盖**；只在文档**无** `recipe` 时兜底。**禁改成「调用方覆写优先」。**
- 🔴 **`signalBuilder` 是工厂函数 `buildSignalBuilder(parameters)`** ⇒ **必须先 `resolveParameters` 再构造 `strategy13`**（顺序错会拿到未解析的参数）。
- 🔴 **数值参数必须同时给 `min` 与 `max`**（草稿 `parameterRole` 恒 `TUNABLE`，否则 `PROMOTE_SKETCH_INCOMPLETE`）；非数值参数须给非空 `allowedValues`；无 `defaultValue` ⇒ `RECIPE_PARAMETER_NO_DEFAULT`。
- 🔴 **`ResearchDataset.rows[]` 没有 `bars` 字段** ⇒ **禁手搓 `row.bars` 复算特征**（会得 0 候选 + 假「特征全缺失」）。正确做法 = **走真实引擎 `runCandidateEngine`**，再用 `visibleBars(...)` 独立复算核对。
- ⚠️ **`CandidateEvaluationRun` 只是候选层统计（不含成交 / 收益）** ⇒ **真正「逐日撮合出收益曲线」的回测仍未做**（实测 `tradeCount=0` ⇒ 曲线恒等于初始资金、指标全 0）。
"""

# ---------------------------------------------------------------- 2) MEMORY.md 压缩替换
OLD_MEM_SECTION = """## 🔴 配方与参数（`recipeRegistry.ts` 已注册 2 个）
- `leader-candidate-baseline`（`weighted`，`pctChange`+`topN:5`）；**`first-limit-pullback-hold-shrink`**（`gated`，4 特征 + 3 参数 `max_volume_ratio`/`max_drawdown`/`require_bullish`）。
- 🔴 **门槛型条件必须用 `gated`**：加权和里「守线失败」只让分数变小、**不剔除** ⇒ **口径错误**。
- 🔴 **`requireRecipe`**：**文档已声明 `recipe` ⇒ 文档优先**，显式 `recipeId` **不得覆盖**；**禁改成「调用方覆写优先」**。
- 🔴 **`signalBuilder` 是工厂 `buildSignalBuilder(parameters)`** ⇒ **必须先 `resolveParameters` 再构造 `strategy13`**；数值参数须同时给 `min`/`max`，非数值给非空 `allowedValues`。
- 🔴 **`ResearchDataset.rows[]` 无 `bars`** ⇒ **禁手搓 `row.bars` 复算特征**（得 0 候选 + 假「特征全缺失」）；正确 = 走真实引擎 `runCandidateEngine` 再用 `visibleBars(...)` 核对。
- ⚠️ **`CandidateEvaluationRun` 是候选层统计（不含成交/收益）** ⇒ **逐日撮合出收益曲线的回测仍未做**（`tradeCount=0` ⇒ 曲线恒等初始资金）。
"""

NEW_MEM_SECTION = """## 🔴 配方与参数（细则 →「配方与参数」章节）
- 已注册 **2 个**配方：`leader-candidate-baseline`（`weighted`）、**`first-limit-pullback-hold-shrink`**（`gated`）。
- 🔴 **门槛型条件必须用 `gated`**（`weighted` 里「不满足」只降分、**不剔除** ⇒ **口径错误**）；🔴 **`requireRecipe`：文档已声明 `recipe` ⇒ 文档优先**，显式 `recipeId` **不得覆盖**。
- 🔴 **`signalBuilder` 是工厂** ⇒ **必须先 `resolveParameters` 再构造 `strategy13`**；🔴 **禁手搓 `row.bars` 复算特征**（`ResearchDataset.rows[]` 无 `bars` ⇒ 得 0 候选）⇒ 必须走真实引擎 `runCandidateEngine`。
"""

# ---------------------------------------------------------------- 3) 日志
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


def append(p, text):
    before = read(p)
    assert before.endswith("\n"), "%s 结尾非换行" % p
    with io.open(p, "a", encoding="utf-8", newline="") as f:
        f.write(text)
    after = read(p)
    assert after.startswith(before), "%s 前缀被破坏（append-only 违规）" % p
    return len(before), len(after)


def main():
    # 1) PROJECT_RULES.md 新增章节
    rules = read(RULES)
    assert "## 🔴 配方与参数" not in rules, "PROJECT_RULES.md 已有该章节，禁重复插入"
    b, a = append(RULES, RULES_SECTION)
    print("[1/3] PROJECT_RULES.md += 「配方与参数」章节      ✅ 字符 %d -> %d（+%d）" % (b, a, a - b))

    # 2) MEMORY.md 压缩该章节
    mem = read(MEM)
    assert mem.count(OLD_MEM_SECTION) == 1, "MEMORY.md 中「配方与参数」原文匹配数 != 1"
    new_mem = mem.replace(OLD_MEM_SECTION, NEW_MEM_SECTION, 1)
    assert len(new_mem) < len(mem)
    with io.open(MEM, "w", encoding="utf-8", newline="") as f:
        f.write(new_mem)
    chk = read(MEM)
    assert NEW_MEM_SECTION in chk and OLD_MEM_SECTION not in chk
    ok = "✅ 达标" if len(chk) <= 8000 else "❌ 仍超 %d" % (len(chk) - 8000)
    print("[2/3] MEMORY.md  配方章节 -> 指针        %s 字符 %d -> %d" % (ok, len(mem), len(chk)))
    assert len(chk) <= 8000, "MEMORY.md 仍超 8000 字符"

    # 3) 日志追加
    b2, a2 = append(LOG, LOG_ENTRY)
    print("[3/3] 2026-09-13.md += 本轮记录          ✅ 字符 %d -> %d（+%d）" % (b2, a2, a2 - b2))


if __name__ == "__main__":
    main()
    sys.exit(0)
