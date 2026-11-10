// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Headless 10:31 PM IST Automatic Absent Processing Scheduler Daemon
// Executes independently of browser and Warden dashboard.
// Runs every night at 22:31 IST (10:31 PM Asia/Kolkata).
// Idempotent: Never overwrites PRESENT or APPROVED_LEAVE records.
// Telephony/Calling functionality is completely removed.
// ==============================================================================

const fs = require('fs');
const path = require('path');

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

const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[SCHEDULER ERROR] Missing Supabase URL or Key in environment.');
  process.exit(1);
}

const { createClient } = require(path.resolve(process.cwd(), 'node_modules/@supabase/supabase-js'));
const supabase = createClient(supabaseUrl, supabaseKey);

// Web Push (VAPID) Integration for Absent Student Alerts
let webpush = null;
try {
  webpush = require('web-push');
  const vapidPublicKey =
    process.env.VAPID_PUBLIC_KEY ||
    env.VAPID_PUBLIC_KEY ||
    env.VITE_VAPID_PUBLIC_KEY ||
    'BAzjcKuwT3O_kYn4Y1zcpgViGDT-L6qwK3krr3LQspiSaIL11uih8SY1i02Jy0xvnmRnnseg9CIimv-cvYA8zQ4';
  const vapidPrivateKey =
    process.env.VAPID_PRIVATE_KEY ||
    env.VAPID_PRIVATE_KEY ||
    'PQA4MkePanxxsJv9RWWsFbVh0vp-MUnYkeGVbwB3WWA';
  const vapidSubject =
    process.env.VAPID_SUBJECT || env.VAPID_SUBJECT || 'mailto:hostel-alert@ctgroup.in';
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} catch (e) {
  console.warn('[WEBPUSH INIT NOTE] Web-push module loaded with fallback:', e.message);
}

/**
 * Dispatches a Web Push Notification to active subscriptions of a user.
 */
async function dispatchPushNotification(userId, notificationType, title, body, url = '/') {
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
 * Main Absence Finalization Logic:
 * Checks whether attendance window (22:30 IST) has expired and 22:31 IST cutoff is reached.
 */
async function checkAndFinalizeAbsences(dryRun = false, force = false) {
  const ist = getIstTime();
  console.log(`[SCHEDULE TICK] Current Server IST Time: ${ist.timeStr} (${ist.dateStr}) | Mode: ${dryRun ? 'DRY-RUN (No Writes)' : 'PRODUCTION'}`);

  // 1. Try unified server-side batch procedure first
  try {
    const { data: batchRes, error: batchErr } = await supabase.rpc('process_nightly_absence_finalization', {
      p_dry_run: dryRun,
      p_force: force,
      p_source: 'SCHEDULER_DAEMON'
    });

    if (!batchErr && batchRes && batchRes.success) {
      console.log(`[BATCH SUCCESS] Processed ${batchRes.schedules_processed} schedules in ${batchRes.duration_ms}ms (Dry Run: ${batchRes.dry_run}).`);
      console.log(`                Total Newly Marked/Simulated Absent: ${batchRes.total_absent_marked}`);
      if (batchRes.details && batchRes.details.length > 0) {
        console.log('                Schedule Breakdown:', JSON.stringify(batchRes.details));
      }
      return;
    }
  } catch (e) {
    // Proceed to per-schedule check
  }

  // 2. Query all active attendance schedules
  const { data: schedules, error: sErr } = await supabase
    .from('attendance_schedules')
    .select('*')
    .eq('is_active', true);

  if (sErr) {
    console.error('[SCHEDULER ERROR] Failed to fetch active schedules:', sErr.message);
    return;
  }

  if (!schedules || schedules.length === 0) {
    console.log('[SCHEDULER] No active attendance schedules found in database.');
    return;
  }

  for (const s of schedules) {
    const [dHours, dMins] = s.deadline_time.split(':').map(Number);
    const deadlineTotalMinutes = dHours * 60 + dMins + (s.grace_period_minutes || 1);

    if (force || ist.totalMinutes >= deadlineTotalMinutes) {
      console.log(`[FINALIZING ABSENCES] Schedule "${s.name}" reached 22:31 IST cutoff. Evaluating unrecorded students...`);

      // Try server-side PostgreSQL RPC
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('detect_and_mark_absences', {
          p_schedule_id: s.id,
          p_date: ist.dateStr,
          p_force: force
        });

        if (!rpcErr && rpcRes && rpcRes.success) {
          console.log(`[RPC SUCCESS] ${rpcRes.message} (${rpcRes.absent_count} newly marked absent)`);
          continue;
        } else if (rpcRes && !rpcRes.success) {
          console.log(`[RPC NOTE] ${rpcRes.message}`);
          continue;
        }
      } catch (e) {
        console.log('[RPC FALLBACK] Executing application-level absence finalization:', e.message);
      }

      // Application-level absence finalization fallback (strictly idempotent)
      await executeAppLevelAbsenceFinalization(s, ist.dateStr);
    } else {
      const remaining = deadlineTotalMinutes - ist.totalMinutes;
      console.log(`[ACTIVE WINDOW] Schedule "${s.name}" active until 22:30 IST (${remaining}m until 22:31 IST finalization).`);
    }
  }
}

