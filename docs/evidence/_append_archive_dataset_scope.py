"""DATASET-SCOPE-INHERIT-001 —— 归档四件套（全部 **纯 LF**、append-only、带断言）。

写入：
  1. `ROADMAP-CHANGELOG.md`   追加本轮变更条目（append-only）；
  2. `.workbuddy/memory/2026-09-14.md` 追加当日工作日志条目（append-only）；
  3. `.workbuddy/memory/PROJECT_RULES.md` 追加「数据集范围继承」细则章节；
  4. `docs/evidence/README.md` 追加 `datasetscope` 证据索引分组。
"""
from pathlib import Path
import sys

DRY = "--dry-run" in sys.argv

CHANGELOG = Path("ROADMAP-CHANGELOG.md")
DAILY = Path(".workbuddy/memory/2026-09-14.md")
RULES = Path(".workbuddy/memory/PROJECT_RULES.md")
EVIDENCE = Path("docs/evidence/README.md")

CHANGELOG_SECTION = """
## 2026-09-14 14:26 GMT+8 — 回落重建**继承**绑定数据集的 universe 约束：修掉「数据集只含主板、成交明细却出现 300/688」（`DATASET-SCOPE-INHERIT-001` · `server/**` 2 文件 + `tests/**`，CODE_READY）

- 触发 = 用户「**不对啊，我的数据集里面是没有非主板的股票的。你现在展示出来的都是300、688的，完全不对啊**」。
- 🔴 根因（三层实查，全部有锚点）：① **数据层无咎** —— `cand-270001@1.0.0` 那次 208 笔成交译码后 = 300×105 / 301×46 / 688×32 / 603×3 / 001×2，**用户看到的现象是真的**；② **译码无咎** —— `research_security_identifier_history` 里每个 `securityId` 恰一条 `primary` 行（`同一 securityId 有多条 primary 行 = 0`），排除张冠李戴；③ **真根因 = 数据集范围被悄悄换掉** —— `dataset_version.id=390002` 实查 `universeDefinitionJson={"universe":"all-a-shares","source":"stock_daily_prices","boards":["main"],"excludeSt":true}`、`dataset_build_config_board = main`（**用户说的一点没错，数据集只含主板**），但直读桥判定它「不可撮合」（事件窗口投影只含 rd=0 行情）⇒ `assemble.ts#resolveDataset` **回落 `buildResearchDataset` 重建**，而重建路径的默认证券池是**全市场**（`request.universeFilter` 只表达 `tDayCondition` / `pullback`，**没有板块维度**）⇒ 实测 `datasetSecurityCount=5146`。
- 修复（`server/runWorkbenchAssembly/` 2 文件；**零迁移、零新端点、零新依赖**）：`datasetFromRegistry.ts` 新增纯函数 `pickUniverseConstraint(buildConfig, versionUniverseDefinition)`（**权威优先**：`dataset_build_config` > `dataset_version.universeDefinitionJson` > 无约束；非法板块取值**响亮抛错**、不静默丢弃）+ 只读取数 `readDatasetUniverseConstraint` + 新错误类 `UniverseConstraintError`（**刻意不是** `RegistryDatasetBridgeError` —— 后者会被「回落」逻辑吞掉，退化成静默按全市场跑）；`assemble.ts#rebuildDataset(request, constraint)` 把约束传进 `buildResearchDataset({ universeFilter })`，**三处回落点全部**先继承再重建，并把继承事实写进 `assembly.datasetSourceNote`（无约束时**明说**「证券池为全板块（含创业板/科创板/北交所）」）。
- 展示层（`client/**`，零服务端契约变更）：`closedLoopRunAdapter.ts#classifyRebuildScope(note)` → `inherited` / `declared-unscoped` / `unknown`；`ClosedLoopRunResultPanel` 在 `unknown` 时于成交明细上方告警「范围未确认，请重新运行一次」—— 修复前落库的历史结果因此**不会被误读**成「按你的数据集跑的」。

### 一、实证（真实 tRPC + 真库）

- 探针 `docs/evidence/_probe_dataset_scope_inherit_e2e.mts`（新）**PASS / 0 失败**（真实 `loopRun`，112,525ms）：证券池 **5146 → 3180**（主板）；`datasetSourceNote` 含「**已继承该数据集的 universe 约束：板块=main、排除 ST/*ST（来源=build-config）**」；成交明细 **185 笔 / 159 只 distinct，板块分布 = {main: 159}，非主板笔数 = 0**；留档旁路仍留 1 行、探针自清理 0 残留。
- 诊断探针（新）：`_probe_trade_code_correctness.mts`（译码零歧义）、`_probe_dataset_board_scope.mts`（数据集声明 vs 权威 `dataset_build_config_board`）。
- 单测：`tests/server/runWorkbenchAssembly/universeConstraint.test.ts` **8/8**；`tests/client/src/adapters/closedLoopRunAdapter.test.ts` **23/23**。
- `npx tsc --noEmit` **exit 0**；`npx vite build` **27.11s exit 0**；全量 `vitest` 失败**文件集合** = 既有基线、**零新增**。
- migration：**无**（本轮零表结构改动）。

### 二、可复用的判据

- 🔴 **回落重建必须继承被回落对象的约束**：任何「A 失败 ⇒ 换 B 跑」的路径，若 B 的默认范围比 A **宽**，就是**静默扩大研究范围** —— 比崩溃更危险，因为结果看起来完全正常。
- 🔴 **约束解析失败要用独立错误类**（`UniverseConstraintError`），与「不该用 A」的 `RegistryDatasetBridgeError` 分开；否则会被回落逻辑吞掉，退化成「静默按默认范围跑」。
- 🔴 **范围类元数据的非法值不得静默丢弃**：丢弃 = 放宽白名单（`unknown` 尤其不得进白名单）。
- 🔴 历史结果若**无法确认**范围，UI 必须说「未确认、请重跑」，**不得**沉默。

### 三、诚实登记

- ⚠️ 修复前落库的 **3 条留档范围错误仍在库里**（那是「当时确实这么跑的」事实，**未删**）；前端已加「范围未确认」提示。
- ⚠️ `dataset_version.id=390002` **本身仍不可撮合**（每次运行都要回落重建）—— 根治须把 post/T+N 行情并入 rows，属 **Dataset 构建域的独立任务**。
- 登记：§44.5 新编号取 **`9am`**（按「**下一个未占用**」判定 —— 全仓库 `9am.` 出现 0 次；**非「末条 +1」**）。
"""

