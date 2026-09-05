import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * STEP 7.4 — 幂等迁移：创建 Security Master 两张表。
 *
 *   research_securities                           —— 证券主数据（永久身份）
 *   research_security_identifier_history          —— 标识符历史（时间有效区间）
 *
 * 项目历史采用 push 而非 migrate 日志（存在 drift），直接执行增量 DDL 更安全。
 * 禁止 drizzle-kit push、禁止重置数据库；本脚本为 CREATE TABLE IF NOT EXISTS 幂等实现。
 *
 * 关键约束：不做 UNIQUE(securityCode) 全局永久约束；
 * 唯一性落在 (exchange, securityCode, identifierType, effectiveFrom) 上，
 * 区间重叠由应用层 server/security/identifierHistory.validateIdentifierHistory 校验。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS research_securities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      securityId VARCHAR(48) NOT NULL,
      securityType ENUM('stock','etf','index','bond','fund') NOT NULL DEFAULT 'stock',
      exchange ENUM('SH','SZ','BJ') NOT NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
      country VARCHAR(8) NOT NULL DEFAULT 'CN',
      status ENUM('listed','suspended','delisted','terminated','unknown') NOT NULL DEFAULT 'unknown',
      listedDate DATE NULL,
      delistedDate DATE NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_research_securities_securityId (securityId),
      INDEX idx_research_securities_exchange (exchange),
      INDEX idx_research_securities_status (status)
    )
  `));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS research_security_identifier_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      securityId VARCHAR(48) NOT NULL,
      exchange ENUM('SH','SZ','BJ') NOT NULL,
      securityCode VARCHAR(20) NOT NULL,
      identifierType ENUM('primary','tushare_ts_code','sina_symbol','baostock_code','tencent_symbol') NOT NULL DEFAULT 'primary',
      effectiveFrom DATE NOT NULL,
      effectiveTo DATE NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'unknown',
      retrievedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_security_identifier_code_effective (exchange, securityCode, identifierType, effectiveFrom),
      INDEX idx_security_identifier_security (securityId),
      INDEX idx_security_identifier_code (exchange, securityCode),
      INDEX idx_security_identifier_effective (effectiveFrom, effectiveTo)
    )
  `));

  console.log("OK：research_securities / research_security_identifier_history 已就绪（已存在则跳过）");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
