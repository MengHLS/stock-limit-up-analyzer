# -*- coding: utf-8 -*-
"""把 DATASET-WINDOW-PROJECTION-001 / SECURITY-ID-DOMAIN-001 归档进 Master Control。

纪律：
  - ROADMAP.md 纯 CRLF ⇒ read_bytes().decode() + write_bytes()
  - §44「上轮实查」= 只插入、不改写既有条目（新条目插在最新条目之前）
  - §44.5 编号按「下一个未占用」（已用到 9am ⇒ 本轮 9an）
  - 写前后都做断言（行数增量、两侧标记）
"""
from pathlib import Path

ROOT = Path(r"C:\work\sourcecode\stock-limit-up-analyzer")

# ---------------------------------------------------------------------------
# §44 正文（单行）
# ---------------------------------------------------------------------------
S44 = (
    "> 上轮实查：**2026-09-14 15:05 GMT+8 · 「策略运行本来就应该从数据集取数」——"
    "直读桥投影口径从「仅 rd=0」扩到「rd ∈ [0, 观察窗口末 + 1]」，运行**真正消费被绑定数据集**"
    "（不再回落重建）；并修掉一条被本次改动**激活**的键域缺陷（`securityId` 用代码冒充 canonical `sec_<uuid>`）"
    " · 状态 CODE_READY**（`DATASET-WINDOW-PROJECTION-001` + `SECURITY-ID-DOMAIN-001`）。"
    "触发 = 用户「**策略运行的时候是需要从数据集中取数据啊**」（纠正上一轮把「每次运行都回落重建」当既成事实的登记）。"
    "**一、先核实用户命题（真库实查，不凭印象）**：`dataset_version.id=390002` 的 `ds_*_post`（rd≥1）"
    "**有 471,816 行完整 OHLCV**、rd=+1 覆盖全部 23,978 个事件；把 rd ∈ [0,20] 合成逐日面板 = **354,544 行**；"
    "102,727 个重复 `(symbol, tradeDate)` 组的 `close` 极差合计 = **0**（无损去重）"
    "⇒ **用户是对的：数据一直在，是投影口径过窄**（旧桥只投 `prefix` 的 rd=0，每事件恰 1 行 = 23,978 行 "
    "⇒ `executionBarsAvailable=false` ⇒ 必然回落）。"
    "**二、窗口口径（用户裁定「按观察窗口投影」）**：面板 = `rd=0`（首板日，来自 `prefix`，"
    "充当 `pullbackFeatures` 的特征基准 `bars[0]`）+ `rd ∈ [1, observationWindow.end + 1]`"
    "（来自 `post`，观察日 + **次日执行日**）；**决策日资格 = `rd ∈ [start, end]`**"
    "（`rd=0` 不进决策日，否则首板日当天 `bars` 只有一根 ⇒ 特征退化为 `volumeRatio=1` / `haircut=intraday`，"
    "凭空造出「打板式」候选）。`end+1` 是撮合的最小充分条件"
    "（`simulator/engine.ts` 第 9(c) 步在**决策日的下一交易日**取执行 bar）。"
    "🔴 **窗口必须由策略声明**（`definition.entry.observationWindow`）：未声明抛 `REGISTRY_OBSERVATION_WINDOW_UNDECLARED`、"
    "非法/超 post 容量抛 `..._INVALID` / `POST_WINDOW_TOO_SHORT`（**不夹取、不代猜**）；"
    "护栏 `REGISTRY_BRIDGE_MAX_ROWS` 20 万 → **40 万**（且计量对象由「事件数」改为 `rows.length`）。"
    "**三、🔴 顺带抓到并修掉一条被本次改动「激活」的潜伏缺陷（键域）**：旧桥把 `event.symbol` **同时**"
    "写进 `securityId` 与 `code`，并注释断言「`ds_*` 的 symbol 与 `ResearchDatasetRow.securityId` 键域一致」"
    "—— **该断言是错的**：`researchDataset/types.ts` 里 `securityId` 是**身份**、`code` 才是「该日生效完整代码」，"
    "canonical 身份 = `sec_<uuid>`（`research_securities` 注释 + 重建路径 `loadSecurities` 实产）；"
    "而 `ds_*` 三表**只有 `symbol`**。此前 `executionBarsAvailable` 恒 false ⇒ 直读从不真被使用，缺陷潜伏；"
    "本次让直读成为默认路径后它**立即**把成交明细/留档的键域变成代码域 ⇒ `researchRun.securityLabels` 与前端 "
    "`useSecurityLabels` 全部查空（名称退化为「—」）。**修法**：新增 `resolveSecurityIdsByEvent`，"
    "经 **Identifier History 显式桥接**（复用既有单一实现 `security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`，"
    "asOf-aware、PIT-safe、歧义即拒；**逐事件按自己的 `tradeDate` 解析**以正确处理 code reuse），"
    "失败抛 `REGISTRY_SECURITY_IDENTITY_UNRESOLVED`（**不退回用代码冒充身份**）；去重键与 `memberKeys` 一并改为身份域。"
    "**四、🔴 数据面两条真实矛盾（如实登记、不编造取舍）**：(a) **前收来源不一致** —— 同一交易日既是某事件 `rd=0`、"
    "又是另一事件 `rd≥1` 时两处前收基准不同（实库 **15 / 112,920 键 = 0.0133%**，样例 `601236.SH@2024-10-11`："
    "`8.33` vs `8.38`；**OHLCV 本身完全一致**）⇒ 前收**不是行的身份**，改为**派生列**：不参与严格冲突判定，"
    "确定性取基准行（rd 最小）的值并**如实登记** `PRECLOSE_SOURCE_MISMATCH` + `stats.preCloseMismatchKeys`；"
    "`REGISTRY_WINDOW_ROW_CONFLICT` 只保留给 `open/high/low/close/volume/amount`（严格列 = 行的身份）。"
    "(b) **观察日换手/市值必为 null** —— `ds_*_post` 的 DDL 只承载原始日线（结构性 PIT 防线，"
    "`plugins.ts#rawBarCreateSql`），event 级富集列**不可外推**（外推 = 编数据）⇒ `rd≥1` 行 "
    "`turnoverRate` / `circulationMarketCap` / `totalMarketCap` 一律 null + `knowledge.liquidity = \"UNKNOWN\"`（进 `gateNotes`）。"
    "**五、实证（走网页同一条服务端路径，真实 tRPC + 真库）**：新探针 `_probe_dataset_window_run_e2e.mts`"
    "（`cand-360004@1.0.0`，窗口 `2025-01-02~2025-03-31`，14.3s）**✅ ALL PASS / 0 失败** —— "
    "`datasetSource=\"registry\"`、`datasetSourceNote=null`、`datasetVersionId=390002`、面板 **112,920 行 / 2,967 证券**"
    "（旧投影恒 23,978 行）、`backtest` 阶段 `EXECUTED`、**真实成交 35 笔**（修复前 registry 路径恒 **0 笔 / 全 SUSPENDED**）、"
    "期末权益 73,207.86 ≠ 初始 100,000 ⇒ 撮合真实发生；**身份域**：35/35 成交键全为 `sec_<uuid>`（「代码形态」条数 = **0**）、"
    "经权威 `researchRun.securityLabels` 解析 **35/35 = 100%**、板块分布 `{main: 35}`、带名称 35/35；"
    "留档 1 行、自清理 0 残留。**成本实测**（`_probe_bridge_window_cost.mts`）：全窗口直读 ≈ **16.5s**，"
    "仍比重建（60.6s）快 ~**3.7×**。"
    "**六、验收三件套**：`npx tsc --noEmit` **exit 0**；全量 `npx vitest run` "
    "**4,003 通过 / 16 失败 / 失败文件集合 = 精确既有 7 基线、零新增**；`npx vite build` **RC=0**（3,030 模块 / 13.97s）；"
    "新增 `tests/server/runWorkbenchAssembly/windowProjection.test.ts` **18 例全过**（窗口解析 5 + 面板投影 9 + 身份桥接 4）。"
    "**七、边界与诚实登记**：① `entry.observationWindow` 是否**在策略运行链路被真正消费**尚未直接取证"
    "（e2e 的「rd=0 不进决策日 + 35 笔成交」是间接证据）；② 实测 38 行 `post` OHLCV 全 null 的**停牌行**未特殊处理"
    "（`postRange` 只看 rd 范围、不看 null 比例）；③ 15 个前收不一致键的**根因**（上游 2024-10-11 旧收盘口径）未修，"
    "桥层只做确定性取舍 + 如实登记；④ 窗口末持仓以 `openAtEnd` 收尾（「数据集只覆盖事件窗口」的固有边界）；"
    "⑤ `prefix` 的 rd<0 与 `post` 的 rd>end+1 仍**不进 `rows`**（既不构成决策日、也非执行日）。"
    "零迁移、零新端点、零新依赖。详见 §44.5 第 9an 条 / `ROADMAP-CHANGELOG.md` 15:05 条。"
)

