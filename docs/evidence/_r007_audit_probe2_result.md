
### research_result 列名
{"COLUMN_NAME":"id","COLUMN_TYPE":"bigint"}
{"COLUMN_NAME":"analysisId","COLUMN_TYPE":"bigint"}
{"COLUMN_NAME":"resultType","COLUMN_TYPE":"varchar(32)"}
{"COLUMN_NAME":"dimensionJson","COLUMN_TYPE":"longtext"}
{"COLUMN_NAME":"metricCode","COLUMN_TYPE":"varchar(64)"}
{"COLUMN_NAME":"metricValue","COLUMN_TYPE":"double"}
{"COLUMN_NAME":"sampleCount","COLUMN_TYPE":"int"}
{"COLUMN_NAME":"resultJson","COLUMN_TYPE":"longtext"}
{"COLUMN_NAME":"createdAt","COLUMN_TYPE":"timestamp"}

### dataset_version 列名
{"COLUMN_NAME":"id"}
{"COLUMN_NAME":"datasetId"}
{"COLUMN_NAME":"version"}
{"COLUMN_NAME":"status"}
{"COLUMN_NAME":"startDate"}
{"COLUMN_NAME":"endDate"}
{"COLUMN_NAME":"universeDefinitionJson"}
{"COLUMN_NAME":"filterDefinitionJson"}
{"COLUMN_NAME":"featureVersion"}
{"COLUMN_NAME":"sourceVersion"}
{"COLUMN_NAME":"totalEvents"}
{"COLUMN_NAME":"totalRows"}
{"COLUMN_NAME":"createdAt"}
{"COLUMN_NAME":"completedAt"}

### dataset_definition 列名
{"COLUMN_NAME":"id"}
{"COLUMN_NAME":"datasetCode"}
{"COLUMN_NAME":"name"}
{"COLUMN_NAME":"description"}
{"COLUMN_NAME":"datasetType"}
{"COLUMN_NAME":"storageType"}
{"COLUMN_NAME":"status"}
{"COLUMN_NAME":"eventTableName"}
{"COLUMN_NAME":"prefixTableName"}
{"COLUMN_NAME":"postTableName"}
{"COLUMN_NAME":"pathTableName"}
{"COLUMN_NAME":"outcomeTableName"}
{"COLUMN_NAME":"featureTableName"}
{"COLUMN_NAME":"createdAt"}
{"COLUMN_NAME":"updatedAt"}

### research_conclusion 列名
{"COLUMN_NAME":"id"}
{"COLUMN_NAME":"experimentId"}
{"COLUMN_NAME":"hypothesisId"}
{"COLUMN_NAME":"conclusionType"}
{"COLUMN_NAME":"title"}
{"COLUMN_NAME":"conclusion"}
{"COLUMN_NAME":"evidenceJson"}
{"COLUMN_NAME":"confidence"}
{"COLUMN_NAME":"status"}
{"COLUMN_NAME":"createdAt"}
{"COLUMN_NAME":"updatedAt"}

### dataset_version 390002 全字段
{"id":390002,"datasetId":120001,"version":"v2","status":"READY","startDate":"2024-08-31T16:00:00.000Z","endDate":"2026-08-31T16:00:00.000Z","universeDefinitionJson":"{\"universe\":\"all-a-shares\",\"source\":\"stock_daily_prices\",\"boards\":[\"main\"],\"excludeSt\":true}","filterDefinitionJson":"{\"kind\":\"build-config\",\"builder\":\"first_limit_pullback\",\"configVersion\":1,\"events\":[{\"relativeDay\":0,\"kind\":\"firstBoard\"}],\"preWindowDays\":20,\"postWindowDays\":20,\"pathHorizon\":20,\"outcomeHorizons\":[5,10,20],\"batchSize\":1000}","featureVersion":null,"sourceVersion":null,"totalEvents":23978,"totalRows":1543082,"createdAt":"2026-09-10T04:38:14.000Z","completedAt":"2026-09-11T06:15:41.000Z"}

### dataset_definition 全部
{"id":120001,"datasetCode":"first_limit_pullback","name":"首板回踩","description":"用于首板回踩策略的数据集","datasetType":"EVENT","storageType":"DATABASE","status":"ACTIVE","eventTableName":"ds_first_limit_pullback_event","prefixTableName":"ds_first_limit_pullback_prefix","postTableName":"ds_first_limit_pullback_post","pathTableName":"ds_first_limit_pullback_path","outcomeTableName":"ds_first_limit_pullback_outcome","featureTableName":null,"createdAt":"2026-09-10T04:15:47.000Z","updatedAt":"2026-09-10T04:15:47.000Z"}

