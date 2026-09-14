# -*- coding: utf-8 -*-
"""把 PAPER-TRADING-ADVANCE-NOOP-001 的细则写进 PROJECT_RULES.md。

两处：
  1) 「数据源与回填」补一条（`index_daily` 无自动同步 + `backfillIndex` 30 天误判 + `--force`）
  2) 文件末尾新增一节（推进恒 no-op / 三态诊断 / 建运行前置守卫 / UI 不得谎报）
纪律：PROJECT_RULES.md 纯 LF ⇒ read_bytes().decode() + write_bytes()，写后回读断言。
"""
from pathlib import Path

ROOT = Path(r"C:\work\sourcecode\stock-limit-up-analyzer")
TARGET = ROOT / ".workbuddy" / "memory" / "PROJECT_RULES.md"

# --- 1) 「数据源与回填」补一条 ---------------------------------------------
ANCHOR_DS = "- **行情对位索引**一律"
DS_LINE = (
    "- 🔴 **`index_daily` 全仓无自动同步**：它是**前向纸面交易推进 / 回测的交易日历唯一来源**，"
    "但**只有手动脚本 `scripts/backfillIndex.ts` 写入**（没有任何定时同步）⇒ 它一停更，"
    "推进就**静默恒 no-op**（详见下节 `PAPER-TRADING-ADVANCE-NOOP-001`）。"
    "补数**必须加 `--force`** —— `isCoverageFresh` 容忍「末端相差 ≤ 30 天」即判「已覆盖」⇒ "
    "默认会**误判为无需回填**；补完必须复核「`index_daily` 末端 == 行情末端」。\n"
)

# --- 2) 末尾新增一节 -------------------------------------------------------
SECTION = (
    "\n## 🔴 前向纸面交易「推进」恒 no-op 却报成功（PAPER-TRADING-ADVANCE-NOOP-001 · 2026-09-14 实查）\n"
    "\n"
    "- 🔴 **前向推进的交易日历唯一来源 = `index_daily`**（`server/db.ts#loadBacktestTradingDates` 取 "
    "`distinct tradeDate`），**刻意与候选价格行解耦** —— 它只回答「哪些日子是可推进的市场日」；"
    "若改成从个股价格行取，某些标的停牌 / 窗口不连续就会让**全局持仓推进链断掉**。"
    "⇒ **改推进逻辑前，先确认这张表的新鲜度**。\n"
    "- 🔴 **症状学（症状 = 「推进按钮提示成功但什么都没变」）**：**第一件事**是比对三个末端 —— "
    "`index_daily` vs `stock_daily_prices` vs `limit_up_records`（探针 `docs/evidence/_probe_paper_trading_state.mts`，只读）。"
    "2026-09-14 实查：`index_daily` 停更在 **2026-09-04**（`retrievedAt=2026-09-06 09:22:54`），"
    "而另两表已到 **2026-09-14** ⇒ 日历落后 **6 个交易日**；两条运行 `lastProcessedDate`（09-10 / 09-14）"
    "**均在日历末端之后**，且 **`updatedAt == createdAt`** = 「首次创建后从未成功落过新状态」的铁证。\n"
    "- 🔴 **「空推进」必须分两种情况，不得都报成功**：① `already-latest`（本来就已最新，正常）；"
    "② `calendar-stale`（日历落后行情，**是缺陷**）。判据 = `marketLastDate > calendarLastDate`"
    "（**行情末端才是参照物** —— 「日历该不该更长」只能由行情回答）。"
    "唯一实现 = `server/paperTrading.ts#classifyAdvanceKind()`（**纯函数、零 IO**，可被单测与真实 E2E 双向驱动），"
    "产物 = `paperTradingAdvanceDiagnosis()` 的 `kind` + 人话 `message`。\n"
    "- 🔴 **建运行必须前置拒绝「越界锚点」**：新建运行的锚点取「最新涨停信号日」（与价格表对齐），"
    "**可以越过日历末端** ⇒ 一创建就是「注定推不动」的孤儿运行。`db.ts#createPaperTradingRun` 在 "
    "`signalDate > calendarLastDate`（或日历为空）时抛 `PaperTradingCalendarStaleError`"
    "（`code = \"PAPER_TRADING_CALENDAR_STALE\"`），**不落库**。\n"
    "- 🔴 **领域码跨 tRPC 边界只能靠 `message`**（既有铁律的又一次应用）：`toTrpcError` **只透传 `message`、"
    "不带 `cause`** ⇒ 必须把码写成 `[PAPER_TRADING_CALENDAR_STALE] <原文>`，前端才抠得到"
    "（`rpcErrorToDigest`，正则 `/[([A-Z_]{3,})]/`）。\n"
    "- 🔴 **前端不得把「成功」当默认结论**：`PaperTrading.tsx#advanceMutation.onSuccess` 按 `diagnosis.kind` **分流**"
    "（`calendar-stale → toast.warning` + 页面内三色 `advanceNotice` 横幅 / `advanced → success` / 其余 `info`）。"
    "**凡是服务端已能如实说出原因的情形，UI 都不许一律报成功。**\n"
    "- 落点：`tests/server/paperTrading.test.ts`（**22 例** = 原 10 + 新增 12：三态判定 5，含事故现场常量 "
    "`CALENDAR_END=2026-09-04` / `MARKET_END=2026-09-14`；人话结论 6；错误类 1）；"
    "e2e `docs/evidence/_probe_paper_advance_e2e.mts`（真实 tRPC **17/17**，⚠️ **会写入** `paper_trading_runs`）；"
    "建运行正向 `docs/evidence/_probe_paper_create_guard.mts`（**5/5**，按命名域自清理）。\n"
    "- ⚠️ **未取证**：建运行守卫的**反向分支**（日历真落后 ⇒ 真抛 `PAPER_TRADING_CALENDAR_STALE`）"
    "需**篡改日历数据**才能构造，本轮未取证；已证的是**正向路径不受影响**（不会误锁新建运行）。\n"
    "- **排查顺序（推进后什么都没变）**：① 三个末端是否一致 → ② `stateJson.lastProcessedDate` 是否已在末端之后 → "
    "③ `updatedAt == createdAt` 是否说明「从未落过新状态」→ ④ 建运行锚点是否越界。\n"
)


