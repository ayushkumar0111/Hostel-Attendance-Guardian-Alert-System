-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261025000005_guardian_in_app_notifications.sql
-- FREE Guardian In-App Notification System, Guardian Role & Profile Linking,
-- RLS Security, and Automated Absent Notification Generation at 22:31 IST
-- ==============================================================================

-- 1. ADD 'guardian' TO USER ROLE ENUM SAFELY
DO $$ BEGIN
    ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'guardian';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. EXTEND GUARDIANS TABLE WITH PROFILE LINKING & CONTACT COLUMNS
ALTER TABLE public.guardians ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.guardians ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_guardians_profile_id ON public.guardians(profile_id);

-- 3. CREATE GUARDIAN IN-APP NOTIFICATIONS TABLE
-- Additive table with read status, timestamps, and duplicate prevention
CREATE TABLE IF NOT EXISTS public.guardian_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    title TEXT NOT NULL DEFAULT 'Hostel Absence Notice',
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_guardian_notification_student_date UNIQUE (guardian_id, student_id, attendance_date)
);

-- 4. PERFORMANCE & LOOKUP INDEXES
CREATE INDEX IF NOT EXISTS idx_guardian_notifications_guardian_id ON public.guardian_notifications(guardian_id);
CREATE INDEX IF NOT EXISTS idx_guardian_notifications_student_id ON public.guardian_notifications(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_notifications_is_read ON public.guardian_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_guardian_notifications_created_at ON public.guardian_notifications(created_at DESC);

-- 5. TRIGGER FOR UPDATED_AT
DROP TRIGGER IF EXISTS handle_updated_at_guardian_notifications ON public.guardian_notifications;
CREATE TRIGGER handle_updated_at_guardian_notifications
    BEFORE UPDATE ON public.guardian_notifications
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- 6. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.guardian_notifications ENABLE ROW LEVEL SECURITY;

-- 6.1 SELECT POLICY: Guardians can view ONLY their own notifications; Wardens & Admins see all
DROP POLICY IF EXISTS "Guardians can view own in-app notifications" ON public.guardian_notifications;
CREATE POLICY "Guardians can view own in-app notifications"
ON public.guardian_notifications FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.guardians g
        WHERE g.id = guardian_notifications.guardian_id
          AND g.profile_id = auth.uid()
    )
    OR public.current_user_role() IN ('admin', 'warden')
);

-- 6.2 UPDATE POLICY: Guardians can mark ONLY their own notifications as read
DROP POLICY IF EXISTS "Guardians can update own notification read status" ON public.guardian_notifications;
CREATE POLICY "Guardians can update own notification read status"
ON public.guardian_notifications FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.guardians g
        WHERE g.id = guardian_notifications.guardian_id
          AND g.profile_id = auth.uid()
    )
    OR public.current_user_role() IN ('admin', 'warden')
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.guardians g
        WHERE g.id = guardian_notifications.guardian_id
          AND g.profile_id = auth.uid()
    )
    OR public.current_user_role() IN ('admin', 'warden')
);

-- 6.3 INSERT POLICY: Staff and elevated system functions
DROP POLICY IF EXISTS "Staff and internal functions can insert notifications" ON public.guardian_notifications;
CREATE POLICY "Staff and internal functions can insert notifications"
ON public.guardian_notifications FOR INSERT
TO authenticated
WITH CHECK (
    public.current_user_role() IN ('admin', 'warden')
);

-- 7. EXTEND GUARDIANS & STUDENTS RLS FOR AUTHENTICATED GUARDIANS
-- Allow authenticated guardians to read their own guardian record
DROP POLICY IF EXISTS "Guardians can read own guardian record" ON public.guardians;
CREATE POLICY "Guardians can read own guardian record"
ON public.guardians FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
    OR public.current_user_role() IN ('admin', 'warden')
    OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.guardian_id = guardians.id AND s.profile_id = auth.uid()
    )
);

-- Allow authenticated guardians to view linked student record
DROP POLICY IF EXISTS "Guardians can view linked students" ON public.students;
CREATE POLICY "Guardians can view linked students"
ON public.students FOR SELECT
TO authenticated
USING (
    profile_id = auth.uid()
    OR public.current_user_role() IN ('admin', 'warden')
    OR EXISTS (
        SELECT 1 FROM public.guardians g
        WHERE g.id = students.guardian_id AND g.profile_id = auth.uid()
    )
);

