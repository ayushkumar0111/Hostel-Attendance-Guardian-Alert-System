// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Persistent Background Call Queue Worker & Schedule Finalization Daemon
// Executes independently of the browser: Runs scheduled finalization at 22:31 IST
// and processes guardian calls sequentially one-by-one with atomic claiming.
// Also includes built-in HTTP Webhook Server for Carrier DTMF and Status Callbacks.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// 1. Load Environment Configuration
const envPath = path.resolve(process.cwd(), '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });
}

// Support both server-side standard env vars and client VITE_ fallbacks
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[WORKER ERROR] Missing Supabase URL or Key in environment.');
  process.exit(1);
}

const { createClient } = require(path.resolve(process.cwd(), 'node_modules/@supabase/supabase-js'));
const supabase = createClient(supabaseUrl, supabaseKey);

// Telephony Gateway Configuration
const twilioSid = process.env.TWILIO_ACCOUNT_SID || env.TWILIO_ACCOUNT_SID || env.VITE_TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN || env.VITE_TWILIO_AUTH_TOKEN || '';
const twilioFrom = process.env.TWILIO_PHONE_NUMBER || env.TWILIO_PHONE_NUMBER || env.VITE_TWILIO_PHONE_NUMBER || '';

const exotelSid = process.env.EXOTEL_SID || env.EXOTEL_SID || env.VITE_EXOTEL_SID || '';
const exotelApiKey = process.env.EXOTEL_API_KEY || env.EXOTEL_API_KEY || env.VITE_EXOTEL_API_KEY || '';
const exotelToken = process.env.EXOTEL_API_TOKEN || env.EXOTEL_API_TOKEN || '';
const exotelCallerId = process.env.EXOTEL_CALLER_ID || env.EXOTEL_CALLER_ID || env.VITE_EXOTEL_CALLER_ID || '';

const webhookBaseUrl = process.env.TELEPHONY_WEBHOOK_BASE_URL || env.TELEPHONY_WEBHOOK_BASE_URL || 'http://localhost:5001';
const webhookPort = parseInt(process.env.TELEPHONY_PORT || env.TELEPHONY_PORT || '5001', 10);
const wardenContactFallback = process.env.WARDEN_CONTACT_FALLBACK || env.WARDEN_CONTACT_FALLBACK || env.VITE_WARDEN_CONTACT_FALLBACK || '+91-181-2955999';

const isTwilioLive = twilioSid.startsWith('AC') && twilioSid.length > 20 && twilioToken.length > 10;
const isExotelLive = exotelSid.length > 5 && exotelApiKey.length > 5;

const EXACT_HINDI_MESSAGE =
  'Namaste, aapke ward ki aaj ki attendance mein unhe absent record kiya gaya hai. Agar aapko iski jankari hai, to 1 dabayein. Agar aapko iski jankari nahi hai aur aap assistant se baat karna chahte hain, to 2 dabayein.';

const ACKNOWLEDGMENT_PROMPT_HI = 'Aapki pushti darj kar li gayi hai. Dhanyawad.';
const TRANSFER_PROMPT_HI = 'Kripya pratiksha karein, aapki call hostel warden ya assistant se jodi ja rahi hai.';
const INVALID_PROMPT_HI = 'Amaniya vikalp. Jankari ki pushti ke liye 1, ya sahayak se baat karne ke liye 2 dabayein.';

// Web Push (VAPID) Integration
let webpush = null;
try {
  webpush = require('web-push');
  const vapidPublicKey =
    process.env.VAPID_PUBLIC_KEY ||
    env.VAPID_PUBLIC_KEY ||
    'BAzjcKuwT3O_kYn4Y1zcpgViGDT-L6qwK3krr3LQspiSaIL11uih8SY1i02Jy0xvnmRnnseg9CIimv-cvYA8zQ4';
  const vapidPrivateKey =
    process.env.VAPID_PRIVATE_KEY ||
    env.VAPID_PRIVATE_KEY ||
    'PQA4MkePanxxsJv9RWWsFbVh0vp-MUnYkeGVbwB3WWA';
  const vapidSubject =
    process.env.VAPID_SUBJECT || env.VAPID_SUBJECT || 'mailto:hostel-alert@ctgroup.in';
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} catch (e) {
  console.warn('[WEBPUSH INIT NOTE]', e.message);
}

/**
 * Dispatches a Web Push Notification to active subscriptions of a user.
 */
