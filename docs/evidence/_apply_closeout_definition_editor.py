# -*- coding: utf-8 -*-
"""本轮收尾写入器：ROADMAP.md（§44 覆盖式 + §44.5 队列）+ ROADMAP-CHANGELOG.md（append-only）+ 逐日日志（append-only）。

纪律（PROJECT_RULES / README）：
  - `ROADMAP.md` 是**纯 CRLF**（2593 行）⇒ 必须 `splitlines(keepends=True)`，写前写后断言 CRLF 行数 == 总行数。
  - `ROADMAP-CHANGELOG.md` 与逐日日志是**纯 LF**（append-only）⇒ 断言 0 个 CRLF。
  - `ROADMAP.md` §44「最后实查」区是**覆盖式**：新条目插到最新一条之前（最新在上）。
  - `ROADMAP.md` §44.5 队列是**追加**：插到末条之后（不是文件末尾 —— 它后面还有 §48+）。
  - 每处写入都带**锚点命中数 == 1** 与前/后置断言，任一不满足即 exit 1，绝不静默 no-op。
"""
import re
import sys

ROADMAP = "ROADMAP.md"
CHANGELOG = "ROADMAP-CHANGELOG.md"
DAILY = ".workbuddy/memory/2026-09-13.md"

# ---------------------------------------------------------------------------
# §44 条目（覆盖式区，最新在上）
# ---------------------------------------------------------------------------

