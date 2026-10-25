-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Developed by: CTIEMT | Built by: Ayush Kumar
-- Production Hardened Database Migration Schema
-- File: supabase/migrations/20261021000001_initial_ct_hostel_schema.sql
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CUSTOM ENUMS (Idempotent Definition)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'warden', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
        CREATE TYPE attendance_status AS ENUM (
            'PRESENT',
            'ABSENT',
            'APPROVED_LEAVE',
            'PENDING_VERIFICATION',
            'LATE_SUBMISSION',
            'EXCUSED',
            'CORRECTED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        CREATE TYPE verification_status AS ENUM (
            'NOT_REQUIRED',
            'PENDING',
            'VERIFIED',
            'FAILED',
            'FLAGGED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_approval_status') THEN
        CREATE TYPE leave_approval_status AS ENUM (
            'PENDING',
            'APPROVED',
            'REJECTED',
            'CANCELLED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
        CREATE TYPE notification_channel AS ENUM ('sms', 'voice');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_session_status') THEN
        CREATE TYPE call_session_status AS ENUM (
            'QUEUED',
            'RINGING',
            'IN_PROGRESS',
            'COMPLETED',
            'FAILED',
            'BUSY',
            'NO_ANSWER'
        );
    END IF;
END $$;

-- 3. UTILITY FUNCTIONS
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ==============================================================================
-- 4. TABLE DEFINITIONS (All 11 Core Entities)
-- ==============================================================================

-- 4.1 PROFILES (Linked directly to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    phone_number TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.2 HOSTELS (Campus accommodations under CT GROUP OF INSTITUTIONS)
CREATE TABLE IF NOT EXISTS public.hostels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    institution_name TEXT NOT NULL DEFAULT 'CT GROUP OF INSTITUTIONS',
    campus_unit TEXT NOT NULL DEFAULT 'CTIEMT',
    warden_contact TEXT,
    reference_latitude NUMERIC(10, 8),
    reference_longitude NUMERIC(11, 8),
    geofence_radius_meters INTEGER NOT NULL DEFAULT 150,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.3 GUARDIANS (Registered primary contacts for students)
CREATE TABLE IF NOT EXISTS public.guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    relationship TEXT NOT NULL, -- Father, Mother, Local Guardian
    phone_number TEXT NOT NULL,
    phone_verified_at TIMESTAMPTZ,
    preferred_language TEXT NOT NULL DEFAULT 'hi', -- 'hi' or 'en'
    notification_consent_status TEXT NOT NULL DEFAULT 'CONSENTED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.4 STUDENTS (Academic and residential roster)
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_code TEXT UNIQUE NOT NULL,
    roll_number TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    hostel_id UUID REFERENCES public.hostels(id) ON DELETE RESTRICT,
    room_number TEXT NOT NULL,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    guardian_id UUID REFERENCES public.guardians(id) ON DELETE RESTRICT,
    secondary_contact TEXT,
    enrollment_status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.5 ATTENDANCE SCHEDULES (Configurable check-in windows)
CREATE TABLE IF NOT EXISTS public.attendance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- e.g. "Morning Roll Call", "Night Curfew Check"
    hostel_id UUID REFERENCES public.hostels(id) ON DELETE CASCADE,
    start_time TIME NOT NULL,
    deadline_time TIME NOT NULL,
    grace_period_minutes INTEGER NOT NULL DEFAULT 15,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.6 ATTENDANCE RECORDS (Daily check-in logs)
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    schedule_id UUID NOT NULL REFERENCES public.attendance_schedules(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status attendance_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
    submitted_at TIMESTAMPTZ,
    verification_status verification_status NOT NULL DEFAULT 'NOT_REQUIRED',
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_student_schedule_date UNIQUE (student_id, schedule_id, attendance_date)
);

-- 4.7 VERIFICATION SUBMISSIONS (Evidence metadata for camera & location)
CREATE TABLE IF NOT EXISTS public.verification_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_record_id UUID NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    photo_storage_path TEXT,
    device_latitude NUMERIC(10, 8),
    device_longitude NUMERIC(11, 8),
    location_accuracy_meters NUMERIC(8, 2),
    calculated_distance_meters NUMERIC(10, 2),
    client_capture_time TIMESTAMPTZ,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    review_status TEXT NOT NULL DEFAULT 'PENDING',
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    review_notes TEXT
);

-- 4.8 LEAVE REQUESTS (Institutional student leave management)
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason_category TEXT NOT NULL, -- Medical, Home Visit, Academic, Emergency
    reason_details TEXT,
    approval_status leave_approval_status NOT NULL DEFAULT 'PENDING',
    submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.9 NOTIFICATION EVENTS (Outbound SMS & IVR queue logs)
CREATE TABLE IF NOT EXISTS public.notification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_record_id UUID NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE RESTRICT,
    channel notification_channel NOT NULL,
    event_type TEXT NOT NULL, -- ABSENCE_ALERT, REMINDER
    delivery_status notification_status NOT NULL DEFAULT 'QUEUED',
    provider_reference TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.10 CALL SESSIONS (Telephony session tracking & DTMF transfer records)
CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE RESTRICT,
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE SET NULL,
    provider_reference TEXT,
    call_status call_session_status NOT NULL DEFAULT 'QUEUED',
    transfer_requested BOOLEAN NOT NULL DEFAULT FALSE,
    transfer_result TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4.11 AUDIT LOGS (Append-only governance trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    reason TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 5. TRIGGERS FOR TIMESTAMP UPDATES
-- ==============================================================================
DROP TRIGGER IF EXISTS handle_updated_at_profiles ON public.profiles;
CREATE TRIGGER handle_updated_at_profiles
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_hostels ON public.hostels;
CREATE TRIGGER handle_updated_at_hostels
    BEFORE UPDATE ON public.hostels
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_guardians ON public.guardians;
CREATE TRIGGER handle_updated_at_guardians
    BEFORE UPDATE ON public.guardians
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_students ON public.students;
CREATE TRIGGER handle_updated_at_students
    BEFORE UPDATE ON public.students
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_schedules ON public.attendance_schedules;
CREATE TRIGGER handle_updated_at_schedules
    BEFORE UPDATE ON public.attendance_schedules
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_attendance_records ON public.attendance_records;
CREATE TRIGGER handle_updated_at_attendance_records
    BEFORE UPDATE ON public.attendance_records
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_leaves ON public.leave_requests;
CREATE TRIGGER handle_updated_at_leaves
    BEFORE UPDATE ON public.leave_requests
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ==============================================================================
-- 6. SECURITY HELPER FUNCTION (With immutable search_path)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ==============================================================================
-- 7. AUTOMATIC PROFILE PROVISIONING & PRIVILEGE LOCKDOWN TRIGGERS
-- ==============================================================================

-- 7.1 Strictly enroll all public self-registrations as 'student'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    assigned_name TEXT := 'New Student';
BEGIN
    IF NEW.raw_user_meta_data->>'full_name' IS NOT NULL AND trim(NEW.raw_user_meta_data->>'full_name') <> '' THEN
        assigned_name := trim(NEW.raw_user_meta_data->>'full_name');
    ELSIF NEW.email IS NOT NULL THEN
        assigned_name := split_part(NEW.email, '@', 1);
    END IF;

    -- Enforce 'student' role. Ignores any client-supplied metadata role.
    INSERT INTO public.profiles (id, full_name, role, is_active)
    VALUES (NEW.id, assigned_name, 'student'::user_role, TRUE);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7.2 Prevent privilege self-escalation or account status changes
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF auth.uid() IS NOT NULL AND public.current_user_role() <> 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: User role changes are restricted to authorized administrators.';
        END IF;
    END IF;

    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        IF auth.uid() IS NOT NULL AND public.current_user_role() <> 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: Account status changes are restricted to authorized administrators.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_profile_role_change ON public.profiles;
CREATE TRIGGER on_profile_role_change
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.protect_profile_role();

-- 7.3 RESTRICT FUNCTION EXECUTION PRIVILEGES (Prevents Unintended RPC Exposure)
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_profile_role() TO postgres, service_role;

-- ==============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES ON ALL 11 TABLES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 8.1 PROFILES POLICIES
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins full access on profiles" ON public.profiles;
CREATE POLICY "Admins full access on profiles"
    ON public.profiles FOR ALL
    USING (public.current_user_role() = 'admin');

-- 8.2 HOSTELS POLICIES
DROP POLICY IF EXISTS "Authenticated users can read hostels" ON public.hostels;
CREATE POLICY "Authenticated users can read hostels"
    ON public.hostels FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admins can manage hostels" ON public.hostels;
CREATE POLICY "Admins can manage hostels"
    ON public.hostels FOR ALL
    USING (public.current_user_role() = 'admin');

-- 8.3 STUDENTS POLICIES
DROP POLICY IF EXISTS "Students see own student record" ON public.students;
CREATE POLICY "Students see own student record"
    ON public.students FOR SELECT
    USING (profile_id = auth.uid() OR public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "Wardens and Admins manage students" ON public.students;
CREATE POLICY "Wardens and Admins manage students"
    ON public.students FOR ALL
    USING (public.current_user_role() IN ('admin', 'warden'));

-- 8.4 GUARDIANS POLICIES (No public or cross-student access)
DROP POLICY IF EXISTS "Wardens and Admins access guardians" ON public.guardians;
CREATE POLICY "Wardens and Admins access guardians"
    ON public.guardians FOR ALL
    USING (public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "Students can read their assigned guardian" ON public.guardians;
CREATE POLICY "Students can read their assigned guardian"
    ON public.guardians FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.guardian_id = guardians.id
              AND students.profile_id = auth.uid()
        )
    );

-- 8.5 ATTENDANCE SCHEDULES POLICIES
DROP POLICY IF EXISTS "Authenticated users can read schedules" ON public.attendance_schedules;
CREATE POLICY "Authenticated users can read schedules"
    ON public.attendance_schedules FOR SELECT
    TO authenticated
    USING (is_active = TRUE OR public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "Wardens and Admins can manage schedules" ON public.attendance_schedules;
CREATE POLICY "Wardens and Admins can manage schedules"
    ON public.attendance_schedules FOR ALL
    USING (public.current_user_role() IN ('admin', 'warden'));

-- 8.6 ATTENDANCE RECORDS POLICIES
DROP POLICY IF EXISTS "Students can read own attendance records" ON public.attendance_records;
CREATE POLICY "Students can read own attendance records"
    ON public.attendance_records FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = attendance_records.student_id
              AND students.profile_id = auth.uid()
        )
        OR public.current_user_role() IN ('admin', 'warden')
    );

DROP POLICY IF EXISTS "Students can submit attendance records" ON public.attendance_records;
CREATE POLICY "Students can submit attendance records"
    ON public.attendance_records FOR INSERT
    WITH CHECK (
        reviewed_by IS NULL
        AND EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = attendance_records.student_id
              AND students.profile_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Wardens and Admins can manage attendance records" ON public.attendance_records;
CREATE POLICY "Wardens and Admins can manage attendance records"
    ON public.attendance_records FOR ALL
    USING (public.current_user_role() IN ('admin', 'warden'));

-- 8.7 VERIFICATION SUBMISSIONS POLICIES (Photo & GPS Privacy)
DROP POLICY IF EXISTS "Students view own verification submissions" ON public.verification_submissions;
CREATE POLICY "Students view own verification submissions"
    ON public.verification_submissions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.attendance_records
            JOIN public.students ON students.id = attendance_records.student_id
            WHERE attendance_records.id = verification_submissions.attendance_record_id
              AND students.profile_id = auth.uid()
        )
        OR public.current_user_role() IN ('admin', 'warden')
    );

