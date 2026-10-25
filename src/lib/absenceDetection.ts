// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Automated Absence Detection & Roll-Call Finalization Engine
// Idempotent Schedule Deadline Evaluation & Guardian Escalation Queueing
// ==============================================================================

import { supabase, isSupabaseConfigured } from './supabase';
import { AttendanceSchedule, Student, LeaveRequest, AttendanceRecord } from '../types/database';

export interface AbsenceDetectionResult {
  success: boolean;
  scheduleName: string;
  attendanceDate: string;
  totalEligibleStudents: number;
  presentCount: number;
  approvedLeaveCount: number;
  newlyMarkedAbsent: number;
  queuedGuardianCalls: number;
  isWindowClosed: boolean;
  message: string;
}

/**
 * Returns current timestamp in Asia/Kolkata (IST) timezone.
 */
export function getIstCurrentDate(): Date {
  const istString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  return new Date(istString);
}

/**
 * Checks whether an attendance schedule's window (deadline + finalization cutoff) has closed in IST.
 * - Attendance window closes at deadline (e.g. 22:30 IST)
 * - Absence finalization & call processing begins at deadline + 1 minute (e.g. 22:31 IST)
 */
export function isScheduleWindowClosed(
  schedule: AttendanceSchedule,
  referenceDate?: Date
): {
  isClosed: boolean;
  canFinalizeAbsences: boolean;
  deadlineWithGrace: string;
  finalizationTime: string;
  remainingMinutes: number;
} {
  const now = referenceDate || getIstCurrentDate();
  const [deadlineHour, deadlineMinute] = schedule.deadline_time.split(':').map(Number);
  const graceMinutes = schedule.grace_period_minutes !== undefined ? schedule.grace_period_minutes : 1;

  const windowCloseDate = new Date(now);
  windowCloseDate.setHours(deadlineHour, deadlineMinute, 0, 0);

  // Finalization cutoff is deadline + grace period (at 22:31 IST)
  const finalizationCutoff = new Date(windowCloseDate.getTime() + Math.max(1, graceMinutes) * 60 * 1000);

  const isWindowClosed = now.getTime() >= windowCloseDate.getTime();
  const canFinalize = now.getTime() >= finalizationCutoff.getTime();
  const diffMs = finalizationCutoff.getTime() - now.getTime();
  const remainingMinutes = Math.max(0, Math.round(diffMs / (60 * 1000)));

  return {
    isClosed: isWindowClosed,
    canFinalizeAbsences: canFinalize,
    deadlineWithGrace: windowCloseDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    finalizationTime: finalizationCutoff.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    remainingMinutes
  };
}

/**
 * Executes idempotent absence detection for a specific attendance schedule.
 * First tries server-side PostgreSQL RPC `detect_and_mark_absences`.
 * If RPC is not deployed, executes resilient client-side batch evaluation with Supabase RLS.
 */