DAILY_SECTION = """
## 14:26 GMT+8 — 数据集范围被悄悄换掉：回落重建未继承绑定数据集的板块约束（`DATASET-SCOPE-INHERIT-001` · CODE_READY）

### 一、用户实报与结论

- 用户：「**不对啊，我的数据集里面是没有非主板的股票的。你现在展示出来的都是300、688的，完全不对啊**」。
- 结论：**用户是对的，这是我的 bug**。`dataset_version.id=390002` 实查 `universeDefinitionJson.boards=["main"]` + `excludeSt=true`、`dataset_build_config_board = main`；但运行时**实际跑的不是它** —— 直读判定「不可撮合」⇒ 回落重建 ⇒ 默认**全市场**（5146 只），成交明细因此出现 300/301/688。

### 二、三层实查

- ① 留档 `cand-270001@1.0.0`：208 笔成交译码分布 300×105 / 301×46 / 688×32 / 603×3 / 001×2 ⇒ **用户看到的现象是真的**。
- ② `research_security_identifier_history`：每个 `securityId` 恰一条 `primary` 行（`_probe_trade_code_correctness.mts` 实测「多条 = 0」）⇒ **不是译码张冠李戴**。
- ③ `assembly.datasetSourceNote` 原文即写明「直读成功但该数据集不可用于撮合…已回落 buildResearchDataset 重建」⇒ 缺口在**重建没继承约束**。

### 三、修复

- `server/runWorkbenchAssembly/datasetFromRegistry.ts`：`pickUniverseConstraint`（纯函数，权威优先 build_config > universeDefinitionJson；非法值抛 `UniverseConstraintError`）+ `readDatasetUniverseConstraint`。
- `server/runWorkbenchAssembly/assemble.ts`：`rebuildDataset(request, constraint)`；三处回落点全部先继承再重建；继承事实进 `datasetSourceNote`。
- `client/**`：`classifyRebuildScope` 三态 + 面板「范围未确认」告警（修复前的历史留档不再被误读）。

### 四、实证

- `_probe_dataset_scope_inherit_e2e.mts`（真实 tRPC `loopRun`，112,525ms）**PASS / 0 失败**：证券池 5146 → **3180**；成交 **159/159 = main**，非主板 **0**；note 含继承声明；探针自清理干净。
- 单测 **8/8**（服务端）+ **23/23**（adapter）；`tsc` 0；`vite build` 27.11s 0；全量 vitest 失败文件集合**零新增**。

### 五、可复用的坑

- 🔴 「**A 失败换 B 跑**」的路径，**B 的默认范围绝不能比 A 宽** —— 否则是静默扩大研究范围（结果看起来正常，最危险）。
- 🔴 约束解析失败要用**独立错误类**，否则会被回落逻辑吞掉。
- 🔴 范围元数据的非法值**不得静默丢弃**（= 放宽白名单）。
- 🔴 历史结果范围**无法确认**时，UI 必须提示重跑，不得沉默。

### 六、遗留

- ⚠️ 修复前 3 条留档范围错误仍在库（未删，属历史事实）；前端已提示「范围未确认，请重跑」。
- ⚠️ 390002 仍不可撮合 ⇒ 每次运行都回落重建；根治 = 把 post/T+N 行情并入 rows（Dataset 构建域）。
"""