# ---------------------------------------------------------------------------
# §44.5 队列条目（单行）
# ---------------------------------------------------------------------------
S445 = (
    "   - **9an. （闭环回测线 · `DATASET-WINDOW-PROJECTION-001` + `SECURITY-ID-DOMAIN-001`）"
    "运行**真正从绑定数据集取数**（不再每次回落重建）+ 修掉直读桥键域缺陷（`securityId` 用代码冒充 `sec_<uuid>`）** "
    "✅ **已完成（2026-09-14 15:05 GMT+8，CODE_READY）**：触发 = 用户「**策略运行的时候是需要从数据集中取数据啊**」。"
    "**根因** = 投影口径过窄（旧桥只投 `prefix` 的 rd=0，每事件恰 1 行 = 23,978 行 ⇒ `executionBarsAvailable=false` "
    "⇒ `assemble.ts#resolveDataset` 必然回落 `buildResearchDataset` 回查 `stock_daily_prices`/`liquidity_daily`）；"
    "**数据一直在**（`ds_*_post` rd∈[1,20] 471,816 行 OHLCV 完整、rd=+1 覆盖全部 23,978 事件、重复组 close 极差合计 0）。"
    "**修复**：`buildWindowRows` 投影 `rd=0`（特征基准）+ `rd ∈ [1, observationWindow.end+1]`（观察日 + 次日执行日）、"
    "**决策日资格 = `rd ∈ [start,end]`**（rd=0 不进决策日）；观察窗口**必须由策略声明**（未声明/非法/超 post 容量一律抛错，"
    "不夹取不代猜）；护栏 20 万 → **40 万**（计量对象改 `rows.length`）；`preClose` 由「严格列」降为**派生列**"
    "（实库 15/112,920 键来源不一致，含 `REGISTRY_WINDOW_ROW_CONFLICT` 的 OHLCV 严格判定保留）；"
    "身份经 `security/engineKeyBridge.ts#resolveSecurityIdByEngineKey` **显式桥接**（逐事件按自身 tradeDate，处理 code reuse），"
    "失败抛 `REGISTRY_SECURITY_IDENTITY_UNRESOLVED`。**实证**：`_probe_dataset_window_run_e2e.mts` **ALL PASS / 0 失败** —— "
    "`datasetSource=registry` / `note=null` / `versionId=390002` / 面板 **112,920 行 / 2,967 证券** / "
    "**真实成交 35 笔**（修复前恒 0 笔全 SUSPENDED）/ 期末 73,207.86;成交键 **35/35 全 `sec_<uuid>`**、"
    "`securityLabels` 解析 **35/35**、板块 `{main: 35}`。**验收**：`tsc` 0 / 全量 `vitest` 失败文件集合 **零新增**（7 基线）/ "
    "`vite build` 0；新增 `windowProjection.test.ts` **18 例全过**。**未决**：① `entry.observationWindow` 是否在运行链路"
    "被真正消费尚未直接取证；② 停牌行（post OHLCV 全 null 实测 38 行）未特判；③ 前收不一致根因（上游旧收盘口径）未修。"
)

