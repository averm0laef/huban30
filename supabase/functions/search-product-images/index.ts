import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Use AI to generate a precise image search query
async function generateSearchQuery(productTitle: string, brand?: string, category?: string, sku?: string): Promise<string> {
  // If we have a SKU/article number, build a precise query
  if (sku && sku.trim()) {
    const skuClean = sku.trim();
    // Extract part type from title (e.g. "колодки", "фильтр") for context
    const partTypeMatch = productTitle.match(/(колодк|фильтр|ремень|свеч|диск|подшипник|амортизатор|насос|помп|генератор|стартер|радиатор|термостат|провод|масл|тормозн|сцеплен)/i);
    const partHint = partTypeMatch ? partTypeMatch[0].toLowerCase() : "";
    const parts = [skuClean];
    if (brand && brand.length > 2) parts.push(brand);
    if (partHint) parts.push(partHint);
    parts.push("купить");
    return parts.join(" ");
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return `${productTitle} автозапчасть фото`;

  try {
    const prompt = `Ты помощник интернет-магазина автозапчастей. Сгенерируй ОДИН точный поисковый запрос для поиска ФОТОГРАФИИ именно этой автозапчасти на маркетплейсах (Ozon, Wildberries).

Название товара: "${productTitle}"
${brand ? `Бренд: "${brand}"` : ""}
${category ? `Категория: "${category}"` : ""}

Правила:
- Запрос должен быть на русском языке
- Включи бренд и тип детали
- Если в названии есть артикул или номер модели (например BD-7595, W914/2) — ОБЯЗАТЕЛЬНО включи его в запрос
- Добавь слово "купить" чтобы найти товарные фото
- Запрос должен быть 3-8 слов
- Ответь ТОЛЬКО поисковым запросом, без пояснений`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const query = data.choices?.[0]?.message?.content?.trim();
      if (query && query.length > 3 && query.length < 100) {
        console.log(`AI query for "${productTitle}": "${query}"`);
        return query;
      }
    }
  } catch (e) {
    console.error("AI query generation error:", e);
  }

  return `${productTitle} автозапчасть купить`;
}

// Preferred image sources (marketplace product photos are highest quality)
const PREFERRED_DOMAINS = ["ozone.ru", "ozon.ru", "wildberries.ru", "wbbasket.ru", "avito.st", "exist.ru", "autodoc.ru", "emex.ru"];

function scoreImage(url: string, title: string): number {
  let score = 0;
  const lower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  
  // Prefer marketplace images
  for (const domain of PREFERRED_DOMAINS) {
    if (lower.includes(domain)) { score += 10; break; }
  }
  // Prefer larger images
  if (lower.includes("/c1000/") || lower.includes("1000x")) score += 3;
  if (lower.includes("/c500/") || lower.includes("500x")) score += 1;
  // Penalize small/irrelevant
  if (lower.includes("avatar") || lower.includes("logo") || lower.includes("banner") || lower.includes("icon") || lower.includes("emoji")) score -= 100;
  if (lower.includes("thumb") || lower.includes("50x50") || lower.includes("100x")) score -= 5;
  
  return score;
}

// Search images via DuckDuckGo
async function searchImagesViaScrape(query: string, limit: number): Promise<Array<{ url: string; title: string; source: string }>> {
  const results: Array<{ url: string; title: string; source: string; score: number }> = [];
  
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=['"]([^'"]+)['"]/);
    
    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const imageApiUrl = `https://duckduckgo.com/i.js?l=ru-ru&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`;
      
      const imgRes = await fetch(imageApiUrl, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://duckduckgo.com/"
        }
      });
      
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const imageResults = imgData.results || [];
        
        for (const img of imageResults.slice(0, limit * 3)) {
          if (img.image && img.image.startsWith("http")) {
            const s = scoreImage(img.image, img.title || "");
            if (s >= -10) { // skip obviously irrelevant
              results.push({
                url: img.image,
                title: img.title || query,
                source: img.source || "Bing",
                score: s
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("DuckDuckGo search error:", e);
  }
  
  // Sort by relevance score, return best
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(({ score, ...r }) => r);
}

// Fallback: search Wikimedia Commons
async function searchWikimedia(query: string, limit: number): Promise<Array<{ url: string; title: string; source: string }>> {
  const results: Array<{ url: string; title: string; source: string }> = [];
  try {
    const searchQuery = encodeURIComponent(`${query} car part automotive`);
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srnamespace=6&srlimit=${limit}&format=json&origin=*`;

    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "AN30-Store/1.0" }
    });

    if (response.ok) {
      const data = await response.json();
      const searchResults = data.query?.search || [];

      for (const result of searchResults.slice(0, limit)) {
        const title = result.title;
        if (!title) continue;

        try {
          const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
          const imgRes = await fetch(imageInfoUrl, { headers: { "User-Agent": "AN30-Store/1.0" } });

          if (imgRes.ok) {
            const imgData = await imgRes.json();
            const pages = imgData.query?.pages;
            if (pages) {
              for (const pageId of Object.keys(pages)) {
                const imageInfo = pages[pageId].imageinfo?.[0];
                if (imageInfo?.thumburl || imageInfo?.url) {
                  results.push({
                    url: imageInfo.thumburl || imageInfo.url,
                    title: title.replace("File:", "").replace(/\.[^/.]+$/, ""),
                    source: "Wikimedia Commons"
                  });
                }
              }
            }
          }
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    console.error("Wikimedia search error:", e);
  }
  return results;
}

// Proxy endpoint to fetch an image and return as base64
async function proxyImage(imageUrl: string): Promise<{ base64: string; contentType: string } | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/*"
      },
      redirect: "follow"
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    return { base64: `data:${contentType};base64,${base64}`, contentType };
  } catch (e) {
    console.error("Image proxy error for", imageUrl, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Proxy mode
    if (body.proxy_url) {
      const result = await proxyImage(body.proxy_url);
      if (result) {
        return new Response(
          JSON.stringify({ success: true, base64: result.base64 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to proxy image" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Search mode
    const { query, limit = 8, brand, category, sku, use_ai = false } = body;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use AI to refine query if requested (for bulk search)
    let searchQuery = query;
    if (use_ai) {
      searchQuery = await generateSearchQuery(query, brand, category, sku);
    } else {
      // Always append auto parts context
      if (!query.toLowerCase().includes("запчаст") && !query.toLowerCase().includes("автозапчаст")) {
        searchQuery = `${query} автозапчасть`;
      }
    }

    console.log("Searching images for:", searchQuery, "(original:", query, ")");

    // Primary: DuckDuckGo image search
    let images = await searchImagesViaScrape(searchQuery, limit);
    console.log(`DuckDuckGo found ${images.length} images`);

    // Fallback: Wikimedia if not enough
    if (images.length < limit) {
      const wikiImages = await searchWikimedia(searchQuery, limit - images.length);
      images = [...images, ...wikiImages];
    }

    // Deduplicate
    const unique = images
      .filter((item, index, self) => index === self.findIndex((t) => t.url === item.url))
      .slice(0, limit);

    console.log(`Returning ${unique.length} images`);

    return new Response(
      JSON.stringify({ success: true, images: unique, query: searchQuery }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error searching images:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to search images";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
