import os, json, sys, time
import tushare
ts = tushare.pro_api(os.environ.get('TUSHARE_TOKEN', 'cee1f03cab70c0b222a1c1083517814ec3c29551627f79ac6ecdad22'))
# 测试全市场一天（5000+ 股单次）
t0 = time.time()
try:
    df = ts.daily_basic(trade_date='20240801', fields='ts_code,trade_date,turnover_rate,circ_mv,total_mv')
    print(f"全市场 daily_basic 一天 rows={len(df)} elapsed={time.time()-t0:.2f}s")
except Exception as e:
    print(f"ERR daily_basic: {e}")
# 测试单股全历史
t0 = time.time()
try:
    df = ts.daily_basic(ts_code='000001.SZ', start_date='20190101', end_date='20240904', fields='ts_code,trade_date,turnover_rate,circ_mv,total_mv')
    print(f"单股 6年 daily_basic rows={len(df)} elapsed={time.time()-t0:.2f}s")
except Exception as e:
    print(f"ERR daily_basic 6y: {e}")
t0 = time.time()
try:
    df = ts.daily(ts_code='000001.SZ', start_date='20190101', end_date='20240904', fields='ts_code,trade_date,vol,amount')
    print(f"单股 6年 daily rows={len(df)} elapsed={time.time()-t0:.2f}s")
except Exception as e:
    print(f"ERR daily 6y: {e}")