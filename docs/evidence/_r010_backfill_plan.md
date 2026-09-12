# RESEARCH-007.3 Run 540001 覆盖补齐预检（Dataset Version 390002 / v2）

|h 项|值|
|---|---|
| 可用 outcome 视界 | 5, 10, 20 |
| `holds_event_low_*` 实际存在 | holds_event_low_5d, holds_event_low_10d, holds_event_low_20d |
| path 相对日范围 | 1~20 |

## 待补批次：45 个分析

构成：A-1 参照列 4 族 × 5 天 = 20；A-2a 加资格参照列 5 族 × 1 = 5；A-2b 加资格桶列 4 族 × 5 桶 = 20

001. OK  首板后回撤·T+1 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_1_2d
002. OK  首板后回撤·T+1 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_1_4d
003. OK  首板后回撤·T+1 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_1_6d
004. OK  首板后回撤·T+1 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_1_6d
005. OK  首板后回撤·T+2 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_2_3d
006. OK  首板后回撤·T+2 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_2_5d
007. OK  首板后回撤·T+2 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_2_7d
008. OK  首板后回撤·T+2 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_2_7d
009. OK  首板后回撤·T+3 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_3_4d
010. OK  首板后回撤·T+3 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_3_6d
011. OK  首板后回撤·T+3 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_3_8d
012. OK  首板后回撤·T+3 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_3_8d
013. OK  首板后回撤·T+4 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_4_5d
014. OK  首板后回撤·T+4 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_4_7d
015. OK  首板后回撤·T+4 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_4_9d
016. OK  首板后回撤·T+4 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_4_9d
017. OK  首板后回撤·T+5 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_5_6d
018. OK  首板后回撤·T+5 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_5_8d
019. OK  首板后回撤·T+5 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_5_10d
020. OK  首板后回撤·T+5 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
021. OK  首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后1日收益 | target=segment_return_5_6d
022. OK  首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后3日收益 | target=segment_return_5_8d
023. OK  首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后5日收益 | target=segment_return_5_10d
024. OK  首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后5日最大有利偏移 | target=segment_max_return_5_10d
025. OK  首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
026. OK  首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后1日收益 | target=segment_return_5_6d
027. OK  首板后回撤·T+5 未破首板最低价 且 回撤2~4% → 之后1日收益 | target=segment_return_5_6d
028. OK  首板后回撤·T+5 未破首板最低价 且 回撤4~6% → 之后1日收益 | target=segment_return_5_6d
029. OK  首板后回撤·T+5 未破首板最低价 且 回撤6~8% → 之后1日收益 | target=segment_return_5_6d
030. OK  首板后回撤·T+5 未破首板最低价 且 回撤8%+ → 之后1日收益 | target=segment_return_5_6d
031. OK  首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后3日收益 | target=segment_return_5_8d
032. OK  首板后回撤·T+5 未破首板最低价 且 回撤2~4% → 之后3日收益 | target=segment_return_5_8d
033. OK  首板后回撤·T+5 未破首板最低价 且 回撤4~6% → 之后3日收益 | target=segment_return_5_8d
034. OK  首板后回撤·T+5 未破首板最低价 且 回撤6~8% → 之后3日收益 | target=segment_return_5_8d
035. OK  首板后回撤·T+5 未破首板最低价 且 回撤8%+ → 之后3日收益 | target=segment_return_5_8d
036. OK  首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后5日最大有利偏移 | target=segment_max_return_5_10d
037. OK  首板后回撤·T+5 未破首板最低价 且 回撤2~4% → 之后5日最大有利偏移 | target=segment_max_return_5_10d
038. OK  首板后回撤·T+5 未破首板最低价 且 回撤4~6% → 之后5日最大有利偏移 | target=segment_max_return_5_10d
039. OK  首板后回撤·T+5 未破首板最低价 且 回撤6~8% → 之后5日最大有利偏移 | target=segment_max_return_5_10d
040. OK  首板后回撤·T+5 未破首板最低价 且 回撤8%+ → 之后5日最大有利偏移 | target=segment_max_return_5_10d
041. OK  首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
042. OK  首板后回撤·T+5 未破首板最低价 且 回撤2~4% → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
043. OK  首板后回撤·T+5 未破首板最低价 且 回撤4~6% → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
044. OK  首板后回撤·T+5 未破首板最低价 且 回撤6~8% → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d
045. OK  首板后回撤·T+5 未破首板最低价 且 回撤8%+ → 之后5日最深跌幅 | target=segment_max_drawdown_5_10d

预检结论：全部通过

## 实验 240002 的 Run 现状

| Run | runNo | status | 分析数 |
|---|---:|---|---:|
| 330003 | 1 | FAILED | 1 |
| 390001 | 2 | COMPLETED | 1 |
| 420001 | 3 | COMPLETED | 2 |
| 450001 | 4 | COMPLETED | 5 |
| 480001 | 5 | COMPLETED | 7 |
| 510001 | 6 | COMPLETED | 29 |
| 540001 | 7 | COMPLETED | 135 |

RUNNING 的 Run：无 ✅

## 重名检测（对 Run 540001 现有 135 条）

无重名 ✅

## 执行
- 批量建分析：created=45 failed=0
- analysisIds=510001,510002,510003,510004,510005,510006,510007,510008,510009,510010,510011,510012,510013,510014,510015,510016,510017,510018,510019,510020,510021,510022,510023,510024,510025,510026,510027,510028,510029,510030,510031,510032,510033,510034,510035,510036,510037,510038,510039,510040,510041,510042,510043,510044,510045
- 建后 Run 540001 分析数 = 180

下一步：`npx tsx _r010_backfill_run.mts`（runIncremental，只补 PENDING，不覆盖已完成的 135 条）