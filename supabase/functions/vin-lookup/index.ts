import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vin, partDescription, carDescription } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!partDescription?.trim() && !vin?.trim() && !carDescription?.trim()) {
      return new Response(
        JSON.stringify({ error: "Укажите VIN, марку/модель или описание детали" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Ты — эксперт по автозапчастям и каталогам. Твоя задача — помочь менеджеру магазина автозапчастей подобрать артикулы деталей.

## Что ты умеешь:
1. **Расшифровка VIN** — определить марку, модель, год выпуска, двигатель, комплектацию
2. **Подбор артикулов** — дать OEM-артикулы (оригинал) и аналоги от популярных производителей
3. **Кросс-референс** — показать взаимозаменяемые артикулы разных брендов

## Формат ответа (СТРОГО соблюдай):

### 🚗 Автомобиль
Если указан VIN — расшифруй его. Если указана марка/модель — подтверди.

### 🔧 Деталь: [название]

### 📋 Артикулы

**OEM (оригинал):**
| Бренд | Артикул | Примечание |
|-------|---------|------------|
| Toyota | 04465-33471 | Оригинал |

**Аналоги (aftermarket):**
| Бренд | Артикул | Примечание |
|-------|---------|------------|
| TRW | GDB3429 | Премиум аналог |
| Nisshinbo | NP1098 | Бюджетный |
| Akebono | AN-780WK | Японское качество |

### 💡 Рекомендации
Краткие советы по выбору.

## Правила:
- Давай РЕАЛЬНЫЕ артикулы, которые существуют в каталогах
- Если не уверен в артикуле — укажи это явно: "⚠️ Требует проверки"
- Всегда указывай минимум 3-5 аналогов от разных производителей
- Приоритетные бренды аналогов: TRW, Bosch, Denso, NGK, Mann, Mahle, Sachs, Lemförder, Febi, Nisshinbo, Akebono, Masuma, SAT
- Если VIN неполный или некорректный — скажи об этом
- Отвечай на русском языке
- Если описание детали расплывчатое — попроси уточнить`;

    let userMessage = "";
    if (vin?.trim()) {
      userMessage += `VIN-номер: ${vin.trim()}\n`;
    }
    if (carDescription?.trim()) {
      userMessage += `Автомобиль: ${carDescription.trim()}\n`;
    }
    if (partDescription?.trim()) {
      userMessage += `Нужная деталь: ${partDescription.trim()}\n`;
    }

    console.log("VIN lookup request:", userMessage);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
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
    const result = data.choices?.[0]?.message?.content || "Не удалось получить результат.";

    console.log("VIN lookup result length:", result.length);

    return new Response(
      JSON.stringify({ result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("vin-lookup error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
