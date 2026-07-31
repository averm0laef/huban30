import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-1c-token",
};

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PRODUCTS_PER_REQUEST = 500;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

// In-memory rate limiter (per isolate lifetime)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || "unknown";
}

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

function sanitizeString(str: string | undefined | null, maxLen = 500): string | null {
  if (!str) return null;
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .substring(0, maxLen);
}

function sanitizeNumber(val: any, fallback = 0): number {
  const num = Number(val);
  return isFinite(num) && num >= 0 ? num : fallback;
}

interface Product1C {
  guid: string;
  name: string;
  sku?: string;
  brand?: string;
  price: number;
  old_price?: number;
  stock_qty: number;
  availability_status?: 'in_stock' | 'order' | 'none';
  category_guid?: string;
  description?: string;
  props?: Record<string, any>;
  images?: string[];
}

interface ImportPayload {
  products: Product1C[];
  category_mapping?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIP = getClientIP(req);

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    console.warn(`Rate limit exceeded for IP: ${clientIP}`);
    return new Response(
      JSON.stringify({ error: "Too many requests. Try again later." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify 1C token against stored settings
    const authToken = req.headers.get("x-1c-token");
    const { data: settings } = await supabase
      .from("store_settings")
      .select("exchange_login, exchange_password")
      .limit(1)
      .single();

    const expectedToken = settings?.exchange_password;
    if (!authToken || !expectedToken || authToken !== expectedToken) {
      console.warn(`Auth failed from IP: ${clientIP}, token: ${authToken ? "invalid" : "missing"}`);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check content length before parsing
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_SIZE) {
      console.warn(`Body too large from IP: ${clientIP}, size: ${contentLength}`);
      return new Response(
        JSON.stringify({ error: `Payload too large. Max ${MAX_BODY_SIZE / 1024 / 1024}MB` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return new Response(
        JSON.stringify({ error: "Payload too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: ImportPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Import from IP: ${clientIP}, products: ${payload.products?.length || 0}`);

    if (!payload.products || !Array.isArray(payload.products)) {
      return new Response(
        JSON.stringify({ error: "Invalid payload: products array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payload.products.length > MAX_PRODUCTS_PER_REQUEST) {
      return new Response(
        JSON.stringify({ error: `Too many products. Max ${MAX_PRODUCTS_PER_REQUEST} per request` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    for (const product of payload.products) {
      try {
        const guid = sanitizeString(product.guid, 100);
        const name = sanitizeString(product.name, 300);

        if (!guid || !name) {
          results.errors.push(`Missing required fields for product`);
          continue;
        }

        let availabilityStatus = product.availability_status;
        if (!availabilityStatus || !['in_stock', 'order', 'none'].includes(availabilityStatus)) {
          availabilityStatus = sanitizeNumber(product.stock_qty) > 0 ? 'in_stock' : 'none';
        }

        const { data: existing } = await supabase
          .from("products")
          .select("id")
          .eq("guid_1c", guid)
          .maybeSingle();

        const productData = {
          guid_1c: guid,
          title: name,
          sku: sanitizeString(product.sku, 100),
          brand: sanitizeString(product.brand, 100),
          price: sanitizeNumber(product.price),
          old_price: product.old_price ? sanitizeNumber(product.old_price) : null,
          stock_qty: sanitizeNumber(product.stock_qty),
          availability_status: availabilityStatus,
          description: sanitizeString(product.description, 5000),
          props: product.props && typeof product.props === 'object' ? product.props : null,
          category_id: payload.category_mapping?.[product.category_guid || ''] || null,
          is_published: false,
          updated_at: new Date().toISOString(),
        };

        if (existing) {
          const { error } = await supabase
            .from("products")
            .update(productData)
            .eq("id", existing.id);

          if (error) throw error;
          results.updated++;

          if (product.images && Array.isArray(product.images) && product.images.length > 0 && product.images.length <= 20) {
            await supabase.from("product_images").delete().eq("product_id", existing.id);
            const imageInserts = product.images
              .filter((url): url is string => typeof url === 'string' && url.length < 2000)
              .map((url, index) => ({ product_id: existing.id, url, sort_order: index }));
            if (imageInserts.length > 0) {
              await supabase.from("product_images").insert(imageInserts);
            }
          }
        } else {
          const { data: newProduct, error } = await supabase
            .from("products")
            .insert(productData)
            .select("id")
            .single();

          if (error) throw error;
          results.created++;

          if (product.images && Array.isArray(product.images) && product.images.length > 0 && product.images.length <= 20 && newProduct) {
            const imageInserts = product.images
              .filter((url): url is string => typeof url === 'string' && url.length < 2000)
              .map((url, index) => ({ product_id: newProduct.id, url, sort_order: index }));
            if (imageInserts.length > 0) {
              await supabase.from("product_images").insert(imageInserts);
            }
          }
        }
      } catch (err: any) {
        console.error(`Error processing product:`, err);
        results.errors.push(`Product error: ${err?.message || 'Unknown error'}`);
      }
    }

    console.log(`Import completed from IP ${clientIP}:`, results);

    // Send Telegram notification
    if (results.created > 0 || results.updated > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/notify-telegram`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            action: "import_complete",
            importSource: "1С (JSON API)",
            importCreated: results.created,
            importUpdated: results.updated,
            importErrors: results.errors.length,
          }),
        });
      } catch (e) {
        console.error("Failed to send Telegram notification:", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        created: results.created,
        updated: results.updated,
        errors: results.errors.slice(0, 10),
        total_errors: results.errors.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
