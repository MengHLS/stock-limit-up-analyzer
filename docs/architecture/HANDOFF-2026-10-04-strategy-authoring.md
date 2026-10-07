# 交接文档 · 策略定义页「方案化」+「退出政策拆槽」

> 时间：**2026-10-03 → 2026-10-04** · 范围：`FE-PLAN-003`（策略定义页重构）+ `FE-PLAN-004`（退出政策拆规则槽）
> 状态：**两个计划的分期全部落地**；`pnpm run check` 0 错、客户端定向测试全绿、行尾 0。
> 🔴 **接手第一件事**：见 §5「未纳入版本管理的文件」—— 有 4 个前端模块仍是 untracked。

---

## 1. 交付内容（分期一览）

### FE-PLAN-003 · 策略定义页 = 每块「方案 + 参数 + 信任状态」
| 期 | 内容 | 状态 |
|---|---|---|
| P-1 | 删除「无执行实现」的假旋钮编辑面（`risk.*` / `maxExposure` / `maxSinglePosition`），改技术细节只读；`maxPositions` 单点双写 | ✅ |
| P1 | 五块骨架（选股/出场/仓位/成本/可调参数）+ 信任层三态状态条 | ✅ |
| P4 | 交互规格收敛：去空词（更多/进阶）、≤3 项枚举摊成 radio、禁 placeholder 当标签、只标「可选」、参数格封顶 | ✅ |
| P2 | ③ 仓位 / ④ 成本与成交的**方案族**（新预设类型 `FIELD_PATCH`：payload 是草稿字段补丁，不进文档） | ✅ |
| P3 | ⑤ 改**派生视图**（候选 = ①–④ 已选方案的参数并集）+ **死参数防火墙** | ✅ |
| P5 | 本地用量计数（只写 localStorage、不发网络）；**重排默认项待数据** | ✅ / 待数据 |

### FE-PLAN-004 · 退出政策拆成 9 个规则槽
| 期 | 内容 | 状态 |
|---|---|---|
| P0 | 裁定 4 条（见 §2） | ✅ |
| P1 | 服务端 9 槽（`exitPolicySlots.ts`）：止损位置 / 止损确认 / 止损收紧 / 止损时间表 / 分批止损 / 止盈 / 到期 / 续持 / 研究路径 | ✅ |
| P2 | 前端 9 槽编辑器 + `recognizeExitPolicySlots` / `applyExitPolicySlot` 两个路由；**删掉 46 个实验（`EXIT_BASE`）的前端渲染** | ✅ |
| P3 | 删假旋钮的只读收口（`stop.contexts` / `capitalRecycle` 只在技术细节里如实标注） | ✅ |
| P4 | 信任层按槽比对 + 「还原」整份换回打开的那个版本 | ✅ |
| P5 | 紧凑化（一行一槽、参数折叠） | ✅ |
| P6 | **B 档彻底改造**：拆掉顶部方案区，四块各自的方案行挂到自己的段首 | ✅ |
| P7 | 起点行（推荐组合压成一行）+ 槽行显示当前值 + 一行人话总述 | ✅ |

---

## 2. 关键裁定（不可推翻的前提）

1. **无执行实现的字段 → 先删除编辑面**（数据 / schema / 校验全保留，技术细节只读）；账户风控默认不启用。
2. **既有高收益策略必须兼容**：任何改造都不得改变既有版本的定义内容与回测语义。
3. **每块 = 方案 + 参数**（用户提出的模型，已采纳）；一个概念只有一个编辑点（C-2）。
4. **FE-PLAN-004 走 B 档**：方案区拆解，每个任务块自带方案行（不要「方案在上、字段在下」）。
5. 「补充阈值规则」保留（与统一政策叠加）；界面段序号**不改**（段号属 schema 分段，与「五块」不同轴）。

### 实测查出的两个「假旋钮」（已从编辑面删除）
| 对象 | 证据 |
|---|---|
| `stop.contexts`（5 类市况） | 只出现在实验定义与类型声明，**全仓零求值器** ⇒ SL-26~30 改了不生效 |
| `capitalRecycle` | 46/46 未使用、**零消费**，字段与 `strongHold` 重复 |

