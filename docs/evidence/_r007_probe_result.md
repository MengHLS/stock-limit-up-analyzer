
### dataset_definition  (rows=1)
[
  {
    "id": 120001,
    "datasetCode": "first_limit_pullback",
    "name": "首板回踩",
    "description": "用于首板回踩策略的数据集",
    "datasetType": "EVENT",
    "storageType": "DATABASE",
    "status": "ACTIVE",
    "eventTableName": "ds_first_limit_pullback_event",
    "prefixTableName": "ds_first_limit_pullback_prefix",
    "postTableName": "ds_first_limit_pullback_post",
    "pathTableName": "ds_first_limit_pullback_path",
    "outcomeTableName": "ds_first_limit_pullback_outcome",
    "featureTableName": null,
    "createdAt": "2026-09-10T04:15:47.000Z",
    "updatedAt": "2026-09-10T04:15:47.000Z"
  }
]

### columns: dataset_version
id | bigint | NO
datasetId | bigint | NO
version | varchar(32) | NO
status | varchar(20) | NO
startDate | date | YES
endDate | date | YES
universeDefinitionJson | longtext | YES
filterDefinitionJson | longtext | YES
featureVersion | varchar(32) | YES
sourceVersion | varchar(32) | YES
totalEvents | bigint | YES
totalRows | bigint | YES
createdAt | timestamp | NO
completedAt | timestamp | YES

### dataset_version  (rows=2)
[
  {
    "id": 390001,
    "datasetId": 120001,
    "version": "v1",
    "status": "READY",
    "startDate": "2026-07-31T16:00:00.000Z",
    "endDate": "2026-08-30T16:00:00.000Z",
    "universeDefinitionJson": "{\"universe\":\"all-a-shares\",\"source\":\"stock_daily_prices\",\"boards\":[\"main\"],\"excludeSt\":true}",
    "filterDefinitionJson": "{\"kind\":\"build-config\",\"builder\":\"first_limit_pullback\",\"configVersion\":1,\"events\":[{\"relativeDay\":0,\"kind\":\"firstBoard\"}],\"preWindowDays\":20,\"postWindowDays\":20,\"pathHorizon\":20,\"outcomeHorizons\":[5,10,20],\"batchSize\":1000}",
    "featureVersion": null,
    "sourceVersion": null,
    "totalEvents": 1130,
    "totalRows": 60002,
    "createdAt": "2026-09-10T04:16:35.000Z",
    "completedAt": "2026-09-10T04:32:17.000Z"
  },
  {
    "id": 390002,
    "datasetId": 120001,
    "version": "v2",
    "status": "READY",
    "startDate": "2024-08-31T16:00:00.000Z",
    "endDate": "2026-08-31T16:00:00.000Z",
    "universeDefinitionJson": "{\"universe\":\"all-a-shares\",\"source\":\"stock_daily_prices\",\"boards\":[\"main\"],\"excludeSt\":true}",
    "filterDefinitionJson": "{\"kind\":\"build-config\",\"builder\":\"first_limit_pullback\",\"configVersion\":1,\"events\":[{\"relativeDay\":0,\"kind\":\"firstBoard\"}],\"preWindowDays\":20,\"postWindowDays\":20,\"pathHorizon\":20,\"outcomeHorizons\":[5,10,20],\"batchSize\":1000}",
    "featureVersion": null,
    "sourceVersion": null,
    "totalEvents": 23978,
    "totalRows": 1543082,
    "createdAt": "2026-09-10T04:38:14.000Z",
    "completedAt": "2026-09-11T06:15:41.000Z"
  }
]

### columns: research_experiment
id | bigint | NO
datasetVersionId | bigint | NO
name | varchar(200) | NO
description | text | YES
researchType | varchar(32) | NO
status | varchar(20) | NO
configJson | longtext | YES
sampleCount | int | YES
startedAt | timestamp | YES
completedAt | timestamp | YES
createdAt | timestamp | NO
updatedAt | timestamp | NO

### research_experiment  (rows=2)
[
  {
    "id": 180001,
    "datasetVersionId": 390001,
    "name": "首板换手率与未来五日收益的关系",
    "description": null,
    "researchType": "FEATURE",
    "status": "COMPLETED",
    "configJson": null,
    "sampleCount": 1130,
    "startedAt": "2026-09-11T03:57:57.000Z",
    "completedAt": "2026-09-11T06:38:29.000Z",
    "createdAt": "2026-09-11T02:37:19.000Z",
    "updatedAt": "2026-09-11T06:38:30.000Z"
  },
  {
    "id": 240002,
    "datasetVersionId": 390002,
    "name": "正式数据，首板回踩与未来收益的关系",
    "description": null,
    "researchType": "FEATURE",
    "status": "COMPLETED",
    "configJson": null,
    "sampleCount": 23978,
    "startedAt": "2026-09-11T23:37:27.000Z",
    "completedAt": "2026-09-12T03:29:32.000Z",
    "createdAt": "2026-09-11T06:40:21.000Z",
    "updatedAt": "2026-09-12T03:29:33.000Z"
  }
]

### columns: research_run
id | bigint | NO
experimentId | bigint | NO
runNo | int | NO
status | varchar(20) | NO
configJson | longtext | YES
inputSnapshotJson | longtext | YES
sampleCount | int | YES
startedAt | timestamp | YES
completedAt | timestamp | YES
errorCode | varchar(64) | YES
errorMessage | text | YES
createdAt | timestamp | NO
executionLogJson | longtext | YES

