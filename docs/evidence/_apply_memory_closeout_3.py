# -*- coding: utf-8 -*-
"""记忆层收尾：MEMORY.md 瘦身 + 新增硬禁令 + PROJECT_RULES.md 收细则 + 逐日日志追加。

背景：`MEMORY.md` 会被**注入**到每轮上下文，实测**上限约 7,967 字符**（超出的部分被静默截断）。
本轮它已到 **7,991**（已越界）⇒ 必须「**把细则挪去 `PROJECT_RULES.md`（不注入、无上限）+ 只留判据**」。

纪律：
  - `MEMORY.md` / `PROJECT_RULES.md` **就地改写**（本脚本对每条替换断言「恰好命中 1 次」）；
  - 逐日日志 `2026-09-13.md` **append-only**（并行会话可能同时在写）⇒ 只追加、并断言前缀不变；
  - 换行风格按文件探测（`ROADMAP.md` 的 CRLF 教训同样适用）。
"""
import io
import os
import sys
from collections import Counter

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
MEM = os.path.join(ROOT, ".workbuddy", "memory", "MEMORY.md")
RULES = os.path.join(ROOT, ".workbuddy", "memory", "PROJECT_RULES.md")
LOG = os.path.join(ROOT, ".workbuddy", "memory", "2026-09-13.md")


def read(path):
    raw = io.open(path, encoding="utf-8", newline="").read()
    return raw, ("\r\n" if "\r\n" in raw else "\n")


def apply(path, pairs):
    raw, nl = read(path)
    out = raw
    for old, new in pairs:
        o = old.replace("\n", nl)
        n = new.replace("\n", nl)
        c = out.count(o)
        assert c == 1, "%s：期望命中 1 次，实得 %d 次\n---\n%s\n---" % (
            os.path.basename(path), c, old.split("\n")[0][:100])
        out = out.replace(o, n)
    io.open(path, "w", encoding="utf-8", newline="").write(out)
    print("OK  %-20s %d 处  |  %d → %d 字符" % (os.path.basename(path), len(pairs), len(raw), len(out)))
    return out


# ---------------------------------------------------------------------------
# 1. MEMORY.md 瘦身 + 新增
# ---------------------------------------------------------------------------

M_INFRA_OLD = """## 🔴 基础设施坑
- 🔴 **mysql2 `idleTimeout` 只在 `maxIdle < connectionLimit` 时生效**；相等 ⇒ **死配置**、`getConnection()` 直接 `pop()` 无 ping ⇒ 跨境下死连接被原样发出（`Failed query` + `cause` 链 `ECONNRESET`）。**修复 = `maxIdle: poolSize - 1`**（已修）；⚠️ 探针跨轮次重复查询也会撞 ⇒ **重跑一次**。
- 🔴 **「全端点一致 DB 失败 + 零 DB 端点正常」= 池内死连接，先查池、别改代码**（`readiness` 200 作对照；**实测 t+75s 自行恢复**）⇒ **别当成自己改出来的回归**。
- 🔴 **`withReadRetry`（`researchEngine/readRetry.ts`）= 只读安全的有界瞬时错误重试**（3 次 / 300→900ms，**语义错误不重试**）；**跨境只读瞬时错误是常态** ⇒ **单次失败 ≠ 代码缺陷**（判据 = 独立复现 + `information_schema` 核对）；脚本顶层 catch **必须摊开 `cause` 链**。
- 🔴 **真实列名（禁凭记忆写 SQL；探针 `docs/evidence/_probe_table_columns.mts`）**：`research_analysis` **无 `startedAt`**；`research_analysis_condition` 用 **`analysisId`/`groupNo`/`sortOrder`/`fieldName`/`operator`/`valueJson`/`logicalOperator`/`groupLogicalOperator`**（**非** `groupIndex`/`field`）；`research_result`（**非** `research_analysis_result`）；`research_conclusion` **无 `runId`**；`research_strategy_candidate` 用 **`experimentId`/`conclusionId`/`strategyDefinitionId`**；**`research_analyses`（复数）不存在**。
"""

M_INFRA_NEW = """## 🔴 基础设施坑（细则 → `PROJECT_RULES.md`「基础设施坑」）
- 🔴 **「全端点一致 DB 失败 + 零 DB 端点正常」= 池内死连接 ⇒ 先查池、别改代码**（`readiness` 200 作对照；**t+75s 自行恢复**）⇒ **别当成自己改出来的回归**。mysql2 `idleTimeout` 只在 `maxIdle < connectionLimit` 时生效（相等 = 死配置）⇒ 修复 = `maxIdle: poolSize - 1`（已修）。
- 🔴 **`withReadRetry` = 只读安全的有界瞬时重试**（**语义错误不重试**）；**跨境只读瞬时错误是常态** ⇒ **单次失败 ≠ 代码缺陷**；脚本顶层 catch **必须摊开 `cause` 链**。
- 🔴 **真实列名禁凭记忆写 SQL**（探针 `_probe_table_columns.mts`）：`research_analysis` 无 `startedAt`；`research_analysis_condition` 用 `analysisId`/`groupNo`/`sortOrder`/`fieldName`/`operator`/`valueJson`（**非** `groupIndex`/`field`）；`research_result`（**非** `research_analysis_result`）；`research_conclusion` 无 `runId`；**`research_analyses`（复数）不存在**。
"""