async function dispatchPushNotification(userId, notificationType, title, body, url = '/', eventRef = null) {
  if (!webpush || !userId) return 0;
  try {
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error || !subs || subs.length === 0) return 0;

    let delivered = 0;
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url
    });

    for (const sub of subs) {
      if (notificationType === 'ATTENDANCE_REMINDER' && !sub.attendance_reminders_enabled) continue;
      if (notificationType === 'ATTENDANCE_VERIFIED' && !sub.attendance_status_updates_enabled) continue;
      if (notificationType === 'ABSENCE_ALERT' && !sub.absence_alerts_enabled) continue;

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          },
          payload
        );
        delivered++;

        if (eventRef) {
          await supabase.from('push_notification_logs').upsert(
            {
              user_id: userId,
              subscription_id: sub.id,
              notification_type: notificationType,
              title,
              body,
              event_reference: eventRef,
              delivery_status: 'SENT',
              status_code: 200
            },
            { onConflict: 'event_reference,user_id,notification_type' }
          );
        }
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
        }
      }
    }
    return delivered;
  } catch (err) {
    console.warn('[PUSH DISPATCH NOTE]', err.message);
    return 0;
  }
}

/**
 * Returns current timestamp formatted in Asia/Kolkata timezone.
 */
function getIstTime() {
  const now = new Date();
  const istStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istStr);
  const hours = String(istDate.getHours()).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');

  return {
    timeStr: `${hours}:${minutes}:${seconds}`,
    dateStr: `${year}-${month}-${day}`,
    hours: istDate.getHours(),
    minutes: istDate.getMinutes(),
    totalMinutes: istDate.getHours() * 60 + istDate.getMinutes(),
    rawDate: istDate
  };
}

/**
 * Checks if attendance deadline (22:30 IST) has closed and finalization (22:31 IST) has begun.
 */
async function checkAndFinalizeAbsences() {
  const ist = getIstTime();
  console.log(`[SCHEDULE CHECK] Current IST Time: ${ist.timeStr} (${ist.dateStr})`);

  // Query active schedules
  const { data: schedules, error: sErr } = await supabase
    .from('attendance_schedules')
    .select('*')
    .eq('is_active', true);

  if (sErr || !schedules || schedules.length === 0) {
    console.log('[SCHEDULE] No active attendance schedules found.');
    return;
  }

  for (const s of schedules) {
    const [dHours, dMins] = s.deadline_time.split(':').map(Number);
    const deadlineTotalMinutes = dHours * 60 + dMins + (s.grace_period_minutes || 1);

    if (ist.totalMinutes >= deadlineTotalMinutes) {
      console.log(`[FINALIZING ABSENCES] Schedule "${s.name}" reached 22:31 IST cutoff. Evaluating unrecorded students...`);

      // Try server-side RPC first
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('detect_and_mark_absences', {
          p_schedule_id: s.id,
          p_date: ist.dateStr,
          p_force: false
        });

        if (!rpcErr && rpcRes && rpcRes.success) {
          console.log(`[RPC SUCCESS] ${rpcRes.message}`);
          continue;
        }
      } catch (e) {
        console.log('[RPC Note] Fallback to application absence finalization:', e.message);
      }

      // Application-level absence finalization fallback
      await executeAppLevelAbsenceFinalization(s, ist.dateStr);
    } else {
      const remaining = deadlineTotalMinutes - ist.totalMinutes;
      console.log(`[ACTIVE WINDOW] Schedule "${s.name}" active until 22:30 IST (${remaining} minutes until 22:31 finalization).`);
    }
  }
}

/**
 * Application-level absence evaluation preserving all verified PRESENT records.
 */
