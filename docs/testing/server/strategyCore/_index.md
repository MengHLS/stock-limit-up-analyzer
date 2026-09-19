<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/strategyCore

- 测试文件 **11** 个 ｜ 用例声明 **163** 个
- 涉及源码目录：`server/data/` · `server/research/` · `server/research/framework/` · `server/research/strategySchema/` · `server/strategyCore/` · `server/strategyCore/production/` · `shared/` · `tests/server/strategyCore/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/strategyCore                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/strategyCore/definitionFingerprintCache.test.ts`
- 122 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/definitionFingerprintCache.test.ts`
- 用例树：
- **PARAMETER-001-PRE · P0 定义指纹缓存 —— 产物逐字节不变**
  - ① 同一定义重复求值：指纹稳定，且等于不缓存的唯一实现
  - ② explanation 里的 12 位指纹前缀未被改动（用户可见文案零漂移）
  - ③ 内容相同但对象不同的定义 ⇒ 指纹相同（缓存键是对象身份，不改变取值）
  - ④ 行为面不同的定义 ⇒ 指纹必须不同（缓存不得跨定义串味）
  - ⑤ 同一定义不同参数 ⇒ 定义指纹相同（参数不属于定义指纹面），但行为可变

### `tests/server/strategyCore/feature.test.ts`
- 195 行 ｜ 用例声明 16 ｜ describe 3
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_graphHarness.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/feature.test.ts`
- 用例树：
- **§23.4 Feature — Registry**
  - 注册 / 查找 / 列举（列举稳定排序）
  - 重复 featureId ⇒ 响亮拒绝（后者不静默覆盖前者）
  - 版本不一致 ⇒ FEATURE_VERSION_MISMATCH（不静默用别的版本）
  - 未注册 ⇒ FEATURE_NOT_REGISTERED
  - availability 声明缺省（lookback < 1 / 空 featureId）被拒
- **§23.4 Feature — availability / leakage 声明**
  - usesForwardData=true（未来结果类）禁止注册
  - dataThroughRelativeDay > 0（需要未来数据）禁止注册
  - 声明面完整可得（availableAtPoint / dataThroughRelativeDay 都是相对当前 bar 的，不是远古常量）
- **§23.4 Feature — lookback 与计算**
  - SMA：lookback 不足 ⇒ 返回 null（不臆造）
  - SMA / EMA / RSI / ATR 的 lookback 与取值范围
  - RSI：全涨 ⇒ 100（边界可辨）
  - 事件相对特征用**显式事件日 bar**（修掉 legacy「假定 bars[0] 是首板日」的限制）
  - 事件日 bar 缺失 ⇒ 全部事件相对特征返回 null（不臆造基准）
  - pctChange 需要 preClose；缺失 ⇒ null
  - 默认注册表：内置指标 + 事件相对特征 + pctChange 全部就位，且是惰性单例
  - 新增特征不需要改 Core 代码（数据驱动可扩展）—— 注册一个全新特征即可被 resolve

