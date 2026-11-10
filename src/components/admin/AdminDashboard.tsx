import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  Hostel,
  AttendanceSchedule,
  Profile,
  AuditLog,
  Student,
  LeaveRequest,
  NotificationEvent,
  HostelRoom,
  RoomAllocation,
  RoomType,
  WardenHostelAssignment,
  AttendanceRecord,
  AttendanceStatus,
  HostelBlock
} from '../../types/database';
import {
  Building2,
  Clock,
  Users,
  Plus,
  FileText,
  RefreshCw,
  UserCheck,
  FileCheck,
  PhoneCall,
  CheckCircle2,
  Bed,
  Check,
  X,
  Search,
  UserPlus,
  DoorOpen,
  Calendar,
  Eye,
  Edit3,
  Trash2,
  Copy,
  MessageSquare,
  ShieldAlert,
  Camera,
  Volume2,
  Radio,
  Bell,
  BellRing,
  Smartphone,
  FileSpreadsheet
} from 'lucide-react';
import { BulkStudentUploadModal } from './BulkStudentUploadModal';
import { validateIndianMobile } from '../../lib/studentImportUtils';
import { FaceEnrollmentModal } from '../biometrics/FaceEnrollmentModal';
import { hasStudentFaceTemplate } from '../../lib/faceRecognition';
import { runAbsenceDetection } from '../../lib/absenceDetection';
import {
  getTelephonyCredentials,
  dispatchGuardianAbsenceCall,
  handleIvrDigitInput,
  generateHindiAbsenceVoiceScript
} from '../../lib/telephony';
import { processSequentialCallQueue, CallQueueProgress } from '../../lib/callQueue';
import { SendPushNotificationModal, StudentRecipient } from '../notifications/SendPushNotificationModal';
import { sendTestPushNotification } from '../../lib/webPush';
import { AttendanceCountdownTimer } from '../student/AttendanceCountdownTimer';
import { getSyncedIstDateString } from '../../lib/serverTime';

