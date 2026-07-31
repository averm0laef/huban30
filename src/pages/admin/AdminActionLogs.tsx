import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ScrollText, Loader2, User, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface ActionLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
  profile?: { full_name: string | null; email: string | null } | null;
}

const actionLabels: Record<string, string> = {
  check_attendance: "Отметил присутствие",
  uncheck_attendance: "Снял отметку",
  create_employee: "Добавил сотрудника",
  delete_employee: "Удалил сотрудника",
  activate_employee: "Активировал сотрудника",
  deactivate_employee: "Деактивировал сотрудника",
  create_entity: "Добавил ИП",
  delete_entity: "Удалил ИП",
  create_report_category: "Добавил категорию",
  save_report: "Сохранил черновик отчёта",
  submit_report: "Отправил отчёт",
};

const entityColors: Record<string, string> = {
  attendance: "bg-green-500/10 text-green-700",
  employee: "bg-blue-500/10 text-blue-700",
  business_entity: "bg-purple-500/10 text-purple-700",
  report_category: "bg-amber-500/10 text-amber-700",
  daily_report: "bg-primary/10 text-primary",
};

export default function AdminActionLogs() {
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("action_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    // Fetch profiles for user names
    const logs = data || [];
    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];
    
    const profiles: Record<string, { full_name: string | null; email: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      (profileData || []).forEach((p: any) => { profiles[p.user_id] = p; });
    }

    setLogs(logs.map((l: any) => ({ ...l, profile: profiles[l.user_id] || null })) as ActionLog[]);
    setIsLoading(false);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-extrabold flex items-center gap-3">
          <ScrollText className="h-7 w-7 text-primary" />
          Логи действий
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Все действия сотрудников в системе</p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Пока нет записей</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const label = actionLabels[log.action] || log.action;
            const colorClass = entityColors[log.entity_type] || "bg-secondary text-foreground";
            const userName = log.profile?.full_name || log.profile?.email || "Система";
            const details = log.details as any;

            return (
              <Card key={log.id} className="overflow-hidden">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                    <User className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{userName}</span>
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </div>
                    {details && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {details.name && (
                          <Badge variant="outline" className="text-[10px]">{details.name}</Badge>
                        )}
                        {details.date && (
                          <Badge variant="outline" className="text-[10px]">{details.date}</Badge>
                        )}
                        {details.entries_count !== undefined && (
                          <Badge variant="outline" className="text-[10px]">{details.entries_count} записей</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                    <Clock className="h-3 w-3" />
                    {format(new Date(log.created_at), "d MMM HH:mm", { locale: ru })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