M_ROOT_OLD = """- 🔴 **「条件进不了回测」根因是架构性的**：`definitionBuild.ts` **已**把 `filterRule` 翻成 `definition.entry.conditions`，但 `assemble.ts` 对 `entryRules` 引用数 = 0、`server/backtest/**` 与 `server/strategy/**` 对它引用数 = 0（配方只看 `recipeId`）；`Strategy13` 带**函数实例**（`FeatureProvider.compute`/`SignalBuilder`）**无法从 DB JSON 还原** ⇒ **唯一正路 = 在 `recipeRegistry.ts` 注册真实配方 + 草稿带 `recipeId`；禁靠 promote 注入定义。**"""

M_ROOT_NEW = """- 🔴 **「条件进不了回测」根因是架构性的**：`definitionBuild.ts` **已**把 `filterRule` 翻成 `definition.entry.conditions`，但 `assemble.ts` / `server/backtest/**` / `server/strategy/**` 对 `entryRules` 引用数 = 0（配方只看 `recipeId`）；`Strategy13` 带**函数实例**（`FeatureProvider.compute`/`SignalBuilder`）**无法从 DB JSON 还原** ⇒ **唯一正路 = `recipeRegistry.ts` 注册真实配方 + 草稿带 `recipeId`；禁靠 promote 注入定义。**"""

M_SWITCH_OLD = """- ✅ **两个 UI 开关已移除（2026-09-13）**：`useRealData` 与 `dataReady` 已从 `RunConfigPanel` **删掉**、现恒为真（关①⇒ `CL_DATA_NOT_INJECTED` ⇒ 后 13 阶段全 `CL_UPSTREAM_BLOCKED`；关②⇒ 数据集 gate 被**人为**压成 `INCONCLUSIVE`）⇒ **别再往运行工作台加「是否用真数据」类开关。** ⚠️ **`dataReady` 原名与语义不符**：其真义 = 「**是否读取库内 `dataset_version.status` 真实值**」，**不是「用户声明」**。"""

M_SWITCH_NEW = """- ✅ **两个 UI 开关已移除（2026-09-13）**：`useRealData` / `dataReady` 已从 `RunConfigPanel` **删掉**、现恒为真（`dataReady` 真义 = **是否读库内 `dataset_version.status` 真实值**，非「用户声明」）⇒ **别再往运行工作台加「是否用真数据」类开关。**"""

M_ENV_OLD = """- 🔴 `ROADMAP*.md` 用 Read/Grep，**禁 `sed`/`head`/`cut`**（中文乱码）。"""

M_ENV_NEW = """- 🔴 `ROADMAP*.md` 用 Read/Grep，**禁 `sed`/`head`/`cut`**（中文乱码）；🔴 **`ROADMAP.md` 是 CRLF** ⇒ 行级手术**必须 `splitlines(keepends=True)`**，**禁 `split("\\n")` + `"\\r\\n".join`**（会给每行叠 `\\r` 并污染多重集断言；已踩两次，均被断言拦下未写坏）。"""

M_Q_OLD = """（末位 `9af` ⇒ 下一个 `9ag`）"""

M_Q_NEW = """（末位 `9ag` ⇒ 下一个 `9ah`）"""

M_ANCHOR = """## 🔴 策略定义（凭记忆必错；`PROJECT_RULES.md` 未收）"""

M_NEW_SECTION = """## 🔴 页面坐标（2026-09-13 策略页分家）
- **列表 `/strategies`（`pages/StrategyList.tsx`）+ 详情 `/strategies/:strategyId`（`pages/StrategyDetail.tsx`，版本在 `?version=`，URL 为唯一坐标源）**；旧 `/strategy-editor` = 兼容跳转（`LegacyStrategyRedirect`）；侧栏「策略」；深链生成器 `strategyVersionPath` 已指详情页。
- 🔴 **详情页不承载全库浏览**（不调 `research.strategy.list`）；**新建草稿必须清空 `strategyId`**（模板 `limit-up-baseline` 已在真实库中 ⇒ 否则会变成给既有策略加版本）。

"""