ENTRY = (
    "> **【策略规则编辑器：定义七段表单取代 JSON 高级模式（与研究草图对齐） · 2026-09-13 22:53 GMT+8 · 状态 CODE_READY】** "
    "触发 = 用户「**我不需要Json高级模式，其次这个地方的各种规则理应跟研究实验中的策略候选中的草图应该对齐**」（落点 = 策略详情页 `/strategies/:strategyId` 的「策略定义」页签）。"
    "**一、把诉求拆成两件可验收的事**：① 删掉 JSON 高级模式（它一度是规则编辑的**唯一**入口）；② 规则编辑的形态与研究实验 → 策略候选的「草图」对齐。"
    "**二、🔴 「对齐」不做成「看起来像」，而是**共用同一个壳**：新增 `client/src/components/common/SegmentForm.tsx`（470 行，段表单原语 "
    "`Field` / `Section` / `Advanced` / `EnumSelect` / `NumInput` / `KeyValueRows` / `SegmentShell` / `SegmentGapCapsules`），"
    "把原本长在 `CandidateSketchFields.tsx` 里的**纯展示层**上移为公共层，再把草图迁过去（**1590 → 1278 行，删 312 行**，"
    "行级手术由带 **13 处断言的** `docs/evidence/_migrate_sketch_primitives.py` 执行；后续小改至 1298 行）。"
    "⇒ 两个编辑器不再各写一套长得很像的表单壳（那是**必然漂移**的结构），各自只剩「词表 + 段定义 + 校验」。"
    "**三、新增 `client/src/components/strategy/DefinitionFields.tsx`（1516 行）**：七段 = 买什么 / 什么条件买 / 什么时候买 / 怎么卖 / 买多少 · 最多持几只 / 成本与资金 / 参数搜索空间，"
    "**与研究草图同序、同标题、同必填性**（由测试锁住）。"
    "**四、🔴 本轮抓到并修掉一个「凭记忆必错」的真 bug = 条件运算符的两种拼写**：Canonical `definition.entry.conditions[].operator` 存的是**服务端名称形**"
    "（`GREATER_THAN_OR_EQUAL` / `LESS_THAN` / `LESS_THAN_OR_EQUAL`），而草图的 `filterRule.operator` 是**符号形**（`>=` / `<`），"
    "两者只在**转正时**由 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 翻译。我最初直接复用草图的符号表 ⇒ **用户一改运算符就会写出后端不认的值**。"
    "证据：真实库 `docs/evidence/_probe_strategy_definition_shape.json` 的 `conditionSample[0].operator === \"GREATER_THAN_OR_EQUAL\"`，`goldenSample.ts` 同为名称形。"
    "修法：`definitionVocabulary.ts`（248 行）自建**名称形**表 + 新增 `SYMBOL_TO_OPERATOR_NAME` / `symbolToDefinitionOperator()`；`emptyConditionRow()` 默认值改 `GREATER_THAN_OR_EQUAL`；"
    "`describeConditionRow` 改用 `definitionOperatorSymbol()`（**符号只用于显示，绝不写回文档**）；`addConditionPreset()` 在翻译失败时 `toast.error` 且**不插入**那行必错的行。"
    "**五、保存路径修正（这才是「改了却存不下」的真因）**：🔴 `definition` 存在时**不能回送五个 v1 视图**（`entryRules` / `exitRules` / `riskRules` / `positionSizing` / `parameters`）"
    "—— `map.ts#alignDefinitionViews` 的 `fillOrCheck` 规则是「缺则补、**冲突则响亮报 `SCHEMA_DEFINITION_VIEW_CONFLICT`**」。"
    "① `strategyAdapter.ts` 新增 `viewModelToStrategy(vm, { definition, executionAssumptions })`：给了 `definition` 就**删掉五个派生视图键**"
    "（与 `patchToInput`(STRATEGY-004) / `cloneStrategyDocument` **同纪律**）；② 新增 `syncPrimaryDatasetBinding()`：`基础信息` 换数据集坐标时联动 `definition.datasets` 的 PRIMARY 绑定，"
    "且**同时**作用于「提交的文档」与「渲染的草稿」⇒ 显示与提交不可能不一致。"
    "**六、实证（四层验收 + 真实库探针，全部只读）**：新增 `docs/evidence/_probe_definition_editor_save.mts`（真实 TiDB，**10/10 全绿**）—— "
    "① `definition` 逐字往返 **8/8 YES**；② 成本 / 回测配置往返 **8/8 YES**；③ `executionModel` 按纪律省略后**组装层派生结果与原值相等 8/8**（证明「不送」**无损**，不是丢字段）；"
    "④ **新路径组装 8/8 通过**；⑤ 🔴 **旧路径（v1 视图 + 改过的 definition 同送）8/8 全部 `SCHEMA_DEFINITION_VIEW_CONFLICT`** ⇒ **反证适配器改动是必需的**；"
    "⑥ 编辑器对 8 份真实文档的校验输出 **errors / warnings / gaps 全 0**（打开即干净，不产生幻影报错）；"
    "⑦ 只改 doc 级坐标 **8/8 报 `SCHEMA_DEFINITION_DATASET_VERSION_MISMATCH`**、同步绑定行后 8/8 通过 ⇒ 数据集的坐标同步确实堵住了那个「用户看不出原因」的坑；"
    "⑧ 无 definition 的历史文档 `limit-up-baseline@1.1.0` **如实降级只读**且原样保存仍通过（**不编造定义**）。"
    "**七、顺手修掉两个真缺陷（都是写测试时被自己测出来的）**：① 🔴 `draftsToDefinition` 对 `event.params` / `trigger.params` 原本**无条件** `delete` —— "
    "当参数含表单表达不了的值（数组 / 嵌套对象）时会**把整块原始 params 抹掉**，而界面那一区写的正是「只读，保存时会**原样保留（不会丢键）**」⇒ **说明与行为相反**、丢的还是用户看不见的数据；"
    "已改为**仅在可表达时才覆盖**（`risk.extensions` 一直有这个判断，这两处漏了）。② `StrategyDetail` 的校验失败 toast 原指向「详情见《策略定义 → JSON 高级模式》」—— 而该模式本轮正被移除（**指向一个即将不存在的入口**）；已改为指向页签顶部的红色清单。"
    "**八、验收**：`npx tsc --noEmit` **exit 0**；`npx vitest run tests/client` **24 文件 / 582 例全通过**（新增 2 文件 / 54 例：`definitionDraft.test.ts` 46 例 + `definitionVocabulary.test.ts` 8 例）；"
    "全量 `npx vitest run` = **237 文件 / 3,949 例通过 / 16 例失败**，失败**文件集合**逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**；"
    "`npx vite build` **exit 0**（3,027 模块 / 16.94 s）。"
    "**九、边界与遗留**：**纯 `client/**` + `tests/**` + `docs/evidence/**`**；`server/**` **一行未改**（硬约束：`tsx watch` 下改 `server/**` 会热重启并杀掉在途研究 Run）；零迁移、零新端点、零新依赖；"
    "**无浏览器截图**（本机 `agent-browser` 不可用、仓库无 `jsdom`），前端验收口径 = 真实 tRPC 取数 + 纯函数复用 + 真实 DB。"
    "⚠️ **诚实登记**：`limit-up-baseline` 等**无 definition** 的版本目前仍**没有**真正的规则编辑能力（只有 v1 视图只读编辑器，`LegacyDefinitionNotice` 已说明「为什么不能替它编一份定义」——"
    "幻影必填缺口 + 立即触发视图冲突 + 坐标不匹配）；**给它补 definition 需单独立项**（走候选转正链路生成，或做一次性迁移）。"
)