### 事件表样本量
{"events":23978,"codes":2967}

### 各 segment 分析的档数与每档样本数
{"analysisId":450001,"dimensionJson":"{\"windowA\":1}","metricValue":4734}
{"analysisId":450001,"dimensionJson":"{\"windowA\":2}","metricValue":4733}
{"analysisId":450001,"dimensionJson":"{\"windowA\":3}","metricValue":4734}
{"analysisId":450001,"dimensionJson":"{\"windowA\":4}","metricValue":4733}
{"analysisId":450001,"dimensionJson":"{\"windowA\":5}","metricValue":4734}
{"analysisId":450002,"dimensionJson":"{\"windowA\":1}","metricValue":4721}
{"analysisId":450002,"dimensionJson":"{\"windowA\":2}","metricValue":4721}
{"analysisId":450002,"dimensionJson":"{\"windowA\":3}","metricValue":4720}
{"analysisId":450002,"dimensionJson":"{\"windowA\":4}","metricValue":4721}
{"analysisId":450002,"dimensionJson":"{\"windowA\":5}","metricValue":4721}
{"analysisId":450003,"dimensionJson":"{\"windowA\":1}","metricValue":4713}
{"analysisId":450003,"dimensionJson":"{\"windowA\":2}","metricValue":4713}
{"analysisId":450003,"dimensionJson":"{\"windowA\":3}","metricValue":4713}
{"analysisId":450003,"dimensionJson":"{\"windowA\":4}","metricValue":4712}
{"analysisId":450003,"dimensionJson":"{\"windowA\":5}","metricValue":4713}
{"analysisId":450004,"dimensionJson":"{\"windowA\":1}","metricValue":4701}
{"analysisId":450004,"dimensionJson":"{\"windowA\":2}","metricValue":4700}
{"analysisId":450004,"dimensionJson":"{\"windowA\":3}","metricValue":4700}
{"analysisId":450004,"dimensionJson":"{\"windowA\":4}","metricValue":4700}
{"analysisId":450004,"dimensionJson":"{\"windowA\":5}","metricValue":4701}
{"analysisId":450005,"dimensionJson":"{\"windowA\":1}","metricValue":4697}
{"analysisId":450005,"dimensionJson":"{\"windowA\":2}","metricValue":4695}
{"analysisId":450005,"dimensionJson":"{\"windowA\":3}","metricValue":4695}
{"analysisId":450005,"dimensionJson":"{\"windowA\":4}","metricValue":4696}
{"analysisId":450005,"dimensionJson":"{\"windowA\":5}","metricValue":4696}
{"analysisId":450006,"dimensionJson":"{\"windowA\":1}","metricValue":4692}
{"analysisId":450006,"dimensionJson":"{\"windowA\":2}","metricValue":4693}
{"analysisId":450006,"dimensionJson":"{\"windowA\":3}","metricValue":4693}
{"analysisId":450006,"dimensionJson":"{\"windowA\":4}","metricValue":4690}
{"analysisId":450006,"dimensionJson":"{\"windowA\":5}","metricValue":4692}
{"analysisId":450007,"dimensionJson":"{\"windowA\":1}","metricValue":4676}
{"analysisId":450007,"dimensionJson":"{\"windowA\":2}","metricValue":4676}
{"analysisId":450007,"dimensionJson":"{\"windowA\":3}","metricValue":4676}
{"analysisId":450007,"dimensionJson":"{\"windowA\":4}","metricValue":4677}
{"analysisId":450007,"dimensionJson":"{\"windowA\":5}","metricValue":4675}
{"analysisId":450008,"dimensionJson":"{\"windowA\":1}","metricValue":4669}
{"analysisId":450008,"dimensionJson":"{\"windowA\":2}","metricValue":4669}
{"analysisId":450008,"dimensionJson":"{\"windowA\":3}","metricValue":4668}
{"analysisId":450008,"dimensionJson":"{\"windowA\":4}","metricValue":4669}
{"analysisId":450008,"dimensionJson":"{\"windowA\":5}","metricValue":4669}
{"analysisId":450009,"dimensionJson":"{\"windowA\":1}","metricValue":4655}
{"analysisId":450009,"dimensionJson":"{\"windowA\":2}","metricValue":4654}
{"analysisId":450009,"dimensionJson":"{\"windowA\":3}","metricValue":4654}
{"analysisId":450009,"dimensionJson":"{\"windowA\":4}","metricValue":4654}
{"analysisId":450009,"dimensionJson":"{\"windowA\":5}","metricValue":4655}
{"analysisId":450010,"dimensionJson":"{\"windowA\":1}","metricValue":4640}
{"analysisId":450010,"dimensionJson":"{\"windowA\":2}","metricValue":4639}
{"analysisId":450010,"dimensionJson":"{\"windowA\":3}","metricValue":4639}
{"analysisId":450010,"dimensionJson":"{\"windowA\":4}","metricValue":4639}
{"analysisId":450010,"dimensionJson":"{\"windowA\":5}","metricValue":4639}
{"analysisId":450011,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23604}
{"analysisId":450011,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":3155}
{"analysisId":450012,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23604}
{"analysisId":450012,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":2734}
{"analysisId":450013,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23604}
{"analysisId":450013,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":2078}
{"analysisId":450014,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23604}
{"analysisId":450014,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":1305}
{"analysisId":450015,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23604}
{"analysisId":450015,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":1956}
{"analysisId":450016,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23564}
{"analysisId":450016,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":2586}
{"analysisId":450017,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23564}
{"analysisId":450017,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":2444}
{"analysisId":450018,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23564}
{"analysisId":450018,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":2079}
{"analysisId":450019,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23564}
{"analysisId":450019,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":1537}
{"analysisId":450020,"dimensionJson":"{\"group\":\"ALL\"}","metricValue":23564}
{"analysisId":450020,"dimensionJson":"{\"group\":\"CONDITION\"}","metricValue":3028}
{"analysisId":450021,"dimensionJson":"{\"windowA\":1}","metricValue":4716}
{"analysisId":450021,"dimensionJson":"{\"windowA\":2}","metricValue":4716}
{"analysisId":450021,"dimensionJson":"{\"windowA\":3}","metricValue":4716}
{"analysisId":450021,"dimensionJson":"{\"windowA\":4}","metricValue":4716}
{"analysisId":450021,"dimensionJson":"{\"windowA\":5}","metricValue":4716}
{"analysisId":450022,"dimensionJson":"{\"windowA\":1}","metricValue":4716}
{"analysisId":450022,"dimensionJson":"{\"windowA\":2}","metricValue":4716}
{"analysisId":450022,"dimensionJson":"{\"windowA\":3}","metricValue":4716}
{"analysisId":450022,"dimensionJson":"{\"windowA\":4}","metricValue":4716}
{"analysisId":450022,"dimensionJson":"{\"windowA\":5}","metricValue":4716}
{"analysisId":450023,"dimensionJson":"{\"windowA\":1}","metricValue":4709}
{"analysisId":450023,"dimensionJson":"{\"windowA\":2}","metricValue":4709}
{"analysisId":450023,"dimensionJson":"{\"windowA\":3}","metricValue":4708}
{"analysisId":450023,"dimensionJson":"{\"windowA\":4}","metricValue":4709}
{"analysisId":450023,"dimensionJson":"{\"windowA\":5}","metricValue":4709}
{"analysisId":450024,"dimensionJson":"{\"windowA\":1}","metricValue":4709}
{"analysisId":450024,"dimensionJson":"{\"windowA\":2}","metricValue":4709}
{"analysisId":450024,"dimensionJson":"{\"windowA\":3}","metricValue":4708}
{"analysisId":450024,"dimensionJson":"{\"windowA\":4}","metricValue":4709}
{"analysisId":450024,"dimensionJson":"{\"windowA\":5}","metricValue":4709}

### 450002 (T+2) 每档 MEAN_RETURN
{"dimensionJson":"{\"windowA\":1}","metricValue":-0.0092324147457691}
{"dimensionJson":"{\"windowA\":3}","metricValue":-0.005867497669893554}
{"dimensionJson":"{\"windowA\":4}","metricValue":-0.0050695380413690585}
{"dimensionJson":"{\"windowA\":5}","metricValue":-0.003456236839488727}
{"dimensionJson":"{\"windowA\":2}","metricValue":-0.003050134693671241}
{"dimensionJson":"{\"windowA\":5}","metricValue":0.39843253547977125}
{"dimensionJson":"{\"windowA\":1}","metricValue":0.40902351196780345}
{"dimensionJson":"{\"windowA\":3}","metricValue":0.4127118644067797}
{"dimensionJson":"{\"windowA\":4}","metricValue":0.4189790298665537}
{"dimensionJson":"{\"windowA\":2}","metricValue":0.43507731412836265}

### 某分析 details 头部（配对/缺失/切点）
[ERROR] Unknown column 'details' in 'field list'