### `tests/server/strategyCore/leakage.test.ts`
- 230 行 ｜ 用例声明 15 ｜ describe 2
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/leakage.test.ts`
- 用例树：
- **§23.5 Leakage — 静态审计（图结构层）**
  - path.* / outcome.*（前视标签层）一律拒绝
  - prefix.rd{n}（n > 0）虽形态像「前缀」，但值是未来 ⇒ 拒绝
  - post.rd{n} 超出「最早可引用偏移」⇒ 拒绝
  - 无 WINDOW 的纯条件策略：静态层不设 A4 界（不误杀），交由运行时判定
  - 未知时间域（未知根 / 未知字段）⇒ 默认拒绝
  - 特征声明：future outcome / 需要未来数据 / 时点矛盾 全部被抓
  - 决策时点为 open + 特征声明 close 可得 ⇒ 由 executionSemantics 推出并拒绝
  - 干净的定义：静态审计零发现
- **§23.5 Leakage — 运行时关卡（evaluate(T) 不得读 T+1 / T+2 / future outcome）**
  - 在 T+1 决策却引用 post.rd2 ⇒ 抛 LEAKAGE_LOOK_AHEAD（不是静默 null）
  - 引用 T+2 的未来结果列（outcome.*）同样被拦
  - 同一图在 T+3 决策时可正常读到 post.rd2（T+2 已成为历史）
  - LeakageGuard.assertNoViolations：非空即抛；空数组通过
  - LeakageGuard.assertFieldReadable：在 rd=1 读 post.rd2 抛错；读 prefix.rd0 通过；path.* 抛错
  - LeakageGuard.assertFeatureUsable：open 决策点不可用 close 特征
  - 「未注入事件判定器」与「当日无事件」被区分开（不静默返回 false）

### `tests/server/strategyCore/parameter.test.ts`
- 314 行 ｜ 用例声明 18 ｜ describe 2
- 被测源码：`server/strategyCore/index.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/parameter.test.ts`
- 用例树：
- **§23.3 Parameter — FIXED / TUNABLE / DERIVED**
  - FIXED 用 defaultValue，TUNABLE 可覆写，DERIVED 由表达式求值
  - DERIVED 随被依赖参数变化（依赖链真的生效）
  - DERIVED 多级依赖按拓扑序解析
  - 缺少 defaultValue 且无覆写 ⇒ 抛 PARAMETER_MISSING_DEFAULT（不静默取 0）
  - 未知参数键 ⇒ 抛 PARAMETER_UNKNOWN（不静默忽略）
  - 类型 / 范围 / 枚举 / nullable 校验全部生效
  - TUNABLE 的约束规则：数值必须给 min/max；字符串必须给 allowedValues；boolean 不允许 TUNABLE
  - DERIVED 不允许调用方直接赋值（抛 PARAMETER_DERIVED_OVERRIDE_FORBIDDEN）
  - DERIVED 缺少表达式 / 非 DERIVED 声明 derivedFrom 都被拒
  - 循环依赖：detectParameterCycles 直接给出环，resolveParameters 响亮拒绝
  - 依赖图：只有 DERIVED 有出边
  - validateParameterSchema 报出重复 code / 引用未声明参数
  - 只有 TUNABLE 参数可被 Parameter Search 搜索（唯一权威；不按 min/max 猜）
  - 解析结果键序稳定（指纹/复现依赖这一点）
- **§23.3 Parameter — 文本表达式解析（legacy derivedFrom 兼容）**
  - 可解析 算术 / 括号 / 一元负号 / 常量
  - 除零 ⇒ 抛 EXPRESSION_DIVISION_BY_ZERO（不返回 Infinity）
  - 不支持函数调用 / 属性访问 ⇒ 抛 PARAMETER_DERIVED_UNPARSEABLE（不猜）
  - 空表达式 / 括号不匹配 / 末尾多余记号都被拒

### `tests/server/strategyCore/production/barWindowAndEvent.test.ts`
- 192 行 ｜ 用例声明 14 ｜ describe 2
- 被测源码：`server/data/index.ts` · `server/strategyCore/index.ts` · `server/strategyCore/production/index.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/production/barWindowAndEvent.test.ts`
- 用例树：
- **barWindow — 锚定策略与相对日**
  - 默认锚定 = SERIES_START，且 relativeDay 恒为序列下标（0 = 事件日）
  - 空序列 ⇒ 空窗口（不是「相对日 0 的一根假 bar」）
  - 未登记的锚定策略 ⇒ 响亮抛错（不猜口径）
  - 说明文案里如实登记了「窗口左边界未预热会偏」这条边界
  - 能力声明如实：1D / OHLCV / 不编造 eventCount
- **eventSource — 事件判定器（生产注入）**
  - 锚定日是涨停（close ≥ preClose×1.1）⇒ 事件发生
  - 锚定日未涨停 ⇒ 明确「未发生」（false，且与「无法判定」分开计数）
  - 锚定 bar 缺 preClose ⇒ 记「无法判定」并返回 false（与 legacy 基准缺失即剔除一致）
  - 文档未声明 limitUpRatio ⇒ 不做涨停校验（不替它猜 10%）
  - 未声明的事件类型 ⇒ 响亮抛错（不静默 false）
  - 窗口里没有 rd 0 ⇒ 响亮抛错（锚定不成立）
  - 非事件窗数据集 ⇒ 构造即拒（不是静默不判定）
  - 事件类型闭集为空 ⇒ 构造即拒
  - limitUpRatio 非法 ⇒ 构造即拒

### `tests/server/strategyCore/production/coreDecision.test.ts`
- 396 行 ｜ 用例声明 15 ｜ describe 5
- 被测源码：`server/data/index.ts` · `server/strategyCore/index.ts` · `server/strategyCore/production/index.ts` · `server/research/framework/gatedSignal.ts` · `server/research/recipeRegistryAtoms.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/production/coreDecision.test.ts`
- 用例树：
- **Test A — 正常运行：evaluate / Decision / Digest 三件齐备**
  - rd2（首个全门槛成立日）出信号；rd1 / rd3 不出（FIRST_VALID_DAY 语义）
  - 事件不成立（锚定日不涨停）⇒ 一条信号都不出，且判定可辨（notOccurred≠undecidable）
  - 无 bar ⇒ 计「数据不足」而不是「今天没信号」（可辨）
  - 排序特征缺失 ⇒ 有信号但不出（计入 droppedMissingRankValue，不与「无信号」混淆）
  - 未注入事件判定器 ⇒ 首次求值即响亮抛错（不静默 false）
- **Test B/C/D/E — 指纹与快照的稳定性（行为面）**
  - Test B：同版本 + 同参数 + 同数据 ⇒ 定义指纹与决策摘要指纹都逐字节相同
  - Test C：改策略定义（窗口 end 5→6 之外的行为面）⇒ 定义指纹改变
  - Test C2：改定义后「哪些日出信号」也真的变了（指纹变化对应行为变化，不是纯哈希抖动）
  - Test D：只改**行为参数** ⇒ 定义指纹不变（参数是运行级坐标），但参数本身可辨
  - Test E：只改非行为元数据（name）⇒ 指纹不变
- **Test F — 复现：同一份配置重跑 ⇒ 决策摘要逐字节相同**
  - 重跑（含重新构造版本对象）⇒ decisionDigestFingerprint 相等
  - 由定义变更产生新版本（applyDefinitionChange）⇒ 旧版本对象本身不变（不可变可断言）
- **§15 — Legacy vs Core 同日对比（**差异必须被定位**，不是抹平）**
  - 两侧的**首个有效日**一致（Core 的 FIRST_VALID_DAY 就是 legacy 的第一个满足日）
  - 差异形状被钉死：legacy 逐日出信号 [2,3]，Core 只在首个有效日出 [2]
- **StrategyRuntime 仍为唯一执行入口（接线不改 Core 契约）**
  - 决策源内部走 StrategyRuntime.evaluate（用 evaluateWithDetail 的产物字段佐证）

### `tests/server/strategyCore/production/runRecord.test.ts`
- 239 行 ｜ 用例声明 9 ｜ describe 3
- 被测源码：`server/data/index.ts` · `server/strategyCore/index.ts` · `server/strategyCore/production/index.ts` · `shared/researchContracts.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/production/runRecord.test.ts`
- 用例树：
- **Run Record — 组装与自洽**
  - 快照坐标齐备：定义指纹 / 引擎版本 / 代码版本 / 数据集坐标 / 解析后参数
  - 空 engineVersion / codeVersion ⇒ 响亮抛错（拒绝不可复现的留档）
  - 解析后参数与快照重算不一致 ⇒ 响亮抛错（防「复现出来是另一个策略」）
- **Run Record — 快照指纹与复现（Test B / F）**
  - Test B：同版本 + 同参数 + 同数据集坐标 + 同配置 ⇒ 快照指纹相同（runId / createdAt 不进指纹）
  - Test B2：参数变了 ⇒ 快照指纹改变（运行级行为确实不同）
  - Test F：verify → replay 全程通过，且复现出的参数集与快照逐键相等
  - Test F2：定义被换掉（模拟「同一版本号但定义改了」）⇒ 复现被拒
- **Run Record — 落库形状（进既有 resultJson，零 schema 变更）**
  - Run Record 本身能通过共享契约（zod）校验
  - 未接线（非 Core 路径）⇒ strategyRun 可缺省 / null（向后兼容既有留档）

### `tests/server/strategyCore/production/versionFromDocument.test.ts`
- 230 行 ｜ 用例声明 8 ｜ describe 1
- 被测源码：`server/research/strategySchema/types.ts` · `server/strategyCore/production/index.ts` · `server/strategyCore/index.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/production/versionFromDocument.test.ts`
- 用例树：
- **落库文档 → Core 版本**
  - 真实文档（cand-360004 形状）可成功翻译，并读出事件类型与涨停阈值
  - 🔴 真实文档里的 `valueType=CONSTANT` + 表达式文本被正确解析为表达式（不是字符串常量）
  - 若无该修复，条件会退化为「数字 ≤ 字符串」—— 用 Core 侧字段判定佐证字段本身是已知可用字段
  - 窗口量化器逐条登记（legacy 无法表达 ALL_DAYS ⇒ 一律 ANY_DAY 并写 note）
  - 阈值型出场（STOP_LOSS / TIME_EXIT）仍在 exitRules 声明，未进 RuleGraph，且如实登记
  - 文档没有 definition 段 ⇒ 返回 ok:false（不凭空构造），原因码稳定
  - 未登记的运算符 ⇒ 返回 ok:false（CORE_VERSION_BUILD_FAILED，不静默丢弃条件）
  - 翻译出的定义能被 StrategyRuntime 直接消费（不含 Dataset 绑定，兼容性检查不炸）

### `tests/server/strategyCore/ruleGraphAndTemporal.test.ts`
- 260 行 ｜ 用例声明 23 ｜ describe 3
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_graphHarness.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/ruleGraphAndTemporal.test.ts`
- 用例树：
- **§23.2 Temporal — 相对日代数**
  - T / T-1 / T+1 / T+N 标签与偏移互转
  - WINDOW(T+1,T+5) 的偏移集 / 长度 / 包含判定
  - 非法窗口（start > end / 非整数）响亮抛错
  - bar 可见性：同日 open 不可见、close 可见；未来日不可见
  - 日范围访问关卡：在 rd 上决策只能读 ≤ rd 的 bar，越界**记录违规**而非静默
  - 相对日重复的 bar 集被拒绝（不允许歧义）
