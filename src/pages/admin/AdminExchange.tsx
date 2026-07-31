import { useEffect, useState, useMemo } from "react";
import {
  RefreshCw, Database, Check, X, Clock, Package, FolderTree,
  AlertTriangle, Copy, RotateCcw, Search, BarChart3, ArrowUpDown,
  Edit, Trash2, ChevronDown, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface ExchangeLog {
  id: string;
  session_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  exchange_type: string;
  products_created: number;
  products_updated: number;
  categories_created: number;
  errors_count: number;
  error_details: any;
  file_count: number;
  total_size_bytes: number;
}

interface StoreSettings {
  exchange_login: string | null;
  exchange_password: string | null;
}

interface StockDiscrepancy {
  id: string;
  title: string;
  sku: string | null;
  guid_1c: string | null;
  site_qty: number;
  site_price: number;
}

export default function AdminExchange() {
  const [logs, setLogs] = useState<ExchangeLog[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [activeTab, setActiveTab] = useState("logs");
  const [statusFilter, setStatusFilter] = useState("all");
  const [errorDetailsLog, setErrorDetailsLog] = useState<ExchangeLog | null>(null);
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isEditingCreds, setIsEditingCreds] = useState(false);
  const [editLogin, setEditLogin] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [isSavingCreds, setIsSavingCreds] = useState(false);

  // Stock reconciliation
  const [stockProducts, setStockProducts] = useState<StockDiscrepancy[]>([]);
  const [stockSearch, setStockSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  const { toast } = useToast();

  const exchangeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exchange-1c`;
  const importJsonUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-1c`;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [logsRes, settingsRes] = await Promise.all([
        supabase
          .from("exchange_logs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(100),
        supabase
          .from("store_settings")
          .select("exchange_login, exchange_password")
          .single()
      ]);
      if (logsRes.data) setLogs(logsRes.data);
      if (settingsRes.data) {
        setSettings(settingsRes.data);
      } else if (settingsRes.error) {
        console.error("Settings error:", settingsRes.error);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStockData = async () => {
    setIsLoadingStock(true);
    try {
      const { data } = await supabase
        .from("products")
        .select("id, title, sku, guid_1c, stock_qty, price")
        .order("title");

      if (data) {
        setStockProducts(data.map(p => ({
          id: p.id,
          title: p.title,
          sku: p.sku,
          guid_1c: p.guid_1c,
          site_qty: p.stock_qty,
          site_price: p.price,
        })));
      }
    } finally {
      setIsLoadingStock(false);
    }
  };

  const copyUrl = (url: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(url);
    setter(true);
    setTimeout(() => setter(false), 2000);
    toast({ title: "URL скопирован" });
  };

  const retryExchange = async (log: ExchangeLog) => {
    toast({ title: "Повтор обмена...", description: `Сессия ${log.session_id.slice(0, 8)}` });
    // Reset status to in_progress
    await supabase.from("exchange_logs").update({ status: "in_progress", errors_count: 0, error_details: null }).eq("id", log.id);
    fetchData();
    toast({ title: "Статус сброшен — запустите обмен из 1С повторно" });
  };

  const startEditCreds = () => {
    setEditLogin(settings?.exchange_login || "");
    setEditPassword(settings?.exchange_password || "");
    setIsEditingCreds(true);
  };

  const saveCreds = async () => {
    setIsSavingCreds(true);
    try {
      const { error } = await supabase
        .from("store_settings")
        .update({ exchange_login: editLogin, exchange_password: editPassword })
        .not("id", "is", null);
      if (error) throw error;
      setSettings({ exchange_login: editLogin, exchange_password: editPassword });
      setIsEditingCreds(false);
      toast({ title: "Учётные данные сохранены" });
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message, variant: "destructive" });
    } finally {
      setIsSavingCreds(false);
    }
  };

  const deleteLog = async () => {
    if (!deleteLogId) return;
    await supabase.from("exchange_logs").delete().eq("id", deleteLogId);
    setDeleteLogId(null);
    toast({ title: "Запись удалена" });
    fetchData();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-600 text-white"><Check className="h-3 w-3 mr-1" />Завершён</Badge>;
      case "in_progress":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />В процессе</Badge>;
      case "error":
        return <Badge variant="destructive"><X className="h-3 w-3 mr-1" />Ошибка</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(l => statusFilter === "all" || l.status === statusFilter);
  }, [logs, statusFilter]);

  const totalStats = logs.reduce(
    (acc, log) => ({
      created: acc.created + log.products_created,
      updated: acc.updated + log.products_updated,
      categories: acc.categories + log.categories_created,
      errors: acc.errors + log.errors_count,
    }),
    { created: 0, updated: 0, categories: 0, errors: 0 }
  );

  const errorLogs = logs.filter(l => l.errors_count > 0 || l.status === "error");

  const filteredStock = useMemo(() => {
    let result = stockProducts;
    if (stockSearch) {
      const q = stockSearch.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q)
        || (p.sku || "").toLowerCase().includes(q)
        || (p.guid_1c || "").toLowerCase().includes(q)
      );
    }
    if (stockFilter === "zero_stock") result = result.filter(p => p.site_qty === 0);
    if (stockFilter === "zero_price") result = result.filter(p => p.site_price === 0);
    if (stockFilter === "no_guid") result = result.filter(p => !p.guid_1c);
    return result;
  }, [stockProducts, stockSearch, stockFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Обмен с 1С</h1>
          <p className="text-muted-foreground mt-1">Интеграция, логи, сверка остатков</p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />Обновить
        </Button>
      </div>

      {/* Connection Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />Настройки подключения
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">CommerceML URL</label>
              <div className="flex gap-2 mt-1">
                <code className="flex-1 p-2 bg-secondary rounded text-sm font-mono truncate">{exchangeUrl}</code>
                <Button variant="outline" size="icon" onClick={() => copyUrl(exchangeUrl, setCopied)}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">JSON API URL</label>
              <div className="flex gap-2 mt-1">
                <code className="flex-1 p-2 bg-secondary rounded text-sm font-mono truncate">{importJsonUrl}</code>
                <Button variant="outline" size="icon" onClick={() => copyUrl(importJsonUrl, setCopiedJson)}>
                  {copiedJson ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          {isEditingCreds ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Логин</label>
                <Input className="mt-1 font-mono" value={editLogin} onChange={e => setEditLogin(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Пароль</label>
                <Input className="mt-1 font-mono" type="text" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveCreds} disabled={isSavingCreds} size="sm">
                  <Check className="h-4 w-4 mr-1" />Сохранить
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditingCreds(false)}>Отмена</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Логин</label>
                <p className="mt-1 font-mono">{settings?.exchange_login || "—"}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Пароль</label>
                <div className="flex items-center gap-2 mt-1">
                  <p className="font-mono">{settings?.exchange_password ? (showPassword ? settings.exchange_password : "••••••••") : "—"}</p>
                  {settings?.exchange_password && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? "Скрыть" : "Показать"}
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Button variant="outline" size="sm" onClick={startEditCreds}>
                  <Edit className="h-4 w-4 mr-1" />Изменить
                </Button>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            CommerceML URL — для стандартного обмена из 1С. JSON API — для кастомных интеграций с токеном x-1c-token.
          </p>
        </CardContent>
      </Card>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg"><Package className="h-5 w-5 text-green-600" /></div>
            <div><p className="text-2xl font-bold">{totalStats.created}</p><p className="text-sm text-muted-foreground">Создано</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg"><RefreshCw className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold">{totalStats.updated}</p><p className="text-sm text-muted-foreground">Обновлено</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg"><FolderTree className="h-5 w-5 text-purple-600" /></div>
            <div><p className="text-2xl font-bold">{totalStats.categories}</p><p className="text-sm text-muted-foreground">Категорий</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
            <div><p className="text-2xl font-bold">{totalStats.errors}</p><p className="text-sm text-muted-foreground">Ошибок</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Tabs: Logs / Errors / Stock Reconciliation */}
      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); if (v === "stock" && stockProducts.length === 0) fetchStockData(); }}>
        <TabsList>
          <TabsTrigger value="logs"><FileText className="h-4 w-4 mr-2" />История обменов</TabsTrigger>
          <TabsTrigger value="errors">
            <AlertTriangle className="h-4 w-4 mr-2" />Ошибки
            {errorLogs.length > 0 && <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1">{errorLogs.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="stock"><BarChart3 className="h-4 w-4 mr-2" />Сверка остатков</TabsTrigger>
        </TabsList>

        {/* History */}
        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>История обменов</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Статус" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="completed">Завершённые</SelectItem>
                  <SelectItem value="in_progress">В процессе</SelectItem>
                  <SelectItem value="error">С ошибками</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center py-12">
                  <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Нет записей</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Сессия</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Создано</TableHead>
                      <TableHead>Обновлено</TableHead>
                      <TableHead>Ошибки</TableHead>
                      <TableHead className="w-[80px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{format(new Date(log.started_at), "dd MMM yyyy", { locale: ru })}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(log.started_at), "HH:mm:ss")}</p>
                          </div>
                        </TableCell>
                        <TableCell><code className="text-xs">{log.session_id.slice(0, 8)}...</code></TableCell>
                        <TableCell><Badge variant="outline">{log.exchange_type}</Badge></TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell><span className="text-green-600 font-medium">{log.products_created}</span></TableCell>
                        <TableCell><span className="text-blue-600 font-medium">{log.products_updated}</span></TableCell>
                        <TableCell>
                          {log.errors_count > 0 ? (
                            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setErrorDetailsLog(log)}>
                              {log.errors_count} ошибок
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {log.status === "error" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => retryExchange(log)} title="Повторить">
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteLogId(log.id)} title="Удалить">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors tab */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Ошибки обмена ({errorLogs.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {errorLogs.length === 0 ? (
                <div className="text-center py-12">
                  <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p className="text-muted-foreground">Ошибок нет — всё работает отлично!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {errorLogs.map(log => (
                    <Collapsible key={log.id}>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          {getStatusBadge(log.status)}
                          <span className="font-medium text-sm">
                            {format(new Date(log.started_at), "dd.MM.yyyy HH:mm")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Сессия: {log.session_id.slice(0, 8)}
                          </span>
                          <Badge variant="outline">{log.errors_count} ошибок</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => retryExchange(log)}>
                            <RotateCcw className="h-3 w-3 mr-1" />Retry
                          </Button>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm"><ChevronDown className="h-4 w-4" /></Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                          {log.error_details
                            ? JSON.stringify(log.error_details, null, 2)
                            : "Детали ошибки недоступны"}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stock reconciliation */}
        <TabsContent value="stock">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Сверка остатков ({filteredStock.length} товаров)
              </CardTitle>
              <div className="flex gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Поиск..." value={stockSearch} onChange={e => setStockSearch(e.target.value)} className="pl-10 w-[220px]" />
                </div>
                <Select value={stockFilter} onValueChange={setStockFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все товары</SelectItem>
                    <SelectItem value="zero_stock">Нулевые остатки</SelectItem>
                    <SelectItem value="zero_price">Нулевая цена</SelectItem>
                    <SelectItem value="no_guid">Без GUID 1С</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={fetchStockData} disabled={isLoadingStock}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingStock ? "animate-spin" : ""}`} />Обновить
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingStock ? (
                <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
              ) : filteredStock.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Нет данных</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-lg font-bold">{stockProducts.length}</p>
                      <p className="text-xs text-muted-foreground">Всего товаров</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-lg font-bold text-red-600">{stockProducts.filter(p => p.site_qty === 0).length}</p>
                      <p className="text-xs text-muted-foreground">Нулевой остаток</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-lg font-bold text-orange-600">{stockProducts.filter(p => p.site_price === 0).length}</p>
                      <p className="text-xs text-muted-foreground">Нулевая цена</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-lg font-bold text-purple-600">{stockProducts.filter(p => !p.guid_1c).length}</p>
                      <p className="text-xs text-muted-foreground">Без GUID 1С</p>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Наименование</TableHead>
                        <TableHead>Артикул</TableHead>
                        <TableHead>GUID 1С</TableHead>
                        <TableHead className="text-right">Остаток</TableHead>
                        <TableHead className="text-right">Цена</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStock.slice(0, 200).map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium max-w-[300px] truncate">{p.title}</TableCell>
                          <TableCell className="text-muted-foreground">{p.sku || "—"}</TableCell>
                          <TableCell>
                            {p.guid_1c ? (
                              <code className="text-xs">{p.guid_1c.slice(0, 12)}...</code>
                            ) : (
                              <Badge variant="outline" className="text-orange-600">Нет</Badge>
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${p.site_qty === 0 ? "text-red-600" : ""}`}>
                            {p.site_qty}
                          </TableCell>
                          <TableCell className={`text-right ${p.site_price === 0 ? "text-red-600" : ""}`}>
                            {Number(p.site_price).toLocaleString("ru-RU")} ₽
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredStock.length > 200 && (
                    <p className="text-sm text-muted-foreground text-center mt-4">
                      Показано 200 из {filteredStock.length}. Используйте фильтры для сужения результатов.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Error details dialog */}
      <Dialog open={!!errorDetailsLog} onOpenChange={o => !o && setErrorDetailsLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Детали ошибок</DialogTitle>
          </DialogHeader>
          {errorDetailsLog && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span>Сессия: <code>{errorDetailsLog.session_id.slice(0, 12)}</code></span>
                <span>Дата: {format(new Date(errorDetailsLog.started_at), "dd.MM.yyyy HH:mm")}</span>
                <span>Ошибок: {errorDetailsLog.errors_count}</span>
              </div>
              <pre className="p-4 bg-muted rounded-md text-sm overflow-x-auto whitespace-pre-wrap">
                {errorDetailsLog.error_details
                  ? JSON.stringify(errorDetailsLog.error_details, null, 2)
                  : "Детали недоступны"}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { retryExchange(errorDetailsLog!); setErrorDetailsLog(null); }}>
              <RotateCcw className="h-4 w-4 mr-2" />Повторить обмен
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteLogId} onOpenChange={o => !o && setDeleteLogId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>Это удалит запись из истории обменов.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={deleteLog} className="bg-destructive text-destructive-foreground">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