RULES_SECTION = """
## 🔴 数据集范围继承（DATASET-SCOPE-INHERIT-001 · 2026-09-14 实查）

- 🔴 **回落重建必须继承被回落数据集的 universe 约束**：`assemble.ts#resolveDataset` 在「直读不可撮合」「直读失败」「显式 rebuild」三条路径上都会走 `buildResearchDataset`，而它的默认证券池是**全市场**（`ResearchDatasetRequest.universeFilter` 只表达 `tDayCondition` / `pullback`，**没有板块维度**）。实查后果：绑定 `dataset_version.id=390002`（`boards:["main"]`）却产出 `datasetSecurityCount=5146` 的全市场面板，成交明细出现 300/301/688。
- 权威来源优先级：`dataset_build_config`（+ `dataset_build_config_board`，生成参数）> `dataset_version.universeDefinitionJson.boards`（版本自述）> 无约束。取数走 `datasetFromRegistry.ts#readDatasetUniverseConstraint`（只读；复用 `DbDatasetRegistry.getVersionById` / `getBuildConfig`，**禁第二套实现**）。
- 🔴 **约束解析错误必须用 `UniverseConstraintError`，不得用 `RegistryDatasetBridgeError`**：后者是「可预期的不该直读」信号，会被 `resolveDataset` 的 catch 吞掉并回落重建 ⇒ 若约束也用它，就会在「约束读不出来」时**静默按全市场跑**（正是要堵的漏洞）。
- 🔴 **板块白名单不含 `unknown`**：`classifyBoard` 对无法归类的代码返回 `unknown`，放进白名单 = 放行一切无法识别的标的。非法取值**响亮抛错**，不静默丢弃（丢弃 = 放宽范围）。
- 🔴 继承事实必须进 `assembly.datasetSourceNote`；**无约束时必须明说「证券池为全板块（含创业板/科创板/北交所）」**，不得沉默。
- 前端判据：`closedLoopRunAdapter.ts#classifyRebuildScope(note)` → `inherited` / `declared-unscoped` / `unknown`；`unknown` = 修复前落库的历史结果，面板在成交明细上方提示「范围未确认，请重新运行」。落点：`tests/client/src/adapters/closedLoopRunAdapter.test.ts`。
- 排查顺序（症状 = 「成交明细出现我数据集里没有的股票」）：① 查数据集真实声明（`_probe_dataset_board_scope.mts`）；② 查本次是否回落重建（`assembly.datasetSource` / `datasetSourceNote`）；③ 查成交代码译码是否张冠李戴（`_probe_trade_code_correctness.mts` —— 至今零歧义）。
- 落地：`tests/server/runWorkbenchAssembly/universeConstraint.test.ts`（8 例）钉住「权威优先 / 不猜 / 非法即抛 / `unknown` 不进白名单」。
"""

