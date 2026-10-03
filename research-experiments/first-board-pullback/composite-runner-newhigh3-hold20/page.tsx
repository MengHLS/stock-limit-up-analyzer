/** 组合层 Runner hold=20 验证页 —— 只消费 props，不 import experiment.ts 或 server/**。 */
import type { ExperimentPageProps } from "@/researchExperiments/contract";

export default function CompositeRunnerNewHigh3Hold20Page(props: ExperimentPageProps) {
  const { descriptor, outcome } = props;
  const result = outcome?.result ?? null;
  const parity = (result?.customPayload as { parity?: { pass?: boolean } } | undefined)?.parity;
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">{descriptor.name}</h1>
      <p className="text-sm text-muted-foreground">{descriptor.description}</p>
      <p className="text-sm">
        PROMOTE-001 parity：{parity === undefined ? "（无结果）" : parity.pass ? "PASS" : "FAIL"}
      </p>
      <p className="text-sm text-muted-foreground">
        结果明细见平台通用渲染器（表格 / 统计 / Gate）。
      </p>
    </div>
  );
}
