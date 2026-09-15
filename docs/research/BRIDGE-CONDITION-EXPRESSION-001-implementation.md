# BRIDGE-CONDITION-EXPRESSION-001 实施报告 —— 条件右值「静默降级」的消灭

> - **任务**：`9ar`（`ROADMAP.md` §44.5 登记；本报告交付后归档进 `ROADMAP-CHANGELOG.md`）
> - **日期**：2026-09-16
> - **触发**：`RESEARCH-STRATEGY-BRIDGE`（RESEARCH-006）端到端验收暴露 —— 属**已查实、非推断**的真实缺陷。
> - **前置授权**：用户明确「服务可以暂停，我现在不需要在页面上回测」⇒ 本轮**允许改 `server/**`**（否则会热重启杀死在途 Run）。
> - **一句话结论**：**已修**。同一条「缩量」假设现在**能**被无损声明（`bar.volumeRatio <= max_volume_ratio`），且与配方门槛**同名同义**；历史写法（`"prefix.rd0.volume * 0.3"`）**不再被静默降级**，而是**响亮拒绝**并给出改写方向。

---

## 1. 症状（真库证据，非推断）

`strategy_versions` 里 8 条已转正策略的 `strategyDocumentJson → definition.entry.conditions` 第 2 条**恒为**：

```text
id=cond-2  field=bar.volume  operator=LESS_THAN_OR_EQUAL  value="prefix.rd0.volume * 0.3"  valueType=CONSTANT
```

- **拿一个字符串常量去和数值字段比较** ⇒ 语义无意义；
- 同一策略的 `recipe = first-limit-pullback-hold-shrink` 用 `max_volume_ratio` / `max_drawdown` / `require_bullish` 三个 **TUNABLE 参数**做**真实可执行**的缩量 / 守线门槛 ⇒ **执行语义是对的，错的是「声明」**；
- 后果：**「读 `entry.conditions`」与「读 `recipe` 门槛」两条路径口径不一致** —— Parameter Search 会在错误前提上搜索，回测若读声明侧会得到恒定假条件。

> 注：`inferValueType` 是旧函数名，修正后更名为 `resolveConditionValueType`（语义更准确：它是**判定语法种类**，不是**猜语义**）。

---

## 2. 根因

两条限制叠加：

1. **词表缺口**：`ConditionDefinition.valueType` 只有 `CONSTANT` / `FIELD_REFERENCE` / `PARAMETER_REFERENCE`，**没有算术形态** ⇒ `bar.volume <= prefix.rd0.volume * 0.3` 这类「字段 × 系数」**写不出来**；
2. **转换器的静默降级**：`definitionBuild.ts#inferValueType` 的判定顺序是「字段引用文法 → 参数词表 → **其余一律 `CONSTANT`**」⇒ `"prefix.rd0.volume * 0.3"` 含算术 ⇒ `parseStrategyFieldReference` 返回 `unknown`、又不是参数 code ⇒ **落 `CONSTANT`（原样作为字符串常量写入）**。

第 2 条属于**违纪**：转换器一贯纪律是「**闭集，不静默忽略 / 不静默丢弃**」，而它把一个**无法表达**的意图伪装成「已表达」。

---

## 3. 方案选型：为什么**不**给右值加「算术表达式文法」

| 方案 | 代价 | 判定 |
|---|---|---|
| A. 给 `ConditionDefinition.valueType` 加 `EXPRESSION` + 自建解析器/求值器 | 需要新增文法、解析器、**运行时求值器**，并同步 `definitionValidation` / `projection` / 5 张投影表 / legacyViews / 前端 | ❌ **否决**：爆炸半径最大，且等于在一个已有「字段引用文法单一权威」的系统里**再造第二套求值语义**，口径必然再次漂移 |
| B. **加「派生字段」+ 取消静默降级**（本轮采用） | 词表 +4 个名字；转换器加一条**拒绝**判据；前端词表同步 | ✅ **采用**：解析器 / 校验器 / 投影 / 运行时求值器**零改动**；声明侧通过与配方**同名**的字段，与执行侧**天然对齐** |

**B 的关键洞察**：执行侧（配方）**早就**实现了 `volumeRatio` / `haircutFromEventLow` / `isBullish` / `momentumFromEventClose` 这四个量，缺的只是**声明侧写不下它们的名字**。因此正解不是「让声明侧能算」，而是「**让声明侧能叫出执行侧已有的名字**」—— 这叫「对齐」，不叫「重构」。

