import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Legacy bootstrap values must be injected explicitly and are never committed.
const SUPER_ADMIN_EMAIL = Deno.env.get("SUPER_ADMIN_EMAIL");
const SUPER_ADMIN_PASSWORD = Deno.env.get("SUPER_ADMIN_PASSWORD");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ error: "Admin bootstrap is not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if super admin already exists
    const { data: existingAdmin } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", SUPER_ADMIN_EMAIL)
      .eq("is_super_admin", true)
      .maybeSingle();

    if (existingAdmin) {
      return new Response(
        JSON.stringify({ message: "Super admin already exists", exists: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create super admin user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: "Администратор",
      },
    });

    if (createError) {
      // User might already exist but not marked as super admin
      if (createError.message.includes("already been registered")) {
        // Find the user and mark as super admin
        const { data: userByEmail } = await supabase.auth.admin.listUsers();
        const existingUser = userByEmail.users.find(u => u.email === SUPER_ADMIN_EMAIL);
        
        if (existingUser) {
          // Update profile to be super admin
          await supabase
            .from("profiles")
            .update({ is_super_admin: true })
            .eq("user_id", existingUser.id);

          // Ensure admin role exists
          await supabase
            .from("user_roles")
            .upsert({ user_id: existingUser.id, role: "admin" }, { onConflict: "user_id,role" });

          console.log("Existing user marked as super admin:", existingUser.id);
          
          return new Response(
            JSON.stringify({ message: "Existing user marked as super admin", success: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      throw createError;
    }

    const userId = newUser.user!.id;
    console.log("Super admin created:", userId);

    // Mark as super admin
    await supabase
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("user_id", userId);

    // Set admin role (trigger should have created 'user' role, we need to update to 'admin')
    await supabase
      .from("user_roles")
      .update({ role: "admin" })
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({ message: "Super admin created successfully", success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Init admin error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
