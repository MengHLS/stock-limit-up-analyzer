/**
 * STEP 12.6 — Research Dataset：构建任务键（buildKey）与行表命名。
 *
 * 分片（分区）构建的「两阶段身份」解法（鸡生蛋问题的唯一自洽解）：
 *   - datasetVersion 是 content-addressed（对完整 rows 序列算指纹），构建完成前不可知；
 *   - 但分片构建要求「先建表、再灌数据、断点续跑」，表名必须在构建前确定。
 *   - 因此引入 buildKey：由「规范化请求」派生的稳定指纹（构建前可计算），用于行表命名
 *     与断点续跑；权威身份仍由 content-addressed 的 datasetVersion 承担（落 research_datasets）。
 *
 * 语义：同一规范化请求（含 universeFilter / 日期窗口 / 护栏）→ 同一 buildKey → 同一张行表；
 *   同一 buildKey 重跑 = 覆盖式重建（源数据更新后内容变化，datasetVersion 随之变化）。
 *
 * 安全：buildKey 只允许 [0-9a-f]{16}，行表名拼接前严格校验，杜绝动态表名 SQL 注入。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "./version";
import type { NormalizedResearchDatasetRequest } from "./types";

/** 行表名前缀。 */
export const ROWS_TABLE_PREFIX = "rd_rows_";

/** 构建任务键（规范化请求指纹，构建前可计算；纯函数、确定性）。 */
export function computeBuildKey(request: NormalizedResearchDatasetRequest): string {
  const digest = createHash("sha256").update(canonicalStringify(request), "utf8").digest("hex");
  return digest.slice(0, 16);
}

/** 由 buildKey 派生行表名；非法 buildKey 抛错（防注入）。 */
export function rowsTableName(buildKey: string): string {
  if (!/^[0-9a-f]{16}$/.test(buildKey)) {
    throw new Error(`非法 buildKey：${buildKey}（仅允许 [0-9a-f]{16}）`);
  }
  return `${ROWS_TABLE_PREFIX}${buildKey}`;
}
