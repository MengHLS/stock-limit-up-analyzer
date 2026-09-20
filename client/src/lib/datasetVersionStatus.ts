/**
 * Dataset 版本状态的前端判定（RESEARCH-EXPERIMENT-003 抽出）。
 *
 * 来源：原先住在 `client/src/components/research/createExperimentForm.ts`（旧 Research 的
 * 「新建实验」表单）。该表单随旧 Research 前端删除，但这条判定被**生产**两处共用
 * （策略基本信息卡的版本选择、候选转正表单），故抽到中立模块，语义逐字不变：
 * 引擎只接受 `READY` 版本，非 READY 一律不是可用版本。
 */

/** 引擎当前只接受 READY 版本（与后端断言同源）。 */
export const USABLE_DATASET_VERSION_STATUSES = ["READY"] as const;

/** 该版本状态是否可作为研究 / 回测的输入。 */
export function isUsableVersionStatus(status: string): boolean {
  return (USABLE_DATASET_VERSION_STATUSES as readonly string[]).includes(status);
}
