# stock-limit-up-analyzer 硬禁令索引

> 细则见 `.workbuddy/memory/PROJECT_RULES.md`（动手前必读）。

## 三门
1. 先读 `PROJECT_RULES.md`「启动与本机环境」。
2. 🔴 改 `server/**` 会热重启、**杀死在途 Run** ⇒ 用户在用页面时禁改 server、禁跑重库脚本；先查在途（`_probe_inflight_state.mts`）。
3. 🔴 禁 `pnpm/npm install`、新增依赖、`prettier --write`、`db:push`/`drizzle-kit generate`、手写 `_journal.json`。

## 环境
- 🔴 端口**只认启动日志打的**：本机 **3000 在 Windows 保留段 `2980–3079`**（`listen` 报 `EACCES` 非忙）⇒ dev 静默回落 3100/3101；错端口 = 全站不可达。**读输出须 Bash + 长 PATH**。
- 🔴 **行尾必须逐文件实测**（`b.count(b"\r\n")` vs `b.count(b"\n")`）—— **禁按「除某几文件外都是 LF」推断**：已实测 `ROADMAP.md`、`ROADMAP-CHANGELOG.md`、`drizzle/schema.ts`、**`client/src/**/*.tsx`（`SentimentAnalysis.tsx` 302/302）** 均**纯 CRLF**（工作区 = git `autocrlf` 后的形态，HEAD blob 是 LF）；`.workbuddy/memory/*.md` 与逐日日志**纯 LF**。改法 = `splitlines(keepends=True)` + **写前写后各断言「CRLF 行数 == 总行数」**。
- 🔴 改总控用 Python **`read_bytes()`+`write_bytes()`**（`read_text` **静默把 CRLF 转 LF**）；🔴 **`Edit` 曾静默不生效** ⇒ 改完**回读**。
- 🔴 **落盘必须「先编码后打开」+ 原子替换**（`cleanup_root_scratch.py` 血的教训）：`io.open(p, "wb")` **先截断**，若随后的 `encode()` 抛错 ⇒ 文件被清成 **0 B**。正确写法 = `data = text.encode("utf-8")` → 写 `p + ".tmp-write"` → `os.replace(tmp, p)`。
- 🔴 **源码字面量里禁 `\uXXXX` 代理转义**：Python **不合并**分离代理对（`"\ud83d\udd34"` = 两个孤立代理码位，**不是** emoji）⇒ `compile()` 直接抛 `UnicodeEncodeError: surrogates not allowed`，**脚本在任何语句执行前就死**（stdout 0 B、连 traceback 都打不出）。**emoji 一律写字面量**；⚠️ **文件字节探测查不出这类问题**（磁盘上就是纯 ASCII 的 `\u` 文本），须 `compile()` 后遍历 `co_consts`。
- 🔴 **`git checkout -- <path>` 不能用来「恢复工作区行尾」**：本项目 `core.autocrlf=true` ⇒ 检出的是 **CRLF** 形态；而 `docs/evidence/README.md` 的 blob 与目标工作区形态都是 **LF**（该文件由脚本以 LF 直写，工作区形态比 blob 形态「更真」）⇒ 直接检出会引入 N 处 `\r`、`git diff` 表现为**整文件重写**。恢复内容请用 `git cat-file -p <rev>:<path>`（**不过 smudge 过滤器**）。
- 🔴 **改 `.tsx` / 总控都走「行数组手术 + 断言」，禁手抄超长行**：锚点**必须是连续行块**（首行 + 尾行拼接会得到**非子串** ⇒ `str.count` 为 0，而两端各自都能命中 —— 就是这个症状）；删 JSX 块时**闭合 `)}` / `</div>` 极易连坐**（与待删块常只隔一个空行）⇒ 删完**必回读 + `git diff --stat` 断言增删数**，错了 `git checkout -- <file>` 复位重跑（改前先 `git status --short -- <file>` 确认那次 `M` 就是自己）。
- 🔴 **前端真实渲染可进验收路径**（旧「禁浏览器截图」条已作废，细则见 `PROJECT_RULES.md`「前端」段）：Edge `--headless=new --no-proxy-server --user-data-dir=<tmp> --remote-debugging-port=N --window-size=W,H <url>` + Node 22 内置全局 `WebSocket` 直连 CDP，**量 DOM 计数 / `innerText` 比截图硬**；`agent-browser` 仍不可用、仓库无 `jsdom`。另一层验收 = 真实 tRPC + **真机 dev server 取模块** + 真库。
- 🔴 探针 = `docs/evidence/`（不进 tsc/vitest）；项目根执行；长跑后台 + 重定向日志；🔴 **清理判据绑「可识别命名域」、不绑 `runId`**。
- ⚠️ 测试 = `tests/`；**基线 = 7 文件失败**，判据是**失败文件集合**。

## 总控
- `ROADMAP.md` 唯一 Master Control（§44 覆盖式 + §44.5 + 附录 append-only）；**仅 `RESEARCH_READY=TRUE` 才允许策略结论**；改用**带断言的脚本**。
- 🔴 禁同批次并发多 Edit ⇒ 唯一锚点 + 单次 Edit，写后 grep 断言标记。
- 🔴 **§44.5 编号按「下一个未占用」（已用到 `9ao`），禁「末条 +1」**；§44「上轮实查：」**每轮都保留** ⇒ **只插入**，条目**单行**。

