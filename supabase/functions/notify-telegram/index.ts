import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotifyRequest {
  threadId?: string;
  message?: string;
  userName?: string;
  imageUrl?: string;
  action?: 'auth_success' | 'notify_user' | 'new_order' | 'new_contact_request' | 'import_complete' | 'invoice_exported';
  // For invoice_exported
  invoiceCount?: number;
  totalItems?: number;
  invoiceType?: string;
  telegramId?: string;
  // For new_order
  name?: string;
  // For import_complete
  importSource?: string;
  importCreated?: number;
  importUpdated?: number;
  importErrors?: number;
  phone?: string;
  email?: string;
  total?: number;
  itemsCount?: number;
  items?: Array<{ title: string; price: number; quantity: number; sku?: string }>;
  comment?: string;
  // For new_contact_request
  contactMessage?: string;
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string, parseMode = "Markdown", replyMarkup?: unknown) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return response.json();
}

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
      console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID");
      return new Response(
        JSON.stringify({ error: "Telegram not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: NotifyRequest = await req.json();

    // ===== NEW ORDER =====
    if (body.action === 'new_order') {
      console.log("New order notification:", body);

      let itemsList = "";
      if (body.items && body.items.length > 0) {
        itemsList = body.items.map((item, i) => 
          `  ${i + 1}. ${item.title}${item.sku ? ` (${item.sku})` : ''} — ${item.quantity} шт. × ${item.price?.toLocaleString('ru-RU')} ₽`
        ).join("\n");
      }

      const orderMessage = [
        `🛒 *НОВЫЙ ЗАКАЗ С САЙТА!*`,
        ``,
        `👤 *Клиент:* ${body.name || 'Не указано'}`,
        `📱 *Телефон:* ${body.phone || 'Не указан'}`,
        body.email ? `📧 *Email:* ${body.email}` : null,
        ``,
        `📦 *Товары (${body.itemsCount || 0} шт.):*`,
        itemsList || '  Список не указан',
        ``,
        `💰 *Сумма: ${body.total?.toLocaleString('ru-RU') || 0} ₽*`,
        body.comment ? `\n💬 *Комментарий:* ${body.comment}` : null,
        ``,
        `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Chita' })}`,
      ].filter(Boolean).join("\n");

      const result = await sendTelegramMessage(botToken, chatId, orderMessage);
      console.log("Order notification result:", result);

      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== NEW CONTACT REQUEST =====
    if (body.action === 'new_contact_request') {
      console.log("New contact request notification:", body);

      const contactMessage = [
        `📩 *НОВАЯ ЗАЯВКА С САЙТА!*`,
        ``,
        `👤 *Имя:* ${body.name || 'Не указано'}`,
        `📱 *Телефон:* ${body.phone || 'Не указан'}`,
        body.email ? `📧 *Email:* ${body.email}` : null,
        ``,
        `💬 *Сообщение:*`,
        body.contactMessage || 'Не указано',
        ``,
        `⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Chita' })}`,
      ].filter(Boolean).join("\n");

      const result = await sendTelegramMessage(botToken, chatId, contactMessage);
      console.log("Contact request notification result:", result);

      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== IMPORT COMPLETE =====
    if (body.action === 'import_complete') {
      console.log("Import complete notification:", body);

      const source = body.importSource || '1С';
      const created = body.importCreated || 0;
      const updated = body.importUpdated || 0;
      const errors = body.importErrors || 0;
      const total = created + updated;
      const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Chita' });

      const lines = [
        `📦 *Импорт из ${source} завершён!*`,
        ``,
        total > 0 ? `✅ Обработано: *${total}* товаров` : `⚠️ Товары не обработаны`,
        created > 0 ? `  🆕 Создано: *${created}*` : null,
        updated > 0 ? `  🔄 Обновлено: *${updated}*` : null,
        errors > 0 ? `  ❌ Ошибок: *${errors}*` : null,
        ``,
        `🕐 Товары ожидают проверки в разделе «Импорт из 1С»`,
        `⏰ ${timestamp}`,
      ].filter(Boolean).join("\n");

      const siteUrl = Deno.env.get("SITE_URL") || 'https://an30.lovable.app';
      const inlineKeyboard = {
        inline_keyboard: [[{ text: "📋 Открыть staging", url: `${siteUrl}/admin/staging` }]],
      };

      const result = await sendTelegramMessage(botToken, chatId, lines, "Markdown", inlineKeyboard);
      console.log("Import notification result:", result);

      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== INVOICE EXPORTED =====
    if (body.action === 'invoice_exported') {
      console.log("Invoice exported notification:", body);
      const typeLabel = body.invoiceType === 'incoming' ? 'приходных' : 'расходных';
      const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Chita' });
      const lines = [
        `📄 *Экспорт накладных в 1С!*`,
        ``,
        `📋 Экспортировано: *${body.invoiceCount || 0}* ${typeLabel} накладных`,
        `📦 Позиций: *${body.totalItems || 0}*`,
        ``,
        `⏰ ${timestamp}`,
      ].join("\n");

      const siteUrl = Deno.env.get("SITE_URL") || 'https://an30.lovable.app';
      const inlineKeyboard = {
        inline_keyboard: [[{ text: "📄 Открыть накладные", url: `${siteUrl}/admin/invoices` }]],
      };

      const result = await sendTelegramMessage(botToken, chatId, lines, "Markdown", inlineKeyboard);
      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== AUTH SUCCESS =====
    if (body.action === 'auth_success' && body.telegramId) {
      console.log("Sending auth success notification to Telegram ID:", body.telegramId);
      
      const successMessage = `✅ *Авторизация успешна!*\n\nВы успешно вошли на сайт АН-30.\n\n🛒 Приятных покупок!`;
      const result = await sendTelegramMessage(botToken, body.telegramId, successMessage);
      console.log("Auth success notification result:", result);

      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== NOTIFY USER =====
    if (body.action === 'notify_user' && body.threadId) {
      console.log("Notifying user about new admin message for thread:", body.threadId);
      
      const { data: thread } = await supabase
        .from('chat_threads')
        .select('user_id')
        .eq('id', body.threadId)
        .single();
      
      if (!thread?.user_id) {
        return new Response(
          JSON.stringify({ success: false, reason: 'no_user_id' }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_id, full_name')
        .eq('user_id', thread.user_id)
        .single();

      if (!profile?.telegram_id) {
        return new Response(
          JSON.stringify({ success: false, reason: 'no_telegram_id' }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const siteUrl = Deno.env.get("SITE_URL") || 'https://an30.lovable.app';
      const chatUrl = `${siteUrl}/chat`;
      
      const userNotification = `💬 *Новое сообщение от менеджера АН-30!*\n\n${body.message || 'У вас новое сообщение в чате.'}`;
      
      const inlineKeyboard = {
        inline_keyboard: [[{ text: "💬 Открыть чат", url: chatUrl }]],
      };
      
      const result = await sendTelegramMessage(botToken, profile.telegram_id, userNotification, "Markdown", inlineKeyboard);
      console.log("User notification result:", result);

      return new Response(
        JSON.stringify({ success: result.ok }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== CHAT MESSAGE (default) =====
    const { threadId, message, userName, imageUrl } = body;
    
    if (!threadId || !message) {
      return new Response(
        JSON.stringify({ error: "Missing threadId or message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Sending Telegram notification:", { threadId, message, userName, hasImage: !!imageUrl });

    const displayName = userName || "Гость";
    
    const { data: existingMapping } = await supabase
      .from('telegram_thread_mapping')
      .select('telegram_topic_id')
      .eq('chat_thread_id', threadId)
      .maybeSingle();

    let messageThreadId: number | null = existingMapping?.telegram_topic_id || null;

    if (!messageThreadId) {
      console.log("Creating new Telegram topic for thread:", threadId);
      
      const topicName = `💬 ${displayName} — ${new Date().toLocaleDateString('ru-RU')}`;
      
      const createTopicResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/createForumTopic`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            name: topicName,
            icon_color: 7322096,
          }),
        }
      );

      const topicResult = await createTopicResponse.json();
      console.log("Create topic response:", topicResult);

      if (topicResult.ok && topicResult.result?.message_thread_id) {
        messageThreadId = topicResult.result.message_thread_id;
        
        await supabase
          .from('telegram_thread_mapping')
          .insert({
            chat_thread_id: threadId,
            telegram_topic_id: messageThreadId,
          });
      }
    }

    let clientInfo = "";
    if (!existingMapping) {
      const { data: thread } = await supabase
        .from('chat_threads')
        .select('user_id, guest_session_id, created_at')
        .eq('id', threadId)
        .single();

      if (thread?.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, phone')
          .eq('user_id', thread.user_id)
          .single();
        
        if (profile) {
          clientInfo = `\n\n📋 *Клиент:* ${profile.full_name || 'Не указано'}\n`;
          if (profile.email) clientInfo += `📧 ${profile.email}\n`;
          if (profile.phone) clientInfo += `📱 ${profile.phone}`;
        }
      } else {
        clientInfo = `\n\n🏷 _Гость_`;
      }
    }

    const telegramMessage = `👤 *${displayName}*\n\n${message}${clientInfo}`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "ℹ️ Инфо", callback_data: `info:${threadId}` },
          { text: "📜 История", callback_data: `history:${threadId}` },
        ],
        [{ text: "❌ Закрыть чат", callback_data: `close:${threadId}` }],
      ],
    };

    if (imageUrl) {
      const sendPhotoBody: Record<string, unknown> = {
        chat_id: chatId,
        photo: imageUrl,
        caption: telegramMessage,
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      };
      if (messageThreadId) sendPhotoBody.message_thread_id = messageThreadId;

      const photoResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sendPhotoBody) }
      );
      const photoResult = await photoResponse.json();

      if (photoResult.ok) {
        return new Response(
          JSON.stringify({ success: true, topicId: messageThreadId }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const sendMessageBody: Record<string, unknown> = {
      chat_id: chatId,
      text: telegramMessage,
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard,
    };
    if (messageThreadId) sendMessageBody.message_thread_id = messageThreadId;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sendMessageBody) }
    );
    const telegramResult = await telegramResponse.json();

    if (!telegramResult.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to send Telegram notification", details: telegramResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, topicId: messageThreadId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in notify-telegram function:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