# ---------------------------------------------------------------------------
# §44.5 队列条目（追加到末条之后）
# ---------------------------------------------------------------------------

QUEUE = (
    "   - **9ai. （策略线）策略规则编辑器：定义七段表单取代 JSON 高级模式（与研究草图对齐）** "
    "✅ **已完成（2026-09-13 22:53 GMT+8，CODE_READY）**：触发 = 用户「**我不需要Json高级模式，其次这个地方的各种规则理应跟研究实验中的策略候选中的草图应该对齐**」。"
    "**做法**：① 抽出 `client/src/components/common/SegmentForm.tsx`（段表单公共壳）并把草图迁过去（1590 → 1278 行，删 312 行）⇒ 「对齐」= **共用同一个壳**，不是长得像；"
    "② 新增 `DefinitionFields.tsx` 七段（同序 / 同标题 / 同必填性，测试锁住）；③ 🔴 修掉运算符**两形混淆**的真 bug（定义侧存**名称形** `GREATER_THAN_OR_EQUAL`，草图侧是**符号形** `>=`，"
    "只在转正时由 `CONDITION_OPERATOR_MAP` 翻译）⇒ 否则用户一改运算符就写出后端不认的值；④ 保存路径改为**只送 definition、删掉五个 v1 视图**（否则 `SCHEMA_DEFINITION_VIEW_CONFLICT`）+ "
    "`syncPrimaryDatasetBinding()` 联动数据集 PRIMARY 绑定。**实证（真实库探针 10/10）**：往返 8/8 逐字、新路径组装 8/8 通过、**旧路径 8/8 全 `SCHEMA_DEFINITION_VIEW_CONFLICT`**、"
    "真实文档校验输出 errors/warnings/gaps 全 0。**验收**：`tsc` exit 0；`tests/client` **24 文件 / 582 例**全通过；全量 **237 文件 / 16 例失败 = 既有基线零新增**；`vite build` exit 0。"
    "**边界**：`server/**` 一行未改、零迁移、零新端点、零新依赖。**遗留**：无 definition 的历史版本仍无规则编辑能力（需单独立项）。"
)

# ---------------------------------------------------------------------------
# ROADMAP-CHANGELOG.md 条目（append-only）
# ---------------------------------------------------------------------------

