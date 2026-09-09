#!/usr/bin/env python3
"""
BaoStock provider bridge (STEP 7.6).

Commands:
  index_daily <baostock_code> <start> <end>  -> JSON [{date,open,high,low,close,volume,amount}]
  stock_daily <baostock_code> <start> <end>  -> JSON [{date,open,high,low,close,volume,amount,turn,tradestatus}]
  stock_basic                                -> JSON [{code,name,ipoDate,outDate,type,status}]
  stock_industry <baostock_code>             -> JSON {updateDate,code,code_name,industry,industryClassification} | null

Units (BaoStock): volume=股, amount=元, turn=%. Output is raw provider values; the TS adapter
performs canonical unit normalization (股→手, 元→千元).
"""
import sys
import json
import io
import contextlib
from datetime import datetime, timedelta

import baostock as bs

# BaoStock query_history_k_data_plus 单次最多返回约 4000 行；长上市股票（>16 年）
# 全量日线会超出，因此按「约 5 年」切片分页，避免静默截断。
PAGED_CHUNK_DAYS = 5 * 365


def login():
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"baostock login failed: {lg.error_msg}")


def query_k(code, start, end, fields):
    rs = bs.query_history_k_data_plus(
        code, fields, start_date=start, end_date=end, frequency="d", adjustflag="3"
    )
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query failed: {rs.error_msg}")
    rows = []
    while (rs.error_code == "0") and rs.next():
        rows.append(rs.get_row_data())
    return rows


def query_k_paged(code, start, end, fields):
    """按约 5 年切片分页查询日线，绕过单次 4000 行上限；切片连续无重叠。"""
    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    rows = []
    cursor = start_dt
    while cursor <= end_dt:
        chunk_end = min(cursor + timedelta(days=PAGED_CHUNK_DAYS), end_dt)
        rows.extend(query_k(code, cursor.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d"), fields))
        cursor = chunk_end + timedelta(days=1)
    return rows


def cmd_index_daily(code, start, end):
    rows = query_k(code, start, end, "date,open,high,low,close,volume,amount")
    return [
        {
            "date": r[0],
            "open": r[1],
            "high": r[2],
            "low": r[3],
            "close": r[4],
            "volume": r[5],
            "amount": r[6],
        }
        for r in rows
    ]


def cmd_stock_daily(code, start, end):
    # tradestatus: 1=交易 0=停牌；isST: 1=ST 0=正常。二者为 BaoStock 提供的权威日线字段。
    # 分页查询，避免长上市股票全量日线被单次 4000 行上限截断。
    rows = query_k_paged(code, start, end, "date,open,high,low,close,volume,amount,turn,tradestatus,isST")
    return [
        {
            "date": r[0],
            "open": r[1],
            "high": r[2],
            "low": r[3],
            "close": r[4],
            "volume": r[5],
            "amount": r[6],
            "turn": r[7],
            "tradestatus": r[8],
            "isST": r[9],
        }
        for r in rows
    ]


def cmd_stock_basic():
    rs = bs.query_stock_basic()
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query_stock_basic failed: {rs.error_msg}")
    rows = []
    while (rs.error_code == "0") and rs.next():
        rows.append(rs.get_row_data())
    return [
        {
            "code": r[0],
            "name": r[1],
            "ipoDate": r[2],
            "outDate": r[3],
            "type": r[4],
            "status": r[5],
        }
        for r in rows
    ]


def cmd_stock_industry(code):
    """返回单只证券「当前」证监会行业分类（无历史区间）。无归属时返回 None。"""
    rs = bs.query_stock_industry(code=code)
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query_stock_industry failed: {rs.error_msg}")
    row = None
    if rs.next():
        row = rs.get_row_data()
    if row is None:
        return None
    return {
        "updateDate": row[0],
        "code": row[1],
        "code_name": row[2],
        "industry": row[3],
        "industryClassification": row[4],
    }


def cmd_session():
    """单进程驻留模式：login 一次，stdin 逐行读 JSON 请求，每行回一个 JSON 响应。

    请求行：{"id": 1, "cmd": "stock_daily", "code": "sh.600000", "start": "2019-01-01", "end": "2026-09-04"}
    响应行：{"id": 1, "ok": true, "result": [...]}
             {"id": 1, "ok": false, "error": "..."}

    cmd 支持：stock_daily（同命令行分页查询）/ stock_industry / ping。
    请求级异常不回崩进程（继续处理下一行）；stdin EOF 后 logout 退出。
    相比「每股 spawn 子进程 + login/logout」可消除 5552 次重复登录（BaoStock login 单次 ~1-2s）。
    """
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    with contextlib.redirect_stdout(io.StringIO()):
        login()
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as exc:
                # 非 JSON 控制行（TS 端理论上不发送），以未知 id 响应避免挂起。
                print(json.dumps({"id": -1, "ok": False, "error": f"bad request: {exc}"}, ensure_ascii=False), flush=True)
                continue
            rid = req.get("id")
            try:
                cmd = req["cmd"]
                if cmd == "stock_daily":
                    result = cmd_stock_daily(req["code"], req["start"], req["end"])
                elif cmd == "stock_industry":
                    result = cmd_stock_industry(req["code"])
                elif cmd == "ping":
                    result = "pong"
                else:
                    raise RuntimeError(f"unknown session cmd: {cmd}")
                print(json.dumps({"id": rid, "ok": True, "result": result}, ensure_ascii=False), flush=True)
            except Exception as exc:  # noqa: BLE001 —— 请求级隔离，继续处理下一只
                print(json.dumps({"id": rid, "ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("missing command")
    cmd = sys.argv[1]
    # 驻留会话模式（login 一次 + stdin JSONL 请求循环），供长回填任务复用会话提速。
    if cmd == "session":
        cmd_session()
        return
    # baostock 的 login/logout 会向 stdout 打印 "login success!" / "logout success!"，
    # 会污染 bridge 的 JSON 输出；用 redirect_stdout 吞掉，最后再单独打印 JSON。
    buf = io.StringIO()
    result = None
    with contextlib.redirect_stdout(buf):
        login()
        try:
            if cmd == "index_daily":
                result = cmd_index_daily(sys.argv[2], sys.argv[3], sys.argv[4])
            elif cmd == "stock_daily":
                result = cmd_stock_daily(sys.argv[2], sys.argv[3], sys.argv[4])
            elif cmd == "stock_basic":
                result = cmd_stock_basic()
            elif cmd == "stock_industry":
                result = cmd_stock_industry(sys.argv[2])
            else:
                raise RuntimeError(f"unknown command: {cmd}")
        finally:
            bs.logout()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
