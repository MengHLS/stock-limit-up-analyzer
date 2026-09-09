-- ============================================================
-- Status + Liquidity 批量产出 (C+E)
-- generated_at    : 2026-09-07T19:55:00.000Z
-- generator_pid   : 0
-- source_host     : 示例（请替换为实际 generated_at/pid）
-- trade_date_range: 2019-01-01 ~ 2026-09-07
-- target_boards   : 主板（SH 60xxxx + SZ 000/001/002）
-- target_codes    : 3486 stocks
-- import_hint     : mysql -u root -p stock_limit_up < ce_main_20260907.sql
-- ============================================================
-- liquidity_daily 表上有 uq_liquidity_daily_security_date (securityCode, tradeDate) 唯一索引，
-- ON DUPLICATE KEY UPDATE 实现幂等；research_security_status_history 无唯一约束，纯 INSERT，
-- 同一 (securityId,statusType,effectiveFrom,effectiveTo) 可能产生重复行，导入端按需去重。
-- ============================================================

INSERT INTO `liquidity_daily` (`securityId`,`securityCode`,`tradeDate`,`turnoverRate`,`circulationMarketCap`,`totalMarketCap`,`amount`,`volume`,`source`,`retrievedAt`) VALUES
  ('sec_a1b2c3d4','600000.SH','2019-01-02',0.42,1.234e+11,3.456e+11,567.89,12.34,'baostock-daily',NOW()),
  ('sec_a1b2c3d4','600000.SH','2019-01-03',0.51,1.235e+11,3.459e+11,612.04,15.67,'baostock-daily',NOW()),
  ('sec_a1b2c3d4','600000.SH','2019-01-04',0.78,1.236e+11,3.461e+11,789.12,18.92,'baostock-daily',NOW())
ON DUPLICATE KEY UPDATE
  `securityId`=VALUES(`securityId`),
  `turnoverRate`=VALUES(`turnoverRate`),
  `circulationMarketCap`=VALUES(`circulationMarketCap`),
  `totalMarketCap`=VALUES(`totalMarketCap`),
  `amount`=VALUES(`amount`),
  `volume`=VALUES(`volume`),
  `source`=VALUES(`source`),
  `retrievedAt`=VALUES(`retrievedAt`);

INSERT INTO `research_security_status_history` (`securityId`,`statusType`,`statusValue`,`effectiveFrom`,`effectiveTo`,`source`,`retrievedAt`,`confidence`,`availability`) VALUES
  ('sec_a1b2c3d4','TRADING','TRADING','2019-01-02','2020-04-30','baostock-history','2026-09-07 19:55:00','medium','T_PLUS_1'),
  ('sec_a1b2c3d4','SUSPENSION','SUSPENDED','2020-05-01','2020-05-15','baostock-history','2026-09-07 19:55:00','medium','T_PLUS_1'),
  ('sec_a1b2c3d4','TRADING','TRADING','2020-05-16',NULL,'baostock-history','2026-09-07 19:55:00','medium','T_PLUS_1');

INSERT INTO `liquidity_daily` (`securityId`,`securityCode`,`tradeDate`,`turnoverRate`,`circulationMarketCap`,`totalMarketCap`,`amount`,`volume`,`source`,`retrievedAt`) VALUES
  ('sec_e5f6a7b8','600519.SH','2019-01-02',0.18,8.9e+11,1.2e+12,890.12,4.56,'baostock-daily',NOW()),
  ('sec_e5f6a7b8','600519.SH','2019-01-03',0.21,8.92e+11,1.21e+12,945.32,5.01,'baostock-daily',NOW())
ON DUPLICATE KEY UPDATE
  `securityId`=VALUES(`securityId`),
  `turnoverRate`=VALUES(`turnoverRate`),
  `circulationMarketCap`=VALUES(`circulationMarketCap`),
  `totalMarketCap`=VALUES(`totalMarketCap`),
  `amount`=VALUES(`amount`),
  `volume`=VALUES(`volume`),
  `source`=VALUES(`source`),
  `retrievedAt`=VALUES(`retrievedAt`);

INSERT INTO `research_security_status_history` (`securityId`,`statusType`,`statusValue`,`effectiveFrom`,`effectiveTo`,`source`,`retrievedAt`,`confidence`,`availability`) VALUES
  ('sec_e5f6a7b8','TRADING','TRADING','2019-01-02',NULL,'baostock-history','2026-09-07 19:55:00','medium','T_PLUS_1');

-- ============================================================
-- end_of_dump
-- codes_processed  : 2 (示例)
-- liquidity_rows   : 5 (示例)
-- status_rows      : 4 (示例)
-- bytes_written    : ~2000 (示例)
-- finished_at      : 2026-09-07T19:55:00.500Z (示例)
-- ============================================================