- **§23.1 RuleGraph — 节点求值**
  - ALL：全真才真；ANY：一真即真
  - NOT：取反
  - CONDITION：8 个运算符**全部可执行**（不像 legacy 只映射 5 个）
  - CONDITION：IN 的右值必须是 ARRAY（否则抛错，不静默）
  - CONDITION：算术右值可表达（legacy 写不下 `volume > MA5Volume * 2`）
  - EVENT：事件判定器说了算
  - WINDOW：ANY_DAY / ALL_DAYS 两种量化器语义可辨
  - WINDOW：只看**当前决策日及之前**的窗口日（未到的日子登记为 futureSkipped）
  - SEQUENCE：A → B → C 有序发生（各步发生日必须非降）
  - TRIGGER：四种触发类型的选日语义
  - 组合表达：A AND (B OR C)
  - 组合表达：A AND NOT(B)
  - 数据缺失（操作数为 null）⇒ 条件视为不成立，并登记到 insufficiencies（不抛错、不臆造）
- **§23.1 RuleGraph — 静态校验**
  - 未知事件类型 / 未知运算符 / 空 ALL / 空 SEQUENCE / 未知触发全部被拒
  - WINDOW 缺少量化器（undefined）被拒 —— **不编默认值**
  - 未知字段引用 / 未知参数被拒
  - 嵌套深度上限生效（防病态图）

