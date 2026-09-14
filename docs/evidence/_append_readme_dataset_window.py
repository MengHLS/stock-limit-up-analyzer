# -*- coding: utf-8 -*-
"""docs/evidence/README.md 追加 `datasetwindow` 分组（纯 LF，append-only）。"""
from pathlib import Path

P = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\docs\evidence\README.md")

NEW = """
### `datasetwindow` —— 6 组（2026-09-14：运行**真正从绑定数据集取数** + 直读桥键域修正）

> 触发 = 用户「**策略运行的时候是需要从数据集中取数据啊**」（纠正上一轮把「每次运行都回落重建」当既成事实的登记）。
> 核心事实：**数据一直在** —— `ds_*_post`（rd≥1）实测 **471,816 行完整 OHLCV**、rd=+1 覆盖全部 23,978 个事件；
> 是**投影口径过窄**（旧桥只投 `prefix` 的 rd=0，每事件恰 1 行 = 23,978 行 ⇒ `executionBarsAvailable=false` ⇒ 必然回落重建）。
> 顺带抓到并修掉一条被本次改动**激活**的潜伏缺陷：旧桥把代码同时写进 `securityId` 与 `code`（键域违规）。

| 文件 | 结论要点 | 被引用于 |
|---|---|---|
| `_probe_dataset_window_coverage.mts` | ✅ 证数据集**有**撮合行情：post rd∈[1,20] **471,816 行**；rd=+1 覆盖全部 23,978 事件；rd∈[0,20] 合成逐日面板 **354,544 行**；**102,727** 个重复 `(symbol, tradeDate)` 组的 `close` 极差合计 **= 0** ⇒ 无损去重 | §44 / §44.5 `9an` / `PROJECT_RULES.md` |
| `_probe_bridge_window_cost.mts` | 成本实测：全窗口直读 ≈ **16.5s** vs 重建 **60.6s**（~**3.7×**）；旧口径（仅 rd=0）1.8s / 23,978 行；护栏由 20 万提到 **40 万**（计量对象改 `rows.length`） | 同上 |
| `_probe_symbol_identity_coverage.mts` + `.log` | ✅ **100%（2,967 / 2,967）** 事件 symbol 可在其事件日解析到唯一 `sec_<uuid>`（`NO_IDENTIFIER=0` / `AMBIGUOUS=0`）；`research_security_identifier_history` 仅 **5,552 行**、1.1s 可全量载入 | 同上 |
| `_probe_symbol_identity_bridge.mts` + `.log` | 键域分叉的证据基础：`ds_*` 三表**只有 `symbol`（代码域）**、canonical 身份在 `research_securities.securityId`（`sec_<uuid>`）；`ResearchDatasetRow` 的 `securityId`（身份）与 `code`（完整代码）是**两个字段** | 同上 |
| `_probe_dataset_window_run_e2e.mts` + `.json` + `.log` | ✅ **ALL PASS / 0 失败**（真实 tRPC `loopRun`，`cand-360004@1.0.0`，14.3s）：`datasetSource="registry"` / `note=null` / `versionId=390002` / 面板 **112,920 行 / 2,967 证券** / `backtest=EXECUTED` / **真实成交 35 笔**（修复前恒 **0 笔 / 全 SUSPENDED**）/ 期末 73,207.86；**身份域**：35/35 成交键全 `sec_<uuid>`（「代码形态」= **0**）、`researchRun.securityLabels` 解析 **35/35 = 100%**、板块 `{main: 35}`；留档 1 行、自清理 **0** | 同上 |
| `tests/server/runWorkbenchAssembly/windowProjection.test.ts`（**不在本目录**，登记于此便于溯源） | ✅ **18/18**：窗口解析 5（未声明 ⇒ null / 合法 / 非 `TRADING_DAY` / 五种非法值 / 非对象）+ 面板投影 9（rd 0..4、**决策日资格 = rd∈[1,3]**、`preClose` 链式、观察日流动性 null、**重叠无损合并**、数值冲突即抛 `REGISTRY_WINDOW_ROW_CONFLICT`、缺中间相对日、**`securityId` 取自身份映射且 `code ≠ securityId`**、缺身份即抛）+ 身份桥接 4（区间内/外、**code reuse**、歧义即拒、非法 symbol） | 同上 |

> 归档脚本（同轮）：`_append_archive_dataset_window.py`（`ROADMAP.md` §44 插入 + §44.5 `9an` + `ROADMAP-CHANGELOG.md` append）、
> `_append_rules_dataset_window.py`（`PROJECT_RULES.md` 追加两节：数据集窗口投影 / 键域 = `sec_<uuid>`）。
"""

raw = P.read_bytes()
text = raw.decode("utf-8")
assert "\r\n" not in text, "README.md 应为纯 LF"
assert text.endswith("\n"), "README.md 应以换行结尾"
assert "datasetwindow" not in text, "该分组已存在，勿重复追加"
before = len(text)
new_text = text + NEW
assert new_text != text
P.write_bytes(new_text.encode("utf-8"))
back = P.read_bytes().decode("utf-8")
assert "\r\n" not in back
assert "datasetwindow" in back and "_probe_dataset_window_run_e2e.mts" in back
print(f"OK README.md: {before} -> {len(back)} chars")
