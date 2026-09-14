# -*- coding: utf-8 -*-
"""PROJECT_RULES.md 追加两节（纯 LF）。
  - 🔴 数据集窗口投影 / 决策日资格（DATASET-WINDOW-PROJECTION-001）
  - 🔴 成交/数据键域 = canonical sec_<uuid>（SECURITY-ID-DOMAIN-001）
"""
from pathlib import Path

P = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\PROJECT_RULES.md")
ANCHOR = "- 落地：`tests/server/runWorkbenchAssembly/universeConstraint.test.ts`（8 例）钉住「权威优先 / 不猜 / 非法即抛 / `unknown` 不进白名单」。"

NEW = """
## 🔴 数据集窗口投影 / 决策日资格（DATASET-WINDOW-PROJECTION-001 · 2026-09-14 实查）

- 投影口径（🔴 改 `datasetFromRegistry.ts#buildWindowRows` 前必读）：面板 = `rd=0`（首板日，来自 `prefix`，充当 `pullbackFeatures` 的特征基准 `bars[0]`）+ `rd ∈ [1, observationWindow.end + 1]`（来自 `post`，观察日 + **次日执行日**）。
- 🔴 **决策日资格 = `rd ∈ [start, end]`**（取值来自**策略声明** `definition.entry.observationWindow`）。**`rd=0` 不进决策日** —— 否则首板日当天 `bars` 只有一根 ⇒ 特征必然退化（`volumeRatio=1` / `haircut=intraday`）⇒ 凭空造出「打板式」候选；同时这也让「`bars[0]` = 首板日、序列末根 = 决策日」从近似变**精确成立**。
- 🔴 `end + 1` 是**撮合的最小充分条件**：`simulator/engine.ts` 第 9(c) 步在**决策日的下一交易日**按执行日 bar 取价（取不到即拒单 `SUSPENDED`）。`prefix` 的 rd<0 与 `post` 的 rd>end+1 **不进 `rows`**（既不构成决策日、也非执行日；rd<0 并入会让同一证券/日期出现 rd=-20..-1 的重复候选，违反 `(tradeDate, securityId)` 唯一键）。
- 🔴 **窗口不猜**：唯一取值口 `resolveObservationWindow()`，由 `assemble.ts` 从 `strategyDocument.definition.entry.observationWindow` 读取后传入。未声明 ⇒ `REGISTRY_OBSERVATION_WINDOW_UNDECLARED`；非 `TRADING_DAY` / 非整数 / `start<1` / `end>DATASET_POST_MAX_RELATIVE_DAY(20)` ⇒ `REGISTRY_OBSERVATION_WINDOW_INVALID`；超该版本 post 真实容量 ⇒ `REGISTRY_POST_WINDOW_TOO_SHORT`。**一律不夹取**（夹取 = 悄悄改窄策略）。
- 护栏：`REGISTRY_BRIDGE_MAX_ROWS = 400_000`，**计量对象 = `rows.length`**（不是事件数 —— 原先误按事件数计量）。390002 / `end=20` 最坏情形实测 354,544 行。
- 去重：`(tradeDate, securityId)` 唯一。🔴 **严格列 = 行的身份** = `open/high/low/close/volume/amount`，多来源不一致即抛 `REGISTRY_WINDOW_ROW_CONFLICT`；🔴 **`preClose` 是派生列**（实库 **15 / 112,920 键 = 0.0133%** 来源不一致，样例 `601236.SH@2024-10-11`：`8.33` vs `8.38`，而**同一根 K 线的 OHLCV 完全一致**）⇒ 确定性取基准行（rd 最小者）的值 + **如实登记** `PRECLOSE_SOURCE_MISMATCH` / `stats.preCloseMismatchKeys`，**既不中止直读、也不编造取舍**。
- 🔴 **观察日（rd≥1）的 `turnoverRate` / `circulationMarketCap` / `totalMarketCap` 必为 null**：`ds_*_post` 的 DDL 只承载原始日线（结构性 PIT 防线，`plugins.ts#rawBarCreateSql`），把首板日数值盖到观察日上就是**编数据** ⇒ 如实记 `knowledge.liquidity = "UNKNOWN"` + `OBSERVATION_DAY_LIQUIDITY_UNKNOWN`。
- 🔴 **窗口末持仓**（rd=end 决策建仓）在数据集内没有「下一决策日」⇒ 以 `openAtEnd` 收尾（期末按最后可得收盘价估值）。这是「数据集只覆盖事件窗口」的**固有边界**，不是撮合失败。
- 事件窗口重叠是常态（`ds_*` 是事件级窗口，同一根 K 线可被多个事件覆盖）：实库 390002 有 **102,727 个重复组**，合并后 **354,544 行**；重复对 OHLCV 数值完全一致（close 极差合计 = 0）⇒ **无损去重**。
- 成本（实测 `_probe_bridge_window_cost.mts`）：全窗口直读 ≈ **16.5s** vs 重建 **60.6s**（~3.7×）。
- 落地：`tests/server/runWorkbenchAssembly/windowProjection.test.ts`（**18 例**：窗口解析 5 / 面板投影 9 / 身份桥接 4）；探针 `_probe_dataset_window_run_e2e.mts`（ALL PASS）、`_probe_dataset_window_coverage.mts`、`_probe_bridge_window_cost.mts`。

## 🔴 成交 / 数据键域 = canonical `sec_<uuid>`（SECURITY-ID-DOMAIN-001 · 2026-09-14 实查）

- 🔴 `ResearchDatasetRow` 有**两个**字段，不可互换：`securityId` = **身份**（canonical `sec_<uuid>`，见 `drizzle/schema.ts#researchSecurities` 注释「永久身份（系统分配，如 sec_<uuid>）」）；`code: string | null` = 「**该日生效完整代码**（如 `600000.SH`）」。
- 🔴 `ds_*` 三表（`event` / `prefix` / `post`）**只有 `symbol`（代码域）**，没有身份列。直读桥必须经 **Identifier History 显式桥接**：复用既有单一实现 `server/security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`（asOf-aware、PIT-safe、歧义即拒），🔴 **逐事件按自己的 `tradeDate` 解析**（code reuse：同一代码在不同历史区间属不同证券）。失败抛 `REGISTRY_SECURITY_IDENTITY_UNRESOLVED`，**绝不退回用代码冒充身份**。
- 实库覆盖（`_probe_symbol_identity_coverage.mts`）：390002 的 **2,967 个 distinct symbol 100%** 可在其事件日解析到唯一 `sec_<uuid>`；`research_security_identifier_history` 仅 **5,552 行**（1.1s 可全量载入）。
- 🔴 **下游一律用 `row.code` 解析板块**（`classifyBoard(row.code ?? "")` —— `datasetRegistry/detection.ts` / `researchDataset/tDayFilter.ts` / `researchDataset/universe.ts`），全仓**没有**任何地方把 `securityId` 当代码解析。
- 留档 / 展示侧：成交明细 `trades[].securityId` = `sec_<uuid>` ⇒ 名称解析走 `researchRun.securityLabels`（名称源覆盖 **62.9%**，缺口显「—」，**不用代码冒充名称**）。
- 症状自检：**若成交明细名称全为「—」或 `securityLabels` 解析率 = 0 ⇒ 先查 `securityId` 是否被写成了代码**（断言 `/^sec_/` 形态，见 `_probe_dataset_window_run_e2e.mts` 第 3 段）。
- 落地：`windowProjection.test.ts` 的「身份桥接」4 例（含 code reuse 与歧义即拒）+ e2e 第 3 段（35/35 全 `sec_<uuid>`、解析率 100%、板块 `{main: 35}`）。
"""

raw = P.read_bytes()
text = raw.decode("utf-8")
assert ANCHOR in text, "缺少锚点"
assert len(text.split("\n")) - 1 == text.count("\n")
assert "\r\n" not in text, "PROJECT_RULES.md 应为纯 LF"
assert "SECURITY-ID-DOMAIN-001" not in text, "该节已存在，勿重复追加"
before = len(text)
new_text = text.replace(ANCHOR, ANCHOR + NEW, 1)
assert new_text != text
P.write_bytes(new_text.encode("utf-8"))
back = P.read_bytes().decode("utf-8")
assert "\r\n" not in back, "写后出现 CRLF"
assert "SECURITY-ID-DOMAIN-001" in back and "DATASET-WINDOW-PROJECTION-001" in back
print(f"OK PROJECT_RULES.md: {before} -> {len(back)} chars")
