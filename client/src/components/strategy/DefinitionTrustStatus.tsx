/**
 * 「当前组合状态」—— 策略定义页的**信任层**。
 *
 * ## 它回答什么
 *
 * 五块（选股/出场/仓位/成本/可调参数）可以各自换方案、各自调参数 ⇒ 组合数达数百量级，
 * **其中绝大多数从未被验证**。用户真正要问的不是"界面怎么用"，而是：
 *
 * > **这还是我在评估里看到的那一套吗？那个数字现在还作数吗？**
 *
 * 三态：
 *   - 🟢 **一致**：与某个已落库版本相同（方案未换、参数全默认、定义未改）⇒ 可直接引用它的评估 / 模拟盘结论；
 *   - 🟡 **变体**：以某个版本为起点，但参数/定义被改过 ⇒ 明说"原版本的结论**不直接适用**"，并列出改了哪几项；
 *   - ⚪ **全新**：还没落库（新建）⇒ 明说"**尚未验证**"。
 *
 * ## 纪律
 *   - **不猜**：判定输入（`kind` / `changedParams`）由调用方算好；本组件不做语义推断。
 *   - **不美化**：变体/未验证不配"✓ 优秀"之类的视觉暗示（`.agents/frontend/SKILL.md` §3）。
 *   - **可还原**：变体态提供「还原为已验证版本的参数」——只把**参数**恢复默认，不动其它编辑。
 */
import { AlertTriangle, CheckCircle2, HelpCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DefinitionTrustKind = "MATCH" | "VARIANT" | "UNVERIFIED";

/** 一条"参数被改"的记录（用于变体态列明细）。 */
export interface DefinitionTrustChangedParam {
  /** 槽位 key（`RECIPE` / `EXIT_POLICY` …）。 */
  readonly slotKey: string;
  /** 槽位中文名（"信号配方" / "退出政策"）。 */
  readonly slotLabel: string;
  /** 参数 code。 */
  readonly code: string;
  readonly from: string;
  readonly to: string;
}

export function DefinitionTrustStatus({
  kind,
  basisLabel,
  changedParams,
  dirty,
  onRestoreDefaults,
}: {
  readonly kind: DefinitionTrustKind;
  /** 作为基准的已落库版本坐标（`id@version`）；全新态为 `null`。 */
  readonly basisLabel: string | null;
  readonly changedParams: readonly DefinitionTrustChangedParam[];
  /** 草稿是否有未保存的编辑（参数之外的修改也计入变体）。 */
  readonly dirty: boolean;
  readonly onRestoreDefaults?: () => void;
}) {
  const tone = kind === "MATCH"
    ? "border-emerald-200 bg-emerald-50/60"
    : kind === "VARIANT"
      ? "border-amber-300 bg-amber-50/60"
      : "border-dashed bg-muted/20";
  const Icon = kind === "MATCH" ? CheckCircle2 : (kind === "VARIANT" ? AlertTriangle : HelpCircle);
  const iconTone = kind === "MATCH" ? "text-emerald-700" : (kind === "VARIANT" ? "text-amber-700" : "text-muted-foreground");

  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`} data-trust-status={kind} data-trust-changed-count={changedParams.length}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} />
        <span className="text-sm font-semibold">
          {kind === "MATCH" && <>与已评估版本 <span className="font-mono">{basisLabel ?? "—"}</span> <strong>完全一致</strong></>}
          {kind === "VARIANT" && <>这是 <span className="font-mono">{basisLabel ?? "—"}</span> 的<strong>变体</strong></>}
          {kind === "UNVERIFIED" && <>全新组合 · <strong>尚未验证</strong></>}
        </span>
        {kind === "VARIANT" && changedParams.length > 0 && (
          <span className="text-[11px] text-amber-900">参数已改 {changedParams.length} 项</span>
        )}
        {kind === "VARIANT" && changedParams.length === 0 && dirty && (
          <span className="text-[11px] text-amber-900">定义已修改</span>
        )}
        {kind === "VARIANT" && onRestoreDefaults !== undefined && changedParams.length > 0 && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-[11px]" onClick={onRestoreDefaults}>
            <RotateCcw className="mr-1 h-3 w-3" />还原为已验证版本的参数
          </Button>
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        {kind === "MATCH" && "方案与参数都未改动 ⇒ 可以直接引用它的评估 / 模拟盘结论（见上方「最终评估」「模拟盘」Tab）。"}
        {kind === "VARIANT" && "参数被改过 ⇒ 原版本的数字**不直接适用**；要下结论请重新评估（上方「运行回测」）。"}
        {kind === "UNVERIFIED" && "还没有对应的评估留档 ⇒ 这里不会引用任何既有版本的结论（不拿别的版本冒名顶替）。"}
      </p>

      {kind === "VARIANT" && changedParams.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-900">
          {changedParams.map(item => (
            <li key={`${item.slotKey}:${item.code}`}>
              <span className="font-medium">{item.slotLabel}</span> ·
              <span className="font-mono"> {item.code}</span>：{item.from} → <strong>{item.to}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}