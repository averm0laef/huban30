import { useEffect, useState } from "react";
import { MessageSquare, Package, Users, FileText, TrendingUp, TrendingDown, Clock, Timer, User, ArrowUpRight, Eye, FileBarChart, CalendarCheck, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import logo from "@/assets/logo.svg";

interface ChatThread {
  id: string;
  user_id: string | null;
  guest_session_id: string | null;
  status: string;
  last_message_at: string | null;
  waiting_since: string | null;
  profile?: { full_name: string | null; email: string | null };
}

function ActiveChats() {
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchChats() {
      const { data } = await supabase
        .from("chat_threads")
        .select("*")
        .in("status", ["new", "waiting", "active"])
        .order("waiting_since", { ascending: true, nullsFirst: false });

      const threads = await Promise.all((data || []).map(async (t) => {
        if (t.user_id) {
          const { data: p } = await supabase.from("profiles").select("full_name, email").eq("user_id", t.user_id).maybeSingle();
          return { ...t, profile: p };
        }
        return t;
      }));
      setChats(threads);
      setIsLoading(false);
    }
    fetchChats();

    const channel = supabase
      .channel("dashboard-chats")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads" }, () => fetchChats())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const getWaitingTime = (waitingSince: string | null) => {
    if (!waitingSince) return null;
    const diffMs = now.getTime() - new Date(waitingSince).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "< 1 мин";
    if (mins < 60) return `${mins} мин`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}ч ${mins % 60}м`;
    return `${Math.floor(hours / 24)}д ${hours % 24}ч`;
  };

  const getName = (t: ChatThread) => t.profile?.full_name || t.profile?.email || (t.guest_session_id ? `Гость ${t.guest_session_id.slice(0, 6)}` : "Неизвестный");

  if (isLoading) return <div className="text-center py-6 text-muted-foreground text-sm">Загрузка...</div>;
  if (chats.length === 0) return <div className="text-center py-8 text-muted-foreground text-sm">Нет активных чатов</div>;

  return (
    <ScrollArea className="h-[240px]">
      <div className="space-y-2">
        {chats.map((t) => {
          const isWaiting = t.status === "new" || t.status === "waiting";
          return (
            <Link key={t.id} to="/admin/chat"
              className={`block p-3.5 rounded-xl transition-all duration-150 ${
                isWaiting ? "bg-destructive/8 hover:bg-destructive/12 border border-destructive/15" : "bg-secondary/60 hover:bg-secondary border border-transparent"
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isWaiting ? "bg-destructive/15" : "bg-primary/10"}`}>
                    <User className={`h-4 w-4 ${isWaiting ? "text-destructive" : "text-primary"}`} />
                  </div>
                  <span className="font-medium text-sm">{getName(t)}</span>
                </div>
                {isWaiting ? (
                  <Badge variant="destructive" className="text-[10px] rounded-lg">Ожидает</Badge>
                ) : (
                  <Badge className="bg-success text-background text-[10px] rounded-lg">В работе</Badge>
                )}
              </div>
              {isWaiting && t.waiting_since && (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-destructive/80">
                  <Timer className="h-3 w-3" /><span>{getWaitingTime(t.waiting_since)}</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface Stats {
  products: number;
  categories: number;
  users: number;
  pages: number;
  activeChats: number;
  todayViews: number;
  totalViews: number;
}

interface TodayFinancials {
  income: number;
  expense: number;
  net: number;
  reportsCount: number;
  presentToday: number;
  totalEmployees: number;
}

export default function Dashboard() {
  const { isAdmin, isManager, role } = useAuth();
  const [stats, setStats] = useState<Stats>({
    products: 0, categories: 0, users: 0, pages: 0, activeChats: 0, todayViews: 0, totalViews: 0,
  });
  const [financials, setFinancials] = useState<TodayFinancials>({
    income: 0, expense: 0, net: 0, reportsCount: 0, presentToday: 0, totalEmployees: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = format(today, "yyyy-MM-dd");
        
        const [products, categories, profiles, pages, chats, todayPv, totalPv] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase.from("categories").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("pages").select("id", { count: "exact", head: true }),
          supabase.from("chat_threads").select("id", { count: "exact", head: true }).neq("status", "closed"),
          supabase.from("page_views").select("id", { count: "exact", head: true }).gte("viewed_at", today.toISOString()),
          supabase.from("page_views").select("id", { count: "exact", head: true }),
        ]);
        setStats({
          products: products.count || 0,
          categories: categories.count || 0,
          users: profiles.count || 0,
          pages: pages.count || 0,
          activeChats: chats.count || 0,
          todayViews: todayPv.count || 0,
          totalViews: totalPv.count || 0,
        });

        // Financials for today
        if (isAdmin || isManager) {
          const [reportsRes, catsRes, employeesRes, attendanceRes] = await Promise.all([
            supabase.from("daily_reports").select("id").eq("report_date", todayStr),
            supabase.from("report_categories").select("id, sign").eq("is_active", true),
            supabase.from("employees").select("id", { count: "exact", head: true }).eq("is_active", true),
            supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("date", todayStr).eq("is_present", true),
          ]);

          const reportIds = (reportsRes.data || []).map(r => r.id);
          let income = 0, expense = 0;

          if (reportIds.length > 0) {
            const { data: entriesData } = await supabase.from("report_entries").select("category_id, amount").in("report_id", reportIds);
            const catSignMap: Record<string, string> = {};
            (catsRes.data || []).forEach((c: any) => { catSignMap[c.id] = c.sign; });

            (entriesData || []).forEach((e: any) => {
              if (catSignMap[e.category_id] === "expense") expense += Number(e.amount);
              else income += Number(e.amount);
            });
          }

          setFinancials({
            income, expense, net: income - expense,
            reportsCount: reportIds.length,
            presentToday: attendanceRes.count || 0,
            totalEmployees: employeesRes.count || 0,
          });
        }
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchStats();
  }, [isAdmin, isManager]);

  const statCards = [
    { label: "Товаров", value: stats.products, icon: Package, gradient: "from-[hsl(215_90%_52%)] to-[hsl(220_72%_42%)]" },
    { label: "Категорий", value: stats.categories, icon: TrendingUp, gradient: "from-[hsl(152_60%_38%)] to-[hsl(152_55%_30%)]" },
    { label: "Пользователей", value: stats.users, icon: Users, gradient: "from-[hsl(270_60%_55%)] to-[hsl(270_50%_42%)]" },
    { label: "Сегодня визитов", value: stats.todayViews, icon: Eye, gradient: "from-[hsl(200_80%_50%)] to-[hsl(200_70%_40%)]" },
    { label: "Всего визитов", value: stats.totalViews, icon: Eye, gradient: "from-[hsl(38_92%_50%)] to-[hsl(25_85%_45%)]" },
    { label: "Активных чатов", value: stats.activeChats, icon: MessageSquare, gradient: "from-[hsl(0_72%_51%)] to-[hsl(0_60%_42%)]" },
  ];

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Welcome header */}
      <div className="flex items-center gap-4">
        <img src={logo} alt="АН-30" className="h-12 w-auto hidden sm:block" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold">Панель управления</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {format(new Date(), "d MMMM yyyy, EEEE", { locale: ru })}
          </p>
        </div>
      </div>

      {/* Financials summary */}
      {(isAdmin || isManager) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Приход сегодня</p>
                  <p className="text-xl sm:text-2xl font-extrabold font-mono text-green-600">
                    {isLoading ? "—" : `+${financials.income.toLocaleString("ru-RU")}`}
                  </p>
                </div>
                <TrendingUp className="h-6 w-6 text-green-500/40" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Расход сегодня</p>
                  <p className="text-xl sm:text-2xl font-extrabold font-mono text-red-600">
                    {isLoading ? "—" : `−${financials.expense.toLocaleString("ru-RU")}`}
                  </p>
                </div>
                <TrendingDown className="h-6 w-6 text-red-500/40" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Выручка</p>
                  <p className="text-xl sm:text-2xl font-extrabold font-mono text-primary">
                    {isLoading ? "—" : financials.net.toLocaleString("ru-RU")}
                  </p>
                </div>
                <FileBarChart className="h-6 w-6 text-primary/40" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">На работе</p>
                  <p className="text-xl sm:text-2xl font-extrabold font-mono text-foreground">
                    {isLoading ? "—" : `${financials.presentToday}/${financials.totalEmployees}`}
                  </p>
                </div>
                <CalendarCheck className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {financials.reportsCount} отчёт(ов)
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stat cards - admin only */}
      {isAdmin && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="stat-card group">
                <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-gradient-to-r ${stat.gradient}`} />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                    <p className="text-2xl sm:text-3xl font-extrabold mt-1.5 font-display">
                      {isLoading ? "—" : stat.value}
                    </p>
                  </div>
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${stat.gradient} text-white shadow-lg`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-1.5 rounded-lg bg-primary/10"><MessageSquare className="h-4 w-4 text-primary" /></div>
                  Активные чаты
                </CardTitle>
                <CardDescription className="mt-1">Ожидающие ответа обращения</CardDescription>
              </div>
              <Link to="/admin/chat">
                <Button variant="ghost" size="sm" className="text-xs gap-1 text-primary">Все <ArrowUpRight className="h-3 w-3" /></Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent><ActiveChats /></CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 rounded-lg bg-primary/10"><Clock className="h-4 w-4 text-primary" /></div>
              Быстрые действия
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { href: "/admin/reports", icon: FileBarChart, title: "Заполнить отчёт", desc: isManager ? "Внести данные за сегодня" : "Посмотреть финансовые отчёты", show: true },
              { href: "/admin/attendance", icon: CalendarCheck, title: "Посещаемость", desc: isManager ? "Отметить кто на работе" : "Кто сегодня на работе", show: true },
              { href: "/admin/products", icon: Package, title: "Товары", desc: "Управление каталогом", show: isAdmin },
              { href: "/admin/settings", icon: FileText, title: "Настройки", desc: "Режим работы, контакты", show: isAdmin },
            ].filter(a => a.show).map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.href} to={action.href}
                  className="flex items-center gap-3 p-3.5 rounded-xl bg-secondary/50 hover:bg-secondary transition-all duration-150 group">
                  <div className="p-2 rounded-lg bg-background border border-border group-hover:border-primary/20 transition-colors">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div>
                    <span className="font-medium text-sm">{action.title}</span>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 ml-auto group-hover:text-primary transition-colors" />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
