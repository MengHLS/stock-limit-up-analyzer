<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/client/src/components

- 测试文件 **5** 个 ｜ 用例声明 **84** 个
- 涉及源码目录：`client/src/components/datasetRegistry/` · `client/src/components/research/` · `client/src/components/strategy/` · `server/research/strategySchema/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/client/src/components                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ℹ️ 本组含 `components/research` / `components/strategy` / `components/datasetRegistry` 三个子目录，文档按文件全路径区分。

> ℹ️ 本模块有 **1** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/client/src/components/datasetRegistry/BuildVersionDialog.test.ts`
- 27 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`client/src/components/datasetRegistry/BuildVersionDialog.tsx`
- 单跑：`pnpm exec vitest run tests/client/src/components/datasetRegistry/BuildVersionDialog.test.ts`
- 用例树：
- **suggestNextVersion**
  - 无版本 → v1
  - 全部为 v{n} → max+1（不因缺口而回填）
  - 存在非 v{n} 标签 → count+1（不回填、不冲突）

### `tests/client/src/components/datasetRegistry/datasetFilterForm.test.ts`
- 276 行 ｜ 用例声明 26 ｜ describe 8
- 被测源码：`shared/datasetRegistryContracts.ts` · `client/src/components/datasetRegistry/datasetFilterForm.ts`
- 单跑：`pnpm exec vitest run tests/client/src/components/datasetRegistry/datasetFilterForm.test.ts`
- 用例树：
- **createDefaultFilterForm（与后端权威默认同源）**
  - 默认 = 全板块 / 含 ST / T 日首板 / t-0..t+20
  - 默认表单必须直接通过校验（默认即合法，不能出现「一打开就报错」）
  - 每次生成独立行 key（React list key 不冲突）
- **选项生成**
  - relativeDayOptions 覆盖 0..min（升序，含 T 日文案）
  - boardOptions / eventKindOptions 与契约枚举一一对应且带中文标签
- **toggleBoard（保持规范顺序、天然去重）**
  - 勾选 / 取消勾选
  - 结果始终按 DATASET_BOARDS 规范顺序（勾选顺序不影响载荷）
  - 不产生重复项
- **事件维度行增删改**
  - addEventRow 自动挑未使用的组合，避免「一加就重复报错」
  - removeEventRow 保底 1 条（不允许删空）
  - updateEventRow 只改目标行
  - formatEventRow 文案（T 日 / T-n 日）
- **validateFilterForm（构建门禁）**
  - 事件维度为空 → 拒绝（「未完成筛选配置不得构建」）
  - 超过事件维度上限 → 拒绝
  - 相对日非法 / 越界 → 拒绝
  - 事件维度重复 → 拒绝（与后端 superRefine 同口径）
  - 前后窗口越界 / 非整数 → 拒绝
  - 结果视界空 / 越界 / 重复 → 拒绝
  - 批大小非法 → 拒绝
  - 合法组合（板块 + 排除 ST + 多事件 + 前置窗口）→ 通过
- **buildFilterPayload（表单 → wire）**
  - 数字字符串转 number，事件按相对日升序，视界去重升序
  - 默认表单 → 与后端权威默认等值载荷
  - payload 必须能被同一校验放过（校验与整形口径一致）
- **parseNumberList**
  - 忽略空白项并转数字
- **describeFilterForm（唯一文案来源）**
  - 默认摘要含全板块 / 含ST / T日首板 / t-0..t+20
  - 自定义摘要反映板块 / 排除ST / 多事件

### `tests/client/src/components/datasetRegistry/datasetManagement.test.ts`
- 62 行 ｜ 用例声明 8 ｜ describe 2
- 被测源码：`client/src/components/datasetRegistry/CreateDatasetDialog.tsx` · `client/src/components/datasetRegistry/DeleteDatasetDialog.tsx`
- 单跑：`pnpm exec vitest run tests/client/src/components/datasetRegistry/datasetManagement.test.ts`
- 用例树：
- **validateDatasetCodeInput**
  - 空串不报错（由提交按钮 disabled 兜底）
  - 合法 lowercase snake_case → null
  - 含大写 / 连字符 / 空格 / 驼峰 → 报错
  - 以数字开头 → 报错
  - 禁止模式：版本号后缀 / 纯数字后缀 → 报错（防同一数据集被拆成多个 code）
  - 超长（>64）→ 报错
- **isDeleteDatasetConfirmed**
  - 完全一致 → true
  - 空串 / 前后空白 / 大小写不同 / 子串 → false

### `tests/client/src/components/strategy/definitionDraft.test.ts`
- 560 行 ｜ 用例声明 39（含 `.each` 展开） ｜ describe 7 ｜ 📄 源码文本断言
- 被测源码：`server/research/strategySchema/goldenSample.ts` · `client/src/components/research/candidateSketchForm.ts` · `client/src/components/strategy/definitionDraft.ts`
- 单跑：`pnpm exec vitest run tests/client/src/components/strategy/definitionDraft.test.ts`
- 用例树：
- **① 定义七段 ↔ 研究草图七段：对齐是被测试锁住的，不是「看起来像」**
  - 1) 段的 key **逐位相同**（同序）——顺序是用户看到的填写路径，不能各排各的
  - 2) 每段标题**逐字相同**
  - 3) 每段必填性**逐段相同**（决定徽标是「还差 N 项」还是「可选」）
  - 4) `hint` 只要求非空，**不要求逐字相同** —— 两边的说明本来就在讲不同的事
  - 5) 段状态是**穷尽**的：七段每段都有一条状态，且带得出标题 / 必填性 / 摘要