CHANGELOG_ENTRY = """
---

## 2026-09-13 22:53 GMT+8 — 策略规则编辑器：定义七段表单取代 JSON 高级模式，并与研究实验的「候选草图」对齐（纯 `client/**` + `tests/**`，CODE_READY）

用户指令：「**我不需要Json高级模式，其次这个地方的各种规则理应跟研究实验中的策略候选中的草图应该对齐**」。落点 = 策略详情页 `/strategies/:strategyId` 的「策略定义」页签。

### 一、把诉求拆成两件可验收的事

| # | 诉求 | 验收判据 |
| --- | --- | --- |
| 1 | 删掉 JSON 高级模式 | 入口、状态、组件、导出一并消失，且**不存在指向它的文案** |
| 2 | 规则编辑与研究草图对齐 | 段顺序 / 标题 / 必填性**由测试锁住**；表单壳**同一份实现**，不是两份长得像的 |

### 二、🔴 「对齐」做成「共用同一个壳」，而不是「看起来像」

- 新增 `client/src/components/common/SegmentForm.tsx`（470 行）：`Field` / `Section` / `Advanced` / `EnumSelect` / `NumInput` / `KeyValueRows` / `SegmentShell` / `SegmentGapCapsules`。
- 原先把这套原语写在 `CandidateSketchFields.tsx` 里；现上移为公共层，草图迁过去 —— **1590 → 1278 行，删 312 行**（行级手术由带 **13 处行锚点断言**的 `docs/evidence/_migrate_sketch_primitives.py` 执行，写前断言 3 个必须保留 / 4 个必须消失的 token；后续小改至 1298 行）。
- ⚠️ 抽出的只有**纯展示层**：段定义、词表、校验各自留在自己的域里 —— 那才是两边**必须不同**的部分。
- 迁移期踩到 3 个类型错误并当场修掉：`segmentDomId` 未随迁；`hint` 在两边一个可选一个必填（已把 `SegmentStatusLike.hint` 声明为**可选**并写明理由）；`SegmentGapCapsules` 的 `onFocus` 键联合被拓宽成 `string`（已改为泛型 `SegmentGapCapsules<S extends SegmentStatusLike>`，保住调用方的键类型）。

### 三、新增 `DefinitionFields.tsx`（1516 行）：七段与研究草图**同序 / 同标题 / 同必填性**

买什么 → 什么条件买 → 什么时候买 → 怎么卖 → 买多少 · 最多持几只 → 成本与资金 → 参数搜索空间。

- 同一套壳、同一套「缺口胶囊 + 琥珀必填标记 + 折叠高级项」习惯。
- `hint` **刻意不锁**：草图说的是「留空 = 出现事件就买」，定义侧说的是「留空 = 产生买入信号」—— 强行对齐会让其中一边说错话。
- 唯一的**刻意差异**（写进了文件头）：定义侧的每行是**字段级 patch**（带 `original`），因此没有任何一块需要降级成只读。

### 四、🔴 抓到并修掉一个「凭记忆必错」的真 bug：条件运算符的两种拼写

| 侧 | 存的值 | 例子 |
| --- | --- | --- |
| Canonical `definition.entry.conditions[].operator` | **服务端名称形** | `GREATER_THAN_OR_EQUAL` / `LESS_THAN` / `LESS_THAN_OR_EQUAL` |
| 草图的 `filterRule.operator` | **符号形** | `>=` / `<` / `<=` |

两者只在**转正时**由 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 翻译。我最初直接复用了草图的符号表 ⇒ **用户一改运算符就会写出后端不认的值**。

- 证据（真实库，非推断）：`docs/evidence/_probe_strategy_definition_shape.json` 的 `conditionSample[0].operator === "GREATER_THAN_OR_EQUAL"`；`goldenSample.ts` 同为名称形。
- 修法：`definitionVocabulary.ts`（248 行）自建**名称形**表；新增 `SYMBOL_TO_OPERATOR_NAME` / `symbolToDefinitionOperator()`；`emptyConditionRow()` 默认值改 `GREATER_THAN_OR_EQUAL`；`describeConditionRow` 改用 `definitionOperatorSymbol()`（**符号只用于显示，绝不写回文档**）；`addConditionPreset()` 翻译失败即 `toast.error` 且**不插入**那行必错的行。
- 防漂移：`tests/client/src/components/strategy/definitionVocabulary.test.ts`（8 例）**逐字对表** —— 17 张镜像词表的值集必须等于服务端枚举；并断言「定义侧不得出现符号形、草图侧不得出现名称形」。
  ⚠️ 该断言第一版写错了：`IN` / `NOT_IN` **两种形态就是同一个字符串**（它们没有符号写法）⇒ 无条件遍历会得到一个**永远为假**的断言。已收窄为「**真正发生改写的六个**」（按翻译表 `key !== value` 判定）与「草图值集里没有的名称形」。

### 五、保存路径修正（这才是「改了却存不下」的真因）

- 🔴 `definition` 存在时**不能回送五个 v1 视图**（`entryRules` / `exitRules` / `riskRules` / `positionSizing` / `parameters`）：`map.ts#alignDefinitionViews` 的 `fillOrCheck` 规则是「缺则补、**冲突则响亮报 `SCHEMA_DEFINITION_VIEW_CONFLICT`**」。
- `strategyAdapter.ts` 新增 `viewModelToStrategy(vm, { definition, executionAssumptions })`：给了 `definition` 就**删掉五个派生视图键**（与 `patchToInput`(STRATEGY-004) / `cloneStrategyDocument`**同纪律**）。
- 新增 `syncPrimaryDatasetBinding()`：`基础信息` 换数据集坐标时联动 `definition.datasets` 的 PRIMARY 绑定（把坐标写进 `datasetVersionId` / `datasetVersion` **以及 `original`** —— `original` 才是重建时被放回的东西）；**同时**作用于提交文档与渲染草稿 ⇒ **显示与提交不可能不一致**。
- `executionModel` **故意不送**：`alignDefinitionViews:188-198` 写明它是**派生视图**（不送则由组装层从 `definition.execution` 时序对派生；送了且不符报 `..._EXECUTION_MODEL_MISMATCH`）。这一条不靠推理认定，而是**组装后回看**（见下 ③）。

### 六、实证：四层验收 + 真实库探针（`_probe_definition_editor_save.mts`，**10/10 全绿**，全程只读）

| # | 断言 | 结果 |
| --- | --- | --- |
| ① | `definition` 逐字往返（真实库 8 份有 definition 的策略） | **8/8 YES** |
| ② | 成本 / 回测配置往返 | **8/8 YES** |
| ③ | 省略 `executionModel` 后**组装层派生结果 == 库里原值** | **8/8 YES** ⇒ 「不送」**无损**，不是丢字段 |
| ④ | 新路径组装（只送 definition + 同步过坐标） | **8/8 通过** |
| ⑤ | 🔴 旧路径（v1 视图 + 改过的 definition 同送） | **8/8 全 `SCHEMA_DEFINITION_VIEW_CONFLICT`** ⇒ **反证适配器改动是必需的** |
| ⑥ | 编辑器对 8 份真实文档的校验输出 | **errors / warnings / gaps 全 0**（打开即干净） |
| ⑦ | 只改 doc 级坐标 / 再同步绑定行 | **8/8 报 `..._DATASET_VERSION_MISMATCH` / 同步后 8/8 通过** |
| ⑧ | 无 definition 的历史文档 `limit-up-baseline@1.1.0` | **如实降级只读**，原样保存仍通过（**不编造定义**） |

⚠️ 探针第一版把 ⑦ 的「三处联动」漏了一处：换数据集还要同步 `universe.universeId`（= `research-dataset:<datasetVersion>`），否则报 `SCHEMA_UNIVERSE_DATASET_MISMATCH`。已核对 `StrategyBasicInfo.tsx` 选版本时**确实**会同步 `universeId`，故这属**探针遗漏**而非产品缺陷；探针已补「三处齐」对照实验并改为断言该路径通过。

### 七、顺手修掉两个真缺陷（都是写测试时被自己测出来的）

- 🔴 `definitionDraft.ts#draftsToDefinition` 对 `event.params` / `trigger.params` 原本**无条件** `delete`：当参数含表单表达不了的值（数组 / 嵌套对象）时会把**整块原始 params 抹掉**，而界面那一区写的正是「只读，保存时会**原样保留（不会丢键）**」⇒ **说明与行为相反**，且丢的是用户看不见的数据。已改为**仅在可表达时才覆盖**（`risk.extensions` 一直有这个判断，这两处漏了）。
- `StrategyDetail` 的校验失败 toast 原指向「详情见《策略定义 → JSON 高级模式》」—— 而该模式本轮正被移除（**指向一个即将不存在的入口**）。已改为指向页签顶部的红色清单。

### 八、`tests/client/src/components/strategy/definitionDraft.test.ts`（46 例）锁住了什么

段 key 顺序 / 标题逐字 / 必填性（对 `SKETCH_SEGMENTS` + `SKETCH_SEGMENT_REQUIRED`）· golden sample 往返深等于 + 往返幂等 · 非表单键（`id` / `description` / `unit` / `note`）不丢 · 8 种形状不符 ⇒ **整份降级 `raw`** 且原因说得出是哪一处 · 13 个缺口锚点**闭集** + 「校验器实跑产出的每条 gap 都能查到锚点」· **扫源码证明每个锚点都有真实输入框接住**（`missingAt("段","锚点")` 必须出现）· L6 / L7 · 出场优先级唯一 · threshold-or-parameter · TIME_EXIT 整数 / 比例区间 · TUNABLE min-max · DERIVED `derivedFrom` · 前视引用与 `path.*` 标签层 · `syncPrimaryDatasetBinding` 的镜像 / 纯函数 / 幂等 · 新模块**不得**非 type 导入 `server/**`。

### 九、验收与边界

- `npx tsc --noEmit` **exit 0**。
- `npx vitest run tests/client` **24 文件 / 582 例全通过**（新增 2 文件 / 54 例）。
- 全量 `npx vitest run` = **237 文件 / 3,949 例通过 / 16 例失败**，失败**文件集合**逐项 = 既有基线（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零新增失败**。
- `npx vite build` **exit 0**（3,027 模块 / 16.94 s）。
- **纯 `client/**` + `tests/**` + `docs/evidence/**`**；`server/**` **一行未改**（硬约束：`tsx watch` 下改 `server/**` 会热重启并杀掉在途研究 Run）；零迁移、零新端点、零新依赖。
- ⚠️ 本机 `agent-browser` 不可用、仓库无 `jsdom` ⇒ **无浏览器截图**；前端验收口径恒为「真实 tRPC 取数 + 纯函数复用 + 真实 DB」。
- ⚠️ **诚实登记**：`limit-up-baseline` 等**无 definition** 的版本目前仍**没有**真正的规则编辑能力（只有 v1 视图只读编辑器 + `LegacyDefinitionNotice` 说明为什么不能替它编一份定义）⇒ **给它补 definition 需单独立项**。
- 登记：§44.5 新编号取 **`9ai`**（按「下一个未占用」判定，非「末条 +1」；`9ae` 错位、`9v` 重复的历史问题未动）。
- 新增探针（`docs/evidence/`，不进 `tsc` / vitest）：`_probe_definition_editor_save.mts`（保存路径对照实验）、`_migrate_sketch_primitives.py`（带断言的迁移器）、`_apply_closeout_definition_editor.py`（三文档收尾写入器）。
"""