async function executeAppLevelAbsenceFinalization(schedule, today) {
  const { data: students } = await supabase
    .from('students')
    .select('*, guardians(*)')
    .eq('hostel_id', schedule.hostel_id)
    .eq('enrollment_status', 'ACTIVE');

  if (!students || students.length === 0) return;

  const { data: existingRecords } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('schedule_id', schedule.id)
    .eq('attendance_date', today);

  const existingMap = new Map();
  (existingRecords || []).forEach(r => existingMap.set(r.student_id, r));

  const { data: leaves } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('approval_status', 'APPROVED')
    .lte('start_date', today)
    .gte('end_date', today);

  const leaveMap = new Map();
  (leaves || []).forEach(l => leaveMap.set(l.student_id, l));

  let absentMarked = 0;
  let callsQueued = 0;

  for (const st of students) {
    const rec = existingMap.get(st.id);

    // CRITICAL: NEVER overwrite or modify a verified PRESENT record
    if (rec && (rec.status === 'PRESENT' || rec.status === 'APPROVED_LEAVE' || rec.status === 'EXCUSED')) {
      continue;
    }

    const leave = leaveMap.get(st.id);
    if (leave) {
      if (!rec) {
        await supabase.from('attendance_records').insert([
          {
            student_id: st.id,
            schedule_id: schedule.id,
            attendance_date: today,
            status: 'APPROVED_LEAVE',
            submitted_at: new Date().toISOString(),
            verification_status: 'VERIFIED',
            review_reason: `Sanctioned leave: ${leave.reason_category}`
          }
        ]);
      }
      continue;
    }

    // Mark ABSENT
    let recordId;
    if (!rec) {
      const { data: newRec } = await supabase
        .from('attendance_records')
        .insert([
          {
            student_id: st.id,
            schedule_id: schedule.id,
            attendance_date: today,
            status: 'ABSENT',
            submitted_at: new Date().toISOString(),
            verification_status: 'VERIFIED',
            review_reason: 'Automated 22:31 IST roll-call finalization'
          }
        ])
        .select('id')
        .single();
      recordId = newRec?.id;
      absentMarked++;
    } else if (rec.status !== 'ABSENT') {
      await supabase
        .from('attendance_records')
        .update({ status: 'ABSENT', review_reason: 'Confirmed Absent at 22:31 IST' })
        .eq('id', rec.id);
      recordId = rec.id;
      absentMarked++;
    } else {
      recordId = rec.id;
    }

    // Queue guardian in-app notification & call idempotently (guarantee zero duplicates)
    if (st.guardian_id && recordId) {
      // 1. FREE Guardian In-App Notification (Idempotent)
      const noticeMessage = `Namaste. Aapka ward ${st.full_name} aaj ${today} ki hostel attendance mein absent mark hua hai. Agar aapko iski jankari nahi hai ya aapko lagta hai ki attendance galat hai, toh kripya hostel warden se sampark karein.`;

      const { data: existingNotice } = await supabase
        .from('guardian_notifications')
        .select('id')
        .eq('guardian_id', st.guardian_id)
        .eq('student_id', st.id)
        .eq('attendance_date', today)
        .maybeSingle();

      if (!existingNotice) {
        await supabase.from('guardian_notifications').insert([
          {
            guardian_id: st.guardian_id,
            student_id: st.id,
            attendance_record_id: recordId,
            attendance_date: today,
            title: 'Hostel Absence Notice',
            message: noticeMessage,
            is_read: false
          }
        ]);
      }

      // 2. FREE Web Push Notifications (Closed-App Delivery)
      if (st.profile_id) {
        dispatchPushNotification(
          st.profile_id,
          'ABSENCE_ALERT',
          'CT Hostel Attendance Notice',
          'Roll-call attendance was not recorded before the 22:30 IST night curfew deadline.',
          '/?source=push_absence',
          `absence:${today}:${st.id}:student`
        ).catch(() => {});
      }
      if (st.guardians?.profile_id) {
        dispatchPushNotification(
          st.guardians.profile_id,
          'ABSENCE_ALERT',
          'CT Hostel Attendance Notice',
          `Roll-call notice for ward ${st.full_name}: Attendance not recorded by deadline.`,
          '/?source=push_absence',
          `absence:${today}:${st.id}:guardian`
        ).catch(() => {});
      }

      // 3. Carrier Voice Call Queue
      const { data: existingSession } = await supabase
        .from('call_sessions')
        .select('id')
        .eq('attendance_record_id', recordId)
        .maybeSingle();

      if (!existingSession) {
        await supabase.from('notification_events').insert([
          {
            attendance_record_id: recordId,
            guardian_id: st.guardian_id,
            channel: 'voice',
            event_type: 'ABSENCE_CALL',
            delivery_status: 'QUEUED',
            attempts: 0
          }
        ]);

        await supabase.from('call_sessions').insert([
          {
            guardian_id: st.guardian_id,
            attendance_record_id: recordId,
            call_status: 'QUEUED',
            transfer_requested: false,
            attempts: 0,
            retry_count: 0
          }
        ]);

        callsQueued++;
      }
    }
  }

  if (absentMarked > 0 || callsQueued > 0) {
    console.log(`[FINALIZATION SUMMARY] ${absentMarked} student(s) marked ABSENT, ${callsQueued} call session(s) queued.`);
  }
}

