// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Supabase Edge Function: telephony-webhook
// Secure Carrier Webhook Receiver for Twilio & Exotel Voice Gateways
// Validates Carrier Signatures, Handles DTMF Digits, & Returns Hindi TwiML
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const EXACT_HINDI_MESSAGE =
  "Namaste, aapke ward ki aaj ki attendance mein unhe absent record kiya gaya hai. Agar aapko iski jankari hai, to 1 dabayein. Agar aapko iski jankari nahi hai aur aap assistant se baat karna chahte hain, to 2 dabayein.";

const ACKNOWLEDGMENT_PROMPT_HI =
  "Aapki pushti darj kar li gayi hai. Dhanyawad.";

const TRANSFER_PROMPT_HI =
  "Kripya pratiksha karein, aapki call hostel warden ya assistant se jodi ja rahi hai.";

const INVALID_PROMPT_HI =
  "Amaniya vikalp. Jankari ki pushti ke liye 1, ya sahayak se baat karne ke liye 2 dabayein.";

// Verify Twilio Webhook Signature (HMAC-SHA1)
async function verifyTwilioSignature(
  authToken: string,
  twilioSignature: string | null,
  fullUrl: string,
  params: Record<string, string>
): Promise<boolean> {
  if (!authToken || !twilioSignature) return false;

  // Twilio signature format: URL + sorted key-value pairs concatenated
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = fullUrl;
  for (const key of sortedKeys) {
    dataToSign += key + params[key];
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(authToken);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(dataToSign));
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return base64Signature === twilioSignature;
}

serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("OK", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Twilio-Signature"
      }
    });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id") || url.searchParams.get("CallSessionId");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
  const supabaseServiceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("VITE_SUPABASE_ANON_KEY") ||
    "";

  const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN") || Deno.env.get("VITE_TWILIO_AUTH_TOKEN") || "";
  const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER") || Deno.env.get("VITE_TWILIO_PHONE_NUMBER") || "";
  const wardenContactFallback = Deno.env.get("WARDEN_CONTACT_FALLBACK") || "+91-181-2955999";
  const aiAssistantUrl = Deno.env.get("AI_VOICE_ASSISTANT_URL") || "";

  // Parse Body
  let bodyParams: Record<string, string> = {};
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const searchParams = new URLSearchParams(text);
    searchParams.forEach((val, key) => {
      bodyParams[key] = val;
    });
  } else if (contentType.includes("application/json")) {
    try {
      bodyParams = await req.json();
    } catch {
      // Ignored
    }
  }

  // 1. Signature Verification (If Twilio Token is configured)
  const twilioSig = req.headers.get("x-twilio-signature");
  if (twilioAuthToken && twilioSig) {
    const isValid = await verifyTwilioSignature(twilioAuthToken, twilioSig, req.url, bodyParams);
    if (!isValid) {
      console.warn("[TELEPHONY WEBHOOK] Invalid Twilio Signature rejected.");
      return new Response("Forbidden: Invalid Carrier Signature", { status: 403 });
    }
  }

  const digits = (bodyParams.Digits || bodyParams.dtmf || "").trim();
  const callSid = bodyParams.CallSid || "";
  const callStatus = bodyParams.CallStatus || "";

  console.log(`[TELEPHONY WEBHOOK] Received: Digits="${digits}", CallSid="${callSid}", Status="${callStatus}", SessionId="${sessionId}"`);

  // Initialize Supabase Client
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Status Callback Handling
  if (callStatus && !digits) {
    if (sessionId) {
      if (callStatus === "completed") {
        await supabase
          .from("call_sessions")
          .update({ provider_call_sid: callSid, ended_at: new Date().toISOString() })
          .eq("id", sessionId);
      } else if (["busy", "no-answer", "failed", "canceled"].includes(callStatus.toLowerCase())) {
        await supabase.rpc("record_call_session_failure", {
          p_session_id: sessionId,
          p_error_message: `Carrier status: ${callStatus}`
        });
      }
    }
    return new Response("<Response/>", {
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    });
  }

  // DTMF Digit Handling
  if (digits === "1") {
    // 1. Acknowledgment
    if (sessionId) {
      await supabase.rpc("handle_call_session_ivr", {
        p_session_id: sessionId,
        p_digit_pressed: "1"
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="hi-IN">${ACKNOWLEDGMENT_PROMPT_HI}</Say>
  <Hangup/>
</Response>`;

    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    });
  } else if (digits === "2") {
    // 2. Bridge to Warden or AI Assistant
    let wardenContact = wardenContactFallback;

    if (sessionId) {
      // Look up student's hostel warden contact
      const { data: session } = await supabase
        .from("call_sessions")
        .select("attendance_records(students(hostels(warden_contact)))")
        .eq("id", sessionId)
        .maybeSingle();

      const hostelWarden = (session as any)?.attendance_records?.students?.hostels?.warden_contact;
      if (hostelWarden && hostelWarden.trim().length > 5) {
        wardenContact = hostelWarden.trim();
      }

      await supabase.rpc("handle_call_session_ivr", {
        p_session_id: sessionId,
        p_digit_pressed: "2",
        p_warden_phone: wardenContact
      });
    }

    const targetDial = wardenContact || aiAssistantUrl;
    const dialCallerId = twilioPhoneNumber ? `callerId="${twilioPhoneNumber}"` : "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="hi-IN">${TRANSFER_PROMPT_HI}</Say>
  <Dial timeout="25" ${dialCallerId}>${targetDial}</Dial>
</Response>`;

    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    });
  } else {
    // Invalid digit / Retry
    const actionUrl = req.url;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${actionUrl}" method="POST" timeout="10">
    <Say language="hi-IN">${INVALID_PROMPT_HI}</Say>
  </Gather>
  <Say language="hi-IN">Samay samapt ho gaya hai. Dhanyawad.</Say>
  <Hangup/>
</Response>`;

    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    });
  }
});