### 46 个退出实验的真实结构（这是拆槽的依据）
- 46 个实验里 **40 个只改 1 个维度**、4 个改 2 个、**2 个与基准逐字相同（SL-00 ≡ SL-08.0）**；
- 止盈 / 到期 / 续持 / 资金循环在 46 个里**完全不变** ⇒ 那 46 个不是 46 套政策，而是 **6 个止损维度的单变量扫描**。

---

## 3. 硬约束（改这块时必须守住）

| # | 约束 | 守它的测试 |
|---|---|---|
| X-1 | `definition.exit.rules` 的形状与内容一字不变；`exitPolicyRuleEnvelope` / `applyExitPolicyRule` / `mapDeclaredExitPolicy` 不改 | golden 探针、`equivalence3570001` |
| X-2 | 46 个实验「识别 → 重新物化 → 合并」**结构化深等于**（既有版本零改写） | `exitPolicySlots.test.ts` |
| X-3 | 段 key / 锚点 / `DEFINITION_SEGMENTS` 不改（跳段与 46 例 `definitionDraft` 锁不受影响） | `definitionDraft.test.ts` |
| X-4 | 前端**不得自行拼 policy**（识别与拼装都在服务端） | IA 锁 29 |
| X-5 | 前端**不得**出现 `stop.contexts` / `capitalRecycle` 的编辑控件 | IA 锁 30 |

---

## 4. 验证状态（截至 2026-10-04）

| 项 | 结果 |
|---|---|
| `pnpm run check`（tsc） | **0 错** |
| 客户端定向（`tests/client/src/components/strategy` + `tests/client/src/pages/strategyDefinitionPageIa.test.ts`） | **150/150（12 文件）** |
| 服务端 `tests/server/research/strategyAuthoring` | 10 文件全过（含 `exitPolicySlots.test.ts` 19 例） |
| `node scripts/checkEolDrift.mjs --strict` | **0** |
| `pnpm run test:changed` | 最后一次成功：8 失败文件与基线**逐一相同**（7 个环境依赖 + `threeFactorTopNStrategyDocument`）⇒ 零新增 |

⚠️ **两处必须如实说明**
1. `test:changed` 只在 FE-PLAN-003 P3/P5 那一轮跑过；**之后几轮（B 档、紧凑化、起点行/总述/取值）都没跑** ⇒ 不能声称这些轮次「零新增失败」。
2. **真实 DOM 从未实测**：本会话从头到尾 headless Edge 都起不来（dev server 正常、二进制存在、无残留进程，换端口一律 `ECONNREFUSED`）⇒ 一切观感结论都由「纯函数测试 + 源码级结构锁 + tsc」承载。

---

## 5. 未纳入版本管理的文件（先处理这个）

### 🔴 仍是 untracked（`??`）—— 4 个前端新模块
- `client/src/components/strategy/ExitPolicySlotEditor.tsx`
- `client/src/components/strategy/definitionFieldPatch.ts`
- `client/src/components/strategy/searchParameterCandidates.ts`
- `client/src/components/strategy/authoringUsageLog.ts`

### 已在索引里（`git ls-files` 可查，因此 `git status` 不再列成 untracked）
- `docs/product/FE-PLAN-003-strategy-definition-restructure.md` · `docs/product/FE-PLAN-004-exit-policy-restructure.md`
- `server/research/strategyAuthoring/**`（含 `exitPolicySlots.ts`）· `tests/server/research/strategyAuthoring/**`
- `tests/client/src/pages/strategyDefinitionPageIa.test.ts` 等新测试
> ⚠️ 本仓有**并发会话**（`AGENTS.md` 明确警告）。索引里出现这些文件**未必是你 add 的** ⇒ 提交前请自己核一遍索引内容。

---

## 6. 未做 / 已知缺口