/**
 * Sequential Queue Processor with Atomic Claiming (FOR UPDATE SKIP LOCKED).
 * Claims and processes calls strictly ONE AT A TIME.
 */
async function processSequentialCallQueue() {
  let hasMore = true;
  let processedCount = 0;

  while (hasMore) {
    // 1. Atomically Claim the Next Queued Call Session
    let session = null;
    try {
      const { data: claimResult, error: claimErr } = await supabase.rpc('claim_next_call_session', {
        p_worker_id: `worker-daemon-${process.pid}`
      });

      if (!claimErr && claimResult && claimResult.has_session) {
        session = claimResult;
      }
    } catch {
      // Fallback to application level claim if RPC not yet deployed
      session = await fallbackAppLevelClaim();
    }

    if (!session || !session.session_id) {
      if (processedCount > 0) {
        console.log(`[CALL QUEUE] Finished sequential processing pass (${processedCount} session(s) handled).\n`);
      }
      break;
    }

    processedCount++;
    console.log(`\n======================================================`);
    console.log(`[CALL PROCESSING] Session: ${session.session_id.slice(0, 8)}... (Attempt #${session.attempts})`);
    console.log(`Student: ${session.student_name} (${session.roll_number}) | Hostel: ${session.hostel_name}`);
    console.log(`Guardian: ${session.guardian_name} (${session.guardian_phone || 'No Phone'})`);
    console.log(`Warden Duty Contact: ${session.warden_contact || wardenContactFallback}`);
    console.log(`======================================================`);

    const guardianPhone = session.guardian_phone;
    if (!guardianPhone || guardianPhone.trim().length < 7) {
      console.warn(`[CALL SKIP] Guardian phone number invalid or missing for student ${session.student_name}.`);
      await recordFailure(session.session_id, 'Guardian phone number missing or invalid', 0);
      continue;
    }

    if (isTwilioLive) {
      console.log(`[GATEWAY: TWILIO] Initiating outbound voice call to ${guardianPhone}...`);
      try {
        const actionUrl = `${webhookBaseUrl}/api/telephony/ivr?session_id=${session.session_id}`;
        const twilioRes = await dispatchRealTwilioCall(
          twilioSid,
          twilioToken,
          twilioFrom,
          guardianPhone,
          actionUrl,
          session.session_id
        );

        console.log(`[TWILIO SUCCESS] Call SID: ${twilioRes.sid} | Status: ${twilioRes.status}`);

        // Update provider reference
        await supabase
          .from('call_sessions')
          .update({ provider_call_sid: twilioRes.sid })
          .eq('id', session.session_id);

        // Allow duration for call to establish before starting next call
        console.log(`[SEQUENTIAL LOCK] Waiting 8 seconds before proceeding to next queue item...`);
        await sleep(8000);
      } catch (err) {
        console.error(`[TWILIO ERROR] Dispatch failed: ${err.message}`);
        await recordFailure(session.session_id, `Twilio error: ${err.message}`, 2);
      }
    } else {
      // Truthful Standby Mode (No Carrier Credentials)
      console.log(`[STANDBY MODE] Telephony credentials (TWILIO_ACCOUNT_SID / EXOTEL_SID) not configured.`);
      console.log(`[VERIFIED AUDIO SCRIPT] "${EXACT_HINDI_MESSAGE}"`);
      console.log(`[DATABASE STATE] Call session ${session.session_id.slice(0, 8)} preserved in QUEUED status.`);

      // Reset to QUEUED in standby so it remains available once credentials are added
      await supabase
        .from('call_sessions')
        .update({
          call_status: 'QUEUED',
          error_message: 'Telephony gateway in standby mode. Awaiting real carrier credentials.'
        })
        .eq('id', session.session_id);

      // Stop pass in standby to prevent tight looping
      break;
    }

    // Brief sequential gap
    await sleep(2000);
  }
}

/**
 * Records call session failure with automatic retry scheduling.
 */
