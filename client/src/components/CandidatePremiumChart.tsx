import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type PremiumScoreBand = {
  label: string;
  sampleSize: number;
  premium: {
    sampleSize: number;
    openSampleSize: number;
    closeSampleSize: number;
    averageOpenPremium: number | null;
    averageClosePremium: number | null;
    openPremiumPositiveRate: number | null;
    closePremiumPositiveRate: number | null;
  };
  tPlus2Premium: {
    sampleSize: number;
    openSampleSize: number;
    closeSampleSize: number;
    averageOpenPremium: number | null;
    averageClosePremium: number | null;
    openPremiumPositiveRate: number | null;
    closePremiumPositiveRate: number | null;
  };
};

type CandidatePremiumChartProps = {
  scoreBands: PremiumScoreBand[];
};

function premiumTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="min-w-[190px] rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="font-semibold text-slate-800">{point.label}</p>
      <p className="mt-1 text-xs text-sky-700">T+1 平均开盘/收盘：{point.averageOpenPremium ?? "-"}% / {point.averageClosePremium ?? "-"}%</p>
      <p className="mt-1 text-xs text-violet-700">T+2 平均开盘/收盘：{point.secondDayAverageOpenPremium ?? "-"}% / {point.secondDayAverageClosePremium ?? "-"}%</p>
      <p className="mt-1 text-xs text-slate-500">T+1 开盘/收盘样本 {point.openSampleSize}/{point.closeSampleSize} 条 · T+2 开盘/收盘样本 {point.secondDayOpenSampleSize}/{point.secondDayCloseSampleSize} 条</p>
      <p className="mt-1 text-xs text-slate-500">T+1 正溢价率 {point.openPremiumPositiveRate ?? "-"}% / {point.closePremiumPositiveRate ?? "-"}% · T+2 正溢价率 {point.secondDayOpenPremiumPositiveRate ?? "-"}% / {point.secondDayClosePremiumPositiveRate ?? "-"}%</p>
    </div>
  );
}

export function CandidatePremiumChart({ scoreBands }: CandidatePremiumChartProps) {
  const data = scoreBands.map((band) => ({
    label: band.label,
    sampleSize: band.sampleSize,
    premiumSampleSize: band.premium.sampleSize,
    openSampleSize: band.premium.openSampleSize,
    closeSampleSize: band.premium.closeSampleSize,
    averageOpenPremium: band.premium.averageOpenPremium,
    averageClosePremium: band.premium.averageClosePremium,
    openPremiumPositiveRate: band.premium.openPremiumPositiveRate,
    closePremiumPositiveRate: band.premium.closePremiumPositiveRate,
    secondDayPremiumSampleSize: band.tPlus2Premium.sampleSize,
    secondDayOpenSampleSize: band.tPlus2Premium.openSampleSize,
    secondDayCloseSampleSize: band.tPlus2Premium.closeSampleSize,
    secondDayAverageOpenPremium: band.tPlus2Premium.averageOpenPremium,
    secondDayAverageClosePremium: band.tPlus2Premium.averageClosePremium,
    secondDayOpenPremiumPositiveRate: band.tPlus2Premium.openPremiumPositiveRate,
    secondDayClosePremiumPositiveRate: band.tPlus2Premium.closePremiumPositiveRate,
  }));
  const hasPriceData = data.some((item) => item.premiumSampleSize > 0 || item.secondDayPremiumSampleSize > 0);

  return (
    <Card className="border-amber-100 bg-white/90 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-amber-600" />评分区间 T+1/T+2 溢价</CardTitle>
        <CardDescription>仅按独立样本外区间统计。以候选信号日收盘为基准，分别比较 T+1、T+2 已记录交易日的开盘与收盘溢价。</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasPriceData ? <p className="py-16 text-center text-sm text-slate-500">尚无可比价格数据；完成历史行情回填后将展示各评分区间的 T+1/T+2 溢价。</p> : <div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 14, right: 12, bottom: 10, left: -12 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} interval={0} /><YAxis tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} /><ReferenceLine y={0} stroke="#94a3b8" /><Tooltip content={premiumTooltip} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="averageOpenPremium" name="T+1平均开盘" fill="#0ea5e9" radius={[5, 5, 0, 0]} /><Bar dataKey="averageClosePremium" name="T+1平均收盘" fill="#f97316" radius={[5, 5, 0, 0]} /><Bar dataKey="secondDayAverageOpenPremium" name="T+2平均开盘" fill="#8b5cf6" radius={[5, 5, 0, 0]} /><Bar dataKey="secondDayAverageClosePremium" name="T+2平均收盘" fill="#ec4899" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </CardContent>
    </Card>
  );
}