# ---------------------------------------------------------------------------
# ROADMAP-CHANGELOG.md 条目（append）
# ---------------------------------------------------------------------------
SCHANGELOG = (
    "\n- **2026-09-14 15:05** — **WORK DATASET-WINDOW-PROJECTION-001 + SECURITY-ID-DOMAIN-001："
    "运行真正从绑定数据集取数 + 直读桥键域修正（`server/**` 3 文件 + `client/**` 0 改动；零迁移、零新端点、零新依赖）**。"
    "触发 = 用户「**策略运行的时候是需要从数据集中取数据啊**」（纠正上一轮把「每次运行都回落重建」当既成事实的登记）。"
    "**一、先核实命题**：`dataset_version.id=390002` 的 `ds_*_post`（rd≥1）实查 **471,816 行完整 OHLCV**、"
    "rd=+1 覆盖全部 23,978 事件；rd ∈ [0,20] 合成逐日面板 = **354,544 行**；102,727 个重复 `(symbol, tradeDate)` 组 "
    "`close` 极差合计 = **0** ⇒ 数据一直在，是**投影口径过窄**（旧桥只投 `prefix` rd=0 = 23,978 行 ⇒ "
    "`executionBarsAvailable=false` ⇒ 必然回落重建）。"
    "**二、口径（用户裁定「按观察窗口投影」）**：面板 = `rd=0`（首板日，`pullbackFeatures` 的特征基准）+ "
    "`rd ∈ [1, observationWindow.end+1]`（观察日 + 次日执行日）；**决策日资格 = `rd ∈ [start,end]`**"
    "（`rd=0` 不进决策日 —— 否则首板日当天 bars 只有一根，特征退化为 `volumeRatio=1`/`haircut=intraday`）；"
    "`end+1` 是撮合最小充分条件（`simulator/engine.ts` 第 9(c) 步在决策日**下一交易日**取执行 bar）。"
    "窗口**只认策略声明** `definition.entry.observationWindow`：未声明 → `REGISTRY_OBSERVATION_WINDOW_UNDECLARED`、"
    "非法 → `..._INVALID`、超 post 容量 → `POST_WINDOW_TOO_SHORT`（**不夹取、不代猜**）；"
    "`REGISTRY_BRIDGE_MAX_ROWS` 200,000 → **400,000**，计量对象由「事件数」改为 `rows.length`（原先误按事件数计量）。"
    "**三、🔴 被本次改动「激活」的潜伏缺陷（键域）**：旧桥 `securityId: event.symbol` + `code: event.symbol`，"
    "并注释断言「`ds_*` symbol 与 `ResearchDatasetRow.securityId` 键域一致」——**断言是错的**："
    "`ResearchDatasetRow.securityId` 是**身份**（canonical `sec_<uuid>`，见 `research_securities` 注释与重建路径 "
    "`loadSecurities`），`code` 才是「该日生效完整代码」；`ds_*` 三表**只有 `symbol`**。此前恒回落 ⇒ 缺陷从不执行；"
    "本次直读成为默认路径后**立即**让成交明细/留档键域变代码域 ⇒ `researchRun.securityLabels` / 前端 `useSecurityLabels` 全查空。"
    "**修法** = 新增 `resolveSecurityIdsByEvent`，经 **Identifier History 显式桥接**（复用既有单一实现 "
    "`security/engineKeyBridge.ts#resolveSecurityIdByEngineKey`；逐事件按**自身** `tradeDate` 解析以处理 code reuse），"
    "失败抛 `REGISTRY_SECURITY_IDENTITY_UNRESOLVED`（**不退回用代码冒充身份**）；去重键与 `memberKeys` 改身份域；"
    "并订正 `datasetFromRegistry.ts` 模块头的错误断言。实库取证 `_probe_symbol_identity_coverage.mts`："
    "2,967 个 distinct symbol **100%** 可在事件日解析到唯一 `sec_<uuid>`，标识历史仅 **5,552 行**（1.1s 可载入）。"
    "**四、数据面两条真实矛盾（如实登记、不编造）**：(a) **前收来源不一致** 15/112,920 键 = **0.0133%**"
    "（样例 `601236.SH@2024-10-11`：`8.33` vs `8.38`；**OHLCV 本身一致**）⇒ `preClose` 由严格列降为**派生列**"
    "（确定性取基准行值 + `gateNotes` 登记 `PRECLOSE_SOURCE_MISMATCH` + `stats.preCloseMismatchKeys`），"
    "`REGISTRY_WINDOW_ROW_CONFLICT` 只保留给 `open/high/low/close/volume/amount`；"
    "(b) **观察日换手/市值必为 null**（`ds_*_post` DDL 只承载原始日线 = 结构性 PIT 防线，外推 = 编数据）"
    "⇒ 如实记 `OBSERVATION_DAY_LIQUIDITY_UNKNOWN` / `knowledge.liquidity=\"UNKNOWN\"`。"
    "**五、实证（走网页同一条服务端路径）**：`docs/evidence/_probe_dataset_window_run_e2e.mts` **✅ ALL PASS / 0 失败**"
    "（`cand-360004@1.0.0`，`2025-01-02~2025-03-31`，14.3s）：`datasetSource=\"registry\"`、`datasetSourceNote=null`、"
    "`datasetVersionId=390002`、面板 **112,920 行 / 2,967 证券**、`backtest=EXECUTED`、**成交 35 笔**、"
    "期末 73,207.86 ≠ 初始 100,000；**身份域**：35/35 成交键全 `sec_<uuid>`（代码形态 = 0）、"
    "`securityLabels` **35/35 = 100%**、板块 `{main: 35}`、带名称 35/35；留档 1 行、自清理 0。"
    "成本：全窗口直读 ≈ **16.5s** vs 重建 **60.6s**（~3.7×）。"
    "**六、验收**：`npx tsc --noEmit` **exit 0**；全量 `npx vitest run` **4,003 passed / 16 failed / "
    "失败文件集合 = 既有 7 基线（dataHealth / image.uploadAndRecognize / limitUp / limitUp.watch / marketData / "
    "tushare.secret / tushareTradingCalendar）零新增**；`npx vite build` **RC=0**（3,030 模块 / 13.97s）；"
    "新增单测 `tests/server/runWorkbenchAssembly/windowProjection.test.ts` **18 例全过**"
    "（窗口解析 5 + 面板投影 9 + 身份桥接 4）。"
    "**七、诚实登记（未决）**：① `entry.observationWindow` 在运行链路是否被真正消费尚未直接取证；"
    "② `post` 停牌行（OHLCV 全 null，实测 38 行）未特判；③ 前收不一致根因（上游 2024-10-11 旧收盘口径）未修；"
    "④ 窗口末持仓以 `openAtEnd` 收尾；⑤ `prefix` rd<0 与 `post` rd>end+1 仍不进 `rows`。"
    "**八、边界**：`server/**` 3 文件（`datasetFromRegistry.ts` 主改 + `assemble.ts` 文档与窗口传递）+ 证据/测试；"
    "`client/**` **零改动**（`rebuildScope` 提示只在 `datasetSource === \"rebuild\"` 时计算 ⇒ 现在不触发，属预期）；"
    "零迁移 / 零新端点 / 零新依赖；改前已确认在途 `inFlightRunCount=0`。见 `ROADMAP.md` §44 / §44.5 第 9an 条。\n"
)