-- Allow authenticated guardians to view linked student attendance records
DROP POLICY IF EXISTS "Guardians can view linked student attendance" ON public.attendance_records;
CREATE POLICY "Guardians can view linked student attendance"
ON public.attendance_records FOR SELECT
TO authenticated
USING (
    student_id IN (
        SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()
    )
    OR public.current_user_role() IN ('admin', 'warden')
    OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.guardians g ON g.id = s.guardian_id
        WHERE s.id = attendance_records.student_id AND g.profile_id = auth.uid()
    )
);

-- 8. EXTEND ABSENCE FINALIZATION WITH IN-APP NOTIFICATIONS (AT 22:31 IST)
-- Generates in-app notifications in Supabase for confirmed absent students
CREATE OR REPLACE FUNCTION public.detect_and_mark_absences(
    p_schedule_id UUID,
    p_date DATE DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_schedule RECORD;
    v_student RECORD;
    v_leave RECORD;
    v_absent_count INTEGER := 0;
    v_queued_calls INTEGER := 0;
    v_inapp_notifications INTEGER := 0;
    v_record_id UUID;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
    v_ist_time TIME := (timezone('Asia/Kolkata', now()))::time;
    v_today DATE := COALESCE(p_date, (timezone('Asia/Kolkata', now()))::date);
    v_finalization_time TIME;
    v_notice_msg TEXT;
BEGIN
    SELECT * INTO v_schedule FROM public.attendance_schedules WHERE id = p_schedule_id;
    IF v_schedule IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Attendance schedule not found.');
    END IF;

    -- Check if window has reached 22:31 finalization time in IST (deadline + 1 min)
    v_finalization_time := v_schedule.deadline_time + INTERVAL '1 minute';
    IF v_today = (v_ist_now)::date AND v_ist_time < v_finalization_time AND p_force IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'is_window_closed', (v_ist_time >= v_schedule.deadline_time),
            'can_finalize', false,
            'message', format('Roll-call window closes at %s IST. Absence finalization and guardian alerts start at %s IST.', v_schedule.deadline_time, v_finalization_time)
        );
    END IF;

    -- Iterate active enrolled students in this schedule's hostel
    FOR v_student IN
        SELECT s.*, g.id AS guardian_ref_id, g.phone_number AS guardian_phone, g.full_name AS guardian_name
        FROM public.students s
        LEFT JOIN public.guardians g ON g.id = s.guardian_id
        WHERE s.hostel_id = v_schedule.hostel_id
          AND s.enrollment_status = 'ACTIVE'
    LOOP
        -- Check if student already has a verified PRESENT, EXCUSED, or APPROVED_LEAVE record
        -- A SUCCESSFUL, VERIFIED ATTENDANCE RECORD MUST NEVER BE CHANGED TO ABSENT
        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            WHERE ar.student_id = v_student.id
              AND ar.schedule_id = p_schedule_id
              AND ar.attendance_date = v_today
              AND ar.status IN ('PRESENT', 'APPROVED_LEAVE', 'EXCUSED')
        ) THEN
            -- Check for active approved leave covering target date
            SELECT * INTO v_leave
            FROM public.leave_requests lr
            WHERE lr.student_id = v_student.id
              AND lr.approval_status = 'APPROVED'
              AND v_today >= lr.start_date
              AND v_today <= lr.end_date
            LIMIT 1;

            IF v_leave IS NOT NULL THEN
                -- Mark APPROVED_LEAVE idempotently
                INSERT INTO public.attendance_records (
                    student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                )
                VALUES (
                    v_student.id, p_schedule_id, v_today, 'APPROVED_LEAVE', v_ist_now, 'VERIFIED',
                    format('Sanctioned Leave: %s (%s to %s)', v_leave.reason_category, v_leave.start_date, v_leave.end_date)
                )
                ON CONFLICT (student_id, schedule_id, attendance_date) DO NOTHING;
            ELSE
                -- Mark ABSENT without ever overwriting a PRESENT record
                INSERT INTO public.attendance_records (
                    student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                )
                VALUES (
                    v_student.id, p_schedule_id, v_today, 'ABSENT', v_ist_now, 'VERIFIED',
                    'Automated roll-call finalization at 22:31 IST: Missed attendance window.'
                )
                ON CONFLICT (student_id, schedule_id, attendance_date)
                DO UPDATE SET
                    status = 'ABSENT',
                    review_reason = 'Automated roll-call finalization: Confirmed Absent.'
                WHERE public.attendance_records.status NOT IN ('PRESENT', 'APPROVED_LEAVE', 'EXCUSED')
                RETURNING id INTO v_record_id;

                IF v_record_id IS NOT NULL THEN
                    v_absent_count := v_absent_count + 1;

                    -- Idempotently create FREE Guardian In-App Notification
                    IF v_student.guardian_ref_id IS NOT NULL THEN
                        v_notice_msg := format(
                            'Namaste. Aapka ward %s aaj %s ki hostel attendance mein absent mark hua hai. Agar aapko iski jankari nahi hai ya aapko lagta hai ki attendance galat hai, toh kripya hostel warden se sampark karein.',
                            v_student.full_name,
                            to_char(v_today, 'DD Mon YYYY')
                        );

                        INSERT INTO public.guardian_notifications (
                            guardian_id,
                            student_id,
                            attendance_record_id,
                            attendance_date,
                            title,
                            message,
                            is_read
                        )
                        VALUES (
                            v_student.guardian_ref_id,
                            v_student.id,
                            v_record_id,
                            v_today,
                            'Hostel Absence Notice',
                            v_notice_msg,
                            FALSE
                        )
                        ON CONFLICT (guardian_id, student_id, attendance_date) DO NOTHING;

                        v_inapp_notifications := v_inapp_notifications + 1;

                        -- Also maintain voice call queue idempotently
                        IF NOT EXISTS (
                            SELECT 1 FROM public.call_sessions cs
                            WHERE cs.attendance_record_id = v_record_id
                        ) THEN
                            INSERT INTO public.notification_events (
                                attendance_record_id,
                                guardian_id,
                                channel,
                                event_type,
                                delivery_status,
                                attempts
                            )
                            VALUES (
                                v_record_id,
                                v_student.guardian_ref_id,
                                'voice',
                                'ABSENCE_CALL',
                                'QUEUED',
                                0
                            );

                            INSERT INTO public.call_sessions (
                                guardian_id,
                                attendance_record_id,
                                call_status,
                                transfer_requested,
                                attempts,
                                retry_count
                            )
                            VALUES (
                                v_student.guardian_ref_id,
                                v_record_id,
                                'QUEUED',
                                false,
                                0,
                                0
                            );

                            v_queued_calls := v_queued_calls + 1;
                        END IF;
                    END IF;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'schedule_name', v_schedule.name,
        'date', v_today,
        'absent_count', v_absent_count,
        'inapp_notifications', v_inapp_notifications,
        'queued_calls', v_queued_calls,
        'message', format('Absence detection complete: %s students marked absent. %s guardian in-app notification(s) created.', v_absent_count, v_inapp_notifications)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. HELPER RPCS FOR IN-APP NOTIFICATIONS
