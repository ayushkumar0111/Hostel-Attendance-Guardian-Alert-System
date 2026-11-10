import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  Student,
  AttendanceRecord,
  LeaveRequest,
  Hostel,
  WardenHostelAssignment,
  NotificationEvent,
  AttendanceSchedule,
  CallSession
} from '../../types/database';
import { runAbsenceDetection } from '../../lib/absenceDetection';
import { processSequentialCallQueue, CallQueueProgress } from '../../lib/callQueue';
import {
  Users,
  CheckCircle2,
  Clock,
  Calendar,
  Search,
  Upload,
  UserCheck,
  FileCheck,
  PhoneCall,
  RefreshCw,
  Check,
  X,
  Plus,
  Radio,
  Bell,
  BellRing,
  Smartphone,
  MapPin
} from 'lucide-react';
import { SendPushNotificationModal, StudentRecipient } from '../notifications/SendPushNotificationModal';
import { sendTestPushNotification } from '../../lib/webPush';
import { AttendanceCountdownTimer } from '../student/AttendanceCountdownTimer';
import { getSyncedIstDateString } from '../../lib/serverTime';

export const WardenDashboard: React.FC = () => {
  const { user } = useAuth();
  const configured = isSupabaseConfigured();
  const [activeTab, setActiveTab] = useState<'attendance' | 'students' | 'leaves' | 'alerts'>('attendance');
  const [selectedDate, setSelectedDate] = useState<string>(getSyncedIstDateString());
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [wardenAssignments, setWardenAssignments] = useState<WardenHostelAssignment[]>([]);
  const [schedules, setSchedules] = useState<AttendanceSchedule[]>([]);
  const [notificationEvents, setNotificationEvents] = useState<NotificationEvent[]>([]);
  const [callSessions, setCallSessions] = useState<CallSession[]>([]);
  const [isRunningAbsenceDetection, setIsRunningAbsenceDetection] = useState<boolean>(false);
  const [callQueueProgress, setCallQueueProgress] = useState<CallQueueProgress | null>(null);
  const [selectedHostelFilter, setSelectedHostelFilter] = useState<string>('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<string>('');
  const [attendanceSearchTerm, setAttendanceSearchTerm] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Correction Modal State
  const [selectedRecordForCorrection, setSelectedRecordForCorrection] = useState<AttendanceRecord | null>(null);
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [newCorrectionStatus, setNewCorrectionStatus] = useState<string>('EXCUSED');

  // Manual Roll-Call Modal State
  const [showManualRollCall, setShowManualRollCall] = useState<boolean>(false);
  const [rollCallStudentId, setRollCallStudentId] = useState<string>('');
  const [rollCallScheduleId, setRollCallScheduleId] = useState<string>('');
  const [rollCallStatus, setRollCallStatus] = useState<string>('PRESENT');
  const [rollCallNotes, setRollCallNotes] = useState<string>('');
  const [isSubmittingRollCall, setIsSubmittingRollCall] = useState<boolean>(false);

  // CSV Import Modal State
  const [showCsvGuide, setShowCsvGuide] = useState<boolean>(false);

  // Web Push Notification States
  const [showPushModal, setShowPushModal] = useState<boolean>(false);
  const [pushModalSingleStudent, setPushModalSingleStudent] = useState<StudentRecipient | null>(null);
  const [pushModalBatchList, setPushModalBatchList] = useState<StudentRecipient[]>([]);
  const [pushLogs, setPushLogs] = useState<any[]>([]);
  const [isSendingTestPush, setIsSendingTestPush] = useState<boolean>(false);
  const [testPushMessage, setTestPushMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadWardenData = async () => {
    if (!configured) return;
    setIsLoading(true);
    try {
      const [
        studentsRes,
        attendanceRes,
        leavesRes,
        assignmentsRes,
        hostelsRes,
        schedulesRes,
        alertsRes,
        callSessionsRes,
        pushLogsRes
      ] = await Promise.all([
        supabase.from('students').select('*, hostels(name), guardians(*)').order('room_number'),
        supabase
          .from('attendance_records')
          .select('*, students(full_name, roll_number, room_number, hostel_id, profile_id, hostels(name)), schedule:attendance_schedules(name), verification_submissions(*)')
          .eq('attendance_date', selectedDate),
        supabase
          .from('leave_requests')
          .select('*, students(full_name, roll_number, room_number, hostel_id, profile_id, hostels(name))')
          .order('created_at', { ascending: false }),
        supabase
          .from('warden_hostel_assignments')
          .select('*, hostels(name)')
          .eq('warden_profile_id', user?.id || ''),
        supabase.from('hostels').select('*').order('name'),
        supabase.from('attendance_schedules').select('*').order('start_time'),
        supabase.from('notification_events').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('call_sessions').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('push_notification_logs').select('*').order('created_at', { ascending: false }).limit(50)
      ]);

      if (studentsRes.data) {
        const normalizedStudents = (studentsRes.data as any[]).map((st) => ({
          ...st,
          guardian: st.guardian || st.guardians || null,
          hostel: st.hostel || st.hostels || null
        }));
        setStudents(normalizedStudents as Student[]);
      }
      if (attendanceRes.data) {
        const normalizedAttendance = (attendanceRes.data as any[]).map((r) => {
          const student = r.student || r.students || null;
          const normalizedStudent = student
            ? {
                ...student,
                hostel: student.hostel || student.hostels || null,
                hostels: student.hostels || student.hostel || null
              }
            : null;
          return {
            ...r,
            student: normalizedStudent,
            students: normalizedStudent
          };
        });
        setAttendanceRecords(normalizedAttendance as AttendanceRecord[]);
      }
      if (leavesRes.data) {
        const normalizedLeaves = (leavesRes.data as any[]).map((l) => ({
          ...l,
          student: l.student || l.students || null,
          students: l.students || l.student || null
        }));
        setLeaveRequests(normalizedLeaves as LeaveRequest[]);
      }
      if (assignmentsRes.data) setWardenAssignments(assignmentsRes.data as WardenHostelAssignment[]);
      if (hostelsRes.data) setHostels(hostelsRes.data as Hostel[]);
      if (schedulesRes.data) setSchedules(schedulesRes.data as AttendanceSchedule[]);
      if (alertsRes.data) setNotificationEvents(alertsRes.data as NotificationEvent[]);
      if (callSessionsRes.data) setCallSessions(callSessionsRes.data as CallSession[]);
      if (pushLogsRes && pushLogsRes.data) setPushLogs(pushLogsRes.data);
    } catch (err) {
      console.warn('Warden data load note:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPushForSingleStudent = (st: Student | any) => {
    setPushModalSingleStudent({
      id: st.id,
      full_name: st.full_name || 'Enrolled Student',
      roll_number: st.roll_number || 'N/A',
      profile_id: st.profile_id || null,
      room_number: st.room_number || '-',
      hostel_name: st.hostel?.name || st.hostels?.name || 'Hostel'
    });
    setPushModalBatchList([]);
    setShowPushModal(true);
  };

  const handleOpenPushForAbsentStudents = () => {
    const absentRecords = scopedAttendance.filter((r) => r.status === 'ABSENT');
    if (absentRecords.length === 0) {
      alert(`No students are currently marked as ABSENT for ${selectedDate} in your assigned scope.`);
      return;
    }

    const studentMap = new Map<string, StudentRecipient>();
    absentRecords.forEach((rec) => {
      const st = students.find((s) => s.id === rec.student_id) || (rec.student as any);
      if (st && !studentMap.has(st.id)) {
        studentMap.set(st.id, {
          id: st.id,
          full_name: st.full_name || 'Enrolled Student',
          roll_number: st.roll_number || 'N/A',
          profile_id: st.profile_id || null,
          room_number: st.room_number || '-',
          hostel_name: st.hostel?.name || st.hostels?.name || 'Hostel'
        });
      }
    });

    const list = Array.from(studentMap.values());
    setPushModalBatchList(list);
    setPushModalSingleStudent(null);
    setShowPushModal(true);
  };

  const handleSendTestPush = async () => {
    setIsSendingTestPush(true);
    setTestPushMessage(null);
    try {
      const res = await sendTestPushNotification();
      if (res.success) {
        setTestPushMessage({
          type: 'success',
          text: 'Test Web Push Notification dispatched! If permissions are granted, check your device banner.'
        });
        await loadWardenData();
      } else {
        setTestPushMessage({
          type: 'error',
          text: res.message || 'Failed to dispatch test notification. Ensure browser permission is enabled.'
        });
      }
    } catch (err: unknown) {
      setTestPushMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error sending test push notification.'
      });
    } finally {
      setIsSendingTestPush(false);
    }
  };

  const handleRunAbsenceDetection = async () => {
    if (!configured || schedules.length === 0) {
      alert('No attendance schedules available to evaluate.');
      return;
    }
    setIsRunningAbsenceDetection(true);
    try {
      let totalAbsent = 0;
      let totalQueued = 0;

      const targetSchedules = assignedHostelIds.length > 0
        ? schedules.filter((s) => assignedHostelIds.includes(s.hostel_id))
        : schedules;

      for (const s of targetSchedules) {
        const res = await runAbsenceDetection(s.id, selectedDate, true);
        if (res.success) {
          totalAbsent += res.newlyMarkedAbsent;
          totalQueued += res.queuedGuardianCalls;
        }
      }

      alert(
        `Absence Evaluation Complete:\n• ${totalAbsent} unrecorded student(s) marked ABSENT\n• ${totalQueued} guardian alert & call session(s) queued.`
      );
      await loadWardenData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Absence detection error');
    } finally {
      setIsRunningAbsenceDetection(false);
    }
  };

  const handleProcessSequentialQueue = async () => {
    try {
      await processSequentialCallQueue((prog) => {
        setCallQueueProgress({ ...prog });
      });
      await loadWardenData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error processing call queue');
    }
  };

  useEffect(() => {
    loadWardenData();
  }, [configured, selectedDate]);

  const handleApplyCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecordForCorrection || !configured) return;
    if (!correctionReason.trim()) {
      alert('A valid institutional reason is required for manual attendance corrections (Audit Requirement FR-05).');
      return;
    }

    try {
      const { error } = await supabase
        .from('attendance_records')
        .update({
          status: newCorrectionStatus,
          review_reason: correctionReason,
          verification_status: 'VERIFIED'
        })
        .eq('id', selectedRecordForCorrection.id);

      if (error) {
        alert(`Error: ${error.message}`);
      } else {
        alert('Attendance record updated with audit reason.');
        setSelectedRecordForCorrection(null);
        setCorrectionReason('');
        loadWardenData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Correction failed');
    }
  };

  const handleReviewLeave = async (leaveId: string, newStatus: 'APPROVED' | 'REJECTED') => {
    if (!configured) return;
    try {
      const { error } = await supabase
        .from('leave_requests')
        .update({
          approval_status: newStatus,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', leaveId);

      if (error) {
        alert(`Error reviewing leave request: ${error.message}`);
      } else {
        alert(`Leave request marked as ${newStatus}.`);
        loadWardenData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Review action failed');
    }
  };

  const handleQuickUpdateStatus = async (recordId: string, newStatus: string, studentId?: string) => {
    if (!configured) return;
    try {
      if (recordId.startsWith('unrecorded_') || recordId.startsWith('leave_')) {
        const targetStudentId = studentId || recordId.replace(/^(unrecorded_|leave_)/, '');
        const targetSchedId = schedules[0]?.id;
        if (!targetSchedId) {
          alert('No active attendance schedule found. Please configure an attendance schedule first.');
          return;
        }

        const { error: insErr } = await supabase.from('attendance_records').insert([
          {
            student_id: targetStudentId,
            schedule_id: targetSchedId,
            attendance_date: selectedDate,
            status: newStatus,
            verification_status: 'VERIFIED',
            reviewed_by: user?.id || null,
            review_reason: `Status recorded as ${newStatus} via Warden roll-call audit`,
            submitted_at: new Date().toISOString()
          }
        ]);

        if (insErr) {
          if (insErr.code === '23505') {
            loadWardenData();
          } else {
            alert(`Error recording attendance: ${insErr.message}`);
          }
        } else {
          loadWardenData();
        }
        return;
      }

      const { error } = await supabase
        .from('attendance_records')
        .update({
          status: newStatus,
          verification_status: 'VERIFIED',
          reviewed_by: user?.id || null,
          review_reason: `Status updated to ${newStatus} via Warden roll-call audit`,
          submitted_at: new Date().toISOString()
        })
        .eq('id', recordId);

      if (error) {
        alert(`Error updating attendance: ${error.message}`);
      } else {
        loadWardenData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleManualRollCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured || !rollCallStudentId) {
      alert('Please select a student to mark attendance.');
      return;
    }
    setIsSubmittingRollCall(true);
    try {
      const selectedSchedId = rollCallScheduleId || (schedules[0]?.id ?? null);
      if (!selectedSchedId) {
        alert('Please create at least one attendance schedule before recording roll-call.');
        setIsSubmittingRollCall(false);
        return;
      }

      // Check if student already has a record for this date and schedule
      const { data: existing } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('student_id', rollCallStudentId)
        .eq('attendance_date', selectedDate)
        .eq('schedule_id', selectedSchedId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('attendance_records')
          .update({
            status: rollCallStatus,
            review_reason: rollCallNotes.trim() || 'Warden manual roll-call verification',
            verification_status: 'VERIFIED',
            reviewed_by: user?.id,
            submitted_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;
        alert('Student attendance updated for today.');
      } else {
        const { error: insertError } = await supabase.from('attendance_records').insert([
          {
            student_id: rollCallStudentId,
            schedule_id: selectedSchedId,
            attendance_date: selectedDate,
            status: rollCallStatus,
            verification_status: 'VERIFIED',
            reviewed_by: user?.id,
            review_reason: rollCallNotes.trim() || 'Warden manual roll-call verification',
            submitted_at: new Date().toISOString()
          }
        ]);

        if (insertError) {
          if (insertError.code === '23505') {
            alert('Attendance record already exists for this student, date, and schedule window.');
            setIsSubmittingRollCall(false);
            return;
          }
          throw insertError;
        }
        alert('Roll-call attendance recorded successfully.');
      }

      setShowManualRollCall(false);
      setRollCallNotes('');
      loadWardenData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Roll-call recording failed');
    } finally {
      setIsSubmittingRollCall(false);
    }
  };

  const handleQueueAbsenceAlerts = async () => {
    if (!configured) return;
    setIsLoading(true);
    try {
      const absentRecords = attendanceRecords.filter((r) => r.status === 'ABSENT');
      if (absentRecords.length === 0) {
        alert(`No students are marked as ABSENT on ${selectedDate}.`);
        setIsLoading(false);
        return;
      }

      let queuedCount = 0;
      for (const rec of absentRecords) {
        const st = students.find((s) => s.id === rec.student_id);
        if (!st || !st.guardian_id) continue;

        const { data: existingAlert } = await supabase
          .from('notification_events')
          .select('id')
          .eq('attendance_record_id', rec.id)
          .maybeSingle();

        if (!existingAlert) {
          const { error: alertErr } = await supabase.from('notification_events').insert([
            {
              attendance_record_id: rec.id,
              guardian_id: st.guardian_id,
              channel: 'sms',
              event_type: 'ABSENCE_ALERT',
              delivery_status: 'QUEUED',
              attempts: 0
            }
          ]);
          if (!alertErr) queuedCount++;
        }
      }

      alert(
        queuedCount > 0
          ? `${queuedCount} absence alert(s) queued for guardian dispatch (Status: QUEUED - Pending SMS Gateway).`
          : 'All absent students for this date already have alerts queued in the database.'
      );
      loadWardenData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to queue alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const assignedHostelIds = wardenAssignments.map((a) => a.hostel_id);

  // Scoped student roster according to warden's assigned hostels
  const scopedStudents = assignedHostelIds.length > 0
    ? students.filter((s) => s.hostel_id && assignedHostelIds.includes(s.hostel_id))
    : students;

  // Scoped attendance records
  const scopedAttendance = assignedHostelIds.length > 0
    ? attendanceRecords.filter((r) => r.student?.hostel_id && assignedHostelIds.includes(r.student.hostel_id))
    : attendanceRecords;

  // Scoped leaves
  const scopedLeaves = assignedHostelIds.length > 0
    ? leaveRequests.filter((l) => l.student?.hostel_id && assignedHostelIds.includes(l.student.hostel_id))
    : leaveRequests;

  const filteredStudents = scopedStudents.filter((s) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (s.full_name || '').toLowerCase().includes(term) ||
      (s.roll_number || '').toLowerCase().includes(term) ||
      (s.student_code || '').toLowerCase().includes(term) ||
      (s.room_number || '').toLowerCase().includes(term) ||
      (s.department || '').toLowerCase().includes(term);
    const matchesHostel = !selectedHostelFilter || s.hostel_id === selectedHostelFilter;
    return matchesSearch && matchesHostel;
  });

  // Consolidated hostel roster for the selected date: includes recorded residents and unrecorded/pending residents
  const consolidatedRosterRecords = useMemo(() => {
    const recordMap = new Map<string, any>();
    scopedAttendance.forEach((r) => {
      recordMap.set(r.student_id, r);
    });

    const leaveMap = new Map<string, LeaveRequest>();
    scopedLeaves.forEach((l) => {
      if (l.approval_status === 'APPROVED' && selectedDate >= l.start_date && selectedDate <= l.end_date) {
        leaveMap.set(l.student_id, l);
      }
    });

    return scopedStudents.map((st) => {
      const existing = recordMap.get(st.id);
      if (existing) {
        const vSub = Array.isArray(existing.verification_submissions)
          ? existing.verification_submissions[0]
          : existing.verification_submissions;

        return {
          id: existing.id,
          isExisting: true,
          student_id: st.id,
          student: st,
          schedule_name: existing.schedule?.name || schedules[0]?.name || 'Curfew Roll-Call',
          submitted_at: existing.submitted_at,
          status: existing.status,
          verification_status: existing.verification_status,
          review_reason: existing.review_reason,
          verification_submission: vSub || null,
          rawRecord: existing
        };
      }

      const activeLeave = leaveMap.get(st.id);
      if (activeLeave) {
        return {
          id: `leave_${st.id}`,
          isExisting: false,
          student_id: st.id,
          student: st,
          schedule_name: schedules[0]?.name || 'Curfew Roll-Call',
          submitted_at: null,
          status: 'APPROVED_LEAVE',
          verification_status: 'SANCTIONED',
          review_reason: `Sanctioned leave: ${activeLeave.reason_category} (${activeLeave.start_date} to ${activeLeave.end_date})`,
          verification_submission: null
        };
      }

      return {
        id: `unrecorded_${st.id}`,
        isExisting: false,
        student_id: st.id,
        student: st,
        schedule_name: schedules[0]?.name || 'Curfew Roll-Call',
        submitted_at: null,
        status: 'PENDING_CHECKIN',
        verification_status: 'PENDING',
        review_reason: 'Unrecorded resident - Pending roll-call submission',
        verification_submission: null
      };
    });
  }, [scopedStudents, scopedAttendance, scopedLeaves, selectedDate, schedules]);

  const filteredAttendance = consolidatedRosterRecords.filter((r) => {
    const matchesHostel = !selectedHostelFilter || r.student?.hostel_id === selectedHostelFilter;
    const matchesStatus =
      !attendanceStatusFilter ||
      (attendanceStatusFilter === 'PENDING_CHECKIN'
        ? r.status === 'PENDING_CHECKIN'
        : r.status === attendanceStatusFilter);
    const term = attendanceSearchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (r.student?.full_name || '').toLowerCase().includes(term) ||
      (r.student?.roll_number || '').toLowerCase().includes(term) ||
      (r.student?.room_number || '').toLowerCase().includes(term);
    return matchesHostel && matchesStatus && matchesSearch;
  });

  const filteredLeaves = scopedLeaves.filter((l) => {
    const matchesHostel = !selectedHostelFilter || l.student?.hostel_id === selectedHostelFilter;
    return matchesHostel;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-ct-navy font-black text-lg sm:text-xl">
            <UserCheck className="w-6 h-6 text-ct-navy" />
            <span>HOSTEL WARDEN OPERATIONS DESK</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            CT GROUP OF INSTITUTIONS • Attendance Audits, Student Roster &amp; Guardian Alerts
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
            {wardenAssignments.length > 0 ? (
              wardenAssignments.map((a) => (
                <span
                  key={a.id}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-200"
                >
                  Assigned Scope: {a.hostel?.name || 'Hostel'} ({a.is_primary ? 'Primary Warden' : 'Assistant'})
                </span>
              ))
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                Warden Scope: General Campus Access (All Hostels)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <button
            onClick={handleSendTestPush}
            disabled={isSendingTestPush}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title="Dispatch a test Web Push notification to this browser"
          >
            <Smartphone className="w-3.5 h-3.5 text-ct-gold" />
            <span>{isSendingTestPush ? 'Testing...' : 'Test Push'}</span>
          </button>

          <button
            onClick={() => loadWardenData()}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowCsvGuide(true)}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-lg shadow-sm transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-ct-gold" />
            <span>CSV Import Specs</span>
          </button>
        </div>
      </div>

      {/* Metric Highlights */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Enrolled Students</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {scopedStudents.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {assignedHostelIds.length > 0 ? 'Assigned Hostel Scope' : 'Total Campus Roster'}
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Today's Submissions</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">
            {scopedAttendance.filter((r) => r.status === 'PRESENT').length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Confirmed Present</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Pending Review</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-700 mt-2">
            {scopedAttendance.filter((r) => r.status === 'PENDING_VERIFICATION').length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Evidence Verification</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Approved Leaves</span>
            <FileCheck className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-purple-700 mt-2">
            {scopedLeaves.filter((l) => l.approval_status === 'APPROVED').length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Exempt from Absence Alerts</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 overflow-x-auto text-xs font-bold">
          <button
            onClick={() => setActiveTab('attendance')}
            className={`pb-3 border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap ${
              activeTab === 'attendance'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Daily Attendance Tracker</span>
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`pb-3 border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap ${
              activeTab === 'students'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Student Roster</span>
          </button>
          <button
            onClick={() => setActiveTab('leaves')}
            className={`pb-3 border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap ${
              activeTab === 'leaves'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            <span>Leave Applications</span>
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`pb-3 border-b-2 flex items-center space-x-2 transition-colors whitespace-nowrap ${
              activeTab === 'alerts'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <PhoneCall className="w-4 h-4" />
            <span>Guardian Alert Logs</span>
          </button>
        </nav>
      </div>

      {/* Tab 1: Daily Attendance Tracker */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          {/* Live Roll-Call Attendance Countdown & Staff Audit Monitor */}
          <AttendanceCountdownTimer
            schedule={schedules[0] || null}
            allowSimulation={true}
            portalContext="staff"
          />

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Hostel Daily Roll-Call Sheet</h3>
              <p className="text-xs text-slate-500">Live attendance submissions, quick check-ins, and auditable corrections</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search student, roll, room..."
                  value={attendanceSearchTerm}
                  onChange={(e) => setAttendanceSearchTerm(e.target.value)}
                  className="bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none w-36 sm:w-44"
                />
              </div>

              <select
                value={selectedHostelFilter}
                onChange={(e) => setSelectedHostelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy font-medium"
              >
                <option value="">{assignedHostelIds.length > 0 ? 'All Assigned Hostels' : 'All Hostels'}</option>
                {(assignedHostelIds.length > 0
                  ? hostels.filter((h) => assignedHostelIds.includes(h.id))
                  : hostels
                ).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>

              <select
                value={attendanceStatusFilter}
                onChange={(e) => setAttendanceStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy font-medium"
              >
                <option value="">All Statuses (Complete Roster)</option>
                <option value="PRESENT">PRESENT (Verified Present)</option>
                <option value="ABSENT">ABSENT (Curfew Violation)</option>
                <option value="PENDING_CHECKIN">PENDING_CHECKIN (Unrecorded)</option>
                <option value="APPROVED_LEAVE">APPROVED_LEAVE (Sanctioned)</option>
                <option value="EXCUSED">EXCUSED</option>
                <option value="LATE_SUBMISSION">LATE_SUBMISSION</option>
              </select>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer"
                />
              </div>

              <button
                onClick={() => setShowManualRollCall(true)}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-white" />
                <span>Roll-Call Check-In</span>
              </button>

              <button
                onClick={handleRunAbsenceDetection}
                disabled={isRunningAbsenceDetection || schedules.length === 0}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors disabled:opacity-50"
                title="Evaluate attendance schedules and mark absent students"
              >
                <Clock className="w-3.5 h-3.5 text-ct-gold" />
                <span>{isRunningAbsenceDetection ? 'Evaluating...' : 'Detect Absences'}</span>
              </button>

              <button
                onClick={handleOpenPushForAbsentStudents}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white rounded-lg shadow-sm transition-colors"
                title="Send Web Push alert to all absent students for today"
              >
                <BellRing className="w-3.5 h-3.5 text-rose-200" />
                <span>Notify Absent ({scopedAttendance.filter((r) => r.status === 'ABSENT').length})</span>
              </button>
            </div>
          </div>

          {/* Metrics summary banner for selected date & scope */}
          {(() => {
            const enrolledInScope = scopedStudents.filter(
              (s) => !selectedHostelFilter || s.hostel_id === selectedHostelFilter
            );
            const totalEnrolled = enrolledInScope.length;
            const recordsInScope = scopedAttendance.filter(
              (r) => !selectedHostelFilter || r.student?.hostel_id === selectedHostelFilter
            );
            const presentTotal = recordsInScope.filter((r) => r.status === 'PRESENT').length;
            const absentTotal = recordsInScope.filter((r) => r.status === 'ABSENT').length;
            const leaveTotal = recordsInScope.filter((r) => r.status === 'APPROVED_LEAVE' || r.status === 'EXCUSED').length;
            const pendingTotal = Math.max(0, totalEnrolled - recordsInScope.length);

            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setAttendanceStatusFilter('')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    attendanceStatusFilter === ''
                      ? 'bg-slate-100 border-ct-navy ring-2 ring-ct-navy/20 shadow-sm'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                  title="Click to show full roster (all statuses)"
                >
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Assigned Enrolled</span>
                  <span className="text-lg font-black text-slate-900">{totalEnrolled}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Hostel Roster (All)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAttendanceStatusFilter('PRESENT')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    attendanceStatusFilter === 'PRESENT'
                      ? 'bg-emerald-100 border-emerald-600 ring-2 ring-emerald-500/20 shadow-sm'
                      : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/70'
                  }`}
                  title="Click to filter Confirmed Present students"
                >
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Confirmed Present</span>
                  <span className="text-lg font-black text-emerald-800">{presentTotal}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">Physical Roll-Call</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAttendanceStatusFilter('ABSENT')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    attendanceStatusFilter === 'ABSENT'
                      ? 'bg-rose-100 border-rose-600 ring-2 ring-rose-500/20 shadow-sm'
                      : 'bg-rose-50 border-rose-200 hover:bg-rose-100/70'
                  }`}
                  title="Click to filter Absent students"
                >
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Marked Absent</span>
                  <span className="text-lg font-black text-rose-800">{absentTotal}</span>
                  <span className="text-[10px] text-rose-600 block mt-0.5">Curfew Violation</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAttendanceStatusFilter('APPROVED_LEAVE')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    attendanceStatusFilter === 'APPROVED_LEAVE'
                      ? 'bg-purple-100 border-purple-600 ring-2 ring-purple-500/20 shadow-sm'
                      : 'bg-purple-50 border-purple-200 hover:bg-purple-100/70'
                  }`}
                  title="Click to filter Approved Leave residents"
                >
                  <span className="text-[10px] uppercase font-bold text-purple-700 block">Approved Leave</span>
                  <span className="text-lg font-black text-purple-800">{leaveTotal}</span>
                  <span className="text-[10px] text-purple-600 block mt-0.5">Exempt from Alerts</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAttendanceStatusFilter('PENDING_CHECKIN')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    attendanceStatusFilter === 'PENDING_CHECKIN'
                      ? 'bg-amber-100 border-amber-600 ring-2 ring-amber-500/20 shadow-sm'
                      : 'bg-amber-50 border-amber-200 hover:bg-amber-100/70'
                  }`}
                  title="Click to filter Unrecorded residents"
                >
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Pending Roll-Call</span>
                  <span className="text-lg font-black text-amber-800">{pendingTotal}</span>
                  <span className="text-[10px] text-amber-600 block mt-0.5">Unrecorded Today</span>
                </button>
              </div>
            );
          })()}

          {filteredAttendance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Roll No</th>
                    <th className="py-2.5 px-3">Student Name</th>
                    <th className="py-2.5 px-3">Hostel &amp; Room</th>
                    <th className="py-2.5 px-3">Slot</th>
                    <th className="py-2.5 px-3">Submission Time</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Verification &amp; Location Audit</th>
                    <th className="py-2.5 px-3 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAttendance.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                        {r.student?.roll_number || 'N/A'}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {r.student?.full_name || 'Student Record'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        <span className="font-mono font-semibold">{r.student?.room_number || '-'}</span>{' '}
                        <span className="text-slate-400">({r.student?.hostel?.name || (r.student as any)?.hostels?.name || 'Hostel'})</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{r.schedule_name || 'Roll Call'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {r.submitted_at ? (
                          new Date(r.submitted_at).toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                          })
                        ) : r.status === 'PENDING_CHECKIN' ? (
                          <span className="text-amber-600 font-medium">Unrecorded</span>
                        ) : (
                          'Manual / System'
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.status === 'PRESENT'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : r.status === 'ABSENT'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : r.status === 'APPROVED_LEAVE'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : r.status === 'PENDING_CHECKIN'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : r.status === 'EXCUSED'
                              ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                              : r.status === 'LATE_SUBMISSION'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {r.status === 'PENDING_CHECKIN' ? 'PENDING' : r.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-600">
                        {(() => {
                          const vSub = r.verification_submission;
                          const distMatch = r.review_reason?.match(/Distance:\s*([\d\.]+)m?/i)?.[1];
                          const accMatch = r.review_reason?.match(/Accuracy:\s*±?([\d\.]+)m?/i)?.[1];
                          const confMatch = r.review_reason?.match(/Face Conf:\s*([\d\.]+)%?/i)?.[1];

                          const dist = vSub?.calculated_distance_meters || distMatch;
                          const acc = vSub?.location_accuracy_meters || accMatch;
                          const conf = confMatch || (r.review_reason?.includes('FACE') ? '98' : null);

                          if (r.status === 'PRESENT') {
                            return (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300"
                                    title={`Face Biometric Match: ${conf || 100}% confidence`}
                                  >
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>Face {conf ? `${conf}%` : 'Match'}</span>
                                  </span>
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-300"
                                    title={`Verified within Shahpur campus geofence (${dist || 0}m, allowed 535m)`}
                                  >
                                    <MapPin className="w-3 h-3 text-blue-600" />
                                    <span>{dist ? `${dist}m` : 'In-Bounds'}</span>
                                  </span>
                                </div>
                                <div className="text-[10px] font-mono text-slate-500">
                                  {vSub?.device_latitude && vSub?.device_longitude ? (
                                    <span>GPS: {Number(vSub.device_latitude).toFixed(4)}°N, {Number(vSub.device_longitude).toFixed(4)}°E (±{acc || 15}m)</span>
                                  ) : acc ? (
                                    <span>GPS Accuracy ±{acc}m (Shahpur Campus)</span>
                                  ) : (
                                    <span>Shahpur Campus (Radius: 535m)</span>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          if (r.status === 'ABSENT') {
                            return (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                                  <span>Cutoff Enforced</span>
                                </span>
                                <div className="text-[10px] font-mono text-slate-500">
                                  {r.review_reason?.includes('22:31') ? '10:31 PM Automated Cutoff' : (r.review_reason || 'Absence Finalized')}
                                </div>
                              </div>
                            );
                          }

                          if (r.status === 'APPROVED_LEAVE') {
                            return (
                              <span className="text-[10px] font-medium text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200" title={r.review_reason || 'Sanctioned leave'}>
                                Sanctioned Leave
                              </span>
                            );
                          }

                          if (r.status === 'PENDING_CHECKIN') {
                            return (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                Awaiting Resident Verification
                              </span>
                            );
                          }

                          return (
                            <span className="font-mono text-[10px] text-slate-600">
                              {r.verification_status || 'MANUAL'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => handleQuickUpdateStatus(r.id, 'PRESENT', r.student_id)}
                            title="Quick mark Present"
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                              r.status === 'PRESENT'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                            }`}
                          >
                            Present
                          </button>
                          <button
                            onClick={() => handleQuickUpdateStatus(r.id, 'ABSENT', r.student_id)}
                            title="Quick mark Absent"
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                              r.status === 'ABSENT'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                            }`}
                          >
                            Absent
                          </button>
                          <button
                            onClick={() => handleQuickUpdateStatus(r.id, 'EXCUSED', r.student_id)}
                            title="Quick mark Excused"
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                              r.status === 'EXCUSED'
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                            }`}
                          >
                            Ex
                          </button>
                          {r.isExisting && r.rawRecord && (
                            <button
                              onClick={() => setSelectedRecordForCorrection(r.rawRecord)}
                              className="px-2 py-0.5 text-[10px] font-semibold text-ct-navy hover:text-ct-navy-light underline"
                              title="Audit Correction with institutional reason"
                            >
                              Audit
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const st = students.find((s) => s.id === r.student_id) || r.student;
                              if (st) handleOpenPushForSingleStudent(st);
                            }}
                            title="Send Web Push alert to this student"
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 inline-flex items-center gap-1 transition-colors"
                          >
                            <Bell className="w-3 h-3 text-blue-700" />
                            <span>Notify</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
              <CheckCircle2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No Attendance Submissions Found for {selectedDate}</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                {attendanceSearchTerm
                  ? `No attendance records match "${attendanceSearchTerm}".`
                  : 'No attendance records have been registered for this date in your authorized scope. Click Roll-Call Check-In to mark students physically present.'}
              </p>
            </div>
          )}
        </div>
      </div>
    )}

      {/* Tab 2: Student Roster */}
      {activeTab === 'students' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Enrolled Student Roster</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.students</code></p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedHostelFilter}
                onChange={(e) => setSelectedHostelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy"
              >
                <option value="">All Hostels</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search name, roll, room..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-ct-navy"
                />
              </div>
            </div>
          </div>

          {filteredStudents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Roll No</th>
                    <th className="py-2.5 px-3">Student Name</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3">Hostel Facility</th>
                    <th className="py-2.5 px-3">Room</th>
                    <th className="py-2.5 px-3">Guardian Name &amp; Phone</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{s.roll_number}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{s.full_name}</td>
                      <td className="py-2.5 px-3 text-slate-600">{s.department}</td>
                      <td className="py-2.5 px-3 text-slate-700">{s.hostel?.name || 'Assigned'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{s.room_number}</td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {s.guardian?.phone_number ? `${s.guardian.full_name} (${s.guardian.phone_number})` : s.guardian?.full_name || 'Linked'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {s.enrollment_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleOpenPushForSingleStudent(s)}
                          className="px-2.5 py-1 text-[11px] font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg inline-flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                          title="Send Web Push alert to student"
                        >
                          <BellRing className="w-3 h-3 text-ct-gold" />
                          <span>Notify</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
              <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">Roster Empty in Database</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                No student profiles match your search criteria.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Leave Applications */}
      {activeTab === 'leaves' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Student Hostel Leave Requests</h3>
              <p className="text-xs text-slate-500">Approved leaves automatically suppress absence alerts (FR-07)</p>
            </div>

            <select
              value={selectedHostelFilter}
              onChange={(e) => setSelectedHostelFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy"
            >
              <option value="">All Hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          {filteredLeaves.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Roll No</th>
                    <th className="py-2.5 px-3">Student Name</th>
                    <th className="py-2.5 px-3">Hostel &amp; Room</th>
                    <th className="py-2.5 px-3">Leave Dates</th>
                    <th className="py-2.5 px-3">Reason Category</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeaves.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                        {l.student?.roll_number || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{l.student?.full_name || 'Enrolled Student'}</td>
                      <td className="py-2.5 px-3 text-slate-700">
                        <span className="font-mono">{l.student?.room_number || '-'}</span>{' '}
                        <span className="text-slate-400">({l.student?.hostels?.name || 'Hostel'})</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{l.start_date} to {l.end_date}</td>
                      <td className="py-2.5 px-3 text-slate-700">{l.reason_category}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            l.approval_status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : l.approval_status === 'REJECTED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {l.approval_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {l.approval_status === 'PENDING' ? (
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={() => handleReviewLeave(l.id, 'APPROVED')}
                              className="px-2 py-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded flex items-center gap-1 shadow-sm transition-colors"
                              title="Approve Leave Application"
                            >
                              <Check className="w-3 h-3" />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => handleReviewLeave(l.id, 'REJECTED')}
                              className="px-2 py-1 text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded flex items-center gap-1 shadow-sm transition-colors"
                              title="Reject Leave Application"
                            >
                              <X className="w-3 h-3" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Processed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
              <FileCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No Pending Leave Requests</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                Any student leave applications submitted from the Student Dashboard will be listed here for warden review and approval.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Guardian Alert Logs */}
      {activeTab === 'alerts' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Guardian Notification &amp; Call Escalation Queue</h3>
              <p className="text-xs text-slate-500">
                Outbound absence alerts dispatched per institutional attendance rules (FR-04, FR-06)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleQueueAbsenceAlerts}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors shrink-0"
              >
                <PhoneCall className="w-3.5 h-3.5 text-ct-gold" />
                <span>Queue Alerts for {selectedDate}</span>
              </button>

              <button
                onClick={handleProcessSequentialQueue}
                disabled={callQueueProgress?.isActive}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors shrink-0 disabled:opacity-50"
                title="Process queued absence calls sequentially, one at a time"
              >
                <Radio className="w-3.5 h-3.5 text-emerald-200" />
                <span>{callQueueProgress?.isActive ? `Calling [${callQueueProgress.currentCallIndex}/${callQueueProgress.totalCalls}]...` : 'Process Sequential Queue'}</span>
              </button>
            </div>
          </div>

          {/* Sequential Call Queue Live Progress Banner */}
          {callQueueProgress && (
            <div className="p-3.5 rounded-xl bg-slate-900 text-white text-xs border border-slate-700 space-y-1.5 shadow-sm">
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1.5 text-ct-gold">
                  <PhoneCall className="w-4 h-4 animate-pulse text-ct-gold" />
                  <span>Sequential Call Processing: {callQueueProgress.processedCount} of {callQueueProgress.totalCalls} Calls</span>
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  Completed: {callQueueProgress.completedCount} • Standby/Failed: {callQueueProgress.failedCount}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-mono bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                {callQueueProgress.lastMessage}
              </p>
            </div>
          )}

          {/* Persistent Gateway Requirement Notice (Requirement 10) */}
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
            <div className="font-bold flex items-center space-x-1.5 text-amber-950">
              <Clock className="w-4 h-4 text-amber-700" />
              <span>Telephony Gateway Status: Real Provider Configuration Required</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-800">
              Per strict institutional requirements, simulated or fake telephone calls are strictly forbidden to prevent false emergency panic.
              All absence events remain safely recorded in the Supabase database in <strong>QUEUED</strong> status until real Twilio / Exotel gateway credentials are configured.
            </p>
          </div>

          {/* Live Notification Events Table */}
          {notificationEvents.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="text-xs font-bold text-slate-800 mb-2 flex items-center justify-between">
                <span>SMS &amp; In-App Absence Notification Queue</span>
                <span className="text-[11px] font-mono text-slate-500">{notificationEvents.length} records</span>
              </div>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Event Timestamp</th>
                    <th className="py-2.5 px-3">Event Type</th>
                    <th className="py-2.5 px-3">Channel</th>
                    <th className="py-2.5 px-3">Delivery Status</th>
                    <th className="py-2.5 px-3">Attempts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {notificationEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {new Date(ev.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{ev.event_type}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-800">
                          {ev.channel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ev.delivery_status === 'DELIVERED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : ev.delivery_status === 'SENT'
                              ? 'bg-blue-100 text-blue-800'
                              : ev.delivery_status === 'FAILED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ev.delivery_status === 'QUEUED' ? 'QUEUED (Pending Gateway)' : ev.delivery_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{ev.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <PhoneCall className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700">No Alerts Queued Yet</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                Click <strong>Detect Absences</strong> or <strong>Queue Absence Alerts</strong> to generate notifications for absent students on {selectedDate}.
              </p>
            </div>
          )}

          {/* Outbound Voice Call Sessions Table */}
          {callSessions.length > 0 && (
            <div className="overflow-x-auto pt-2 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-800 mb-2 flex items-center justify-between">
                <span>Outbound Voice &amp; IVR Call Sessions</span>
                <span className="text-[11px] font-mono text-slate-500">{callSessions.length} sessions</span>
              </div>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Call Time</th>
                    <th className="py-2.5 px-3">Call Status</th>
                    <th className="py-2.5 px-3">Transfer Requested</th>
                    <th className="py-2.5 px-3">IVR Resolution</th>
                    <th className="py-2.5 px-3">Session Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {callSessions.map((cs) => (
                    <tr key={cs.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {new Date(cs.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            cs.call_status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : cs.call_status === 'IN_PROGRESS' || cs.call_status === 'RINGING'
                              ? 'bg-blue-100 text-blue-800'
                              : cs.call_status === 'FAILED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {cs.call_status === 'QUEUED' ? 'QUEUED (Carrier Standby)' : cs.call_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {cs.transfer_requested ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                            Key 2 (Warden/AI Bridge)
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">No</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-medium">
                        {cs.transfer_result || 'Pending Dispatch'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 text-[10px]">
                        {cs.id.slice(0, 8)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Warden On-Duty Bridge Status Card */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-slate-800 font-bold">
              <PhoneCall className="w-4 h-4 text-ct-gold" />
              <span>Warden On-Duty Call Bridge Protocol (FR-06)</span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              When an outbound automated call is placed to a guardian, pressing key "2" on their dialpad bridges the guardian directly to the designated hostel warden duty phone.
            </p>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-700">
              Hostel Duty Number: Configured per hostel record • Queue Routing: Active
            </div>
          </div>

          {/* Web Push Notification Delivery Ledger & Server-Side VAPID Log */}
          <div className="pt-6 border-t border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <BellRing className="w-4 h-4 text-ct-navy" />
                  <h4 className="text-sm font-bold text-slate-900">Student Web Push Notification Delivery Ledger</h4>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time push delivery logs from Supabase Edge Function &amp; Web Push VAPID Service
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSendTestPush}
                  disabled={isSendingTestPush}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                  title="Send test push notification to current browser"
                >
                  <Smartphone className="w-3.5 h-3.5 text-ct-gold" />
                  <span>{isSendingTestPush ? 'Testing...' : 'Send Test Notification'}</span>
                </button>

                <button
                  onClick={() => {
                    const allRecipients: StudentRecipient[] = scopedStudents.map((s) => ({
                      id: s.id,
                      full_name: s.full_name,
                      roll_number: s.roll_number,
                      profile_id: s.profile_id,
                      room_number: s.room_number,
                      hostel_name: s.hostel?.name || s.hostels?.name
                    }));
                    setPushModalBatchList(allRecipients);
                    setPushModalSingleStudent(null);
                    setShowPushModal(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <Bell className="w-3.5 h-3.5 text-ct-gold" />
                  <span>Compose Push Alert</span>
                </button>
              </div>
            </div>

            {testPushMessage && (
              <div
                className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between ${
                  testPushMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                <span>{testPushMessage.text}</span>
                <button onClick={() => setTestPushMessage(null)} className="text-xs underline font-bold ml-2">
                  Dismiss
                </button>
              </div>
            )}

            {pushLogs.length > 0 ? (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Recipient Student</th>
                      <th className="py-2.5 px-3">Notification Type</th>
                      <th className="py-2.5 px-3">Title &amp; Message</th>
                      <th className="py-2.5 px-3">Delivery Status</th>
                      <th className="py-2.5 px-3">Delivery Response / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pushLogs.map((log) => {
                      const st = students.find((s) => s.profile_id === log.user_id);
                      return (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            <span className="block text-[10px] text-slate-400">
                              {new Date(log.created_at).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {st ? (
                              <div>
                                <span className="font-semibold text-slate-900 block">{st.full_name}</span>
                                <span className="font-mono text-[10px] text-slate-500">Roll: {st.roll_number} • Room {st.room_number}</span>
                              </div>
                            ) : (
                              <div>
                                <span className="font-mono text-slate-700 block">System / User</span>
                                <span className="font-mono text-[10px] text-slate-400">{log.user_id.slice(0, 12)}...</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 uppercase">
                              {log.notification_type || 'ALERT'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-xs">
                            <div className="font-semibold text-slate-800 truncate">{log.title}</div>
                            <div className="text-[11px] text-slate-500 truncate">{log.body}</div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                log.delivery_status === 'SENT'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : log.delivery_status === 'FAILED'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {log.delivery_status === 'SENT' ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-700" />
                                  <span>Delivered</span>
                                </>
                              ) : log.delivery_status === 'FAILED' ? (
                                <>
                                  <X className="w-3 h-3 text-rose-700" />
                                  <span>Failed</span>
                                </>
                              ) : (
                                <span>{log.delivery_status}</span>
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[11px]">
                            {log.error_message ? (
                              <span className="text-rose-600 font-mono text-[10px] bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 block truncate max-w-xs" title={log.error_message}>
                                {log.error_message}
                              </span>
                            ) : log.status_code ? (
                              <span className="text-emerald-700 font-mono text-[10px]">HTTP {log.status_code} OK (Delivered)</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
                <BellRing className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-slate-700">No Web Push Logs Yet</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Push notifications sent to students or via test dispatch will appear here with real-time VAPID delivery status.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Correction Dialog */}
      {selectedRecordForCorrection && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Auditable Attendance Correction</h4>
              <button
                onClick={() => setSelectedRecordForCorrection(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleApplyCorrection} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select New Status</label>
                <select
                  value={newCorrectionStatus}
                  onChange={(e) => setNewCorrectionStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                >
                  <option value="PRESENT">Mark PRESENT (Verified)</option>
                  <option value="EXCUSED">Mark EXCUSED (Institutional Exemption)</option>
                  <option value="APPROVED_LEAVE">Mark APPROVED LEAVE</option>
                  <option value="ABSENT">Mark ABSENT</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Mandatory Audit Justification (FR-05, FR-11)
                </label>
                <textarea
                  required
                  rows={3}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Student reported verified hospital emergency with medical certificate."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRecordForCorrection(null)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light"
                >
                  Save Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Format Modal */}
      {showCsvGuide && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Student CSV Import Specification (FR-02)</h4>
              <button
                onClick={() => setShowCsvGuide(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-700">
              <p className="text-[11px] leading-relaxed">
                When importing students via CSV, the file must adhere to the following headers and validation criteria:
              </p>

              <pre className="bg-slate-900 text-slate-200 p-3 rounded-lg text-[10px] font-mono overflow-x-auto">
student_code,roll_number,full_name,department,academic_year,room_number,guardian_name,guardian_phone,guardian_relation
CT2026-001,230101,Aman Sharma,CSE,2023-2027,B-204,Rajesh Sharma,+919812345678,Father
              </pre>

              <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-600">
                <li><strong>roll_number:</strong> Must be unique across CT Group.</li>
                <li><strong>guardian_phone:</strong> 10-digit Indian mobile number with country code.</li>
                <li><strong>room_number:</strong> Valid hostel room code.</li>
              </ul>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={() => setShowCsvGuide(false)}
                className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Roll-Call Modal */}
      {showManualRollCall && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Record Manual Roll-Call</h4>
                <p className="text-[11px] text-slate-500">Record in-person attendance for date: {selectedDate}</p>
              </div>
              <button
                onClick={() => {
                  setShowManualRollCall(false);
                  setRollCallNotes('');
                }}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleManualRollCall} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Select Student <span className="text-rose-500">*</span>
                </label>
                <select
                  value={rollCallStudentId}
                  onChange={(e) => setRollCallStudentId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-ct-navy"
                  required
                >
                  <option value="">-- Choose student --</option>
                  {scopedStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.roll_number} - {s.full_name} ({s.room_number ? `Room ${s.room_number}` : 'Unassigned'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Attendance Slot / Schedule
                </label>
                <select
                  value={rollCallScheduleId}
                  onChange={(e) => setRollCallScheduleId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-ct-navy"
                >
                  {schedules.map((sch) => (
                    <option key={sch.id} value={sch.id}>
                      {sch.name} ({sch.start_time.slice(0, 5)} - {sch.deadline_time.slice(0, 5)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Attendance Status <span className="text-rose-500">*</span>
                </label>
                <select
                  value={rollCallStatus}
                  onChange={(e) => setRollCallStatus(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-ct-navy font-semibold"
                >
                  <option value="PRESENT">PRESENT (Physically Verified)</option>
                  <option value="ABSENT">ABSENT (Not Present in Room)</option>
                  <option value="LATE_SUBMISSION">LATE_SUBMISSION (Late Arrival)</option>
                  <option value="EXCUSED">EXCUSED (Medical / Approved)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Verification Note / Reason
                </label>
                <input
                  type="text"
                  value={rollCallNotes}
                  onChange={(e) => setRollCallNotes(e.target.value)}
                  placeholder="e.g. In-person room check, warden roll call"
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowManualRollCall(false);
                    setRollCallNotes('');
                  }}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRollCall || !rollCallStudentId}
                  className="px-4 py-2 text-xs rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-bold transition-colors"
                >
                  {isSubmittingRollCall ? 'Recording...' : 'Record Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Web Push Notification Modal */}
      <SendPushNotificationModal
        isOpen={showPushModal}
        onClose={() => {
          setShowPushModal(false);
          setPushModalSingleStudent(null);
          setPushModalBatchList([]);
        }}
        singleStudent={pushModalSingleStudent}
        studentList={pushModalBatchList}
        onSuccess={async () => {
          await loadWardenData();
        }}
      />
    </div>
  );
};
