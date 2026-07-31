import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  CalendarCheck, FileBarChart, Loader2, Camera, Send, Plus, Trash2, Building2,
  ImageIcon, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Eye, Download
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Entity { id: string; name: string; }
interface Category { id: string; entity_id: string; name: string; sort_order: number; sign: string; }
interface ReportEntry { id?: string; category_id: string; amount: number; note: string; }
interface ReportPhoto { id: string; url: string; caption: string | null; report_id?: string; }
interface DailyReport {
  id: string;
  user_id: string;
  report_date: string;
  status: string;
  notes: string | null;
  submitted_at: string | null;
}

export default function AdminReports() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState("draft");
  const [entries, setEntries] = useState<Record<string, { amount: number; note: string }>>({});
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Director view
  const [allReports, setAllReports] = useState<DailyReport[]>([]);
  const [allEntries, setAllEntries] = useState<any[]>([]);
  const [allPhotos, setAllPhotos] = useState<ReportPhoto[]>([]);
  const [viewingReport, setViewingReport] = useState<DailyReport | null>(null);
  const [viewPhotos, setViewPhotos] = useState<ReportPhoto[]>([]);

  // Add category dialog
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCatEntityId, setNewCatEntityId] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatSign, setNewCatSign] = useState("income");

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [entRes, catRes] = await Promise.all([
      supabase.from("business_entities").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("report_categories").select("*").eq("is_active", true).order("sort_order"),
    ]);
    setEntities((entRes.data || []) as Entity[]);
    setCategories((catRes.data || []) as Category[]);

    if (isAdmin) {
      // Director/Admin: load ALL reports for this date
      const { data: reports } = await supabase
        .from("daily_reports")
        .select("*")
        .eq("report_date", dateStr)
        .order("submitted_at", { ascending: false });

      setAllReports((reports || []) as DailyReport[]);

      if (reports && reports.length > 0) {
        const reportIds = reports.map(r => r.id);
        const [entriesRes, photosRes] = await Promise.all([
          supabase.from("report_entries").select("*").in("report_id", reportIds),
          supabase.from("report_photos").select("*").in("report_id", reportIds),
        ]);
        setAllEntries(entriesRes.data || []);
        setAllPhotos((photosRes.data || []) as ReportPhoto[]);
      } else {
        setAllEntries([]);
        setAllPhotos([]);
      }
    }

    // Own report
    const { data: report } = await supabase
      .from("daily_reports")
      .select("*")
      .eq("user_id", user?.id)
      .eq("report_date", dateStr)
      .maybeSingle();

    if (report) {
      setReportId(report.id);
      setReportStatus(report.status);
      setNotes(report.notes || "");

      const [entriesRes, photosRes] = await Promise.all([
        supabase.from("report_entries").select("*").eq("report_id", report.id),
        supabase.from("report_photos").select("*").eq("report_id", report.id),
      ]);

      const entryMap: Record<string, { amount: number; note: string }> = {};
      (entriesRes.data || []).forEach((e: any) => {
        entryMap[e.category_id] = { amount: e.amount, note: e.note || "" };
      });
      setEntries(entryMap);
      setPhotos((photosRes.data || []) as ReportPhoto[]);
    } else {
      setReportId(null);
      setReportStatus("draft");
      setEntries({});
      setNotes("");
      setPhotos([]);
    }
    setIsLoading(false);
  }, [user?.id, dateStr, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const navigateDate = (dir: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + dir);
    setSelectedDate(d);
  };

  const saveReport = async (submit = false) => {
    setIsSaving(true);
    try {
      let rId = reportId;
      if (!rId) {
        const { data, error } = await supabase.from("daily_reports").insert({
          user_id: user?.id, report_date: dateStr, status: submit ? "submitted" : "draft",
          notes, submitted_at: submit ? new Date().toISOString() : null,
        }).select("id").single();
        if (error) throw error;
        rId = data.id;
        setReportId(rId);
      } else {
        await supabase.from("daily_reports").update({
          status: submit ? "submitted" : "draft", notes,
          submitted_at: submit ? new Date().toISOString() : null,
        }).eq("id", rId);
        await supabase.from("report_entries").delete().eq("report_id", rId);
      }

      const entryRows = Object.entries(entries)
        .filter(([_, v]) => v.amount !== 0)
        .map(([category_id, v]) => ({
          report_id: rId!, category_id, amount: v.amount, note: v.note || null,
        }));

      if (entryRows.length > 0) {
        await supabase.from("report_entries").insert(entryRows);
      }

      await supabase.from("action_logs").insert({
        user_id: user?.id, action: submit ? "submit_report" : "save_report",
        entity_type: "daily_report", entity_id: rId,
        details: { date: dateStr, entries_count: entryRows.length },
      });

      setReportStatus(submit ? "submitted" : "draft");
      toast({ title: submit ? "Отчёт отправлен!" : "Черновик сохранён" });
      fetchData();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      let rId = reportId;
      if (!rId) {
        const { data } = await supabase.from("daily_reports").insert({
          user_id: user?.id, report_date: dateStr, status: "draft", notes,
        }).select("id").single();
        rId = data!.id;
        setReportId(rId);
      }
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop();
        const path = `${user?.id}/${dateStr}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("report-photos").upload(path, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("report-photos").getPublicUrl(path);
        await supabase.from("report_photos").insert({ report_id: rId!, url: urlData.publicUrl });
      }
      await fetchData();
      toast({ title: "Фото загружено" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Ошибка загрузки", description: error.message });
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photo: ReportPhoto) => {
    await supabase.from("report_photos").delete().eq("id", photo.id);
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
  };

  const addCategory = async () => {
    if (!newCatName.trim() || !newCatEntityId) return;
    const { error } = await supabase.from("report_categories").insert({
      entity_id: newCatEntityId, name: newCatName.trim(), sign: newCatSign,
      sort_order: categories.filter(c => c.entity_id === newCatEntityId).length + 1,
    });
    if (error) { toast({ variant: "destructive", title: "Ошибка", description: error.message }); return; }
    toast({ title: "Категория добавлена" });
    setAddCatOpen(false);
    setNewCatName("");
    fetchData();
  };

  // Calculations
  const getEntityTotals = (entityId: string, entryData: Record<string, { amount: number; note: string }>) => {
    const entityCats = categories.filter(c => c.entity_id === entityId);
    let income = 0, expense = 0;
    entityCats.forEach(cat => {
      const val = entryData[cat.id]?.amount || 0;
      if (cat.sign === "expense") expense += val;
      else income += val;
    });
    return { income, expense, net: income - expense };
  };

  const getGrandTotals = (entryData: Record<string, { amount: number; note: string }>) => {
    let income = 0, expense = 0;
    categories.forEach(cat => {
      const val = entryData[cat.id]?.amount || 0;
      if (cat.sign === "expense") expense += val;
      else income += val;
    });
    return { income, expense, net: income - expense };
  };

  // Director summary
  const directorEntryMap: Record<string, { amount: number; note: string }> = {};
  allEntries.forEach((e: any) => {
    if (!directorEntryMap[e.category_id]) directorEntryMap[e.category_id] = { amount: 0, note: "" };
    directorEntryMap[e.category_id].amount += Number(e.amount);
  });
  const grandTotals = getGrandTotals(directorEntryMap);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-extrabold flex items-center gap-2">
            <FileBarChart className="h-6 w-6 text-primary" />
            Отчёты
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAdmin ? "Сводка по всем отчётам менеджеров" : "Внесите финансовые данные"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigateDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 min-w-[180px]">
                <CalendarCheck className="h-4 w-4" />
                {format(selectedDate, "d MMMM yyyy", { locale: ru })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} locale={ru} />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigateDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isAdmin ? (
        // ====== DIRECTOR / ADMIN VIEW ======
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Приход</p>
                  <p className="text-2xl font-extrabold font-mono text-green-600">
                    +{grandTotals.income.toLocaleString("ru-RU")} ₽
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-500/30" />
              </CardContent>
            </Card>
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Расход</p>
                  <p className="text-2xl font-extrabold font-mono text-red-600">
                    −{grandTotals.expense.toLocaleString("ru-RU")} ₽
                  </p>
                </div>
                <TrendingDown className="h-8 w-8 text-red-500/30" />
              </CardContent>
            </Card>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Итого выручка</p>
                  <p className="text-2xl font-extrabold font-mono text-primary">
                    {grandTotals.net.toLocaleString("ru-RU")} ₽
                  </p>
                </div>
                <FileBarChart className="h-8 w-8 text-primary/30" />
              </CardContent>
            </Card>
          </div>

          {/* Per-entity breakdown */}
          {entities.map(entity => {
            const entityCats = categories.filter(c => c.entity_id === entity.id);
            const totals = getEntityTotals(entity.id, directorEntryMap);

            return (
              <Card key={entity.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      {entity.name}
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-green-600 border-green-500/30">
                        +{totals.income.toLocaleString("ru-RU")}
                      </Badge>
                      {totals.expense > 0 && (
                        <Badge variant="outline" className="font-mono text-red-600 border-red-500/30">
                          −{totals.expense.toLocaleString("ru-RU")}
                        </Badge>
                      )}
                      <Badge className="font-mono">
                        = {totals.net.toLocaleString("ru-RU")} ₽
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {entityCats.map(cat => {
                      const val = directorEntryMap[cat.id]?.amount || 0;
                      const isExpense = cat.sign === "expense";
                      return (
                        <div key={cat.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/30">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                              isExpense ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            }`}>
                              {isExpense ? "−" : "+"}
                            </span>
                            <span className="text-sm font-medium">{cat.name}</span>
                          </div>
                          <span className={`font-mono font-bold text-sm ${isExpense ? "text-red-600" : "text-green-600"}`}>
                            {isExpense ? "−" : "+"}{val.toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      );
                    })}
                    {entityCats.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">Нет категорий</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Reports list */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Отчёты менеджеров за {format(selectedDate, "d MMMM", { locale: ru })}</CardTitle>
              <CardDescription>{allReports.length === 0 ? "Нет отчётов за эту дату" : `${allReports.length} отчёт(ов)`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {allReports.map(report => {
                const reportEntries = allEntries.filter((e: any) => e.report_id === report.id);
                const reportPhotos = allPhotos.filter(p => p.report_id === report.id);
                const total = reportEntries.reduce((s: number, e: any) => {
                  const cat = categories.find(c => c.id === e.category_id);
                  return s + (cat?.sign === "expense" ? -Number(e.amount) : Number(e.amount));
                }, 0);

                return (
                  <div key={report.id} className="p-4 rounded-xl border border-border bg-card/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant={report.status === "submitted" ? "default" : "secondary"}>
                          {report.status === "submitted" ? "Отправлен" : "Черновик"}
                        </Badge>
                        {report.submitted_at && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(report.submitted_at), "HH:mm", { locale: ru })}
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-primary">
                        {total.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                    {report.notes && (
                      <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-2.5">
                        {report.notes}
                      </p>
                    )}
                    {reportPhotos.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {reportPhotos.map(photo => (
                          <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer"
                            className="block w-20 h-20 rounded-lg overflow-hidden border border-border hover:ring-2 ring-primary transition-all">
                            <img src={photo.url} alt="" className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                    {/* Detail entries */}
                    <div className="space-y-1">
                      {reportEntries.map((e: any) => {
                        const cat = categories.find(c => c.id === e.category_id);
                        const entity = entities.find(en => en.id === cat?.entity_id);
                        const isExp = cat?.sign === "expense";
                        return (
                          <div key={e.id} className="flex items-center justify-between text-xs py-1">
                            <span className="text-muted-foreground">
                              {entity?.name} → {cat?.name}
                              {e.note && <span className="ml-1 text-foreground/60">({e.note})</span>}
                            </span>
                            <span className={`font-mono font-medium ${isExp ? "text-red-500" : "text-green-600"}`}>
                              {isExp ? "−" : "+"}{Number(e.amount).toLocaleString("ru-RU")} ₽
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Add category button for admins */}
          <Button variant="outline" onClick={() => { setAddCatOpen(true); setNewCatEntityId(entities[0]?.id || ""); }} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить категорию в отчёт
          </Button>
        </div>
      ) : (
        // ====== MANAGER VIEW ======
        <ManagerReportForm
          entities={entities}
          categories={categories}
          entries={entries}
          setEntries={setEntries}
          notes={notes}
          setNotes={setNotes}
          photos={photos}
          reportStatus={reportStatus}
          isSaving={isSaving}
          uploading={uploading}
          saveReport={saveReport}
          handlePhotoUpload={handlePhotoUpload}
          deletePhoto={deletePhoto}
          getEntityTotals={getEntityTotals}
          getGrandTotals={getGrandTotals}
          onAddCategory={() => { setAddCatOpen(true); setNewCatEntityId(entities[0]?.id || ""); }}
        />
      )}

      {/* Add Category Dialog */}
      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Новая категория</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>ИП</Label>
              <Select value={newCatEntityId} onValueChange={setNewCatEntityId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Название</Label>
              <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Выдача наличных" />
            </div>
            <div>
              <Label>Тип</Label>
              <Select value={newCatSign} onValueChange={setNewCatSign}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">
                    <span className="flex items-center gap-2">
                      <span className="text-green-600 font-bold">+</span> Приход (в кассу)
                    </span>
                  </SelectItem>
                  <SelectItem value="expense">
                    <span className="flex items-center gap-2">
                      <span className="text-red-600 font-bold">−</span> Расход (из кассы)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCatOpen(false)}>Отмена</Button>
            <Button onClick={addCategory}>Добавить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Manager form component
function ManagerReportForm({
  entities, categories, entries, setEntries, notes, setNotes,
  photos, reportStatus, isSaving, uploading, saveReport,
  handlePhotoUpload, deletePhoto, getEntityTotals, getGrandTotals, onAddCategory,
}: any) {
  const grandTotals = getGrandTotals(entries);

  return (
    <>
      {entities.map((entity: Entity) => {
        const entityCats = categories.filter((c: Category) => c.entity_id === entity.id);
        const totals = getEntityTotals(entity.id, entries);

        return (
          <Card key={entity.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {entity.name}
                </CardTitle>
                <div className="flex gap-2">
                  {totals.expense > 0 && (
                    <Badge variant="outline" className="font-mono text-red-600 border-red-500/30 text-xs">
                      −{totals.expense.toLocaleString("ru-RU")}
                    </Badge>
                  )}
                  <Badge variant="outline" className="font-mono">
                    = {totals.net.toLocaleString("ru-RU")} ₽
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {entityCats.map((cat: Category) => {
                const isExpense = cat.sign === "expense";
                return (
                  <div key={cat.id} className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      isExpense ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    }`}>
                      {isExpense ? "−" : "+"}
                    </span>
                    <span className="text-sm text-muted-foreground min-w-[100px]">{cat.name}</span>
                    <Input
                      type="number"
                      placeholder="0"
                      value={entries[cat.id]?.amount || ""}
                      onChange={(e) => setEntries((prev: any) => ({
                        ...prev,
                        [cat.id]: { ...prev[cat.id], amount: parseFloat(e.target.value) || 0 },
                      }))}
                      className="font-mono text-right max-w-[140px]"
                    />
                    <Input
                      placeholder="Примечание..."
                      value={entries[cat.id]?.note || ""}
                      onChange={(e) => setEntries((prev: any) => ({
                        ...prev,
                        [cat.id]: { ...prev[cat.id], note: e.target.value, amount: prev[cat.id]?.amount || 0 },
                      }))}
                      className="text-xs flex-1"
                    />
                  </div>
                );
              })}
              {entityCats.length === 0 && (
                <p className="text-sm text-muted-foreground">Нет категорий</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Приход</p>
            <p className="text-xl font-extrabold font-mono text-green-600">+{grandTotals.income.toLocaleString("ru-RU")} ₽</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Расход</p>
            <p className="text-xl font-extrabold font-mono text-red-600">−{grandTotals.expense.toLocaleString("ru-RU")} ₽</p>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Выручка</p>
            <p className="text-xl font-extrabold font-mono text-primary">{grandTotals.net.toLocaleString("ru-RU")} ₽</p>
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" size="sm" onClick={onAddCategory} className="gap-2">
        <Plus className="h-3.5 w-3.5" /> Добавить категорию
      </Button>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Заметки</CardTitle></CardHeader>
        <CardContent>
          <Textarea placeholder="Дополнительная информация..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" /> Фото-отчёт</CardTitle>
            <label>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
              <Button asChild variant="outline" size="sm" className="gap-1.5 cursor-pointer" disabled={uploading}>
                <span>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Загрузить
                </span>
              </Button>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {photos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo: ReportPhoto) => (
                <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-border">
                  <img src={photo.url} alt="" className="w-full h-32 object-cover" />
                  <Button variant="destructive" size="icon"
                    className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deletePhoto(photo)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm flex flex-col items-center gap-2">
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
              Нет загруженных фото
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => saveReport(false)} disabled={isSaving} className="flex-1 gap-2">
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          Сохранить черновик
        </Button>
        <Button onClick={() => saveReport(true)} disabled={isSaving} className="flex-1 gap-2">
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          <Send className="h-4 w-4" />
          Отправить отчёт
        </Button>
      </div>
    </>
  );
}