apply(MEM, [
    (M_INFRA_OLD, M_INFRA_NEW),
    (M_ROOT_OLD, M_ROOT_NEW),
    (M_SWITCH_OLD, M_SWITCH_NEW),
    (M_ENV_OLD, M_ENV_NEW),
    (M_Q_OLD, M_Q_NEW),
    (M_ANCHOR, M_NEW_SECTION + M_ANCHOR),
])

# ---------------------------------------------------------------------------
# 2. PROJECT_RULES.md 收细则（不注入、无上限）
# ---------------------------------------------------------------------------

RULES_ADD = """
## 基础设施坑（细则）

> 索引与一句话判据在 `MEMORY.md`「基础设施坑」；本节收细则，供排查时逐条对照。

- **mysql2 `idleTimeout` 只在 `maxIdle < connectionLimit` 时生效**。两者相等 ⇒ **死配置**：
  `getConnection()` 直接 `pop()`、**不做 ping** ⇒ 跨境链路下已被对端关掉的死连接被**原样发出**，
  症状 = `Failed query` + `cause` 链里的 `ECONNRESET`。**修复 = `maxIdle: poolSize - 1`**（已修）。
  ⚠️ 探针**跨轮次重复查询**也会撞上 ⇒ **重跑一次**再定性。
- 🔴 **「全端点一致 DB 失败 + 零 DB 端点正常」= 池内死连接** ⇒ **先查池、别改代码**。
  对照手段：无 DB 的 `readiness` 端点返回 200；实测 **t+75s 自行恢复**⇒ **别当成自己改出来的回归**。
- 🔴 **`withReadRetry`（`researchEngine/readRetry.ts`）= 只读安全的有界瞬时错误重试**：
  3 次、300→900ms 退避、**语义错误不重试**。**跨境只读瞬时错误是常态** ⇒ **单次失败 ≠ 代码缺陷**；
  判据 = **独立复现 + `information_schema` 核对**（而非「重跑一次就好了」）。
  脚本顶层 catch **必须摊开 `cause` 链**（Drizzle 会把真实错误包成 `DrizzleQueryError`）。
- 🔴 **真实列名（禁凭记忆写 SQL）** —— 探针 `docs/evidence/_probe_table_columns.mts`：
  - `research_analysis`：**无 `startedAt`**；
  - `research_analysis_condition`：`analysisId` / `groupNo` / `sortOrder` / `fieldName` / `operator` /
    `valueJson` / `logicalOperator` / `groupLogicalOperator`（**不是** `groupIndex` / `field`）；
  - 结果表叫 **`research_result`**（**不是** `research_analysis_result`）；
  - `research_conclusion`：**无 `runId`**；
  - `research_strategy_candidate`：`experimentId` / `conclusionId` / `strategyDefinitionId`；
  - **`research_analyses`（复数）不存在**。

## 页面坐标：策略「列表 / 详情」分家（2026-09-13）

> 索引与一句话判据在 `MEMORY.md`「页面坐标」。

- **两页两路由**：列表 `/strategies`（`client/src/pages/StrategyList.tsx`）与详情
  `/strategies/:strategyId`（`client/src/pages/StrategyDetail.tsx`）。**列表只回答「有哪些策略」，
  详情只回答「这一个策略长什么样」**。
- **URL 是详情的唯一坐标源**：`strategyId` 进**路径**、`version` 进**查询参数** ⇒ 换版本 = 改 URL
  （可回退 / 可分享 / 可刷新）。`?version` 缺省 = 该策略最新版本（走 `load`，而非 `loadVersion`）。
  旧实现里 `pendingLoad` / `loadLatest` / `loadPinned` / `urlHandled` / `autoPicked` / `touched`
  **六个互相牵制的本地状态已全部移除**；换策略靠外层 `key={strategyId}` 重挂载归零。
- **旧地址 `/strategy-editor?strategyId=&version=` 保留为兼容路由**（`App.tsx` 的
  `LegacyStrategyRedirect` 做静态改写）⇒ 候选转正页的历史深链与书签继续可用，且**不渲染第二套页面**。
  侧栏导航为「策略」→ `/strategies`；深链生成器 `strategyVersionPath`（`strategyCandidateAdapter.ts`）
  已改指详情页，`scripts/verifyResearch00641Promote.mts` 的落点断言同步更新。
- 🔴 **详情页不调 `research.strategy.list`**（结构性地不承载全库浏览）—— 有契约测试守着
  （`tests/client/src/pages/strategyListDetailSplit.test.ts`）。
- 🔴 **新建草稿必须清空身份字段**：模板 `TEMPLATE_DOCUMENT` 的 `strategyId`（`limit-up-baseline`）
  **确实存在于真实库**（探针 `_e2e_strategy_list_detail.mts` 第 3 节实证）⇒ 直接拿模板保存会
  **变成给既有策略加版本**而不是新建。
- **口径不变**：`load` → 裸 `StrategyDocument`；`loadVersion` → §17 记录（文档在 `.strategy` 下）
  ⇒ 经 `toStrategyDocument()` 归一（两条分支都被探针独立证明）。
"""