DROP POLICY IF EXISTS "Students submit own verification evidence" ON public.verification_submissions;
CREATE POLICY "Students submit own verification evidence"
    ON public.verification_submissions FOR INSERT
    WITH CHECK (
        reviewed_by IS NULL
        AND EXISTS (
            SELECT 1 FROM public.attendance_records
            JOIN public.students ON students.id = attendance_records.student_id
            WHERE attendance_records.id = verification_submissions.attendance_record_id
              AND students.profile_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Wardens and Admins manage verification submissions" ON public.verification_submissions;
CREATE POLICY "Wardens and Admins manage verification submissions"
    ON public.verification_submissions FOR ALL
    USING (public.current_user_role() IN ('admin', 'warden'));

-- 8.8 LEAVE REQUESTS POLICIES (Self-approval prevented)
DROP POLICY IF EXISTS "Students manage own leave requests" ON public.leave_requests;
CREATE POLICY "Students manage own leave requests"
    ON public.leave_requests FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = leave_requests.student_id
              AND students.profile_id = auth.uid()
        )
        OR public.current_user_role() IN ('admin', 'warden')
    );

DROP POLICY IF EXISTS "Students submit leave requests" ON public.leave_requests;
CREATE POLICY "Students submit leave requests"
    ON public.leave_requests FOR INSERT
    WITH CHECK (
        approval_status = 'PENDING'
        AND reviewed_by IS NULL
        AND EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = leave_requests.student_id
              AND students.profile_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Wardens and Admins review leave requests" ON public.leave_requests;
CREATE POLICY "Wardens and Admins review leave requests"
    ON public.leave_requests FOR UPDATE
    USING (public.current_user_role() IN ('admin', 'warden'));

-- 8.9 NOTIFICATION EVENTS POLICIES (Access restricted to staff)
DROP POLICY IF EXISTS "Wardens and Admins view notification events" ON public.notification_events;
CREATE POLICY "Wardens and Admins view notification events"
    ON public.notification_events FOR SELECT
    USING (public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "System and Admins manage notification events" ON public.notification_events;
CREATE POLICY "System and Admins manage notification events"
    ON public.notification_events FOR ALL
    USING (public.current_user_role() = 'admin');

-- 8.10 CALL SESSIONS POLICIES (Access restricted to staff)
DROP POLICY IF EXISTS "Wardens and Admins view call sessions" ON public.call_sessions;
CREATE POLICY "Wardens and Admins view call sessions"
    ON public.call_sessions FOR SELECT
    USING (public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "System and Admins manage call sessions" ON public.call_sessions;
CREATE POLICY "System and Admins manage call sessions"
    ON public.call_sessions FOR ALL
    USING (public.current_user_role() = 'admin');

-- 8.11 AUDIT LOGS POLICIES (Immutable append-only ledger)
DROP POLICY IF EXISTS "Admins and Wardens can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins and Wardens can view audit logs"
    ON public.audit_logs FOR SELECT
    USING (public.current_user_role() IN ('admin', 'warden'));

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit logs"
    ON public.audit_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- ==============================================================================
-- 9. EXTENDED CUSTOM ENUMS (Residential Infrastructure & Operations)
-- ==============================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_type') THEN
        CREATE TYPE room_type AS ENUM ('SINGLE', 'DOUBLE', 'TRIPLE', 'DORMITORY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_occupancy_status') THEN
        CREATE TYPE room_occupancy_status AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'RESERVED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allocation_status') THEN
        CREATE TYPE allocation_status AS ENUM ('ACTIVE', 'VACATED', 'TRANSFERRED', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correction_type') THEN
        CREATE TYPE correction_type AS ENUM (
            'MANUAL_OVERRIDE',
            'MEDICAL_EXCUSE',
            'SYSTEM_GLITCH',
            'LATE_VERIFIED',
            'OFFICIAL_DUTY'
        );
    END IF;
END $$;

-- ==============================================================================
-- 10. EXTENDED TABLE DEFINITIONS (Residential Blocks, Rooms, Allocations & Corrections)
-- ==============================================================================

-- 10.1 HOSTEL BLOCKS (Wings / Sections within Campus Accommodations)
CREATE TABLE IF NOT EXISTS public.hostel_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id UUID NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
    block_name TEXT NOT NULL,
    gender_designation TEXT NOT NULL DEFAULT 'COED' CHECK (gender_designation IN ('BOYS', 'GIRLS', 'COED')),
    total_floors INTEGER NOT NULL DEFAULT 1 CHECK (total_floors >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_hostel_block_name UNIQUE (hostel_id, block_name)
);

-- 10.2 WARDEN HOSTEL ASSIGNMENTS (Authoritative Scope Mapping per FR-02 & Institutional Governance)
CREATE TABLE IF NOT EXISTS public.warden_hostel_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warden_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    hostel_id UUID NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_warden_hostel_assignment UNIQUE (warden_profile_id, hostel_id)
);

-- 10.3 HOSTEL ROOMS (Physical Room Inventory with Live Occupancy Counts)
CREATE TABLE IF NOT EXISTS public.hostel_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id UUID NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
    block_id UUID REFERENCES public.hostel_blocks(id) ON DELETE SET NULL,
    room_number TEXT NOT NULL,
    floor_number INTEGER NOT NULL DEFAULT 1 CHECK (floor_number >= 0),
    room_type room_type NOT NULL DEFAULT 'DOUBLE',
    capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
    current_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0 AND current_occupancy <= capacity),
    occupancy_status room_occupancy_status NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_hostel_room_number UNIQUE (hostel_id, room_number)
);

