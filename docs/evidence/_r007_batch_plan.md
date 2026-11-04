# RESEARCH-007 批次预检（Dataset Version 390002 / v2）

分析个数：29

01. ✅ SEGMENT_RELATION | 首板后回撤·T+1 相对首板收盘涨跌幅 5 档 → 之后 5 日收益
     target=segment_return_1_6d config={"windowA":[0,1],"windowB":[1,6],"windowAStat":"return","windowBStat":"return","windowBands":5}
02. ✅ SEGMENT_RELATION | 首板后回撤·T+2 相对首板收盘涨跌幅 5 档 → 之后 5 日收益
     target=segment_return_2_7d config={"windowA":[0,2],"windowB":[2,7],"windowAStat":"return","windowBStat":"return","windowBands":5}
03. ✅ SEGMENT_RELATION | 首板后回撤·T+3 相对首板收盘涨跌幅 5 档 → 之后 5 日收益
     target=segment_return_3_8d config={"windowA":[0,3],"windowB":[3,8],"windowAStat":"return","windowBStat":"return","windowBands":5}
04. ✅ SEGMENT_RELATION | 首板后回撤·T+4 相对首板收盘涨跌幅 5 档 → 之后 5 日收益
     target=segment_return_4_9d config={"windowA":[0,4],"windowB":[4,9],"windowAStat":"return","windowBStat":"return","windowBands":5}
05. ✅ SEGMENT_RELATION | 首板后回撤·T+5 相对首板收盘涨跌幅 5 档 → 之后 5 日收益
     target=segment_return_5_10d config={"windowA":[0,5],"windowB":[5,10],"windowAStat":"return","windowBStat":"return","windowBands":5}
06. ✅ SEGMENT_RELATION | 首板后回撤·T+1 相对首板收盘涨跌幅 5 档 → 之后 10 日收益
     target=segment_return_1_11d config={"windowA":[0,1],"windowB":[1,11],"windowAStat":"return","windowBStat":"return","windowBands":5}
07. ✅ SEGMENT_RELATION | 首板后回撤·T+2 相对首板收盘涨跌幅 5 档 → 之后 10 日收益
     target=segment_return_2_12d config={"windowA":[0,2],"windowB":[2,12],"windowAStat":"return","windowBStat":"return","windowBands":5}
08. ✅ SEGMENT_RELATION | 首板后回撤·T+3 相对首板收盘涨跌幅 5 档 → 之后 10 日收益
     target=segment_return_3_13d config={"windowA":[0,3],"windowB":[3,13],"windowAStat":"return","windowBStat":"return","windowBands":5}
09. ✅ SEGMENT_RELATION | 首板后回撤·T+4 相对首板收盘涨跌幅 5 档 → 之后 10 日收益
     target=segment_return_4_14d config={"windowA":[0,4],"windowB":[4,14],"windowAStat":"return","windowBStat":"return","windowBands":5}
10. ✅ SEGMENT_RELATION | 首板后回撤·T+5 相对首板收盘涨跌幅 5 档 → 之后 10 日收益
     target=segment_return_5_15d config={"windowA":[0,5],"windowB":[5,15],"windowAStat":"return","windowBStat":"return","windowBands":5}
11. ✅ CONDITIONAL | 首板后回撤·T+2 相对首板收盘回撤 0~2% → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"BETWEEN","value":[-0.02,0]}]
12. ✅ CONDITIONAL | 首板后回撤·T+2 相对首板收盘回撤 2~4% → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"BETWEEN","value":[-0.04,-0.02]}]
13. ✅ CONDITIONAL | 首板后回撤·T+2 相对首板收盘回撤 4~6% → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"BETWEEN","value":[-0.06,-0.04]}]
14. ✅ CONDITIONAL | 首板后回撤·T+2 相对首板收盘回撤 6~8% → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"BETWEEN","value":[-0.08,-0.06]}]
15. ✅ CONDITIONAL | 首板后回撤·T+2 相对首板收盘回撤 8%+ → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<=","value":-0.08}]
16. ✅ CONDITIONAL | 首板后回撤·T+3 相对首板收盘回撤 0~2% → 之后 5 日收益
     target=segment_return_3_8d config={"targetField":"segment_return_3_8d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_3d","operator":"BETWEEN","value":[-0.02,0]}]
