# stock-limit-up-analyzer 长期约定（硬禁令索引）

> 只留「不知道就会做错」的硬禁令；**细则全在 `PROJECT_RULES.md`，动手前先读对应章节**。证据 → `ROADMAP.md` §44（覆盖式）/§44.5 + `ROADMAP-CHANGELOG.md`（**即原 §47，2026-09-13 独立成文**）；逐日 → `memory/YYYY-MM-DD.md`。

## 动手前三条
1. 先读 `PROJECT_RULES.md`（「启动与本机环境」含 Bash 所需长 PATH）。
2. 🔴 **改任何 `server/**` 会热重启并杀死在途研究 Run**（永久卡 `RUNNING`、无恢复入口）⇒ 用户在用页面时禁改 server 文件、禁跑重型真实库脚本。
3. 🔴 禁 `pnpm/npm install`（SIGTERM）、新增依赖、`prettier --write`、`db:push`/`drizzle-kit generate`、手写 `_journal.json`（属伪造）。

## 环境速查
- `pnpm run dev`；端口取 `.env` `PORT`（本机 3000；8000~9000 为 Windows 保留段）。
- 读输出用 Bash（PowerShell 只回退出码）；Bash 必须前置长 PATH → `PROJECT_RULES.md:64`。
- **`ROADMAP.md` / `ROADMAP-CHANGELOG.md` 用 Read/Grep，禁 `sed`/`head`/`cut`**；🔴 **本机无 `agent-browser`** ⇒ 前端验收**禁写「浏览器截图」**，改用真实 tRPC 取数 + 纯函数复用 + 真实 DB。
- 🔴 时间戳：库内 = UTC 墙钟，`executionLogJson` 内 = ISO 带 Z（差 8h）⇒ 写传字符串字面量，读用 `DATE_FORMAT(...)`。
- 🔴 **证据簇坐标 = `docs/evidence/`**（2026-09-13 起，85 个 `_*` 探针与运行结果由根目录整体归位，根目录文件数 131→20）：**历史文档/日志里出现的裸 `_xxx` 文件名一律指向该目录**（`ROADMAP-CHANGELOG.md` / `.workbuddy/memory/**` 属 append-only ⇒ 历史条目零改写，映射见 `docs/evidence/README.md`）；该目录**不进 `tsc` / vitest**；重跑须在**项目根目录** `npx tsx docs/evidence/<name>`。**禁把新探针再写回根目录。**

## 总控（强制）
- `ROADMAP.md` 唯一 Master Control：§44 覆盖式 + §44.5 队列 + §47 append-only（**§47 正文在 `ROADMAP-CHANGELOG.md`**）；每任务完成必须更新三者。
- 7 态 `DESIGN/CODE_READY/DATA_READY/VALIDATED/RESEARCH_READY/PRODUCTION_READY/BLOCKED`；**只有 `RESEARCH_READY=TRUE` 才允许策略结论**。
- ⚠️ 同一文件禁同批次并发多 Edit；仓库常有并行会话 ⇒ 唯一锚点 + 单次 Edit。
- 命名（§49）：模块/文件/目录禁带 STEP 编号或数字后缀；先查重。