-- 10.4 ROOM ALLOCATIONS (Formal Student Bed Assignments and Tenancy Records)
CREATE TABLE IF NOT EXISTS public.room_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.hostel_rooms(id) ON DELETE RESTRICT,
    bed_label TEXT,
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vacation_date DATE,
    status allocation_status NOT NULL DEFAULT 'ACTIVE',
    allocated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT check_allocation_dates CHECK (vacation_date IS NULL OR vacation_date >= allocation_date)
);

-- 10.5 ATTENDANCE CORRECTIONS (Dedicated Immutable Audit Log for Manual Overrides per FR-05)
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_record_id UUID NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    previous_status attendance_status NOT NULL,
    new_status attendance_status NOT NULL,
    correction_type correction_type NOT NULL DEFAULT 'MANUAL_OVERRIDE',
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    corrected_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 11. TRIGGERS FOR EXTENDED TABLE TIMESTAMPS
-- ==============================================================================
DROP TRIGGER IF EXISTS handle_updated_at_blocks ON public.hostel_blocks;
CREATE TRIGGER handle_updated_at_blocks
    BEFORE UPDATE ON public.hostel_blocks
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_warden_assignments ON public.warden_hostel_assignments;
CREATE TRIGGER handle_updated_at_warden_assignments
    BEFORE UPDATE ON public.warden_hostel_assignments
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_rooms ON public.hostel_rooms;
CREATE TRIGGER handle_updated_at_rooms
    BEFORE UPDATE ON public.hostel_rooms
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_allocations ON public.room_allocations;
CREATE TRIGGER handle_updated_at_allocations
    BEFORE UPDATE ON public.room_allocations
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ==============================================================================
-- 12. WARDEN HOSTEL ACCESS SCOPE HELPER FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.can_warden_access_hostel(target_hostel_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Institutional administrators have global access across all hostels
    IF public.current_user_role() = 'admin' THEN
        RETURN TRUE;
    END IF;

    -- Wardens are restricted to their explicitly assigned hostels
    IF public.current_user_role() = 'warden' THEN
        IF EXISTS (SELECT 1 FROM public.warden_hostel_assignments WHERE warden_profile_id = auth.uid()) THEN
            RETURN EXISTS (
                SELECT 1 
                FROM public.warden_hostel_assignments 
                WHERE warden_profile_id = auth.uid() 
                  AND hostel_id = target_hostel_id
            );
        ELSE
            -- Graceful fallback during initial bootstrap if assignments are not yet seeded
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.can_warden_access_hostel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_warden_access_hostel(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 13. AUTOMATED BUSINESS LOGIC TRIGGERS
-- ==============================================================================

-- 13.1 Attendance Correction Automated Audit Trail Trigger
CREATE OR REPLACE FUNCTION public.log_attendance_correction()
RETURNS TRIGGER AS $$
BEGIN
    -- When attendance status changes, insert an audit trail entry
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.attendance_corrections (
            attendance_record_id,
            previous_status,
            new_status,
            correction_type,
            reason,
            corrected_by
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            'MANUAL_OVERRIDE',
            COALESCE(NEW.review_reason, 'Status updated via authorized portal action'),
            COALESCE(auth.uid(), NEW.reviewed_by, OLD.reviewed_by)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.log_attendance_correction() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_attendance_correction() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_log_attendance_correction ON public.attendance_records;
CREATE TRIGGER trg_log_attendance_correction
    AFTER UPDATE ON public.attendance_records
    FOR EACH ROW EXECUTE PROCEDURE public.log_attendance_correction();

-- 13.2 Hostel Room Occupancy Synchronization Trigger
CREATE OR REPLACE FUNCTION public.sync_room_occupancy()
RETURNS TRIGGER AS $$
DECLARE
    target_room_id UUID;
    active_count INTEGER;
    room_cap INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_room_id := OLD.room_id;
    ELSE
        target_room_id := NEW.room_id;
    END IF;

    -- Count active resident allocations for this room
    SELECT COUNT(*) INTO active_count
    FROM public.room_allocations
    WHERE room_id = target_room_id AND status = 'ACTIVE';

    SELECT capacity INTO room_cap
    FROM public.hostel_rooms
    WHERE id = target_room_id;

    IF room_cap IS NOT NULL THEN
        UPDATE public.hostel_rooms
        SET current_occupancy = active_count,
            occupancy_status = CASE 
                WHEN active_count >= room_cap THEN 'OCCUPIED'::room_occupancy_status
                ELSE 'AVAILABLE'::room_occupancy_status
            END
        WHERE id = target_room_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.sync_room_occupancy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_room_occupancy() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_sync_room_occupancy ON public.room_allocations;
CREATE TRIGGER trg_sync_room_occupancy
    AFTER INSERT OR UPDATE OR DELETE ON public.room_allocations
    FOR EACH ROW EXECUTE PROCEDURE public.sync_room_occupancy();

-- ==============================================================================
-- 14. OPTIMIZED PERFORMANCE INDEXES (High-Speed Queries & Institutional Scale)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON public.students(profile_id);
CREATE INDEX IF NOT EXISTS idx_students_hostel_id ON public.students(hostel_id);
CREATE INDEX IF NOT EXISTS idx_students_guardian_id ON public.students(guardian_id);
CREATE INDEX IF NOT EXISTS idx_students_roll_number ON public.students(roll_number);
CREATE INDEX IF NOT EXISTS idx_students_student_code ON public.students(student_code);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date ON public.attendance_records(student_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_schedule_date ON public.attendance_records(schedule_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date_status ON public.attendance_records(attendance_date, status);

CREATE INDEX IF NOT EXISTS idx_leave_requests_student_dates ON public.leave_requests(student_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_approval_status ON public.leave_requests(approval_status);

CREATE INDEX IF NOT EXISTS idx_verification_submissions_record ON public.verification_submissions(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_record ON public.notification_events(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_status ON public.notification_events(delivery_status);

CREATE INDEX IF NOT EXISTS idx_hostel_blocks_hostel ON public.hostel_blocks(hostel_id);
CREATE INDEX IF NOT EXISTS idx_hostel_rooms_hostel ON public.hostel_rooms(hostel_id);
CREATE INDEX IF NOT EXISTS idx_hostel_rooms_block ON public.hostel_rooms(block_id);
CREATE INDEX IF NOT EXISTS idx_room_allocations_student ON public.room_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_room_allocations_room ON public.room_allocations(room_id);
CREATE INDEX IF NOT EXISTS idx_room_allocations_status ON public.room_allocations(status);

CREATE INDEX IF NOT EXISTS idx_warden_assignments_warden ON public.warden_hostel_assignments(warden_profile_id);
CREATE INDEX IF NOT EXISTS idx_warden_assignments_hostel ON public.warden_hostel_assignments(hostel_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_record ON public.attendance_corrections(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- ==============================================================================
-- 15. ROW LEVEL SECURITY (RLS) POLICIES FOR EXTENDED TABLES
-- ==============================================================================
ALTER TABLE public.hostel_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warden_hostel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;

-- 15.1 HOSTEL BLOCKS POLICIES
DROP POLICY IF EXISTS "Authenticated users view hostel blocks" ON public.hostel_blocks;
CREATE POLICY "Authenticated users view hostel blocks"
    ON public.hostel_blocks FOR SELECT
    TO authenticated
    USING (is_active = TRUE OR public.can_warden_access_hostel(hostel_id));

DROP POLICY IF EXISTS "Admins and assigned wardens manage blocks" ON public.hostel_blocks;
CREATE POLICY "Admins and assigned wardens manage blocks"
    ON public.hostel_blocks FOR ALL
    USING (public.can_warden_access_hostel(hostel_id));

-- 15.2 WARDEN HOSTEL ASSIGNMENTS POLICIES
DROP POLICY IF EXISTS "Wardens view own assignments and admins view all" ON public.warden_hostel_assignments;
CREATE POLICY "Wardens view own assignments and admins view all"
    ON public.warden_hostel_assignments FOR SELECT
    USING (warden_profile_id = auth.uid() OR public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Only Admins manage warden assignments" ON public.warden_hostel_assignments;
CREATE POLICY "Only Admins manage warden assignments"
    ON public.warden_hostel_assignments FOR ALL
    USING (public.current_user_role() = 'admin');

-- 15.3 HOSTEL ROOMS POLICIES
DROP POLICY IF EXISTS "Authenticated users view hostel rooms" ON public.hostel_rooms;
CREATE POLICY "Authenticated users view hostel rooms"
    ON public.hostel_rooms FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Admins and assigned wardens manage rooms" ON public.hostel_rooms;
CREATE POLICY "Admins and assigned wardens manage rooms"
    ON public.hostel_rooms FOR ALL
    USING (public.can_warden_access_hostel(hostel_id));

-- 15.4 ROOM ALLOCATIONS POLICIES (Student Privacy Protected)
DROP POLICY IF EXISTS "Students view own allocation and staff view scoped" ON public.room_allocations;
CREATE POLICY "Students view own allocation and staff view scoped"
    ON public.room_allocations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = room_allocations.student_id
              AND students.profile_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.hostel_rooms
            WHERE hostel_rooms.id = room_allocations.room_id
              AND public.can_warden_access_hostel(hostel_rooms.hostel_id)
        )
    );

DROP POLICY IF EXISTS "Admins and assigned wardens manage allocations" ON public.room_allocations;
CREATE POLICY "Admins and assigned wardens manage allocations"
    ON public.room_allocations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.hostel_rooms
            WHERE hostel_rooms.id = room_allocations.room_id
              AND public.can_warden_access_hostel(hostel_rooms.hostel_id)
        )
    );

-- 15.5 ATTENDANCE CORRECTIONS POLICIES (Append-only Audit Compliance)
DROP POLICY IF EXISTS "Students view own corrections and staff view scoped" ON public.attendance_corrections;
CREATE POLICY "Students view own corrections and staff view scoped"
    ON public.attendance_corrections FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.attendance_records
            JOIN public.students ON students.id = attendance_records.student_id
            WHERE attendance_records.id = attendance_corrections.attendance_record_id
              AND students.profile_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.attendance_records
            JOIN public.students ON students.id = attendance_records.student_id
            WHERE attendance_records.id = attendance_corrections.attendance_record_id
              AND public.can_warden_access_hostel(students.hostel_id)
        )
    );

DROP POLICY IF EXISTS "Admins and assigned wardens insert corrections" ON public.attendance_corrections;
CREATE POLICY "Admins and assigned wardens insert corrections"
    ON public.attendance_corrections FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.attendance_records
            JOIN public.students ON students.id = attendance_records.student_id
            WHERE attendance_records.id = attendance_corrections.attendance_record_id
              AND public.can_warden_access_hostel(students.hostel_id)
        )
    );

-- ==============================================================================
-- 16. REFINED WARDEN-SCOPED POLICIES ON EXISTING TABLES (Hostel-Level Scoping)
-- ==============================================================================

-- 16.1 Students Roster Scoped by Assigned Hostel
DROP POLICY IF EXISTS "Wardens and Admins manage students" ON public.students;
CREATE POLICY "Wardens and Admins manage students"
    ON public.students FOR ALL
    USING (public.can_warden_access_hostel(hostel_id));

-- 16.2 Guardians Access Scoped to Assigned Hostel Residents
DROP POLICY IF EXISTS "Wardens and Admins access guardians" ON public.guardians;
CREATE POLICY "Wardens and Admins access guardians"
    ON public.guardians FOR ALL
    USING (
        public.current_user_role() = 'admin'
        OR (
            public.current_user_role() = 'warden'
            AND EXISTS (
                SELECT 1 FROM public.students
                WHERE students.guardian_id = guardians.id
                  AND public.can_warden_access_hostel(students.hostel_id)
            )
        )
    );

-- 16.3 Attendance Records Scoped to Assigned Hostel
DROP POLICY IF EXISTS "Wardens and Admins can manage attendance records" ON public.attendance_records;
CREATE POLICY "Wardens and Admins can manage attendance records"
    ON public.attendance_records FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = attendance_records.student_id
              AND public.can_warden_access_hostel(students.hostel_id)
        )
    );

-- 16.4 Leave Requests Scoped to Assigned Hostel
DROP POLICY IF EXISTS "Wardens and Admins review leave requests" ON public.leave_requests;
CREATE POLICY "Wardens and Admins review leave requests"
    ON public.leave_requests FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.students
            WHERE students.id = leave_requests.student_id
              AND public.can_warden_access_hostel(students.hostel_id)
        )
    );

-- ==============================================================================
-- 17. INITIAL ADMINISTRATOR BOOTSTRAPPING QUERY REFERENCE
-- ==============================================================================
-- To bootstrap the first institutional administrator, register your account at
-- http://localhost:5173, then run the following query once in the SQL editor:
--
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@ctgroup.in');
-- ==============================================================================