| # | 缺口 | 说明 |
|---|---|---|
| G-1 | **真实浏览器验收** | 9 槽折叠、起点行、总述、槽行取值、变体明细 —— 全部只有结构锁 / 类名断言，没有肉眼确认 |
| G-2 | **`test:changed` 未跟到最新** | 见 §4 |
| G-3 | **⑤ 参数搜索的能力边界** | 预设参数（`anchor.stopRatio` / `slippageBps` …）住在 policy / 文档级配置里、**不在规则图里** ⇒ 直接声明 TUNABLE 就是生产死参数（参数搜索会以 `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 拒绝）。现在候选一律标 `referenced`，未引用**不可勾选**；要让它真可搜，需补「参数引用 → policy 字段」的映射 —— **属新执行语义，按 `AGENTS.md` §5 必须停下等裁定** |
| G-4 | **P5 重排默认项** | 需要 ≥2 周真实数据 + 产品决策，不是代码能替代的 |
| G-5 | 信任层「还原」不区分方向 | 一键同时还原预设参数与整份退出政策 |
| G-6 | `EXIT_POLICY` 整包的参数调整入口没了 | 起点行只选整包；要调参数就逐槽调（设计上认为这就是对的，但请确认） |

---

## 7. 建议下一步（按优先级）

1. **收口**：`git add` 那 4 个 untracked 模块 + 跑一次 `pnpm run test:changed`，把「零新增失败」补成事实。
2. **真实浏览器验收**：重点看 —— ① 起点行能否不选推荐组合直接用；② 槽行 `6%` 这类取值是否好读；③ 顶部总述够不够用；④ 段④ 里那条「类型=止损、阈值空」的怪行与红字是否已消失。
3. **裁定 G-3**：是否投入做「参数引用 → policy 字段」（解锁 ③④ 参数真正可搜的最后一公里）。
4. G-4（等数据）/ G-5 / G-6 按需。

---

## 8. 关键文件地图（便于接手）

| 文件 | 作用 |
|---|---|
| `server/research/strategyAuthoring/exitPolicySlots.ts` | **退出政策 9 槽的唯一定义**：槽表 / 方案 / 参数 / 合并 / 物化 / 识别 |
| `server/research/strategyAuthoring/{presetRegistry,vocabulary,materialize,router}.ts` | 预设注册表、词表下发（含 `exitPolicySlots` 与 `exitPolicyBasePolicy`）、物化、tRPC 路由 |
| `client/src/components/strategy/ExitPolicySlotEditor.tsx` | 9 槽编辑器（一行一槽 + 参数折叠 + 起点行 + 一行总述 + 只读技术细节） |
| `client/src/components/strategy/DefinitionFields.tsx` | 7 段表单；**四个段首各渲染自己的方案行**（`presetBlocks`）；段④ = 出场唯一场地 |
| `client/src/pages/StrategyDetail.tsx` | 接线：预设选择 / 槽识别与改槽 / 信任层基准与差异 / 起点行 handler |
| `client/src/components/strategy/definitionDraft.ts` | 草稿↔定义往返与校验（含「统一政策行豁免缺阈值」） |
| `docs/product/FE-PLAN-003-*.md` · `FE-PLAN-004-*.md` | 两份方案与本轮全部裁定 / 实施记录 |
| `docs/architecture/CHANGE-AUDIT.md` | 每条改动的审计条目（按任务号检索：`STRATEGY-DEFINITION-*` / `EXIT-POLICY-SLOTS-*`） |
| `scripts/_scratch/_probe_exit_*.mts` · `_probe_slot_roundtrip.mts` | 本次全部数字的可复现探针（46 个实验的维度统计 / 往返深等于） |

---

## 9. 一句话给接手人

> 出场这块的核心变化是：**把「几十个方案」还原成 9 个正交规则槽**（因为实测 46 个实验里 40 个只差 1 个维度），
> 并且**只留一个编辑场地**；所有既有版本的 `exit.rules` 一字未动，改动全在「怎么显示 / 怎么编辑」。
> 唯一真正的功能取舍是：**执行层没实现的字段（`stop.contexts` / `capitalRecycle`）不再提供编辑面**。
