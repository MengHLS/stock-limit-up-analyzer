import os, sys, json
sys.path.insert(0, 'scripts/providers')
import tushare
ts = tushare.pro_api(os.environ.get('TUSHARE_TOKEN', 'cee1f03cab70c0b222a1c1083517814ec3c29551627f79ac6ecdad22'))
try:
    df = ts.daily_basic(ts_code='000001.SZ', start_date='20240801', end_date='20240810', fields='ts_code,trade_date,turnover_rate,circ_mv,total_mv,amount,vol')
    print(json.dumps(df.to_dict('records'), ensure_ascii=False))
except Exception as e:
    print(f"ERR: {e}")