import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VKTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  user_id?: number;
  error?: string;
  error_description?: string;
}

interface VKUserInfo {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    phone?: string;
    email?: string;
    avatar?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const VK_CLIENT_ID = Deno.env.get("VK_CLIENT_ID");
    const VK_CLIENT_SECRET = Deno.env.get("VK_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!VK_CLIENT_ID || !VK_CLIENT_SECRET) {
      throw new Error("VK credentials not configured");
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const body = await req.json();
    const { code, state, device_id, code_verifier, redirect_uri, saved_state } = body;

    console.log("VK Callback received:", { code: code?.substring(0, 10) + "...", state, device_id });

    // Validate state
    if (state !== saved_state) {
      throw new Error("Invalid state - possible CSRF attack");
    }

    if (!code || !code_verifier || !redirect_uri) {
      throw new Error("Missing required parameters: code, code_verifier, or redirect_uri");
    }

    // Exchange code for token
    const tokenUrl = "https://id.vk.com/oauth2/auth";
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirect_uri,
      client_id: VK_CLIENT_ID,
      client_secret: VK_CLIENT_SECRET,
      code_verifier: code_verifier,
      state: state,
    });

    // Add device_id if provided
    if (device_id) {
      tokenParams.set("device_id", device_id);
    }

    console.log("Exchanging code for token...");

    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });

    const tokenJson: VKTokenResponse = await tokenResp.json();
    console.log("Token response status:", tokenResp.status);

    if (!tokenResp.ok || tokenJson.error) {
      console.error("Token exchange failed:", tokenJson);
      throw new Error(tokenJson.error_description || tokenJson.error || "Token exchange failed");
    }

    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      throw new Error("No access_token in response");
    }

    console.log("Token obtained, fetching user info...");

    // Get user info from VK ID
    const userInfoUrl = "https://id.vk.com/oauth2/user_info";
    const userInfoResp = await fetch(userInfoUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        access_token: accessToken,
        client_id: VK_CLIENT_ID,
      }),
    });

    const userInfoJson: VKUserInfo = await userInfoResp.json();
    console.log("User info response:", JSON.stringify(userInfoJson));

    if (!userInfoJson.user) {
      // Fallback to API v5.131 users.get
      const apiUrl = new URL("https://api.vk.com/method/users.get");
      apiUrl.searchParams.set("v", "5.131");
      apiUrl.searchParams.set("fields", "photo_100,screen_name,contacts");
      
      const apiResp = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      const apiJson = await apiResp.json();
      console.log("Fallback API response:", JSON.stringify(apiJson));
      
      if (apiJson.response && apiJson.response[0]) {
        const vkUser = apiJson.response[0];
        userInfoJson.user = {
          user_id: String(vkUser.id),
          first_name: vkUser.first_name,
          last_name: vkUser.last_name,
          avatar: vkUser.photo_100,
        };
      }
    }

    if (!userInfoJson.user) {
      throw new Error("Failed to get user info from VK");
    }

    const vkUser = userInfoJson.user;
    const vkId = vkUser.user_id;
    const fullName = `${vkUser.first_name} ${vkUser.last_name}`.trim();
    const email = vkUser.email || `vk_${vkId}@vk.local`;
    const phone = vkUser.phone;
    const avatarUrl = vkUser.avatar;

    console.log("VK User:", { vkId, fullName, email });

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if user with this VK ID exists in profiles
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email")
      .eq("vk_id", vkId)
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      // User exists, update profile
      userId = existingProfile.user_id;
      console.log("Existing user found:", userId);

      await supabaseAdmin
        .from("profiles")
        .update({
          full_name: fullName,
          avatar_url: avatarUrl,
          phone: phone || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      // Check if user exists by email
      const { data: userByEmail } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("email", email)
        .maybeSingle();

      if (userByEmail) {
        // Link VK to existing user
        userId = userByEmail.user_id;
        console.log("Linking VK to existing user:", userId);

        await supabaseAdmin
          .from("profiles")
          .update({
            vk_id: vkId,
            full_name: fullName,
            avatar_url: avatarUrl,
            phone: phone || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      } else {
        // Create new user
        console.log("Creating new user with VK ID:", vkId);

        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: email,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            avatar_url: avatarUrl,
            vk_id: vkId,
          },
        });

        if (createError) {
          console.error("Error creating user:", createError);
          throw new Error("Failed to create user: " + createError.message);
        }

        userId = newUser.user.id;

        // Update profile with VK ID
        await supabaseAdmin
          .from("profiles")
          .update({
            vk_id: vkId,
            full_name: fullName,
            avatar_url: avatarUrl,
            phone: phone || undefined,
          })
          .eq("user_id", userId);
      }
    }

    // Generate magic link for the user
    const { data: magicLinkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: email,
      options: {
        redirectTo: redirect_uri.split("/auth")[0] + "/",
      },
    });

    if (magicLinkError) {
      console.error("Error generating magic link:", magicLinkError);
      throw new Error("Failed to generate magic link");
    }

    console.log("Magic link generated successfully");

    // Extract token from magic link
    const magicLinkUrl = new URL(magicLinkData.properties.action_link);
    const token = magicLinkUrl.searchParams.get("token");
    const type = magicLinkUrl.searchParams.get("type");

    // Construct the redirect URL that will work with Supabase auth
    const redirectUrl = `${SUPABASE_URL}/auth/v1/verify?token=${token}&type=${type}&redirect_to=${encodeURIComponent(redirect_uri.split("/auth")[0] + "/")}`;

    return new Response(
      JSON.stringify({
        success: true,
        redirect_url: redirectUrl,
        user_id: userId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("VK callback error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
