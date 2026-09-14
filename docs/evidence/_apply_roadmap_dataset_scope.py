"""DATASET-SCOPE-INHERIT-001 —— ROADMAP.md 总控更新（CRLF 安全，带前后断言）。

写入两处（均**只插入、不改写**既有内容）：
  1. §44 状态机落地区：在本轮之前的最新「上轮实查」条目**之前**插入本轮条目
     （该区的既有格式是**每轮都保留**自己的「上轮实查：」条目，共 16 条）；
  2. §44.5 队列：在 `9al.` 条目**之后**插入 `9am.`（编号按「**下一个未占用**」判定，
     已实测全仓库 `9am.` 出现 0 次 —— 禁「末条 +1」）。

🔴 行尾：ROADMAP.md 是**纯 CRLF** ⇒ 必须 read_bytes/write_bytes
   （`Path.read_text()` 的通用换行转换会把 CRLF 静默改成 LF）。
"""
from pathlib import Path
import sys

TARGET = Path("ROADMAP.md")
DRY = "--dry-run" in sys.argv

ENTRY = (
    "> 上轮实查：**2026-09-14 14:26 GMT+8 · 「成交明细显示 300/688，但我数据集里没有非主板」根因修复：回落重建**继承**绑定数据集的 universe 约束（板块 / ST） · 状态 CODE_READY**（`DATASET-SCOPE-INHERIT-001`）。"
    "触发 = 用户「**不对啊，我的数据集里面是没有非主板的股票的。你现在展示出来的都是300、688的，完全不对啊**」。"
    "**一、根因（三层实查，全部有锚点）**："
    "① **数据层无咎**：`closed_loop_backtest_run` 3 行留档，其中 `cand-270001@1.0.0` 那次 208 笔成交的 `securityId` 逐个译码后分布 = 300×105 / 301×46 / 688×32 / 603×3 / 001×2 —— **确实几乎全非主板**；"
    "② **译码无咎**：`research_security_identifier_history` 里每个 securityId 恰好一条 `primary` 行（`_probe_trade_code_correctness.mts` 实测「同一 securityId 有多条 primary 行 = 0」），排除「张冠李戴」；"
    "③ **真根因 = 数据集范围被悄悄换掉**：`dataset_version.id=390002`（首板回踩 v2）实查 `universeDefinitionJson = {\"universe\":\"all-a-shares\",\"source\":\"stock_daily_prices\",\"boards\":[\"main\"],\"excludeSt\":true}`、`dataset_build_config_board = main` —— **用户说的一点没错，数据集只含主板**；"
    "但直读桥判定它「不可撮合」（事件窗口投影只含 rd=0 行情）⇒ `assemble.ts#resolveDataset` **回落 `buildResearchDataset` 重建**，而重建路径的默认证券池是**全市场**（`request.universeFilter` 只表达 tDayCondition / pullback，**没有板块维度**）⇒ 实测重建产物 `datasetSecurityCount=5146`（含 300/301/688/北交所）。"
    "**二、修复（`server/**` 2 文件；零迁移、零新端点、零新依赖）**："
    "`datasetFromRegistry.ts` 新增纯函数 `pickUniverseConstraint(buildConfig, versionUniverseDefinition)`（**权威优先**：`dataset_build_config` > `dataset_version.universeDefinitionJson` > 无约束；非法板块取值**响亮抛错**、不静默丢弃 —— 丢弃 = 悄悄放宽范围）+ 只读取数 `readDatasetUniverseConstraint(datasetVersionId)`；新错误类 `UniverseConstraintError`（**刻意不是** `RegistryDatasetBridgeError`，否则会被「回落」逻辑吞掉、变成静默按全市场跑）；"
    "`assemble.ts#rebuildDataset(request, constraint)` 把约束传进 `buildResearchDataset({ universeFilter })`，**三处回落点全部**先继承再重建，并把继承事实写进 `assembly.datasetSourceNote`（无约束时**明说**「证券池为全板块（含创业板/科创板/北交所）」）。"
    "**三、真实验收（走网页同一条服务端路径）**：探针 `_probe_dataset_scope_inherit_e2e.mts`（真实 tRPC `loopRun`，112,525ms）**PASS / 0 失败** —— 证券池 **5146 → 3180**（主板）；`datasetSourceNote` 含「**已继承该数据集的 universe 约束：板块=main、排除 ST/*ST（来源=build-config）**」；成交明细 **185 笔 / 159 只 distinct，板块分布 = {main: 159}，非主板笔数 = 0**；留档旁路仍留 1 行、探针自清理 0 残留。"
    "单测 `tests/server/runWorkbenchAssembly/universeConstraint.test.ts` **8/8**；`tests/client/src/adapters/closedLoopRunAdapter.test.ts` **23/23**；`npx tsc --noEmit` exit 0；`npx vite build` exit 0；全量 `vitest` 失败**文件集合** = 既有基线、零新增。"
    "**四、诚实登记**："
    "① 修复前落库的 3 条留档**范围错误仍在库里**（那是「当时确实这么跑的」事实，**不删**）；前端已加**范围未确认提示**（`classifyRebuildScope` → `inherited` / `declared-unscoped` / `unknown`，`unknown` 时在成交明细上方告警「请重新运行一次」）；"
    "② 数据集 390002 **本身仍不可撮合**（每次运行都要回落重建）—— 根治须把 post/T+N 行情并入 rows，属 Dataset 构建域的独立任务。"
)

