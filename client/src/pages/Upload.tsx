import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { 
  Upload as UploadIcon, 
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Calendar,
  Sparkles,
  FileImage
} from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

interface RecognizedStock {
  stockCode: string;
  stockName: string;
  limitUpTime: string;
  boardCount: string;
  circulationValue: string;
  turnover: string;
  sector: string;
  keywords: string;
}

export default function UploadPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [limitUpDate, setLimitUpDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognizedStocks, setRecognizedStocks] = useState<RecognizedStock[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadMutation = trpc.image.upload.useMutation();
  const recognizeMutation = trpc.image.recognize.useMutation();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    // 验证文件大小 (最大 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片大小不能超过 10MB');
      return;
    }

    setSelectedFile(file);
    setRecognizedStocks([]);

    // 创建预览
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleUploadAndRecognize = useCallback(async () => {
    if (!selectedFile || !limitUpDate) {
      toast.error('请选择图片和涨停日期');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // 读取文件为 base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // 移除 data:image/xxx;base64, 前缀
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(selectedFile);

      setUploadProgress(20);
      const base64Data = await base64Promise;

      // 上传图片
      setUploadProgress(40);
      const uploadResult = await uploadMutation.mutateAsync({
        base64Data,
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
      });

      if (!uploadResult) {
        throw new Error('上传失败');
      }

      setUploadProgress(60);
      setIsUploading(false);
      setIsRecognizing(true);

      // 识别图片
      toast.info('正在识别图片中的股票数据...');
      const recognizeResult = await recognizeMutation.mutateAsync({
        imageUrl: uploadResult.fileUrl,
        imageId: uploadResult.id,
        limitUpDate,
      });

      setUploadProgress(100);
      setRecognizedStocks(recognizeResult.stocks);
      
      toast.success(`识别完成，共识别到 ${recognizeResult.count} 只股票`);
    } catch (error) {
      console.error('Upload/recognize error:', error);
      toast.error(error instanceof Error ? error.message : '处理失败，请重试');
    } finally {
      setIsUploading(false);
      setIsRecognizing(false);
    }
  }, [selectedFile, limitUpDate, uploadMutation, recognizeMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const input = fileInputRef.current;
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        handleFileSelect({ target: input } as React.ChangeEvent<HTMLInputElement>);
      }
    }
  }, [handleFileSelect]);

  // 未登录状态
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>请先登录</CardTitle>
            <CardDescription>登录后即可上传涨停复盘图片</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button asChild>
              <a href={getLoginUrl()}>登录</a>
            </Button>
            <Link href="/">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                返回首页
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
          </Link>
        </div>
      </header>

      <main className="container py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">上传涨停复盘图片</h1>
          <p className="text-muted-foreground mt-1">
            上传涨停复盘图片，系统将自动识别其中的股票信息
          </p>
        </div>

        <div className="grid gap-6">
          {/* 上传区域 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileImage className="h-5 w-5" />
                选择图片
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 日期选择 */}
              <div className="space-y-2">
                <Label htmlFor="limitUpDate" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  涨停日期
                </Label>
                <Input
                  id="limitUpDate"
                  type="date"
                  value={limitUpDate}
                  onChange={(e) => setLimitUpDate(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              {/* 文件上传区域 */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  previewUrl ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                
                {previewUrl ? (
                  <div className="space-y-4">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="max-h-96 mx-auto rounded-lg shadow-md"
                    />
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <ImageIcon className="h-4 w-4" />
                      {selectedFile?.name}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      重新选择
                    </Button>
                  </div>
                ) : (
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-full bg-muted">
                        <UploadIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">点击或拖拽上传图片</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          支持 JPG、PNG 格式，最大 10MB
                        </p>
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {/* 上传进度 */}
              {(isUploading || isRecognizing) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {isUploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          正在上传...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 animate-pulse" />
                          正在识别股票数据...
                        </>
                      )}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                </div>
              )}

              {/* 上传按钮 */}
              <Button
                onClick={handleUploadAndRecognize}
                disabled={!selectedFile || !limitUpDate || isUploading || isRecognizing}
                className="w-full"
                size="lg"
              >
                {isUploading || isRecognizing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    上传并识别
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* 识别结果 */}
          {recognizedStocks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  识别结果
                  <Badge variant="secondary">{recognizedStocks.length} 只股票</Badge>
                </CardTitle>
                <CardDescription>
                  以下股票数据已自动保存到数据库
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">股票</th>
                          <th className="px-4 py-3 text-left font-medium">涨停时间</th>
                          <th className="px-4 py-3 text-left font-medium">板数</th>
                          <th className="px-4 py-3 text-left font-medium">题材</th>
                          <th className="px-4 py-3 text-left font-medium">关键词</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recognizedStocks.map((stock, index) => (
                          <tr key={index} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3">
                              <div>
                                <span className="font-medium">{stock.stockName}</span>
                                <span className="text-muted-foreground ml-2 text-xs">
                                  {stock.stockCode}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {stock.limitUpTime || '-'}
                            </td>
                            <td className="px-4 py-3">
                              {stock.boardCount ? (
                                <Badge variant="outline" className="text-xs">
                                  {stock.boardCount}
                                </Badge>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3">
                              {stock.sector ? (
                                <Badge variant="secondary" className="text-xs">
                                  {stock.sector}
                                </Badge>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3 max-w-xs">
                              <p className="text-xs text-muted-foreground truncate" title={stock.keywords}>
                                {stock.keywords || '-'}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ScrollArea>

                <div className="mt-4 flex justify-end">
                  <Link href="/">
                    <Button>
                      查看全部数据
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