export async function runAbsenceDetection(
  scheduleId: string,
  targetDate?: string,
  forceRunBeforeDeadline = false
): Promise<AbsenceDetectionResult> {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return {
      success: false,
      scheduleName: 'Unknown',
      attendanceDate: targetDate || new Date().toISOString().split('T')[0],
      totalEligibleStudents: 0,
      presentCount: 0,
      approvedLeaveCount: 0,
      newlyMarkedAbsent: 0,
      queuedGuardianCalls: 0,
      isWindowClosed: false,
      message: 'Supabase database is not configured.'
    };
  }

  const today = targetDate || new Date().toISOString().split('T')[0];

  // 1. Fetch Schedule Details
  const { data: scheduleData, error: schedError } = await supabase
    .from('attendance_schedules')
    .select('*, hostels(name)')
    .eq('id', scheduleId)
    .single();

  if (schedError || !scheduleData) {
    return {
      success: false,
      scheduleName: 'Unknown',
      attendanceDate: today,
      totalEligibleStudents: 0,
      presentCount: 0,
      approvedLeaveCount: 0,
      newlyMarkedAbsent: 0,
      queuedGuardianCalls: 0,
      isWindowClosed: false,
      message: schedError ? schedError.message : 'Schedule not found'
    };
  }

  const schedule = scheduleData as AttendanceSchedule;
  const windowStatus = isScheduleWindowClosed(schedule);

  // Enforce rule: Do not finalize absences before 22:31 IST unless explicitly forced by administrator
  if (!windowStatus.canFinalizeAbsences && !forceRunBeforeDeadline) {
    return {
      success: false,
      scheduleName: schedule.name,
      attendanceDate: today,
      totalEligibleStudents: 0,
      presentCount: 0,
      approvedLeaveCount: 0,
      newlyMarkedAbsent: 0,
      queuedGuardianCalls: 0,
      isWindowClosed: windowStatus.isClosed,
      message: `Roll-call window closes at ${windowStatus.deadlineWithGrace} IST. Absence list finalization & guardian call processing begins at ${windowStatus.finalizationTime} IST (${windowStatus.remainingMinutes} min remaining).`
    };
  }

  // 2. Try Trusted Server-Side PostgreSQL RPC First
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('detect_and_mark_absences', {
      p_schedule_id: schedule.id,
      p_date: today
    });

    if (!rpcError && rpcResult && rpcResult.success) {
      return {
        success: true,
        scheduleName: schedule.name,
        attendanceDate: today,
        totalEligibleStudents: 0,
        presentCount: 0,
        approvedLeaveCount: 0,
        newlyMarkedAbsent: rpcResult.absent_count || 0,
        queuedGuardianCalls: rpcResult.queued_calls || 0,
        isWindowClosed: true,
        message: rpcResult.message || 'Absence detection executed via server RPC.'
      };
    }
  } catch (rpcEx) {
    console.info('Server RPC detect_and_mark_absences fallback to application query:', rpcEx);
  }

  // 3. Application-Level Resilient Absence Evaluation & Escalation
  try {
    // 3.1 Fetch eligible active students in this hostel
    const { data: students, error: stErr } = await supabase
      .from('students')
      .select('*, guardians(*)')
      .eq('hostel_id', schedule.hostel_id)
      .eq('enrollment_status', 'ACTIVE');

    if (stErr || !students) {
      throw new Error(`Failed to query enrolled students: ${stErr?.message}`);
    }

    // 3.2 Fetch existing attendance records for today
    const { data: existingRecords, error: attErr } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('schedule_id', schedule.id)
      .eq('attendance_date', today);

    if (attErr) {
      throw new Error(`Failed to query attendance records: ${attErr.message}`);
    }

    const recordedMap = new Map<string, AttendanceRecord>();
    (existingRecords || []).forEach((r) => recordedMap.set(r.student_id, r as AttendanceRecord));

    // 3.3 Fetch active approved leave requests for today
    const { data: approvedLeaves } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('approval_status', 'APPROVED')
      .lte('start_date', today)
      .gte('end_date', today);

    const leaveMap = new Map<string, LeaveRequest>();
    (approvedLeaves || []).forEach((l) => leaveMap.set(l.student_id, l as LeaveRequest));

    let newlyMarkedAbsent = 0;
    let queuedCalls = 0;
    let presentCount = 0;
    let approvedLeaveCount = 0;

    for (const st of students as Student[]) {
      const existing = recordedMap.get(st.id);

      if (existing) {
        if (existing.status === 'PRESENT') presentCount++;
        if (existing.status === 'APPROVED_LEAVE' || existing.status === 'EXCUSED') approvedLeaveCount++;
        continue;
      }

      // Check if student has approved leave
      const activeLeave = leaveMap.get(st.id);

      if (activeLeave) {
        // Idempotent sanctioned leave record
        await supabase.from('attendance_records').insert([
          {
            student_id: st.id,
            schedule_id: schedule.id,
            attendance_date: today,
            status: 'APPROVED_LEAVE',
            submitted_at: new Date().toISOString(),
            verification_status: 'VERIFIED',
            review_reason: `Sanctioned leave: ${activeLeave.reason_category} (${activeLeave.start_date} to ${activeLeave.end_date})`
          }
        ]);
        approvedLeaveCount++;
      } else {
        // Student missed roll call -> Mark ABSENT
        const { data: absentRecord, error: insErr } = await supabase
          .from('attendance_records')
          .insert([
            {
              student_id: st.id,
              schedule_id: schedule.id,
              attendance_date: today,
              status: 'ABSENT',
              submitted_at: new Date().toISOString(),
              verification_status: 'VERIFIED',
              review_reason: 'Automated absence finalization: Missed roll-call window & grace period.'
            }
          ])
          .select('id')
          .single();

        if (!insErr && absentRecord) {
          newlyMarkedAbsent++;

          // 1. FREE Guardian In-App Notification (Instantaneous & Idempotent)
          if (st.guardian_id) {
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
                  attendance_record_id: absentRecord.id,
                  attendance_date: today,
                  title: 'Hostel Absence Notice',
                  message: noticeMessage,
                  is_read: false
                }
              ]);
            }

            // 2. Telephony Voice Call Queueing
            const { data: existingEvent } = await supabase
              .from('notification_events')
              .select('id')
              .eq('attendance_record_id', absentRecord.id)
              .eq('event_type', 'ABSENCE_CALL')
              .maybeSingle();

            if (!existingEvent) {
              await supabase.from('notification_events').insert([
                {
                  attendance_record_id: absentRecord.id,
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
                  attendance_record_id: absentRecord.id,
                  call_status: 'QUEUED',
                  transfer_requested: false
                }
              ]);

              queuedCalls++;
            }
          }
        }
      }
    }

    return {
      success: true,
      scheduleName: schedule.name,
      attendanceDate: today,
      totalEligibleStudents: students.length,
      presentCount,
      approvedLeaveCount,
      newlyMarkedAbsent,
      queuedGuardianCalls: queuedCalls,
      isWindowClosed: true,
      message: `Roll-call finalization complete. ${newlyMarkedAbsent} resident(s) marked ABSENT. ${queuedCalls} guardian voice call(s) queued.`
    };
  } catch (err: unknown) {
    return {
      success: false,
      scheduleName: schedule.name,
      attendanceDate: today,
      totalEligibleStudents: 0,
      presentCount: 0,
      approvedLeaveCount: 0,
      newlyMarkedAbsent: 0,
      queuedGuardianCalls: 0,
      isWindowClosed: windowStatus.isClosed,
      message: err instanceof Error ? err.message : 'Absence detection error'
    };
  }
}
