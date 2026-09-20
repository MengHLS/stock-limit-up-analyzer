/**
 * FRONTEND-FINAL-001（P1-1）— 参数引用面检查卡（**只读**，不改策略、不发写请求）。
 *
 * ## 为什么需要这张卡
 *
 * 参数 Search 有一个**看不到的失败模式**：策略版本声明了 `TUNABLE` 参数，但规则图一个都没引用
 * ⇒ 搜索出的「不同取值」产出逐字节相同的权益曲线（假差异）。后端因此以
 * `PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER` 拒绝创建 Run。
 *
 * 规格 §六：这**不能只是后端返回一个错误码** —— 页面必须显式解释「当前 Strategy Version
 * 没有被执行链引用的 TUNABLE 参数，因此无法进行有效 Parameter Search」，并给出
 * 「当前版本 / 参数列表 / 参数角色 / 是否被引用 / 下一步入口」。
 *
 * ## 数据来源（前端纪律）
 *
 * - 引用面判定**一律读后端投影**（`research.strategy.loadBundle` 的
 *   `projections.parameters[].referenced` + `parameterReferenceCheck`）；
 *   🔴 前端**不重算**引用面、不解析策略 JSON、**不造 mock 数据**；
 * - `parameterReferenceCheck.applied === false` ⇒ 后端**不可判定**：此时必须显示「不可判定」，
 *   **不得**把 `referenced === false` 说成「未被引用」（那是伪造结论）；
 * - 本卡只渲染 + 跳转，🔴 不提供任何写库按钮（策略内容不可由本页修改）。
 */

import { ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { EmptyState, ErrorState, StatusBadge } from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { rpcErrorToDiagnostic } from "@/lib/rpcDiagnostic";

/** 后端拒绝「无被引用 TUNABLE 参数」的 Run 时使用的领域码（与 executor / paramSearchRouter 同字面量）。 */
export const PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER =
  "PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER";

export interface ParameterReferenceCheckCardProps {
  /** 策略 ID（必填；空串 ⇒ 不查询，显示空态）。 */
  readonly strategyId: string;
  /** 策略版本（semver；空串 ⇒ 不查询，显示空态）。 */
  readonly strategyVersion: string;
  /**
   * 事后场景：某个 Run 落库的 `errorCode`（`undefined`/`null` = 不是从错误现场打开的）。
   * 等于本卡领域码时，额外展示后端拒绝时留下的原文，便于把「为什么被拒」和参数表对上。
   */
  readonly errorCode?: string | null;
  /** 事后场景：该 Run 落库的 `errorMessage`。 */
  readonly errorMessage?: string | null;
}

/** 默认值单元格：投影里是 JSON 文本（`null` = 未声明默认值，与「默认值就是 null」区分）。 */
function defaultValueText(defaultValueJson: string | null): string {
  return defaultValueJson === null ? "—（未声明）" : defaultValueJson;
}

function numText(value: number | null): string {
  return value === null ? "—" : String(value);
}

export default function ParameterReferenceCheckCard({
  strategyId,
  strategyVersion,
  errorCode = null,
  errorMessage = null,
}: ParameterReferenceCheckCardProps) {
  const id = strategyId.trim();
  const version = strategyVersion.trim();

  const bundleQuery = trpc.strategyDomain.strategy.loadBundle.useQuery(
    { strategyId: id, version },
    { enabled: id !== "" && version !== "", retry: false, refetchOnWindowFocus: false },
  );

  const check = bundleQuery.data?.parameterReferenceCheck ?? null;
  const parameters = bundleQuery.data?.projections.parameters ?? [];

  /** 后端是否真的完成了引用面判定（`false` = 不可判定，禁止把 referenced 当结论用）。 */
  const applied = check?.applied === true;
  const tunableRows = parameters.filter((row) => row.parameterRole === "TUNABLE");
  const referencedTunableRows = tunableRows.filter((row) => row.referenced);
  /** 判定通过：≥1 个 TUNABLE 参数确实被执行链引用。 */
  const hasReferencedTunable = applied && referencedTunableRows.length > 0;
  /** 判定为「无被引用的 TUNABLE 参数」= 后端会以领域码拒绝该 Run 的情形。 */
  const noReferencedTunable = applied && referencedTunableRows.length === 0;
  /** 后端拒绝该 Run 的现场（仅事后场景才有值）。 */
  const rejectedByDomainCode = errorCode === PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER;

  /** 徽标：绿 = 引用面可用；红 = 无被引用 TUNABLE；黄 = 不可判定（不冒充结论）。 */
  const badgeStatus = hasReferencedTunable ? "ACCEPTED" : noReferencedTunable ? "BLOCKED" : "INCONCLUSIVE";
  const badgeLabel = hasReferencedTunable
    ? `已引用 TUNABLE ${String(referencedTunableRows.length)} / ${String(tunableRows.length)}`
    : noReferencedTunable
      ? "无被引用的 TUNABLE 参数"
      : "不可判定";

  return (
    <div className="rounded-md border border-border p-3" id="ps-parameter-reference-check">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" />
          参数引用面检查
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {id === "" || version === "" ? "（未给坐标）" : `${id}@${version}`}
          </span>
          {id !== "" && version !== "" && <StatusBadge status={badgeStatus} label={badgeLabel} />}
        </div>
      </div>

      {id === "" || version === "" ? (
        <EmptyState
          icon={ShieldCheck}
          title="还没有策略坐标"
          description="填写策略 ID 与版本后即可检查引用面（只读，不会新建 / 修改任何策略）。"
          className="py-6"
        />
      ) : bundleQuery.isLoading ? (
        /* 四态之一：loading —— 用 Skeleton 表示「正在读策略版本投影」 */
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : bundleQuery.error !== null && bundleQuery.error !== undefined ? (
        /* 四态之二：error —— 统一走 ErrorState + rpcErrorToDiagnostic，不裸抛错误码 */
        <ErrorState
          error={rpcErrorToDiagnostic(bundleQuery.error.message, {
            title: "参数引用面检查失败",
          })}
        />
      ) : (
        <>
          {/* 不可判定（后端未完成引用面判定）—— 显性降级，绝不冒充「未被引用」 */}
          {!applied && (
            <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              {check?.note ?? "后端未返回引用面判定口径，无法解释 referenced 字段。"}
            </p>
          )}

          {/* 🔴 判定为「无被引用的 TUNABLE 参数」：显著展示业务文案 + 领域码 */}
          {noReferencedTunable && (
            <div className="mb-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p className="font-medium">
                当前 Strategy Version 没有被执行链引用的 TUNABLE 参数，无法进行有效 Parameter Search。
              </p>
              <p className="mt-1">
                领域码：
                <code className="font-mono">{PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER}</code>
                （后端拒绝该 Run 的领域码）。
              </p>
              {rejectedByDomainCode && errorMessage !== null && errorMessage.trim() !== "" && (
                <p className="mt-1 break-all">后端拒绝该 Run 时的原文：{errorMessage}</p>
              )}
            </div>
          )}

          {/* 事后场景：Run 确实被该领域码拒绝，但当前投影判定通过 ⇒ 如实指出两者不一致（不自动改策略） */}
          {rejectedByDomainCode && !noReferencedTunable && (
            <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              该 Run 曾被后端以 <code className="font-mono">{PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER}</code>
              {" "}拒绝，但当前投影的判定并非「无被引用的 TUNABLE 参数」
              {applied ? "" : "（本次判定不可用）"}；请以策略详情页的规则图为准，本页不做任何自动修正。
              {errorMessage !== null && errorMessage.trim() !== "" ? ` 后端原文：${errorMessage}` : ""}
            </p>
          )}

          {check !== null && applied && (
            <p className="mb-2 text-xs text-muted-foreground">{check.note}</p>
          )}

          {/* 四态之三：空（该版本没有可展示的参数投影行） */}
          {parameters.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="该版本没有参数投影行"
              description="投影行由 canonical definition 派生；历史 v1 文档没有富定义 ⇒ 参数 / 角色 / 引用面都不可读（不是「没有参数」）。"
              className="py-6"
            />
          ) : (
            /* 四态之四：success —— 参数表（引用列为「否」的 TUNABLE 行加淡红底） */
            <div className="max-h-80 overflow-auto rounded border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">code</TableHead>
                    <TableHead className="text-xs">名称</TableHead>
                    <TableHead className="text-xs">dataType</TableHead>
                    <TableHead className="text-xs">参数角色</TableHead>
                    <TableHead className="text-xs">默认值</TableHead>
                    <TableHead className="text-xs">min</TableHead>
                    <TableHead className="text-xs">max</TableHead>
                    <TableHead className="text-xs">step</TableHead>
                    <TableHead className="text-xs">是否被引用</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parameters.map((row) => {
                    const unreferencedTunable = applied && row.parameterRole === "TUNABLE" && !row.referenced;
                    return (
                      <TableRow
                        key={row.code}
                        className={unreferencedTunable ? "bg-red-50" : undefined}
                      >
                        <TableCell className="font-mono text-xs">{row.code}</TableCell>
                        <TableCell className="text-xs">{row.name}</TableCell>
                        <TableCell className="font-mono text-xs">{row.dataType}</TableCell>
                        <TableCell className="font-mono text-xs">{row.parameterRole}</TableCell>
                        <TableCell className="font-mono text-xs">{defaultValueText(row.defaultValueJson)}</TableCell>
                        <TableCell className="font-mono text-xs">{numText(row.minValue)}</TableCell>
                        <TableCell className="font-mono text-xs">{numText(row.maxValue)}</TableCell>
                        <TableCell className="font-mono text-xs">{numText(row.stepValue)}</TableCell>
                        <TableCell
                          className={`text-xs ${unreferencedTunable ? "font-medium text-destructive" : ""}`}
                        >
                          {applied ? (row.referenced ? "是" : "否") : "不可判定"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 下一步入口：只指向既有页面，本卡不做任何写操作 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              href={`/strategies/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              去策略详情页
            </Link>
            <span>去策略详情页检查规则图是否引用了这些参数（本页不会自动修改策略）。</span>
          </div>
        </>
      )}
    </div>
  );
}