### research_run  (rows=9)
[
  {
    "id": 270001,
    "experimentId": 180001,
    "runNo": 1,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390001,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v1\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[\"turnover\",\"limit_up_premium\",\"days_since_previous_limit\"],\"outcomes\":[\"future_return_5d\",\"future_return_10d\",\"max_drawdown_10d\",\"future_return_20d\",\"max_drawdown_20d\",\"future_return_1d\",\"max_drawdown_5d\",\"future_return_3d\"],\"dimensions\":[]},\"analysisTypes\":[\"QUANTILE\",\"QUANTILE\",\"CONDITIONAL\",\"CONDITIONAL\",\"CONDITIONAL\",\"CONDITIONAL\",\"CONDITIONAL\"],\"snapshotAt\":\"2026-09-11T13:20:38.351Z\"}",
    "sampleCount": 1130,
    "startedAt": "2026-09-11T05:20:38.000Z",
    "completedAt": "2026-09-11T05:21:26.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T05:09:26.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[240001,240002,240003,240004,240005,240006,240007],\"sampleCount\":1130,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-11T13:20:38.351Z\",\"completedAt\":\"2026-09-11T13:21:25.627Z\"}]"
  },
  {
    "id": 270002,
    "experimentId": 180001,
    "runNo": 2,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390001,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v1\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"future_return_1d\",\"future_return_2d\",\"future_return_3d\",\"future_return_4d\",\"future_return_5d\",\"max_return_5d\",\"min_return_5d\",\"max_drawdown_5d\",\"is_breakout_5d\",\"days_to_breakout_5d\",\"future_return_6d\",\"future_return_8d\",\"future_return_10d\",\"max_return_10d\",\"min_return_10d\",\"max_drawdown_10d\",\"is_breakout_10d\",\"days_to_breakout_10d\",\"future_return_15d\"],\"dimensions\":[]},\"analysisTypes\":[\"EVENT_STUDY\"],\"snapshotAt\":\"2026-09-11T13:39:10.665Z\"}",
    "sampleCount": 1130,
    "startedAt": "2026-09-11T05:39:11.000Z",
    "completedAt": "2026-09-11T05:40:05.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T05:35:53.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[240008],\"sampleCount\":1130,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-11T13:39:10.665Z\",\"completedAt\":\"2026-09-11T13:40:05.222Z\"}]"
  },
  {
    "id": 300001,
    "experimentId": 180001,
    "runNo": 3,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390001,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v1\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[\"turnover\"],\"outcomes\":[\"future_return_5d\"],\"dimensions\":[]},\"analysisTypes\":[\"QUANTILE\"],\"snapshotAt\":\"2026-09-11T14:31:40.837Z\"}",
    "sampleCount": 1130,
    "startedAt": "2026-09-11T06:31:41.000Z",
    "completedAt": "2026-09-11T06:31:58.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T06:22:03.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[270001],\"sampleCount\":1130,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-11T14:31:40.837Z\",\"completedAt\":\"2026-09-11T14:31:58.139Z\"}]"
  },
  {
    "id": 330002,
    "experimentId": 180001,
    "runNo": 4,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390001,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v1\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"future_return_1d\",\"future_return_3d\",\"future_return_5d\",\"max_return_5d\",\"min_return_5d\",\"max_drawdown_5d\",\"is_breakout_5d\",\"days_to_breakout_5d\",\"future_return_10d\",\"max_return_10d\",\"min_return_10d\",\"max_drawdown_10d\",\"is_breakout_10d\",\"days_to_breakout_10d\",\"future_return_20d\",\"max_return_20d\",\"min_return_20d\",\"max_drawdown_20d\",\"is_breakout_20d\",\"days_to_breakout_20d\"],\"dimensions\":[]},\"analysisTypes\":[\"EVENT_STUDY\"],\"snapshotAt\":\"2026-09-11T14:37:57.175Z\"}",
    "sampleCount": 1130,
    "startedAt": "2026-09-11T06:37:57.000Z",
    "completedAt": "2026-09-11T06:38:29.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T06:35:43.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[270007],\"sampleCount\":1130,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-11T14:37:57.175Z\",\"completedAt\":\"2026-09-11T14:38:28.685Z\"}]"
  },
  {
    "id": 330003,
    "experimentId": 240002,
    "runNo": 1,
    "status": "FAILED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390002,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v2\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"future_return_1d\",\"future_return_3d\",\"future_return_5d\",\"max_return_5d\",\"min_return_5d\",\"max_drawdown_5d\",\"is_breakout_5d\",\"days_to_breakout_5d\",\"future_return_10d\",\"max_return_10d\",\"min_return_10d\",\"max_drawdown_10d\",\"is_breakout_10d\",\"days_to_breakout_10d\",\"future_return_15d\",\"future_return_20d\",\"max_return_20d\",\"min_return_20d\",\"max_drawdown_20d\",\"is_breakout_20d\",\"days_to_breakout_20d\"],\"dimensions\":[]},\"analysisTypes\":[\"EVENT_STUDY\"],\"snapshotAt\":\"2026-09-11T14:58:22.055Z\"}",
    "sampleCount": null,
    "startedAt": "2026-09-11T06:58:22.000Z",
    "completedAt": "2026-09-11T06:58:22.000Z",
    "errorCode": "RUN_ORPHANED",
    "errorMessage": "执行器在 2026-09-11 22:58:22（CST）被进程重启中断（dev server 热重启杀死了在途执行器），进程消亡后无任何东西再推进该 Run，故永久停在 RUNNING。已由一次性运维脚本按引擎的失败收敛口径置为 FAILED —— 该 Run 现可重新执行。",
    "createdAt": "2026-09-11T06:40:28.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[270008],\"sampleCount\":null,\"status\":\"FAILED\",\"startedAt\":\"2026-09-11T14:43:29.025Z\",\"completedAt\":\"2026-09-11T14:58:22.055Z\",\"errorCode\":\"RUN_ORPHANED\",\"errorMessage\":\"执行器在 2026-09-11 22:58:22（CST）被进程重启中断（dev server 热重启杀死了在途执行器），进程消亡后无任何东西再推进该 Run，故永久停在 RUNNING。已由一次性运维脚本按引擎的失败收敛口径置为 FAILED —— 该 Run 现可重新执行。\"},{\"sequence\":2,\"mode\":\"FULL\",\"analysisIds\":[270008],\"sampleCount\":null,\"status\":\"FAILED\",\"startedAt\":\"2026-09-11T14:58:22.055Z\",\"completedAt\":\"2026-09-11T14:58:22.055Z\",\"errorCode\":\"RUN_ORPHANED\",\"errorMessage\":\"执行器在 2026-09-11 22:58:22（CST）被进程重启中断（dev server 热重启杀死了在途执行器），进程消亡后无任何东西再推进该 Run，故永久停在 RUNNING。已由一次性运维脚本按引擎的失败收敛口径置为 FAILED —— 该 Run 现可重新执行。\"}]"
  },
  {
    "id": 390001,
    "experimentId": 240002,
    "runNo": 2,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390002,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v2\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"max_drawdown_5d\",\"segment_return_5_20d\"],\"dimensions\":[]},\"analysisTypes\":[\"SEGMENT_RELATION\"],\"snapshotAt\":\"2026-09-12T07:36:45.066Z\"}",
    "sampleCount": 23978,
    "startedAt": "2026-09-11T23:36:45.000Z",
    "completedAt": "2026-09-11T23:37:27.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T23:34:47.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[330001],\"sampleCount\":23978,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-12T07:36:45.066Z\",\"completedAt\":\"2026-09-12T07:37:27.279Z\"}]"
  },
  {
    "id": 420001,
    "experimentId": 240002,
    "runNo": 3,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390002,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v2\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"holds_event_low_5d\",\"future_return_20d\",\"max_drawdown_20d\",\"volume_ratio_1d\",\"volume_ratio_2d\",\"volume_ratio_3d\",\"volume_ratio_4d\",\"volume_ratio_5d\"],\"dimensions\":[]},\"analysisTypes\":[\"CONDITIONAL\",\"DESCRIPTIVE\"],\"snapshotAt\":\"2026-09-12T08:11:18.087Z\"}",
    "sampleCount": 23978,
    "startedAt": "2026-09-12T00:11:18.000Z",
    "completedAt": "2026-09-12T00:11:55.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-11T23:43:52.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[360001,360002],\"sampleCount\":23978,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-12T08:11:18.087Z\",\"completedAt\":\"2026-09-12T08:11:54.656Z\"}]"
  },
  {
    "id": 450001,
    "experimentId": 240002,
    "runNo": 4,
    "status": "COMPLETED",
    "configJson": null,
    "inputSnapshotJson": "{\"datasetVersionId\":390002,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v2\",\"runConfig\":null,\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"holds_event_low_5d\",\"future_return_20d\",\"max_drawdown_20d\",\"max_drawdown_5d\",\"segment_return_5_20d\",\"volume_ratio_1d\",\"volume_ratio_2d\",\"volume_ratio_3d\",\"volume_ratio_4d\",\"volume_ratio_5d\"],\"dimensions\":[]},\"analysisTypes\":[\"CONDITIONAL\",\"CONDITIONAL\",\"SEGMENT_RELATION\",\"DESCRIPTIVE\",\"CONDITIONAL\"],\"snapshotAt\":\"2026-09-12T08:30:35.247Z\"}",
    "sampleCount": 23978,
    "startedAt": "2026-09-12T00:30:35.000Z",
    "completedAt": "2026-09-12T00:31:35.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-12T00:29:45.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[390001,390002,390003,390004,390005],\"sampleCount\":23978,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-12T08:30:35.247Z\",\"completedAt\":\"2026-09-12T08:31:34.796Z\"}]"
  },
  {
    "id": 480001,
    "experimentId": 240002,
    "runNo": 5,
    "status": "COMPLETED",
    "configJson": "{\"note\":\"建仓后风险收益四口径 + 多候选日回撤触发（脚本批次）\"}",
    "inputSnapshotJson": "{\"datasetVersionId\":390002,\"datasetCode\":\"first_limit_pullback\",\"datasetVersionLabel\":\"v2\",\"runConfig\":{\"note\":\"建仓后风险收益四口径 + 多候选日回撤触发（脚本批次）\"},\"researchType\":\"FEATURE\",\"variables\":{\"features\":[],\"outcomes\":[\"max_drawdown_5d\",\"segment_return_5_20d\",\"segment_max_return_5_20d\",\"segment_min_return_5_20d\",\"segment_max_drawdown_5_20d\",\"pullback_from_event_high_2d\",\"segment_return_2_20d\",\"max_drawdown_20d\",\"pullback_from_event_high_3d\",\"segment_return_3_20d\",\"pullback_from_event_high_5d\"],\"dimensions\":[]},\"analysisTypes\":[\"SEGMENT_RELATION\",\"SEGMENT_RELATION\",\"SEGMENT_RELATION\",\"SEGMENT_RELATION\",\"CONDITIONAL\",\"CONDITIONAL\",\"CONDITIONAL\"],\"snapshotAt\":\"2026-09-12T11:28:32.061Z\"}",
    "sampleCount": 23978,
    "startedAt": "2026-09-12T03:28:32.000Z",
    "completedAt": "2026-09-12T03:29:32.000Z",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-09-12T03:28:21.000Z",
    "executionLogJson": "[{\"sequence\":1,\"mode\":\"FULL\",\"analysisIds\":[420001,420002,420003,420004,420005,420006,420007],\"sampleCount\":23978,\"status\":\"COMPLETED\",\"startedAt\":\"2026-09-12T11:28:32.061Z\",\"completedAt\":\"2026-09-12T11:29:32.097Z\"}]"
  }
]

### columns: research_analysis
id | bigint | NO
runId | bigint | NO
analysisType | varchar(32) | NO
name | varchar(200) | NO
target | varchar(200) | YES
configJson | longtext | YES
status | varchar(20) | NO
createdAt | timestamp | NO
completedAt | timestamp | YES

### research_analysis  (rows=26)
[
  {
    "id": 240001,
    "runId": 270001,
    "analysisType": "QUANTILE",
    "name": "分位分析：turnover 分 10 组 → future_return_5d",
    "target": "future_return_5d",
    "configJson": "{\"featureField\":\"turnover\",\"targetField\":\"future_return_5d\",\"quantileGroups\":10}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:15:54.000Z",
    "completedAt": "2026-09-11T05:21:07.000Z"
  },
  {
    "id": 240002,
    "runId": 270001,
    "analysisType": "QUANTILE",
    "name": "分位分析：limit_up_premium 分 10 组 → future_return_5d",
    "target": "future_return_5d",
    "configJson": "{\"featureField\":\"limit_up_premium\",\"targetField\":\"future_return_5d\",\"quantileGroups\":10}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:17:13.000Z",
    "completedAt": "2026-09-11T05:21:10.000Z"
  },
  {
    "id": 240003,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "name": "条件分析：条件 → future_return_10d",
    "target": "future_return_10d",
    "configJson": "{\"targetField\":\"future_return_10d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:20:07.000Z",
    "completedAt": "2026-09-11T05:21:13.000Z"
  },
  {
    "id": 240004,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "name": "条件分析：条件 → future_return_20d",
    "target": "future_return_20d",
    "configJson": "{\"targetField\":\"future_return_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:20:08.000Z",
    "completedAt": "2026-09-11T05:21:16.000Z"
  },
  {
    "id": 240005,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "name": "条件分析：条件 → future_return_1d",
    "target": "future_return_1d",
    "configJson": "{\"targetField\":\"future_return_1d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:20:10.000Z",
    "completedAt": "2026-09-11T05:21:18.000Z"
  },
  {
    "id": 240006,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "name": "条件分析：条件 → future_return_5d",
    "target": "future_return_5d",
    "configJson": "{\"targetField\":\"future_return_5d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:20:11.000Z",
    "completedAt": "2026-09-11T05:21:21.000Z"
  },
  {
    "id": 240007,
    "runId": 270001,
    "analysisType": "CONDITIONAL",
    "name": "条件分析：条件 → future_return_3d",
    "target": "future_return_3d",
    "configJson": "{\"targetField\":\"future_return_3d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:20:12.000Z",
    "completedAt": "2026-09-11T05:21:24.000Z"
  },
  {
    "id": 240008,
    "runId": 270002,
    "analysisType": "EVENT_STUDY",
    "name": "事件研究：T+1 / T+2 / T+3 / T+4 / T+5 / T+6 / T+8 / T+10 / T+15",
    "target": null,
    "configJson": "{\"horizons\":[1,2,3,4,5,6,8,10,15]}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T05:39:04.000Z",
    "completedAt": "2026-09-11T05:40:03.000Z"
  },
  {
    "id": 270001,
    "runId": 300001,
    "analysisType": "QUANTILE",
    "name": "分位分析：turnover 分 10 组 → future_return_5d",
    "target": "future_return_5d",
    "configJson": "{\"featureField\":\"turnover\",\"targetField\":\"future_return_5d\",\"quantileGroups\":10}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T06:31:33.000Z",
    "completedAt": "2026-09-11T06:31:57.000Z"
  },
  {
    "id": 270007,
    "runId": 330002,
    "analysisType": "EVENT_STUDY",
    "name": "事件研究：T+1 / T+3 / T+5 / T+10 / T+20",
    "target": null,
    "configJson": "{\"horizons\":[1,3,5,10,20]}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T06:37:51.000Z",
    "completedAt": "2026-09-11T06:38:26.000Z"
  },
  {
    "id": 270008,
    "runId": 330003,
    "analysisType": "EVENT_STUDY",
    "name": "事件研究：T+1 / T+3 / T+5 / T+10 / T+15 / T+20",
    "target": null,
    "configJson": "{\"horizons\":[1,3,5,10,15,20]}",
    "status": "PENDING",
    "createdAt": "2026-09-11T06:41:28.000Z",
    "completedAt": null
  },
  {
    "id": 330001,
    "runId": 390001,
    "analysisType": "SEGMENT_RELATION",
    "name": "T（事件日收盘）..T+5 最大跌幅 → T+5..T+20 分段收益",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"return\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-11T23:36:39.000Z",
    "completedAt": "2026-09-11T23:37:26.000Z"
  },
  {
    "id": 360001,
    "runId": 420001,
    "analysisType": "CONDITIONAL",
    "name": "五日内不破涨停最低价的",
    "target": "future_return_20d",
    "configJson": "{\"targetField\":\"future_return_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:07:53.000Z",
    "completedAt": "2026-09-12T00:11:49.000Z"
  },
  {
    "id": 360002,
    "runId": 420001,
    "analysisType": "DESCRIPTIVE",
    "name": "首板后成交量的分布",
    "target": null,
    "configJson": "{\"variables\":[\"volume_ratio_1d\",\"volume_ratio_2d\",\"volume_ratio_3d\",\"volume_ratio_4d\",\"volume_ratio_5d\"]}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:11:12.000Z",
    "completedAt": "2026-09-12T00:11:53.000Z"
  },
  {
    "id": 390001,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "name": "没跌破涨停日最低价的，20 日怎么走",
    "target": "future_return_20d",
    "configJson": "{\"targetField\":\"future_return_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:30:02.000Z",
    "completedAt": "2026-09-12T00:31:24.000Z"
  },
  {
    "id": 390002,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "name": "跌破涨停日最低价的，是不是更差",
    "target": "future_return_20d",
    "configJson": "{\"targetField\":\"future_return_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:30:07.000Z",
    "completedAt": "2026-09-12T00:31:26.000Z"
  },
  {
    "id": 390003,
    "runId": 450001,
    "analysisType": "SEGMENT_RELATION",
    "name": "前 5 日跌得越深，之后 15 日越强吗",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"return\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:30:15.000Z",
    "completedAt": "2026-09-12T00:31:29.000Z"
  },
  {
    "id": 390004,
    "runId": 450001,
    "analysisType": "DESCRIPTIVE",
    "name": "首板后 5 天的量能长什么样",
    "target": null,
    "configJson": "{\"variables\":[\"volume_ratio_1d\",\"volume_ratio_2d\",\"volume_ratio_3d\",\"volume_ratio_4d\",\"volume_ratio_5d\"]}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:30:24.000Z",
    "completedAt": "2026-09-12T00:31:31.000Z"
  },
  {
    "id": 390005,
    "runId": 450001,
    "analysisType": "CONDITIONAL",
    "name": "回踩第一天就缩量的，后面更好吗",
    "target": "future_return_20d",
    "configJson": "{\"targetField\":\"future_return_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T00:30:27.000Z",
    "completedAt": "2026-09-12T00:31:33.000Z"
  },
  {
    "id": 420001,
    "runId": 480001,
    "analysisType": "SEGMENT_RELATION",
    "name": "前 5 日回撤分档（5 档）→ 之后 15 日期末收益",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"return\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:22.000Z",
    "completedAt": "2026-09-12T03:29:18.000Z"
  },
  {
    "id": 420002,
    "runId": 480001,
    "analysisType": "SEGMENT_RELATION",
    "name": "前 5 日回撤分档（5 档）→ 之后 15 日最大有利偏移",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"max_return\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:23.000Z",
    "completedAt": "2026-09-12T03:29:20.000Z"
  },
  {
    "id": 420003,
    "runId": 480001,
    "analysisType": "SEGMENT_RELATION",
    "name": "前 5 日回撤分档（5 档）→ 之后 15 日最大不利偏移",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"min_return\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:23.000Z",
    "completedAt": "2026-09-12T03:29:22.000Z"
  },
  {
    "id": 420004,
    "runId": 480001,
    "analysisType": "SEGMENT_RELATION",
    "name": "前 5 日回撤分档（5 档）→ 之后 15 日最深跌幅",
    "target": null,
    "configJson": "{\"windowA\":[0,5],\"windowB\":[5,20],\"windowAStat\":\"max_drawdown\",\"windowBStat\":\"max_drawdown\",\"windowBands\":5}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:24.000Z",
    "completedAt": "2026-09-12T03:29:25.000Z"
  },
  {
    "id": 420005,
    "runId": 480001,
    "analysisType": "CONDITIONAL",
    "name": "T+2 相对事件日高点已回撤 ≥8% → 之后 18 日期末收益",
    "target": null,
    "configJson": "{\"targetField\":\"segment_return_2_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:25.000Z",
    "completedAt": "2026-09-12T03:29:27.000Z"
  },
  {
    "id": 420006,
    "runId": 480001,
    "analysisType": "CONDITIONAL",
    "name": "T+3 相对事件日高点已回撤 ≥8% → 之后 17 日期末收益",
    "target": null,
    "configJson": "{\"targetField\":\"segment_return_3_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:26.000Z",
    "completedAt": "2026-09-12T03:29:29.000Z"
  },
  {
    "id": 420007,
    "runId": 480001,
    "analysisType": "CONDITIONAL",
    "name": "T+5 相对事件日高点已回撤 ≥8% → 之后 15 日期末收益",
    "target": null,
    "configJson": "{\"targetField\":\"segment_return_5_20d\"}",
    "status": "COMPLETED",
    "createdAt": "2026-09-12T03:28:28.000Z",
    "completedAt": "2026-09-12T03:29:31.000Z"
  }
]

### columns: research_result
id | bigint | NO
analysisId | bigint | NO
resultType | varchar(32) | NO
dimensionJson | longtext | YES
metricCode | varchar(64) | NO
metricValue | double | YES
sampleCount | int | YES
resultJson | longtext | YES
createdAt | timestamp | NO

### research_result count  (rows=25)
[
  {
    "analysisId": 240003,
    "n": 16
  },
  {
    "analysisId": 240001,
    "n": 53
  },
  {
    "analysisId": 390003,
    "n": 31
  },
  {
    "analysisId": 390004,
    "n": 95
  },
  {
    "analysisId": 270007,
    "n": 50
  },
  {
    "analysisId": 360002,
    "n": 95
  },
  {
    "analysisId": 240008,
    "n": 73
  },
  {
    "analysisId": 270001,
    "n": 53
  },
  {
    "analysisId": 330001,
    "n": 31
  },
  {
    "analysisId": 240004,
    "n": 16
  },
  {
    "analysisId": 420002,
    "n": 31
  },
  {
    "analysisId": 240007,
    "n": 14
  },
  {
    "analysisId": 240005,
    "n": 14
  },
  {
    "analysisId": 420007,
    "n": 16
  },
  {
    "analysisId": 390002,
    "n": 16
  },
  {
    "analysisId": 420003,
    "n": 31
  },
  {
    "analysisId": 420005,
    "n": 16
  },
  {
    "analysisId": 240002,
    "n": 53
  },
  {
    "analysisId": 360001,
    "n": 16
  },
  {
    "analysisId": 390005,
    "n": 16
  },
  {
    "analysisId": 420001,
    "n": 31
  },
  {
    "analysisId": 420004,
    "n": 26
  },
  {
    "analysisId": 390001,
    "n": 16
  },
  {
    "analysisId": 240006,
    "n": 16
  },
  {
    "analysisId": 420006,
    "n": 16
  }
]

### research_conclusion  (rows=8)
[
  {
    "id": 180001,
    "experimentId": 180001,
    "hypothesisId": null,
    "conclusionType": "PARTIALLY_SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（PARTIALLY_SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**方向一致但统计强度不足**：差异存在方向性，但未能通过预设统计门槛。\n\n关键量：Q10 − Q1 的 future_return_5d 均值差 = -0.0308；p = 0.0930；t = -1.6799；样本 1065（最小分组 106）；方向一致性 0.667。\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 1065（门槛 30），最小分组样本 106（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0308，阈值 0.005\n3. [未通过] R4_统计量达标 —— p = 0.0930，alpha = 0.05\n4. [通过] R5_方向稳定 —— 一致性 0.667，下限 0.6\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":240001,\"analysisType\":\"QUANTILE\",\"effectLabel\":\"Q10 − Q1 的 future_return_5d 均值差\",\"effect\":-0.030784914547101534,\"pValue\":0.09298526652520334,\"tStat\":-1.6798561131372838,\"sampleCount\":1065,\"minGroupSampleCount\":106,\"groupCount\":10,\"directionConsistency\":0.6666666666666666},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":240001,\"analysisType\":\"QUANTILE\",\"effect\":-0.030784914547101534,\"effectLabel\":\"Q10 − Q1 的 future_return_5d 均值差\",\"pValue\":0.09298526652520334,\"sampleCount\":1065,\"notes\":[\"group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。\",\"SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。\",\"65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":240002,\"analysisType\":\"QUANTILE\",\"effect\":0.05269854395617217,\"effectLabel\":\"Q10 − Q1 的 future_return_5d 均值差\",\"pValue\":0.0010961731029890398,\"sampleCount\":1065,\"notes\":[\"group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。\",\"SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。\",\"65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":240003,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.017658209679783286,\"effectLabel\":\"条件组 − 全样本的 future_return_10d 均值差\",\"pValue\":0.14343387225540982,\"sampleCount\":832,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":240004,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.04462505860751756,\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"pValue\":0.06664922575278998,\"sampleCount\":319,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":240005,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.0007414637541689126,\"effectLabel\":\"条件组 − 全样本的 future_return_1d 均值差\",\"pValue\":0.822818432403932,\"sampleCount\":1127,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":240006,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.012572306022756812,\"effectLabel\":\"条件组 − 全样本的 future_return_5d 均值差\",\"pValue\":0.09187412240425741,\"sampleCount\":1065,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":240007,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.007354153308031427,\"effectLabel\":\"条件组 − 全样本的 future_return_3d 均值差\",\"pValue\":0.2239402567139468,\"sampleCount\":1126,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 1065（门槛 30），最小分组样本 106（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0308，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":false,\"detail\":\"p = 0.0930，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"一致性 0.667，下限 0.6\"}],\"confidenceBasis\":\"基础 0.30；+0.133 方向一致性 × 0.20；+0.15 样本充裕\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.5833,
    "status": "DRAFT",
    "createdAt": "2026-09-11T05:21:25.000Z",
    "updatedAt": "2026-09-11T05:21:25.000Z"
  },
  {
    "id": 180002,
    "experimentId": 180001,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：T+2 未来收益均值（1127 个样本） = 0.0147；p = 0.0000；t = 4.3085；样本 1130（最小分组 581）；方向一致性 1.000。\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 1130（门槛 30），最小分组样本 581（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0147，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05\n4. [通过] R5_方向稳定 —— 一致性 1.000，下限 0.6\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":240008,\"analysisType\":\"EVENT_STUDY\",\"effectLabel\":\"T+2 未来收益均值（1127 个样本）\",\"effect\":0.01473610099951632,\"pValue\":0.00001644494034969135,\"tStat\":4.308547238567558,\"sampleCount\":1130,\"minGroupSampleCount\":581,\"groupCount\":9,\"directionConsistency\":1},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":240008,\"analysisType\":\"EVENT_STUDY\",\"effect\":0.01473610099951632,\"effectLabel\":\"T+2 未来收益均值（1127 个样本）\",\"pValue\":0.00001644494034969135,\"sampleCount\":1130,\"notes\":[\"主视界 = 样本数最多的视界（并列时取视界更大者）；选择规则已写死在代码里并写入证据，非事后挑选。\",\"T_STAT / P_VALUE 使用 Newey-West HAC 稳健统计量 + 正态近似 p 值；事件样本存在重叠视界，独立性假设不严格成立，仅作研究辅助。\",\"时间维度仅实现 Dataset 真实具备的「到突破天数」（outcome.daysToBreakout）；time_to_target / time_to_stop 需要逐日触价与止盈止损规则，Dataset 未定义，故不实现。\",\"T+1：Dataset 未提供 max_return_1d / min_return_1d / max_drawdown_1d / is_breakout_1d / days_to_breakout_1d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+1 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+2：Dataset 未提供 max_return_2d / min_return_2d / max_drawdown_2d / is_breakout_2d / days_to_breakout_2d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+2 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+3：Dataset 未提供 max_return_3d / min_return_3d / max_drawdown_3d / is_breakout_3d / days_to_breakout_3d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+3 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+4：Dataset 未提供 max_return_4d / min_return_4d / max_drawdown_4d / is_breakout_4d / days_to_breakout_4d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+4 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+6：Dataset 未提供 max_return_6d / min_return_6d / max_drawdown_6d / is_breakout_6d / days_to_breakout_6d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+6 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+8：Dataset 未提供 max_return_8d / min_return_8d / max_drawdown_8d / is_breakout_8d / days_to_breakout_8d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+8 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+15：Dataset 未提供 max_return_15d / min_return_15d / max_drawdown_15d / is_breakout_15d / days_to_breakout_15d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+15 的收益序列来自 path），故不输出对应指标，不虚构。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 1130（门槛 30），最小分组样本 581（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0147，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0000，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"一致性 1.000，下限 0.6\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.200 方向一致性 × 0.20；+0.15 样本充裕；+0.10 各分析方向一致\",\"confidenceIsNotPValue\":true}",
    "confidence": 1,
    "status": "DRAFT",
    "createdAt": "2026-09-11T05:40:05.000Z",
    "updatedAt": "2026-09-11T05:40:05.000Z"
  },
  {
    "id": 210001,
    "experimentId": 180001,
    "hypothesisId": null,
    "conclusionType": "PARTIALLY_SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（PARTIALLY_SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**方向一致但统计强度不足**：差异存在方向性，但未能通过预设统计门槛。\n\n关键量：Q10 − Q1 的 future_return_5d 均值差 = -0.0308；p = 0.0930；t = -1.6799；样本 1065（最小分组 106）；方向一致性 0.667。\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 1065（门槛 30），最小分组样本 106（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0308，阈值 0.005\n3. [未通过] R4_统计量达标 —— p = 0.0930，alpha = 0.05\n4. [通过] R5_方向稳定 —— 一致性 0.667，下限 0.6\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":270001,\"analysisType\":\"QUANTILE\",\"effectLabel\":\"Q10 − Q1 的 future_return_5d 均值差\",\"effect\":-0.030784914547101534,\"pValue\":0.09298526652520334,\"tStat\":-1.6798561131372838,\"sampleCount\":1065,\"minGroupSampleCount\":106,\"groupCount\":10,\"directionConsistency\":0.6666666666666666},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":270001,\"analysisType\":\"QUANTILE\",\"effect\":-0.030784914547101534,\"effectLabel\":\"Q10 − Q1 的 future_return_5d 均值差\",\"pValue\":0.09298526652520334,\"sampleCount\":1065,\"notes\":[\"group(v) = 1 + |{k : v > percentile(feature, k/G)}|；相同特征值不劈开分组。\",\"SPREAD_TOP_BOTTOM = mean(最高分位组) − mean(最低分位组)。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验；未校正多重比较与重叠视界，仅作研究辅助。\",\"65 个样本因特征或结果缺失被排除（缺失不冒充有效样本）。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 1065（门槛 30），最小分组样本 106（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0308，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":false,\"detail\":\"p = 0.0930，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"一致性 0.667，下限 0.6\"}],\"confidenceBasis\":\"基础 0.30；+0.133 方向一致性 × 0.20；+0.15 样本充裕；+0.10 各分析方向一致\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.6833,
    "status": "DRAFT",
    "createdAt": "2026-09-11T06:31:58.000Z",
    "updatedAt": "2026-09-11T06:31:58.000Z"
  },
  {
    "id": 210002,
    "experimentId": 180001,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "首板换手率与未来五日收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：T+1 未来收益均值（1127 个样本） = 0.0106；p = 0.0000；t = 4.8895；样本 1130（最小分组 319）；方向一致性 1.000。\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 1130（门槛 30），最小分组样本 319（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0106，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05\n4. [通过] R5_方向稳定 —— 一致性 1.000，下限 0.6\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":270007,\"analysisType\":\"EVENT_STUDY\",\"effectLabel\":\"T+1 未来收益均值（1127 个样本）\",\"effect\":0.010591727318356668,\"pValue\":0.000001012509648790072,\"tStat\":4.889470256888688,\"sampleCount\":1130,\"minGroupSampleCount\":319,\"groupCount\":5,\"directionConsistency\":1},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":270007,\"analysisType\":\"EVENT_STUDY\",\"effect\":0.010591727318356668,\"effectLabel\":\"T+1 未来收益均值（1127 个样本）\",\"pValue\":0.000001012509648790072,\"sampleCount\":1130,\"notes\":[\"主视界 = 样本数最多的视界（并列时取视界更大者）；选择规则已写死在代码里并写入证据，非事后挑选。\",\"T_STAT / P_VALUE 使用 Newey-West HAC 稳健统计量 + 正态近似 p 值；事件样本存在重叠视界，独立性假设不严格成立，仅作研究辅助。\",\"时间维度仅实现 Dataset 真实具备的「到突破天数」（outcome.daysToBreakout）；time_to_target / time_to_stop 需要逐日触价与止盈止损规则，Dataset 未定义，故不实现。\",\"T+1：Dataset 未提供 max_return_1d / min_return_1d / max_drawdown_1d / is_breakout_1d / days_to_breakout_1d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+1 的收益序列来自 path），故不输出对应指标，不虚构。\",\"T+3：Dataset 未提供 max_return_3d / min_return_3d / max_drawdown_3d / is_breakout_3d / days_to_breakout_3d（这些列来自 outcome 表，outcome 只覆盖其声明视界；T+3 的收益序列来自 path），故不输出对应指标，不虚构。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 1130（门槛 30），最小分组样本 319（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0106，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0000，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"一致性 1.000，下限 0.6\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.200 方向一致性 × 0.20；+0.15 样本充裕；+0.10 各分析方向一致\",\"confidenceIsNotPValue\":true}",
    "confidence": 1,
    "status": "DRAFT",
    "createdAt": "2026-09-11T06:38:28.000Z",
    "updatedAt": "2026-09-11T06:38:28.000Z"
  },
  {
    "id": 270001,
    "experimentId": 240002,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差 = -0.0180；p = 0.0000；t = -4.5422；样本 22944（最小分组 4587）；方向一致性 0.750。\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 22944（门槛 30），最小分组样本 4587（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0180，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05\n4. [通过] R5_方向稳定 —— 一致性 0.750，下限 0.6\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":330001,\"analysisType\":\"SEGMENT_RELATION\",\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差\",\"effect\":-0.018022159588986744,\"pValue\":0.000005572819082200198,\"tStat\":-4.542184582850737,\"sampleCount\":22944,\"minGroupSampleCount\":4587,\"groupCount\":5,\"directionConsistency\":0.75},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":330001,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":-0.018022159588986744,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差\",\"pValue\":0.000005572819082200198,\"sampleCount\":22944,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"1034 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 22944（门槛 30），最小分组样本 4587（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0180，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0000，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"一致性 0.750，下限 0.6\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.150 方向一致性 × 0.20；+0.15 样本充裕；+0.10 各分析方向一致\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.95,
    "status": "DRAFT",
    "createdAt": "2026-09-11T23:37:26.000Z",
    "updatedAt": "2026-09-11T23:37:26.000Z"
  },
  {
    "id": 300001,
    "experimentId": 240002,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：条件组 − 全样本的 future_return_20d 均值差 = 0.0390；p = 0.0000；t = 16.3969；样本 23033（最小分组 16158）；\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 23033（门槛 30），最小分组样本 16158（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0390，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05\n4. [通过] R5_方向稳定 —— 无方向一致性信息（不构成否决条件）\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":360001,\"analysisType\":\"CONDITIONAL\",\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"effect\":0.038950159772887606,\"pValue\":0,\"tStat\":16.396856329822153,\"sampleCount\":23033,\"minGroupSampleCount\":16158,\"groupCount\":2,\"directionConsistency\":null},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":360001,\"analysisType\":\"CONDITIONAL\",\"effect\":0.038950159772887606,\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"pValue\":0,\"sampleCount\":23033,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":360002,\"analysisType\":\"DESCRIPTIVE\",\"effect\":null,\"effectLabel\":\"描述性统计（无主效应）\",\"pValue\":null,\"sampleCount\":23978,\"notes\":[\"DESCRIPTIVE 只描述分布，不做任何假设检验，因此不产出结论方向。\",\"变量 volume_ratio_1d 缺失率 0.25%（缺失值不参与统计）\",\"变量 volume_ratio_2d 缺失率 0.35%（缺失值不参与统计）\",\"变量 volume_ratio_3d 缺失率 0.39%（缺失值不参与统计）\",\"变量 volume_ratio_4d 缺失率 0.68%（缺失值不参与统计）\",\"变量 volume_ratio_5d 缺失率 0.95%（缺失值不参与统计）\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 23033（门槛 30），最小分组样本 16158（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0390，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0000，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"无方向一致性信息（不构成否决条件）\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.15 样本充裕；+0.10 各分析方向一致\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.8,
    "status": "DRAFT",
    "createdAt": "2026-09-12T00:11:54.000Z",
    "updatedAt": "2026-09-12T00:11:54.000Z"
  },
  {
    "id": 330001,
    "experimentId": 240002,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：条件组 − 全样本的 future_return_20d 均值差 = 0.0390；p = 0.0000；t = 16.3969；样本 23033（最小分组 16158）；\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 23033（门槛 30），最小分组样本 16158（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0390，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0000，alpha = 0.05\n4. [通过] R5_方向稳定 —— 无方向一致性信息（不构成否决条件）\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":390001,\"analysisType\":\"CONDITIONAL\",\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"effect\":0.038950159772887606,\"pValue\":0,\"tStat\":16.396856329822153,\"sampleCount\":23033,\"minGroupSampleCount\":16158,\"groupCount\":2,\"directionConsistency\":null},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":390001,\"analysisType\":\"CONDITIONAL\",\"effect\":0.038950159772887606,\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"pValue\":0,\"sampleCount\":23033,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":390002,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.09501641759591181,\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"pValue\":0,\"sampleCount\":23033,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":390003,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":-0.018022159588986744,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差\",\"pValue\":0.000005572819082200198,\"sampleCount\":22944,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"1034 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":390004,\"analysisType\":\"DESCRIPTIVE\",\"effect\":null,\"effectLabel\":\"描述性统计（无主效应）\",\"pValue\":null,\"sampleCount\":23978,\"notes\":[\"DESCRIPTIVE 只描述分布，不做任何假设检验，因此不产出结论方向。\",\"变量 volume_ratio_1d 缺失率 0.25%（缺失值不参与统计）\",\"变量 volume_ratio_2d 缺失率 0.35%（缺失值不参与统计）\",\"变量 volume_ratio_3d 缺失率 0.39%（缺失值不参与统计）\",\"变量 volume_ratio_4d 缺失率 0.68%（缺失值不参与统计）\",\"变量 volume_ratio_5d 缺失率 0.95%（缺失值不参与统计）\"]},{\"analysisId\":390005,\"analysisType\":\"CONDITIONAL\",\"effect\":0.05078544809017228,\"effectLabel\":\"条件组 − 全样本的 future_return_20d 均值差\",\"pValue\":1.1013412404281553e-13,\"sampleCount\":23033,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 23033（门槛 30），最小分组样本 16158（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0390，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0000，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"无方向一致性信息（不构成否决条件）\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.15 样本充裕\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.7,
    "status": "DRAFT",
    "createdAt": "2026-09-12T00:31:34.000Z",
    "updatedAt": "2026-09-12T00:31:34.000Z"
  },
  {
    "id": 360001,
    "experimentId": 240002,
    "hypothesisId": null,
    "conclusionType": "SUPPORTED",
    "title": "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    "conclusion": "假设：「(未登记假设陈述)」\n\n判定：**在预设规则下支持该假设**（样本、效应量、统计量、方向稳定性四项均达标）。\n\n关键量：条件组 − 全样本的 segment_return_2_20d 均值差 = -0.0097；p = 0.0105；t = -2.5589；样本 22958（最小分组 3151）；\n\n判定依据（按顺序短路）：\n1. [通过] R2_样本达标 —— 总样本 22958（门槛 30），最小分组样本 3151（门槛 30）\n2. [通过] R3_效应达到最小实际阈值 —— |效应| = 0.0097，阈值 0.005\n3. [通过] R4_统计量达标 —— p = 0.0105，alpha = 0.05\n4. [通过] R5_方向稳定 —— 无方向一致性信息（不构成否决条件）\n\n⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。",
    "evidenceJson": "{\"disclaimer\":\"⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立，本阶段不产出交易结论。\",\"policy\":{\"alpha\":0.05,\"materialityAbs\":0.005,\"minSampleCount\":30,\"stabilityMinConsistentRatio\":0.6,\"strongSampleMultiple\":2},\"hypothesisId\":null,\"hypothesisStatement\":\"(未登记假设陈述)\",\"primaryAnalysis\":{\"analysisId\":420005,\"analysisType\":\"CONDITIONAL\",\"effectLabel\":\"条件组 − 全样本的 segment_return_2_20d 均值差\",\"effect\":-0.009654365848525595,\"pValue\":0.010499444910095246,\"tStat\":-2.558933182127266,\"sampleCount\":22958,\"minGroupSampleCount\":3151,\"groupCount\":2,\"directionConsistency\":null},\"primarySelectionRule\":\"按 QUANTILE → CONDITIONAL → EVENT_STUDY → STABILITY → SEGMENT_RELATION 的固定优先级选择主分析（不按效应大小挑选，避免选择性报告）\",\"contributingAnalyses\":[{\"analysisId\":420001,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":-0.018022159588986744,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段收益）均值差\",\"pValue\":0.000005572819082200198,\"sampleCount\":22944,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"1034 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":420002,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":0.02807723823342867,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段最大有利偏移）均值差\",\"pValue\":3.3306690738754696e-14,\"sampleCount\":22813,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"1165 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":420003,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":-0.02695027456973066,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段最大不利偏移）均值差\",\"pValue\":0,\"sampleCount\":22813,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"1165 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":420004,\"analysisType\":\"SEGMENT_RELATION\",\"effect\":-0.02728879724798397,\"effectLabel\":\"窗 A（T+0..5 分段最大跌幅）第 5 档 − 第 1 档 的 窗 B（T+5..20 分段最大跌幅）均值差\",\"pValue\":0,\"sampleCount\":22813,\"notes\":[\"band(v) = 1 + |{k : v > percentile(窗A取值, k/G)}|；与 QUANTILE 同一分档规则（相同值不劈开）。\",\"配对 = 窗 A 与窗 B 的取值**同时有限**的样本；任一侧缺失即整对丢弃，不插补。\",\"窗 A 与窗 B 的取值区间必须无交集（WINDOW_OVERLAP 硬约束）。\",\"SPREAD_TOP_BOTTOM = mean(最高档) − mean(最低档)。\",\"本分析只给**统计关系**：窗 A 统计量虽在 T+5 收盘可观测，但决策点已后移，结论不构成 T 日可交易信号；交易有效性必须经 Backtest / 稳健性 / OOS 验证。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值）；PAIR_CORRELATION / PAIR_RANK_CORRELATION 为配对相关系数。三者均**未校正多重比较**，且事件样本本身存在重叠视界（同一事件窗口与相邻事件共享交易日），独立性假设不严格成立。\",\"窗 B 口径为「分段最大跌幅」，是跌幅类极值口径 —— 「取值 > 0 的占比」不构成通常意义上的胜率，故不产出 WIN_RATE（列出来只会诱导错误解读）。另需注意：该口径**并非恒为负** —— 取值窗 [T+6, T+20] 不含锚点日T+5，价格整段上行时窗内最低收盘仍可能高于锚点收盘。\",\"1165 个样本因窗 A 或窗 B 取值缺失被排除（缺失不冒充有效样本）。\"]},{\"analysisId\":420005,\"analysisType\":\"CONDITIONAL\",\"effect\":-0.009654365848525595,\"effectLabel\":\"条件组 − 全样本的 segment_return_2_20d 均值差\",\"pValue\":0.010499444910095246,\"sampleCount\":22958,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":420006,\"analysisType\":\"CONDITIONAL\",\"effect\":0.002420970586465674,\"effectLabel\":\"条件组 − 全样本的 segment_return_3_20d 均值差\",\"pValue\":0.44235242273356423,\"sampleCount\":22951,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]},{\"analysisId\":420007,\"analysisType\":\"CONDITIONAL\",\"effect\":0.0055116303414520385,\"effectLabel\":\"条件组 − 全样本的 segment_return_5_20d 均值差\",\"pValue\":0.022519227706788936,\"sampleCount\":22944,\"notes\":[\"DIFFERENCE = mean(条件样本) − mean(全样本)。\",\"RELATIVE_DIFFERENCE = DIFFERENCE / |mean(全样本)|；全样本均值为 0 时不可算。\",\"T_STAT_DIFFERENCE / P_VALUE_DIFFERENCE 为 Welch 两样本检验（正态近似 p 值），未校正多重比较与重叠视界；「不可靠时不声称显著」：显著与否的判定由 ConclusionBuilder 依据预设阈值做出。\"]}],\"ruleTrace\":[{\"rule\":\"R2_样本达标\",\"passed\":true,\"detail\":\"总样本 22958（门槛 30），最小分组样本 3151（门槛 30）\"},{\"rule\":\"R3_效应达到最小实际阈值\",\"passed\":true,\"detail\":\"|效应| = 0.0097，阈值 0.005\"},{\"rule\":\"R4_统计量达标\",\"passed\":true,\"detail\":\"p = 0.0105，alpha = 0.05\"},{\"rule\":\"R5_方向稳定\",\"passed\":true,\"detail\":\"无方向一致性信息（不构成否决条件）\"}],\"confidenceBasis\":\"基础 0.30；+0.25 统计达标；+0.15 样本充裕\",\"confidenceIsNotPValue\":true}",
    "confidence": 0.7,
    "status": "DRAFT",
    "createdAt": "2026-09-12T03:29:32.000Z",
    "updatedAt": "2026-09-12T03:29:32.000Z"
  }
]

### research_hypothesis  (rows=0)
[]

### researchAnalysis_templates  (rows=0)
[]