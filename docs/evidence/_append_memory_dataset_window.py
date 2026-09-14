# -*- coding: utf-8 -*-
"""1) .workbuddy/memory/MEMORY.md —— 原地更新要点（纯 LF，断言两侧标记）
   2) .workbuddy/memory/2026-09-14.md —— 追加本轮完成记录（append-only）
"""
from pathlib import Path

MEM = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\MEMORY.md")
LOG = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\2026-09-14.md")

# ---------------------------------------------------------------------------
# 1) MEMORY.md
# ---------------------------------------------------------------------------
EDITS = [
    # §44.5 下一个未占用编号
    ("**§44.5 编号按「下一个未占用」（已用到 `9am`）",
     "**§44.5 编号按「下一个未占用」（已用到 `9an`）"),
    # 端口行瘦身（腾出额度）
    ("（`listen` 报 `EACCES`、非忙）⇒ dev 静默回落（实测 3100/3101），错端口 = 全站不可达（`Failed to fetch`）。",
     "（`listen` 报 `EACCES` 非忙）⇒ dev 静默回落 3100/3101；错端口 = 全站不可达。"),
    # 直读桥：从「不可撮合」改为「已能撮合」+ 键域
    ("- 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）。",
     "- 直读桥 = `runWorkbenchAssembly/datasetFromRegistry.ts`（**禁第二套实现**）。✅ **已能撮合、回落不再常态**："
     "投影 `rd=0`（特征基准）+ `rd ∈ [1, obs.end+1]`（观察日 + 次日执行日），"
     "🔴 **决策日资格 = `rd ∈ [obs.start, obs.end]`**；窗口**只认策略声明**（不猜 / 不夹取，缺/非法/超 post 容量一律抛错）。\n"
     "- 🔴 直读桥 `securityId` = canonical **`sec_<uuid>`**（`engineKeyBridge#resolveSecurityIdByEngineKey` "
     "**逐事件按自身 `tradeDate`** 桥接，处理 code reuse），`code` 才是代码 —— `ds_*` 只有 `symbol`；"
     "**板块判定一律用 `row.code`**。"),
]

raw = MEM.read_bytes()
text = raw.decode("utf-8")
assert "\r\n" not in text, "MEMORY.md 应为纯 LF"
before = len(text)
for old, new in EDITS:
    assert old in text, f"缺少锚点：{old[:40]!r}"
    assert text.count(old) == 1, f"锚点不唯一：{old[:40]!r}"
    text = text.replace(old, new, 1)
assert text != raw.decode("utf-8")
MEM.write_bytes(text.encode("utf-8"))
back = MEM.read_bytes().decode("utf-8")
assert "\r\n" not in back
assert "已用到 `9an`" in back and "sec_<uuid>" in back
print(f"OK MEMORY.md: {before} -> {len(back)} chars")

