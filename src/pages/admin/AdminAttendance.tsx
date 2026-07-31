import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarCheck, Check, X, Clock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Employee {
  id: string;
  name: string;
  position: string | null;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  is_present: boolean;
  checked_in_at: string | null;
  checked_in_by: string | null;
  note: string | null;
}

export default function AdminAttendance() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  useEffect(() => {
    fetchData();
  }, [dateStr]);

  const fetchData = async () => {
    setIsLoading(true);
    const [empRes, attRes] = await Promise.all([
      supabase.from("employees").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("attendance_records").select("*").eq("date", dateStr),
    ]);
    setEmployees((empRes.data || []) as Employee[]);
    setRecords((attRes.data || []) as AttendanceRecord[]);
    setIsLoading(false);
  };

  const toggleAttendance = async (employeeId: string) => {
    setSaving(employeeId);
    const existing = records.find(r => r.employee_id === employeeId);
    
    try {
      if (existing) {
        const newPresent = !existing.is_present;
        await supabase
          .from("attendance_records")
          .update({ 
            is_present: newPresent, 
            checked_in_at: newPresent ? new Date().toISOString() : null,
            checked_in_by: user?.id 
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("attendance_records")
          .insert({
            employee_id: employeeId,
            date: dateStr,
            is_present: true,
            checked_in_at: new Date().toISOString(),
            checked_in_by: user?.id,
          });
      }

      // Log action
      await supabase.from("action_logs").insert({
        user_id: user?.id,
        action: existing?.is_present ? "uncheck_attendance" : "check_attendance",
        entity_type: "attendance",
        entity_id: employeeId,
        details: { date: dateStr, employee_id: employeeId },
      });

      await fetchData();
      toast({ title: "Сохранено" });
    } catch (error) {
      toast({ variant: "destructive", title: "Ошибка сохранения" });
    } finally {
      setSaving(null);
    }
  };

  const getRecord = (employeeId: string) => records.find(r => r.employee_id === employeeId);
  const presentCount = records.filter(r => r.is_present).length;
  const isToday = format(new Date(), "yyyy-MM-dd") === dateStr;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-extrabold">Посещаемость</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Отметьте кто сегодня на работе
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarCheck className="h-4 w-4" />
                {format(selectedDate, "d MMMM yyyy", { locale: ru })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                locale={ru}
              />
            </PopoverContent>
          </Popover>
          <Badge variant={isToday ? "default" : "secondary"} className="text-xs">
            {presentCount}/{employees.length} на месте
          </Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {isAdmin ? "Добавьте сотрудников в разделе «Сотрудники»" : "Нет сотрудников"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp) => {
            const record = getRecord(emp.id);
            const isPresent = record?.is_present || false;
            const checkedAt = record?.checked_in_at;

            return (
              <Card
                key={emp.id}
                className={`transition-all cursor-pointer border-2 ${
                  isPresent
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-border hover:border-muted-foreground/20"
                }`}
                onClick={() => toggleAttendance(emp.id)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                    isPresent ? "bg-green-500 text-white" : "bg-secondary text-muted-foreground"
                  }`}>
                    {saving === emp.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : isPresent ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <X className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{emp.name}</p>
                    {emp.position && (
                      <p className="text-xs text-muted-foreground">{emp.position}</p>
                    )}
                    {checkedAt && isPresent && (
                      <p className="text-[10px] text-green-600 flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        Отметка: {format(new Date(checkedAt), "HH:mm")}
                      </p>
                    )}
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