## 铁律（细则见 PROJECT_RULES.md）
- 优先级（正确性 > 数据真实性 > PIT > 架构 > 测试 > 速度）；**禁 mock 冒充真实数据**。
- 🔴 **Dataset 唯一坐标 = `datasetVersionId = dataset_version.id`** ⇒ 禁第二套 ID、禁绕 Registry 直读 `ds_*`。
- 🔴 **Strategy 唯一 SoT = `strategy_versions.strategyDocumentJson`**；5 投影单向派生、禁反向生成、漂移不自动修复。
- 🔴 涨停价**四舍五入到分** + 比例 PIT 感知（ST=5%）；窗口左边界必须预热。
- 🔴 **零 FK**（完整性靠应用层 + 事务）；**Migration**：`drizzle/schema.ts` → 手写 SQL → 幂等 apply + `information_schema` 断言；**声明 ≠ 线上真实，必须查真实库**。
- 🔴 **Research → Strategy 桥**：唯一桥目录 `server/research/strategyCandidate/`；`promote` 是唯一 `CONVERTED` 入口（入参只有 `{candidateId, overrides?}`，**禁提交完整 StrategyDefinition**）；`cloneVersion`/Backtest 等**仍不存在**。
- 🔴 **Research 分析层硬边界**：无四段配置对象/无编码列/无多视界矩阵/无二维交叉；`CONDITIONAL` 不产 P25/P75；**一 Run 只一条结论**。
- 🔴 **分析口径与桶纪律**（细则 `RESEARCH-010-implementation.md` §十 + `RESEARCH-007.1`）：`segment_return_{a}_{b}d = close(T+b)/close(T+a) − 1`（**锚定日收盘建仓**、**raw 未复权**）；`390002` **未启用回踩筛选** ⇒ 样本 = 全部首板事件（23,978）；桶须写明开闭 + 「加总 = 全集」闭环（**双闭会让平盘入桶**）；**附送的 `MAX_DRAWDOWN` 行不要读**；滚动资格 `min(low[T+1..T+d]) >= open(T)` 现有模型表达不了（最小扩展 = `EVENT_LOW_GUARD_BASES` 加 `"open"`）。
- ✅ **结果「矩阵视图」**（RESEARCH-007.2 · 纯 `client/**`）：结果页签默认矩阵；**归组靠 `name`（T+d + 桶）+ `target`（权威）**，决策日须一致 ⇒ **改名会让分析脱离矩阵**；不产生新统计量、显著性基准是「全样本」。
- ✅ **候选草图 = 结构化表单**（RESEARCH-006.4.1-C · 纯 `client/**`，2026-09-13）：五块（`entryRule`/`filterRule`/`exitRule`/`riskRule`/`parameterSpace`）**禁退回 JSON 文本框**；草稿三态 `empty|structured|raw`，**表达不了 ⇒ 整块降级只读 `raw` 且 `raw` 永不进补丁**（只有显式「清空」才提交 `null`）；类别名一律取自 `candidateSketchVocabulary.ts`（**服务端词表的手工镜像**，由 `candidateSketchForm.test.ts` **对表测试**锁定 ⇒ 后端词表一变测试先红）；🔴 补丁比较**必须双侧规范化**（`canonicalSketchJson` + `sketchValuesEqual`），拿字面值直接比会把 `extra: {}` / 键序差异误判成改动（用户什么都没改却真写一次库，**完全静默**）；客户端**不能** import 服务端运行时值 ⇒ 该模式是唯一可行解。
- ✅ **候选草图界面 = 六段决策顺序**（RESEARCH-006.4.1-C.2 · 纯 `client/**`，2026-09-13 01:40）：界面**六段**（买什么 → 什么价买 → 怎么卖 → 买多少·最多持几只 → 成本与资金 → 参数搜索空间），**段 ≠ 存储块**；🔴 **`entryRule` 一块同时承载第 ①②④⑤ 段** ⇒ 该块整块降级 `raw` 会**同时影响四段**，`raw` 原文靠 `SKETCH_BLOCK_HOME_SEGMENT` **只在归属段展示一次**（其余段给一句指路，不重复贴 JSON）；🔴 **`exitRule` 不是转正必填** —— `definitionValidation` 只校验 `exit.rules`「是数组」、全文无「至少一条」约束 ⇒ **禁止再产出「出场规则至少一条」类缺口**（写必填性前必须去校验器里数，不可从字段名反推）；缺口**单一建模** = `SketchValidation.gapDetails` 为源、`gaps` 只是它的标签投影（不得两套说法）；成本预设 `candidateSketchCostPreset.ts` **只覆盖七项费率+每手股数、绝不动 `maxPositions`**，且**只有用户显式点「套用」才写入**（预设 ≠ 隐式默认值；「Promote 不补默认值」约束的是转换器、不是界面）；`SKETCH_SEGMENT_REQUIRED` 单列成表以获**穷尽性检查**（新增段漏写必填性会编译失败）。
- ✅ **「买入条件」正名与归位 + 条件行去抽象化**（RESEARCH-006.4.1-C.3 · 纯 `client/**`，2026-09-13 01:50）：🔴 **`filterRule` 的唯一去向是 `entry.conditions`（`definitionBuild.ts:506-508`）=「全部满足才产生买入信号」** ⇒ 它**是「买入条件」、不是「剔除条件」**（`SKETCH_BLOCK_LABELS.filterRule = "买入条件"`），**归属段是 `when`（什么价买）、不是 `what`**（`SKETCH_BLOCK_HOME_SEGMENT.filterRule = "when"`）—— **禁止再把它标成「剔除」或折叠进「买什么」段**（会让用户把方向写反、去写 `NOT_IN` 才买）；条件行**禁退回裸字段引用输入框**（用「部位 + 相对日 + 字段」三格选择器 + 人话预览 + 小字回显原始引用；不可解析的既有值退回自由文本且**绝不重建** —— 防静默丢数据）；买入条件模板 `CANDIDATE_CONDITION_PRESETS` 前两条**逐字取自后端 golden sample** `FIRST_BOARD_PULLBACK_DEFINITION`（`bar.low >= prefix.rd0.open` / `bar.volume < prefix.rd0.volume`）⇒ **禁自己编口径**；`SketchValidation.warnings` 是**第三个通道**（既非 `errors` 也非 `gaps`：能过但结果会变，**不阻断保存 / 不阻断转正**）；⚠️ **两层运算符表示**：表单与 `ResearchConditionSet` 用**符号**（`>=`），`StrategyDefinition.entry.conditions` 用**长名**（`GREATER_THAN_OR_EQUAL`），靠 `CONDITION_OPERATOR_MAP` 对齐（探针两层各断言一次）；⚠️ `entryRule.extra.position.maxSinglePosition` 与 `riskRule.maxPositionWeight` **不能同时声明**（转换器报「重复声明同一事实，只能二选一」）。
- ✅ **缺口必须「说清差哪一项」**（RESEARCH-006.4.1-C.4 · 纯 `client/**`，2026-09-13 02:05）：三通道不变（`errors` 阻保存 / `gaps` 转正必填未填**不阻保存** / `warnings` 能过但结果变）；🔴 **`SketchGap` 增 `anchors`（机器可读落点），与 `label` 在同一 `gap(...)` 调用点配对** ⇒ 物理上不可能「清单说 A、高亮落在 B」；`SketchSegmentStatus.gaps` 是本段切片；界面落点判据**唯一** = `missingAt(segment, anchor)` 只读 `statuses[].gaps[].anchors` —— 🔴 **禁再另立一张必填表**（必漂移）；🔴 **缺口清单必须显示在编辑器里**（此前只在只读卡片 `CandidateSketchCard` 列出 ⇒ 用户「永远还差一箱」却看不到落点）；🔴 词表选项若「**选了必然被转正拒掉**」，用 `SketchOption.disabled` **置灰 + 写明服务端错误码 + 配自失效测试**，**禁从词表删除**（对表测试是漂移哨兵，删掉会掩盖服务端矛盾）；🔴 写字段语义说明前**先去权威实现读它怎么算**（`NEXT_TRADING_DAY` = 条件满足后**再顺延一个交易日**，不是「信号在 T+1」）。
- ⚠️ 既有测试失败基线（环境依赖，**禁为过测试改快照/期望**）：7 文件 15 例，清单见 `PROJECT_RULES.md:137`。
- ⚠️ **编号会撞车**：`RESEARCH-006/007/008` 已被占用 ⇒ 架构线 `.0/.1/…`；分析线 `009/010/007.1/007.2`。

