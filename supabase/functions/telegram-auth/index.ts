import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.190.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

async function hmacSha256(key: ArrayBuffer, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new TextDecoder().decode(hexEncode(new Uint8Array(signature)));
}

async function sha256(data: string): Promise<ArrayBuffer> {
  return await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
}

async function verifyTelegramAuth(authData: TelegramAuthData, botToken: string): Promise<boolean> {
  const { hash, ...data } = authData;
  
  // Create data-check-string
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key as keyof typeof data]}`)
    .join("\n");

  console.log("Check string:", checkString);

  // Create secret key from bot token
  const secretKey = await sha256(botToken);
  
  // Calculate hash
  const calculatedHash = await hmacSha256(secretKey, checkString);

  console.log("Calculated hash:", calculatedHash);
  console.log("Received hash:", hash);

  // Verify hash matches
  if (calculatedHash !== hash) {
    console.log("Hash mismatch");
    return false;
  }

  // Check auth_date is not too old (max 24 hours for testing)
  const authDate = authData.auth_date;
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 86400; // 24 hours
  
  if (now - authDate > maxAge) {
    console.log("Auth date too old:", { authDate, now, diff: now - authDate });
    return false;
  }

  console.log("Telegram auth verified successfully");
  return true;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      throw new Error("TELEGRAM_BOT_TOKEN not configured");
    }

    const authData: TelegramAuthData = await req.json();
    console.log("Received Telegram auth data:", { 
      id: authData.id, 
      first_name: authData.first_name,
      username: authData.username,
      auth_date: authData.auth_date
    });

    // Verify the auth data
    const isValid = await verifyTelegramAuth(authData, botToken);
    if (!isValid) {
      console.error("Invalid Telegram authentication");
      return new Response(
        JSON.stringify({ error: "Неверная авторизация Telegram. Попробуйте ещё раз." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const telegramId = authData.id.toString();
    const fullName = [authData.first_name, authData.last_name].filter(Boolean).join(" ");
    const email = `telegram_${telegramId}@telegram.local`;

    console.log("Looking for existing user with telegram_id:", telegramId);

    // Check if user exists by telegram_id in profiles
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (profileError) {
      console.error("Error checking profile:", profileError);
    }

    let userId: string;

    if (existingProfile) {
      userId = existingProfile.user_id;
      console.log("Existing user found:", userId);
      
      // Update profile with latest data
      await supabase
        .from("profiles")
        .update({
          avatar_url: authData.photo_url,
          full_name: fullName,
        })
        .eq("user_id", userId);
    } else {
      console.log("Creating new user with email:", email);
      
      // Check if user with this email already exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users.find(u => u.email === email);
      
      if (existingUser) {
        userId = existingUser.id;
        console.log("Found existing user by email:", userId);
        
        // Link telegram_id to existing user
        await supabase
          .from("profiles")
          .update({ 
            telegram_id: telegramId,
            avatar_url: authData.photo_url,
            full_name: fullName,
          })
          .eq("user_id", userId);
      } else {
        // Create new user
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            telegram_id: telegramId,
            avatar_url: authData.photo_url,
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
          .update({
            telegram_id: telegramId,
            avatar_url: authData.photo_url,
          })
          .eq("user_id", userId);
      }
    }

    // Get origin from request headers
    const origin = req.headers.get("origin") || "https://jdqgnhfduplfcrsrvrnn.lovableproject.com";
    console.log("Generating magic link with origin:", origin);

    // Generate session for the user using magic link
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
    console.log("Magic link generated successfully");

    return new Response(
      JSON.stringify({
        success: true,
        redirect_url: actionLink,
        user_id: userId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Telegram auth error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Ошибка авторизации" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
