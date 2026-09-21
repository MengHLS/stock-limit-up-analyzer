
/** 引擎当前只接受 READY 版本（与后端断言同源）。 */
export const USABLE_DATASET_VERSION_STATUSES = ["READY"] as const;

/** 该版本状态是否可作为研究 / 回测的输入。 */
export function isUsableVersionStatus(status: string): boolean {
  return (USABLE_DATASET_VERSION_STATUSES as readonly string[]).includes(status);
}
