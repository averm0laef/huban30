import { useEffect, useState, useMemo } from "react";
import {
  Plus, Search, FileText, Package, Download, Upload, RefreshCw,
  MoreHorizontal, Trash2, Edit, Eye, Check, X, Clock, Send,
  ArrowUpDown, Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Invoice {
  id: string;
  type: string;
  number: string;
  date: string;
  counterparty: string | null;
  status: string;
  total_amount: number;
  notes: string | null;
  exported_at: string | null;
  created_at: string;
}

interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  price: number;
  total: number;
  guid_1c: string | null;
}

interface Product {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  guid_1c: string | null;
}

export default function AdminInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("incoming");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [viewItems, setViewItems] = useState<InvoiceItem[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Create form
  const [form, setForm] = useState({
    type: "incoming",
    number: "",
    date: format(new Date(), "yyyy-MM-dd"),
    counterparty: "",
    notes: "",
  });
  const [formItems, setFormItems] = useState<Omit<InvoiceItem, "id" | "invoice_id">[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setInvoices(data);
    setIsLoading(false);
  };

  const searchProducts = async (q: string) => {
    if (q.length < 2) return;
    const { data } = await supabase
      .from("products")
      .select("id, title, sku, price, guid_1c")
      .or(`title.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(20);
    if (data) setProducts(data);
  };

  const addItemFromProduct = (p: Product) => {
    setFormItems(prev => [...prev, {
      product_id: p.id,
      title: p.title,
      sku: p.sku,
      quantity: 1,
      price: p.price,
      total: p.price,
      guid_1c: p.guid_1c,
    }]);
    setProductSearch("");
    setProducts([]);
  };

  const addEmptyItem = () => {
    setFormItems(prev => [...prev, {
      product_id: null,
      title: "",
      sku: null,
      quantity: 1,
      price: 0,
      total: 0,
      guid_1c: null,
    }]);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setFormItems(prev => {
      const updated = [...prev];
      (updated[idx] as any)[field] = value;
      if (field === "quantity" || field === "price") {
        updated[idx].total = updated[idx].quantity * updated[idx].price;
      }
      return updated;
    });
  };

  const removeItem = (idx: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== idx));
  };

  const totalAmount = formItems.reduce((s, i) => s + i.total, 0);

  const resetForm = () => {
    setForm({
      type: activeTab,
      number: "",
      date: format(new Date(), "yyyy-MM-dd"),
      counterparty: "",
      notes: "",
    });
    setFormItems([]);
    setIsEditing(false);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setForm(f => ({ ...f, type: activeTab }));
    setIsCreateOpen(true);
  };

  const openEdit = async (inv: Invoice) => {
    setForm({
      type: inv.type,
      number: inv.number,
      date: inv.date,
      counterparty: inv.counterparty || "",
      notes: inv.notes || "",
    });
    const { data } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("created_at");
    setFormItems((data || []).map(i => ({
      product_id: i.product_id,
      title: i.title,
      sku: i.sku,
      quantity: i.quantity,
      price: i.price,
      total: i.total,
      guid_1c: i.guid_1c,
    })));
    setIsEditing(true);
    setEditingId(inv.id);
    setIsCreateOpen(true);
  };

  const openView = async (inv: Invoice) => {
    setViewInvoice(inv);
    const { data } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("created_at");
    setViewItems(data || []);
    setIsViewOpen(true);
  };

  const saveInvoice = async () => {
    if (!form.number.trim()) {
      toast({ title: "Укажите номер накладной", variant: "destructive" });
      return;
    }
    if (formItems.length === 0) {
      toast({ title: "Добавьте хотя бы одну позицию", variant: "destructive" });
      return;
    }

    try {
      if (isEditing && editingId) {
        await supabase.from("invoices").update({
          number: form.number,
          date: form.date,
          counterparty: form.counterparty || null,
          notes: form.notes || null,
          total_amount: totalAmount,
        }).eq("id", editingId);

        await supabase.from("invoice_items").delete().eq("invoice_id", editingId);
        await supabase.from("invoice_items").insert(
          formItems.map(i => ({ ...i, invoice_id: editingId }))
        );

        toast({ title: "Накладная обновлена" });
      } else {
        const { data: inv, error } = await supabase.from("invoices").insert({
          type: form.type,
          number: form.number,
          date: form.date,
          counterparty: form.counterparty || null,
          notes: form.notes || null,
          total_amount: totalAmount,
        }).select("id").single();

        if (error) throw error;

        await supabase.from("invoice_items").insert(
          formItems.map(i => ({ ...i, invoice_id: inv.id }))
        );

        toast({ title: "Накладная создана" });
      }

      setIsCreateOpen(false);
      resetForm();
      fetchInvoices();
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  };

  const confirmInvoice = async (id: string) => {
    await supabase.from("invoices").update({ status: "confirmed" }).eq("id", id);
    toast({ title: "Накладная подтверждена" });
    fetchInvoices();
  };

  const exportInvoice = async (inv: Invoice) => {
    try {
      const { data: items } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", inv.id);

      const response = await supabase.functions.invoke("export-invoices-1c", {
        body: {
          invoices: [{
            ...inv,
            items: items || [],
          }],
        },
      });

      if (response.error) throw response.error;

      await supabase.from("invoices").update({
        status: "exported",
        exported_at: new Date().toISOString(),
      }).eq("id", inv.id);

      toast({ title: "Накладная экспортирована в 1С" });
      fetchInvoices();
    } catch (err: any) {
      toast({ title: "Ошибка экспорта", description: err.message, variant: "destructive" });
    }
  };

  const deleteInvoice = async () => {
    if (!deleteId) return;
    await supabase.from("invoices").delete().eq("id", deleteId);
    setDeleteId(null);
    toast({ title: "Накладная удалена" });
    fetchInvoices();
  };

  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (inv.type !== activeTab) return false;
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return inv.number.toLowerCase().includes(q)
          || (inv.counterparty || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [invoices, activeTab, statusFilter, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Черновик</Badge>;
      case "confirmed": return <Badge className="bg-green-600 text-white"><Check className="h-3 w-3 mr-1" />Подтверждена</Badge>;
      case "exported": return <Badge className="bg-blue-600 text-white"><Send className="h-3 w-3 mr-1" />Экспортирована</Badge>;
      case "cancelled": return <Badge variant="destructive"><X className="h-3 w-3 mr-1" />Отменена</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const stats = useMemo(() => {
    const ofType = invoices.filter(i => i.type === activeTab);
    return {
      total: ofType.length,
      drafts: ofType.filter(i => i.status === "draft").length,
      confirmed: ofType.filter(i => i.status === "confirmed").length,
      exported: ofType.filter(i => i.status === "exported").length,
      totalAmount: ofType.reduce((s, i) => s + Number(i.total_amount), 0),
    };
  }, [invoices, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Накладные</h1>
          <p className="text-muted-foreground mt-1">Приходные и расходные накладные с экспортом в 1С</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchInvoices}>
            <RefreshCw className="h-4 w-4 mr-2" />Обновить
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />Создать
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="incoming">
            <Download className="h-4 w-4 mr-2" />Приходные
          </TabsTrigger>
          <TabsTrigger value="outgoing">
            <Upload className="h-4 w-4 mr-2" />Расходные
          </TabsTrigger>
        </TabsList>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Card><CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Всего</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats.drafts}</p>
            <p className="text-sm text-muted-foreground">Черновиков</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats.exported}</p>
            <p className="text-sm text-muted-foreground">Экспортировано</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats.totalAmount.toLocaleString("ru-RU")} ₽</p>
            <p className="text-sm text-muted-foreground">Сумма</p>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mt-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Поиск по номеру или контрагенту..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><Filter className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="draft">Черновики</SelectItem>
              <SelectItem value="confirmed">Подтверждённые</SelectItem>
              <SelectItem value="exported">Экспортированные</SelectItem>
              <SelectItem value="cancelled">Отменённые</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Накладных пока нет</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Номер</TableHead>
                      <TableHead>Дата</TableHead>
                      <TableHead>Контрагент</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead className="w-[50px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(inv => (
                      <TableRow key={inv.id} className="cursor-pointer" onClick={() => openView(inv)}>
                        <TableCell className="font-mono font-medium">{inv.number}</TableCell>
                        <TableCell>{format(new Date(inv.date), "dd.MM.yyyy")}</TableCell>
                        <TableCell>{inv.counterparty || "—"}</TableCell>
                        <TableCell>{getStatusBadge(inv.status)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {Number(inv.total_amount).toLocaleString("ru-RU")} ₽
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openView(inv)}>
                                <Eye className="h-4 w-4 mr-2" />Просмотр
                              </DropdownMenuItem>
                              {inv.status === "draft" && (
                                <>
                                  <DropdownMenuItem onClick={() => openEdit(inv)}>
                                    <Edit className="h-4 w-4 mr-2" />Редактировать
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => confirmInvoice(inv.id)}>
                                    <Check className="h-4 w-4 mr-2" />Подтвердить
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(inv.status === "confirmed" || inv.status === "draft") && (
                                <DropdownMenuItem onClick={() => exportInvoice(inv)}>
                                  <Send className="h-4 w-4 mr-2" />Экспорт в 1С
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(inv.id)}>
                                <Trash2 className="h-4 w-4 mr-2" />Удалить
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={o => { if (!o) { setIsCreateOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Редактировать" : "Создать"} {form.type === "incoming" ? "приходную" : "расходную"} накладную
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label>Номер *</Label>
                <Input value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} placeholder="ПР-001" />
              </div>
              <div>
                <Label>Дата</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label>{form.type === "incoming" ? "Поставщик" : "Покупатель"}</Label>
                <Input value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Примечание</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>

            {/* Items */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-base font-semibold">Позиции</Label>
                <div className="flex gap-2">
                  <div className="relative">
                    <Input
                      placeholder="Найти товар..."
                      value={productSearch}
                      onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value); }}
                      className="w-[200px]"
                    />
                    {products.length > 0 && productSearch && (
                      <div className="absolute z-50 top-full mt-1 w-[320px] bg-popover border rounded-md shadow-lg max-h-[200px] overflow-y-auto">
                        {products.map(p => (
                          <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                            onClick={() => addItemFromProduct(p)}>
                            <span className="font-medium">{p.title}</span>
                            {p.sku && <span className="text-muted-foreground ml-2">({p.sku})</span>}
                            <span className="float-right">{p.price} ₽</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={addEmptyItem}>
                    <Plus className="h-4 w-4 mr-1" />Пустая строка
                  </Button>
                </div>
              </div>

              {formItems.length === 0 ? (
                <div className="text-center py-6 border rounded-md text-muted-foreground text-sm">
                  Добавьте позиции через поиск товаров или пустую строку
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Наименование</TableHead>
                        <TableHead className="w-[80px]">Кол-во</TableHead>
                        <TableHead className="w-[100px]">Цена</TableHead>
                        <TableHead className="w-[100px]">Сумма</TableHead>
                        <TableHead className="w-[40px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {formItems.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Input value={item.title} onChange={e => updateItem(idx, "title", e.target.value)}
                              className="h-8" placeholder="Наименование" />
                          </TableCell>
                          <TableCell>
                            <Input type="number" value={item.quantity}
                              onChange={e => updateItem(idx, "quantity", Number(e.target.value))}
                              className="h-8" min={0} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" value={item.price}
                              onChange={e => updateItem(idx, "price", Number(e.target.value))}
                              className="h-8" min={0} />
                          </TableCell>
                          <TableCell className="font-medium">{item.total.toLocaleString("ru-RU")} ₽</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(idx)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex justify-end px-4 py-3 bg-muted/50 border-t">
                    <span className="font-semibold text-lg">Итого: {totalAmount.toLocaleString("ru-RU")} ₽</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>Отмена</Button>
            <Button onClick={saveInvoice}>{isEditing ? "Сохранить" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <FileText className="h-5 w-5" />
              {viewInvoice?.type === "incoming" ? "Приходная" : "Расходная"} накладная №{viewInvoice?.number}
            </DialogTitle>
          </DialogHeader>
          {viewInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Дата:</span><br />{format(new Date(viewInvoice.date), "dd.MM.yyyy")}</div>
                <div><span className="text-muted-foreground">Контрагент:</span><br />{viewInvoice.counterparty || "—"}</div>
                <div><span className="text-muted-foreground">Статус:</span><br />{getStatusBadge(viewInvoice.status)}</div>
                <div><span className="text-muted-foreground">Сумма:</span><br /><span className="font-bold text-lg">{Number(viewInvoice.total_amount).toLocaleString("ru-RU")} ₽</span></div>
              </div>
              {viewInvoice.notes && (
                <div className="text-sm bg-muted/50 p-3 rounded-md">{viewInvoice.notes}</div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Наименование</TableHead>
                    <TableHead>Артикул</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead className="text-right">Цена</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell className="text-muted-foreground">{item.sku || "—"}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{Number(item.price).toLocaleString("ru-RU")} ₽</TableCell>
                      <TableCell className="text-right font-medium">{Number(item.total).toLocaleString("ru-RU")} ₽</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {viewInvoice.exported_at && (
                <p className="text-sm text-muted-foreground">
                  Экспортировано: {format(new Date(viewInvoice.exported_at), "dd.MM.yyyy HH:mm")}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {viewInvoice?.status === "draft" && (
              <Button variant="outline" onClick={() => { setIsViewOpen(false); openEdit(viewInvoice); }}>
                <Edit className="h-4 w-4 mr-2" />Редактировать
              </Button>
            )}
            {viewInvoice && (viewInvoice.status === "confirmed" || viewInvoice.status === "draft") && (
              <Button onClick={() => { setIsViewOpen(false); exportInvoice(viewInvoice); }}>
                <Send className="h-4 w-4 mr-2" />Экспорт в 1С
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить накладную?</AlertDialogTitle>
            <AlertDialogDescription>Это действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={deleteInvoice} className="bg-destructive text-destructive-foreground">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
