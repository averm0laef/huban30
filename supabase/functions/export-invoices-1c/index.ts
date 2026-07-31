import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvoiceItem {
  title: string;
  sku: string | null;
  quantity: number;
  price: number;
  total: number;
  guid_1c: string | null;
}

interface InvoicePayload {
  id: string;
  type: string;
  number: string;
  date: string;
  counterparty: string | null;
  total_amount: number;
  notes: string | null;
  items: InvoiceItem[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function invoicesToCommerceML(invoices: InvoicePayload[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.10" ДатаФормирования="${new Date().toISOString()}">`;

  for (const inv of invoices) {
    const docType = inv.type === "incoming"
      ? "ПоступлениеТоваров"
      : "РеализацияТоваров";

    xml += `
  <Документ>
    <Ид>${escapeXml(inv.id)}</Ид>
    <Номер>${escapeXml(inv.number)}</Номер>
    <Дата>${inv.date}</Дата>
    <ХозОперация>${docType}</ХозОперация>
    <Роль>${inv.type === "incoming" ? "Покупатель" : "Продавец"}</Роль>
    <Валюта>RUB</Валюта>
    <Сумма>${inv.total_amount}</Сумма>`;

    if (inv.counterparty) {
      xml += `
    <Контрагенты>
      <Контрагент>
        <Наименование>${escapeXml(inv.counterparty)}</Наименование>
      </Контрагент>
    </Контрагенты>`;
    }

    if (inv.notes) {
      xml += `
    <Комментарий>${escapeXml(inv.notes)}</Комментарий>`;
    }

    xml += `
    <Товары>`;

    for (const item of inv.items) {
      xml += `
      <Товар>
        <Наименование>${escapeXml(item.title)}</Наименование>
        ${item.sku ? `<Артикул>${escapeXml(item.sku)}</Артикул>` : ""}
        ${item.guid_1c ? `<Ид>${escapeXml(item.guid_1c)}</Ид>` : ""}
        <ЦенаЗаЕдиницу>${item.price}</ЦенаЗаЕдиницу>
        <Количество>${item.quantity}</Количество>
        <Сумма>${item.total}</Сумма>
      </Товар>`;
    }

    xml += `
    </Товары>
  </Документ>`;
  }

  xml += `
</КоммерческаяИнформация>`;

  return xml;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: hasAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id, _role: "admin",
    });
    if (!hasAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { invoices, format: outputFormat } = await req.json();

    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return new Response(JSON.stringify({ error: "No invoices provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (outputFormat === "json") {
      return new Response(JSON.stringify({ success: true, data: invoices }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: CommerceML XML
    const xml = invoicesToCommerceML(invoices);

    // Send Telegram notification
    try {
      const totalItems = invoices.reduce((s: number, inv: InvoicePayload) => s + inv.items.length, 0);
      await fetch(`${supabaseUrl}/functions/v1/notify-telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          action: "invoice_exported",
          invoiceCount: invoices.length,
          totalItems,
          invoiceType: invoices[0]?.type,
        }),
      });
    } catch (e) {
      console.error("Failed to send Telegram notification:", e);
    }

    return new Response(JSON.stringify({ success: true, xml, count: invoices.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