## 已知地雷（未修 · 登记在案）
- 🔴 **连接池 `maxIdle === connectionLimit` ⇒ `idleTimeout: 60_000` 是死配置**（2026-09-13 实查；证据见 `2026-09-13.md`）：mysql2 仅在 `maxIdle < connectionLimit` 才启动空闲回收，`getConnection()` 直 pop 无存活探测 ⇒ 死连接原样发出 → `read ECONNRESET` → Drizzle `Failed query: …`。症状 = Strategy Editor「保存失败」（`saveVersion` 事务内校验读，无 `withReadRetry`）。区分「瞬时 vs 数据问题」：裸 SQL / live server 同路径复测。修法：① `maxIdle < connectionLimit`；② 只读路径复用 `withReadRetry`；🔴 须单独排期（改 `server/**` 杀在途 Run）。
- 🔴 **`ENTRY_TIMING_TO_EXECUTION.SAME_CLOSE` 自相矛盾**（2026-09-13 02:05 实查登记；`definitionBuild.ts:87-96` vs `definitionValidation.ts:705-722`）：该值映射成 `signalTiming=T_CLOSE` + `executionTiming=T_CLOSE`，被 **L6 直接拒绝**（`SIGNAL_EXECUTION_TIMING_CONFLICT`）⇒ 词表里存在「**选了就必然在转正时失败**」的选项（前端此前把它当正常选项列出）。**临时处理**：前端已置灰（`SketchOption.disabled`）+ 写明 L6 码与替代项 + 自失效测试。**修法** = 二选一：① 从 `ENTRY_TIMING_TO_EXECUTION` 删掉该键（但前端对表哨兵会先红，须同步）；② 或让 L6 接受「同 bar 收盘信号 + 收盘成交」（须先论证该口径是否真实可交易）。🔴 须单独排期（改 `server/**` 杀在途 Run）。
- 🔴 **`OR` / `NOT` 在转正时被静默压成 AND**（2026-09-13 实查登记；`definitionBuild.ts#buildConditions`）：它把所有条件组**扁平化**进 `ConditionDefinition[]`，而该结构（`definition.ts:408-419`）**没有逻辑运算符字段** ⇒ `entry.conditions` 实际是**全部 AND**；草稿写「或」**不报错、不留痕迹，策略却被改成另一个意思**（真实转换器取证：OR 版与 AND 版产出的 conditions **逐字节相同**）。前端已加 `warnings` 通道（不阻断保存 / 转正）。**修法** = 给 `ConditionDefinition` 加逻辑位（或改成嵌套组）；🔴 须单独排期（改 `server/**` 杀在途 Run）。
- 🔴 **`ConditionDefinition.value` 无算术 ⇒「相对事件日回撤 X%」表达不了**（2026-09-13 实查登记）：`valueType` 只有 `CONSTANT` / `FIELD_REFERENCE` / `PARAMETER_REFERENCE`、**没有算式** ⇒ `prefix.rd0.close * (1 − 0.05)` 写不出来；界面已如实说明并给替代路径（用首板日的开/高/低/收做**价格锚点**，或把幅度**做成参数**），**禁提供必然被转正拒掉的选项**。**最小扩展** = 加「条件右值表达式」或一个派生字段（如 `bar.drawdownFromEventClose`）；🔴 须单独排期。