def patch(path: Path, *, must_contain: list[str], transform, keepends_check: str):
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    before_len = len(text)
    for marker in must_contain:
        assert marker in text, f"{path.name}: 缺少锚点 {marker!r}"
    new_text = transform(text)
    assert new_text != text, f"{path.name}: 未发生改动"
    assert len(new_text) > before_len, f"{path.name}: 未增长"
    path.write_bytes(new_text.encode("utf-8"))
    # 回读断言
    back = path.read_bytes().decode("utf-8")
    crlf = back.count("\r\n")
    lf = back.count("\n") - crlf
    if keepends_check == "crlf":
        assert lf == 0, f"{path.name}: 出现裸 LF（{lf}）"
    else:
        assert crlf == 0, f"{path.name}: 出现 CRLF（{crlf}）"
    print(f"OK {path.name}: {before_len} -> {len(back)} chars (crlf={crlf} lf={lf})")


# --- 1) ROADMAP.md：§44 插入 + §44.5 插入（一次读、一次写）----------------
anchor44 = "> 上轮实查：**2026-09-14 14:26 GMT+8"
anchor445 = "   - **9am. （闭环回测线 · `DATASET-SCOPE-INHERIT-001`）"
assert S44.count("\n") == 0, "S44 必须是单行"
assert S445.count("\n") == 0, "S445 必须是单行"
assert "9an" not in S445.split("、")[0] or True


def transform_roadmap(text: str) -> str:
    # §44：插在最新条目之前
    idx44 = text.index(anchor44)
    line_start44 = text.rfind("\n", 0, idx44) + 1
    text = text[:line_start44] + S44 + "\r\n>\r\n" + text[line_start44:]
    # §44.5：插在 9am 条目之后（9am 条目是单行，取其行尾 \r\n 之后）
    idx445 = text.index(anchor445)
    line_end445 = text.index("\r\n", idx445) + 2
    text = text[:line_end445] + S445 + "\r\n" + text[line_end445:]
    return text


patch(
    ROOT / "ROADMAP.md",
    must_contain=[anchor44, anchor445, "9an" not in "x" and "# 44. 项目真实状态映射"],
    transform=transform_roadmap,
    keepends_check="crlf",
)

# --- 2) ROADMAP-CHANGELOG.md：append ---------------------------------------
patch(
    ROOT / "ROADMAP-CHANGELOG.md",
    must_contain=["## 更新记录（append-only）"],
    transform=lambda t: t + SCHANGELOG,
    keepends_check="lf",
)

print("DONE")
