# -*- coding: utf-8 -*-
"""追加「前向纸面交易闭环 · 推进按钮永远 no-op」诊断（append-only，纯 LF，双向断言）"""
from pathlib import Path

LOG = Path(r"C:\work\sourcecode\stock-limit-up-analyzer\.workbuddy\memory\2026-09-14.md")

LOG_NEW = """
## 17:15 GMT+8 — 「前向交易闭环 · 推荐/推进按钮有点问题」诊断（只诊断，未改代码）

**用户输入**：「前向交易闭环，推荐按钮有点问题」。仓库内**没有任何按钮**字面叫「推荐」⇒ 按谐音与页面匹配
定位到 `/paper-trading`（h1 =「前向纸面交易闭环」）的**「推进」/「推进到最新」**按钮。

### 一、结论：不是 UI 故障，是**结构性 no-op** ——「推进」今天必然什么都不做

`db.ts#advancePaperTradingRunToLatest` 的推进集合 = `tradingDates.filter(d => d > lastProcessedDate)`，
而 `tradingDates` 来自 **`index_daily`**（`loadBacktestTradingDates`，与候选价格行刻意解耦）。

| 源 | 最大日期 | distinct 日数 | 最后写入 |
| --- | --- | --- | --- |
| `index_daily`（日历唯一来源） | **2026-09-04** | 1,863 | `retrievedAt = 2026-09-06 09:22:54` |
| `stock_daily_prices` | 2026-09-14 | 1,869 | —— |
| `limit_up_records` | 2026-09-14 | 1,869 | —— |

⇒ 日历末端（09-04）**早于**两条运行各自的 `lastProcessedDate`（`#1` = 09-10、`#30001` = 09-14）
⇒ `datesToAdvance = []` ⇒ **推进恒 no-op**，且 `advancePaperTradingRunToLatest` 此时**静默返回当前摘要**，
前端 `advanceMutation.onSuccess` 无条件 `toast.success("已推进到最新交易日")` ⇒ **提示与事实相反**。

### 二、实证（`docs/evidence/`，均只读、未写库）

- `_probe_paper_trading_state.mts`：2 条运行，**`updatedAt == createdAt`**（从未成功落过一次新状态）；
  `orders=0` / `equityCurve=0` / `pendingBuys=5`（`#1` 锚在 09-10、`#30001` 锚在 09-14）。
- `_probe_paper_trading_advance_dryrun.mts`（**内存干跑**同一推进循环，不 persist）：
  两条运行 `tradingDatesTail = [… 09-01, 09-02, 09-03, **09-04**]`、`datesToAdvance = []`、`perDay = []`。
- `_probe_index_daily_freshness.mts`：`index_daily` 仅 **4 个指数**（`000001.SH` / `000300.SH` / `000905.SH` / `399001.SZ`），
  09-02~09-04 各 **4 行**；`stock_daily_prices` 同期 09-07 起仅 **456~504** 只（= 候选/自选域，不是全市场）。

### 三、三层原因

1. **数据面（直接原因）**：`index_daily` 由**手动脚本** `scripts/backfillIndex.ts` 写（BaoStock），
   **最后跑于 2026-09-06** ⇒ 09-07 起 6 个交易日缺失。项目**没有**指数日线的定时任务。
2. **代码面（让故障不可见）**：推进在「无可推进日期」时不区分「已是最新」与「日历滞后」，
   一律返回旧摘要；前端不看返回值就报成功 ⇒ **UI 撒谎**（与昨日「空态不得撒谎」同源）。
3. **建运行面（放大）**：`createPaperTradingRun` 把 `lastProcessedDate` 设为**最新涨停日**（09-14），
   而它已**越出日历末端**（09-04）⇒ 新建运行**从第一秒起就不可能推进**（用户 09:01 建的 `#30001` 即如此）。

### 四、未做（等用户裁定）

- 未跑补数（需 BaoStock 会话，且单账号单会话）。
- 未改任何 `server/**` / `client/**`（本轮为只读诊断）。
- 未向用户确认「推荐」是否确指「推进」——已就「按钮 / 现象」两问征询。
"""

raw = LOG.read_bytes()
text = raw.decode("utf-8")
assert "\r\n" not in text, "日志应为纯 LF"
assert "17:15 GMT+8" not in text, "该节已存在，勿重复追加"
assert "16:2" not in text[-400:], "尾部异常"
before = len(text)
new_text = text.rstrip("\n") + "\n" + LOG_NEW
LOG.write_bytes(new_text.encode("utf-8"))
back = LOG.read_bytes().decode("utf-8")
assert "\r\n" not in back
assert "推进恒 no-op" in back and "17:15 GMT+8" in back
print(f"OK 2026-09-14.md: {before} -> {len(back)} chars")
