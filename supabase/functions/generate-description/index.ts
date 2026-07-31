import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title, brand, sku, generate_title } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: "title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const results: Record<string, string> = {};

    // Generate display_title if requested
    if (generate_title !== false) {
      const titlePrompt = `Ты — редактор интернет-магазина автозапчастей. Преобразуй техническое название товара в читабельное для покупателя.

Техническое название: "${title}"
${brand ? `Бренд: "${brand}"` : ""}
${sku ? `Артикул: "${sku}"` : ""}

Правила:
- Убери КАПС (ЗАГЛАВНЫЕ БУКВЫ) — напиши нормальным регистром
- Убери внутренние коды, номера партий, служебные пометки
- Сохрани бренд, модель, ключевые характеристики детали
- Название должно быть 3-10 слов
- Не добавляй артикул в название
- Пиши на русском языке
- Верни ТОЛЬКО название, без кавычек и пояснений`;

      const titleResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{ role: "user", content: titlePrompt }],
        }),
      });

      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        const displayTitle = titleData.choices?.[0]?.message?.content?.trim() || "";
        if (displayTitle) results.display_title = displayTitle;
      } else if (titleResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (titleResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Generate description
    const descPrompt = `Ты — копирайтер интернет-магазина автозапчастей. Напиши краткое, фактологическое описание товара для карточки.

Название товара: "${title}"
${brand ? `Бренд: "${brand}"` : ""}
${sku ? `Артикул: "${sku}"` : ""}

Правила:
- Описание должно быть 2-4 предложения (50-120 слов)
- Только проверенные факты — НЕ выдумывай характеристики которых не знаешь наверняка
- Напиши для какого типа автомобилей/двигателей подходит если это очевидно из названия
- Укажи материал или технологию если это общеизвестно для данного типа запчасти
- Не используй маркетинговые клише ("премиальное качество", "лучший выбор")
- Пиши на русском языке, простым понятным языком
- Начни сразу с описания, без заголовка`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: descPrompt }],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "Ошибка генерации" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || "";
    results.description = description;

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-description error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
