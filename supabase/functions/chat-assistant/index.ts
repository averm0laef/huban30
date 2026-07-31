import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_URL = "https://an30.lovable.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, conversationHistory, productContext, threadId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if user wants to close chat
    const closeKeywords = ['закр', 'заверш', 'до свидан', 'пока', 'спасибо заверш', 'хватит', 'всё спасибо', 'все спасибо', 'закончи'];
    const lowerMessage = message.toLowerCase().trim();
    const wantsClose = closeKeywords.some((kw: string) => lowerMessage.includes(kw));

    if (wantsClose && threadId) {
      // Close the chat
      await supabase
        .from('chat_threads')
        .update({ status: 'closed' })
        .eq('id', threadId);

      return new Response(
        JSON.stringify({ 
          reply: "Чат завершён! 🔧 Спасибо за обращение!\nЕсли возникнут вопросы — просто начните новый чат. Хорошего дня! 👋",
          action: 'close_chat'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Search for relevant products if the message mentions parts
    let productResults = "";
    let foundProducts: Array<{ id: string; title: string; price: number; brand: string | null; sku: string | null; availability_status: string }> = [];
    try {
      // Simple product search - extract keywords
      const searchTerms = message.toLowerCase()
        .replace(/[^\wа-яё\s]/gi, '')
        .split(/\s+/)
        .filter((w: string) => w.length > 2);

      if (searchTerms.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, title, price, sku, availability_status, brand')
          .eq('is_published', true)
          .or(`title.ilike.%${searchTerms[0]}%${searchTerms[1] ? `,title.ilike.%${searchTerms[1]}%` : ''}`)
          .limit(5);

        if (products && products.length > 0) {
          foundProducts = products;
          productResults = "\n\nНайденные товары в базе (ОБЯЗАТЕЛЬНО покажи их клиенту со ссылками):\n" + products.map(p => 
            `- **[${p.title}](${SITE_URL}/catalog/product/${p.id})**${p.brand ? ` (${p.brand})` : ''} — ${p.price.toLocaleString('ru-RU')} ₽ ${p.availability_status === 'in_stock' ? '✅ В наличии' : p.availability_status === 'on_order' ? '📦 Под заказ' : '❌ Нет в наличии'}${p.sku ? ` | Артикул: ${p.sku}` : ''}`
          ).join('\n');
        }
      }
    } catch (e) {
      console.error("Product search error:", e);
    }

    // Build conversation messages
    const messages: { role: string; content: string }[] = [
      {
        role: "system",
        content: `Ты — **Свечка**, виртуальный помощник магазина автозапчастей **АН-30** в Чернышевске.
Твоя задача — помогать клиентам и отвечать на вопросы до подключения живого менеджера.

## Информация о магазине
- **Адрес:** Чернышевск, ул. Куйбышева, 118А
- **Телефон:** +7 (924) 474-26-05
- **Режим работы:** Ежедневно с 9:00 до 19:00 (по читинскому времени)
- **Контакты:** ВКонтакте, WhatsApp, Telegram
- **Сайт:** ${SITE_URL}

## База знаний (FAQ)

### Доставка
- Доставка по Чернышевску — бесплатно при заказе от 3000 ₽
- Доставка по России — транспортными компаниями (СДЭК, ПЭК, Деловые линии)
- Срок доставки по городу — в течение дня
- По России — 3-7 рабочих дней в зависимости от региона

### Возврат и гарантия
- Возврат товара надлежащего качества — в течение 14 дней с момента покупки
- Товар должен сохранить товарный вид, не быть в эксплуатации
- Гарантия на запчасти — по условиям производителя
- Для возврата необходим чек или товарная накладная

### Оплата
- Наличные в магазине
- Банковская карта
- Перевод на карту (по согласованию)

### Подбор запчастей
- Для точного подбора нужен **VIN-номер** автомобиля
- Также можно искать по артикулу (номеру детали)
- Если не знаете артикул — опишите, какая деталь нужна и для какого авто

${productContext ? `\n### Контекст товара (клиент сейчас смотрит):\n- **[${productContext.title}](${SITE_URL}/catalog/product/${productContext.id})** — ${productContext.price?.toLocaleString('ru-RU')} ₽\n` : ''}

${productResults}

## Правила ответа
1. Отвечай **кратко и дружелюбно** по-русски
2. Используй **markdown** для форматирования: жирный текст, списки
3. Если нашёл товары в базе — **ОБЯЗАТЕЛЬНО** покажи их клиенту в формате: **[Название товара](ссылка)** — цена ₽ статус
4. Ссылки на товары формируй так: ${SITE_URL}/catalog/product/{id товара}
5. Если не можешь ответить на вопрос (цена конкретного товара, сложный подбор) — вежливо сообщи, что менеджер скоро подключится
6. **Никогда не пиши** фразы или плейсхолдеры вида: [Позвать менеджера], [Кнопка], [Button]
7. Не выдумывай цены и наличие — используй только данные из базы
8. Максимальная длина ответа — 300 слов
9. Если клиент хочет завершить чат, попрощаться — ответь дружелюбно и скажи что закрываешь чат, поблагодари за обращение`
      }
    ];

    // Add conversation history (last 10 messages)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text || msg.content || ''
        });
      }
    }

    // Add current message
    messages.push({ role: "user", content: message });

    console.log("Processing chat message:", message, "with", messages.length, "context messages");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Слишком много запросов. Подождите немного." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Сервис временно недоступен." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const rawReply = data.choices?.[0]?.message?.content || "Извините, не удалось получить ответ.";
    const reply = rawReply
      .replace(/\*\*\s*\[\s*позвать\s+менеджера\s*\]\s*\*\*/gi, "")
      .replace(/\[\s*позвать\s+менеджера\s*\]\([^\)]*\)/gi, "")
      .replace(/\[\s*позвать\s+менеджера\s*\]/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || "Извините, не удалось получить ответ.";

    console.log("AI response:", reply);

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("chat-assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
