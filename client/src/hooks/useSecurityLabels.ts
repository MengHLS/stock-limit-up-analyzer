/**
 * 成交明细的「证券名称 + 代码」字典（只读查询）。
 *
 * 为什么需要它：闭环回测结果里 `trades[].securityId` 是 Research canonical identity
 * `sec_<uuid>`，直接印在表格里用户看不懂。名称与代码必须由服务端解析
 * （`researchRun.securityLabels`：identifier history → limit_up_records），
 * 前端**不做**任何身份翻译。
 *
 * 为什么会话级缓存：同一次回测的成交标的集合在一次页面停留内不会变，
 * `staleTime` 设 5 分钟可避免切换标签页 / 重渲染时反复往返。
 * 🔴 查询失败**不抛错**：名称属展示增强，失败就在表格里回退显示原始 securityId，
 *    绝不让「查不到名字」把整块回测结果带崩。
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/** 服务端返回的单个标签（与 `shared/researchContracts.securityLabelSchema` 同形）。 */
export interface SecurityLabelView {
  securityId: string;
  code: string | null;
  name: string | null;
  exchange: string | null;
}

/** 单次查询的 identity 上限（与服务端契约一致）。 */
const MAX_IDS = 500;

export function useSecurityLabels(securityIds: readonly string[]): {
  /** `securityId → 标签`；未加载完成或查询失败时为 null（调用方回退显示原始 id）。 */
  labels: Record<string, SecurityLabelView> | null;
  isLoading: boolean;
} {
  // 稳定 key：trade 列表每次渲染都可能产生新数组，用拼接串做依赖避免无限重查。
  const key = useMemo(
    () => Array.from(new Set(securityIds.filter(id => id.length > 0))).sort().slice(0, MAX_IDS).join("|"),
    [securityIds],
  );
  const ids = useMemo(() => (key.length === 0 ? [] : key.split("|")), [key]);

  const query = trpc.researchRun.securityLabels.useQuery(
    { securityIds: ids },
    {
      enabled: ids.length > 0,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  );

  return {
    labels: (query.data as Record<string, SecurityLabelView> | undefined) ?? null,
    isLoading: ids.length > 0 && query.isLoading,
  };
}
