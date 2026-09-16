/**
 * CreateHypothesisDialog — 从一条 Finding 提出**可测假设**（RESEARCH-FINDING-001 §26）。
 *
 * 编排：
 *   - 可选携带来源 Finding（`sourceFindingIds` + 用 Finding 标题预填 statement）；
 *   - 填 name / statement / target / horizon / expectedDirection / expectedEffect；
 *   - `researchEngine.createHypothesis`（admin）。
 *
 * 诚实点：
 *   - 这里**只提出假设**（落 DRAFT），不自动置 TESTABLE、不自动跑验证 —— 那需要条件三件套
 *     齐备后再经「测假设」逐级推进（§26「不要自动生成 Strategy」的同一纪律）；
 *   - conditions 属高级形式化（依赖变量目录），本对话框不代填，留待条件编辑器补充。
 */

import { useState } from "react";
import { toast } from "sonner";
import { Lightbulb, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FindingVm } from "@/adapters/researchEngineAdapter";

const DIRECTIONS = [
  { value: "POSITIVE", label: "正向（越高越好）" },
  { value: "NEGATIVE", label: "负向（越高越差）" },
  { value: "NON_MONOTONIC", label: "非单调（中间最优）" },
  { value: "NEUTRAL", label: "中性（无方向预期）" },
] as const;

export function CreateHypothesisDialog({
  experimentId,
  sourceFinding,
}: {
  experimentId: number;
  sourceFinding?: FindingVm;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [statement, setStatement] = useState("");
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState("");
  const [direction, setDirection] = useState<string>("");
  const [expectedEffect, setExpectedEffect] = useState("");

  const utils = trpc.useUtils();
  const create = trpc.researchEngine.createHypothesis.useMutation({
    onSuccess: () => {
      toast.success("假设已提出");
      void utils.researchEngine.getExperiment.invalidate();
      setOpen(false);
      setName("");
      setStatement("");
      setTarget("");
      setHorizon("");
      setDirection("");
      setExpectedEffect("");
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && sourceFinding) {
      setName(`H-${sourceFinding.findingTypeLabel}（来自 Finding #${sourceFinding.id}）`);
      setStatement(sourceFinding.title);
      setTarget(sourceFinding.target ?? "");
      setHorizon(sourceFinding.headline.peakHorizon !== null ? `T+${sourceFinding.headline.peakHorizon}` : "");
      setDirection("");
      setExpectedEffect("");
    }
  }

  const canSubmit =
    name.trim().length > 0 && statement.trim().length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
          {sourceFinding ? "提假设" : "新建假设"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>提出可测假设</DialogTitle>
          <DialogDescription>
            {sourceFinding
              ? "基于这条发现提出一条可验证的假设（落 DRAFT，随后可「测假设」逐级推进）。"
              : "提出一条研究假设。假设需要条件 / 目标 / 视界三件套齐备后才能进入验证。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hyp-name">名称</Label>
            <Input
              id="hyp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="H1-首板回踩后缩量"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hyp-statement">陈述（可证伪）</Label>
            <Textarea
              id="hyp-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="首板后回踩且缩量的股票，未来 5 日收益显著高于全样本。"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hyp-target">目标变量</Label>
              <Input
                id="hyp-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="future_return_5d"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hyp-horizon">验证视界</Label>
              <Input
                id="hyp-horizon"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
                placeholder="T+5"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>预期方向</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger>
                <SelectValue placeholder="选择预期方向" />
              </SelectTrigger>
              <SelectContent>
                {DIRECTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hyp-effect">预期效应（人读描述，非数值承诺）</Label>
            <Input
              id="hyp-effect"
              value={expectedEffect}
              onChange={(e) => setExpectedEffect(e.target.value)}
              placeholder="回踩缩量组的 5 日收益明显高于全样本（约 +2~3 个百分点）"
            />
          </div>

          {sourceFinding && (
            <p className="text-[11px] text-muted-foreground">
              来源 Finding #{sourceFinding.id}（{sourceFinding.findingTypeLabel}）——
              转成假设后可在验证通过时再转策略候选。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              create.mutate({
                experimentId,
                name: name.trim(),
                statement: statement.trim(),
                target: target.trim() || undefined,
                horizon: horizon.trim() || undefined,
                expectedDirection: (direction || undefined) as "POSITIVE" | "NEGATIVE" | "NON_MONOTONIC" | "NEUTRAL" | undefined,
                expectedEffect: expectedEffect.trim() || undefined,
                ...(sourceFinding ? { sourceFindingIds: [sourceFinding.id] } : {}),
              })
            }
          >
            {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            提出假设
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
