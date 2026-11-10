import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { AttendanceRecord, Student, AttendanceSchedule, LeaveRequest, RoomAllocation } from '../../types/database';
import {
  User,
  Clock,
  CheckCircle,
  FileText,
  Shield,
  RefreshCw,
  Home,
  AlertCircle,
  Check,
  Copy,
  Phone,
  GraduationCap,
  Camera,
  Scan
} from 'lucide-react';
import { FaceAttendanceModal } from '../biometrics/FaceAttendanceModal';
import { FaceEnrollmentModal } from '../biometrics/FaceEnrollmentModal';
import { hasStudentFaceTemplate } from '../../lib/faceRecognition';
import { NotificationPermissionBanner } from './NotificationPermissionBanner';
import { AttendanceCountdownTimer } from './AttendanceCountdownTimer';
import { getSyncedIstDateString } from '../../lib/serverTime';
import { runAbsenceDetection, isScheduleWindowClosed } from '../../lib/absenceDetection';

export const StudentDashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const configured = isSupabaseConfigured();

  const [studentData, setStudentData] = useState<Student | null>(null);
  const [allocation, setAllocation] = useState<RoomAllocation | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([]);
  const [activeSchedule, setActiveSchedule] = useState<AttendanceSchedule | null>(null);
  const [activeWindow, setActiveWindow] = useState<{
    title: string;
    startTime: string;
    deadlineTime: string;
    isOpen: boolean;
  }>({
    title: 'Morning Roll Call',
    startTime: '07:30 AM',
    deadlineTime: '08:00 AM',
    isOpen: true
  });

  const [hasSubmittedToday, setHasSubmittedToday] = useState<boolean>(false);
  const [todaySubmission, setTodaySubmission] = useState<AttendanceRecord | null>(null);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [copiedUuid, setCopiedUuid] = useState<boolean>(false);
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null);

  // Biometric Face Recognition State
  const [hasFaceTemplate, setHasFaceTemplate] = useState<boolean>(false);
  const [showFaceAttendanceModal, setShowFaceAttendanceModal] = useState<boolean>(false);
  const [showFaceEnrollmentModal, setShowFaceEnrollmentModal] = useState<boolean>(false);

  // Leave Form State
  const [showLeaveModal, setShowLeaveModal] = useState<boolean>(false);
  const [leaveStart, setLeaveStart] = useState<string>('');
  const [leaveEnd, setLeaveEnd] = useState<string>('');
  const [leaveCategory, setLeaveCategory] = useState<string>('Home Visit');
  const [leaveDetails, setLeaveDetails] = useState<string>('');
  const [leaveFeedback, setLeaveFeedback] = useState<string | null>(null);
  const [isSubmittingLeave, setIsSubmittingLeave] = useState<boolean>(false);

  const loadStudentData = async (isManual = false) => {
    if (!configured || !user) {
      setIsLoadingData(false);
      return;
    }

    if (isManual) {
      setRefreshFeedback('Checking student roster link in Supabase...');
    }

    setIsLoadingData(true);
    try {
      // 1. Fetch active attendance schedules
      const { data: schedules } = await supabase
        .from('attendance_schedules')
        .select('*')
        .eq('is_active', true)
        .order('start_time');

      let effectiveSchedule: AttendanceSchedule | null = null;
      if (schedules && schedules.length > 0) {
        effectiveSchedule = schedules[0] as AttendanceSchedule;
        setActiveSchedule(effectiveSchedule);
        setActiveWindow({
          title: effectiveSchedule.name,
          startTime: effectiveSchedule.start_time,
          deadlineTime: effectiveSchedule.deadline_time,
          isOpen: effectiveSchedule.is_active
        });
      } else {
        // Institutional Default: CT Group Shahpur Campus 9:30 PM - 10:30 PM IST Slot
        const defaultShahpurSched: AttendanceSchedule = {
          id: 'shahpur-curfew-slot',
          name: 'Night Curfew Roll-Call (Shahpur Campus)',
          hostel_id: 'default-hostel',
          start_time: '21:30:00',
          deadline_time: '22:30:00',
          grace_period_minutes: 1,
          timezone: 'Asia/Kolkata',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        effectiveSchedule = defaultShahpurSched;
        setActiveSchedule(defaultShahpurSched);
        setActiveWindow({
          title: defaultShahpurSched.name,
          startTime: defaultShahpurSched.start_time,
          deadlineTime: defaultShahpurSched.deadline_time,
          isOpen: true
        });
      }

      // 2. Fetch student record linked to authenticated user profile_id
      const { data: student } = await supabase
        .from('students')
        .select('*, hostels(name), guardians(*)')
        .eq('profile_id', user.id)
        .maybeSingle();

      if (student) {
        const normalizedStudent: Student = {
          ...student,
          hostel: (student.hostels || student.hostel) as any,
          guardian: (student.guardians || student.guardian) as any
        };
        setStudentData(normalizedStudent);
        setHasFaceTemplate(hasStudentFaceTemplate(student.id, student.roll_number));
        if (isManual) {
          setRefreshFeedback('Student profile linked successfully! Loading your resident portal...');
        }

        // If student has a specific hostel, try to find matching schedule
        if (schedules && schedules.length > 0 && student.hostel_id) {
          const matched = schedules.find((s) => s.hostel_id === student.hostel_id);
          if (matched) {
            const matchedSched = matched as AttendanceSchedule;
            setActiveSchedule(matchedSched);
            setActiveWindow({
              title: matchedSched.name,
              startTime: matchedSched.start_time,
              deadlineTime: matchedSched.deadline_time,
              isOpen: matchedSched.is_active
            });
          }
        }

        // 3. Fetch active room allocation with room, block, and hostel details
        const { data: alloc } = await supabase
          .from('room_allocations')
          .select('*, room:hostel_rooms(*, hostel:hostels(name), block:hostel_blocks(block_name))')
          .eq('student_id', student.id)
          .eq('status', 'ACTIVE')
          .maybeSingle();

        if (alloc) {
          setAllocation(alloc as RoomAllocation);
        } else {
          setAllocation(null);
        }

        // 4. Fetch attendance history with schedule details
        const { data: records } = await supabase
          .from('attendance_records')
          .select('*, schedule:attendance_schedules(name)')
          .eq('student_id', student.id)
          .order('attendance_date', { ascending: false })
          .limit(15);

        if (records) {
          setHistory(records as AttendanceRecord[]);
          const today = getSyncedIstDateString();
          let todayRecord = records.find((r) => r.attendance_date === today);

          // Headless Finalization: If unrecorded and window is past 10:31 PM cutoff, run idempotent absence processing
          if (!todayRecord && effectiveSchedule) {
            const winStatus = isScheduleWindowClosed(effectiveSchedule);
            if (winStatus.canFinalizeAbsences) {
              try {
                await runAbsenceDetection(effectiveSchedule.id, today);
                // Re-fetch today's record after finalization
                const { data: updatedRecord } = await supabase
                  .from('attendance_records')
                  .select('*, schedule:attendance_schedules(name)')
                  .eq('student_id', student.id)
                  .eq('attendance_date', today)
                  .maybeSingle();

                if (updatedRecord) {
                  todayRecord = updatedRecord as AttendanceRecord;
                  setHistory((prev) => [updatedRecord as AttendanceRecord, ...prev]);
                }
              } catch (autoErr) {
                console.warn('Auto-absence detection evaluation notice:', autoErr);
              }
            }
          }

          if (todayRecord) {
            setHasSubmittedToday(true);
            setTodaySubmission(todayRecord as AttendanceRecord);
          } else {
            setHasSubmittedToday(false);
            setTodaySubmission(null);
          }
        }

        // 5. Fetch leave requests submitted by this student
        const { data: leaves } = await supabase
          .from('leave_requests')
          .select('*')
          .eq('student_id', student.id)
          .order('created_at', { ascending: false });

        if (leaves) {
          setMyLeaves(leaves as LeaveRequest[]);
        }
      } else {
        setStudentData(null);
        setAllocation(null);
        setHistory([]);
        setMyLeaves([]);
        setHasSubmittedToday(false);
        setTodaySubmission(null);
        if (isManual) {
          setRefreshFeedback('Roster record not linked yet. Please share your Profile UUID with your Hostel Warden or Administrator.');
        }
      }
    } catch (err) {
      console.warn('Student record fetch:', err);
      if (isManual) {
        setRefreshFeedback('Error connecting to database. Please try again.');
      }
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    loadStudentData();
  }, [configured, user]);

  const handleCopyUuid = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2500);
  };

  const handleOpenAttendanceCheckIn = () => {
    if (!hasFaceTemplate) {
      setShowFaceEnrollmentModal(true);
    } else {
      setShowFaceAttendanceModal(true);
    }
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured || !studentData) {
      setLeaveFeedback('Student record must be linked to submit official leave applications.');
      return;
    }

    if (leaveStart > leaveEnd) {
      setLeaveFeedback('Leave "From Date" cannot be after "To Date".');
      return;
    }

    setIsSubmittingLeave(true);
    setLeaveFeedback(null);

    try {
      const { error } = await supabase.from('leave_requests').insert([
        {
          student_id: studentData.id,
          start_date: leaveStart,
          end_date: leaveEnd,
          reason_category: leaveCategory,
          reason_details: leaveDetails,
          approval_status: 'PENDING'
        }
      ]);

      if (error) {
        setLeaveFeedback(`Error: ${error.message}`);
      } else {
        setLeaveFeedback(null);
        setShowLeaveModal(false);
        setLeaveDetails('');
        setLeaveStart('');
        setLeaveEnd('');
        loadStudentData();
      }
    } catch (err: unknown) {
      setLeaveFeedback(err instanceof Error ? err.message : 'Leave request failed');
    } finally {
      setIsSubmittingLeave(false);
    }
  };

  // State: Loading
  if (isLoadingData) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-3 border-emerald-600 border-t-ct-gold rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Loading your student resident record...</p>
      </div>
    );
  }

  // State: Unlinked Account (Authenticated, but profile_id not yet mapped to public.students)
  if (!studentData) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div className="flex items-center space-x-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-center justify-center text-amber-700 shadow-sm shrink-0">
                <GraduationCap className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-black text-slate-900">
                    {profile?.full_name || user?.email || 'Student Account'}
                  </h2>
                  <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-300">
                    Awaiting Roster Link
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  CT Student Portal • Authenticated as <span className="font-semibold text-slate-700">{user?.email}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => loadStudentData(true)}
                disabled={isLoadingData}
                className="px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoadingData ? 'animate-spin' : ''}`} />
                <span>{isLoadingData ? 'Checking...' : 'Refresh Status'}</span>
              </button>
            </div>
          </div>

          {refreshFeedback && (
            <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center space-x-2">
              <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>{refreshFeedback}</span>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="flex items-center space-x-2 text-amber-900 font-bold text-xs mb-1">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Student Enrollment Record Pending</span>
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Your student authentication account is active, but it is not yet mapped to your institutional student roll number in the CT hostel database.
                </p>
                <div className="mt-3 pt-3 border-t border-amber-200/60 text-xs text-amber-900 space-y-1">
                  <p className="font-semibold">Next steps to activate your hostel portal:</p>
                  <ol className="list-decimal list-inside text-[11px] text-amber-800 space-y-1 pl-1">
                    <li>Copy your registered email address or Profile ID below.</li>
                    <li>Notify your Hostel Warden or Institutional Administrator.</li>
                    <li>The administrator will link your profile in the <strong>Admin &gt; Staff &amp; Roles</strong> console.</li>
                    <li>Once linked, click <strong>Refresh Status</strong> to access daily roll-call check-in, room allocations, and leave applications.</li>
                  </ol>
                </div>
              </div>

              {/* Account Credentials Box */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Your Account Identifier Information
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-semibold block uppercase">Registered Email</span>
                    <span className="font-mono font-bold text-slate-800 text-xs break-all">{user?.email || (user?.user_metadata?.email as string) || 'Registered Student'}</span>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Profile UUID</span>
                      <button
                        onClick={handleCopyUuid}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1"
                        title="Copy UUID to clipboard"
                      >
                        {copiedUuid ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <span className="font-mono text-slate-700 text-[11px] break-all block mt-0.5">{user?.id}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Institutional Security Notice */}
            <div className="bg-slate-900 text-white rounded-xl p-5 border border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-2 text-ct-gold font-bold text-xs mb-2">
                  <Shield className="w-4 h-4" />
                  <span>Institutional Data Privacy</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  PostgreSQL Row Level Security (RLS) restricts access strictly to verified student profiles. Unlinked accounts cannot view student roster entries, room allocation charts, or attendance history of other residents.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800 text-[10px] text-slate-400">
                CT Group of Institutions • Hostel Governance
              </div>
            </div>
          </div>
        </div>

        {/* Live Attendance Countdown Timer (Asia/Kolkata 09:30 PM - 10:30 PM) */}
        <AttendanceCountdownTimer
          schedule={activeSchedule}
          hasSubmittedToday={false}
        />

        {/* Web Push Notification Permission & Alert Status Banner for Unlinked Student */}
        {user?.id && (
          <NotificationPermissionBanner userId={user.id} />
        )}
      </div>
    );
  }

  // State: Linked Student Account (Active Resident)
  return (
    <div className="space-y-6">
      {/* Student Identity Card */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-ct-navy to-ct-navy-light flex items-center justify-center text-white border-2 border-ct-gold shadow-md shrink-0">
              <User className="w-7 h-7 text-ct-gold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  {studentData.full_name}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                  {studentData.enrollment_status === 'ACTIVE' ? 'Active Resident' : studentData.enrollment_status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Roll No: <span className="font-mono font-bold text-slate-800">{studentData.roll_number}</span>
                {studentData.student_code && (
                  <> • Code: <span className="font-mono text-slate-700">{studentData.student_code}</span></>
                )}
                {' '}• Dept: <span className="font-medium text-slate-700">{studentData.department?.replace('CTIEMT', 'CT')}</span>
                {' '}• Year: <span className="font-medium text-slate-700">{studentData.academic_year}</span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Hostel: <span className="font-semibold text-slate-800">{allocation?.room?.hostel?.name || studentData.hostel?.name || 'CT Hostel'}</span>
                {' '}• Room: <span className="font-mono font-bold text-slate-800">{allocation?.room?.room_number || studentData.room_number || 'Assigned'}</span>
                {allocation?.bed_label && (
                  <> • Bed: <span className="font-semibold text-slate-700">{allocation.bed_label}</span></>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 w-full md:w-auto justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
            <button
              onClick={() => loadStudentData()}
              className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowLeaveModal(true)}
              className="px-3.5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <FileText className="w-4 h-4 text-slate-600" />
              <span>Apply for Leave</span>
            </button>
          </div>
        </div>
      </div>

      {/* Web Push Notification Permission & Alert Status Banner */}
      {user?.id && (
        <NotificationPermissionBanner userId={user.id} />
      )}

      {/* Room Allocation & Guardian Details Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Room Allocation Details */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Home className="w-4 h-4 text-ct-navy" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Hostel &amp; Room Allocation</h3>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
              {allocation?.status || 'Active Allocation'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs pt-1">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Hostel</span>
              <span className="font-bold text-slate-800 truncate block">
                {allocation?.room?.hostel?.name || studentData.hostel?.name || 'Main Campus'}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Block / Wing</span>
              <span className="font-bold text-slate-800 truncate block">
                {allocation?.room?.block?.block_name || 'Main Wing'}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Room No</span>
              <span className="font-mono font-bold text-ct-navy block text-sm">
                {allocation?.room?.room_number || studentData.room_number || 'N/A'}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Floor</span>
              <span className="font-bold text-slate-800 block">
                {allocation?.room?.floor_number !== undefined ? `Floor ${allocation.room.floor_number}` : 'Floor 1'}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Bed Label</span>
              <span className="font-bold text-slate-800 block">
                {allocation?.bed_label || 'Bed A'}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Room Type</span>
              <span className="font-bold text-slate-800 block">
                {allocation?.room?.room_type || 'STANDARD'}
              </span>
            </div>
          </div>
        </div>

        {/* Guardian & Notification Alert Info */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Phone className="w-4 h-4 text-emerald-700" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Guardian &amp; Emergency Alert</h3>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-50 text-purple-800 border border-purple-200">
              FR-04 Alert Ready
            </span>
          </div>

          <div className="space-y-2 text-xs pt-1">
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
              <span className="text-slate-500 font-medium">Designated Guardian:</span>
              <span className="font-bold text-slate-900">
                {studentData.guardian?.full_name || 'Registered on File'}
              </span>
            </div>

            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
              <span className="text-slate-500 font-medium">Relationship:</span>
              <span className="font-semibold text-slate-800">
                {studentData.guardian?.relationship || 'Parent / Guardian'}
              </span>
            </div>

            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50">
              <span className="text-slate-500 font-medium">Emergency Contact:</span>
              <span className="font-mono font-bold text-slate-800">
                {studentData.guardian?.phone_number || 'Protected in Database'}
              </span>
            </div>

            <p className="text-[11px] text-slate-500 pt-1 leading-normal">
              Absence or missed roll-call windows trigger automated voice and SMS escalation to this number via institutional alert gateways.
            </p>
          </div>
        </div>
      </div>

      {/* Live Attendance Countdown Timer (Asia/Kolkata 09:30 PM - 10:30 PM IST) */}
      <AttendanceCountdownTimer
        schedule={activeSchedule}
        hasSubmittedToday={hasSubmittedToday}
        todayStatus={todaySubmission?.status}
        todaySubmissionTime={todaySubmission?.submitted_at}
        onCheckInClick={handleOpenAttendanceCheckIn}
        showEnrollmentPrompt={!hasFaceTemplate}
        onEnrollClick={() => setShowFaceEnrollmentModal(true)}
      />

      {/* Attendance Check-In Portal */}
      <div className="bg-gradient-to-br from-ct-navy to-ct-navy-light rounded-2xl p-6 text-white shadow-xl border-2 border-ct-gold/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-ct-gold text-slate-950 rounded-md">
                Active Slot
              </span>
              <span className="text-xs text-slate-300 font-semibold">{activeWindow.title}</span>
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-white">
              Self-Mark Daily Attendance
            </h3>

            <div className="flex items-center space-x-4 text-xs text-slate-200 font-mono">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4 text-ct-gold" />
                <span>Window: {activeWindow.startTime} – {activeWindow.deadlineTime}</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed pt-1">
              Attendance requires active submission within the configured deadline window. Missed submissions trigger institutional grace periods and automated guardian notifications (FR-04).
            </p>

            {/* Evidence Checklist Notice */}
            <div className="mt-3 p-3 rounded-xl bg-slate-900/60 border border-slate-700/60 text-[11px] text-slate-300 space-y-1">
              <div className="font-semibold text-ct-gold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                <span>Biometric Identity Verification Protocol</span>
              </div>
              <p className="text-slate-400">
                • Real-time camera biometric verification matches your facial features against your enrolled reference profile.
              </p>
              <p className="text-slate-400">
                • Attendance is marked PRESENT strictly upon positive identity confirmation (FR-01/FR-03).
              </p>
            </div>
          </div>

          {/* Submission Action Box */}
          <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/20 flex flex-col items-center justify-center text-center min-w-[240px]">
            {hasSubmittedToday ? (
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center mx-auto text-emerald-400">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-white">Attendance Recorded</div>
                <p className="text-[10px] text-emerald-300">
                  {todaySubmission?.submitted_at
                    ? `Confirmed at ${new Date(todaySubmission.submitted_at).toLocaleTimeString()}`
                    : 'Server verified for today'}
                </p>
                <div className="flex flex-col items-center gap-1">
                  <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/30 text-emerald-200 border border-emerald-400/40">
                    {todaySubmission?.status || 'PRESENT'}
                  </span>
                  {todaySubmission?.review_reason?.includes('FACE_AND_GEOFENCE') ? (
                    <span className="text-[9px] text-emerald-300 font-medium flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Face &amp; Geofence Verified</span>
                    </span>
                  ) : todaySubmission?.review_reason?.includes('FACE_RECOGNITION') ? (
                    <span className="text-[9px] text-emerald-300 font-medium flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Biometric Face Verified</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3 w-full">
                <div className="text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5">
                  <span>Status:</span>
                  <span className="text-amber-300 font-bold">Pending Today</span>
                </div>

                {!hasFaceTemplate ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowFaceEnrollmentModal(true)}
                      className="w-full px-4 py-2.5 rounded-xl font-black text-xs bg-ct-gold hover:bg-ct-gold-dark text-slate-950 shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-slate-950" />
                      <span>Enroll Face Biometrics</span>
                    </button>
                    <p className="text-[10px] text-amber-200">
                      Required before marking attendance
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={handleOpenAttendanceCheckIn}
                      className="w-full px-4 py-2.5 rounded-xl font-black text-xs bg-ct-gold hover:bg-ct-gold-dark text-slate-950 shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Scan className="w-4 h-4 text-slate-950" />
                      <span>Mark Attendance (Face Scan)</span>
                    </button>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-[10px] text-emerald-300">Biometrics enrolled</span>
                      <button
                        onClick={() => setShowFaceEnrollmentModal(true)}
                        className="text-[10px] text-slate-300 hover:text-white underline cursor-pointer"
                      >
                        Re-enroll
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {submissionFeedback && (
          <div className="mt-4 p-2.5 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs">
            {submissionFeedback}
          </div>
        )}
      </div>

      {/* Attendance History */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Your Attendance History</h3>
            <p className="text-xs text-slate-500">Recent check-in logs and verification status</p>
          </div>
          <button
            onClick={() => loadStudentData()}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            title="Refresh history"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Schedule Slot</th>
                  <th className="py-2.5 px-3">Submission Timestamp</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{h.attendance_date}</td>
                    <td className="py-2.5 px-3 text-slate-700 font-medium">{h.schedule?.name || 'Roll Call'}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {h.submitted_at ? new Date(h.submitted_at).toLocaleTimeString() : 'Pending'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          h.status === 'PRESENT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : h.status === 'APPROVED_LEAVE'
                            ? 'bg-purple-100 text-purple-800'
                            : h.status === 'EXCUSED'
                            ? 'bg-indigo-100 text-indigo-800'
                            : h.status === 'ABSENT'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-500">
                      {h.review_reason?.includes('FACE_AND_GEOFENCE') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200" title={h.review_reason}>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Face &amp; Geofence</span>
                        </span>
                      ) : h.review_reason?.includes('FACE_RECOGNITION') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Face Verified</span>
                        </span>
                      ) : (
                        <span>{h.verification_status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
            <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">No Past Records Found</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
              Your attendance history will display here once submissions are processed in the Supabase database.
            </p>
          </div>
        )}
      </div>

      {/* Leave Applications History */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Your Leave Applications</h3>
            <p className="text-xs text-slate-500">Track warden review and absence alert exemption status</p>
          </div>
          <button
            onClick={() => setShowLeaveModal(true)}
            className="px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-ct-gold" />
            <span>New Leave Request</span>
          </button>
        </div>

        {myLeaves.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Date Range</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Reason / Details</th>
                  <th className="py-2.5 px-3">Applied On</th>
                  <th className="py-2.5 px-3">Approval Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myLeaves.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900 font-mono">
                      {l.start_date} to {l.end_date}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">{l.reason_category}</td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">{l.reason_details || '-'}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
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
                        {l.approval_status === 'APPROVED'
                          ? 'Approved (Alerts Suppressed)'
                          : l.approval_status === 'REJECTED'
                          ? 'Rejected'
                          : 'Pending Warden Review'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <p className="font-bold text-slate-700">No Leave Applications Submitted</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
              Need to travel or take a home visit? Click <strong>New Leave Request</strong> above to submit an application to your hostel warden.
            </p>
          </div>
        )}
      </div>

      {/* Leave Application Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Apply for Hostel Leave</h4>
              <button
                onClick={() => {
                  setShowLeaveModal(false);
                  setLeaveFeedback(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleApplyLeave} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    From Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveStart}
                    onChange={(e) => setLeaveStart(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    To Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveEnd}
                    onChange={(e) => setLeaveEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={leaveCategory}
                  onChange={(e) => setLeaveCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="Home Visit">Home Visit</option>
                  <option value="Medical">Medical / Health Issue</option>
                  <option value="Academic">Academic / Project Work</option>
                  <option value="Emergency">Family Emergency</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reason Details</label>
                <textarea
                  rows={3}
                  value={leaveDetails}
                  onChange={(e) => setLeaveDetails(e.target.value)}
                  placeholder="Provide brief details for the hostel warden..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              {leaveFeedback && (
                <p className="text-[11px] p-2.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {leaveFeedback}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowLeaveModal(false);
                    setLeaveFeedback(null);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingLeave}
                  className="px-4 py-2 rounded-lg bg-ct-navy hover:bg-ct-navy-light text-white font-bold disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isSubmittingLeave ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Face Biometric Attendance Modal */}
      {showFaceAttendanceModal && studentData && activeSchedule && (
        <FaceAttendanceModal
          student={studentData}
          activeSchedule={activeSchedule}
          isOpen={showFaceAttendanceModal}
          onClose={() => setShowFaceAttendanceModal(false)}
          onOpenEnrollment={() => {
            setShowFaceAttendanceModal(false);
            setShowFaceEnrollmentModal(true);
          }}
          onSuccess={(record) => {
            setHasSubmittedToday(true);
            setTodaySubmission(record);
            setShowFaceAttendanceModal(false);
            setSubmissionFeedback(
              'Biometric face identity verified! Attendance recorded to Supabase with server timestamp.'
            );
            loadStudentData();
          }}
        />
      )}

      {/* Face Biometric Enrollment Modal */}
      {showFaceEnrollmentModal && studentData && (
        <FaceEnrollmentModal
          student={studentData}
          isOpen={showFaceEnrollmentModal}
          onClose={() => setShowFaceEnrollmentModal(false)}
          onSuccess={(template) => {
            setHasFaceTemplate(true);
            setShowFaceEnrollmentModal(false);
            setSubmissionFeedback(
              `Facial biometric template successfully enrolled for ${template.studentName} (${template.rollNumber}). You can now mark attendance using camera verification.`
            );
          }}
        />
      )}
    </div>
  );
};