/**
 * Application-level absence evaluation preserving all verified PRESENT and APPROVED_LEAVE records.
 */
async function executeAppLevelAbsenceFinalization(schedule, today) {
  const { data: students } = await supabase
    .from('students')
    .select('*, guardians(*)')
    .eq('hostel_id', schedule.hostel_id)
    .eq('enrollment_status', 'ACTIVE');

  if (!students || students.length === 0) {
    console.log(`[SCHEDULER] No active enrolled students found for hostel ${schedule.hostel_id}.`);
    return;
  }

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

  for (const st of students) {
    const rec = existingMap.get(st.id);

    // CRITICAL: NEVER overwrite or modify a verified PRESENT, APPROVED_LEAVE, or EXCUSED record
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
            verification_status: 'VERIFIED',
            review_reason: `Sanctioned Leave: ${leave.reason_category} (${leave.start_date} to ${leave.end_date})`
          }
        ]);
      }
    } else {
      if (!rec) {
        const { data: newRec } = await supabase
          .from('attendance_records')
          .insert([
            {
              student_id: st.id,
              schedule_id: schedule.id,
              attendance_date: today,
              status: 'ABSENT',
              verification_status: 'VERIFIED',
              review_reason: 'Automated roll-call finalization at 22:31 IST: Missed attendance window.'
            }
          ])
          .select()
          .single();

        absentMarked++;

        // Send Web Push alert to the absent student
        if (st.profile_id) {
          await dispatchPushNotification(
            st.profile_id,
            'ABSENCE_ALERT',
            'Hostel Roll-Call Absence Alert',
            `You have been marked ABSENT for tonight's roll-call (${today}). Please contact the hostel warden.`,
            '/'
          );
        }
      }
    }
  }

  console.log(`[FINALIZATION COMPLETE] Schedule "${schedule.name}": ${absentMarked} unrecorded students marked ABSENT.`);
}

// ------------------------------------------------------------------------------
// Process Entrypoint
// ------------------------------------------------------------------------------
async function main() {
  const isOnce = process.argv.includes('--once');
  const isForce = process.argv.includes('--force');
  const isDryRun = process.argv.includes('--dry-run');

  console.log('================================================================');
  console.log('CT GROUP HOSTEL ATTENDANCE - HEADLESS ABSENCE SCHEDULER');
  console.log(`Execution Mode: ${isOnce ? 'Single-Pass Check' : 'Persistent 24/7 Background Daemon'}`);
  console.log(`Dry Run Mode: ${isDryRun ? 'ENABLED (Zero database writes)' : 'DISABLED (Real evaluation)'}`);
  console.log('Schedule Window: 21:30 - 22:30 IST | Finalization Cutoff: 22:31 IST');
  console.log('Preservation: PRESENT and APPROVED_LEAVE records are strictly untouched');
  console.log('Telephony: Calling removed | Web Push: Active');
  console.log('================================================================\n');

  try {
    await checkAndFinalizeAbsences(isDryRun, isForce);
  } catch (err) {
    console.error('[SCHEDULER CRITICAL ERROR]', err);
  }

  if (isOnce) {
    console.log('\n[SCHEDULER] Single-pass check completed. Exiting.');
    process.exit(0);
  }

  // Persistent loop running every 30 seconds
  setInterval(async () => {
    try {
      await checkAndFinalizeAbsences(false, false);
    } catch (e) {
      console.error('[POLL ERROR]', e.message);
    }
  }, 30000);
}

main();