# ---------------------------------------------------------------------------
# 逐日日志（append-only）
# ---------------------------------------------------------------------------

DAILY_ENTRY = """
---

## 22:53 —— 策略规则编辑器：定义七段表单取代 JSON 高级模式（与研究草图对齐）

用户指令：「**我不需要Json高级模式，其次这个地方的各种规则理应跟研究实验中的策略候选中的草图应该对齐**」。
落点 = `/strategies/:strategyId` 的「策略定义」页签。**纯 `client/**` + `tests/**` + `docs/evidence/**`，`server/**` 一行未改。**

### 做了什么

- 新增 `client/src/components/common/SegmentForm.tsx`（470 行）= 段表单**公共壳**（`Field` / `Section` / `Advanced` / `EnumSelect` / `NumInput` / `KeyValueRows` / `SegmentShell` / `SegmentGapCapsules`）。
- 把草图 `CandidateSketchFields.tsx` 迁到该壳上：**1590 → 1278 行（删 312 行）**，用 `docs/evidence/_migrate_sketch_primitives.py`（13 处行锚点断言）做手术。
- 新增 `client/src/components/strategy/DefinitionFields.tsx`（1516 行）七段：买什么 / 什么条件买 / 什么时候买 / 怎么卖 / 买多少 · 最多持几只 / 成本与资金 / 参数搜索空间 —— **与草图同序 / 同标题 / 同必填性**（`hint` 刻意不锁）。
- 删 `StrategyJsonEditor.tsx`（201 行）+ 其 barrel 导出 + `jsonText` 状态 + 切换开关。
- `strategyAdapter.ts#viewModelToStrategy(vm, { definition, executionAssumptions })`：给了 `definition` 就**删掉五个 v1 视图键**（与 `patchToInput` 同纪律）。
- 新增 `syncPrimaryDatasetBinding()`：数据集坐标联动 PRIMARY 绑定，且**显示与提交共用同一份草稿**。

### 新增测试

- `tests/client/src/components/strategy/definitionVocabulary.test.ts`（8 例）：17 张镜像词表**逐字对表** + 运算符两形不得互串。
- `tests/client/src/components/strategy/definitionDraft.test.ts`（46 例）：段对齐 / 往返 / 降级 / 锚点 / 校验口径 / 坐标镜像 / 跨端边界。

### 🔴 本轮抓到的真 bug（都是「凭记忆必错」型）

- **条件运算符两形混淆**：Canonical 存**名称形**（`GREATER_THAN_OR_EQUAL`），草图存**符号形**（`>=`），只在转正时翻译（`CONDITION_OPERATOR_MAP`）。我最初直接复用草图的符号表 ⇒ **用户一改运算符就写出后端不认的值**。证据：真实库 `conditionSample[0].operator === "GREATER_THAN_OR_EQUAL"`、`goldenSample.ts` 同为名称形。
- **`event.params` / `trigger.params` 被无条件 `delete`**：参数含表达不了的值（数组 / 嵌套对象）时会把**整块原始 params 抹掉**，而界面那一区写的正是「保存时会**原样保留（不会丢键）**」⇒ 说明与行为相反。`risk.extensions` 一直有 `expressible` 判断，这两处漏了。**这条是我写测试 11 时被测出来的**。
- **被移除的模式仍被文案指向**：校验失败 toast 还说「详情见《策略定义 → JSON 高级模式》」。

### 实证（真实 TiDB 探针 `docs/evidence/_probe_definition_editor_save.mts`，10/10 全绿，零写入）

- `definition` 逐字往返 **8/8**；成本 / 回测配置往返 **8/8**；`executionModel` **省略后组装层派生结果 == 库中原值 8/8**（证明「不送」无损）。
- **新路径组装 8/8 通过**；**旧路径（视图 + 改过的 definition 同送）8/8 全 `SCHEMA_DEFINITION_VIEW_CONFLICT`** ⇒ 反证适配器改动必需。
- 8 份真实文档在编辑器里 **errors / warnings / gaps 全 0**（打开即干净，无幻影报错）。
- 只改 doc 级坐标 8/8 报 `..._DATASET_VERSION_MISMATCH`；同步绑定行后 8/8 通过。
- 无 definition 的 `limit-up-baseline@1.1.0` **如实降级只读**、原样保存仍通过（不编造定义）。

### 验收

- `npx tsc --noEmit` **exit 0**；`npx vitest run tests/client` **24 文件 / 582 例全通过**。
- 全量 `npx vitest run` = **237 文件 / 3,949 例通过 / 16 例失败**，失败**文件集合**逐项 = 既有基线（7 文件）⇒ **零新增失败**。
- `npx vite build` **exit 0**（3,027 模块 / 16.94 s）。

### 可复用的坑

- 🔴 **「跨端词表镜像」最容易死在「同一个概念两种拼写」上**：镜像前必须先在**真实数据**里确认存的是哪一形（否则 UI 与后端各说各话且**本地不报错**）。判据 = 探针读真实库 + golden sample 双向印证。
- 🔴 **`.workbuddy/memory` 里的日志与 `ROADMAP*.md` 行尾不同**：`ROADMAP.md` 纯 CRLF（2593 行）⇒ `splitlines(keepends=True)` + 写前后断言；`ROADMAP-CHANGELOG.md`（1617 行）与逐日日志**纯 LF** ⇒ 断言 0 个 CRLF。**不能一套写法打天下。**
- 🔴 **「有 definition 就不能回送 v1 视图」是保存成败的开关**：`fillOrCheck` 是「冲突即响亮报错」，所以旧口径下**改一处 definition 就必然存不下**（真实库 8/8 复现）。
- 🔴 **测试断言本身也会写错**：本轮 `IN` / `NOT_IN` 两形同名，导致一条**永远为假**的断言 —— 断言失败时先怀疑断言。
- **§44.5 编号取 `9ai`**（按「下一个未占用」判定；`9ae` 错位、`9v` 重复的历史问题未动）。
"""