EVIDENCE_SECTION = """
### `datasetscope` —— 4 组（2026-09-14：数据集范围继承 + 成交代码译码正确性）

| 文件 | 结论 | 引用于 |
|---|---|---|
| `_probe_dataset_scope_inherit_e2e.mts` + `.json` | ✅ **PASS / 0 失败（真实 tRPC `loopRun`，112,525ms）**：证券池 **5146 → 3180**（主板）；`datasetSourceNote` 含「已继承该数据集的 universe 约束：板块=main、排除 ST/*ST（来源=build-config）」；成交 **185 笔 / 159 只 distinct，{main: 159}，非主板 0**；留档旁路 1 行、自清理 0 残留 | 本轮 `ROADMAP.md` §44 / §44.5 `9am` |
| `_probe_dataset_board_scope.mts` + `.log` | 数据集声明实查：`dataset_version.id=390002` → `universeDefinitionJson={"universe":"all-a-shares","source":"stock_daily_prices","boards":["main"],"excludeSt":true}`；`dataset_build_config_board = main`；三条留档 `datasetSource=rebuild` + `datasetSecurityCount` 5146/5133 | 同上 |
| `_probe_trade_code_correctness.mts` + `.log` | 译码无歧义：`cand-270001` 的 188 只 distinct 中 **「同一 `securityId` 有多条 primary 行」= 0** ⇒ 排除张冠李戴；前缀分布 300×105 / 301×46 / 688×32 | 同上 |
| `tests/server/runWorkbenchAssembly/universeConstraint.test.ts`（**不在本目录**，登记于此便于溯源） | ✅ **8/8**：权威优先（build_config > universeDefinitionJson）、不猜（形状不符 → `none`）、非法板块抛 `UniverseConstraintError`（含 `unknown`）、`excludeSt` 只认严格 `true` | 同上 |
"""

failures: list[str] = []
_buf: dict[Path, str] = {}


def append(path: Path, section: str, label: str) -> None:
    raw = _buf.get(path) or path.read_bytes().decode("utf-8")
    assert raw.count("\r\n") == 0, f"{path} 不是纯 LF"
    before = raw.count("\n")
    out = raw + section
    assert out.count("\r\n") == 0, f"{label} 写入引入了 CRLF"
    print(f"[ok] {path} | 行 {before} → {out.count(chr(10))}（+{out.count(chr(10)) - before}）| {label}")
    _buf[path] = out


append(CHANGELOG, CHANGELOG_SECTION, "CHANGELOG append")
append(DAILY, DAILY_SECTION, "当日日志 append")
append(RULES, RULES_SECTION, "PROJECT_RULES 追加「数据集范围继承」章节")
append(EVIDENCE, EVIDENCE_SECTION, "证据索引追加 datasetscope 分组")

# 写后复核（用内存结果，dry-run 也成立）
rules = _buf[RULES]
changelog = _buf[CHANGELOG]
daily = _buf[DAILY]
evidence = _buf[EVIDENCE]
assert rules.count("DATASET-SCOPE-INHERIT-001") == 1, "PROJECT_RULES 章节写入异常"
assert changelog.count("DATASET-SCOPE-INHERIT-001") == 1, "CHANGELOG 条目写入异常"
assert daily.count("DATASET-SCOPE-INHERIT-001") == 1, "当日日志条目写入异常"
assert evidence.count("`datasetscope`") == 1, "证据索引分组写入异常"

if DRY:
    print("\n[dry-run] 未写盘；断言全部通过")
else:
    for p, content in _buf.items():
        p.write_bytes(content.encode("utf-8"))
    for p in (CHANGELOG, DAILY, RULES, EVIDENCE):
        assert p.read_bytes().count(b"\r\n") == 0, f"{p} 行尾被污染"
    print("\n[ok] 四个文件全部写入完毕（纯 LF 保持）")