raw_rules, nl_rules = read(RULES)
assert "## 页面坐标：策略「列表 / 详情」分家（2026-09-13）" not in raw_rules, "已追加过，禁重复"
assert raw_rules.endswith(nl_rules), "PROJECT_RULES 末尾无换行"
added_rules = RULES_ADD.replace("\n", nl_rules)
new_rules = raw_rules + added_rules
io.open(RULES, "w", encoding="utf-8", newline="").write(new_rules)
print("OK  %-20s 追加 2 节 | %d → %d 字符" % (os.path.basename(RULES), len(raw_rules), len(new_rules)))

# ---------------------------------------------------------------------------
# 3. 逐日日志（append-only）
# ---------------------------------------------------------------------------

LOG_ENTRY = """
## 2026-09-13 22:07 — 「策略」页列表 / 详情分家（纯 `client/**`，VALIDATED）

**触发**：用户接续反馈「不是，你把策略列表跟策略详情给分开啊，这是什么乱七八糟的页面，能不能从用户体感上来设计，还有太多无用的文字说明」。

**交付**：新增 `client/src/pages/StrategyList.tsx`（`/strategies`，卡片网格 + 新建入口）与
`client/src/pages/StrategyDetail.tsx`（`/strategies/:strategyId`，**URL 为唯一坐标源**）；改写
`components/strategy/StrategyHeader.tsx`（**删掉策略下拉框**、加返回入口、元信息压到一行）、`App.tsx`
（两条新路由 + `LegacyStrategyRedirect` 兼容旧地址）、`AppShell.tsx`（导航 →「策略」`/strategies`）、
`adapters/strategyCandidateAdapter.ts`（深链改指详情页）；**删除** `pages/StrategyEditor.tsx`。

**文案治理**：先用只读探针**量化**用户可见长文案（连续 ≥10 汉字行，合计 **867 字**），再用「每条必须恰好命中 1 次」
的断言脚本删 / 缩 **44 处 / 13 文件**；顺手修正 `ClosedLoopRunResultPanel` 两条**仍在说已移除开关**的过期阻塞原因。

**实测**：`tsc --noEmit` exit 0 零输出；`vitest run tests/client` **22 文件 / 528 例全通过**（基线 21/519）；
**完整回归 235 文件（7 失败 / 228 通过，16 例）—— 失败文件集合与登记基线逐项同名 ⇒ 零新增回归**；
`vite build` exit 0（bundle 2,557.21 → **2,549.40 kB**）；真实库探针 `docs/evidence/_e2e_strategy_list_detail.mts`
**14/14 PASS**（含「模板 id 已在库中」的实证）。

**教训（已固化进 MEMORY.md）**：`ROADMAP.md` 是 **CRLF** ⇒ 行级手术**必须 `splitlines(keepends=True)`**，
`split("\\n")` + `"\\r\\n".join` 会叠加 `\\r` 并污染「只增不改」的多重集断言 —— 本轮被自己的断言拦下两次，**均未写坏文件**。
"""

raw_log, nl_log = read(LOG)
assert "「策略」页列表 / 详情分家" not in raw_log, "日志已有同一条，禁重复追加"
log_add = LOG_ENTRY.lstrip("\n").replace("\n", nl_log)
new_log = raw_log + nl_log + log_add
assert new_log.startswith(raw_log), "逐日日志前缀被破坏（append-only 违规）"
io.open(LOG, "w", encoding="utf-8", newline="").write(new_log)
print("OK  %-20s 追加 1 条 | %d → %d 字符" % (os.path.basename(LOG), len(raw_log), len(new_log)))

# ---------------------------------------------------------------------------
# 4. 体积核验
# ---------------------------------------------------------------------------

final_mem = io.open(MEM, encoding="utf-8").read()
print("\n=== 收尾核验 ===")
print("MEMORY.md 字符 = %d（注入上限实测约 7,967）→ %s"
      % (len(final_mem), "✅ 达标" if len(final_mem) <= 7900 else "⚠️ 仍偏紧"))
for k in ["splitlines(keepends=True)", "9ah", "页面坐标", "/strategies/:strategyId",
          "LegacyStrategyRedirect", "新建草稿必须清空", "热调用 ≈0ms", "免责声明",
          "columnProjection", "gated", "availableFromOffset", "ECONNRESET"]:
    print(("  ✅ " if k in final_mem else "  ❌ 丢失 ") + k)
sys.exit(0)
