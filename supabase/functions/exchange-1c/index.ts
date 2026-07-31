import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { getClientIp, isAllowedOneCClient, secretsEqual } from "../_shared/security.ts";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

// In-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_REQUESTS_PER_WINDOW;
}

function sanitizeString(str: string | null | undefined, maxLen = 500): string | null {
  if (!str) return null;
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
    .substring(0, maxLen);
}

// Parse XML helper
function parseXMLValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseXMLArray(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

interface ParsedProduct {
  guid: string;
  name: string;
  sku?: string;
  description?: string;
  categoryGuid?: string;
  brand?: string;
  images?: string[];
}

interface ParsedOffer {
  guid: string;
  price: number;
  oldPrice?: number;
  stockQty: number;
}

function parseCatalogXML(xml: string): { products: ParsedProduct[]; categories: Map<string, string> } {
  const products: ParsedProduct[] = [];
  const categories = new Map<string, string>();

  console.log("Parsing catalog XML, length:", xml.length);

  function parseGroups(content: string) {
    const groupBlocks = parseXMLArray(content, 'Группа');
    for (const group of groupBlocks) {
      const id = parseXMLValue(group, 'Ид');
      const name = parseXMLValue(group, 'Наименование');
      if (id && name) {
        categories.set(id, sanitizeString(name, 200) || name);
      }
      if (group.includes('<Группы>')) {
        const nestedMatch = group.match(/<Группы>([\s\S]*?)<\/Группы>/i);
        if (nestedMatch) parseGroups(nestedMatch[1]);
      }
    }
  }

  const groupsMatch = xml.match(/<Группы>([\s\S]*?)<\/Группы>/i);
  if (groupsMatch) parseGroups(groupsMatch[1]);

  const productsSection = xml.match(/<Товары>([\s\S]*?)<\/Товары>/i);
  if (productsSection) {
    const productBlocks = parseXMLArray(productsSection[1], 'Товар');
    console.log(`Found ${productBlocks.length} product blocks`);
    
    for (const productXml of productBlocks) {
      const guid = parseXMLValue(productXml, 'Ид');
      const rawName = parseXMLValue(productXml, 'Наименование');
      if (!guid || !rawName) continue;

      const product: ParsedProduct = {
        guid: sanitizeString(guid, 100)!,
        name: sanitizeString(rawName, 300)!,
        sku: sanitizeString(parseXMLValue(productXml, 'Артикул'), 100) || undefined,
        description: sanitizeString(parseXMLValue(productXml, 'Описание'), 5000) || undefined,
      };

      const categoryMatch = productXml.match(/<Группы>[\s\S]*?<Ид>([^<]+)<\/Ид>[\s\S]*?<\/Группы>/i);
      if (categoryMatch) product.categoryGuid = categoryMatch[1];

      const brandMatch = productXml.match(/<Свойство>[\s\S]*?<Наименование>Бренд<\/Наименование>[\s\S]*?<Значение>([^<]+)<\/Значение>[\s\S]*?<\/Свойство>/i);
      if (brandMatch) product.brand = sanitizeString(brandMatch[1], 100) || undefined;

      const imagesMatch = productXml.match(/<Картинка>([^<]+)<\/Картинка>/gi);
      if (imagesMatch) {
        product.images = imagesMatch
          .map(img => img.match(/<Картинка>([^<]+)<\/Картинка>/i)?.[1] || '')
          .filter(url => url.length > 0 && url.length < 2000)
          .slice(0, 20);
      }

      products.push(product);
    }
  }

  console.log(`Parsed ${products.length} products, ${categories.size} categories`);
  return { products, categories };
}

function parseOffersXML(xml: string): ParsedOffer[] {
  const offers: ParsedOffer[] = [];

  const offersSection = xml.match(/<Предложения>([\s\S]*?)<\/Предложения>/i);
  if (offersSection) {
    const offerBlocks = parseXMLArray(offersSection[1], 'Предложение');
    
    for (const offerXml of offerBlocks) {
      const guid = parseXMLValue(offerXml, 'Ид');
      if (!guid) continue;

      const productGuid = guid.includes('#') ? guid.split('#')[0] : guid;

      let price = 0;
      let oldPrice: number | undefined;
      
      const priceBlocks = parseXMLArray(offerXml, 'Цена');
      for (const priceXml of priceBlocks) {
        const priceTypeId = parseXMLValue(priceXml, 'ИдТипаЦены');
        const priceValue = Math.max(0, parseFloat(parseXMLValue(priceXml, 'ЦенаЗаЕдиницу') || '0') || 0);
        
        if (!price || priceTypeId?.toLowerCase().includes('розн')) price = priceValue;
        if (priceTypeId?.toLowerCase().includes('стар') || priceTypeId?.toLowerCase().includes('срав')) oldPrice = priceValue;
      }

      let stockQty = 0;
      const quantityMatch = parseXMLValue(offerXml, 'Количество');
      if (quantityMatch) stockQty = Math.max(0, parseInt(quantityMatch) || 0);

      const stocksSection = offerXml.match(/<Остатки>([\s\S]*?)<\/Остатки>/i);
      if (stocksSection) {
        const qtyMatch = parseXMLValue(stocksSection[1], 'Количество');
        if (qtyMatch) stockQty = Math.max(0, parseInt(qtyMatch) || 0);
      }

      offers.push({
        guid: productGuid,
        price,
        oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
        stockQty,
      });
    }
  }

  console.log(`Parsed ${offers.length} offers`);
  return offers;
}

async function processXMLContent(xml: string, supabase: any): Promise<{ created: number; updated: number; errors: string[] }> {
  const results = { created: 0, updated: 0, errors: [] as string[] };

  if (!xml || (!xml.includes("<?xml") && !xml.includes("<КоммерческаяИнформация"))) {
    return results;
  }

  if (xml.includes("<Каталог") || xml.includes("<Товары>")) {
    const { products, categories } = parseCatalogXML(xml);

    const categoryMapping = new Map<string, string>();
    
    for (const [guid1c, name] of categories) {
      const { data: existing } = await supabase
        .from("categories")
        .select("id")
        .eq("name", name)
        .maybeSingle();

      if (existing) {
        categoryMapping.set(guid1c, existing.id);
      } else {
        const slug = name.toLowerCase()
          .replace(/[^a-zа-яё0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .substring(0, 50);
        
        const { data: newCat } = await supabase
          .from("categories")
          .insert({ name, slug: slug || `cat-${Date.now()}`, is_enabled: true })
          .select("id")
          .single();
        
        if (newCat) categoryMapping.set(guid1c, newCat.id);
      }
    }

    for (const product of products) {
      try {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("guid_1c", product.guid)
          .maybeSingle();

        // Check if 1C description is meaningful (not just audit notes)
        const desc1c = product.description?.trim() || null;
        const isAuditNote = desc1c && /^аудит\s/i.test(desc1c);
        
        const productData: Record<string, any> = {
          guid_1c: product.guid,
          title: product.name,
          sku: product.sku || null,
          brand: product.brand || null,
          category_id: product.categoryGuid ? categoryMapping.get(product.categoryGuid) || null : null,
          is_published: false,
          updated_at: new Date().toISOString(),
        };

        // Only set description if it's meaningful (not audit notes)
        // For new products: always set; for existing: only overwrite if 1C has real content
        if (!isAuditNote && desc1c) {
          productData.description = desc1c;
        }

        if (existing) {
          // Don't overwrite existing description with empty/audit data
          if (!desc1c || isAuditNote) {
            delete productData.description;
          }
          await supabase.from("products").update(productData).eq("id", existing.id);
          results.updated++;
        } else {
          const { data: newProd, error } = await supabase
            .from("products")
            .insert({ ...productData, price: 0, stock_qty: 0, availability_status: 'none' })
            .select("id")
            .single();
          
          if (error) {
            results.errors.push(`${product.guid}: ${error.message}`);
          } else {
            results.created++;
            if (newProd && product.images?.length) {
              await supabase.from("product_images").insert(
                product.images.map((url, i) => ({ product_id: newProd.id, url, sort_order: i }))
              );
            }
          }
        }
      } catch (err: any) {
        results.errors.push(`${product.guid}: ${err?.message}`);
      }
    }
  }

  if (xml.includes("<Предложения>") || xml.includes("<ПакетПредложений>")) {
    const offers = parseOffersXML(xml);

    for (const offer of offers) {
      try {
        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("guid_1c", offer.guid)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("products")
            .update({
              price: offer.price,
              old_price: offer.oldPrice || null,
              stock_qty: offer.stockQty,
              availability_status: offer.stockQty > 0 ? 'in_stock' : 'none',
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          results.updated++;
        }
      } catch (err: any) {
        results.errors.push(`${offer.guid}: ${err?.message}`);
      }
    }
  }

  return results;
}

function getSessionId(req: Request): string {
  const url = new URL(req.url);
  const urlSessionId = url.searchParams.get("sessid") || url.searchParams.get("PHPSESSID");
  if (urlSessionId) return urlSessionId;
  
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/PHPSESSID=([^;]+)/) || 
                cookie.match(/sessid=([^;]+)/) || 
                cookie.match(/1c_exchange=([^;]+)/);
  return match ? match[1] : "default";
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req, {
    allowedHeaders: "authorization, x-client-info, apikey, content-type, cookie",
    allowCredentials: true,
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIP = getClientIp(req);

  if (!isAllowedOneCClient(req)) {
    console.warn(`Rejected 1C exchange from non-allowlisted IP: ${clientIP}`);
    return new Response("failure\nForbidden", {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    console.warn(`Rate limit exceeded for IP: ${clientIP}`);
    return new Response("failure\nRate limit exceeded", {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "catalog";
  const mode = url.searchParams.get("mode") || "";
  const filename = url.searchParams.get("filename") || "";

  console.log(`1C exchange request: type=${type}, mode=${mode}, IP=${clientIP}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: settings } = await supabase
    .from("store_settings")
    .select("exchange_login, exchange_password")
    .limit(1)
    .maybeSingle();

  const validLogin = settings?.exchange_login;
  const validPassword = settings?.exchange_password;

  // Require configured credentials
  if (!validLogin || !validPassword) {
    console.error("Exchange credentials not configured in store_settings");
    return new Response("failure\nExchange not configured", {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const authHeader = req.headers.get("authorization");
    let login = "";
    let password = "";

    if (authHeader?.startsWith("Basic ")) {
      try {
        const credentials = atob(authHeader.substring(6));
        const separator = credentials.indexOf(":");
        if (separator >= 0) {
          login = credentials.slice(0, separator);
          password = credentials.slice(separator + 1);
        }
      } catch {
        // The generic authentication failure below avoids leaking parsing details.
      }
    }

    const authenticated = login.length > 0
      && password.length > 0
      && await secretsEqual(login, validLogin)
      && await secretsEqual(password, validPassword);

    if (!authenticated) {
      console.warn(`1C exchange authentication failed from IP: ${clientIP}`);
      return new Response("failure", {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=windows-1251",
          "WWW-Authenticate": 'Basic realm="1C"',
        },
      });
    }

    // === CHECKAUTH ===
    if (mode === "checkauth") {

      const sessionId = crypto.randomUUID();
      const timestamp = Math.floor(Date.now() / 1000);
      
      await supabase.from("exchange_files").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
      
      console.log(`1C exchange authenticated from IP: ${clientIP}`);

      const responseBody = `success\nsessid\n${sessionId}\nsessid=${sessionId}\n${timestamp}`;
      
      return new Response(responseBody, {
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/plain; charset=windows-1251",
          "Set-Cookie": `sessid=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Strict`,
        },
      });
    }

    // === INIT ===
    if (mode === "init") {
      const sessionId = getSessionId(req);
      const responseBody = `zip=no\nfile_limit=0\nsessid=${sessionId}\nversion=2.10`;
      return new Response(responseBody, {
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // === FILE ===
    if (mode === "file") {
      const sessionId = getSessionId(req);
      let body = "";
      
      try {
        body = await req.text();
      } catch (e) {
        console.error("Failed to read body:", e);
      }
      
      // File size check
      if (body.length > MAX_FILE_SIZE) {
        console.warn(`File too large from IP ${clientIP}: ${body.length} bytes`);
        return new Response("failure\nFile too large", {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      console.log(`1C file upload: size=${body.length}, IP=${clientIP}`);

      if (body && body.length > 0) {
        // Limit files per session (max 20)
        const { count } = await supabase
          .from("exchange_files")
          .select("*", { count: 'exact', head: true })
          .eq("session_id", sessionId);

        if ((count || 0) >= 20) {
          console.warn(`1C file limit exceeded from IP: ${clientIP}`);
          return new Response("failure\nToo many files", {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        const { error } = await supabase
          .from("exchange_files")
          .insert({ session_id: sessionId, filename, content: body });
        
        if (error) console.error("Failed to store file:", error.message);
      }

      return new Response("success", {
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // === IMPORT ===
    if (mode === "import") {
      const sessionId = getSessionId(req);
      console.log(`1C import started from IP: ${clientIP}`);
      
      const totalResults = { created: 0, updated: 0, errors: [] as string[] };

      const { data: files } = await supabase
        .from("exchange_files")
        .select("filename, content")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (files && files.length > 0) {
        console.log(`Processing ${files.length} stored files`);
        
        const sortedFiles = files.sort((a, b) => {
          if (a.filename.includes('import')) return -1;
          if (b.filename.includes('import')) return 1;
          return 0;
        });

        for (const file of sortedFiles) {
          const results = await processXMLContent(file.content, supabase);
          totalResults.created += results.created;
          totalResults.updated += results.updated;
          totalResults.errors.push(...results.errors);
        }

        await supabase.from("exchange_files").delete().eq("session_id", sessionId);
      }

      // Log exchange
      await supabase.from("exchange_logs").insert({
        session_id: sessionId,
        status: totalResults.errors.length > 0 ? "completed" : "completed",
        exchange_type: "catalog",
        products_created: totalResults.created,
        products_updated: totalResults.updated,
        errors_count: totalResults.errors.length,
        error_details: totalResults.errors.length > 0 ? { errors: totalResults.errors.slice(0, 50) } : null,
        file_count: files?.length || 0,
        completed_at: new Date().toISOString(),
      });

      console.log(`=== Import Results: created=${totalResults.created}, updated=${totalResults.updated}, errors=${totalResults.errors.length}, IP=${clientIP} ===`);

      // Send Telegram notification
      if (totalResults.created > 0 || totalResults.updated > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              action: "import_complete",
              importSource: "1С (CommerceML)",
              importCreated: totalResults.created,
              importUpdated: totalResults.updated,
              importErrors: totalResults.errors.length,
            }),
          });
        } catch (e) {
          console.error("Failed to send Telegram notification:", e);
        }
      }

      return new Response(`success\nСоздано: ${totalResults.created}, Обновлено: ${totalResults.updated}`, {
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // === QUERY ===
    if (mode === "query") {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="${new Date().toISOString()}">
</КоммерческаяИнформация>`, {
        headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" },
      });
    }

    // === SUCCESS ===
    if (mode === "success") {
      const sessionId = getSessionId(req);
      await supabase.from("exchange_files").delete().eq("session_id", sessionId);
      return new Response("success", {
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("success", {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });

  } catch (error: any) {
    console.error("Exchange error:", error);
    return new Response("failure\nInternal error", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