---

## 4. 修法一：派生 bar 字段注册表（声明侧**能**表达）

**`server/research/strategySchema/definition.ts`**

```ts
export const STRATEGY_BAR_FIELDS = ["open","high","low","close","volume","amount","tradeDate","relativeDay"] as const;

export const STRATEGY_DERIVED_BAR_FIELDS = [
  "volumeRatio", "haircutFromEventLow", "isBullish", "momentumFromEventClose",
] as const;

/** 当前 bar 白名单 = 原始列 + 派生字段。 */
export const STRATEGY_CURRENT_BAR_FIELDS = [...STRATEGY_BAR_FIELDS, ...STRATEGY_DERIVED_BAR_FIELDS] as const;
```

**命名唯一真源 = 配方特征 id**（`recipeRegistry.PULLBACK_FEATURE_IDS`）：

| `bar.*` 派生字段 | 配方特征（执行侧） | 在当前 bar 上的口径 |
|---|---|---|
| `volumeRatio` | `volumeRatio` | 当日成交量 / 事件日成交量（< 1 为缩量） |
| `haircutFromEventLow` | `haircutFromEventLow` | (事件日开盘 − 当日最低) / 事件日开盘（**正数 = 跌破**） |
| `isBullish` | `isBullish` | 当日收盘 > 当日开盘 ? 1 : 0 |
| `momentumFromEventClose` | `momentumFromEventClose` | 当日收盘 / 事件日收盘 − 1 |

**时间域约束（严格遵守）**：派生字段**只**在 `bar.*`（当前 bar）成立 —— `isKnownFieldReference` 对 `currentBar` 用 `STRATEGY_CURRENT_BAR_FIELDS`，对 `prefix.*` / `post.*` 仍用**原始列** `STRATEGY_BAR_FIELDS`。理由：派生量是「相对事件日基准**在当前 bar 上重算**」，写成 `prefix.rd0.volumeRatio` 语义上不存在；白名单的语义是「**真实可提供**的字段」，不是「名字听起来合理」。

**PIT 安全**：全部落在 `CURRENT_BAR` 时间域（只用「当前 bar + 事件日基准」）⇒ **按构造不含前视**。注意与 Dataset `path` 层同名派生列（`path.volumeRatio` / `path.pullbackFromEventHigh`）**口径相同但取数语义不同** —— `path.*` 是固定 `rd ≥ 1` 行、属「前视，仅打标签」层，**禁止**作为信号条件（既有 Look-Ahead 闸门已拦，本轮未放宽）。

`server/research/strategySchema/definitionValidation.ts` 同步把 `UNKNOWN_FIELD_REFERENCE` 的白名单提示改为展示 `STRATEGY_CURRENT_BAR_FIELDS`（含派生字段），避免错误信息**教用户写出会被拒的引用**。

---

## 5. 修法二：转换器**取消静默降级**（响亮失败）

**`server/research/strategyCandidate/definitionBuild.ts`**

`inferValueType(value, codes)` → **`resolveConditionValueType(value, codes, path)`**（新增 `path` 参数以定位错误）：

```ts
function resolveConditionValueType(value, codes, path): StrategyConditionValueType {
  if (typeof value === "string") {
    if (parseStrategyFieldReference(value).kind !== "unknown") return "FIELD_REFERENCE";
    if (codes.has(value)) return "PARAMETER_REFERENCE";
  }
  rejectExpressionAttempt(value, path);   // ← 新增：响亮失败
  return "CONSTANT";
}
```

**「算术表达式尝试」的判据 —— 只认两条**（`expressionAttemptOf`，**诊断用探测**，非解析器）：

1. 以合法字段引用**开头**、但整串**不是**合法引用（有多余尾巴）—— 如 `prefix.rd0.volume * 0.3`；
2. 串里**同时**出现字段引用与算术运算符 —— 如 `(1 - 0.05) * prefix.rd0.close`。

**刻意包含的边界**：`ARITHMETIC_OPERATOR_RE = /[*+\/-]/` **含 `-`**，但因为它**必须与字段引用同时命中**才生效，所以普通字符串常量 `"FIRST_LIMIT_UP"` / `"MAIN"` / `"2026-09-01"` / `"T+1"` **一律放行**为 `CONSTANT`（已由单测 3-k 的对照组断言锁死，防误伤）。

**失败语义**：抛 `PROMOTE_SKETCH_INVALID`，错误信息**点名路径**并**给出两条改写方向**：