- **② definition → 草稿 → definition：真实 golden sample 必须逐字往返**
  - 6) 🔴 往返**深等于**原对象（含表单不编辑的 id / description / unit / note）
  - 7) 再走一圈**幂等** —— 防「每保存一次就漂一点」
  - 8) 往返后仍在意的键确实还在（不靠 toEqual 一条断言糊过去）
  - 9) 文档级成本 / 回测配置同样往返（它们不在 definition 里，是独立一段）
  - 10) 表单不编辑的键会被**列出**（而不是悄悄保留）
  - 11) 无法表达的值 ⇒ 该区降级只读 + 出 warning，但**不丢键**
- **③ 形状不符 ⇒ 整份降级只读（绝不猜着解析半份）**
  - 12) %s ⇒ raw，且原因里说得出是哪一处
  - 13) 合法但几乎全空的定义 ⇒ 仍是 structured（不误判成 raw）
  - 14) raw 态带上原文，界面才有东西可展示
- **④ 缺口锚点：清单说缺哪一项，界面上那一格就必须亮**
  - 15) 锚点词表是**闭集**：新增锚点必须同时加进测试，否则这里先红
  - 16) 每条静态文案都查得到锚点；未知文案回空数组（渲染层退化成只亮清单）
  - 17) 「成本假设还差：…」是**动态**文案 ⇒ 靠前缀回落命中
  - 18) 🔴 校验器实跑产出的**每一条** gap 都能查到锚点（改文案不改这里 ⇒ 这里红）
  - 19) 🔴 锚点必须落到**真实输入框**（扫源码：每个锚点都要有 missingAt 调用点）
- **⑤ 校验：把「必然被后端拒」的组合提前说出来**
  - 20) 空的必填项算 gap 而不是 error（本地不拦用户存草稿）
  - 21) 🔴 出场优先级重复 ⇒ error（后端 SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_DUPLICATE）
  - 22) 空行工厂给的优先级是**结构性初值**，第二条不会自动撞上第一条
  - 23) 🔴 出场规则三者（threshold / parameter / condition）一个都不给 ⇒ error
  - 24) TIME_EXIT 的阈值必须是 ≥1 的整数交易日；按比例表达时必须在 (0,1)
  - 25) 🔴 L6：信号与成交都在 T 日收盘 ⇒ error（后端 SIGNAL_EXECUTION_TIMING_CONFLICT）
  - 26) 🔴 L7：触发时点是次一交易日 + 同 bar 成交 ⇒ error
  - 27) TUNABLE 数值参数必须同时给 min / max；给了就必须 min < max
  - 28) DERIVED 角色必须给 derivedFrom（不编辑的键，只从 original 读）
  - 29) 回测并发上限与策略 maxPositions 不一致 ⇒ **warning** 而不是 error（含义不同，不强行统一）
  - 30) 条件右值是前视引用且超出可解析偏移 ⇒ 拦下（防「事后筛选冒充信号」）
  - 31) `path.*` / `outcome.*` 是标签层 ⇒ 作买入条件必拒
  - 32) 前视偏移的复刻口径与服务端一致（FIRST/EVERY → 起点；LAST → 终点；NEXT → 起点+1）
- **⑥ 基础信息改数据集 ⇒ 必须同步进 definition.datasets 的 PRIMARY 绑定**
  - 33) 🔴 改写 PRIMARY 行的坐标，**连 `original` 一起改**（original 才是重建时被放回的）
  - 34) 不改输入对象（纯函数）
  - 35) 坐标为空 / 没有绑定行 ⇒ 原样返回（那种情况下 doc 级坐标必须缺省）
  - 36) 只碰 PRIMARY 行、不增删行（非 PRIMARY 绑定原样保留）
  - 37) 没有 PRIMARY 时退化为第 0 行；已是目标坐标时不产生新对象（幂等）
- **⑦ 新增的 client 模块不得把服务端模块拉进浏览器包**
  - 38) 三个新模块里没有任何**非 type** 的 server/shared 导入
  - 39) 镜像词表必须**在客户端本地**，不得转手导出服务端对象

### `tests/client/src/components/strategy/definitionVocabulary.test.ts`
- 210 行 ｜ 用例声明 8 ｜ describe 1
- 被测源码：`server/research/strategySchema/definition.ts` · `client/src/components/research/candidateSketchVocabulary.ts` · `client/src/components/strategy/definitionVocabulary.ts`
- 单跑：`pnpm exec vitest run tests/client/src/components/strategy/definitionVocabulary.test.ts`
- 用例树：
- **定义侧词表 ↔ 服务端逐字对表（防漂移）**
  - 1) 与草图共用的那批表：值集逐字相同
  - 2) 定义侧独有的那批表：值集逐字相同
  - 3) 🔴 条件运算符：定义侧是**服务端名称**（不是草图那一套符号）
  - 4) 🔴 定义侧运算符表里**不得出现符号形**（这正是本轮修掉的那个真 bug）
  - 5) 符号 → 名称的翻译表：值域 ≡ 服务端运算符，键域 ≡ 草图运算符
  - 6) `arity`（单值 / 列表）与草图侧对同一运算符的判断一致
  - 7) 标签查询：未知取值**原样返回**，绝不编造一个看着对的中文名
  - 8) 运算符的符号形只用于显示：已知值有人话，未知值原样回显
