import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!botToken || !chatId) {
      return new Response(JSON.stringify({ error: "Telegram not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const timezone = 'Asia/Chita';

    // Chats created today
    const { count: newChats } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStr);

    // Active (unclosed) chats
    const { count: activeChats } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'closed');

    // Closed today
    const { count: closedChats } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'closed')
      .gte('last_message_at', todayStr);

    // Unrated closed chats (waiting for rating)
    const { count: unratedChats } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'closed')
      .is('rating', null)
      .gte('created_at', todayStr);

    // Orders today
    const { count: newOrders } = await supabase
      .from('cart_orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStr);

    // Contact requests today  
    const { count: newRequests } = await supabase
      .from('contact_requests')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStr);

    // Unprocessed contact requests
    const { count: pendingRequests } = await supabase
      .from('contact_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new');

    // Page views today
    const { count: pageViews } = await supabase
      .from('page_views')
      .select('*', { count: 'exact', head: true })
      .gte('viewed_at', todayStr);

    // Messages today
    const { count: totalMessages } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStr);

    const timestamp = today.toLocaleString('ru-RU', { timeZone: timezone });

    const summary = [
      `📊 *Дневная сводка — ${today.toLocaleDateString('ru-RU', { timeZone: timezone })}*`,
      ``,
      `💬 *Чаты:*`,
      `  🆕 Новых: *${newChats || 0}*`,
      `  🟢 Активных: *${activeChats || 0}*`,
      `  ✅ Закрыто: *${closedChats || 0}*`,
      unratedChats ? `  ⭐ Без оценки: *${unratedChats}*` : null,
      `  💬 Сообщений: *${totalMessages || 0}*`,
      ``,
      `🛒 *Заказы:*`,
      `  📦 Новых: *${newOrders || 0}*`,
      ``,
      `📩 *Заявки:*`,
      `  📋 Сегодня: *${newRequests || 0}*`,
      pendingRequests ? `  ⚠️ Необработанных: *${pendingRequests}*` : null,
      ``,
      `👀 *Посещения:*`,
      `  📄 Просмотров: *${pageViews || 0}*`,
      ``,
      `⏰ ${timestamp}`,
    ].filter(Boolean).join("\n");

    const siteUrl = Deno.env.get("SITE_URL") || 'https://an30.lovable.app';
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: "📊 Панель управления", url: `${siteUrl}/admin` }],
      ],
    };

    const result = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: summary,
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      }),
    });

    const telegramResult = await result.json();

    return new Response(
      JSON.stringify({ success: telegramResult.ok }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in daily-summary:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
