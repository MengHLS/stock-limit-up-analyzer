# RESEARCH-PLANNER-001 · 缺陷 780001 —— 「创建候选」恒失败

> 状态：**已修复 + 已在真实失败数据上验证**（tRPC 层 41 项断言 / 0 失败；真机按钮流程见文末）
> 报告日期：2026-09-17
> 影响面：`/research/ask` 结论页「创建 Candidate」按钮 —— **100% 复现，100% 失败**
> 所属轮次：`ROADMAP.md` 队列 **`9au`**（承接 `9at` / RESEARCH-PLANNER-001）

---

## 0 一句话结论

**前端自己挑「用哪条分析导出候选筛选条件」，挑中的是计划里第一条 P0 —— 而那是
`EVENT_STUDY` 全样本基准，天然没有条件行。** 服务端按设计拒绝，于是这颗按钮
**必然失败**。修复 = 把「哪条分析能导条件」这个判断收敛成**服务端唯一实现**
（`aggregate.ts#rankCandidateSourceAnalyses`），前端/Workbuddy/E2E 共用同一份。

---

## 1 缺陷现象与复现

### 1.1 用户原文

```
创建候选失败 分析 780001 没有任何条件，无法导出候选题筛选条件。
```

### 1.2 现场实测（`docs/evidence/_probe_analysis_780001.mts`）

```
=== 分析 780001 ===
{
  "id": 780001,
  "runId": 780002,
  "name": "全样本基准 · 事件后收益 T+5/T+10",
  "analysisType": "EVENT_STUDY",
  "priority": "P0",
  "requiredFlag": 1,
  "planId": 120002,
  "moduleKey": "BREAKOUT_SUCCESS_RESEARCH"
}

=== 该分析的落库条件（research_analysis_condition）===
条件行数 = 0

=== 所属 Run 的 P0 分析（按 id 升序 = 前端 find 的遍历顺序）===
{"id":780001,"priority":"P0","requiredFlag":1,"analysisType":"EVENT_STUDY","name":"全样本基准 · 事件后收益 T+5/T+10","conditionCount":0}
{"id":780004,"priority":"P0","requiredFlag":1,"analysisType":"CONDITIONAL","name":"回踩期未破首板日最低价（T+3） → T+5 收益","conditionCount":1}

=== 判定 ===
前端 find(a => a.priority === "P0") 会取到 #780001（type=EVENT_STUDY，条件数=0）
⇒ 与本探针对象一致：**根因成立** —— 前端取到了无条件分析。
```

### 1.3 根因链

| 环节 | 事实 |
|---|---|
| 计划生成 | `analysisPlan.ts:361-373` 是 `generateAnalysisPlan()` **第一条 `push`**，产出的正是 `EVENT_STUDY` 全样本基准，`priority: "P0"`、`required: true`。它**只是参照系**，本来就不该带条件 |
| 前端挑选 | `ResearchAsk.tsx#handleCreateCandidate` = `outcome.analyses.find(a => a.priority === "P0") ?? outcome.analyses[0]` ⇒ 必然命中上面那条 |
| 服务端 | `createCandidate` 只校验调用方给的那条（`rows.length === 0` ⇒ `BAD_REQUEST`），**自己不参与挑选** |
| 结果 | 无条件基准 → 前端必然传它 → 服务端必然拒 ⇒ **按钮恒失败** |

### 1.4 🔴 为什么测试全绿却没抓到

`docs/evidence/_e2e_research_planner.mts:401` 用的是：

```ts
const coreGuard = outcome.analyses.find((a) => a.priority === "P0" && a.analysisType === "CONDITIONAL");
```

而产品用的是 `a.priority === "P0"`。**E2E 把挑选判据写得更严，等于绕开了产品的真实调用路径**；
它传的是显式的 `deriveFilterFromAnalysisId: coreGuard.analysisId`，于是永远走通。

> 教训：**测试比产品严 ⇒ 测试通过只证明测试的挑法对，不证明产品可用。**
> 验收必须走产品真正发出去的那份载荷（`{questionId, name, description}`，**不含** analysisId）。

---

## 2 修复方案

### 2.1 设计原则

「哪条分析有条件」是**数据库事实**，调用方（前端 / Workbuddy）无从猜测 ——
§20 的调用契约本来就只有 `{datasetVersionId, researchQuestion}`，Workbuddy 拿不到库内主键。
因此挑选规则**必须**落在服务端，且**只实现一次**。

