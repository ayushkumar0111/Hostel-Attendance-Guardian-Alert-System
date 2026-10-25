// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Developed by CT | Built by Ayush Kumar
// Database Types conforming to Supabase Schema
// ==============================================================================

export type UserRole = 'student' | 'warden' | 'admin' | 'guardian';

export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'APPROVED_LEAVE'
  | 'PENDING_VERIFICATION'
  | 'LATE_SUBMISSION'
  | 'EXCUSED'
  | 'CORRECTED';

export type VerificationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'FLAGGED';

export type LeaveApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type NotificationChannel = 'sms' | 'voice';

export type NotificationStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED';

export type CallSessionStatus =
  | 'QUEUED'
  | 'RINGING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'BUSY'
  | 'NO_ANSWER';

export type RoomType = 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'DORMITORY';

export type RoomOccupancyStatus =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'MAINTENANCE'
  | 'RESERVED';

export type AllocationStatus =
  | 'ACTIVE'
  | 'VACATED'
  | 'TRANSFERRED'
  | 'CANCELLED';

export type CorrectionType =
  | 'MANUAL_OVERRIDE'
  | 'MEDICAL_EXCUSE'
  | 'SYSTEM_GLITCH'
  | 'LATE_VERIFIED'
  | 'OFFICIAL_DUTY';

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone_number?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Hostel {
  id: string;
  name: string;
  institution_name: string;
  campus_unit: string;
  warden_contact?: string | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  geofence_radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Guardian {
  id: string;
  full_name: string;
  relationship: string;
  phone_number: string;
  secondary_phone?: string | null;
  email?: string | null;
  profile_id?: string | null;
  phone_verified_at?: string | null;
  preferred_language: string;
  voice_consent?: boolean;
  sms_consent?: boolean;
  whatsapp_consent?: boolean;
  notification_consent_status: string;
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  student_code: string;
  roll_number: string;
  full_name: string;
  department: string;
  academic_year: string;
  hostel_id: string;
  room_number: string;
  profile_id?: string | null;
  guardian_id: string;
  secondary_contact?: string | null;
  enrollment_status: string;
  created_at: string;
  updated_at: string;
  // Joined relations
  hostel?: Hostel;
  hostels?: { name: string } | Hostel;
  guardian?: Guardian;
  guardians?: Guardian;
}

export interface AttendanceSchedule {
  id: string;
  name: string;
  hostel_id: string;
  start_time: string;
  deadline_time: string;
  grace_period_minutes: number;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  hostel?: Hostel;
}

export interface AttendanceRecord {
  id: string;
  student_id: string;
  schedule_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  submitted_at?: string | null;
  verification_status: VerificationStatus;
  reviewed_by?: string | null;
  review_reason?: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
  students?: Student;
  schedule?: AttendanceSchedule;
}

export interface VerificationSubmission {
  id: string;
  attendance_record_id: string;
  photo_storage_path?: string | null;
  device_latitude?: number | null;
  device_longitude?: number | null;
  location_accuracy_meters?: number | null;
  calculated_distance_meters?: number | null;
  client_capture_time?: string | null;
  server_received_at: string;
  review_status: string;
  reviewed_by?: string | null;
  review_notes?: string | null;
}

export interface LeaveRequest {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string;
  reason_category: string;
  reason_details?: string | null;
  approval_status: LeaveApprovalStatus;
  submitted_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
  students?: Student;
}

export interface NotificationEvent {
  id: string;
  attendance_record_id: string;
  guardian_id: string;
  channel: NotificationChannel;
  event_type: string;
  delivery_status: NotificationStatus;
  provider_reference?: string | null;
  attempts: number;
  last_attempt_at?: string | null;
  created_at: string;
}

export interface GuardianNotification {
  id: string;
  guardian_id: string;
  student_id: string;
  attendance_record_id?: string | null;
  attendance_date: string;
  title: string;
  message: string;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
  students?: Student;
  guardian?: Guardian;
  guardians?: Guardian;
  attendance_record?: AttendanceRecord;
}

export interface CallSession {
  id: string;
  guardian_id: string;
  attendance_record_id?: string | null;
  provider_reference?: string | null;
  call_status: CallSessionStatus;
  transfer_requested?: boolean;
  transfer_result?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_profile_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
  actor_profile?: Profile;
}

export interface HostelBlock {
  id: string;
  hostel_id: string;
  block_name: string;
  gender_designation: 'BOYS' | 'GIRLS' | 'COED';
  total_floors: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  hostel?: Hostel;
}

export interface WardenHostelAssignment {
  id: string;
  warden_profile_id: string;
  hostel_id: string;
  is_primary: boolean;
  assigned_by?: string | null;
  assigned_at: string;
  created_at: string;
  updated_at: string;
  warden_profile?: Profile;
  hostel?: Hostel;
}

export interface HostelRoom {
  id: string;
  hostel_id: string;
  block_id?: string | null;
  room_number: string;
  floor_number: number;
  room_type: RoomType;
  capacity: number;
  current_occupancy: number;
  occupancy_status: RoomOccupancyStatus;
  created_at: string;
  updated_at: string;
  hostel?: Hostel;
  block?: HostelBlock;
}

export interface RoomAllocation {
  id: string;
  student_id: string;
  room_id: string;
  bed_label?: string | null;
  allocation_date: string;
  vacation_date?: string | null;
  status: AllocationStatus;
  allocated_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
  room?: HostelRoom;
}

export interface AttendanceCorrection {
  id: string;
  attendance_record_id: string;
  previous_status: AttendanceStatus;
  new_status: AttendanceStatus;
  correction_type: CorrectionType;
  reason: string;
  corrected_by: string;
  created_at: string;
  attendance_record?: AttendanceRecord;
  corrected_by_profile?: Profile;
}

export type PushDeviceType = 'android' | 'desktop' | 'ios' | 'other';

export type PushNotificationType =
  | 'ATTENDANCE_REMINDER'
  | 'ATTENDANCE_VERIFIED'
  | 'LEAVE_STATUS'
  | 'ABSENCE_ALERT'
  | 'TEST_NOTIFICATION';

export type PushDeliveryStatus = 'SENT' | 'FAILED' | 'EXPIRED_SUBSCRIPTION';

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_type: PushDeviceType;
  user_agent?: string | null;
  attendance_reminders_enabled: boolean;
  attendance_status_updates_enabled: boolean;
  absence_alerts_enabled: boolean;
  is_active: boolean;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PushNotificationLog {
  id: string;
  user_id: string;
  subscription_id?: string | null;
  notification_type: PushNotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  event_reference?: string | null;
  delivery_status: PushDeliveryStatus;
  status_code?: number | null;
  error_message?: string | null;
  created_at: string;
}


