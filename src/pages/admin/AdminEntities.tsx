import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Building2, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Entity {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

interface Category {
  id: string;
  entity_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export default function AdminEntities() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newEntityName, setNewEntityName] = useState("");
  const [newCatName, setNewCatName] = useState<Record<string, string>>({});

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setIsLoading(true);
    const [entRes, catRes] = await Promise.all([
      supabase.from("business_entities").select("*").order("sort_order"),
      supabase.from("report_categories").select("*").order("sort_order"),
    ]);
    setEntities((entRes.data || []) as Entity[]);
    setCategories((catRes.data || []) as Category[]);
    setIsLoading(false);
  };

  const addEntity = async () => {
    if (!newEntityName.trim()) return;
    await supabase.from("business_entities").insert({ name: newEntityName.trim(), sort_order: entities.length });
    await supabase.from("action_logs").insert({
      user_id: user?.id, action: "create_entity", entity_type: "business_entity",
      details: { name: newEntityName.trim() },
    });
    setNewEntityName("");
    await fetchData();
    toast({ title: "ИП добавлено" });
  };

  const deleteEntity = async (e: Entity) => {
    if (!confirm(`Удалить "${e.name}" и все категории?`)) return;
    await supabase.from("business_entities").delete().eq("id", e.id);
    await supabase.from("action_logs").insert({
      user_id: user?.id, action: "delete_entity", entity_type: "business_entity",
      entity_id: e.id, details: { name: e.name },
    });
    await fetchData();
    toast({ title: "ИП удалено" });
  };

  const addCategory = async (entityId: string) => {
    const name = newCatName[entityId]?.trim();
    if (!name) return;
    const entityCats = categories.filter(c => c.entity_id === entityId);
    await supabase.from("report_categories").insert({ entity_id: entityId, name, sort_order: entityCats.length });
    await supabase.from("action_logs").insert({
      user_id: user?.id, action: "create_report_category", entity_type: "report_category",
      details: { name, entity_id: entityId },
    });
    setNewCatName(prev => ({ ...prev, [entityId]: "" }));
    await fetchData();
    toast({ title: "Категория добавлена" });
  };

  const deleteCategory = async (cat: Category) => {
    await supabase.from("report_categories").delete().eq("id", cat.id);
    await fetchData();
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-extrabold">ИП / Категории отчётов</h1>
        <p className="text-muted-foreground text-sm mt-1">Управляйте юр. лицами и категориями для отчётов менеджеров</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Добавить ИП</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="Название (напр. ИП Марина)" value={newEntityName} onChange={(e) => setNewEntityName(e.target.value)} />
            <Button onClick={addEntity} disabled={!newEntityName.trim()} className="gap-2"><Plus className="h-4 w-4" /> Добавить</Button>
          </div>
        </CardContent>
      </Card>

      {entities.map((entity) => {
        const entityCats = categories.filter(c => c.entity_id === entity.id);
        return (
          <Card key={entity.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {entity.name}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => deleteEntity(entity)} className="text-destructive hover:text-destructive h-8 w-8">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {entityCats.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm flex-1">{cat.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteCategory(cat)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Separator />
              <div className="flex gap-2">
                <Input
                  placeholder="Новая категория (напр. Наличные)"
                  value={newCatName[entity.id] || ""}
                  onChange={(e) => setNewCatName(prev => ({ ...prev, [entity.id]: e.target.value }))}
                  className="text-sm"
                />
                <Button size="sm" onClick={() => addCategory(entity.id)} disabled={!newCatName[entity.id]?.trim()} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Добавить
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {entities.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Добавьте первое ИП для начала работы с отчётами
        </div>
      )}
    </div>
  );
}