### 2.2 改动清单

| 文件 | 改动 |
|---|---|
| `server/researchEngine/planner/aggregate.ts` | ① `ResearchOutcomeAnalysisStat` 新增 `conditionCount` / `requiredFlag` / `isQuestionEmphasis`；② 新增 `ResearchOutcomeCandidateSource` 类型与 `ResearchOutcome.candidateEligibleAnalyses`；③ 新增 **唯一排序实现** `rankCandidateSourceAnalyses()`；④ 结果行数与条件行数**并发**取（往返次数不变 ⇒ 零额外延迟） |
| `server/researchPlannerRouter.ts` | ⑤ `createCandidate` 的 `deriveFilterFromAnalysisId` 变为**可选提示**；不传时自动挑；新增私有实现 `resolveCandidateFilterSource()`；⑥ 显式传错时错误信息列出「本 Run 可导出条件的分析」；⑦ 回执新增 `filterRuleSource`；⑧ 一条都挑不到时**不报错**（`filterRule` 留空 + 如实警告），而不是静默产出空口径 |
| `client/src/pages/research/ResearchAsk.tsx` | ⑨ **不再自己挑分析**（彻底删掉 `find(a => a.priority === "P0")`），改为读回执；⑩ 结论页在按钮**之前**新增「候选筛选条件来源」区块（含「本 Run 共 N 条可导出」的可展开清单） |
| `client/src/components/research/researchAskForm.ts` | ⑪ 新增 `CandidateFilterSourceView` / `CandidateEligibleView` 类型与纯函数 `candidateFilterOriginLabelOf()` 三态标签 |

### 2.3 排序口径（`rankCandidateSourceAnalyses`）

越靠前越优先：

1. `conditionCount > 0` —— **硬门槛**，0 条件的分析直接**不入选**（不是「排后面」）；
2. `isQuestionEmphasis` —— 被提问点名（§28：问「回踩深一点还是浅一点」，候选条件就该是那个深度档）；
3. `requiredFlag` —— 计划必需项 = 本问题的核心口径（§27：问题没点名精修维度时用它）；
4. `priority` `P0 → P1 → P2`（未分级最后）；
5. `analysisType === "CONDITIONAL"` —— 条件分析才天然携带条件，但**不写死为唯一来源**（§3 可扩展）；
6. `analysisId` 升序 —— 同一 Run 两次调用挑到同一条（可复现）。

每条输出都带人读的 `why`（如「计划必需项 · P0 · 条件分析 · 1 条条件」）——「为什么挑这条」可被审查，不是黑箱。

### 2.4 顺带修掉的相邻缺口：`getOutcome` 两种定位入口不等价

`buildResearchOutcome` 支持 `questionId` / `runId` 两种定位，但旧实现**只在 `questionId` 路径上**
解析 plan / question。于是**同一份研究换个入口结果就不同** —— 按 `runId` 调用会丢：

- `planId` / `datasetVersionId` / `moduleKeys` / `plan.*` ⇒ §16 provenance 六项不齐；
- `plan.notes.emphasisAnalysisNames` ⇒ §13 提问锚点失效，退回 `REQUIRED_FALLBACK`。

实测证据（修复前）：`createCandidate({ runId })` 的 `provenance.complete === false`。
修复 = 顺着 `research_analysis.planId`（它本就是「这条分析由哪份计划生成」的权威记录）反查补齐，
再按 `plan.questionId` 补 question。人工在高级模式逐个建的分析 `planId` 为 NULL ⇒ 什么都不做。

---

## 3 验证

### 3.1 tRPC 层（`docs/evidence/_verify_candidate_filter_source.mts`，跑在**用户真实失败的那份数据**上）

```
Run 780002 / Plan 120002 / 基准分析 780001 / 守卫分析 780004
检查项 41 / 失败 0
结论：ALL PASS —— 缺陷已修复且在真实失败数据上验证通过
```

