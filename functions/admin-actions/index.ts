// LawGovern Admin Actions — delete a user account (admin only, service_role).
//
// Two faults this replaces:
//
// 1. The file carried the Supabase starter template ("Hello from Functions!")
//    ABOVE the real code, so it exported a default fetch handler and then also
//    called Deno.serve. Two handlers in one module is a coin toss on which one
//    the runtime honours. Removed.
//
// 2. Deleting reported "Delete failed: User not found" and stopped. That error
//    means the id exists in profiles but not in auth.users — an orphaned
//    profile, left behind when a login was removed some other way (the Supabase
//    dashboard, an earlier failed signup). The row is real and visible in the
//    admin list, so refusing to remove it left it stuck there permanently with
//    no way to clear it from the app.
//
//    The account is now cleared in both places: the auth user if it is there,
//    and the profile row either way. Deleting a profile is not conditional on
//    the auth user existing.
//
// Deploy:  supabase functions deploy admin-actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. The caller must be signed in.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated." }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session." }, 401);

    // 2. …and must be an admin. Checked against their own profile, through
    //    their own client, so RLS still applies to the lookup.
    const { data: profile } = await userClient
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (!profile || !profile.is_admin) return json({ error: "Admin access required." }, 403);

    // 3. Target.
    const body = await req.json().catch(() => ({}));
    const targetId = body?.target_id;
    if (!targetId) return json({ error: "No target user specified." }, 400);
    if (targetId === user.id) {
      return json({ error: "You cannot delete your own admin account." }, 400);
    }

    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return json({
        error: "Server not configured: SERVICE_ROLE_KEY is not set.",
        detail: "supabase secrets set SERVICE_ROLE_KEY=<service role key>, then redeploy.",
      }, 500);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // 4. Remove the login, if there is one. A missing auth user is not a
    //    failure — it means the profile outlived its login and still needs
    //    clearing, which is exactly the case that used to dead-end here.
    let authDeleted = false;
    let authNote: string | null = null;

    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (!delErr) {
      authDeleted = true;
    } else if (/not.?found/i.test(delErr.message)) {
      authNote = "No login existed for this account — it had already been removed.";
    } else {
      return json({ error: "Delete failed: " + delErr.message, target_id: targetId }, 500);
    }

    // 5. Remove the profile regardless. If a cascade already took it, deleting
    //    nothing is not an error.
    const { error: profErr } = await admin.from("profiles").delete().eq("id", targetId);
    if (profErr) {
      return json({
        error: "The login was removed but the profile could not be: " + profErr.message,
        target_id: targetId,
        auth_deleted: authDeleted,
      }, 500);
    }

    return json({
      success: true,
      auth_deleted: authDeleted,
      profile_deleted: true,
      note: authNote,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
