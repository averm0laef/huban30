import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { telegram_id } = await req.json();

    if (!telegram_id) {
      return new Response(
        JSON.stringify({ error: "telegram_id обязателен" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating code for telegram_id:", telegram_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate 6-digit code
    const code = generateCode();

    // Delete old codes for this telegram_id
    await supabase
      .from("auth_codes")
      .delete()
      .eq("telegram_id", telegram_id);

    // Save new code
    const { error: insertError } = await supabase
      .from("auth_codes")
      .insert({
        telegram_id,
        code,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      });

    if (insertError) {
      console.error("Error saving code:", insertError);
      throw new Error("Не удалось сохранить код");
    }

    // Send code via Telegram bot
    const message = `🔐 Ваш код для входа на сайт АН-30:\n\n<b>${code}</b>\n\nКод действителен 5 минут.`;
    
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegram_id,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResult.ok) {
      console.error("Telegram API error:", telegramResult);
      
      // Check if user hasn't started the bot
      if (telegramResult.description?.includes("chat not found") || 
          telegramResult.description?.includes("bot was blocked")) {
        return new Response(
          JSON.stringify({ 
            error: "Сначала напишите боту @an30pushbot в Telegram",
            need_start_bot: true 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("Не удалось отправить код в Telegram");
    }

    console.log("Code sent successfully to telegram_id:", telegram_id);

    return new Response(
      JSON.stringify({ success: true, message: "Код отправлен в Telegram" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Ошибка сервера" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
