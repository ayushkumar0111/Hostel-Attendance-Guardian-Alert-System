// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Supabase Edge Function: push-notifier
// Secure Server-Side Web Push Dispatcher with VAPID Authentication
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import webpush from "npm:web-push@3.6.7";

// 1. VAPID Configuration (Read from Supabase Secrets)
const VAPID_PUBLIC_KEY =
  Deno.env.get("VAPID_PUBLIC_KEY") ||
  "BAzjcKuwT3O_kYn4Y1zcpgViGDT-L6qwK3krr3LQspiSaIL11uih8SY1i02Jy0xvnmRnnseg9CIimv-cvYA8zQ4";

const VAPID_PRIVATE_KEY =
  Deno.env.get("VAPID_PRIVATE_KEY") ||
  "PQA4MkePanxxsJv9RWWsFbVh0vp-MUnYkeGVbwB3WWA";

const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") || "mailto:hostel-alert@ctgroup.in";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Initialize Supabase Admin Client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ==========================================================================
    // ACTION: /send-test (Authenticated user tests their own active devices)
    // ==========================================================================
    if (pathname.endsWith("/send-test")) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing authorization header" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);

      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Invalid or expired user session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Query active subscriptions belonging strictly to this user
      const { data: subs, error: subErr } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (subErr || !subs || subs.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "No active push subscriptions found for your account. Please enable notifications on this device first.",
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let sentCount = 0;
      const payload = JSON.stringify({
        title: "CT Hostel - Test Notification",
        body: "Your device is successfully connected to CT Group Hostel Attendance alerts!",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        url: "/?source=test_push",
      });

      for (const sub of subs) {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          await webpush.sendNotification(pushSubscription, payload);
          sentCount++;

          // Record success log
          await supabaseAdmin.from("push_notification_logs").insert([
            {
              user_id: user.id,
              subscription_id: sub.id,
              notification_type: "TEST_NOTIFICATION",
              title: "CT Hostel - Test Notification",
              body: "Device test notification delivered",
              delivery_status: "SENT",
              status_code: 200,
            },
          ]);
        } catch (pushErr: any) {
          console.warn("[WebPush Test Error]", pushErr?.statusCode, pushErr?.message);
          // If subscription has expired (HTTP 410 or 404), mark inactive
          if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
            await supabaseAdmin
              .from("push_subscriptions")
              .update({ is_active: false })
              .eq("id", sub.id);
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: sentCount > 0,
          deliveredTo: sentCount,
          message: sentCount > 0
            ? `Test alert dispatched to ${sentCount} active device(s)!`
            : "Failed to deliver push to registered device(s). Endpoint may have expired.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==========================================================================
    // ACTION: /dispatch-event (Automated attendance reminders & absence alerts)
    // ==========================================================================
    if (pathname.endsWith("/dispatch-event")) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
        // Also check if caller is admin user
        const token = authHeader?.replace("Bearer ", "");
        const { data: { user } } = await supabaseAdmin.auth.getUser(token || "");
        
        let isAdmin = false;
        if (user) {
          const { data: prof } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
          if (prof?.role === "admin" || prof?.role === "warden") {
            isAdmin = true;
          }
        }

        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const body = await req.json();
      const {
        user_ids,
        notification_type,
        title,
        body: msgBody,
        url: targetUrl = "/",
        event_reference,
      } = body;

      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return new Response(JSON.stringify({ error: "Missing user_ids array" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Query active subscriptions for specified users
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .in("user_id", user_ids)
        .eq("is_active", true);

      if (!subs || subs.length === 0) {
        return new Response(JSON.stringify({ success: true, delivered: 0, note: "No active subscriptions" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let successCount = 0;
      const pushPayload = JSON.stringify({
        title,
        body: msgBody,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        url: targetUrl,
      });

      for (const sub of subs) {
        // Check preference filter
        if (notification_type === "ATTENDANCE_REMINDER" && !sub.attendance_reminders_enabled) continue;
        if (notification_type === "ATTENDANCE_VERIFIED" && !sub.attendance_status_updates_enabled) continue;
        if (notification_type === "LEAVE_STATUS" && !sub.attendance_status_updates_enabled) continue;
        if (notification_type === "ABSENCE_ALERT" && !sub.absence_alerts_enabled) continue;

        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          await webpush.sendNotification(pushSubscription, pushPayload);
          successCount++;

          // Record idempotent audit log
          if (event_reference) {
            await supabaseAdmin.from("push_notification_logs").upsert(
              {
                user_id: sub.user_id,
                subscription_id: sub.id,
                notification_type,
                title,
                body: msgBody,
                event_reference,
                delivery_status: "SENT",
                status_code: 200,
              },
              { onConflict: "event_reference,user_id,notification_type" }
            );
          }
        } catch (err: any) {
          console.warn("[Batch Push Error]", err?.statusCode, err?.message);
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await supabaseAdmin.from("push_subscriptions").update({ is_active: false }).eq("id", sub.id);
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, delivered: successCount }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Endpoint not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