```text
候选草稿内容非法：filterRule.groups[0].conditions[1].value — 右值 "prefix.rd0.volume * 0.3"
不是合法字段引用、也不是已声明的参数 code，但含字段引用 "prefix.rd0.volume" 与算术运算符：
这看起来是「字段 × 系数」的算术表达式，而条件的右值没有算术形态（只有 常量 / 字段引用 / 参数引用 三种语法种类）。
Promote 拒绝把它静默降级成字符串常量，请改写为：
① 派生字段（在当前 bar 上相对事件日基准求值，与配方门槛同名同义）：bar.volumeRatio / bar.haircutFromEventLow / bar.isBullish / bar.momentumFromEventClose；
② 或把系数写进 parameterSpace 做成参数，再用参数引用指向它（例如 bar.volume LESS_THAN_OR_EQUAL max_volume_ratio）—— 转正后即可被 Parameter Search 搜索。
```

`IN` / `NOT_IN` 的**数组右值逐元素检查**（不给数组留后门）。

---

## 6. 前端词表与提示语同步

**`client/src/components/research/candidateSketchVocabulary.ts`**

- 拆分 `CANDIDATE_BAR_FIELD_OPTIONS`（原始列）与 `CANDIDATE_DERIVED_BAR_FIELD_OPTIONS`（4 个派生字段，含中文标签）；
- 新增 `CANDIDATE_CURRENT_BAR_FIELD_CHOICES` = 原始列 + 派生字段；
- `candidateFieldChoicesOf`：`currentBar` → 全量；`preEvent` / `forwardBar` → **仅原始列**（与后端白名单**同构**）；
- 把 `CANDIDATE_CONDITION_ARITHMETIC_NOTE` 从「**表达不了**」改写为「**现在可以这样表达**」，并更新字段示例与预设注释。

> 这修正了 `PROJECT_RULES.md` 那条地雷的**用户可见面**：界面不再告诉用户「做不到」，而是给出**必然能转正**的写法（纪律原文：「**禁提供必然被转正拒掉的选项**」）。

---

## 7. 向后兼容论证（为什么**读**既有 8 条策略不受影响）

关键约束：`validateCanonicalStrategyDefinition` **在读路径上被调用**（`strategyPersistence/service.ts#validateVersion`）⇒ 新增校验规则若**拒绝**既有形态，会让 8 条已转正策略**读不出来**（生产事故）。

本轮方案天然规避：

| 动作 | 对既有数据的影响 |
|---|---|
| **只新增**派生字段（扩白名单） | 既有 `CONSTANT` 条件**仍然合法** ⇒ 读路径零变化 |
| 「取消静默降级」加在 **`definitionBuild`（写路径，仅 Promote）** | 只影响**新**转正尝试；**不碰** `definitionValidation` 的既有判据 |

并且 —— **没有任何运行时求值器读 `entry.conditions`**：执行侧走 `recipe` 门槛。因此 `valueType` 的消费方只有 **converter / validator / projection / legacyViews**，本轮**只改了 converter**（`definitionValidation` 仅改了一句提示文案）。

---

## 8. 取证（真库 · 前后对照）

探针：`docs/evidence/_probe_bad_conditions_9ar.mts`（**只读**，不写任何表）+ `_probe_bad_conditions_9ar.out.txt`

### 8.1 「前」= 历史残留（已落库的真相）

```text
strategy_versions 行数 = 10 / research_strategy_candidate 行数 = 9

条件总数 = 16（FIELD_REFERENCE=9 / PARAMETER_REFERENCE=0 / CONSTANT=7）
其中「形如算术表达式」的历史残留 = 7 条
```

逐条（版本 420001~420007，与 `390001` 对照）：

```text
[versionId=390001] cand-270001@1.0.0   #0 bar.low    >=  "prefix.rd0.open"         (FIELD_REFERENCE)   ← 干净
                                       #1 bar.volume <   "prefix.rd0.volume"       (FIELD_REFERENCE)
[versionId=420001] cand-360001@1.0.0   #1 bar.volume <=  "prefix.rd0.volume * 0.3" (CONSTANT)  <<< 残留
[versionId=420002] cand-360002@1.0.0   #1 bar.volume <=  "prefix.rd0.volume * 0.5" (CONSTANT)  <<< 残留
[versionId=420003~420007]              #1 bar.volume <=  "prefix.rd0.volume * 0.3" (CONSTANT)  <<< 残留 ×5
```

