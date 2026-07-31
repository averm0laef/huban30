import { useState } from "react";
import { Phone, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ProfileCompletionPromptProps {
  userId: string;
  currentPhone: string | null;
  currentEmail: string | null;
  userEmail: string | undefined;
  onComplete: () => void;
}

export function ProfileCompletionPrompt({
  userId,
  currentPhone,
  currentEmail,
  userEmail,
  onComplete,
}: ProfileCompletionPromptProps) {
  const [phone, setPhone] = useState(currentPhone || "");
  const [email, setEmail] = useState(currentEmail || "");
  const [isSaving, setIsSaving] = useState(false);

  // Check if user signed in via Telegram (has @telegram.local email)
  const isTelegramUser = userEmail?.includes("@telegram.local");
  const needsPhone = !currentPhone;
  const needsEmail = isTelegramUser && !currentEmail;

  if (!needsPhone && !needsEmail) {
    return null;
  }

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: Record<string, string> = {};
      
      if (needsPhone && phone.trim()) {
        updates.phone = phone.trim();
      }
      if (needsEmail && email.trim()) {
        updates.email = email.trim();
      }

      if (Object.keys(updates).length === 0) {
        toast.info("Заполните хотя бы одно поле");
        setIsSaving(false);
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", userId);

      if (error) throw error;

      toast.success("Профиль обновлён!");
      onComplete();
    } catch (error: any) {
      toast.error(error.message || "Ошибка сохранения");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Дополните профиль</CardTitle>
        <CardDescription>
          Добавьте контактные данные для удобной связи
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {needsPhone && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Номер телефона</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <PhoneInput
                value={phone}
                onChange={setPhone}
                className="pl-10"
              />
            </div>
          </div>
        )}

        {needsEmail && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Email для связи</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Можно будет использовать для входа и восстановления пароля
            </p>
          </div>
        )}

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
}