## 坐标与根因
- Dataset 坐标 = `dataset_version.id`；Strategy SoT = `strategy_versions.strategyDocumentJson`；**零 FK**。
- Research→Strategy 桥 = `strategyCandidate/`；**`promote` 是唯一 `CONVERTED` 入口**。
- 🔴 **「条件进不了回测」是架构性的**：`assemble.ts` 不看 `entryRules`（只看 `recipeId`）⇒ 正路 = `recipeRegistry.ts` 注册配方 + 草稿带 `recipeId`。

## 运行工作台 / 留档 / 成交明细
- 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）。✅ **已能撮合、回落不再常态**：投影 `rd=0`（特征基准）+ `rd ∈ [1, obs.end+1]`（观察日 + 次日执行日），🔴 **决策日资格 = `rd ∈ [obs.start, obs.end]`**；窗口**只认策略声明**（不猜 / 不夹取，缺/非法/超 post 容量一律抛错）。
- 🔴 直读桥 `securityId` = canonical **`sec_<uuid>`**（`engineKeyBridge#resolveSecurityIdByEngineKey` **逐事件按自身 `tradeDate`** 桥接，处理 code reuse），`code` 才是代码 —— `ds_*` 只有 `symbol`；**板块判定一律用 `row.code`**。
- 🔴 **回落重建必须继承数据集 universe 约束**（`boards`/`excludeSt`）：错用 `UniverseConstraintError`（**非** `RegistryDatasetBridgeError`，否则被吞 ⇒ 静默全市场）；前端 `classifyRebuildScope`=`unknown` 提示重跑。
- ✅ `loopRun` 每次**自动留档**到 `closed_loop_backtest_run`（best-effort 不阻断；`runId` 幂等），页 `/backtest-runs`。🔴 与 legacy `backtest_runs` **不同表、禁互灌**；**列表不读 `resultJson`**。
- 🔴 策略页结果**只在 React 内存** ⇒ 重载即丢；现已**从留档恢复该策略最近一次**（复用同一 VM + 面板），优先级「本次 > 恢复 > 明说 > 空态」；**空态禁谎称「还没跑过」**。
- 🔴 `loopRun`：`dateRange` 必填；窗口 ⊆ 数据集窗口；`experimentId` 须 `EXP-YYYYMMDD-XXXXXXXX`；**14 阶段仅 6 有执行器**；**同步长请求**。
- 🔴 成交明细键 = **`sec_<uuid>`（非代码）** ⇒ 名称走 `researchRun.securityLabels`（覆盖 62.9%、缺口显「—」）；解析**必用 `normalizeSecurityCode`**。

## 前向纸面交易（`/paper-trading`）
- 🔴 推进（含回测）交易日历**唯一来源 = `index_daily`**（与候选价格行**刻意解耦**），而它**只有手动 `scripts/backfillIndex.ts` 写入、全仓无自动同步** ⇒ 停更即 **`datesToAdvance` 恒空 ⇒ 静默 no-op 却报成功**。补数**必须 `--force`**（`isCoverageFresh` 容忍末端差 ≤ 30 天 ⇒ 默认误判「已覆盖」）；复核 `index_daily` 末端 == 行情末端。
- 🔴 三态诊断 `paperTrading.ts#classifyAdvanceKind`：`advanced` / `already-latest` / `calendar-stale` —— **参照物必须是行情末端**（`marketLastDate > calendarLastDate`）。建运行**越界锚点**（`signalDate > calendarLastDate`）抛 `PaperTradingCalendarStaleError`，码**须写进 message** 才跨 tRPC 边界；前端按 `diagnosis` **分流 toast**，禁一律报成功。

## 页面与口径（→ 细则）
- 策略页分家 `/strategies` + `/strategies/:strategyId`；**新建草稿须清空 `strategyId`**。
- 🔴 规则编辑 = 「策略定义」七段表单；**JSON 模式已删**。有 `definition` 时**禁回送五个 v1 视图**（否则 `SCHEMA_DEFINITION_VIEW_CONFLICT`）。
- 🔴 **运算符两形**：定义侧**名称形**（`GREATER_THAN_OR_EQUAL`）vs 草图**符号形**（`>=`），只在 `definitionBuild.ts#CONDITION_OPERATOR_MAP` 译。
- 🔴 换数据集**同动三处**：doc 级坐标 + `definition.datasets` PRIMARY 绑定 + `universe.universeId`。
- 🔴 **门槛型条件必须 `gated` 配方**；`signalBuilder` 是工厂 ⇒ **先 `resolveParameters`**；**禁手搓 `row.bars`**。
- 🔴 `client/**` 禁 import `server/**`/`shared/**` **运行时值** ⇒ 镜像词表用「本地常量 + 表比对测试」。免责声明不得删；`RESEARCH_READY` 不因「结果可看」变 TRUE。
- 🔴 性能只认「**交错 ≥3 轮取中位**」；「**热调用 ≈0ms**」才是缓存判据。「**全端点 DB 失败 + 零 DB 端点正常**」⇒ **先查池**。真实列名**禁凭记忆**写 SQL。
