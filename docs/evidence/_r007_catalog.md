# Dataset Version 390002 变量目录（真实读接口）

## datasetVersion context
{
  "datasetVersionId": 390002,
  "datasetId": 120001,
  "datasetCode": "first_limit_pullback",
  "datasetName": "首板回踩",
  "versionLabel": "v2",
  "status": "READY",
  "startDate": "2024-09-01",
  "endDate": "2026-09-01",
  "totalEvents": 23978,
  "horizons": [
    5,
    10,
    20
  ],
  "pathRelativeDayRange": {
    "min": 1,
    "max": 20
  }
}

## features (17)
days_since_previous_limit
event_low_offset
event_open_offset
float_market_cap
historical_limit_count
is_one_word_hold
is_one_word_open
limit_up_premium
limit_up_price
market_cap
pre_close
pre_return_20d
pre_return_5d
pre_volatility_20d
pre_volume_ratio_5d_20d
previous_close
turnover

## outcomes (127)
days_to_breakout_10d
days_to_breakout_20d
days_to_breakout_5d
event_low_margin_10d
event_low_margin_20d
event_low_margin_5d
event_low_margin_close_10d
event_low_margin_close_20d
event_low_margin_close_5d
future_return_10d
future_return_11d
future_return_12d
future_return_13d
future_return_14d
future_return_15d
future_return_16d
future_return_17d
future_return_18d
future_return_19d
future_return_1d
future_return_20d
future_return_2d
future_return_3d
future_return_4d
future_return_5d
future_return_6d
future_return_7d
future_return_8d
future_return_9d
high_return_10d
high_return_11d
high_return_12d
high_return_13d
high_return_14d
high_return_15d
high_return_16d
high_return_17d
high_return_18d
high_return_19d
high_return_1d
high_return_20d
high_return_2d
high_return_3d
high_return_4d
high_return_5d
high_return_6d
high_return_7d
high_return_8d
high_return_9d
holds_event_low_10d
holds_event_low_20d
holds_event_low_5d
holds_event_low_close_10d
holds_event_low_close_20d
holds_event_low_close_5d
is_breakout_10d
is_breakout_20d
is_breakout_5d
low_return_10d
low_return_11d
low_return_12d
low_return_13d
low_return_14d
low_return_15d
low_return_16d
low_return_17d
low_return_18d
low_return_19d
low_return_1d
low_return_20d
low_return_2d
low_return_3d
low_return_4d
low_return_5d
low_return_6d
low_return_7d
low_return_8d
low_return_9d
max_drawdown_10d
max_drawdown_20d
max_drawdown_5d
max_return_10d
max_return_20d
max_return_5d
min_return_10d
min_return_20d
min_return_5d
pullback_from_event_high_10d
pullback_from_event_high_11d
pullback_from_event_high_12d
pullback_from_event_high_13d
pullback_from_event_high_14d
pullback_from_event_high_15d
pullback_from_event_high_16d
pullback_from_event_high_17d
pullback_from_event_high_18d
pullback_from_event_high_19d
pullback_from_event_high_1d
pullback_from_event_high_20d
pullback_from_event_high_2d
pullback_from_event_high_3d
pullback_from_event_high_4d
pullback_from_event_high_5d
pullback_from_event_high_6d
pullback_from_event_high_7d
pullback_from_event_high_8d
pullback_from_event_high_9d
volume_ratio_10d
volume_ratio_11d
volume_ratio_12d
volume_ratio_13d
volume_ratio_14d
volume_ratio_15d
volume_ratio_16d
volume_ratio_17d
volume_ratio_18d
volume_ratio_19d
volume_ratio_1d
volume_ratio_20d
volume_ratio_2d
volume_ratio_3d
volume_ratio_4d
volume_ratio_5d
volume_ratio_6d
volume_ratio_7d
volume_ratio_8d
volume_ratio_9d

## dimensions
["year","month","quarter","board","market","industry"]

## unavailableDimensions
[
  {
    "key": "regime",
    "reason": "当前 Dataset 未提供市场环境列，且未接入 RegimeTagProvider"
  }
]