def read_lines(path):
    raw = open(path, "rb").read()
    return raw.decode("utf-8"), raw.decode("utf-8").splitlines(keepends=True)


def assert_all_crlf(lines, tag):
    total = len(lines)
    crlf = sum(1 for l in lines if l.endswith("\r\n"))
    lf_only = sum(1 for l in lines if l.endswith("\n") and not l.endswith("\r\n"))
    assert crlf == total, "%s: 期望纯 CRLF，实际 CRLF=%d / 总=%d" % (tag, crlf, total)
    assert lf_only == 0, "%s: 出现纯 LF 行 %d" % (tag, lf_only)
    return total, crlf


def assert_no_crlf(lines, tag):
    total = len(lines)
    crlf = sum(1 for l in lines if l.endswith("\r\n"))
    assert crlf == 0, "%s: 期望纯 LF，实际 CRLF=%d" % (tag, crlf)
    return total


def assert_count(haystack, needle, expected, tag):
    n = haystack.count(needle)
    assert n == expected, "%s: 期望命中 %d 次，实际 %d 次" % (tag, expected, n)


# ---------------------------------------------------------------------------
# 1) ROADMAP.md：§44 覆盖式 + §44.5 队列
# ---------------------------------------------------------------------------

text, lines = read_lines(ROADMAP)
before_total, _ = assert_all_crlf(lines, "ROADMAP 写前")