export const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const configured = isSupabaseConfigured();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'students' | 'hostels' | 'rooms' | 'wardens' | 'attendance' | 'schedules' | 'leaves' | 'alerts' | 'staff' | 'audit'
  >('overview');

  // Core Data States
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [schedules, setSchedules] = useState<AttendanceSchedule[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<Profile[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [hostelRooms, setHostelRooms] = useState<HostelRoom[]>([]);
  const [roomAllocations, setRoomAllocations] = useState<RoomAllocation[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<NotificationEvent[]>([]);
  const [wardenAssignments, setWardenAssignments] = useState<WardenHostelAssignment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modals & Forms
  const [showAddHostel, setShowAddHostel] = useState<boolean>(false);
  const [newHostelName, setNewHostelName] = useState<string>('');
  const [newHostelWardenPhone, setNewHostelWardenPhone] = useState<string>('');
  const [newHostelRadius, setNewHostelRadius] = useState<number>(535);

  const [showAddSchedule, setShowAddSchedule] = useState<boolean>(false);
  const [newScheduleName, setNewScheduleName] = useState<string>('Night Curfew Roll-Call (Shahpur Campus)');
  const [newScheduleHostelId, setNewScheduleHostelId] = useState<string>('');
  const [newScheduleStart, setNewScheduleStart] = useState<string>('21:30');
  const [newScheduleDeadline, setNewScheduleDeadline] = useState<string>('22:30');
  const [newScheduleGrace, setNewScheduleGrace] = useState<number>(1);

  const [showEnrollStudent, setShowEnrollStudent] = useState<boolean>(false);
  const [showBulkUpload, setShowBulkUpload] = useState<boolean>(false);
  const [newStudentName, setNewStudentName] = useState<string>('');
  const [newRollNumber, setNewRollNumber] = useState<string>('');
  const [newStudentCode, setNewStudentCode] = useState<string>('');
  const [newDepartment, setNewDepartment] = useState<string>('Computer Science & Engineering');
  const [newAcademicYear, setNewAcademicYear] = useState<string>('2024-2028');
  const [newStudentHostelId, setNewStudentHostelId] = useState<string>('');
  const [newRoomNumber, setNewRoomNumber] = useState<string>('101');
  const [selectedExistingRoomId, setSelectedExistingRoomId] = useState<string>('');
  const [newGuardianName, setNewGuardianName] = useState<string>('');
  const [newGuardianPhone, setNewGuardianPhone] = useState<string>('');
  const [newGuardianRelation, setNewGuardianRelation] = useState<string>('Father');
  const [newGuardianLanguage, setNewGuardianLanguage] = useState<string>('hi');
  const [newVoiceConsent, setNewVoiceConsent] = useState<boolean>(true);
  const [newSmsConsent, setNewSmsConsent] = useState<boolean>(true);
  const [newWhatsappConsent, setNewWhatsappConsent] = useState<boolean>(false);
  const [newStudentProfileId, setNewStudentProfileId] = useState<string>('');

  // Filters for Students
  const [selectedHostelFilter, setSelectedHostelFilter] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('');

  // View & Edit Student States
  const [selectedStudentForView, setSelectedStudentForView] = useState<Student | null>(null);
  const [selectedStudentForEdit, setSelectedStudentForEdit] = useState<Student | null>(null);
  const [studentForBiometricEnroll, setStudentForBiometricEnroll] = useState<Student | null>(null);

  // Edit Student Form Fields
  const [editStudentName, setEditStudentName] = useState<string>('');
  const [editRollNumber, setEditRollNumber] = useState<string>('');
  const [editStudentCode, setEditStudentCode] = useState<string>('');
  const [editDepartment, setEditDepartment] = useState<string>('');
  const [editAcademicYear, setEditAcademicYear] = useState<string>('');
  const [editHostelId, setEditHostelId] = useState<string>('');
  const [editRoomNumber, setEditRoomNumber] = useState<string>('');
  const [editEnrollmentStatus, setEditEnrollmentStatus] = useState<string>('ACTIVE');
  const [editProfileId, setEditProfileId] = useState<string>('');
  const [editGuardianName, setEditGuardianName] = useState<string>('');
  const [editGuardianPhone, setEditGuardianPhone] = useState<string>('');
  const [editGuardianRelation, setEditGuardianRelation] = useState<string>('Father');
  const [editGuardianLanguage, setEditGuardianLanguage] = useState<string>('hi');
  const [editVoiceConsent, setEditVoiceConsent] = useState<boolean>(true);
  const [editSmsConsent, setEditSmsConsent] = useState<boolean>(true);
  const [editWhatsappConsent, setEditWhatsappConsent] = useState<boolean>(false);

  // Room Management States
  const [showAddRoom, setShowAddRoom] = useState<boolean>(false);
  const [newRoomNumberVal, setNewRoomNumberVal] = useState<string>('');
  const [newRoomHostelId, setNewRoomHostelId] = useState<string>('');
  const [newRoomBlockId, setNewRoomBlockId] = useState<string>('');
  const [newRoomFloor, setNewRoomFloor] = useState<number>(1);
  const [newRoomType, setNewRoomType] = useState<RoomType>('DOUBLE');
  const [newRoomCapacity, setNewRoomCapacity] = useState<number>(2);

  // Hostel Blocks States
  const [hostelBlocks, setHostelBlocks] = useState<HostelBlock[]>([]);
  const [showAddBlock, setShowAddBlock] = useState<boolean>(false);
  const [newBlockHostelId, setNewBlockHostelId] = useState<string>('');
  const [newBlockName, setNewBlockName] = useState<string>('');
  const [newBlockGender, setNewBlockGender] = useState<'BOYS' | 'GIRLS' | 'COED'>('BOYS');
  const [newBlockFloors, setNewBlockFloors] = useState<number>(3);

  const [showAllocateRoom, setShowAllocateRoom] = useState<boolean>(false);
  const [allocStudentId, setAllocStudentId] = useState<string>('');
  const [allocRoomId, setAllocRoomId] = useState<string>('');
  const [allocBedLabel, setAllocBedLabel] = useState<string>('Bed A');
  const [allocNotes, setAllocNotes] = useState<string>('');

  const [showAssignWarden, setShowAssignWarden] = useState<boolean>(false);
  const [selectedWardenId, setSelectedWardenId] = useState<string>('');
  const [selectedHostelId, setSelectedHostelId] = useState<string>('');
  const [assignIsPrimary, setAssignIsPrimary] = useState<boolean>(true);

  // Attendance Tab Filters & Roll Call Modal States
  const [attendanceDate, setAttendanceDate] = useState<string>(getSyncedIstDateString());
  const [attendanceHostelFilter, setAttendanceHostelFilter] = useState<string>('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<string>('');
  const [attendanceStudentSearch, setAttendanceStudentSearch] = useState<string>('');

  // Admin Manual Attendance Recording Modal State
  const [showRecordAttendance, setShowRecordAttendance] = useState<boolean>(false);
  const [attStudentId, setAttStudentId] = useState<string>('');
  const [attScheduleId, setAttScheduleId] = useState<string>('');
  const [attStatus, setAttStatus] = useState<AttendanceStatus>('PRESENT');
  const [attNotes, setAttNotes] = useState<string>('');
  const [attDate, setAttDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState<boolean>(false);

  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Staff & Roles Search and Filters
  const [staffSearchTerm, setStaffSearchTerm] = useState<string>('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('all');
  const [copiedProfileId, setCopiedProfileId] = useState<string | null>(null);

  // Alerts Filters
  const [alertChannelFilter, setAlertChannelFilter] = useState<string>('all');
  const [alertStatusFilter, setAlertStatusFilter] = useState<string>('all');

  // Automated Absence Detection & Telephony State
  const [isRunningAbsenceDetection, setIsRunningAbsenceDetection] = useState<boolean>(false);
  const [showIvrTester, setShowIvrTester] = useState<boolean>(false);
  const [activeTestAlert, setActiveTestAlert] = useState<NotificationEvent | null>(null);
  const [ivrSimulatedDigit, setIvrSimulatedDigit] = useState<string>('1');
  const [ivrActionResponse, setIvrActionResponse] = useState<string | null>(null);
  const [ivrProcessing, setIvrProcessing] = useState<boolean>(false);
  const [callQueueProgress, setCallQueueProgress] = useState<CallQueueProgress | null>(null);

  // Web Push Notification States
  const [showPushModal, setShowPushModal] = useState<boolean>(false);
  const [pushModalSingleStudent, setPushModalSingleStudent] = useState<StudentRecipient | null>(null);
  const [pushModalBatchList, setPushModalBatchList] = useState<StudentRecipient[]>([]);
  const [pushLogs, setPushLogs] = useState<any[]>([]);
  const [isSendingTestPush, setIsSendingTestPush] = useState<boolean>(false);
  const [testPushMessage, setTestPushMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    if (!configured) return;
    setIsLoading(true);
    try {
      const [
        hostelsRes,
        blocksRes,
        schedulesRes,
        staffRes,
        auditRes,
        studentsRes,
        roomsRes,
        allocationsRes,
        attendanceRes,
        leavesRes,
        alertsRes,
        wardenAssignmentsRes,
        pushLogsRes
      ] = await Promise.all([
        supabase.from('hostels').select('*').order('name'),
        supabase.from('hostel_blocks').select('*, hostels(name)').order('block_name'),
        supabase.from('attendance_schedules').select('*, hostels(name)').order('start_time'),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(25),
        supabase.from('students').select('*, hostels(name), guardians(*)').order('created_at', { ascending: false }),
        supabase.from('hostel_rooms').select('*, hostels(name), block:hostel_blocks(block_name)').order('room_number'),
        supabase.from('room_allocations').select('*, student:students(full_name, roll_number), room:hostel_rooms(room_number, hostels(name))').order('created_at', { ascending: false }),
        supabase.from('attendance_records').select('*, students(full_name, roll_number, room_number, hostel_id, profile_id, hostels(name)), schedule:attendance_schedules(name), verification_submissions(*)').eq('attendance_date', attendanceDate),
        supabase.from('leave_requests').select('*, students(full_name, roll_number, room_number)').order('created_at', { ascending: false }),
        supabase.from('notification_events').select('*').order('created_at', { ascending: false }).limit(25),
        supabase.from('warden_hostel_assignments').select('*, hostels(name)').order('assigned_at', { ascending: false }),
        supabase.from('push_notification_logs').select('*').order('created_at', { ascending: false }).limit(50)
      ]);

      if (hostelsRes.data) setHostels(hostelsRes.data as Hostel[]);
      if (blocksRes.data) setHostelBlocks(blocksRes.data as HostelBlock[]);
      if (schedulesRes.data) setSchedules(schedulesRes.data as AttendanceSchedule[]);
      if (staffRes.data) setStaffProfiles(staffRes.data as Profile[]);
      if (auditRes.data) setAuditLogs(auditRes.data as AuditLog[]);
      if (studentsRes.data) {
        const normalizedStudents = (studentsRes.data as any[]).map((st) => ({
          ...st,
          guardian: st.guardian || st.guardians || null,
          hostel: st.hostel || st.hostels || null
        }));
        setStudents(normalizedStudents as Student[]);
      }
      if (roomsRes.data) setHostelRooms(roomsRes.data as HostelRoom[]);
      if (allocationsRes.data) setRoomAllocations(allocationsRes.data as RoomAllocation[]);
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
        setTodayAttendance(normalizedAttendance as AttendanceRecord[]);
      }
      if (leavesRes.data) {
        const normalizedLeaves = (leavesRes.data as any[]).map((l) => ({
          ...l,
          student: l.student || l.students || null,
          students: l.students || l.student || null
        }));
        setLeaveRequests(normalizedLeaves as LeaveRequest[]);
      }
      if (alertsRes.data) setRecentAlerts(alertsRes.data as NotificationEvent[]);
      if (wardenAssignmentsRes.data) setWardenAssignments(wardenAssignmentsRes.data as WardenHostelAssignment[]);
      if (pushLogsRes && pushLogsRes.data) setPushLogs(pushLogsRes.data);
    } catch (err) {
      console.warn('Error loading admin records:', err);
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
    const absentRecords = todayAttendance.filter((r) => r.status === 'ABSENT');
    if (absentRecords.length === 0) {
      alert(`No students are currently marked as ABSENT for ${attendanceDate}.`);
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
        await loadData();
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

  useEffect(() => {
    loadData();
  }, [configured, attendanceDate]);

  // Aggregate Metrics
  const totalCapacity = hostelRooms.reduce((acc, r) => acc + (r.capacity || 0), 0);
  const totalOccupancy = hostelRooms.reduce((acc, r) => acc + (r.current_occupancy || 0), 0);
  const activeAllocationsCount = roomAllocations.filter((a) => a.status === 'ACTIVE').length;
  const occupancyPercentage = totalCapacity > 0 ? Math.round((totalOccupancy / totalCapacity) * 100) : 0;
  const presentCount = todayAttendance.filter((r) => r.status === 'PRESENT').length;
  const pendingLeavesCount = leaveRequests.filter((l) => l.approval_status === 'PENDING').length;

  const handleCreateHostel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      if (!newHostelName.trim()) {
        setFormStatus('Please enter a valid hostel facility name.');
        setIsSubmitting(false);
        return;
      }

      // Step 1: Pre-flight Authentication & Admin Role Verification
      const { data: { user: currentUser }, error: authUserError } = await supabase.auth.getUser();

      if (authUserError || !currentUser) {
        const errorMsg = 'Authentication Required: You are currently viewing in Preview Mode without an active session. Please sign in with the Administrator account to save hostel facilities.';
        setFormStatus(errorMsg);
        console.warn('[Hostel Creation Blocked]', errorMsg);
        setIsSubmitting(false);
        return;
      }

      // Step 2: Verify role returned by current_user_role() RPC in PostgreSQL
      let dbRole: string | null = null;
      try {
        const { data: roleResult, error: roleError } = await supabase.rpc('current_user_role');
        if (!roleError && roleResult) {
          dbRole = roleResult;
        }
      } catch (roleEx) {
        console.warn('[Hostel Creation] Failed to probe current_user_role:', roleEx);
      }

      // Log safe diagnostics (No secrets or tokens exposed)
      console.info('[Hostel Creation Pre-flight]', {
        hasSession: Boolean(currentUser),
        userIdMasked: `${currentUser.id.slice(0, 8)}...`,
        isAdminId: currentUser.id === '1fc7220a-0680-419a-9833-e1fa1e10bfc4',
        databaseRole: dbRole || 'unknown'
      });

      if (dbRole !== 'admin') {
        const roleMsg = `Access Denied: Current session role in database is '${dbRole || 'non-admin'}'. PostgreSQL Row Level Security (RLS) strictly requires an active 'admin' role. Please sign in with the Administrator account.`;
        setFormStatus(roleMsg);
        setIsSubmitting(false);
        return;
      }

      // Step 3: Check if hostel name already exists
      const { data: existingHostel } = await supabase
        .from('hostels')
        .select('id')
        .ilike('name', newHostelName.trim())
        .maybeSingle();

      if (existingHostel) {
        setFormStatus(`A hostel facility named '${newHostelName.trim()}' already exists.`);
        setIsSubmitting(false);
        return;
      }

      // Step 4: Radius calculation (Measured campus boundary extent 435m + 100m margin = 535m)
      const measuredCampusExtentMeters = 435;
      const safetyMarginMeters = 100;
      const calculatedBoundaryRadius = measuredCampusExtentMeters + safetyMarginMeters; // 535m
      const effectiveRadius = Number(newHostelRadius) > 0 ? Number(newHostelRadius) : calculatedBoundaryRadius;

      // Step 5: Insert with verified Shahpur campus coordinates & geofence radius
      const { error } = await supabase.from('hostels').insert([
        {
          name: newHostelName.trim(),
          institution_name: 'CT GROUP OF INSTITUTIONS',
          campus_unit: 'CTIEMT',
          warden_contact: newHostelWardenPhone.trim() || null,
          reference_latitude: 31.236872,
          reference_longitude: 75.553745,
          geofence_radius_meters: effectiveRadius,
          is_active: true
        }
      ]);

      if (error) {
        setFormStatus(`Database Error (${error.code || '42501'}): ${error.message}. Please verify your Administrator session privileges.`);
      } else {
        alert(`Hostel facility "${newHostelName.trim()}" created successfully with Shahpur geofence (${effectiveRadius}m radius)!`);
        setNewHostelName('');
        setNewHostelWardenPhone('');
        setShowAddHostel(false);
        loadData();
      }
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Failed to create hostel');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      // Pre-flight auth check
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        setFormStatus('Authentication Required: Please sign in with an Administrator or Warden account to add attendance schedules.');
        setIsSubmitting(false);
        return;
      }

      const selectedHostelId = newScheduleHostelId || (hostels[0]?.id ?? null);
      if (!selectedHostelId) {
        setFormStatus('Please create at least one hostel before adding an attendance schedule.');
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('attendance_schedules').insert([
        {
          name: newScheduleName,
          hostel_id: selectedHostelId,
          start_time: newScheduleStart,
          deadline_time: newScheduleDeadline,
          grace_period_minutes: newScheduleGrace,
          timezone: 'Asia/Kolkata',
          is_active: true
        }
      ]);

      if (error) {
        setFormStatus(`Error: ${error.message}`);
      } else {
        alert('Attendance schedule created successfully!');
        setShowAddSchedule(false);
        setNewScheduleName('Night Curfew Roll-Call (Shahpur Campus)');
        setNewScheduleStart('21:30');
        setNewScheduleDeadline('22:30');
        setNewScheduleGrace(1);
        loadData();
      }
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      if (!newStudentName.trim() || !newRollNumber.trim()) {
        setFormStatus('Student Full Name and Roll Number are required.');
        setIsSubmitting(false);
        return;
      }
      if (!newGuardianName.trim() || !newGuardianPhone.trim()) {
        setFormStatus('Guardian Name and Emergency Phone Number are required.');
        setIsSubmitting(false);
        return;
      }

      const phoneValidation = validateIndianMobile(newGuardianPhone.trim());
      if (!phoneValidation.isValid) {
        setFormStatus(phoneValidation.error || 'Invalid Indian mobile phone number.');
        setIsSubmitting(false);
        return;
      }

      if (hostels.length === 0) {
        setFormStatus('Please create at least one hostel before enrolling students.');
        setIsSubmitting(false);
        return;
      }
      const targetHostelId = newStudentHostelId || hostels[0].id;

      // Duplicate Roll Number Check
      const { data: existingStudent } = await supabase
        .from('students')
        .select('id, roll_number')
        .eq('roll_number', newRollNumber.trim())
        .maybeSingle();

      if (existingStudent) {
        setFormStatus(`A student with Roll Number '${newRollNumber.trim()}' is already registered.`);
        setIsSubmitting(false);
        return;
      }

      const codeToAssign = newStudentCode.trim() || `CT-${newRollNumber.trim()}`;
      const { data: existingCode } = await supabase
        .from('students')
        .select('id, student_code')
        .eq('student_code', codeToAssign)
        .maybeSingle();

      if (existingCode) {
        setFormStatus(`A student with Student Code '${codeToAssign}' is already registered.`);
        setIsSubmitting(false);
        return;
      }

      // Determine room number to assign
      let assignedRoomNumber = newRoomNumber.trim();
      if (selectedExistingRoomId) {
        const found = hostelRooms.find((r) => r.id === selectedExistingRoomId);
        if (found) {
          assignedRoomNumber = found.room_number;
        }
      }

      // Step 1: Create Guardian Record with Language & Consent Options (FR-03, FR-04)
      const { data: guardianData, error: guardianError } = await supabase
        .from('guardians')
        .insert([
          {
            full_name: newGuardianName.trim(),
            relationship: newGuardianRelation,
            phone_number: phoneValidation.normalized,
            preferred_language: newGuardianLanguage,
            notification_consent_status: (newVoiceConsent || newSmsConsent) ? 'CONSENTED' : 'REVOKED'
          }
        ])
        .select()
        .single();

      if (guardianError) throw guardianError;

      // Step 2: Create Student Record
      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .insert([
          {
            student_code: codeToAssign,
            roll_number: newRollNumber.trim(),
            full_name: newStudentName.trim(),
            department: newDepartment.trim(),
            academic_year: newAcademicYear.trim(),
            hostel_id: targetHostelId,
            room_number: assignedRoomNumber || '101',
            guardian_id: guardianData.id,
            profile_id: newStudentProfileId || null,
            enrollment_status: 'ACTIVE'
          }
        ])
        .select()
        .single();

      if (studentError) {
        // Rollback orphan guardian
        await supabase.from('guardians').delete().eq('id', guardianData.id);
        throw studentError;
      }

      // Step 3: Create Room Allocation if an existing room was chosen
      if (selectedExistingRoomId && studentData) {
        await supabase.from('room_allocations').insert([
          {
            student_id: studentData.id,
            room_id: selectedExistingRoomId,
            bed_label: 'Bed 1',
            status: 'ACTIVE'
          }
        ]);
      }

      alert(`Student ${newStudentName} enrolled successfully!`);
      setShowEnrollStudent(false);
      setNewStudentName('');
      setNewRollNumber('');
      setNewStudentCode('');
      setNewRoomNumber('101');
      setSelectedExistingRoomId('');
      setNewGuardianName('');
      setNewGuardianPhone('');
      loadData();
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      const targetHostelId = newRoomHostelId || hostels[0]?.id;
      if (!targetHostelId) {
        setFormStatus('Please configure at least one hostel facility before creating rooms.');
        setIsSubmitting(false);
        return;
      }

      if (!newRoomNumberVal.trim()) {
        setFormStatus('Please enter a room number.');
        setIsSubmitting(false);
        return;
      }

      // Check if room already exists in this hostel
      const { data: dupRoom } = await supabase
        .from('hostel_rooms')
        .select('id')
        .eq('hostel_id', targetHostelId)
        .eq('room_number', newRoomNumberVal.trim())
        .maybeSingle();

      if (dupRoom) {
        setFormStatus(`Room '${newRoomNumberVal.trim()}' already exists in this hostel facility.`);
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('hostel_rooms').insert([
        {
          hostel_id: targetHostelId,
          block_id: newRoomBlockId || null,
          room_number: newRoomNumberVal.trim(),
          floor_number: Number(newRoomFloor),
          room_type: newRoomType,
          capacity: Number(newRoomCapacity),
          current_occupancy: 0,
          occupancy_status: 'AVAILABLE'
        }
      ]);

      if (error) {
        setFormStatus(`Error: ${error.message}`);
      } else {
        alert(`Room ${newRoomNumberVal.trim()} created successfully!`);
        setShowAddRoom(false);
        setNewRoomNumberVal('');
        setNewRoomBlockId('');
        setNewRoomCapacity(2);
        loadData();
      }
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      const targetHostelId = newBlockHostelId || hostels[0]?.id;
      if (!targetHostelId) {
        setFormStatus('Please select a hostel facility.');
        setIsSubmitting(false);
        return;
      }

      if (!newBlockName.trim()) {
        setFormStatus('Please enter a block or wing name.');
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('hostel_blocks').insert([
        {
          hostel_id: targetHostelId,
          block_name: newBlockName.trim(),
          gender_designation: newBlockGender,
          total_floors: Number(newBlockFloors),
          is_active: true
        }
      ]);

      if (error) {
        setFormStatus(`Error: ${error.message}`);
      } else {
        alert(`Hostel block "${newBlockName.trim()}" added successfully!`);
        setShowAddBlock(false);
        setNewBlockName('');
        setNewBlockFloors(3);
        loadData();
      }
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Failed to create block');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAllocateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      if (!allocStudentId || !allocRoomId) {
        setFormStatus('Please select both a student and a target room.');
        setIsSubmitting(false);
        return;
      }

      // Check if student already has an active allocation
      const { data: existingAlloc } = await supabase
        .from('room_allocations')
        .select('id, room:hostel_rooms(room_number)')
        .eq('student_id', allocStudentId)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (existingAlloc) {
        const rm = (existingAlloc as any).room?.room_number || 'another room';
        setFormStatus(`This student is already actively allocated to Room ${rm}. Please vacate their current bed before re-allocating.`);
        setIsSubmitting(false);
        return;
      }

      const targetRoom = hostelRooms.find((r) => r.id === allocRoomId);
      if (targetRoom && targetRoom.current_occupancy >= targetRoom.capacity) {
        setFormStatus(`Room ${targetRoom.room_number} is already at full capacity (${targetRoom.capacity} beds).`);
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('room_allocations').insert([
        {
          student_id: allocStudentId,
          room_id: allocRoomId,
          bed_label: allocBedLabel.trim() || 'Bed A',
          notes: allocNotes.trim() || null,
          status: 'ACTIVE'
        }
      ]);

      if (error) {
        setFormStatus(`Error: ${error.message}`);
      } else {
        if (targetRoom) {
          await supabase
            .from('students')
            .update({ room_number: targetRoom.room_number, hostel_id: targetRoom.hostel_id })
            .eq('id', allocStudentId);
        }
        alert('Bed allocation recorded successfully!');
        setShowAllocateRoom(false);
        setAllocBedLabel('Bed A');
        setAllocNotes('');
        loadData();
      }
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Room allocation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVacateAllocation = async (allocationId: string) => {
    if (!configured) return;
    if (!confirm('Are you sure you want to mark this room allocation as VACATED?')) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      const { error } = await supabase
        .from('room_allocations')
        .update({
          status: 'VACATED',
          vacation_date: today
        })
        .eq('id', allocationId);

      if (error) {
        alert(`Error vacating allocation: ${error.message}`);
      } else {
        alert('Bed allocation marked as VACATED.');
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Vacation failed');
    }
  };

  const handleAssignWarden = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    setIsSubmitting(true);
    try {
      if (!selectedWardenId || !selectedHostelId) {
        alert('Please select both a warden profile and a target hostel.');
        setIsSubmitting(false);
        return;
      }

      // Duplicate assignment check
      const { data: existingAssignment } = await supabase
        .from('warden_hostel_assignments')
        .select('id')
        .eq('warden_profile_id', selectedWardenId)
        .eq('hostel_id', selectedHostelId)
        .maybeSingle();

      if (existingAssignment) {
        alert('This staff member is already assigned to this hostel facility.');
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('warden_hostel_assignments').insert([
        {
          warden_profile_id: selectedWardenId,
          hostel_id: selectedHostelId,
          is_primary: assignIsPrimary
        }
      ]);

      if (error) {
        alert(`Error assigning warden: ${error.message}`);
      } else {
        alert('Warden assigned to hostel successfully.');
        setShowAssignWarden(false);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveWardenAssignment = async (assignmentId: string) => {
    if (!configured) return;
    if (!confirm('Are you sure you want to remove this hostel assignment?')) return;
    try {
      const { error } = await supabase.from('warden_hostel_assignments').delete().eq('id', assignmentId);
      if (error) {
        alert(`Error removing assignment: ${error.message}`);
      } else {
        alert('Warden assignment removed successfully.');
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Removal failed');
    }
  };

  const handleAdminRecordAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) return;
    if (!attStudentId) {
      alert('Please select an enrolled student.');
      return;
    }
    setIsSubmittingAttendance(true);
    try {
      const selectedSchedId = attScheduleId || schedules[0]?.id || null;
      if (!selectedSchedId) {
        alert('Please configure at least one Attendance Window (Schedule) before recording roll-call.');
        setIsSubmittingAttendance(false);
        return;
      }

      const targetDate = attDate || attendanceDate;

      // Idempotent upsert check to prevent duplicate key constraint violation
      const { data: existing } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('student_id', attStudentId)
        .eq('attendance_date', targetDate)
        .eq('schedule_id', selectedSchedId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('attendance_records')
          .update({
            status: attStatus,
            review_reason: attNotes.trim() || 'Admin manual roll-call verification',
            verification_status: 'VERIFIED',
            reviewed_by: user?.id || null,
            submitted_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;
        alert('Attendance record updated successfully.');
      } else {
        const { error: insertError } = await supabase.from('attendance_records').insert([
          {
            student_id: attStudentId,
            schedule_id: selectedSchedId,
            attendance_date: targetDate,
            status: attStatus,
            verification_status: 'VERIFIED',
            reviewed_by: user?.id || null,
            review_reason: attNotes.trim() || 'Admin manual roll-call verification',
            submitted_at: new Date().toISOString()
          }
        ]);

        if (insertError) {
          if (insertError.code === '23505') {
            alert('Attendance record already exists for this student, date, and schedule window.');
            setIsSubmittingAttendance(false);
            return;
          }
          throw insertError;
        }
        alert('Attendance record saved successfully.');
      }

      setShowRecordAttendance(false);
      setAttNotes('');
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to record attendance');
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  const handleQuickUpdateAttendanceStatus = async (recordId: string, newStatus: AttendanceStatus) => {
    if (!configured) return;
    try {
      const { error } = await supabase
        .from('attendance_records')
        .update({
          status: newStatus,
          verification_status: 'VERIFIED',
          reviewed_by: user?.id || null,
          review_reason: `Quick status updated to ${newStatus} by Administrator`,
          submitted_at: new Date().toISOString()
        })
        .eq('id', recordId);

      if (error) {
        alert(`Error updating attendance: ${error.message}`);
      } else {
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleUpdateRole = async (profileId: string, newRole: 'admin' | 'warden' | 'student' | 'guardian') => {
    if (!configured) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profileId);

      if (error) {
        alert(`Error updating role: ${error.message}`);
      } else {
        alert(`User role updated to ${newRole.toUpperCase()}.`);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Role update failed');
    }
  };

  const handleToggleAccountActive = async (profileId: string, currentStatus: boolean) => {
    if (!configured) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !currentStatus })
        .eq('id', profileId);

      if (error) {
        alert(`Error updating account status: ${error.message}`);
      } else {
        alert(`Account status updated to ${!currentStatus ? 'ACTIVE' : 'INACTIVE'}.`);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleLinkStudentProfile = async (studentId: string, profileId: string | null) => {
    if (!configured) return;
    try {
      if (profileId) {
        // Enforce 1-to-1 mapping: unassign profileId from any other student first
        await supabase
          .from('students')
          .update({ profile_id: null })
          .eq('profile_id', profileId);
      }

      const { error } = await supabase
        .from('students')
        .update({ profile_id: profileId })
        .eq('id', studentId);

      if (error) {
        alert(`Error linking student profile: ${error.message}`);
      } else {
        alert(profileId ? 'Student profile linked successfully to roster record!' : 'Student profile unlinked from roster.');
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Link action failed');
    }
  };

  const handleReviewLeave = async (leaveId: string, newStatus: 'APPROVED' | 'REJECTED') => {
    if (!configured) return;
    try {
      const { error } = await supabase
        .from('leave_requests')
        .update({
          approval_status: newStatus,
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', leaveId);

      if (error) {
        alert(`Error reviewing leave: ${error.message}`);
      } else {
        alert(`Leave request marked as ${newStatus}.`);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Review action failed');
    }
  };

  const handleQueueAbsenceAlerts = async () => {
    if (!configured) return;
    setIsLoading(true);
    try {
      const absentRecords = todayAttendance.filter((r) => r.status === 'ABSENT');
      if (absentRecords.length === 0) {
        alert(`No students are marked as ABSENT on ${attendanceDate}. Record attendance or mark absences first.`);
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

      alert(`Alert Queue Processing Complete: ${queuedCount} new absence alert(s) queued for ${attendanceDate} in status QUEUED (awaiting telephony gateway).`);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to queue alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunAbsenceDetection = async () => {
    if (!configured || schedules.length === 0) return;
    setIsRunningAbsenceDetection(true);
    setFormStatus('Evaluating attendance schedules & marking absences...');
    try {
      let totalAbsent = 0;
      let totalQueued = 0;

      for (const s of schedules) {
        const res = await runAbsenceDetection(s.id, attendanceDate, true);
        if (res.success) {
          totalAbsent += res.newlyMarkedAbsent;
          totalQueued += res.queuedGuardianCalls;
        }
      }

      setFormStatus(`Absence Detection: ${totalAbsent} marked absent, ${totalQueued} calls queued.`);
      await loadData();
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Absence detection error');
    } finally {
      setIsRunningAbsenceDetection(false);
      setTimeout(() => setFormStatus(null), 5000);
    }
  };

  const handleDispatchCall = async (alertEvent: NotificationEvent) => {
    const attRec = todayAttendance.find((a) => a.id === alertEvent.attendance_record_id);
    const student = attRec?.student || students.find((s) => s.id === attRec?.student_id);
    const guardian = student?.guardian;

    if (!student || !guardian) {
      alert('Student or guardian record not linked to this alert record.');
      return;
    }

    const res = await dispatchGuardianAbsenceCall(
      alertEvent.id,
      student.full_name,
      student.roll_number,
      guardian.phone_number,
      student.hostel?.name
    );

    if (res.success) {
      alert(`Call Outbound Gateway: ${res.message}`);
    } else {
      alert(`Telephony Notice (FR-04):\n${res.message}\n\nHindi IVR Script:\n"${res.hindiVoicePrompt}"`);
    }
    loadData();
  };

  const handleProcessIvrTest = async () => {
    if (!activeTestAlert) return;
    setIvrProcessing(true);
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('attendance_record_id', activeTestAlert.attendance_record_id)
        .maybeSingle();

      const sessionId = session?.id || activeTestAlert.id;
      const res = await handleIvrDigitInput(sessionId, ivrSimulatedDigit, '+91-181-2955999');

      setIvrActionResponse(`[Digit ${ivrSimulatedDigit}]: ${res.responsePromptHi}\nStatus: ${res.message}`);
      loadData();
    } catch (err: unknown) {
      setIvrActionResponse(err instanceof Error ? err.message : 'IVR processing error');
    } finally {
      setIvrProcessing(false);
    }
  };

  const handleProcessSequentialQueue = async () => {
    try {
      await processSequentialCallQueue((prog) => {
        setCallQueueProgress({ ...prog });
      });
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error processing call queue');
    }
  };

  const handleOpenEditStudent = (student: Student) => {
    setSelectedStudentForEdit(student);
    setEditStudentName(student.full_name);
    setEditRollNumber(student.roll_number);
    setEditStudentCode(student.student_code);
    setEditDepartment(student.department);
    setEditAcademicYear(student.academic_year);
    setEditHostelId(student.hostel_id || '');
    setEditRoomNumber(student.room_number || '');
    setEditEnrollmentStatus(student.enrollment_status || 'ACTIVE');
    setEditProfileId(student.profile_id || '');
    const g = student.guardian || (student as any).guardians;
    if (g) {
      setEditGuardianName(g.full_name || '');
      setEditGuardianPhone(g.phone_number || '');
      setEditGuardianRelation(g.relationship || 'Father');
      setEditGuardianLanguage(g.preferred_language || 'hi');
      setEditVoiceConsent(g.voice_consent ?? true);
      setEditSmsConsent(g.sms_consent ?? true);
      setEditWhatsappConsent(g.whatsapp_consent ?? false);
    }
  };

  const handleSaveEditStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured || !selectedStudentForEdit) return;
    setIsSubmitting(true);
    setFormStatus(null);
    try {
      if (!editStudentName.trim() || !editRollNumber.trim()) {
        setFormStatus('Student Full Name and Roll Number cannot be empty.');
        setIsSubmitting(false);
        return;
      }

      // Check if roll number changed and conflicts with another student
      if (editRollNumber.trim() !== selectedStudentForEdit.roll_number) {
        const { data: dupRoll } = await supabase
          .from('students')
          .select('id')
          .eq('roll_number', editRollNumber.trim())
          .neq('id', selectedStudentForEdit.id)
          .maybeSingle();

        if (dupRoll) {
          setFormStatus(`Roll number '${editRollNumber.trim()}' is already in use by another student.`);
          setIsSubmitting(false);
          return;
        }
      }

      // Check if student code changed and conflicts with another student
      if (editStudentCode.trim() && editStudentCode.trim() !== selectedStudentForEdit.student_code) {
        const { data: dupCode } = await supabase
          .from('students')
          .select('id')
          .eq('student_code', editStudentCode.trim())
          .neq('id', selectedStudentForEdit.id)
          .maybeSingle();

        if (dupCode) {
          setFormStatus(`Student code '${editStudentCode.trim()}' is already in use by another student.`);
          setIsSubmitting(false);
          return;
        }
      }

      // Step 1: Update guardian record if linked
      if (selectedStudentForEdit.guardian_id) {
        const { error: gError } = await supabase
          .from('guardians')
          .update({
            full_name: editGuardianName.trim(),
            relationship: editGuardianRelation,
            phone_number: editGuardianPhone.trim(),
            preferred_language: editGuardianLanguage,
            notification_consent_status: (editVoiceConsent || editSmsConsent) ? 'CONSENTED' : 'REVOKED'
          })
          .eq('id', selectedStudentForEdit.guardian_id);

        if (gError) throw gError;
      }

      // Step 2: Update student record
      const { error: sError } = await supabase
        .from('students')
        .update({
          full_name: editStudentName.trim(),
          roll_number: editRollNumber.trim(),
          student_code: editStudentCode.trim(),
          department: editDepartment.trim(),
          academic_year: editAcademicYear.trim(),
          hostel_id: editHostelId || null,
          room_number: editRoomNumber.trim(),
          enrollment_status: editEnrollmentStatus,
          profile_id: editProfileId || null
        })
        .eq('id', selectedStudentForEdit.id);

      if (sError) throw sError;

      alert(`Student record for ${editStudentName} updated successfully!`);
      setSelectedStudentForEdit(null);
      loadData();
    } catch (err: unknown) {
      setFormStatus(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    if (!configured) return;
    const confirmDelete = confirm(
      `Are you sure you want to remove student ${student.full_name} (${student.roll_number})?\n\nIf this student has historical attendance records, marking their status as ALUMNI or EXPELLED is recommended to preserve institutional audit logs.`
    );
    if (!confirmDelete) return;

    try {
      const { error } = await supabase.from('students').delete().eq('id', student.id);
      if (error) {
        if (error.code === '23503' || error.message.includes('foreign key')) {
          const archive = confirm(
            `Cannot delete student because attendance or leave records reference this profile.\n\nWould you like to mark ${student.full_name}'s status as 'EXPELLED' or 'ALUMNI' instead?`
          );
          if (archive) {
            await supabase
              .from('students')
              .update({ enrollment_status: 'ALUMNI' })
              .eq('id', student.id);
            alert(`Student ${student.full_name} marked as ALUMNI.`);
            loadData();
            return;
          }
        }
        alert(`Error deleting student: ${error.message}`);
      } else {
        alert(`Student ${student.full_name} removed successfully.`);
        loadData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const filteredStudents = students.filter((s) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (s.full_name || '').toLowerCase().includes(term) ||
      (s.roll_number || '').toLowerCase().includes(term) ||
      (s.student_code || '').toLowerCase().includes(term) ||
      (s.room_number || '').toLowerCase().includes(term) ||
      (s.hostel?.name || '').toLowerCase().includes(term) ||
      (s.department || '').toLowerCase().includes(term);

    const matchesHostel = !selectedHostelFilter || s.hostel_id === selectedHostelFilter;
    const matchesStatus = !selectedStatusFilter || s.enrollment_status === selectedStatusFilter;

    return matchesSearch && matchesHostel && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Title & Actions Bar */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-ct-navy font-black text-lg sm:text-xl">
            <Building2 className="w-6 h-6 text-ct-gold" />
            <span>CENTRAL ADMINISTRATION CONSOLE</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            CT GROUP OF INSTITUTIONS • CT Campus • Foundation Phase 1
          </p>
        </div>

        <div className="flex items-center space-x-2.5 flex-wrap gap-2">
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
            onClick={() => loadData()}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
            title="Refresh database records"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
          <button
            onClick={() => setShowEnrollStudent(true)}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5 text-white" />
            <span>Enroll Student</span>
          </button>
          <button
            onClick={() => setShowBulkUpload(true)}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold bg-emerald-800 hover:bg-emerald-900 text-emerald-100 rounded-lg shadow-sm transition-colors border border-emerald-600/40"
            title="Import student roster in bulk from Excel (.xlsx) or CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
            <span>Bulk Upload (Excel/CSV)</span>
          </button>
          <button
            onClick={() => setShowAddHostel(true)}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-ct-gold" />
            <span>Add Hostel</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Cards (5 Core Operational Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Metric 1: Students */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Enrolled Students</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {students.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Active Campus Residents</div>
        </div>

        {/* Metric 2: Hostel Occupancy */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Hostel Occupancy</span>
            <Bed className="w-4 h-4 text-ct-navy" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {totalCapacity > 0 ? `${occupancyPercentage}%` : `${activeAllocationsCount} Allocated`}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {totalCapacity > 0 ? `${totalOccupancy}/${totalCapacity} Beds` : `${hostels.length} Facilities • ${activeAllocationsCount} Residents`}
          </div>
        </div>

        {/* Metric 3: Today's Attendance */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Today's Present</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">
            {presentCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {todayAttendance.length} Total Checked-in
          </div>
        </div>

        {/* Metric 4: Pending Leaves */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Pending Leaves</span>
            <FileCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-700 mt-2">
            {pendingLeavesCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Awaiting Warden Review</div>
        </div>

        {/* Metric 5: Recent Alerts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>Dispatched Alerts</span>
            <PhoneCall className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-purple-700 mt-2">
            {recentAlerts.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">SMS / Call Queue Records</div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-5 overflow-x-auto text-xs font-bold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Overview &amp; Metrics</span>
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'students'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Student Roster ({students.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('hostels')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'hostels'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Hostels ({hostels.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('rooms')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'rooms'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Bed className="w-4 h-4" />
            <span>Rooms &amp; Allocations ({hostelRooms.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('wardens')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'wardens'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Warden Scoping</span>
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'attendance'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Attendance Records ({todayAttendance.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('schedules')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'schedules'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Attendance Windows ({schedules.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('leaves')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'leaves'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            <span>Leave Requests ({pendingLeavesCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'alerts'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <PhoneCall className="w-4 h-4" />
            <span>Alert Queue</span>
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'staff'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Accounts &amp; Roles</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 border-b-2 flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'audit'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Audit Trail</span>
          </button>
        </nav>
      </div>

      {/* Tab: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Institutional Attendance &amp; Resident Summary</h3>
                <p className="text-xs text-slate-500 mt-0.5">Campus accommodations, roll-call schedules, and resident management</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowBulkUpload(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg shadow-sm transition-colors border border-emerald-600/50"
                  title="Import student roster in bulk from Excel (.xlsx) or CSV"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Bulk Upload (Excel/CSV)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnrollStudent(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5 text-white" />
                  <span>Enroll Student</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-700">Residential Hostels</span>
                <p className="text-2xl font-black text-slate-900">{hostels.length}</p>
                <p className="text-slate-500 text-[11px]">Campus accommodations under CT Group</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-700">Roll-Call Slot Windows</span>
                <p className="text-2xl font-black text-slate-900">{schedules.length}</p>
                <p className="text-slate-500 text-[11px]">Active morning &amp; curfew schedules</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-700">Authorized Personnel</span>
                <p className="text-2xl font-black text-slate-900">{staffProfiles.length}</p>
                <p className="text-slate-500 text-[11px]">Registered Administrators, Wardens &amp; Students</p>
              </div>
            </div>
          </div>

          {/* Quick Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => setShowEnrollStudent(true)}
              className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-emerald-500 cursor-pointer transition-all space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                <UserPlus className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">Enroll New Student</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Add an admitted student, link guardian emergency phone, and assign hostel room.
              </p>
            </div>

            <div
              onClick={() => setShowBulkUpload(true)}
              className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-emerald-500 cursor-pointer transition-all space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">Bulk Excel / CSV Upload</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Import complete batch student rosters, rooms, and guardian numbers from Excel or CSV files.
              </p>
            </div>

            <div
              onClick={() => setShowAddSchedule(true)}
              className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-ct-gold cursor-pointer transition-all space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">Configure Attendance Window</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Set roll-call start time, deadline cut-off, and grace period before alerts trigger.
              </p>
            </div>

            <div
              onClick={() => setShowAddHostel(true)}
              className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-ct-navy cursor-pointer transition-all space-y-2"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-ct-navy">
                <Building2 className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">Add Campus Hostel Block</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Define residential block, duty warden emergency contact, and GPS tolerance.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: STUDENTS */}
      {activeTab === 'students' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Enrolled Student Directory</h3>
              <p className="text-xs text-slate-500">
                Table: <code className="font-mono text-slate-700">public.students</code> • Showing {filteredStudents.length} of {students.length} students
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              {/* Filter by Hostel */}
              <select
                value={selectedHostelFilter}
                onChange={(e) => setSelectedHostelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer"
              >
                <option value="">All Hostels</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>

              {/* Filter by Status */}
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer"
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="ALUMNI">ALUMNI</option>
                <option value="EXPELLED">EXPELLED</option>
              </select>

              <button
                type="button"
                onClick={() => setShowEnrollStudent(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5 text-white" />
                <span>Enroll</span>
              </button>

              <button
                type="button"
                onClick={() => setShowBulkUpload(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg shadow-sm transition-colors shrink-0 border border-emerald-600/50"
                title="Import student roster in bulk from Excel (.xlsx) or CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
                <span>Bulk Upload (Excel/CSV)</span>
              </button>
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
                    <th className="py-2.5 px-3">Hostel</th>
                    <th className="py-2.5 px-3">Room</th>
                    <th className="py-2.5 px-3">Guardian Contact</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Auth App Link</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
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
                        {s.guardian?.full_name ? `${s.guardian.full_name} (${s.guardian.phone_number})` : 'Linked'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.enrollment_status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : s.enrollment_status === 'SUSPENDED'
                              ? 'bg-amber-100 text-amber-800'
                              : s.enrollment_status === 'EXPELLED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {s.enrollment_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {(() => {
                          const linkedProfile = staffProfiles.find((p) => p.id === s.profile_id);
                          const unlinkedStudentProfiles = staffProfiles.filter(
                            (p) => p.role === 'student' && !students.some((st) => st.profile_id === p.id)
                          );

                          return linkedProfile ? (
                            <div className="flex items-center space-x-1.5">
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                                title={`Linked Profile UUID: ${linkedProfile.id}`}
                              >
                                Linked: {linkedProfile.full_name || 'Active'}
                              </span>
                              <button
                                onClick={() => handleLinkStudentProfile(s.id, null)}
                                className="text-[10px] text-rose-600 hover:text-rose-800 underline cursor-pointer"
                                title="Unlink Auth account"
                              >
                                Unlink
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-1.5">
                              <select
                                onChange={(e) => {
                                  if (e.target.value) handleLinkStudentProfile(s.id, e.target.value);
                                }}
                                defaultValue=""
                                className="bg-white border border-amber-300 text-amber-900 rounded px-1.5 py-0.5 text-[10px] font-medium focus:ring-1 focus:ring-amber-500 cursor-pointer max-w-[170px]"
                              >
                                <option value="">-- Link Auth Account --</option>
                                {unlinkedStudentProfiles.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.full_name || 'Student'} ({p.id.slice(0, 8)}...)
                                  </option>
                                ))}
                              </select>
                              {unlinkedStudentProfiles.length === 0 && (
                                <span className="text-[10px] text-slate-400">No unlinked Auth accounts</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => handleOpenPushForSingleStudent(s)}
                            className="p-1 text-slate-500 hover:text-ct-navy hover:bg-blue-50 rounded transition-colors"
                            title="Send Web Push Alert to Student"
                          >
                            <Bell className="w-3.5 h-3.5 text-ct-navy" />
                          </button>
                          <button
                            onClick={() => setStudentForBiometricEnroll(s)}
                            className={`p-1 rounded transition-colors ${
                              hasStudentFaceTemplate(s.id, s.roll_number)
                                ? 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50'
                                : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                            }`}
                            title={
                              hasStudentFaceTemplate(s.id, s.roll_number)
                                ? 'Face Biometrics Enrolled (Click to manage)'
                                : 'Enroll Face Biometrics'
                            }
                          >
                            <Camera className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setSelectedStudentForView(s)}
                            className="p-1 text-slate-500 hover:text-ct-navy hover:bg-slate-100 rounded transition-colors"
                            title="View Student Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenEditStudent(s)}
                            className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            title="Edit Student Record"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(s)}
                            className="p-1 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            title="De-enroll / Delete Student"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700">No Student Records Found</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                {searchTerm || selectedHostelFilter || selectedStatusFilter
                  ? 'No students match your filter criteria. Try resetting filters.'
                  : 'Click Enroll to register an enrolled resident into a campus hostel.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: HOSTELS */}
      {activeTab === 'hostels' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Hostel Facilities &amp; Geofencing Boundaries</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.hostels</code></p>
            </div>
            <button
              onClick={() => setShowAddHostel(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-ct-gold" />
              <span>Add Hostel</span>
            </button>
          </div>

          {hostels.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Hostel Facility</th>
                    <th className="py-2.5 px-3">Campus Unit</th>
                    <th className="py-2.5 px-3">Warden Contact</th>
                    <th className="py-2.5 px-3">Geofence Tolerance</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hostels.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{h.name}</td>
                      <td className="py-2.5 px-3 text-slate-600">{h.campus_unit === 'CTIEMT' ? 'CT' : h.campus_unit}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{h.warden_contact || 'Pending'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{h.geofence_radius_meters}m tolerance</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${h.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {h.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
              <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No Hostels Registered Yet</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                Click <strong>Add Hostel</strong> to configure your first campus accommodation facility.
              </p>
            </div>
          )}

          {/* Hostel Blocks (Wings / Sections) */}
          <div className="pt-6 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Residential Wings &amp; Blocks</h4>
                <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.hostel_blocks</code></p>
              </div>
              <button
                onClick={() => setShowAddBlock(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-ct-gold" />
                <span>Add Block</span>
              </button>
            </div>

            {hostelBlocks.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Block / Wing Name</th>
                      <th className="py-2.5 px-3">Hostel Facility</th>
                      <th className="py-2.5 px-3">Gender Designation</th>
                      <th className="py-2.5 px-3">Total Floors</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hostelBlocks.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{b.block_name}</td>
                        <td className="py-2.5 px-3 text-slate-700">{b.hostel?.name || 'Assigned'}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.gender_designation === 'BOYS'
                                ? 'bg-blue-100 text-blue-800'
                                : b.gender_designation === 'GIRLS'
                                ? 'bg-pink-100 text-pink-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {b.gender_designation}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{b.total_floors} Floors</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                            {b.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
                <p className="text-xs font-bold text-slate-700">No Residential Blocks Configured Yet</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Click <strong>Add Block</strong> to set up wings (e.g. Block A, East Wing) with gender designations.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: ROOMS & ALLOCATIONS */}
      {activeTab === 'rooms' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Hostel Rooms &amp; Bed Capacities</h3>
                <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.hostel_rooms</code> (Audited by trigger <code className="font-mono text-slate-700">trg_sync_room_occupancy</code>)</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowAddRoom(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-ct-gold" />
                  <span>Add Room</span>
                </button>
                <button
                  onClick={() => setShowAllocateRoom(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors"
                >
                  <Bed className="w-3.5 h-3.5 text-white" />
                  <span>Allocate Bed</span>
                </button>
              </div>
            </div>

            {hostelRooms.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Room No</th>
                      <th className="py-2.5 px-3">Hostel Facility</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Floor</th>
                      <th className="py-2.5 px-3">Capacity &amp; Occupancy</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hostelRooms.map((r) => {
                      const occRatio = r.capacity > 0 ? Math.min(100, Math.round((r.current_occupancy / r.capacity) * 100)) : 0;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{r.room_number}</td>
                          <td className="py-2.5 px-3 text-slate-700 font-medium">{r.hostel?.name || 'Assigned'}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {r.room_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">Floor {r.floor_number}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-semibold text-slate-800 text-[11px]">
                                {r.current_occupancy} / {r.capacity} Beds
                              </span>
                              <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    occRatio >= 100 ? 'bg-rose-500' : occRatio > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${occRatio}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.occupancy_status === 'AVAILABLE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : r.occupancy_status === 'OCCUPIED'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {r.occupancy_status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
                <Bed className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-700">No Hostel Rooms Configured</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                  Click <strong>Add Room</strong> to configure individual rooms, capacity, and bed types for your campus hostels.
                </p>
              </div>
            )}
          </div>

          {/* Active Allocations Ledger */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Active Resident Bed Allocations</h3>
                <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.room_allocations</code></p>
              </div>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                Total Allocations: {roomAllocations.length}
              </span>
            </div>

            {roomAllocations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Resident Student</th>
                      <th className="py-2.5 px-3">Roll No</th>
                      <th className="py-2.5 px-3">Room &amp; Hostel</th>
                      <th className="py-2.5 px-3">Bed Label</th>
                      <th className="py-2.5 px-3">Allocated From</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roomAllocations.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {a.student?.full_name || 'Enrolled Student'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {a.student?.roll_number || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <span className="font-mono font-bold">{a.room?.room_number || 'Room'}</span>{' '}
                          <span className="text-slate-500">({a.room?.hostel?.name || 'Hostel'})</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">{a.bed_label || 'Bed 1'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {a.allocation_date ? new Date(a.allocation_date).toLocaleDateString() : 'Active'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              a.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {a.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {a.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleVacateAllocation(a.id)}
                              className="px-2 py-1 text-[10px] font-bold text-rose-700 hover:text-rose-900 hover:bg-rose-50 rounded transition-colors"
                              title="Mark Bed as Vacated"
                            >
                              Vacate Bed
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-300">
                <DoorOpen className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-700">No Active Room Allocations</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                  Allocate students to available beds using the <strong>Allocate Bed</strong> button above or during student enrollment.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: WARDENS */}
      {activeTab === 'wardens' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Warden Hostel Scope Mappings (FR-02)</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.warden_hostel_assignments</code></p>
            </div>
            <button
              onClick={() => setShowAssignWarden(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-ct-gold" />
              <span>Assign Warden</span>
            </button>
          </div>

          {wardenAssignments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Warden Official</th>
                    <th className="py-2.5 px-3">Duty Contact</th>
                    <th className="py-2.5 px-3">Assigned Hostel Facility</th>
                    <th className="py-2.5 px-3">Designation</th>
                    <th className="py-2.5 px-3">Assigned Date</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wardenAssignments.map((w) => {
                    const wardenProfile = staffProfiles.find((p) => p.id === w.warden_profile_id);
                    return (
                      <tr key={w.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">
                            {wardenProfile?.full_name || 'Hostel Warden'}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">
                            ID: {w.warden_profile_id.slice(0, 14)}...
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {wardenProfile?.phone_number || '-'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{w.hostel?.name || 'Assigned'}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              w.is_primary ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {w.is_primary ? 'Primary Warden' : 'Assistant Warden'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{new Date(w.assigned_at).toLocaleDateString()}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleRemoveWardenAssignment(w.id)}
                            className="px-2 py-1 text-[10px] font-bold text-rose-700 hover:text-rose-900 hover:bg-rose-50 rounded transition-colors"
                            title="Revoke Hostel Scope"
                          >
                            Unassign
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <UserCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700">No Explicit Warden Assignments</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                Wardens without specific assignments have fallback view across all hostels during onboarding. Assign them to strictly enforce hostel-level data isolation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: ATTENDANCE RECORDS */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          {/* Live Roll-Call Attendance Countdown & Central Staff Monitor */}
          <AttendanceCountdownTimer
            schedule={schedules[0] || null}
            allowSimulation={true}
            portalContext="staff"
          />

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Central Attendance Ledger &amp; Roll-Call History</h3>
              <p className="text-xs text-slate-500">
                Audited check-in records filtered by date, campus hostel facility, and student credentials
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search student, roll, room..."
                  value={attendanceStudentSearch}
                  onChange={(e) => setAttendanceStudentSearch(e.target.value)}
                  className="bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none w-36 sm:w-48"
                />
              </div>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="bg-transparent text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer"
                />
              </div>

              <select
                value={attendanceHostelFilter}
                onChange={(e) => setAttendanceHostelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer font-medium"
              >
                <option value="">All Hostels</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>

              <select
                value={attendanceStatusFilter}
                onChange={(e) => setAttendanceStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer font-medium"
              >
                <option value="">All Statuses</option>
                <option value="PRESENT">PRESENT</option>
                <option value="ABSENT">ABSENT</option>
                <option value="APPROVED_LEAVE">APPROVED_LEAVE</option>
                <option value="EXCUSED">EXCUSED</option>
                <option value="LATE_SUBMISSION">LATE_SUBMISSION</option>
                <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
              </select>

              <button
                onClick={handleRunAbsenceDetection}
                disabled={isRunningAbsenceDetection || schedules.length === 0}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                title="Evaluate roll-call deadlines, mark absent students, and queue guardian alerts"
              >
                <Clock className={`w-3.5 h-3.5 text-ct-gold ${isRunningAbsenceDetection ? 'animate-spin' : ''}`} />
                <span>{isRunningAbsenceDetection ? 'Evaluating...' : 'Detect Absences'}</span>
              </button>

              <button
                onClick={handleOpenPushForAbsentStudents}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white rounded-lg shadow-sm transition-colors cursor-pointer"
                title="Send Web Push alert to all absent students for this date"
              >
                <BellRing className="w-3.5 h-3.5 text-rose-200" />
                <span>Notify Absent ({todayAttendance.filter((r) => r.status === 'ABSENT').length})</span>
              </button>

              <button
                onClick={() => {
                  setAttDate(attendanceDate);
                  setShowRecordAttendance(true);
                }}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-white" />
                <span>Mark Attendance</span>
              </button>
            </div>
          </div>

          {/* Metrics summary banner for selected filters */}
          {(() => {
            const enrolledInScope = students.filter(
              (s) => !attendanceHostelFilter || s.hostel_id === attendanceHostelFilter
            );
            const totalEnrolled = enrolledInScope.length;
            const recordsInScope = todayAttendance.filter(
              (r) => !attendanceHostelFilter || r.student?.hostel_id === attendanceHostelFilter
            );
            const presentTotal = recordsInScope.filter((r) => r.status === 'PRESENT').length;
            const absentTotal = recordsInScope.filter((r) => r.status === 'ABSENT').length;
            const leaveTotal = recordsInScope.filter((r) => r.status === 'APPROVED_LEAVE' || r.status === 'EXCUSED').length;
            const pendingTotal = Math.max(0, totalEnrolled - recordsInScope.length);

            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Enrolled</span>
                  <span className="text-lg font-black text-slate-900">{totalEnrolled}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Campus Residents</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Confirmed Present</span>
                  <span className="text-lg font-black text-emerald-800">{presentTotal}</span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">Physical / Self Verified</span>
                </div>
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Marked Absent</span>
                  <span className="text-lg font-black text-rose-800">{absentTotal}</span>
                  <span className="text-[10px] text-rose-600 block mt-0.5">Alert Eligible</span>
                </div>
                <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
                  <span className="text-[10px] uppercase font-bold text-purple-700 block">Leave / Excused</span>
                  <span className="text-lg font-black text-purple-800">{leaveTotal}</span>
                  <span className="text-[10px] text-purple-600 block mt-0.5">Official Sanctions</span>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Pending Roll-Call</span>
                  <span className="text-lg font-black text-amber-800">{pendingTotal}</span>
                  <span className="text-[10px] text-amber-600 block mt-0.5">Awaiting Check-in</span>
                </div>
              </div>
            );
          })()}

          {/* Attendance Records Table */}
          {(() => {
            const searchLower = attendanceStudentSearch.toLowerCase().trim();
            const filteredAttendance = todayAttendance.filter((r) => {
              const matchesHostel = !attendanceHostelFilter || r.student?.hostel_id === attendanceHostelFilter;
              const matchesStatus = !attendanceStatusFilter || r.status === attendanceStatusFilter;
              const matchesSearch =
                !searchLower ||
                (r.student?.full_name?.toLowerCase().includes(searchLower)) ||
                (r.student?.roll_number?.toLowerCase().includes(searchLower)) ||
                (r.student?.room_number?.toLowerCase().includes(searchLower));
              return matchesHostel && matchesStatus && matchesSearch;
            });

            return filteredAttendance.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Roll No</th>
                      <th className="py-2.5 px-3">Student Name</th>
                      <th className="py-2.5 px-3">Hostel &amp; Room</th>
                      <th className="py-2.5 px-3">Schedule Slot</th>
                      <th className="py-2.5 px-3">Submission Time</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Verification</th>
                      <th className="py-2.5 px-3 text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAttendance.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono text-slate-700">{rec.attendance_date}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          {rec.student?.roll_number || '-'}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">
                          {rec.student?.full_name || 'Enrolled Student'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          <span className="font-mono font-semibold">{rec.student?.room_number || '-'}</span>{' '}
                          <span className="text-slate-400">({rec.student?.hostel?.name || 'Hostel'})</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{rec.schedule?.name || 'Roll Call'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {rec.submitted_at ? new Date(rec.submitted_at).toLocaleTimeString() : 'Manual Entry'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              rec.status === 'PRESENT'
                                ? 'bg-emerald-100 text-emerald-800'
                                : rec.status === 'ABSENT'
                                ? 'bg-rose-100 text-rose-800'
                                : rec.status === 'APPROVED_LEAVE'
                                ? 'bg-purple-100 text-purple-800'
                                : rec.status === 'EXCUSED'
                                ? 'bg-purple-100 text-purple-800'
                                : rec.status === 'LATE_SUBMISSION'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-500">
                          {rec.review_reason?.includes('FACE_AND_GEOFENCE') ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200" title={rec.review_reason}>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Face &amp; Geofence</span>
                            </span>
                          ) : rec.review_reason?.includes('FACE_RECOGNITION') ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Face Verified</span>
                            </span>
                          ) : (
                            <span className="font-mono">{rec.verification_status}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => handleQuickUpdateAttendanceStatus(rec.id, 'PRESENT')}
                              title="Quick-mark Present"
                              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                                rec.status === 'PRESENT'
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              }`}
                            >
                              Present
                            </button>
                            <button
                              onClick={() => handleQuickUpdateAttendanceStatus(rec.id, 'ABSENT')}
                              title="Quick-mark Absent"
                              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                                rec.status === 'ABSENT'
                                  ? 'bg-rose-600 text-white shadow-sm'
                                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                              }`}
                            >
                              Absent
                            </button>
                            <button
                              onClick={() => handleQuickUpdateAttendanceStatus(rec.id, 'EXCUSED')}
                              title="Quick-mark Excused"
                              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                                rec.status === 'EXCUSED'
                                  ? 'bg-purple-600 text-white shadow-sm'
                                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                              }`}
                            >
                              Excuse
                            </button>
                            <button
                              onClick={() => {
                                const st = students.find((s) => s.id === rec.student_id) || rec.student;
                                if (st) handleOpenPushForSingleStudent(st);
                              }}
                              title="Send Web Push alert to this student"
                              className="px-2 py-1 rounded text-[10px] font-bold bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 inline-flex items-center gap-1 transition-colors cursor-pointer"
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
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="font-bold text-slate-700">No Attendance Records for {attendanceDate}</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                  {attendanceStudentSearch
                    ? `No submissions match "${attendanceStudentSearch}".`
                    : 'No attendance records match the selected date and hostel filters. Click "Mark Attendance" above to record roll-call.'}
                </p>
              </div>
            );
          })()}
        </div>
      </div>
    )}

      {/* Tab: SCHEDULES */}
      {activeTab === 'schedules' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Attendance Windows &amp; Curfew Schedules</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.attendance_schedules</code></p>
            </div>
            <button
              onClick={() => setShowAddSchedule(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-ct-gold" />
              <span>Add Window</span>
            </button>
          </div>

          {schedules.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Window Name</th>
                    <th className="py-2.5 px-3">Hostel</th>
                    <th className="py-2.5 px-3">Start Time</th>
                    <th className="py-2.5 px-3">Deadline Time</th>
                    <th className="py-2.5 px-3">Grace Period</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{s.name}</td>
                      <td className="py-2.5 px-3 text-slate-600">{s.hostel?.name || 'All Hostels'}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{s.start_time}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{s.deadline_time}</td>
                      <td className="py-2.5 px-3 text-slate-600">{s.grace_period_minutes} mins</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              No custom attendance windows configured yet. Click <strong>Add Window</strong> to configure one.
            </div>
          )}
        </div>
      )}

      {/* Tab: LEAVES */}
      {activeTab === 'leaves' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Student Leave Management &amp; Approvals</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.leave_requests</code></p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              Pending Reviews: {pendingLeavesCount}
            </span>
          </div>

          {leaveRequests.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Student</th>
                    <th className="py-2.5 px-3">Dates</th>
                    <th className="py-2.5 px-3">Reason Category</th>
                    <th className="py-2.5 px-3">Approval Status</th>
                    <th className="py-2.5 px-3 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaveRequests.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{l.student?.full_name || 'Enrolled Student'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{l.start_date} to {l.end_date}</td>
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
                              title="Approve Leave"
                            >
                              <Check className="w-3 h-3" />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => handleReviewLeave(l.id, 'REJECTED')}
                              className="px-2 py-1 text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded flex items-center gap-1 shadow-sm transition-colors"
                              title="Reject Leave"
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
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <FileCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700">No Student Leave Requests Filed</p>
              <p className="text-[11px] text-slate-500 mt-1">Leaves submitted by residents will appear here for review.</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: ALERTS */}
      {activeTab === 'alerts' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Guardian Alert Queue &amp; Dispatch Ledger</h3>
              <p className="text-xs text-slate-500">Tables: <code className="font-mono text-slate-700">notification_events, call_sessions</code></p>
            </div>
            <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-md">
              Total Alerts: {recentAlerts.length}
            </span>
          </div>

          {/* Institutional Provider Notice (Requirement 10) */}
          <div className="p-4 rounded-xl bg-slate-900 text-white border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-ct-gold font-bold">
              <PhoneCall className="w-4 h-4" />
              <span>Institutional Telephony &amp; SMS Gateway Status: Standby / Provider Setup Required (FR-04, FR-09)</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Real cellular SMS alerts and DTMF IVR voice calls require active provider credentials (such as Twilio Account SID or Exotel API Key).
              Simulated or fake telephone calls are strictly forbidden to maintain audit integrity. When alerts trigger, events are logged into the database table <code className="text-ct-gold bg-slate-800 px-1 py-0.5 rounded font-mono">notification_events</code> with status <code className="text-amber-400 bg-slate-800 px-1 py-0.5 rounded font-mono">QUEUED</code> until provider webhooks are connected.
            </p>
          </div>

          {/* Action Bar: Queue Absence Alerts */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center space-x-2 text-xs">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="font-semibold text-slate-700">Target Attendance Date:</span>
              <input
                type="date"
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-ct-navy"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={alertChannelFilter}
                onChange={(e) => setAlertChannelFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer"
              >
                <option value="all">All Channels</option>
                <option value="sms">SMS Only</option>
                <option value="voice">Voice Call Only</option>
              </select>

              <select
                value={alertStatusFilter}
                onChange={(e) => setAlertStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer"
              >
                <option value="all">All Delivery Statuses</option>
                <option value="QUEUED">QUEUED (Pending Gateway)</option>
                <option value="SENT">SENT (Handshake)</option>
                <option value="DELIVERED">DELIVERED (Ack)</option>
                <option value="FAILED">FAILED</option>
              </select>

              <button
                onClick={handleQueueAbsenceAlerts}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-ct-navy hover:bg-ct-navy-light text-white rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <PhoneCall className="w-3.5 h-3.5 text-ct-gold" />
                <span>Queue Absence Alerts for {attendanceDate}</span>
              </button>

              <button
                onClick={handleProcessSequentialQueue}
                disabled={callQueueProgress?.isActive}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                title="Process queued absence calls sequentially, one at a time"
              >
                <Radio className="w-3.5 h-3.5 text-emerald-200" />
                <span>{callQueueProgress?.isActive ? `Processing [${callQueueProgress.currentCallIndex}/${callQueueProgress.totalCalls}]...` : 'Process Sequential Queue'}</span>
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

          {(() => {
            const filteredAlerts = recentAlerts.filter((a) => {
              const matchesChannel = alertChannelFilter === 'all' || a.channel === alertChannelFilter;
              const matchesStatus = alertStatusFilter === 'all' || a.delivery_status === alertStatusFilter;
              return matchesChannel && matchesStatus;
            });

            return filteredAlerts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Event Type</th>
                      <th className="py-2.5 px-3">Target Resident</th>
                      <th className="py-2.5 px-3">Guardian Contact</th>
                      <th className="py-2.5 px-3">Channel</th>
                      <th className="py-2.5 px-3">Delivery Status</th>
                      <th className="py-2.5 px-3">Gateway Reference</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3 text-right">Telephony Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAlerts.map((a) => {
                      const attRec = todayAttendance.find((r: AttendanceRecord) => r.id === a.attendance_record_id);
                      const st = students.find((s) => s.guardian_id === a.guardian_id || s.id === attRec?.student_id);
                      const guardian = st?.guardian || st?.guardians;

                      return (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{a.event_type}</td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-slate-800 block">
                              {st?.full_name || 'Resident'}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 block">
                              Roll: {st?.roll_number || 'N/A'} • Room: {st?.room_number || '-'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-medium text-slate-800 block">
                              {guardian?.full_name || 'Designated Guardian'}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 block">
                              {guardian?.phone_number || 'Contact on file'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {a.channel === 'sms' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-800 border border-blue-200">
                                <MessageSquare className="w-3 h-3 text-blue-600" />
                                <span>SMS</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-50 text-purple-800 border border-purple-200">
                                <PhoneCall className="w-3 h-3 text-purple-600" />
                                <span>Voice IVR</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                a.delivery_status === 'DELIVERED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : a.delivery_status === 'SENT'
                                  ? 'bg-blue-100 text-blue-800'
                                  : a.delivery_status === 'FAILED'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {a.delivery_status === 'QUEUED' ? 'QUEUED (Pending Gateway)' : a.delivery_status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500">
                            {a.provider_reference || 'Gateway Standby (Audit Safe)'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {a.channel === 'voice' && (
                                <>
                                  <button
                                    onClick={() => handleDispatchCall(a)}
                                    className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                    title="Dispatch outbound call via Twilio/Exotel gateway"
                                  >
                                    <PhoneCall className="w-3 h-3" />
                                    <span>Call</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setActiveTestAlert(a);
                                      setIvrActionResponse(null);
                                      setShowIvrTester(true);
                                    }}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Interactive Hindi IVR console & DTMF testing"
                                  >
                                    <Radio className="w-3 h-3 text-slate-500" />
                                    <span>Test IVR</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <PhoneCall className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="font-bold text-slate-700">No Alerts Match Selected Filters</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                  Absence alerts dispatch automatically when students miss their designated roll-call deadline window.
                </p>
              </div>
            );
          })()}

          {/* External Gateway Provider Documentation Card */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center space-x-2 text-slate-900 font-bold">
              <ShieldAlert className="w-4 h-4 text-ct-navy" />
              <span>External Gateway Provider Integration Reference (Twilio / Exotel)</span>
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              To dispatch queued SMS and IVR voice calls to Indian telecom carriers (+91), configure the following environment credentials in your Supabase Edge Function environment:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block">Twilio Credentials (SMS &amp; Voice)</span>
                <p className="text-slate-600">• TWILIO_ACCOUNT_SID: ACxxxxxxxxxxxxxxxxxxxxxx</p>
                <p className="text-slate-600">• TWILIO_AUTH_TOKEN: your_auth_token_here</p>
                <p className="text-slate-600">• TWILIO_PHONE_NUMBER: +1xxxxxxxxxx or Alphanumeric Sender ID</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block">Exotel Credentials (India IVR Bridge)</span>
                <p className="text-slate-600">• EXOTEL_SID: your_exotel_sid</p>
                <p className="text-slate-600">• EXOTEL_API_KEY: your_api_key</p>
                <p className="text-slate-600">• EXOTEL_CALLER_ID: 080xxxxxxxx</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              When unconfigured, all alert events safely persist in the database in <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">QUEUED</code> status. No simulated or mock calls are made.
            </p>
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
                    const allRecipients: StudentRecipient[] = students.map((s) => ({
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

      {/* Tab: STAFF & PROFILES */}
      {activeTab === 'staff' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Institutional Accounts &amp; Roles</h3>
              <p className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.profiles</code> • Match Profile UUIDs to student roster records</p>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
              Total Profiles: {staffProfiles.length}
            </span>
          </div>

          {/* Search and Role Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by name or Profile UUID..."
                value={staffSearchTerm}
                onChange={(e) => setStaffSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-ct-navy bg-white"
              />
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-xs text-slate-500 font-medium">Filter Role:</span>
              <select
                value={staffRoleFilter}
                onChange={(e) => setStaffRoleFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:ring-1 focus:ring-ct-navy cursor-pointer"
              >
                <option value="all">All Roles ({staffProfiles.length})</option>
                <option value="student">Student Accounts ({staffProfiles.filter((p) => p.role === 'student').length})</option>
                <option value="guardian">Guardians ({staffProfiles.filter((p) => p.role === 'guardian').length})</option>
                <option value="warden">Wardens ({staffProfiles.filter((p) => p.role === 'warden').length})</option>
                <option value="admin">Administrators ({staffProfiles.filter((p) => p.role === 'admin').length})</option>
              </select>
            </div>
          </div>

          {(() => {
            const filteredStaffProfiles = staffProfiles.filter((p) => {
              const matchesSearch =
                p.full_name?.toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
                p.id.toLowerCase().includes(staffSearchTerm.toLowerCase());
              const matchesRole = staffRoleFilter === 'all' || p.role === staffRoleFilter;
              return matchesSearch && matchesRole;
            });

            return filteredStaffProfiles.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Name &amp; ID</th>
                      <th className="py-2.5 px-3">Role Badge</th>
                      <th className="py-2.5 px-3">Student Roster Link</th>
                      <th className="py-2.5 px-3">Account Status</th>
                      <th className="py-2.5 px-3 text-right">Assign Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStaffProfiles.map((p) => {
                      const linkedStudent = students.find((st) => st.profile_id === p.id);
                      const unlinkedStudents = students.filter((st) => !st.profile_id);

                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">{p.full_name || 'Registered User'}</div>
                            <div className="font-mono text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <span className="text-slate-400">UUID:</span>
                              <span className="text-slate-800 select-all font-semibold" title={p.id}>{p.id}</span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(p.id);
                                  setCopiedProfileId(p.id);
                                  setTimeout(() => setCopiedProfileId(null), 2000);
                                }}
                                className="p-0.5 text-slate-400 hover:text-ct-navy transition-colors cursor-pointer"
                                title="Copy Profile UUID"
                              >
                                {copiedProfileId === p.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                p.role === 'admin'
                                  ? 'bg-purple-100 text-purple-800'
                                  : p.role === 'warden'
                                  ? 'bg-blue-100 text-blue-800'
                                  : p.role === 'guardian'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {p.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {p.role === 'student' ? (
                              linkedStudent ? (
                                <div className="flex items-center space-x-1.5">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    {linkedStudent.roll_number} • {linkedStudent.full_name}
                                  </span>
                                  <button
                                    onClick={() => handleLinkStudentProfile(linkedStudent.id, null)}
                                    className="text-[10px] text-rose-600 hover:text-rose-800 underline cursor-pointer"
                                    title="Unlink student profile"
                                  >
                                    Unlink
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1.5">
                                  <select
                                    onChange={(e) => {
                                      if (e.target.value) handleLinkStudentProfile(e.target.value, p.id);
                                    }}
                                    defaultValue=""
                                    className="bg-white border border-amber-300 text-amber-900 rounded px-1.5 py-0.5 text-[10px] font-medium focus:ring-1 focus:ring-amber-500 cursor-pointer max-w-[200px]"
                                  >
                                    <option value="">-- Link to Enrolled Student --</option>
                                    {unlinkedStudents.map((st) => (
                                      <option key={st.id} value={st.id}>
                                        {st.roll_number} - {st.full_name} ({st.room_number ? `Room ${st.room_number}` : 'No Room'})
                                      </option>
                                    ))}
                                  </select>
                                  {unlinkedStudents.length === 0 && (
                                    <span className="text-[10px] text-slate-400">All roster students linked</span>
                                  )}
                                </div>
                              )
                            ) : p.role === 'guardian' ? (
                              <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Guardian Account
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono">Staff Account</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center space-x-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  p.is_active
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {p.is_active ? 'Active' : 'Inactive'}
                              </span>
                              <button
                                onClick={() => handleToggleAccountActive(p.id, p.is_active)}
                                className="text-[10px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                              >
                                {p.is_active ? 'Suspend' : 'Activate'}
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <select
                              value={p.role}
                              onChange={(e) => handleUpdateRole(p.id, e.target.value as 'admin' | 'warden' | 'student' | 'guardian')}
                              className="bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-medium text-slate-700 cursor-pointer focus:ring-1 focus:ring-ct-navy"
                            >
                              <option value="student">Student</option>
                              <option value="guardian">Guardian</option>
                              <option value="warden">Warden</option>
                              <option value="admin">Administrator</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="font-bold text-slate-700">No Profiles Match Filters</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                  Try adjusting your search query or role filter.
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Tab: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Append-Only Governance Audit Trail</h3>
            <span className="text-xs text-slate-500">Table: <code className="font-mono text-slate-700">public.audit_logs</code></span>
          </div>
          <p className="text-xs text-slate-500">
            Tracks administrative actions, role modifications, and attendance corrections with mandatory actor IDs.
          </p>
          {auditLogs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Entity</th>
                    <th className="py-2.5 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono text-slate-600">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{log.action}</td>
                      <td className="py-2.5 px-3 text-slate-700">{log.entity_type}</td>
                      <td className="py-2.5 px-3 text-slate-600">{log.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              Audit logging active. System records append automatically on administrative transactions.
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: Add Campus Hostel Facility */}
      {/* ===================================================================== */}
      {showAddHostel && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Add Campus Hostel Facility</h4>
              <button
                onClick={() => setShowAddHostel(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateHostel} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hostel Facility Name</label>
                <input
                  type="text"
                  required
                  value={newHostelName}
                  onChange={(e) => setNewHostelName(e.target.value)}
                  placeholder="e.g. CT Boys Hostel Block A"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Warden Duty Contact Phone</label>
                <input
                  type="text"
                  required
                  value={newHostelWardenPhone}
                  onChange={(e) => setNewHostelWardenPhone(e.target.value)}
                  placeholder="+91-98XXXXXXXX"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-slate-700">Geofence Tolerance (Meters)</label>
                  <span className="text-[10px] text-slate-500 font-mono">435m extent + 100m margin = 535m</span>
                </div>
                <input
                  type="number"
                  min="50"
                  max="1000"
                  value={newHostelRadius}
                  onChange={(e) => setNewHostelRadius(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Shahpur Campus Pin: 31.236872, 75.553745. Radius matches verified road boundary extent (435m) plus 100m margin.
                </p>
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddHostel(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Hostel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: Add Attendance Schedule Window */}
      {/* ===================================================================== */}
      {showAddSchedule && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Configure Attendance Window</h4>
              <button
                onClick={() => setShowAddSchedule(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Window Title / Name</label>
                <input
                  type="text"
                  required
                  value={newScheduleName}
                  onChange={(e) => setNewScheduleName(e.target.value)}
                  placeholder="e.g. Morning Roll Call or Night Curfew Check"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Hostel Facility</label>
                <select
                  value={newScheduleHostelId}
                  onChange={(e) => setNewScheduleHostelId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  {hostels.length > 0 ? (
                    hostels.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No Hostels Found (Add Hostel First)</option>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Time (24h)</label>
                  <input
                    type="time"
                    required
                    value={newScheduleStart}
                    onChange={(e) => setNewScheduleStart(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Deadline Time (24h)</label>
                  <input
                    type="time"
                    required
                    value={newScheduleDeadline}
                    onChange={(e) => setNewScheduleDeadline(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Grace Period (Minutes)</label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={newScheduleGrace}
                  onChange={(e) => setNewScheduleGrace(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSchedule(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: Enroll New Student */}
      {/* ===================================================================== */}
      {showEnrollStudent && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Enroll New Resident Student</h4>
              <button
                onClick={() => setShowEnrollStudent(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEnrollStudent} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Student Full Name</label>
                  <input
                    type="text"
                    required
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Roll Number</label>
                  <input
                    type="text"
                    required
                    value={newRollNumber}
                    onChange={(e) => setNewRollNumber(e.target.value)}
                    placeholder="e.g. 2425001"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    required
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    placeholder="e.g. CSE / ECE / Mechanical"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Academic Year</label>
                  <input
                    type="text"
                    required
                    value={newAcademicYear}
                    onChange={(e) => setNewAcademicYear(e.target.value)}
                    placeholder="e.g. 2024-2028"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hostel Facility</label>
                  <select
                    value={newStudentHostelId}
                    onChange={(e) => {
                      setNewStudentHostelId(e.target.value);
                      setSelectedExistingRoomId('');
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    {hostels.length > 0 ? (
                      hostels.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No Hostels Found (Add Hostel First)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Select Configured Room (Optional)</label>
                  <select
                    value={selectedExistingRoomId}
                    onChange={(e) => {
                      setSelectedExistingRoomId(e.target.value);
                      const r = hostelRooms.find((rm) => rm.id === e.target.value);
                      if (r) setNewRoomNumber(r.room_number);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    <option value="">Manual Room Input</option>
                    {hostelRooms
                      .filter((r) => !newStudentHostelId || r.hostel_id === newStudentHostelId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          Room {r.room_number} ({r.current_occupancy}/{r.capacity} Beds - {r.room_type})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Room Number</label>
                <input
                  type="text"
                  required
                  value={newRoomNumber}
                  onChange={(e) => setNewRoomNumber(e.target.value)}
                  placeholder="e.g. 101 or B-204"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                />
              </div>

              {/* Guardian Info */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <span className="font-bold text-slate-800 block">Guardian Contact &amp; Notification Consent (FR-03, FR-04)</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Guardian Name</label>
                    <input
                      type="text"
                      required
                      value={newGuardianName}
                      onChange={(e) => setNewGuardianName(e.target.value)}
                      placeholder="e.g. R. K. Sharma"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Relationship</label>
                    <select
                      value={newGuardianRelation}
                      onChange={(e) => setNewGuardianRelation(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Local Guardian">Local Guardian</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Emergency Phone</label>
                    <input
                      type="text"
                      required
                      value={newGuardianPhone}
                      onChange={(e) => setNewGuardianPhone(e.target.value)}
                      placeholder="+91-98XXXXXXXX"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Preferred Notification Language</label>
                    <select
                      value={newGuardianLanguage}
                      onChange={(e) => setNewGuardianLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                    >
                      <option value="hi">Hindi (हिंदी)</option>
                      <option value="pa">Punjabi (ਪੰਜਾਬੀ)</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Notification Delivery Channels</label>
                    <div className="flex items-center space-x-3 pt-2 text-slate-700">
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newVoiceConsent}
                          onChange={(e) => setNewVoiceConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>Voice Call</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newSmsConsent}
                          onChange={(e) => setNewSmsConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>SMS</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newWhatsappConsent}
                          onChange={(e) => setNewWhatsappConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>WhatsApp</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Optional Profile ID Link */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Link to Registered User Profile (Optional)</label>
                <select
                  value={newStudentProfileId}
                  onChange={(e) => setNewStudentProfileId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">No User Linked (Assign Later)</option>
                  {staffProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.role}) - {p.id.slice(0, 8)}...
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Linking links this student record to their login account so they can self-mark attendance.
                </p>
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEnrollStudent(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold hover:bg-emerald-800 disabled:opacity-50"
                >
                  {isSubmitting ? 'Enrolling...' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3B: Bulk Student Import via Excel / CSV */}
      {/* ===================================================================== */}
      <BulkStudentUploadModal
        isOpen={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        hostels={hostels}
        selectedHostelId={selectedHostelFilter || (hostels.length > 0 ? hostels[0].id : undefined)}
        onSuccess={() => {
          loadData();
        }}
      />

      {/* ===================================================================== */}
      {/* MODAL 4: Assign Warden to Hostel */}
      {/* ===================================================================== */}
      {showAssignWarden && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Assign Warden to Hostel</h4>
              <button
                onClick={() => setShowAssignWarden(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAssignWarden} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Warden Profile</label>
                <select
                  value={selectedWardenId}
                  onChange={(e) => setSelectedWardenId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select a Warden</option>
                  {staffProfiles
                    .filter((p) => p.role === 'warden' || p.role === 'admin')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({p.role.toUpperCase()})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Target Hostel Facility</label>
                <select
                  value={selectedHostelId}
                  onChange={(e) => setSelectedHostelId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select a Hostel</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Designation / Responsibility Scope</label>
                <div className="flex items-center space-x-4 pt-1">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="wardenRoleType"
                      checked={assignIsPrimary}
                      onChange={() => setAssignIsPrimary(true)}
                      className="text-ct-navy focus:ring-ct-navy"
                    />
                    <span className="font-medium text-slate-800">Primary Warden</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="wardenRoleType"
                      checked={!assignIsPrimary}
                      onChange={() => setAssignIsPrimary(false)}
                      className="text-ct-navy focus:ring-ct-navy"
                    />
                    <span className="font-medium text-slate-800">Assistant Warden</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAssignWarden(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : 'Assign Warden'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: Add Hostel Room */}
      {/* ===================================================================== */}
      {showAddRoom && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Add Hostel Room</h4>
              <button
                onClick={() => setShowAddRoom(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateRoom} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hostel Facility</label>
                <select
                  value={newRoomHostelId}
                  onChange={(e) => {
                    setNewRoomHostelId(e.target.value);
                    setNewRoomBlockId('');
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select a Hostel</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hostel Block / Section (Optional)</label>
                <select
                  value={newRoomBlockId}
                  onChange={(e) => setNewRoomBlockId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">No Specific Block</option>
                  {hostelBlocks
                    .filter((b) => !newRoomHostelId || b.hostel_id === newRoomHostelId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.block_name} ({b.gender_designation})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Room Number</label>
                  <input
                    type="text"
                    required
                    value={newRoomNumberVal}
                    onChange={(e) => setNewRoomNumberVal(e.target.value)}
                    placeholder="e.g. 101 or B-204"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Floor Number</label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={newRoomFloor}
                    onChange={(e) => setNewRoomFloor(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Room Type</label>
                  <select
                    value={newRoomType}
                    onChange={(e) => setNewRoomType(e.target.value as RoomType)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    <option value="SINGLE">SINGLE (1 Bed)</option>
                    <option value="DOUBLE">DOUBLE (2 Beds)</option>
                    <option value="TRIPLE">TRIPLE (3 Beds)</option>
                    <option value="DORMITORY">DORMITORY (4+ Beds)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bed Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newRoomCapacity}
                    onChange={(e) => setNewRoomCapacity(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddRoom(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 6: Allocate Bed to Resident */}
      {/* ===================================================================== */}
      {showAllocateRoom && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Allocate Bed to Resident</h4>
              <button
                onClick={() => setShowAllocateRoom(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAllocateRoom} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Student</label>
                <select
                  value={allocStudentId}
                  onChange={(e) => setAllocStudentId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select an enrolled student</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.roll_number}) - Current Room: {s.room_number || 'None'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Target Room</label>
                <select
                  value={allocRoomId}
                  onChange={(e) => setAllocRoomId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select a room with available beds</option>
                  {hostelRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} ({r.hostel?.name || 'Hostel'}) — {r.current_occupancy}/{r.capacity} Beds ({r.occupancy_status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bed Label</label>
                <input
                  type="text"
                  required
                  value={allocBedLabel}
                  onChange={(e) => setAllocBedLabel(e.target.value)}
                  placeholder="e.g. Bed A, Bed B, Bed 1"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Allocation Notes (Optional)</label>
                <input
                  type="text"
                  value={allocNotes}
                  onChange={(e) => setAllocNotes(e.target.value)}
                  placeholder="e.g. Medical request lower bunk"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllocateRoom(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold hover:bg-emerald-800 disabled:opacity-50"
                >
                  {isSubmitting ? 'Allocating...' : 'Confirm Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 9: Add Residential Hostel Block */}
      {/* ===================================================================== */}
      {showAddBlock && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">Add Residential Block / Wing</h4>
              <button
                onClick={() => setShowAddBlock(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateBlock} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select Campus Hostel Facility</label>
                <select
                  value={newBlockHostelId}
                  onChange={(e) => setNewBlockHostelId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">Select a Hostel</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Block / Wing Name</label>
                <input
                  type="text"
                  required
                  value={newBlockName}
                  onChange={(e) => setNewBlockName(e.target.value)}
                  placeholder="e.g. Block A, East Wing, Tower 1"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Gender Designation</label>
                  <select
                    value={newBlockGender}
                    onChange={(e) => setNewBlockGender(e.target.value as 'BOYS' | 'GIRLS' | 'COED')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    <option value="BOYS">BOYS</option>
                    <option value="GIRLS">GIRLS</option>
                    <option value="COED">COED</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Total Floors</label>
                  <input
                    type="number"
                    min="1"
                    max="15"
                    value={newBlockFloors}
                    onChange={(e) => setNewBlockFloors(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddBlock(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-ct-navy text-white font-bold hover:bg-ct-navy-light disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Block'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 7: View Student Details */}
      {/* ===================================================================== */}
      {selectedStudentForView && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-bold text-slate-900">{selectedStudentForView.full_name}</h4>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedStudentForView.enrollment_status === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-800'
                      : selectedStudentForView.enrollment_status === 'SUSPENDED'
                      ? 'bg-amber-100 text-amber-800'
                      : selectedStudentForView.enrollment_status === 'EXPELLED'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {selectedStudentForView.enrollment_status}
                </span>
              </div>
              <button
                onClick={() => setSelectedStudentForView(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Academic & Room Info */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Roll Number</span>
                  <span className="font-mono font-bold text-slate-800">{selectedStudentForView.roll_number}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Student Code</span>
                  <span className="font-mono text-slate-800">{selectedStudentForView.student_code}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Department</span>
                  <span className="text-slate-800">{selectedStudentForView.department}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Academic Year</span>
                  <span className="font-mono text-slate-800">{selectedStudentForView.academic_year}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Hostel Facility</span>
                  <span className="font-semibold text-slate-800">{selectedStudentForView.hostel?.name || 'Unassigned'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Room Number</span>
                  <span className="font-mono font-bold text-slate-800">{selectedStudentForView.room_number || '-'}</span>
                </div>
              </div>

              {/* Guardian Info */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Guardian Emergency Contact (FR-03)</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-500 text-[11px] block">Guardian Name</span>
                    <span className="font-semibold text-slate-800">{selectedStudentForView.guardian?.full_name || 'Not Recorded'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[11px] block">Relationship</span>
                    <span className="text-slate-800">{selectedStudentForView.guardian?.relationship || 'Parent / Guardian'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[11px] block">Emergency Phone</span>
                    <span className="font-mono font-bold text-slate-800">{selectedStudentForView.guardian?.phone_number || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[11px] block">Preferred Language</span>
                    <span className="text-slate-800">
                      {selectedStudentForView.guardian?.preferred_language === 'hi'
                        ? 'Hindi (हिंदी)'
                        : selectedStudentForView.guardian?.preferred_language === 'pa'
                        ? 'Punjabi (ਪੰਜਾਬੀ)'
                        : 'English'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 text-[11px] block mb-1">Notification Delivery Status:</span>
                  <div className="flex items-center space-x-3 text-slate-700">
                    <span className="flex items-center space-x-1.5">
                      <span className={`w-2 h-2 rounded-full ${selectedStudentForView.guardian?.notification_consent_status === 'CONSENTED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <span className="font-semibold text-slate-800">
                        Consent: {selectedStudentForView.guardian?.notification_consent_status || 'CONSENTED'}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      (Voice &amp; SMS Dispatch Active)
                    </span>
                  </div>
                </div>
              </div>

              {/* Linked User Profile */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Student Self-Attendance Portal Link</span>
                <p className="text-slate-700 font-mono mt-0.5">
                  {selectedStudentForView.profile_id
                    ? `Linked Profile UUID: ${selectedStudentForView.profile_id}`
                    : 'No portal user linked. Student cannot self-mark attendance until linked.'}
                </p>
              </div>

              {/* Facial Recognition Biometric Template */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Biometric Facial Template</span>
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        hasStudentFaceTemplate(selectedStudentForView.id, selectedStudentForView.roll_number)
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      {hasStudentFaceTemplate(selectedStudentForView.id, selectedStudentForView.roll_number)
                        ? 'Template Enrolled & Active'
                        : 'Biometric Enrollment Pending'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const st = selectedStudentForView;
                    setSelectedStudentForView(null);
                    setStudentForBiometricEnroll(st);
                  }}
                  className="px-3 py-1.5 bg-ct-navy hover:bg-ct-navy-light text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-ct-gold" />
                  <span>
                    {hasStudentFaceTemplate(selectedStudentForView.id, selectedStudentForView.roll_number)
                      ? 'Re-enroll Face'
                      : 'Enroll Biometrics'}
                  </span>
                </button>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedStudentForView(null)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenEditStudent(selectedStudentForView);
                    setSelectedStudentForView(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold hover:bg-emerald-800"
                >
                  Edit Student
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 8: Edit Student Record */}
      {/* ===================================================================== */}
      {selectedStudentForEdit && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="text-sm font-bold text-slate-900">
                Edit Student: {selectedStudentForEdit.full_name} ({selectedStudentForEdit.roll_number})
              </h4>
              <button
                onClick={() => setSelectedStudentForEdit(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveEditStudent} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Student Full Name</label>
                  <input
                    type="text"
                    required
                    value={editStudentName}
                    onChange={(e) => setEditStudentName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Roll Number</label>
                  <input
                    type="text"
                    required
                    value={editRollNumber}
                    onChange={(e) => setEditRollNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Student Code</label>
                  <input
                    type="text"
                    required
                    value={editStudentCode}
                    onChange={(e) => setEditStudentCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Enrollment Status</label>
                  <select
                    value={editEnrollmentStatus}
                    onChange={(e) => setEditEnrollmentStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                    <option value="ALUMNI">ALUMNI</option>
                    <option value="EXPELLED">EXPELLED</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    required
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Academic Year</label>
                  <input
                    type="text"
                    required
                    value={editAcademicYear}
                    onChange={(e) => setEditAcademicYear(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hostel Facility</label>
                  <select
                    value={editHostelId}
                    onChange={(e) => setEditHostelId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                  >
                    <option value="">Select a Hostel</option>
                    {hostels.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned Room Number</label>
                  <input
                    type="text"
                    required
                    value={editRoomNumber}
                    onChange={(e) => setEditRoomNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                  />
                </div>
              </div>

              {/* Guardian Info */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <span className="font-bold text-slate-800 block">Guardian Contact &amp; Notification Settings (FR-03, FR-04)</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Guardian Name</label>
                    <input
                      type="text"
                      required
                      value={editGuardianName}
                      onChange={(e) => setEditGuardianName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Relationship</label>
                    <select
                      value={editGuardianRelation}
                      onChange={(e) => setEditGuardianRelation(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Local Guardian">Local Guardian</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Emergency Phone</label>
                    <input
                      type="text"
                      required
                      value={editGuardianPhone}
                      onChange={(e) => setEditGuardianPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Preferred Notification Language</label>
                    <select
                      value={editGuardianLanguage}
                      onChange={(e) => setEditGuardianLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                    >
                      <option value="hi">Hindi (हिंदी)</option>
                      <option value="pa">Punjabi (ਪੰਜਾਬੀ)</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Notification Delivery Channels</label>
                    <div className="flex items-center space-x-3 pt-2 text-slate-700">
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editVoiceConsent}
                          onChange={(e) => setEditVoiceConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>Voice Call</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editSmsConsent}
                          onChange={(e) => setEditSmsConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>SMS</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editWhatsappConsent}
                          onChange={(e) => setEditWhatsappConsent(e.target.checked)}
                          className="rounded text-ct-navy focus:ring-ct-navy"
                        />
                        <span>WhatsApp</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Linked User Profile */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Link to Registered User Profile</label>
                <select
                  value={editProfileId}
                  onChange={(e) => setEditProfileId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white"
                >
                  <option value="">No User Linked</option>
                  {staffProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.role}) - {p.id.slice(0, 8)}...
                    </option>
                  ))}
                </select>
              </div>

              {formStatus && (
                <p className="text-[11px] p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {formStatus}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedStudentForEdit(null)}
                  className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold hover:bg-emerald-800 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Record Attendance / Manual Roll-Call */}
      {showRecordAttendance && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Record Student Attendance</h3>
                  <p className="text-xs text-slate-500">Manual Roll-Call &amp; Physical Check-in Entry</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowRecordAttendance(false);
                  setAttNotes('');
                }}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1 leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAdminRecordAttendance} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Enrolled Student <span className="text-rose-500">*</span>
                </label>
                <select
                  value={attStudentId}
                  onChange={(e) => setAttStudentId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white font-medium text-slate-800"
                >
                  <option value="">-- Select Student --</option>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.roll_number} - {st.full_name} ({st.hostel?.name || 'Hostel'} - Room {st.room_number || 'N/A'})
                    </option>
                  ))}
                </select>
                {students.length === 0 && (
                  <p className="text-[11px] text-rose-500 mt-1">
                    No enrolled students found. Please enroll students first.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Attendance Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={attDate || attendanceDate}
                    onChange={(e) => setAttDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Attendance Window <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={attScheduleId || schedules[0]?.id || ''}
                    onChange={(e) => setAttScheduleId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white text-slate-800 font-medium"
                  >
                    {schedules.map((sch) => (
                      <option key={sch.id} value={sch.id}>
                        {sch.name} ({sch.start_time.slice(0, 5)} - {sch.deadline_time.slice(0, 5)})
                      </option>
                    ))}
                  </select>
                  {schedules.length === 0 && (
                    <p className="text-[11px] text-rose-500 mt-1">
                      No windows defined. Create an Attendance Window first.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Attendance Status <span className="text-rose-500">*</span>
                </label>
                <select
                  value={attStatus}
                  onChange={(e) => setAttStatus(e.target.value as AttendanceStatus)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white font-bold text-slate-800"
                >
                  <option value="PRESENT">PRESENT (Physically In Room / Biometric Verified)</option>
                  <option value="ABSENT">ABSENT (Unaccounted / Curfew Breach Alert)</option>
                  <option value="APPROVED_LEAVE">APPROVED_LEAVE (Officially Sanctioned)</option>
                  <option value="EXCUSED">EXCUSED (Medical / Special Exemption)</option>
                  <option value="LATE_SUBMISSION">LATE_SUBMISSION (Grace Window Arrival)</option>
                  <option value="PENDING_VERIFICATION">PENDING_VERIFICATION (Under Review)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Verification Notes / Audit Reason
                </label>
                <textarea
                  rows={2}
                  value={attNotes}
                  onChange={(e) => setAttNotes(e.target.value)}
                  placeholder="e.g. Physical floor roll-call by administrator, biometric scanner override"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-ct-navy bg-white text-slate-800"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600">
                <span className="font-bold text-slate-700">Audit Rule (FR-05):</span> Submitting this entry verifies student presence against the database unique constraint <code>(student_id, schedule_id, attendance_date)</code>. If an entry already exists, it updates the record with your audit stamp.
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecordAttendance(false);
                    setAttNotes('');
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAttendance || students.length === 0 || schedules.length === 0}
                  className="px-5 py-2 rounded-lg bg-emerald-700 text-white font-bold hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center space-x-1.5"
                >
                  {isSubmittingAttendance && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingAttendance ? 'Saving...' : 'Record Attendance'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Face Biometric Enrollment Modal */}
      {studentForBiometricEnroll && (
        <FaceEnrollmentModal
          student={studentForBiometricEnroll}
          isOpen={!!studentForBiometricEnroll}
          onClose={() => setStudentForBiometricEnroll(null)}
          onSuccess={(template) => {
            setStudentForBiometricEnroll(null);
            setFormStatus(
              `Facial biometric template enrolled successfully for ${template.studentName} (${template.rollNumber}).`
            );
            setTimeout(() => setFormStatus(null), 4000);
          }}
        />
      )}

      {/* Telephony IVR Test Console Modal */}
      {showIvrTester && activeTestAlert && (() => {
        const attRec = todayAttendance.find((r) => r.id === activeTestAlert.attendance_record_id);
        const st = students.find((s) => s.guardian_id === activeTestAlert.guardian_id || s.id === attRec?.student_id);
        const script = generateHindiAbsenceVoiceScript(st?.full_name || 'Resident', st?.roll_number || 'N/A', st?.hostel?.name);
        const creds = getTelephonyCredentials();

        return (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-200">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Hindi Voice IVR Telephony Console</h4>
                    <p className="text-xs text-slate-500">
                      Gateway Provider: <span className="font-semibold text-purple-700 uppercase">{creds.provider}</span> ({creds.configured ? 'Configured' : 'Standby Mode'})
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowIvrTester(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Resident & Guardian Target Info */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Target Resident</span>
                  <span className="font-bold text-slate-900">{st?.full_name || 'Resident'}</span>
                  <span className="text-slate-500 font-mono text-[11px] block">Roll: {st?.roll_number || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Guardian Phone</span>
                  <span className="font-bold font-mono text-purple-900">{st?.guardian?.phone_number || 'Registered on file'}</span>
                  <span className="text-slate-500 text-[11px] block">{st?.guardian?.full_name || 'Guardian'}</span>
                </div>
              </div>

              {/* Outbound Hindi Speech Script */}
              <div className="p-3.5 bg-purple-50/60 rounded-xl border border-purple-200 space-y-1.5 text-xs">
                <div className="flex items-center space-x-1.5 font-bold text-purple-900">
                  <Volume2 className="w-4 h-4 text-purple-600" />
                  <span>Outbound Voice Announcement (Hindi Audio Payload):</span>
                </div>
                <p className="text-purple-950 font-serif leading-relaxed text-[11px] bg-white p-2.5 rounded-lg border border-purple-100">
                  "{script.introPrompt}"
                </p>
              </div>

              {/* DTMF Keypad Branching */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-800 block">DTMF Keypad Input (Guardian Choice):</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label
                    className={`p-3 rounded-xl border cursor-pointer flex flex-col transition-all ${
                      ivrSimulatedDigit === '1'
                        ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="ivrDigit"
                        value="1"
                        checked={ivrSimulatedDigit === '1'}
                        onChange={(e) => setIvrSimulatedDigit(e.target.value)}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="font-black text-slate-900 text-sm">Digit 1: Acknowledge</span>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 pl-5">
                      Confirms absence notification. Ends call with formal Hindi courtesy.
                    </span>
                  </label>

                  <label
                    className={`p-3 rounded-xl border cursor-pointer flex flex-col transition-all ${
                      ivrSimulatedDigit === '2'
                        ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-300'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="ivrDigit"
                        value="2"
                        checked={ivrSimulatedDigit === '2'}
                        onChange={(e) => setIvrSimulatedDigit(e.target.value)}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-black text-slate-900 text-sm">Digit 2: Warden / AI Bridge</span>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 pl-5">
                      Connects guardian to hostel warden or AI voice assistant.
                    </span>
                  </label>
                </div>
              </div>

              {/* Response output */}
              {ivrActionResponse && (
                <div className="p-3 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono space-y-1">
                  <span className="text-ct-gold font-bold block text-[10px] uppercase">Telemetry / IVR Execution Result:</span>
                  <p className="whitespace-pre-line text-[11px] text-slate-200">{ivrActionResponse}</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIvrTester(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={handleProcessIvrTest}
                  disabled={ivrProcessing}
                  className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {ivrProcessing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{ivrProcessing ? 'Executing...' : `Simulate Pressing Key ${ivrSimulatedDigit}`}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
          await loadData();
        }}
      />
    </div>
  );
};