| 段 | 断言要点 |
|---|---|
| [0] 缺陷复现（只读） | 旧口径 `find(P0)` 命中的确实是 `#780001`（`EVENT_STUDY`，条件数 0）；同 Run 存在带条件的 `#780004` |
| [1] 新数据通路 | `candidateEligibleAnalyses` 非空、**每条 `conditionCount > 0`**、**基准不在清单里**、第 0 条 = `#780004`、带 `why` |
| [1b] 两入口等价 | `{runId}` 与 `{questionId}` 的 `planId` / `datasetVersionId` / `moduleKeys` / `questionAlignment.source` / `candidateEligibleAnalyses` **全部一致** |
| [2] 产品真实载荷 | **不传** analysisId（载荷与页面逐字一致）⇒ 成功、`origin=AUTO`、自动落在 `#780004`、`filterRule.groups` 非空、provenance 六项齐备 |
| [2b] runId 入口 | 同样成功、`filterRule` 与 questionId 入口**逐字一致**、`provenance.complete === true`（修复前为 `false`） |
| [3] 显式传错 | 仍被拒绝，且错误信息**列出**「本 Run 可导出条件的分析：#780004 / #780005 / #780006」 |
| [4] 显式传对 | `origin=EXPLICIT`，与自动挑选导出的 `filterRule` **逐字一致**（证明只有一份分组逻辑） |
| [5] 前端纯函数 | `AUTO/EXPLICIT/NONE` 三态标签 |
| [6] 收尾 | 探针自建的 3 个验证候选已删除并回读确认为 `undefined` |

实际导出的候选条件（两条路径完全一致）：

```json
{"groups":[{"groupNo":0,"groupLogicalOperator":"AND","conditions":[
  {"groupNo":0,"sortOrder":0,"fieldName":"pullback_holds_event_low_3d",
   "operator":"==","value":1,"logicalOperator":"AND","groupLogicalOperator":"AND"}]}]}
```

修复后的错误信息（可操作，不再是死胡同）：

```
BAD_REQUEST: 分析 780001（EVENT_STUDY）没有任何条件，无法导出候选题筛选条件。
本 Run 可导出条件的分析：#780004 回踩期未破首板日最低价（T+3） → T+5 收益（1 条条件）；
#780005 回踩期未破首板日最低价 且 回踩末期收盘仍在首板日收盘之上（T+3） → T+5 收益（2 条条件）；
#780006 回踩期未破首板日最低价 且 回踩期最小量能比 ≤ 0.5（缩量）（T+3） → T+5 收益（2 条条件）
```

### 3.2 真机按钮流程（`docs/evidence/_e2e_candidate_button_real_ui.mjs`）

无头 Edge + CDP，**把用户在浏览器里真正做的那串动作从头走一遍**，最后点下那颗按钮：
打开 `/research/ask` → 选 Dataset 版本 `v2` → 填研究问题 → 设规模上限 20 →
点「开始研究」→ 等预览 → 点「执行这份计划」→ 等研究跑完 → 断言「候选筛选条件来源」区块 →
**点「创建 Candidate」** → 断言按钮变为「查看候选 #N（DRAFT）」。

**共跑 4 次真实运行**（每次都是真 tRPC + 真 TiDB + 真研究执行，零 mock）：

| # | Dataset | 结果 | 候选 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | v1（390001 / 1,130 事件） | 创建成功，**1 FAIL** | `#660001` | 唯一 FAIL 是**探针自身**的版本切换断言（见下） |
| 2 | v1 | 创建成功，**1 FAIL** | `#690001` | 同上；这次「下拉里存在 v2 选项」已 PASS |
| 3 | v1（Radix 驱动尝试） | 创建成功，**1 FAIL** | `#720001` | 同上 |
| 4 | **v2（390002 / 23,978 事件）—— 用户实际用的那个** | **`ALL PASS`（8 段断言全绿）** | **`#750001`** | 版本切换改用原生输入后，**首次全绿** |

第 4 次运行的实测原文（`docs/evidence/_e2e_candidate_button_real_ui.out.txt`）：

```
PASS  Dataset 版本已切到 v2（实得 "v22024-09-01 ~ 2026-09-0123,978 事件READY"）
PASS  进入「② 研究计划预览」（判据 = 「预计分析数」出现）
      预计分析数：20 条（核心 4 / 辅助 16 / 探索 0）· 已因规模上限裁剪
PASS  研究跑完并进入结论页
--- ⑦ 候选筛选条件来源（本次修复新增的区块）---
      创建候选时会自动使用「回踩期未破首板日开盘价（T+2） → T+5 收益」的1 条条件
      （依据：计划必需项 · P0 · 条件分析 · 1 条条件）
PASS  结论页在点按钮之前就展示了「筛选条件从哪条分析来」
--- ⑧ 点「创建 Candidate」（🔴 用户报的就是这一步）---
      toast = 已创建候选草稿 #750001筛选条件来自「回踩期未破首板日开盘价（T+2） → T+5 收益」
              （1 条，系统自动选择）。状态为 DRAFT —— 需要你人工确认后才会进入策略流程。
PASS  没有出现「创建候选失败」toast
PASS  按钮已变为「查看候选 #N（DRAFT）」
PASS  候选链接文案含 DRAFT（实得 "查看候选 #750001（DRAFT）"）
      回执：候选 #750001 的筛选条件：来自「回踩期未破首板日开盘价（T+2） → T+5 收益」1 条条件（系统自动选择）
            · 自动选择「回踩期未破首板日开盘价（T+2） → T+5 收益」的 1 条条件
              （依据：计划必需项 · P0 · 条件分析 · 1 条条件）。
PASS  候选创建后如实回显了「筛选条件来自哪条分析 / 几条条件」

ALL PASS
```