# 锚点 A：§44 最新一条（22:35）。新条目插到它**前面**（最新在上）。
ANCHOR_A = "**【运行策略「前端什么都没有」根因修复 + 策略产出可视化 · 2026-09-13 22:35 GMT+8"
aidx = [i for i, l in enumerate(lines) if ANCHOR_A in l]
assert len(aidx) == 1, "锚点 A 命中数 != 1: %r" % aidx

# 锚点 B：§44.5 队列末条 9ai 的前一条 9ah。
bidx = [i for i, l in enumerate(lines) if re.match(r"\s+- \*\*9ah\.", l)]
assert len(bidx) == 1, "锚点 B 命中数 != 1: %r" % bidx
# 断言 9ai 尚未被占用（防重复编号）。
assert not any(re.match(r"\s+- \*\*9ai\.", l) for l in lines), "9ai 已被占用，须改用下一个未占用的编号"

# 先插 B（下标更大），避免 A 的插入影响 B 的位置。
lines.insert(bidx[0] + 1, QUEUE + "\r\n")
lines.insert(aidx[0], ENTRY + "\r\n")
lines.insert(aidx[0] + 1, ">\r\n")

after_total, _ = assert_all_crlf(lines, "ROADMAP 写后")
new_text = "".join(lines)
assert_count(new_text, "定义七段表单取代 JSON 高级模式", 2, "ROADMAP 新条目出现次数（§44 + §44.5）")
assert_count(new_text, "\n   - **9ai.", 1, "ROADMAP 队列 9ai")
assert_count(new_text, "- **9ah.", 1, "ROADMAP 队列 9ah 仍在")
assert_count(new_text, ANCHOR_A, 1, "锚点 A 原标记仍在")
assert_count(new_text, "**【龙头候选页加载提速 · 2026-09-13 17:14 GMT+8", 1, "旧条目仍在")

