import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Plus, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";


export default function MarketDataInputPage() {
  const { isAuthenticated } = useAuth();
  
  const [formData, setFormData] = useState({
    dataDate: "",
    turnover: "",
    marginBalance: "",
    note: "",
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const upsertMarketDataMutation = trpc.market.upsert.useMutation({
    onSuccess: () => {
      toast.success("大盘数据已保存");
      setSuccessMessage("数据已成功保存！");
      setFormData({
        dataDate: "",
        turnover: "",
        marginBalance: "",
        note: "",
      });
      setTimeout(() => setSuccessMessage(""), 3000);
    },
    onError: (error) => {
      toast.error("保存失败：" + (error.message || "请重试"));
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证必填字段
    if (!formData.dataDate || !formData.turnover || !formData.marginBalance) {
      toast.error("请填写所有必填字段（日期、成交额、两融余额）");
      return;
    }

    // 验证数字格式
    if (isNaN(parseFloat(formData.turnover)) || isNaN(parseFloat(formData.marginBalance))) {
      toast.error("成交额和两融余额必须是有效的数字");
      return;
    }

    setIsSubmitting(true);
    try {
      await upsertMarketDataMutation.mutateAsync({
        dataDate: formData.dataDate,
        turnover: formData.turnover,
        marginBalance: formData.marginBalance,
        note: formData.note || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center py-20">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>需要登录</CardTitle>
            <CardDescription>请先登录以录入大盘数据</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">录入大盘数据</h1>
      </div>
        <Card>
          <CardHeader>
            <CardTitle>大盘交易数据录入</CardTitle>
            <CardDescription>
              录入每日的大盘成交额和两融余额数据，用于关联分析涨停情况
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 成功提示 */}
              {successMessage && (
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="text-sm text-green-700">{successMessage}</p>
                </div>
              )}

              {/* 日期字段 */}
              <div className="space-y-2">
                <Label htmlFor="dataDate" className="text-base font-semibold">
                  交易日期 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dataDate"
                  name="dataDate"
                  type="date"
                  value={formData.dataDate}
                  onChange={handleInputChange}
                  className="h-10 text-base"
                  required
                />
                <p className="text-xs text-muted-foreground">格式：YYYY-MM-DD</p>
              </div>

              {/* 成交额字段 */}
              <div className="space-y-2">
                <Label htmlFor="turnover" className="text-base font-semibold">
                  日均成交额（亿元） <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="turnover"
                  name="turnover"
                  type="number"
                  step="0.01"
                  placeholder="例如：1500.5"
                  value={formData.turnover}
                  onChange={handleInputChange}
                  className="h-10 text-base"
                  required
                />
                <p className="text-xs text-muted-foreground">请输入数字，单位为亿元</p>
              </div>

              {/* 两融余额字段 */}
              <div className="space-y-2">
                <Label htmlFor="marginBalance" className="text-base font-semibold">
                  两融余额（亿元） <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="marginBalance"
                  name="marginBalance"
                  type="number"
                  step="0.01"
                  placeholder="例如：950.3"
                  value={formData.marginBalance}
                  onChange={handleInputChange}
                  className="h-10 text-base"
                  required
                />
                <p className="text-xs text-muted-foreground">融资融券余额，单位为亿元</p>
              </div>

              {/* 备注字段 */}
              <div className="space-y-2">
                <Label htmlFor="note" className="text-base font-semibold">
                  备注（可选）
                </Label>
                <Textarea
                  id="note"
                  name="note"
                  placeholder="添加任何相关备注，如市场事件、特殊情况等"
                  value={formData.note}
                  onChange={handleInputChange}
                  className="min-h-24 text-base"
                />
                <p className="text-xs text-muted-foreground">最多500字</p>
              </div>

              {/* 提交按钮 */}
              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 h-10 text-base"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      保存数据
                    </>
                  )}
                </Button>
                <Link href="/">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-10 text-base"
                  >
                    取消
                  </Button>
                </Link>
              </div>

              {/* 帮助提示 */}
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-700">
                    <p className="font-semibold mb-1">数据来源建议：</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>成交额：可从新浪财经、东方财富等金融网站获取</li>
                      <li>两融余额：可从中国证券登记结算公司官网查询</li>
                      <li>建议每个交易日结束后及时录入数据</li>
                    </ul>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
    </div>
  );
}