CREATE OR REPLACE FUNCTION public.mark_all_guardian_notifications_read(
    p_guardian_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_updated INTEGER := 0;
BEGIN
    UPDATE public.guardian_notifications
    SET is_read = TRUE,
        read_at = now()
    WHERE guardian_id = p_guardian_id
      AND is_read = FALSE;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated,
        'message', format('%s notification(s) marked as read.', v_updated)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. AUTH TRIGGER: ALLOW GUARDIAN REGISTRATION (PREVENT PRIVILEGE ESCALATION)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    assigned_name TEXT := 'New User';
    assigned_role public.user_role := 'student';
BEGIN
    IF NEW.raw_user_meta_data->>'full_name' IS NOT NULL AND trim(NEW.raw_user_meta_data->>'full_name') <> '' THEN
        assigned_name := trim(NEW.raw_user_meta_data->>'full_name');
    ELSIF NEW.email IS NOT NULL THEN
        assigned_name := split_part(NEW.email, '@', 1);
    END IF;

    -- Allow self-registration as 'guardian' if requested; otherwise default to 'student'.
    -- Privileged roles ('admin', 'warden') can NEVER be self-assigned.
    IF NEW.raw_user_meta_data->>'role' = 'guardian' THEN
        assigned_role := 'guardian'::public.user_role;
    ELSE
        assigned_role := 'student'::public.user_role;
    END IF;

    INSERT INTO public.profiles (id, full_name, role, is_active)
    VALUES (NEW.id, assigned_name, assigned_role, TRUE);

    -- Auto-link to guardian record if email matches an existing guardian on file
    IF assigned_role = 'guardian' AND NEW.email IS NOT NULL THEN
        UPDATE public.guardians
        SET profile_id = NEW.id
        WHERE email = NEW.email AND profile_id IS NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
