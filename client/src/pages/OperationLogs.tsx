import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { AlertCircle, ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type OperationTypeFilter = "" | "image_recognition" | "date_refresh";
type OperationStatusFilter = "" | "processing" | "success" | "empty" | "failed";

const operationTypeLabels: Record<Exclude<OperationTypeFilter, "">, string> = {
  image_recognition: "图片识别",
  date_refresh: "日期数据刷新",
};

const operationStatusLabels: Record<Exclude<OperationStatusFilter, "">, string> = {
  processing: "处理中",
  success: "成功",
  empty: "空结果",
  failed: "失败",
};

function formatLogTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusVariant(status: OperationStatusFilter) {
  if (status === "failed") return "destructive" as const;
  if (status === "success") return "default" as const;
  return "secondary" as const;
}

export default function OperationLogsPage() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [operationType, setOperationType] = useState<OperationTypeFilter>("");
  const [status, setStatus] = useState<OperationStatusFilter>("");
  const [date, setDate] = useState("");

  const queryInput = useMemo(() => ({
    operationType: operationType || undefined,
    status: status || undefined,
    date: date || undefined,
    limit: 200,
  }), [date, operationType, status]);
  const { data: logs, isLoading, isFetching, error, refetch } = trpc.operationLog.getRecent.useQuery(queryInput, {
    enabled: isAuthenticated,
  });
  const [retryingLogId, setRetryingLogId] = useState<number | null>(null);
  const retryOperation = trpc.operationLog.retry.useMutation();
  const recognizeRetry = trpc.image.recognize.useMutation();

  const handleRetry = async (logId: number) => {
    setRetryingLogId(logId);
    try {
      const result = await retryOperation.mutateAsync({ logId });
      if (result.status === "ready" && result.retryInput) {
        await recognizeRetry.mutateAsync(result.retryInput);
        toast.success("图片识别重试已完成，新的识别日志已写入");
      } else if (result.status === "ready") {
        throw new Error("失败日志缺少可重试的图片参数");
      } else if (result.status === "failed") {
        toast.error(result.message || "日期刷新重试失败");
      } else {
        toast.success(result.message || "失败操作已重试");
      }
      await refetch();
    } catch (retryError) {
      toast.error(retryError instanceof Error ? retryError.message : "重试失败，请稍后再试");
    } finally {
      setRetryingLogId(null);
    }
  };

  if (!authLoading && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center p-4 py-20">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>请先登录</CardTitle>
            <CardDescription>登录后才能查看自己的识别与刷新操作日志</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button asChild><a href={getLoginUrl()}>登录</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-[1400px] py-6">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ClipboardList className="h-4 w-4 text-orange-600" />
        <h1 className="text-lg font-semibold">操作日志</h1>
      </div>
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">操作日志</h1>
          <p className="mt-1 text-sm text-slate-600">记录当前账号发起的图片识别结果，以及识别完成后的上传日期数据刷新状态。</p>
        </div>

        <Card className="mb-5 border-slate-200/80 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">筛选日志</CardTitle>
            <CardDescription>最多展示最近200条记录；日志仅对当前登录账号可见。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4 md:items-end">
              <div className="space-y-2">
                <Label htmlFor="operation-type">操作类型</Label>
                <select id="operation-type" value={operationType} onChange={(event) => setOperationType(event.target.value as OperationTypeFilter)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">全部类型</option>
                  <option value="image_recognition">图片识别</option>
                  <option value="date_refresh">日期数据刷新</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operation-status">状态</Label>
                <select id="operation-status" value={status} onChange={(event) => setStatus(event.target.value as OperationStatusFilter)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">全部状态</option>
                  <option value="processing">处理中</option>
                  <option value="success">成功</option>
                  <option value="empty">空结果</option>
                  <option value="failed">失败</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operation-date">请求日期</Label>
                <Input id="operation-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} className="gap-2">
                <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                刷新日志
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-orange-600" />
              历史记录
              {!isLoading && <Badge variant="secondary">{logs?.length ?? 0} 条</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在加载操作日志...</div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error.message || "日志加载失败"}</div>
            )}
            {!isLoading && !error && (logs?.length ?? 0) === 0 && (
              <div className="rounded-lg bg-muted/50 p-8 text-center text-sm text-muted-foreground">当前筛选条件下暂无操作日志。</div>
            )}
            {!isLoading && !error && (logs?.length ?? 0) > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">时间</th>
                      <th className="px-4 py-3 font-medium">操作</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 font-medium">文件/图片</th>
                      <th className="px-4 py-3 font-medium">结果</th>
                      <th className="px-4 py-3 font-medium">说明</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {logs?.map((log) => {
                      const type = log.operationType as Exclude<OperationTypeFilter, "">;
                      const logStatus = log.status as Exclude<OperationStatusFilter, "">;
                      return (
                        <tr key={log.id} className="align-top hover:bg-muted/30">
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatLogTime(log.createdAt)}</td>
                          <td className="px-4 py-3 font-medium">{operationTypeLabels[type] ?? log.operationType}</td>
                          <td className="px-4 py-3"><Badge variant={statusVariant(logStatus)}>{operationStatusLabels[logStatus] ?? log.status}</Badge></td>
                          <td className="whitespace-nowrap px-4 py-3">{log.effectiveDate || log.requestedDate || "-"}</td>
                          <td className="max-w-[220px] px-4 py-3 text-muted-foreground">
                            <p className="truncate" title={log.fileName ?? undefined}>{log.fileName || (log.imageId ? `图片 #${log.imageId}` : "-")}</p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {type === "image_recognition" ? `识别 ${log.recognizedCount ?? 0} 条` : `刷新 ${log.refreshedCount ?? 0} 条`}
                          </td>
                          <td className="max-w-[320px] px-4 py-3 text-muted-foreground"><p className="break-words">{log.message || "-"}</p></td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            {logStatus === "failed" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleRetry(log.id)}
                                disabled={retryingLogId !== null}
                                className="gap-1"
                              >
                                {retryingLogId === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                {retryingLogId === log.id ? "重试中" : "一键重试"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
