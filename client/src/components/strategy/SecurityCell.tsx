/**
 * 「证券」单元格 —— **名称 + 代码**（策略域共用）。
 *
 * 为什么单独成文件：**闭环回测结果**与**模拟盘留档**里的 `securityId` 都是 Research
 * canonical identity（`sec_<uuid>`），直接印在表格里用户读不懂；名称与代码必须由服务端
 * 解析（`researchRun.securityLabels`，见 `@/hooks/useSecurityLabels`），**前端不做任何身份翻译**。
 * 该实现原本只在 `ClosedLoopRunResultPanel` 内，2026-10-07 提升为共用组件（FE-PLAN-008 P0-1），
 * 避免「同一份 identity 出现两套展示口径」。
 *
 * 四种**如实**状态，任何一种都不臆造（缺就显示「—」）：
 *   ① 解析成功 → 名称在上、canonical 代码在下；
 *   ② 解析出代码但名称源未收录 → 名称位「—」，**代码照常显示**（名称源只收录涨停过的
 *      股票，回测 universe 是全市场，这种缺口是数据现实）；
 *   ③ 字典未到（加载中 / 查询失败）→ 回退显示原始 `securityId`（截断，完整值挂 `title`）；
 *   ④ identity 不在标识历史里 → 同 ③（`code` 为 null）。
 */
import type { SecurityLabelView } from "@/hooks/useSecurityLabels";

export function SecurityCell({
  securityId,
  label,
}: {
  securityId: string;
  label: SecurityLabelView | null;
}) {
  if (label?.code) {
    return (
      <div className="flex flex-col leading-tight">
        <span>{label.name ?? "—"}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {label.code}
        </span>
      </div>
    );
  }
  return (
    <span
      className="font-mono text-[10px] text-muted-foreground"
      title={securityId}
    >
      {securityId.length <= 14 ? securityId : `${securityId.slice(0, 14)}…`}
    </span>
  );
}