def patch(*, transform, must_contain: list[str], keepends_check: str, expect_endswith: str | None = None):
    raw = TARGET.read_bytes()
    text = raw.decode("utf-8")
    before_len = len(text)
    for marker in must_contain:
        assert marker in text, f"缺少锚点 {marker!r}"
    new_text = transform(text)
    assert new_text != text, "未发生改动"
    assert len(new_text) > before_len, "未增长"
    TARGET.write_bytes(new_text.encode("utf-8"))
    back = TARGET.read_bytes().decode("utf-8")
    crlf = back.count("\r\n")
    lf = back.count("\n") - crlf
    if keepends_check == "lf":
        assert crlf == 0, f"出现 CRLF（{crlf}）"
    else:
        assert lf == 0, f"出现裸 LF（{lf}）"
    if expect_endswith:
        assert back.endswith(expect_endswith), "末尾断言失败"
    print(f"OK {TARGET.name}: {before_len} -> {len(back)} chars (crlf={crlf} lf={lf})")
    return back


# Step 1：数据源与回填补一条
_must = [ANCHOR_DS, "## 数据源与回填", "## 🔴 数据完整性（001/002/003）"]
assert DS_LINE.count("\n") == 1, "DS_LINE 应为单行 + 结尾换行"
assert "index_daily" not in TARGET.read_bytes().decode("utf-8"), "index_daily 已在此文件中出现，锚点假设失效"


def t1(text: str) -> str:
    idx = text.index(ANCHOR_DS)
    line_end = text.index("\n", idx) + 1
    return text[:line_end] + DS_LINE + text[line_end:]


back1 = patch(transform=t1, must_contain=_must, keepends_check="lf")
assert back1.count(DS_LINE) == 1
# 该条目必须落在「数据源与回填」与「数据完整性」之间
assert back1.index("## 数据源与回填") < back1.index(DS_LINE) < back1.index("## 🔴 数据完整性（001/002/003）")

# Step 2：末尾新增一节
SECTION_END = "- **排查顺序（推进后什么都没变）**："
back2 = patch(
    transform=lambda t: t + SECTION,
    must_contain=["## 🔴 成交 / 数据键域 = canonical `sec_<uuid>`（SECURITY-ID-DOMAIN-001 · 2026-09-14 实查）"],
    keepends_check="lf",
    expect_endswith="④ 建运行锚点是否越界。\n",
)
assert back2.count("## 🔴 前向纸面交易「推进」恒 no-op 却报成功") == 1
assert SECTION_END in back2

print("DONE")
