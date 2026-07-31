import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Employee {
  id: string;
  name: string;
  position: string | null;
  is_active: boolean;
  sort_order: number;
}

export default function AdminEmployees() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchEmployees(); }, []);

  const fetchEmployees = async () => {
    setIsLoading(true);
    const { data } = await supabase.from("employees").select("*").order("sort_order");
    setEmployees((data || []) as Employee[]);
    setIsLoading(false);
  };

  const addEmployee = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("employees").insert({
      name: newName.trim(),
      position: newPosition.trim() || null,
      sort_order: employees.length,
    });
    if (!error) {
      await supabase.from("action_logs").insert({
        user_id: user?.id, action: "create_employee", entity_type: "employee",
        details: { name: newName.trim() },
      });
      setNewName("");
      setNewPosition("");
      await fetchEmployees();
      toast({ title: "Сотрудник добавлен" });
    }
    setSaving(false);
  };

  const toggleActive = async (emp: Employee) => {
    await supabase.from("employees").update({ is_active: !emp.is_active }).eq("id", emp.id);
    await supabase.from("action_logs").insert({
      user_id: user?.id, action: emp.is_active ? "deactivate_employee" : "activate_employee",
      entity_type: "employee", entity_id: emp.id, details: { name: emp.name },
    });
    await fetchEmployees();
  };

  const deleteEmployee = async (emp: Employee) => {
    if (!confirm(`Удалить сотрудника "${emp.name}"?`)) return;
    await supabase.from("employees").delete().eq("id", emp.id);
    await supabase.from("action_logs").insert({
      user_id: user?.id, action: "delete_employee", entity_type: "employee",
      entity_id: emp.id, details: { name: emp.name },
    });
    await fetchEmployees();
    toast({ title: "Сотрудник удалён" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-extrabold">Сотрудники</h1>
        <p className="text-muted-foreground text-sm mt-1">Управление списком сотрудников для отметки посещаемости</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Добавить сотрудника</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="Имя" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1" />
            <Input placeholder="Должность (необяз.)" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} className="flex-1" />
            <Button onClick={addEmployee} disabled={saving || !newName.trim()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Добавить
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {employees.map((emp) => (
            <Card key={emp.id} className={`${!emp.is_active ? "opacity-50" : ""}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{emp.name}</p>
                  {emp.position && <p className="text-xs text-muted-foreground">{emp.position}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => toggleActive(emp)} className="text-xs">
                  {emp.is_active ? "Деактивировать" : "Активировать"}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteEmployee(emp)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
          {employees.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Нет сотрудников</div>
          )}
        </div>
      )}
    </div>
  );
}
