/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化：OOS 只读纪律审计（机器检查）。
 *
 * 背景：本模块的核心纪律是「OOS 数据只读验证，不参与任何消融/选择」。纪律由**结构**保证：
 *   - components / order 在评估前固定（变体生成先于两轨求值，不存在「据 OOS 结果决定
 *     顺序/筛选目标」的代码路径）；
 *   - IS 与 OOS 两轨消费**同一变体集合**（同样的配方），贡献与信号只在评估后计算。
 *
 * 本文件把这些结构事实**物化为运行时可复核的审计**（对齐 C-19.2 `verifyOosIsolation` 的
 * 机器检查哲学），便于归档后复核 / 反序列化后再次断言纪律未被破坏：
 *   - 变体对齐：OOS 轨与 IS 轨逐条 variant.code / variantIndex 一致（配方一致）；
 *   - 目标集合一致：两轨边际归因目标集合相同；
 *   - 顺序固定：记录不含任何「据 OOS 重排」的字段（order 先验固定，恒真）；
 *   - 信号不反向驱动：signals 顺序是贡献清单（IS 降序）的子序列（展示用），不反向改写 order。
 *
 * 铁律：纯函数、只读入参、无 IO / Date.now / Math.random。
 */

import type { AblationAssessmentRun } from "./types";

/** OOS 只读纪律审计结果。 */
export interface AblationOosDisciplineAudit {
  /** OOS 轨是否存在（null → 该轨 unassessed）。 */
  readonly oosTrackPresent: boolean;
  /** 变体数（= run.is.samples.length）。 */
  readonly variantCount: number;
  /** IS/OOS 两轨逐变体对齐（variantIndex + code 一致；无 OOS 轨时恒 true）。 */
  readonly tracksAligned: boolean;
  /** 两轨边际归因目标集合相同（无 OOS 轨时恒 true）。 */
  readonly targetSetsIdentical: boolean;
  /** order/components 先验固定（结构保证，恒 true；审计字段）。 */
  readonly orderFixedBeforeEvaluation: boolean;
  /** signals 顺序为贡献清单（IS 降序）的子序列，不反向驱动 order（恒 true；审计字段）。 */
  readonly signalsDoNotDriveOrder: boolean;
  /** 全部通过 = violations 为空。 */
  readonly passed: boolean;
  /** 违规明细（空 = 无违规）。 */
  readonly violations: readonly string[];
}

/**
 * 复核一次消融记录的 OOS 只读纪律（机器检查）。
 * 反序列化后调用可再次确认归档内容未破坏「OOS 只读」结构不变量。
 */
export function verifyAblationOosDiscipline(run: AblationAssessmentRun): AblationOosDisciplineAudit {
  const violations: string[] = [];
  const variantCount = run.is.samples.length;
  const oosTrackPresent = run.oos !== null;

  let tracksAligned = true;
  if (oosTrackPresent && run.oos !== null) {
    if (run.oos.samples.length !== variantCount) {
      tracksAligned = false;
      violations.push(
        `变体数不一致：IS=${variantCount}, OOS=${run.oos.samples.length}（两轨必须消费同一变体集合）`,
      );
    } else {
      run.oos.samples.forEach((oosSample, index) => {
        const isSample = run.is.samples[index];
        if (
          isSample === undefined
          || isSample.variant.variantIndex !== oosSample.variant.variantIndex
          || isSample.variant.code !== oosSample.variant.code
        ) {
          tracksAligned = false;
          violations.push(
            `索引 ${index} 变体不对齐：IS=${isSample?.variant.code ?? "缺失"} `
            + `vs OOS=${oosSample.variant.code}`,
          );
        }
      });
    }
  }

  // 边际归因目标集合一致性（两轨同一变体集合 → 同一 marginalTarget 集合）。
  let targetSetsIdentical = true;
  if (oosTrackPresent && run.oos !== null) {
    const isTargets = new Set(run.is.samples.map((sample) => sample.variant.marginalTargetId));
    const oosTargets = new Set(run.oos.samples.map((sample) => sample.variant.marginalTargetId));
    if (isTargets.size !== oosTargets.size
      || !Array.from(isTargets).every((id) => oosTargets.has(id))) {
      targetSetsIdentical = false;
      violations.push("IS/OOS 两轨边际归因目标集合不一致（OOS 混入了不同的消融目标）");
    }
  }

  // signals 顺序应为贡献清单子序列（不反向驱动 order）。检查信号 targetId 相对贡献顺序单调。
  let signalsDoNotDriveOrder = true;
  const contributionOrder = new Map(run.contributions.map((entry, index) => [entry.targetId, index]));
  let last = -1;
  for (const signal of run.signals) {
    const position = contributionOrder.get(signal.targetId);
    if (position === undefined || position <= last) {
      signalsDoNotDriveOrder = false;
      violations.push(`信号 targetId=${signal.targetId} 相对贡献清单顺序非法（可能被 OOS 反向驱动）`);
      break;
    }
    last = position;
  }

  return {
    oosTrackPresent,
    variantCount,
    tracksAligned,
    targetSetsIdentical,
    orderFixedBeforeEvaluation: true,
    signalsDoNotDriveOrder,
    passed: violations.length === 0,
    violations,
  };
}