> **注意 `PARAMETER_REFERENCE = 0`** —— 8 条已转正策略**没有一条**用上参数引用。这正是词表缺口的直接体现：作者想写「缩量 ≤ 比例」时**无路可走**，只能写下算术表达式，然后被静默降级。

### 8.2 「后」= 修正生效（把真库草稿的 `filterRule` 原样喂给**真转换器**重放）

```text
重放成功 = 1 / 响亮拒绝(PROMOTE_SKETCH_INVALID) = 8 / 其他失败 = 0
```

- 唯一成功的 = `cand-270001`（右值本就是合法字段引用 `prefix.rd0.volume`，**不受影响**）；
- 其余 **8 条**（7 条 CONVERTED + 1 条 ARCHIVED）全部被**响亮拒绝**，且错误信息**逐字点名** `filterRule.groups[0].conditions[1].value` 与两条改写方向 ⇒ **静默降级已被消灭**。

### 8.3 对齐不变量（真数据上复核）

```text
不变量：配方 featureIds ⊆ bar.* 声明白名单 —— 不可声明者 = 无（对齐）
已落库策略中 bar.<x> 声明 = 16 条（原始 OHLCV 列=16 / 配方派生字段=0 / 漂移=0）
参数引用指向未声明的配方参数 = 0 条
```

> `配方派生字段 = 0` 再次印证 8.1 的结论：**既有声明里从未出现过派生字段**（因为当时还叫不出来）。

---

## 9. 验收

### 9.1 端到端复验（真 tRPC + 真 TiDB）

探针：`docs/evidence/_e2e_condition_expression_9ar.mts` + `.out.txt`（自建自清）

```text
== ALL PASS == checks=27 failures=0
```

覆盖：

| § | 判据 | 结果 |
|---|---|---|
| §1 | 修正写法**能**转正：`bar.volumeRatio <= max_volume_ratio` / `bar.haircutFromEventLow <= max_drawdown` / `bar.isBullish >= require_bullish` | ✅ promote 成功（`cand-450001` / `1.0.0` / versionId 480001） |
| §1 | 逐条 `valueType = PARAMETER_REFERENCE`（**不再降级成 CONSTANT**） | ✅ 3/3 |
| §1 | 逐条字段名（去 `bar.`）与**运行时配方** `features[].featureId` **同名** | ✅ `haircutFromEventLow` / `volumeRatio` / `isBullish` |
| §1 | 逐条右值 ∈ 配方参数表 ∩ `resolveParameters` 解析键 | ✅ `max_drawdown` / `max_volume_ratio` / `require_bullish` |
| §2 | 投影 ↔ Canonical **零漂移**（`verifyStrategyProjections` 5 张逐字段） | ✅ parameters 3 / entry 3 / exit 3 / execution 1 / datasets 1 |
| §2 | 参数投影 `parameterRole = TUNABLE` | ✅ 3/3 |
| §3 | 历史写法 promote **响亮拒绝** `STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID` | ✅ 含路径 + 改写方向 |
| §3 | 拒绝后**零 Strategy 数据**、候选保持 `ACCEPTED` | ✅ 行数未变 |
| §4 | 自清后**行数守恒**（候选 / 策略 / 版本 / 溯源 / 参数回到基线 9/9/10/8/21） | ✅ |

**🔴 语义对齐断言（本轮的核心）**：`bar.volumeRatio <= max_volume_ratio` 与配方门槛 `volumeRatio <= max_volume_ratio` **同名同义** —— 声明与执行**不再有两套口径**。

### 9.2 静态与回归

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 输出 / exit 0** |
| 3 个聚焦测试文件 | **187 passed / 3 files** |
| 全量 `npx vitest run` | **Test Files 7 failed \| 236 passed (243)**、**Tests 16 failed \| 4045 passed (4061)** |
| 失败文件集合 vs 既有基线 | **逐字一致**（`dataHealth` / `image.uploadAndRecognize` / `limitUp` / `limitUp.watch` / `marketData` / `tushare.secret` / `tushareTradingCalendar`）⇒ **零回归** |

新增/修改测试：