17. ✅ CONDITIONAL | 首板后回撤·T+3 相对首板收盘回撤 2~4% → 之后 5 日收益
     target=segment_return_3_8d config={"targetField":"segment_return_3_8d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_3d","operator":"BETWEEN","value":[-0.04,-0.02]}]
18. ✅ CONDITIONAL | 首板后回撤·T+3 相对首板收盘回撤 4~6% → 之后 5 日收益
     target=segment_return_3_8d config={"targetField":"segment_return_3_8d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_3d","operator":"BETWEEN","value":[-0.06,-0.04]}]
19. ✅ CONDITIONAL | 首板后回撤·T+3 相对首板收盘回撤 6~8% → 之后 5 日收益
     target=segment_return_3_8d config={"targetField":"segment_return_3_8d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_3d","operator":"BETWEEN","value":[-0.08,-0.06]}]
20. ✅ CONDITIONAL | 首板后回撤·T+3 相对首板收盘回撤 8%+ → 之后 5 日收益
     target=segment_return_3_8d config={"targetField":"segment_return_3_8d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_3d","operator":"<=","value":-0.08}]
21. ✅ SEGMENT_RELATION | 首板后回撤·T+2 深度5档 → 之后5日最大有利偏移
     target=segment_max_return_2_7d config={"windowA":[0,2],"windowB":[2,7],"windowAStat":"return","windowBStat":"max_return","windowBands":5}
22. ✅ SEGMENT_RELATION | 首板后回撤·T+2 深度5档 → 之后5日最深跌幅
     target=segment_max_drawdown_2_7d config={"windowA":[0,2],"windowB":[2,7],"windowAStat":"return","windowBStat":"max_drawdown","windowBands":5}
23. ✅ SEGMENT_RELATION | 首板后回撤·T+3 深度5档 → 之后5日最大有利偏移
     target=segment_max_return_3_8d config={"windowA":[0,3],"windowB":[3,8],"windowAStat":"return","windowBStat":"max_return","windowBands":5}
24. ✅ SEGMENT_RELATION | 首板后回撤·T+3 深度5档 → 之后5日最深跌幅
     target=segment_max_drawdown_3_8d config={"windowA":[0,3],"windowB":[3,8],"windowAStat":"return","windowBStat":"max_drawdown","windowBands":5}
25. ✅ CONDITIONAL | 首板后回撤·T+2 回撤且当日量比 <0.5 → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<","value":0},{"groupNo":0,"sortOrder":1,"fieldName":"volume_ratio_2d","operator":"<","value":0.5}]
26. ✅ CONDITIONAL | 首板后回撤·T+2 回撤且当日量比 0.5~0.8 → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<","value":0},{"groupNo":0,"sortOrder":1,"fieldName":"volume_ratio_2d","operator":"BETWEEN","value":[0.5,0.8]}]
27. ✅ CONDITIONAL | 首板后回撤·T+2 回撤且当日量比 0.8~1.0 → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<","value":0},{"groupNo":0,"sortOrder":1,"fieldName":"volume_ratio_2d","operator":"BETWEEN","value":[0.8,1]}]
28. ✅ CONDITIONAL | 首板后回撤·T+2 回撤且当日量比 1.0~1.5 → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<","value":0},{"groupNo":0,"sortOrder":1,"fieldName":"volume_ratio_2d","operator":"BETWEEN","value":[1,1.5]}]
29. ✅ CONDITIONAL | 首板后回撤·T+2 回撤且当日量比 >1.5 → 之后 5 日收益
     target=segment_return_2_7d config={"targetField":"segment_return_2_7d"}
     conditions=[{"groupNo":0,"sortOrder":0,"fieldName":"future_return_2d","operator":"<","value":0},{"groupNo":0,"sortOrder":1,"fieldName":"volume_ratio_2d","operator":">","value":1.5}]

预检结论：全部通过

已创建 Run：id=510001 runNo=6
批量建分析：created=29 failed=0
analysisIds=450001,450002,450003,450004,450005,450006,450007,450008,450009,450010,450011,450012,450013,450014,450015,450016,450017,450018,450019,450020,450021,450022,450023,450024,450025,450026,450027,450028,450029