open(ROADMAP, "wb").write(new_text.encode("utf-8"))
print("OK ROADMAP：%d -> %d 行（纯 CRLF 保持）" % (before_total, after_total))

# ---------------------------------------------------------------------------
# 2) ROADMAP-CHANGELOG.md：append-only
# ---------------------------------------------------------------------------

c_text, c_lines = read_lines(CHANGELOG)
c_before = assert_no_crlf(c_lines, "CHANGELOG 写前")
assert c_text.endswith("\n"), "CHANGELOG 末尾应以换行结束"
TAIL_MARK = "新编号取 **`9ah`**"
assert_count(c_text, TAIL_MARK, 1, "CHANGELOG 旧末条标记")

c_new = c_text + CHANGELOG_ENTRY
open(CHANGELOG, "wb").write(c_new.encode("utf-8"))

c2 = open(CHANGELOG, "rb").read().decode("utf-8")
c2_lines = c2.splitlines(keepends=True)
c_after = assert_no_crlf(c2_lines, "CHANGELOG 写后")
assert_count(c2, TAIL_MARK, 1, "CHANGELOG 旧末条标记（写后仍在）")
assert_count(c2, "## 2026-09-13 22:53 GMT+8 — 策略规则编辑器", 1, "CHANGELOG 新条目")
assert c_after > c_before, "CHANGELOG 未增长"
print("OK CHANGELOG：%d -> %d 行（纯 LF 保持）" % (c_before, c_after))

# ---------------------------------------------------------------------------
# 3) 逐日日志：append-only
# ---------------------------------------------------------------------------

d_text, d_lines = read_lines(DAILY)
d_before = assert_no_crlf(d_lines, "日志 写前")
D_TAIL = "本轮取 `9ah`" if "本轮取 `9ah`" in d_text else d_text.strip().splitlines()[-1][:40]
assert_count(d_text, D_TAIL, 1, "日志旧末条标记")

open(DAILY, "wb").write((d_text + DAILY_ENTRY).encode("utf-8"))

d2 = open(DAILY, "rb").read().decode("utf-8")
d2_lines = d2.splitlines(keepends=True)
d_after = assert_no_crlf(d2_lines, "日志 写后")
assert_count(d2, D_TAIL, 1, "日志旧末条标记（写后仍在）")
assert_count(d2, "## 22:53 —— 策略规则编辑器", 1, "日志新条目")
assert d_after > d_before, "日志未增长"
print("OK 逐日日志：%d -> %d 行（纯 LF 保持）" % (d_before, d_after))

print("ALL DONE")
sys.exit(0)
