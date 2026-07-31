import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { telegram_username, code } = await req.json();

    if (!telegram_username || !code) {
      return new Response(
        JSON.stringify({ error: "telegram_username и code обязательны" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean username (remove @ if present)
    const cleanUsername = telegram_username.replace(/^@/, '').toLowerCase();
    console.log("Verifying code for username:", cleanUsername);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find valid code by username
    const { data: authCode, error: findError } = await supabase
      .from("auth_codes")
      .select("*")
      .ilike("telegram_username", cleanUsername)
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (findError) {
      console.error("Error finding code:", findError);
      throw new Error("Ошибка проверки кода");
    }

    if (!authCode) {
      console.log("Invalid or expired code for username:", cleanUsername);
      return new Response(
        JSON.stringify({ error: "Неверный или истёкший код. Убедитесь что @username совпадает." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const telegramId = authCode.telegram_id;

    // Mark code as used
    await supabase
      .from("auth_codes")
      .update({ used: true })
      .eq("id", authCode.id);

    // Find or create user
    const email = `telegram_${telegramId}@telegram.local`;

    // Check if user exists by telegram_id in profiles
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      userId = existingProfile.user_id;
      console.log("Existing user found:", userId);
    } else {
      // Check if user with this email already exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users.find(u => u.email === email);

      if (existingUser) {
        userId = existingUser.id;
        console.log("Found existing user by email:", userId);

        // Link telegram_id to existing user
        await supabase
          .from("profiles")
          .update({ telegram_id: telegramId })
          .eq("user_id", userId);
      } else {
        // Create new user
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            telegram_id: telegramId,
          },
        });

        if (createError) {
          console.error("Error creating user:", createError);
          throw createError;
        }

        userId = newUser.user!.id;
        console.log("New user created:", userId);

        // Update profile with telegram data
        await supabase
          .from("profiles")
          .update({ telegram_id: telegramId })
          .eq("user_id", userId);
      }
    }

    // Get origin from request headers
    const origin = req.headers.get("origin") || "https://jdqgnhfduplfcrsrvrnn.lovableproject.com";

    // Generate magic link
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${origin}/`,
      },
    });

    if (sessionError) {
      console.error("Error generating magic link:", sessionError);
      throw sessionError;
    }

    const actionLink = sessionData.properties?.action_link;
    console.log("Auth successful for username:", cleanUsername);

    return new Response(
      JSON.stringify({
        success: true,
        redirect_url: actionLink,
        user_id: userId,
      }),
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