### `tests/server/strategyCore/runtimeAndAdapter.test.ts`
- 347 行 ｜ 用例声明 16 ｜ describe 2
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/runtimeAndAdapter.test.ts`
- 用例树：
- **§23.6 Runtime — Version + ParameterSet + Context → Decision**
  - 完整跑通：命中信号 + 入场意图 + 仓位意图（Event Study / Backtest 各取所需）
  - 参数覆写真的改变结果（不是声明了却无效）
  - 条件不成立 ⇒ 无信号（不是「有信号但被后面丢掉」）
  - 持有中 + 有出场图 ⇒ 产出出场意图（状态迁移到 PENDING_EXIT）
  - 数据能力不满足 ⇒ 抛 DATA_REQUIREMENTS_UNSATISFIED（逐项如实，不笼统）
  - 预检入口：checkCompatibility / auditLeakage 不执行规则也能用
  - 同一输入重复求值 ⇒ 结果逐字节一致（确定性）
  - 决策对象被深冻结（消费者无法事后篡改）
- **§22 / §19 legacy → Core 适配**
  - 首板回踩语义（FIRST_LIMIT_UP → T+1~T+5 → LOW >= T0_OPEN → ENTRY）由 RuleGraph 表达并真实执行
  - Dataset 绑定被**分离**出 Definition（规格 §10）；Definition 内零绑定泄漏
  - 未进 RuleGraph 的出场规则被**如实登记**（不静默丢弃）；STOP_LOSS 映射进 riskSpec
  - disabled 条件不进规则图，且如实登记（不当成成立）
  - 双向适配：legacy → Core → legacy → Core 指纹保持一致（同义子集可逆）
  - 逆映射拒绝 legacy 表达不了的构造（如 ALL_DAYS 量化器）
  - 未登记的运算符 / 右值类型 ⇒ 抛 LEGACY_MAPPING_UNSUPPORTED（不猜、不降级）
  - legacy 引用未注册特征 ⇒ 响亮拒绝（Core 不接受未登记特征）

### `tests/server/strategyCore/versionFingerprintSnapshot.test.ts`
- 344 行 ｜ 用例声明 24 ｜ describe 3
- 被测源码：`server/strategyCore/index.ts` · `tests/server/strategyCore/_fixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyCore/versionFingerprintSnapshot.test.ts`
- 用例树：
- **§23.8 Fingerprint**
  - same definition → same fingerprint（canonical 串也逐字节相同）
  - different behavior → different fingerprint（参数默认值改变也算行为变化）
  - 规则图结构变化 → 指纹变化（WINDOW 量化器 ANY_DAY → ALL_DAYS）
  - 能力面变化 → 指纹变化（有 / 无出场图）
  - 指纹覆盖声明面而非实现：改特征 version 才会改指纹（改 compute 不会）
  - 指纹是 64 位十六进制（sha256）
- **§23.7 StrategyVersion 不可变**
  - 已发布版本改 Definition ⇒ **不存在**这样的入口（永远抛 VERSION_IMMUTABLE）
  - 改内容只能走 applyDefinitionChange ⇒ 产出**新版本**（parent 指向旧版；旧版对象不受影响）
  - 内容等价（指纹相同）⇒ 幂等 no-op，不产生空版本
  - 版本对象深冻结（进程内也无法原地改）
  - 状态迁移：PUBLISHED 不可退回 DRAFT；DEPRECATED 是终态
  - 非法版本号 / 缺 createdAt / 空名称被拒（构造期失败，不留半成品）
- **§23.9 StrategyRunSnapshot / Replay**
  - 快照记录全部坐标（含 legacy 实测缺失的 parameterSet / engineVersion / codeVersion / seed）
  - 缺失 engineVersion / codeVersion ⇒ 拒绝构建（不接受 unknown 占位）
  - 校验：快照 + 版本自洽 ⇒ valid，且逐项检查都通过
  - 校验：定义被改过（指纹不符）⇒ 不可复现
  - 校验：参数被篡改 / 越界 ⇒ V4 失败
  - 校验：resolvedParameterSet 被篡改（DERIVED 值不一致）⇒ V5 失败
  - Replay：由快照 + 版本重建运行时配置，逐项与快照一致
  - Replay 等价性：用「已解析值」回填当原始覆写 ⇒ 被拒绝（DERIVED 不允许覆写）
  - Replay 等价性（正确姿势）：参数原样回填 ⇒ 快照指纹相等
  - 快照指纹不对 createdAt / runId 敏感（它们是「这一次」的标识，不是配置）
  - 快照对 seed / engineVersion 敏感（复现必须区分它们）
  - datasetReference 允许出现在快照里，但 Definition 里不得有绑定（规格 §10 vs §16 的分工）
