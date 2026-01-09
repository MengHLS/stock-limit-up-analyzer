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
  FileImage,
  Trash2,
  Images
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

interface FileItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'recognizing' | 'completed' | 'error';
  progress: number;
  recognizedCount?: number;
  error?: string;
}

export default function UploadPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [limitUpDate, setLimitUpDate] = useState(() => {
    const today = new Date();
    // 默认使用当前年份
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [totalRecognized, setTotalRecognized] = useState(0);
  const [recognizedStocks, setRecognizedStocks] = useState<RecognizedStock[]>([]);

  const uploadMutation = trpc.image.upload.useMutation();
  const recognizeMutation = trpc.image.recognize.useMutation();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const newFiles: FileItem[] = [];
    
    for (const file of selectedFiles) {
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} 不是图片文件`);
        continue;
      }

      // 验证文件大小 (最大 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} 超过 10MB 限制`);
        continue;
      }

      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const previewUrl = URL.createObjectURL(file);
      
      newFiles.push({
        id,
        file,
        previewUrl,
        status: 'pending',
        progress: 0,
      });
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      setRecognizedStocks([]);
      setTotalRecognized(0);
    }

    // 清空input以便重复选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file) {
        URL.revokeObjectURL(file.previewUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const clearAllFiles = useCallback(() => {
    files.forEach(f => URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
    setRecognizedStocks([]);
    setTotalRecognized(0);
  }, [files]);

  const processFile = async (fileItem: FileItem): Promise<RecognizedStock[]> => {
    // 更新状态为上传中
    setFiles(prev => prev.map(f => 
      f.id === fileItem.id ? { ...f, status: 'uploading', progress: 20 } : f
    ));

    try {
      // 读取文件为 base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileItem.file);
      });

      setFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { ...f, progress: 40 } : f
      ));

      // 上传图片
      const uploadResult = await uploadMutation.mutateAsync({
        base64Data,
        fileName: fileItem.file.name,
        mimeType: fileItem.file.type,
      });

      if (!uploadResult) {
        throw new Error('上传失败');
      }

      setFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { ...f, status: 'recognizing', progress: 60 } : f
      ));

      // 识别图片
      const recognizeResult = await recognizeMutation.mutateAsync({
        imageUrl: uploadResult.fileUrl,
        imageId: uploadResult.id,
        limitUpDate,
      });

      setFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { 
          ...f, 
          status: 'completed', 
          progress: 100,
          recognizedCount: recognizeResult.count 
        } : f
      ));

      return recognizeResult.stocks;
    } catch (error) {
      setFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { 
          ...f, 
          status: 'error', 
          progress: 0,
          error: error instanceof Error ? error.message : '处理失败'
        } : f
      ));
      return [];
    }
  };

  const handleBatchUpload = useCallback(async () => {
    const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error');
    if (pendingFiles.length === 0) {
      toast.error('没有待处理的图片');
      return;
    }

    if (!limitUpDate) {
      toast.error('请选择涨停日期');
      return;
    }

    setIsProcessing(true);
    setRecognizedStocks([]);
    setTotalRecognized(0);

    let allStocks: RecognizedStock[] = [];
    let successCount = 0;

    for (const fileItem of pendingFiles) {
      const stocks = await processFile(fileItem);
      if (stocks.length > 0) {
        allStocks = [...allStocks, ...stocks];
        successCount++;
      }
    }

    setRecognizedStocks(allStocks);
    setTotalRecognized(allStocks.length);
    setIsProcessing(false);

    if (successCount > 0) {
      toast.success(`处理完成，共识别 ${allStocks.length} 只股票`);
    } else {
      toast.error('所有图片处理失败');
    }
  }, [files, limitUpDate, processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      const input = fileInputRef.current;
      if (input) {
        const dt = new DataTransfer();
        droppedFiles.forEach(file => dt.items.add(file));
        input.files = dt.files;
        handleFileSelect({ target: input } as React.ChangeEvent<HTMLInputElement>);
      }
    }
  }, [handleFileSelect]);

  const pendingCount = files.filter(f => f.status === 'pending' || f.status === 'error').length;
  const completedCount = files.filter(f => f.status === 'completed').length;

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
          <h1 className="text-2xl font-semibold tracking-tight">批量上传涨停复盘图片</h1>
          <p className="text-muted-foreground mt-1">
            支持一次选择多张图片，系统将依次识别其中的股票信息
          </p>
        </div>

        <div className="grid gap-6">
          {/* 上传区域 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Images className="h-5 w-5" />
                选择图片
                {files.length > 0 && (
                  <Badge variant="secondary">{files.length} 张</Badge>
                )}
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
                  files.length > 0 ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 rounded-full bg-muted">
                      <UploadIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">点击或拖拽上传图片</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        支持多选，JPG、PNG 格式，单张最大 10MB
                      </p>
                    </div>
                  </div>
                </label>
              </div>

              {/* 已选择的文件列表 */}
              {files.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">已选择的图片</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={clearAllFiles}
                      disabled={isProcessing}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      清空
                    </Button>
                  </div>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {files.map((fileItem) => (
                        <div 
                          key={fileItem.id}
                          className="flex items-center gap-3 p-2 rounded-lg border bg-card"
                        >
                          <img 
                            src={fileItem.previewUrl} 
                            alt={fileItem.file.name}
                            className="w-12 h-12 object-cover rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{fileItem.file.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {fileItem.status === 'pending' && (
                                <Badge variant="outline" className="text-xs">待处理</Badge>
                              )}
                              {fileItem.status === 'uploading' && (
                                <Badge variant="secondary" className="text-xs">
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  上传中
                                </Badge>
                              )}
                              {fileItem.status === 'recognizing' && (
                                <Badge variant="secondary" className="text-xs">
                                  <Sparkles className="h-3 w-3 mr-1 animate-pulse" />
                                  识别中
                                </Badge>
                              )}
                              {fileItem.status === 'completed' && (
                                <Badge variant="default" className="text-xs bg-green-500">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  已识别 {fileItem.recognizedCount} 只
                                </Badge>
                              )}
                              {fileItem.status === 'error' && (
                                <Badge variant="destructive" className="text-xs">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  {fileItem.error || '失败'}
                                </Badge>
                              )}
                            </div>
                            {(fileItem.status === 'uploading' || fileItem.status === 'recognizing') && (
                              <Progress value={fileItem.progress} className="h-1 mt-2" />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFile(fileItem.id)}
                            disabled={isProcessing && (fileItem.status === 'uploading' || fileItem.status === 'recognizing')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* 上传按钮 */}
              <Button
                onClick={handleBatchUpload}
                disabled={pendingCount === 0 || !limitUpDate || isProcessing}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    批量上传并识别 {pendingCount > 0 && `(${pendingCount} 张)`}
                  </>
                )}
              </Button>

              {completedCount > 0 && (
                <p className="text-sm text-center text-muted-foreground">
                  已完成 {completedCount}/{files.length} 张，共识别 {totalRecognized} 只股票
                </p>
              )}
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