#### 探针侧踩的坑：Radix Select 在 `Runtime.evaluate` 下驱动不了

前 3 次运行唯一的 FAIL 是「Dataset 版本已切到 v2」——**探针自己的问题，不是产品的问题**
（这三次在 v1 上同样完整复现并验证了本缺陷，创建候选都成功）。排查过程：

1. 第一版按**隐藏原生 `<select>`** 驱动 ⇒ 报「找不到原生 select」。
   读 `@radix-ui/react-select@2.2` 源码：它**只在 `isFormControl`（传了 `name` prop）时**才渲染
   `SelectBubbleInput`（那个隐藏原生 select），本页两个下拉都没传 `name` ⇒ **DOM 里根本没有 select**。
2. 第二版按源码机制派发 `PointerEvent('pointerdown'|'pointerup', { pointerType: 'mouse' })` ⇒
   下拉**确实打开了**、`[role="option"]` 读得到、`aria-selected` 正确，但**选项点击始终不生效**。
   逐一把 5 种组合都实测了一遍（`docs/evidence/_probe_radix_select_drive.mjs`）：
   `pointerdown+up` / `+pointermove` / `HTMLElement.click()` / `focus+Enter` / `pointerId=0`
   —— **5 个 `✗ 未生效`**。
3. 第三版改用 **`Input.dispatchMouseEvent`（moved → pressed → released）** ⇒
   `docs/evidence/_probe_radix_select_drive_native.mjs` 实测 `✅ 下拉已打开` + `✅ 生效`。

原因：`Runtime.evaluate` 里 `dispatchEvent(new PointerEvent(...))` 造出来的是**不可信事件**
（`isTrusted === false`），React 19 的合成事件委托不按真实手势路径处理它；
而 `Input.dispatchMouseEvent` 走**浏览器真实输入管线**，Blink 会据此生成 `isTrusted: true` 的
mouse 事件**并自动派生 `pointerType: "mouse"` 的 pointer 事件**，Trigger / Item 的分支才都走对。

> 🔴 **通用教训**：凡依赖「真实用户手势」的组件（Radix / Headless UI / 自研手势层），
> `Runtime.evaluate` 里的 `dispatchEvent` 一律不可靠 —— **必须用 `Input.*` 驱动**。

### 3.3 回归

- `npx tsc --noEmit` = **exit 0**
- `docs/evidence/_probe_research_ask_page_render.mjs`（§17 真机渲染）**ALL PASS**（27 项）

---

## 4 边界与如实声明

- 本次**未**改动 `research_analysis` / `research_analysis_condition` 表结构，**零迁移**、**零新表**、
  **零新依赖**、**零新端点** —— 只改「谁来做挑选」这一件事。
- `ResearchOutcomeAnalysisStat` 的三个新字段是**如实统计**（`research_analysis_condition` 行数），
  **不参与任何统计量计算**（§21）。
- 「一条可导出条件的分析都没有」时**不报错**：候选照建，但 `filterRule` 留空且
  `filterRuleSource.origin = "NONE"` + 明确文案（前端用琥珀色警告渲染）。
  理由：静默给个空条件集才是错的；如实告知「口径是缺的」才符合 §16 的人工确认语义。
- §16 的六项 provenance 在 `runId` 入口修复后齐备，但**这不等价于**「候选可以进策略」——
  候选仍一律 `DRAFT`，**没有**任何自动 Research → Strategy 流转。
- 本次修复不改变 `RESEARCH_READY`，也不触碰 Dataset / Registry / Analysis Executor /
  Strategy Domain / Backtest。