QUEUE_9AM = (
    "   - **9am. （闭环回测线 · `DATASET-SCOPE-INHERIT-001`）回落重建**继承**绑定数据集的 universe 约束（板块 / ST）—— 修掉「数据集只含主板、成交明细却出现 300/688」** ✅ **已完成（2026-09-14 14:26 GMT+8，CODE_READY）**："
    "触发 = 用户实报「**我的数据集里面是没有非主板的股票的，展示出来的都是 300、688**」。"
    "**根因**：`dataset_version.id=390002` 实查 `universeDefinitionJson.boards=[\"main\"]` + `dataset_build_config_board = main`，但直读「不可撮合」⇒ 回落 `buildResearchDataset` **重建**，而重建默认证券池是**全市场**（`universeFilter` 无板块维度）⇒ 实测 `datasetSecurityCount=5146`、成交 300×105 / 301×46 / 688×32。"
    "**修复**：`datasetFromRegistry.ts` 新增 `pickUniverseConstraint`（权威优先 `dataset_build_config` > `universeDefinitionJson` > 无；非法值抛 `UniverseConstraintError`，**故意不是** `RegistryDatasetBridgeError` 以免被回落逻辑吞掉）+ `readDatasetUniverseConstraint`；`assemble.ts#rebuildDataset` 接收约束并传 `universeFilter`，三处回落点全部继承，事实进 `datasetSourceNote`。"
    "**验收**：`_probe_dataset_scope_inherit_e2e.mts` **PASS / 0 失败**（证券池 3180、成交 159/159 = main、非主板 0；note 含继承声明）；单测 8/8 + adapter 23/23；`tsc` 0；`vite build` 0；全量 `vitest` 失败文件集合零新增。"
    "**未决**：① 修复前那 3 条留档范围错误仍留存（前端已提示「范围未确认，请重跑」）；② 390002 仍不可撮合（根治需把 post 窗口并入 rows，属 Dataset 构建域）。"
)

raw = TARGET.read_bytes().decode("utf-8")
assert raw.count("\n") - raw.count("\r\n") == 0, "前置：ROADMAP.md 不是纯 CRLF"
lines_before = raw.count("\n")

# --- 1) §44：在本轮之前的最新「上轮实查」之前插入（旧条目一律保留） ---
OLD_HEAD = "> 上轮实查：**2026-09-14 14:05 GMT+8"
assert raw.count(OLD_HEAD) == 1, f"§44 锚点出现次数异常：{raw.count(OLD_HEAD)}"
NEW_BLOCK = ENTRY + "\r\n>\r\n" + OLD_HEAD
raw2 = raw.replace(OLD_HEAD, NEW_BLOCK, 1)
assert raw2 != raw, "§44 插入未发生"

# --- 2) §44.5：在 `9al.` 条目之后插入 `9am.` ---
lines = raw2.splitlines(keepends=True)
idx = [i for i, l in enumerate(lines) if l.startswith("   - **9al. （闭环回测线")]
assert len(idx) == 1, f"§44.5 `9al.` 条目定位异常：{len(idx)} 处"
lines.insert(idx[0] + 1, QUEUE_9AM + "\r\n")
raw3 = "".join(lines)

# --- 写后断言 ---
assert raw3.count("\n") - raw3.count("\r\n") == 0, "写后：ROADMAP.md 行尾被污染（出现裸 LF）"
assert raw3.count("> 上轮实查：") == raw.count("> 上轮实查：") + 1, (
    f"「上轮实查」应恰 +1：{raw.count('> 上轮实查：')} → {raw3.count('> 上轮实查：')}"
)
assert raw3.count("9am.") == 1, f"`9am.` 应为 1 处：{raw3.count('9am.')}"
assert raw3.count("9al.") == raw.count("9al."), "`9al.` 被破坏"
# 既有内容不得丢失
for marker in ("# 44. 项目真实状态映射（数据快照）", "触发 = 用户「**我不需要Json高级模式"):
    assert marker in raw3, f"§44 手术破坏既有内容：{marker} 丢失"
assert raw3.count("\n") == lines_before + 3, f"行数应 +3：{lines_before} → {raw3.count(chr(10))}"

if DRY:
    print("[dry-run] 未写盘；断言全部通过")
else:
    TARGET.write_bytes(raw3.encode("utf-8"))
    print(f"[ok] ROADMAP.md 已更新：行 {lines_before} → {raw3.count(chr(10))}（+3）；CRLF 纯度保持")
    print(f"[ok] §44 新增 1 条（上轮实查 = {raw3.count('> 上轮实查：')} 条）；§44.5 新增 `9am.`（插在 `9al.` 之后）")
