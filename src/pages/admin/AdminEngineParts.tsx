import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Pencil, Trash2, GripVertical, Eye, EyeOff, Save, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import engineBay from "@/assets/engine-bay.png";

interface EnginePart {
  id: string;
  label: string;
  description: string | null;
  x_position: number;
  y_position: number;
  color: string;
  sort_order: number;
  is_active: boolean;
}

const defaultForm = {
  label: "",
  description: "",
  x_position: 50,
  y_position: 50,
  color: "#3b82f6",
  sort_order: 0,
  is_active: true,
};

export default function AdminEngineParts() {
  const [parts, setParts] = useState<EnginePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<EnginePart | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchParts();
  }, []);

  const fetchParts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("engine_parts")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error("Ошибка загрузки");
    } else {
      setParts((data as EnginePart[]) || []);
    }
    setLoading(false);
  };

  const openCreate = () => {
    setEditingPart(null);
    setForm({ ...defaultForm, sort_order: parts.length + 1 });
    setDialogOpen(true);
  };

  const openEdit = (part: EnginePart) => {
    setEditingPart(part);
    setForm({
      label: part.label,
      description: part.description || "",
      x_position: part.x_position,
      y_position: part.y_position,
      color: part.color,
      sort_order: part.sort_order,
      is_active: part.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim()) {
      toast.error("Введите название");
      return;
    }

    const payload = {
      label: form.label.trim(),
      description: form.description.trim() || null,
      x_position: form.x_position,
      y_position: form.y_position,
      color: form.color,
      sort_order: form.sort_order,
      is_active: form.is_active,
    };

    if (editingPart) {
      const { error } = await supabase
        .from("engine_parts")
        .update(payload)
        .eq("id", editingPart.id);

      if (error) {
        toast.error("Ошибка обновления");
      } else {
        toast.success("Обновлено");
      }
    } else {
      const { error } = await supabase.from("engine_parts").insert(payload);

      if (error) {
        toast.error("Ошибка создания");
      } else {
        toast.success("Добавлено");
      }
    }

    setDialogOpen(false);
    fetchParts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту точку?")) return;

    const { error } = await supabase.from("engine_parts").delete().eq("id", id);

    if (error) {
      toast.error("Ошибка удаления");
    } else {
      toast.success("Удалено");
      fetchParts();
    }
  };

  const toggleActive = async (part: EnginePart) => {
    const { error } = await supabase
      .from("engine_parts")
      .update({ is_active: !part.is_active })
      .eq("id", part.id);

    if (error) {
      toast.error("Ошибка");
    } else {
      fetchParts();
    }
  };

  // --- Drag-and-drop logic ---
  const getPercentFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!previewRef.current) return null;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
    return { x, y };
  }, []);

  const handleDragStart = (e: React.MouseEvent, partId: string) => {
    e.preventDefault();
    setDraggingId(partId);
  };

  useEffect(() => {
    if (!draggingId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getPercentFromEvent(e);
      if (!pos) return;
      setParts((prev) =>
        prev.map((p) => (p.id === draggingId ? { ...p, x_position: pos.x, y_position: pos.y } : p))
      );
    };

    const handleMouseUp = async () => {
      const part = parts.find((p) => p.id === draggingId);
      if (part) {
        await supabase
          .from("engine_parts")
          .update({ x_position: part.x_position, y_position: part.y_position })
          .eq("id", part.id);
      }
      setDraggingId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingId, parts, getPercentFromEvent]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Точки на капоте</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Перетаскивайте точки мышкой прямо на изображении
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </div>

      {/* Preview with engine bay image */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Move className="h-4 w-4" />
            Предпросмотр — перетаскивайте точки
          </CardTitle>
          <CardDescription>Нажмите и перетащите точку в нужное место</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            ref={previewRef}
            className="relative w-full aspect-[16/10] rounded-xl border border-border overflow-hidden select-none"
            style={{ cursor: draggingId ? "grabbing" : "default" }}
          >
            <img
              src={engineBay}
              alt="Подкапотное пространство"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10 pointer-events-none" />

            {parts.map((part) => (
              <div
                key={part.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 group ${
                  !part.is_active ? "opacity-40" : ""
                } ${draggingId === part.id ? "z-20 scale-110" : ""}`}
                style={{
                  left: `${part.x_position}%`,
                  top: `${part.y_position}%`,
                  cursor: draggingId === part.id ? "grabbing" : "grab",
                  transition: draggingId === part.id ? "none" : "all 0.15s ease",
                }}
                onMouseDown={(e) => handleDragStart(e, part.id)}
                onDoubleClick={() => openEdit(part)}
              >
                <span
                  className="block w-4 h-4 rounded-full ring-2 ring-white/80 shadow-lg"
                  style={{ backgroundColor: part.color }}
                />
                <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-white whitespace-nowrap bg-black/70 px-2 py-0.5 rounded-md shadow pointer-events-none">
                  {part.label}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
        ) : parts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Нет точек. Добавьте первую!</p>
        ) : (
          parts.map((part) => (
            <div
              key={part.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                part.is_active ? "bg-card border-border" : "bg-muted/30 border-border/50 opacity-60"
              }`}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span
                className="w-4 h-4 rounded-full shrink-0 ring-2 ring-border"
                style={{ backgroundColor: part.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{part.label}</p>
                {part.description && (
                  <p className="text-xs text-muted-foreground truncate">{part.description}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                X:{part.x_position}% Y:{part.y_position}%
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActive(part)}>
                {part.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(part)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(part.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPart ? "Редактировать точку" : "Новая точка"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Название *</Label>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Аккумулятор" />
            </div>
            <div>
              <Label>Описание</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="АКБ и клеммы" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Цвет</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded border-0 cursor-pointer" />
                  <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="flex-1" />
                </div>
              </div>
              <div>
                <Label>Порядок</Label>
                <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
              <Label>Активна</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              {editingPart ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
