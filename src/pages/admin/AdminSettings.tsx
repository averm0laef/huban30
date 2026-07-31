import { useEffect, useState } from "react";
import { Save, Store, Clock, MessageSquare, Upload, Copy, Check, Eye, EyeOff, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface StoreSettings {
  id: string;
  title: string;
  phone: string | null;
  address: string | null;
  telegram_nick: string | null;
  timezone: string;
  chat_offline_autoreply: string | null;
  no_item_text: string | null;
  exchange_login: string | null;
  exchange_password: string | null;
  social_vk: string | null;
  social_whatsapp: string | null;
  social_telegram: string | null;
  social_max: string | null;
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const exchangeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exchange-1c`;

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setSettings(data);
      } else {
        // Create default settings if none exist
        const { data: newSettings, error: createError } = await supabase
          .from("store_settings")
          .insert({
            title: "АН-30",
            phone: "+7 (924) 123-45-67",
            address: "Чернышевск, ул. Куйбышева, 118А",
            telegram_nick: "@an30_autoparts",
          })
          .select()
          .single();

        if (createError) throw createError;
        setSettings(newSettings);
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("store_settings")
        .update({
          title: settings.title,
          phone: settings.phone,
          address: settings.address,
          telegram_nick: settings.telegram_nick,
          chat_offline_autoreply: settings.chat_offline_autoreply,
          no_item_text: settings.no_item_text,
          exchange_login: settings.exchange_login,
          exchange_password: settings.exchange_password,
          social_vk: settings.social_vk,
          social_whatsapp: settings.social_whatsapp,
          social_telegram: settings.social_telegram,
          social_max: settings.social_max,
        })
        .eq("id", settings.id);

      if (error) throw error;
      toast({ title: "Настройки сохранены" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Ошибка сохранения",
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Ошибка загрузки настроек
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Настройки</h1>
          <p className="text-muted-foreground mt-1">
            Основные настройки магазина
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Основная информация
          </CardTitle>
          <CardDescription>Контактные данные и адрес магазина</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Название магазина</Label>
            <Input
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Телефон</Label>
            <Input
              value={settings.phone || ""}
              onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
              placeholder="+7 (XXX) XXX-XX-XX"
            />
          </div>
          <div className="space-y-2">
            <Label>Адрес</Label>
            <Input
              value={settings.address || ""}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Telegram</Label>
            <Input
              value={settings.telegram_nick || ""}
              onChange={(e) => setSettings({ ...settings, telegram_nick: e.target.value })}
              placeholder="@username"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Часовой пояс
          </CardTitle>
          <CardDescription>
            Все расписания рассчитываются в этом часовом поясе
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Часовой пояс</Label>
            <Input
              value={settings.timezone}
              disabled
              className="bg-secondary"
            />
            <p className="text-xs text-muted-foreground">
              Изменение часового пояса недоступно
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Чат и автоответы
          </CardTitle>
          <CardDescription>
            Настройки автоматических сообщений
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Автоответ в нерабочее время</Label>
            <Textarea
              value={settings.chat_offline_autoreply || ""}
              onChange={(e) => setSettings({ ...settings, chat_offline_autoreply: e.target.value })}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Текст "Если нет товара"</Label>
            <Textarea
              value={settings.no_item_text || ""}
              onChange={(e) => setSettings({ ...settings, no_item_text: e.target.value })}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Социальные сети и мессенджеры
          </CardTitle>
          <CardDescription>
            Ссылки на соцсети, отображаемые на сайте (футер, контакты)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ВКонтакте</Label>
            <Input
              value={settings.social_vk || ""}
              onChange={(e) => setSettings({ ...settings, social_vk: e.target.value })}
              placeholder="https://vk.com/..."
            />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp</Label>
            <Input
              value={settings.social_whatsapp || ""}
              onChange={(e) => setSettings({ ...settings, social_whatsapp: e.target.value })}
              placeholder="https://wa.me/7..."
            />
          </div>
          <div className="space-y-2">
            <Label>Telegram</Label>
            <Input
              value={settings.social_telegram || ""}
              onChange={(e) => setSettings({ ...settings, social_telegram: e.target.value })}
              placeholder="https://t.me/..."
            />
          </div>
          <div className="space-y-2">
            <Label>MAX мессенджер</Label>
            <Input
              value={settings.social_max || ""}
              onChange={(e) => setSettings({ ...settings, social_max: e.target.value })}
              placeholder="https://max.ru/..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Обмен с 1С
          </CardTitle>
          <CardDescription>
            Настройки для синхронизации с 1С через протокол CommerceML
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL для обмена</Label>
            <div className="flex gap-2">
              <Input value={exchangeUrl} readOnly className="font-mono text-sm" />
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(exchangeUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  toast({ title: "URL скопирован" });
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Укажите этот URL в настройках 1С: "Компания" → "Обмен с сайтом"
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Логин для 1С</Label>
              <Input
                value={settings.exchange_login || ""}
                onChange={(e) => setSettings({ ...settings, exchange_login: e.target.value })}
                placeholder="admin"
              />
            </div>
            <div className="space-y-2">
              <Label>Пароль для 1С</Label>
              <div className="flex gap-2">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={settings.exchange_password || ""}
                  onChange={(e) => setSettings({ ...settings, exchange_password: e.target.value })}
                  placeholder="••••••••"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-secondary/50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">Инструкция по настройке в 1С:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Откройте "Компания" → "Обмен с сайтом" или "CRM" → "Обмен с сайтом"</li>
              <li>Создайте узел обмена с типом "Сайт на 1С-Битрикс"</li>
              <li>В поле "Адрес сайта" укажите URL выше</li>
              <li>Введите логин и пароль из настроек</li>
              <li>Настройте выгрузку номенклатуры, цен и остатков</li>
              <li>Запустите синхронизацию</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