# ---------------------------------------------------------------------------
# 2) 当日日志（append-only）
# ---------------------------------------------------------------------------
LOG_NEW = """
### 六、✅ 完成（15:05）—— 用户裁定「按观察窗口投影」+ 键域缺陷一并修掉

**裁定**：`rd ∈ [0, entry.observationWindow.end + 1]`（随策略自动定，不用每次手动看数据）。

**改了什么（`server/**` 3 文件）**
- `runWorkbenchAssembly/datasetFromRegistry.ts`（主改）：
  - `buildWindowRows(events, zeroBars, postBars, window, securityIds)` —— 面板 = `rd=0`（`prefix`，特征基准）
    + `rd ∈ [1, end+1]`（`post`，观察日 + 次日执行日）；**决策日资格 = `rd ∈ [start,end]`**（`rd=0` 不进，否则首板日
    `bars` 只有一根 ⇒ `volumeRatio=1`/`haircut=intraday` ⇒ 凭空造「打板式」候选）。
  - 前收改为**按相对日**取（`seq.find(relativeDay === rd-1)`），不是「数组上一行」（中间相对日缺失时会拿更早的一天冒充）。
  - 🔴 **键域修正**：`securityId` 改为 canonical `sec_<uuid>`（新 `resolveSecurityIdsByEvent`，委托
    `security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`，逐事件按自身 `tradeDate`）；`code` 保持 `event.symbol`。
    去重键 / `memberKeys` 一并改身份域。失败抛 `REGISTRY_SECURITY_IDENTITY_UNRESOLVED`（**不退回代码冒充身份**）。
  - 🔴 **前收降为派生列**：`preClose` 不参与严格冲突判定（实库 15/112,920 键来源不一致，`601236.SH@2024-10-11`
    8.33 vs 8.38，而 OHLCV 完全一致）⇒ 确定性取基准行值 + 如实登记 `PRECLOSE_SOURCE_MISMATCH`；
    `REGISTRY_WINDOW_ROW_CONFLICT` 只留给 `open/high/low/close/volume/amount`。
  - 护栏 `REGISTRY_BRIDGE_MAX_ROWS` 200,000 → **400,000**，计量对象由「事件数」改 **`rows.length`**。
  - 新增 `loadPrimaryIdentifiers()`（研究域小表 5,552 行；复用 `identifierRowToSecurityIdentifier`）——
    已在文件头「纪律 1」显式登记为**唯一例外**（registry 读取接口无「代码 → 身份」方法），非静默违反。
- `runWorkbenchAssembly/assemble.ts`：`resolveDataset` 读策略声明窗口 → 传桥；回落错误码清单补
  `REGISTRY_SECURITY_IDENTITY_UNRESOLVED` / `REGISTRY_WINDOW_ROW_CONFLICT`。
- `tests/server/runWorkbenchAssembly/windowProjection.test.ts`：夹具加 `sid()` / `idsOf()`（**身份 ≠ 代码**，
  退回即红）+ 新增 7 例（H/I 面板身份、A~D 身份桥接含 code reuse 与歧义即拒）⇒ **18/18**。

**实证（真库 / 真实 tRPC，走网页同一条服务端路径）**
- `_probe_symbol_identity_coverage.mts`：2,967 distinct symbol **100%** 可解析、0 歧义；标识历史仅 5,552 行。
- `_probe_dataset_window_run_e2e.mts`：**ALL PASS / 0 失败**（14.3s）—— `datasetSource=registry`、`note=null`、
  `versionId=390002`、面板 **112,920 行 / 2,967 证券**、`backtest=EXECUTED`、**成交 35 笔**（修复前恒 0 笔全 SUSPENDED）、
  期末 73,207.86；**成交键 35/35 全 `sec_<uuid>`**、`securityLabels` **35/35**、板块 `{main: 35}`；留档 1 行、自清理 0。

**验收三件套**：`tsc` **exit 0**；全量 `vitest` **4,003 passed / 16 failed / 失败文件集合 = 精确 7 基线、零新增**；
`vite build` **RC=0**（3,030 模块 / 13.97s）。

**归档**：`ROADMAP.md` §44（15:05 条，插在 14:26 之前）+ §44.5 **`9an`**；`ROADMAP-CHANGELOG.md`；`PROJECT_RULES.md`
新增两节（「数据集窗口投影 / 决策日资格」、「成交 / 数据键域 = `sec_<uuid>`」）；`docs/evidence/README.md` 新分组 `datasetwindow`。

**🔴 诚实登记（未决，勿当已完成）**
1. `entry.observationWindow` 是否**在策略运行链路被真正消费**尚未直接取证（e2e 的「rd=0 不进决策日 + 35 笔成交」是**间接**证据）。
2. `post` 停牌行（OHLCV 全 null，实测 38 行）**未特判**（`postRange` 只看 rd 范围、不看 null 比例）。
3. 15 个前收不一致键的**根因**（上游 2024-10-11 旧收盘口径）**未修**，桥层只做确定性取舍 + 如实登记。
4. 窗口末持仓以 `openAtEnd` 收尾（「数据集只覆盖事件窗口」的固有边界）。
5. `prefix` rd<0 与 `post` rd>end+1 仍**不进 `rows`**（不构成决策日、也非执行日）。
6. `datasetVersion` 指纹因 `universeDefinition` 内容变化而改变（`rd-1.0.0-1-7a5ab5aa…` → `rd-1.0.0-1-3cc90dea…`）——
   **这是正确行为**（内容即版本），但旧留档里的 `datasetVersion` 字符串与之不再相等。
"""

raw = LOG.read_bytes()
text = raw.decode("utf-8")
assert "\r\n" not in text, "日志应为纯 LF"
assert "### 五、本轮新增证据" in text, "缺少五节锚点"
assert "### 六、✅ 完成（15:05）" not in text, "该节已存在，勿重复追加"
before = len(text)
new_text = text.rstrip("\n") + "\n" + LOG_NEW
LOG.write_bytes(new_text.encode("utf-8"))
back = LOG.read_bytes().decode("utf-8")
assert "\r\n" not in back and "9an" in back
print(f"OK 2026-09-14.md: {before} -> {len(back)} chars")