| 文件 | 内容 |
|---|---|
| `tests/server/research/strategyCandidate/definitionBuild.test.ts` | `1-k` 派生字段 + 参数引用（断言 `PARAMETER_REFERENCE` 且通过 `validateBuiltStrategyDefinition`）；`3-k` 算术右值**响亮失败** 3 例（含 `(1 - 0.05) * prefix.rd0.close` 与**对照组** `"FIRST_LIMIT_UP"` 仍为 `CONSTANT`） |
| `tests/server/research/strategySchema/strategyDefinition.test.ts` | 新增 `BRIDGE-CONDITION-EXPRESSION-001` 小节：① 每个 `bar.<派生>` 合法（非 `UNKNOWN_FIELD_REFERENCE` / 非 `TIME_DOMAIN` / 非 `FUTURE`）；② `prefix.rd0.<派生>` **仍被拒**；③ **对齐不变量**：配方每个 `PULLBACK_FEATURE_IDS` 值必须 ∈ `STRATEGY_CURRENT_BAR_FIELDS`（防「执行有、声明无」再漂移） |
| `tests/client/src/components/research/candidateSketchForm.test.ts` | 位置感知断言：`currentBar` = 原始列 + 派生；`preEvent` / `forwardBar` = **仅原始列** |

---

## 10. 影响面与边界

**改动文件（7 个，全部为源码/测试，零迁移、零新端点、零新依赖）**

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/research/strategySchema/definition.ts` | 修改 | 派生字段注册表 + `STRATEGY_CURRENT_BAR_FIELDS` + `currentBar` 白名单分支 |
| `server/research/strategySchema/definitionValidation.ts` | 修改 | 仅改 `UNKNOWN_FIELD_REFERENCE` 的提示文案 |
| `server/research/strategyCandidate/definitionBuild.ts` | 修改 | `inferValueType` → `resolveConditionValueType` + `rejectExpressionAttempt`（响亮失败） |
| `client/src/components/research/candidateSketchVocabulary.ts` | 修改 | 词表拆分 + 位置感知 choices + 提示语改写 |
| `tests/.../definitionBuild.test.ts` | 修改 | 新增 2 组测试 |
| `tests/.../strategyDefinition.test.ts` | 修改 | 新增对齐不变量小节 |
| `tests/.../candidateSketchForm.test.ts` | 修改 | 位置感知断言 |

**新增证据文件**

| 文件 | 说明 |
|---|---|
| `docs/evidence/_probe_bad_conditions_9ar.mts` + `.out.txt` | 真库前/后取证（只读） |
| `docs/evidence/_e2e_condition_expression_9ar.mts` + `.out.txt` | 修正写法端到端复验（27 断言，自建自清） |

**边界**

- `drizzle/**` **零改动**（无迁移）；`shared/**` **零改动**；
- **未**给 `ConditionDefinition.valueType` 加算术形态 ⇒ **未**触碰 `projection.ts` / 5 张投影表 / 运行时求值 / legacyViews；
- **未**改 `routes` / tRPC 契约 ⇒ 前端无需新端点；
- `server/**` 文件数仍为 **553**（`find server -type f | wc -l`）。

---

## 11. 遗留（如实声明，不夸大）

1. **既有 8 条策略的落库声明未回填**：本轮只修「未来写法」与「读路径兼容」，**没有**去 UPDATE 已转正版本的 `strategyDocumentJson`（该表内容一经写入禁止 UPDATE —— 改内容必须新建版本，是 §8 铁律）。因此**历史 7 条策略的声明仍是旧写法**。按纪律，正确做法是**重新转正**（新版本），而非原地改写；
   - 本轮探针已证明：把这些草稿按**旧写法**重新转正会**响亮失败** ⇒ 用户必须改用派生字段写法，这**正是期望行为**（把选择权与改写责任交回作者，而不是替它猜）。
2. **派生字段只登记「执行侧已实现」的 4 个**：`momentumFromEventClose` 目前**只用于排序**、未作为任何门槛；如将来需要「回撤新低」「突破前高」等派生量，仍需**先在配方侧实现特征**，再登记进本表（本表**不是**「愿望清单」）。
3. **`path.*` 同名派生列仍是前视层**：本轮的派生字段与 Dataset `path` 列口径相同但取数不同，**未**放宽 Look-Ahead 闸门；若将来有人把 `path.volumeRatio` 写进信号条件，仍会被 `INVALID_FUTURE_REFERENCE` 拦下（已有测试覆盖）。

---

## 12. 附：一句话给未来的自己

> **「声明写不下」和「写下了但执行不认」是两件事。**
> 前者要**补词表**，后者要**响亮失败**。
> 本轮两件都做了 —— 但做法不是「让声明侧能算」，而是**让声明侧能叫出执行侧已经实现的名字**。
> 命名唯一真源 = 配方特征 id；对齐不变量已进单测，防止再次漂移。
