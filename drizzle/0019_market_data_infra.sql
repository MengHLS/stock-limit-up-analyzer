-- STEP 7.6 — Historical Industry / Index / Liquidity 数据基础设施（4 张新表）
-- 注意：本文件为手动编写（与 drizzle/schema.ts 一致）。
-- 编号：reconciliation 后规范为 0019（原 0016_market_data_infra.sql，因与 backfill_checkpoints 顺序倒置而重排）。

CREATE TABLE `industry_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `securityId` varchar(20) NOT NULL,
  `industryCode` varchar(32) NOT NULL,
  `industryName` varchar(64) NOT NULL,
  `effectiveFrom` date NOT NULL,
  `effectiveTo` date,
  `source` varchar(32) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_industry_assign_security_effective` (`securityId`, `effectiveFrom`),
  KEY `idx_industry_assign_industry_code` (`industryCode`)
);

CREATE TABLE `index_master` (
  `id` int NOT NULL AUTO_INCREMENT,
  `indexCode` varchar(32) NOT NULL,
  `indexName` varchar(64) NOT NULL,
  `provider` varchar(32) NOT NULL,
  `providerCode` varchar(32) NOT NULL,
  `firstDate` date,
  `lastDate` date,
  `source` varchar(64) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_index_master_code_provider` (`indexCode`, `provider`),
  KEY `idx_index_master_code` (`indexCode`)
);

CREATE TABLE `index_daily` (
  `id` int NOT NULL AUTO_INCREMENT,
  `indexCode` varchar(32) NOT NULL,
  `tradeDate` date NOT NULL,
  `open` double,
  `high` double,
  `low` double,
  `close` double,
  `amount` double,
  `volume` double,
  `source` varchar(32) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_index_daily_code_date` (`indexCode`, `tradeDate`),
  KEY `idx_index_daily_trade_date` (`tradeDate`)
);

CREATE TABLE `liquidity_daily` (
  `id` int NOT NULL AUTO_INCREMENT,
  `securityId` varchar(20) NOT NULL,
  `tradeDate` date NOT NULL,
  `turnoverRate` double,
  `circulationMarketCap` double,
  `totalMarketCap` double,
  `amount` double,
  `volume` double,
  `source` varchar(32) NOT NULL,
  `retrievedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_liquidity_daily_security_date` (`securityId`, `tradeDate`),
  KEY `idx_liquidity_daily_trade_date` (`tradeDate`)
);