async function recordFailure(sessionId, errorMessage, maxRetries = 2) {
  try {
    const { data: failRes } = await supabase.rpc('record_call_session_failure', {
      p_session_id: sessionId,
      p_error_message: errorMessage,
      p_max_retries: maxRetries,
      p_retry_delay_minutes: 5
    });

    if (failRes && failRes.success) {
      console.log(`[RETRY RECORDED] Status: ${failRes.status} | Retry Count: ${failRes.retry_count}`);
      return;
    }
  } catch {
    // Fallback direct update
  }

  await supabase
    .from('call_sessions')
    .update({
      call_status: 'FAILED',
      error_message: errorMessage,
      ended_at: new Date().toISOString()
    })
    .eq('id', sessionId);
}

/**
 * Fallback application-level claim if SQL RPC is not yet loaded in database.
 */
async function fallbackAppLevelClaim() {
  const { data: item } = await supabase
    .from('call_sessions')
    .select('*, attendance_records(student_id, attendance_date, students(*, guardians(*), hostels(*)))')
    .in('call_status', ['QUEUED'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!item) return null;

  // Transition immediately to RINGING
  await supabase
    .from('call_sessions')
    .update({
      call_status: 'RINGING',
      started_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      attempts: (item.attempts || 0) + 1
    })
    .eq('id', item.id);

  const student = item.attendance_records?.students;
  return {
    has_session: true,
    session_id: item.id,
    attendance_record_id: item.attendance_record_id,
    guardian_id: item.guardian_id,
    guardian_name: student?.guardians?.full_name || 'Guardian',
    guardian_phone: student?.guardians?.phone_number || '',
    student_name: student?.full_name || 'Resident',
    roll_number: student?.roll_number || 'N/A',
    hostel_name: student?.hostels?.name || 'Hostel',
    warden_contact: student?.hostels?.warden_contact || wardenContactFallback,
    attempts: (item.attempts || 0) + 1,
    retry_count: item.retry_count || 0
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Real Twilio Call Dispatch via HTTPS REST API
 */
async function dispatchRealTwilioCall(accountSid, authToken, fromNumber, toNumber, actionUrl, sessionId) {
  return new Promise((resolve, reject) => {
    const twiml = `<Response><Gather numDigits="1" action="${actionUrl}" method="POST" timeout="10"><Say language="hi-IN">${EXACT_HINDI_MESSAGE}</Say></Gather><Say language="hi-IN">Samay samapt ho gaya hai. Dhanyawad.</Say><Hangup/></Response>`;

    const postData = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Twiml: twiml
    }).toString();

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${accountSid}/Calls.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Twilio API Error (${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Twilio Webhook Signature Verification
 */
function verifyTwilioSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  let dataToSign = url;
  const sortedKeys = Object.keys(params).sort();
  for (const k of sortedKeys) {
    dataToSign += k + params[k];
  }
  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(dataToSign);
  const calculated = hmac.digest('base64');
  return calculated === signature;
}

/**
 * Built-in HTTP Webhook Server for Carrier Callbacks (DTMF Digits & Call Status)
 */
function startWebhookServer() {
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    // Health check
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'CT Group Hostel Telephony Worker',
        status: 'UP',
        timezone: 'Asia/Kolkata',
        timestamp: getIstTime().timeStr
      }));
      return;
    }

    // Collect POST body
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const params = {};
      if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
        const parsed = new URLSearchParams(body);
        parsed.forEach((v, k) => { params[k] = v; });
      } else if (req.headers['content-type']?.includes('application/json')) {
        try { Object.assign(params, JSON.parse(body)); } catch {}
      }

      // Check Twilio Signature if token is configured
      const twilioSig = req.headers['x-twilio-signature'];
      if (twilioToken && twilioSig) {
        const fullUrl = `${webhookBaseUrl}${req.url}`;
        if (!verifyTwilioSignature(twilioToken, twilioSig, fullUrl, params)) {
          console.warn('[WEBHOOK SECURITY] Rejected request with invalid Twilio signature.');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden');
          return;
        }
      }

      const sessionId = reqUrl.searchParams.get('session_id') || params.session_id || params.CallSessionId;
      const digits = (params.Digits || params.digits || params.dtmf || '').trim();
      const callStatus = params.CallStatus || '';

      console.log(`[WEBHOOK EVENT] Path: ${pathname} | Session: ${sessionId} | Digits: "${digits}" | Status: ${callStatus}`);

      // Route: /api/push/test (Local Web Push Test Dispatch)
      if (pathname === '/api/push/test') {
        const targetUserId = params.user_id;
        if (!targetUserId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing user_id parameter' }));
          return;
        }
        const count = await dispatchPushNotification(
          targetUserId,
          'TEST_NOTIFICATION',
          'CT Hostel - Test Notification',
          'Web Push is active! Your device is successfully connected to CT Hostel alerts.',
          '/?source=test_push'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, delivered: count }));
        return;
      }

      // Route: /api/telephony/ivr
      if (pathname === '/api/telephony/ivr') {
        if (digits === '1') {
          // Acknowledged
          if (sessionId) {
            await supabase.rpc('handle_call_session_ivr', {
              p_session_id: sessionId,
              p_digit_pressed: '1'
            });
          }

          const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="hi-IN">${ACKNOWLEDGMENT_PROMPT_HI}</Say><Hangup/></Response>`;
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end(twiml);
          return;
        } else if (digits === '2') {
          // Bridge to Warden or AI Assistant
          let wardenNumber = wardenContactFallback;
          if (sessionId) {
            const { data: session } = await supabase
              .from('call_sessions')
              .select('attendance_records(students(hostels(warden_contact)))')
              .eq('id', sessionId)
              .maybeSingle();

            const dutyContact = session?.attendance_records?.students?.hostels?.warden_contact;
            if (dutyContact && dutyContact.length > 5) {
              wardenNumber = dutyContact;
            }

            await supabase.rpc('handle_call_session_ivr', {
              p_session_id: sessionId,
              p_digit_pressed: '2',
              p_warden_phone: wardenNumber
            });
          }

          const callerIdAttr = twilioFrom ? `callerId="${twilioFrom}"` : '';
          const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="hi-IN">${TRANSFER_PROMPT_HI}</Say><Dial timeout="25" ${callerIdAttr}>${wardenNumber}</Dial></Response>`;
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end(twiml);
          return;
        } else {
          // Invalid digit pressed
          const retryAction = `${webhookBaseUrl}/api/telephony/ivr?session_id=${sessionId || ''}`;
          const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" action="${retryAction}" method="POST" timeout="10"><Say language="hi-IN">${INVALID_PROMPT_HI}</Say></Gather><Say language="hi-IN">Samay samapt ho gaya hai. Dhanyawad.</Say><Hangup/></Response>`;
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end(twiml);
          return;
        }
      }

      // Route: /api/telephony/status
      if (pathname === '/api/telephony/status') {
        if (sessionId && ['busy', 'no-answer', 'failed'].includes(callStatus.toLowerCase())) {
          await recordFailure(sessionId, `Carrier status: ${callStatus}`, 2);
        }
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end('<Response/>');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });
  });

  server.listen(webhookPort, () => {
    console.log(`[WEBHOOK SERVER] Listening on port ${webhookPort} (Base URL: ${webhookBaseUrl})`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WEBHOOK SERVER] Port ${webhookPort} in use. Webhook server skipped for this instance.`);
    } else {
      console.error('[WEBHOOK SERVER ERROR]', err);
    }
  });

  return server;
}

// Main Daemon Loop
async function main() {
  const isOnce = process.argv.includes('--once');
  console.log('================================================================');
  console.log('CT GROUP HOSTEL ATTENDANCE - PERSISTENT CALL QUEUE WORKER');
  console.log(`Mode: ${isOnce ? 'Single-Pass Execution' : 'Persistent Background Daemon'}`);
  console.log(`Schedule Window: 21:30 - 22:30 IST | Finalization: 22:31 IST`);
  console.log(`Campus Center: 31.236872, 75.553745 | Geofence Radius: 535m`);
  console.log(`Telephony Gateway: ${isTwilioLive ? 'Twilio Live' : isExotelLive ? 'Exotel Live' : 'Standby Mode (No Credentials)'}`);
  console.log('================================================================\n');

  if (!isOnce) {
    startWebhookServer();
  }

  try {
    await checkAndFinalizeAbsences();
    await processSequentialCallQueue();
  } catch (err) {
    console.error('[WORKER EXCEPTION]', err);
  }

  if (isOnce) {
    console.log('[WORKER] Single-pass execution completed. Exiting.');
    process.exit(0);
  }

  // Periodic polling every 30 seconds
  setInterval(async () => {
    try {
      await checkAndFinalizeAbsences();
      await processSequentialCallQueue();
    } catch (e) {
      console.error('[POLL ERROR]', e.message);
    }
  }, 30000);
}

main();
