import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";

export default function MarketData() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [turnover, setTurnover] = useState("");
  const [marginBalance, setMarginBalance] = useState("");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: marketDataList = [] } = trpc.market.getAll.useQuery();
  const upsertMutation = trpc.market.upsert.useMutation({
    onSuccess: () => {
      alert("大盘数据已保存");
      setTurnover("");
      setMarginBalance("");
      setNote("");
      setSelectedDate(new Date());
    },
    onError: (error) => {
      alert("错误: " + error.message);
    },
  });

  const deleteMutation = trpc.market.delete.useMutation({
    onSuccess: () => {
      alert("数据已删除");
    },
    onError: (error) => {
      alert("错误: " + error.message);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !turnover || !marginBalance) {
      alert("请填写所有必填字段");
      return;
    }

    setIsLoading(true);
    try {
      await upsertMutation.mutateAsync({
        dataDate: format(selectedDate, "yyyy-MM-dd"),
        turnover,
        marginBalance,
        note,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">大盘数据录入</h1>
      </div>

      {/* 录入表单 */}
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-base">录入大盘数据</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 pb-3 px-3 space-y-3">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* 日期选择 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">日期</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    {selectedDate ? format(selectedDate, "yyyy-MM-dd") : "选择日期"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* 成交额 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">大盘成交额（亿元）</label>
              <Input
                type="text"
                placeholder="例如: 15000"
                value={turnover}
                onChange={(e) => setTurnover(e.target.value)}
              />
            </div>

            {/* 两融余额 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">两融余额（亿元）</label>
              <Input
                type="text"
                placeholder="例如: 8500"
                value={marginBalance}
                onChange={(e) => setMarginBalance(e.target.value)}
              />
            </div>

            {/* 备注 */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">备注（可选）</label>
              <Input
                type="text"
                placeholder="例如: 市场情况说明"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "保存中..." : "保存数据"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 数据列表 */}
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-base">历史数据</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 pb-3 px-3">
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {marketDataList.length === 0 ? (
              <p className="text-sm text-gray-500">暂无数据</p>
            ) : (
              marketDataList.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded bg-gray-50">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.dataDate}</p>
                    <p className="text-xs text-gray-600">
                      成交额: {item.turnover}亿 | 两融余额: {item.marginBalance}亿
                    </p>
                    {item.note && <p className="text-xs text-gray-500">备注: {item.note}</p>}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ id: item.id })}
                    disabled={deleteMutation.isPending}
                  >
                    删除
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
