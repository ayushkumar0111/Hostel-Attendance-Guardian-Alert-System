-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261104000007_automatic_attendance_processing.sql
-- Finalization of Automatic Attendance Processing:
-- 1. Strict Biometric & Geofence Enforcement (Shahpur Campus 31.236872, 75.553745, 535m radius)
-- 2. Strict Synchronized Timing Gate (21:30 to 22:30 IST; rejects late submissions)
-- 3. Duplicate Attendance Prevention for Same Student & Date
-- 4. Idempotent Headless Absent Processing at 22:31 IST (10:31 PM IST)
-- 5. pg_cron Headless Automation and Batch Schedule Finalization
-- ==============================================================================

-- 1. HARDENED SERVER-SIDE ATTENDANCE RECORDING (RPC)
CREATE OR REPLACE FUNCTION public.verify_and_mark_attendance(
    p_student_id UUID,
    p_schedule_id UUID,
    p_device_lat NUMERIC,
    p_device_lng NUMERIC,
    p_accuracy NUMERIC,
    p_face_verified BOOLEAN,
    p_face_confidence NUMERIC DEFAULT 100,
    p_photo_path TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_student RECORD;
    v_hostel RECORD;
    v_schedule RECORD;
    v_ref_lat NUMERIC;
    v_ref_lng NUMERIC;
    v_radius NUMERIC;
    v_calc_distance NUMERIC;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
    v_ist_time TIME := (timezone('Asia/Kolkata', now()))::time;
    v_today DATE := (timezone('Asia/Kolkata', now()))::date;
    v_record_id UUID;
    v_max_accuracy NUMERIC := 100.0; -- Max allowable GPS inaccuracy in meters
    v_existing_status attendance_status;
BEGIN
    -- 1.1 Fetch Schedule Details
    SELECT * INTO v_schedule
    FROM public.attendance_schedules
    WHERE id = p_schedule_id AND is_active = true;

    IF v_schedule IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'SCHEDULE_NOT_FOUND',
            'message', 'Active attendance schedule window not found.'
        );
    END IF;

    -- 1.2 Time Window Gate: 09:30 PM (21:30) to 10:30 PM (22:30) IST
    -- Strict institutional curfew window enforcement on server time
    IF public.current_user_role() NOT IN ('admin', 'warden') THEN
        IF v_ist_time < v_schedule.start_time THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'WINDOW_NOT_OPEN',
                'message', format('Attendance check-in rejected: Roll-call window opens at %s IST. Current server time is %s IST.',
                    to_char(v_schedule.start_time, 'HH12:MI AM'),
                    to_char(v_ist_time, 'HH12:MI AM')
                )
            );
        ELSIF v_ist_time > v_schedule.deadline_time THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'WINDOW_EXPIRED',
                'message', format('Attendance check-in rejected: Roll-call deadline expired at %s IST. Late submissions are not accepted.',
                    to_char(v_schedule.deadline_time, 'HH12:MI AM')
                )
            );
        END IF;
    END IF;

    -- 1.3 Fetch Student Record
    SELECT s.*, h.reference_latitude, h.reference_longitude, h.geofence_radius_meters, h.name AS hostel_name
    INTO v_student
    FROM public.students s
    LEFT JOIN public.hostels h ON h.id = s.hostel_id
    WHERE s.id = p_student_id;

    IF v_student IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'STUDENT_NOT_FOUND',
            'message', 'Student record does not exist in roster.'
        );
    END IF;

    -- 1.4 Security: Authorization Gate (Resident themselves or authorized staff)
    IF auth.uid() IS NOT NULL THEN
        IF v_student.profile_id != auth.uid() AND public.current_user_role() NOT IN ('admin', 'warden') THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'UNAUTHORIZED',
                'message', 'You are not authorized to mark attendance for this student.'
            );
        END IF;
    END IF;

    -- 1.5 Duplicate Prevention: Check if already verified PRESENT today
    SELECT status INTO v_existing_status
    FROM public.attendance_records
    WHERE student_id = p_student_id
      AND schedule_id = p_schedule_id
      AND attendance_date = v_today;

    IF v_existing_status = 'PRESENT' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'ALREADY_RECORDED',
            'message', 'Attendance for tonight has already been verified and recorded as PRESENT. Duplicate records are prevented.'
        );
    END IF;

    -- 1.6 Biometric Gate: Face Biometric Must Be Successfully Confirmed
    IF p_face_verified IS NOT TRUE OR p_face_confidence IS NULL OR p_face_confidence < 50.0 THEN
        INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
        VALUES (
            auth.uid(),
            'ATTENDANCE_REJECTED_FACE_MISMATCH',
            'attendance_records',
            p_student_id,
            'Attendance rejected: Face biometric verification failed or confidence too low.',
            jsonb_build_object('student_id', p_student_id, 'face_confidence', p_face_confidence)
        );

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'FACE_VERIFICATION_FAILED',
            'message', 'Biometric identity verification failed. Live face does not match registered resident template.'
        );
    END IF;

    -- 1.7 GPS Accuracy Gate: Must be <= 100 meters
    IF p_accuracy IS NULL OR p_accuracy > v_max_accuracy THEN
        INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
        VALUES (
            auth.uid(),
            'ATTENDANCE_REJECTED_GPS_ACCURACY',
            'attendance_records',
            p_student_id,
            'Attendance rejected: GPS accuracy margin exceeds permitted threshold.',
            jsonb_build_object('accuracy', p_accuracy, 'max_allowed', v_max_accuracy)
        );

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'POOR_GPS_ACCURACY',
            'message', format('GPS accuracy margin (±%s m) exceeds maximum acceptable confidence of ±%s m. Please move near a window and retry.', p_accuracy, v_max_accuracy)
        );
    END IF;

    -- 1.8 Resolve Shahpur Campus Coordinates & Approved Radius
    -- Campus Center: 31.236872, 75.553745; Radius: 535m
    v_ref_lat := COALESCE(v_student.reference_latitude, 31.236872);
    v_ref_lng := COALESCE(v_student.reference_longitude, 75.553745);
    v_radius  := COALESCE(v_student.geofence_radius_meters, 535.0);

    -- 1.9 Server-Side Distance Calculation
    v_calc_distance := public.calculate_haversine_distance(p_device_lat, p_device_lng, v_ref_lat, v_ref_lng);

    IF v_calc_distance IS NULL OR v_calc_distance > v_radius THEN
        INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
        VALUES (
            auth.uid(),
            'ATTENDANCE_REJECTED_GEOFENCE_BREACH',
            'attendance_records',
            p_student_id,
            format('Student location %s m outside permitted %s m boundary.', v_calc_distance, v_radius),
            jsonb_build_object(
                'student_id', p_student_id,
                'distance_meters', v_calc_distance,
                'radius_meters', v_radius,
                'device_lat', p_device_lat,
                'device_lng', p_device_lng
            )
        );

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'OUTSIDE_GEOFENCE',
            'distance_meters', v_calc_distance,
            'allowed_radius_meters', v_radius,
            'message', format('Location rejected: You are %s m away from campus boundary (maximum allowed radius: %s m). Check-in is permitted only inside hostel premises.', v_calc_distance, v_radius)
        );
    END IF;

    -- 1.10 Insert or Update Attendance Record Idempotently
    INSERT INTO public.attendance_records (
        student_id,
        schedule_id,
        attendance_date,
        status,
        submitted_at,
        verification_status,
        review_reason
    )
    VALUES (
        p_student_id,
        p_schedule_id,
        v_today,
        'PRESENT',
        v_ist_now,
        'VERIFIED',
        format('VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: %s m, Accuracy: ±%s m, Face Conf: %s%%)', v_calc_distance, p_accuracy, p_face_confidence)
    )
    ON CONFLICT (student_id, schedule_id, attendance_date)
    DO UPDATE SET
        status = 'PRESENT',
        submitted_at = v_ist_now,
        verification_status = 'VERIFIED',
        review_reason = format('VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: %s m, Accuracy: ±%s m, Face Conf: %s%%)', v_calc_distance, p_accuracy, p_face_confidence),
        updated_at = v_ist_now
    RETURNING id INTO v_record_id;

    -- 1.11 Record Telemetry in verification_submissions
    INSERT INTO public.verification_submissions (
        attendance_record_id,
        photo_storage_path,
        device_latitude,
        device_longitude,
        location_accuracy_meters,
        calculated_distance_meters,
        client_capture_time,
        server_received_at,
        review_status,
        review_notes
    )
    VALUES (
        v_record_id,
        p_photo_path,
        p_device_lat,
        p_device_lng,
        p_accuracy,
        v_calc_distance,
        v_ist_now,
        v_ist_now,
        'VERIFIED',
        format('Verified: Face match %s%%, Geofence distance %s m <= %s m radius, GPS ±%s m', p_face_confidence, v_calc_distance, v_radius, p_accuracy)
    );

    -- 1.12 Audit Successful Attendance
    INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
    VALUES (
        auth.uid(),
        'ATTENDANCE_VERIFIED_SUCCESS',
        'attendance_records',
        v_record_id,
        format('Attendance confirmed for %s (%s) within %s m geofence.', v_student.full_name, v_student.roll_number, v_calc_distance),
        jsonb_build_object(
            'student_id', p_student_id,
            'attendance_record_id', v_record_id,
            'distance_meters', v_calc_distance,
            'accuracy_meters', p_accuracy,
            'face_confidence', p_face_confidence,
            'timestamp', v_ist_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'attendance_record_id', v_record_id,
        'distance_meters', v_calc_distance,
        'allowed_radius_meters', v_radius,
        'accuracy_meters', p_accuracy,
        'submitted_at', v_ist_now,
        'message', format('Attendance verified successfully! Confirmed inside campus geofence (%s m from center).', v_calc_distance)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. AUTOMATIC ABSENCE DETECTION & FINALIZATION (AT 10:31 PM IST)
-- Strictly preserves PRESENT, APPROVED_LEAVE, and EXCUSED records.
-- Finalizes unrecorded active residents as ABSENT.
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
    v_record_id UUID;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
    v_ist_time TIME := (timezone('Asia/Kolkata', now()))::time;
    v_today DATE := COALESCE(p_date, (timezone('Asia/Kolkata', now()))::date);
    v_finalization_time TIME;
BEGIN
    SELECT * INTO v_schedule FROM public.attendance_schedules WHERE id = p_schedule_id;
    IF v_schedule IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Attendance schedule not found.');
    END IF;

    -- Enforce 22:31 IST finalization cutoff (deadline + 1 min grace)
    v_finalization_time := v_schedule.deadline_time + INTERVAL '1 minute';
    IF v_today = (v_ist_now)::date AND v_ist_time < v_finalization_time AND p_force IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'is_window_closed', (v_ist_time >= v_schedule.deadline_time),
            'can_finalize', false,
            'message', format('Roll-call window closes at %s IST. Absence finalization begins at %s IST.',
                to_char(v_schedule.deadline_time, 'HH12:MI AM'),
                to_char(v_finalization_time, 'HH12:MI AM')
            )
        );
    END IF;

    -- Iterate active enrolled students in this schedule's hostel (or campus)
    FOR v_student IN
        SELECT s.*, g.id AS guardian_ref_id, g.full_name AS guardian_name
        FROM public.students s
        LEFT JOIN public.guardians g ON g.id = s.guardian_id
        WHERE (v_schedule.hostel_id IS NULL OR s.hostel_id = v_schedule.hostel_id)
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
                    review_reason = 'Automated roll-call finalization at 22:31 IST: Confirmed Absent.',
                    updated_at = v_ist_now
                WHERE public.attendance_records.status NOT IN ('PRESENT', 'APPROVED_LEAVE', 'EXCUSED')
                RETURNING id INTO v_record_id;

                IF v_record_id IS NOT NULL THEN
                    v_absent_count := v_absent_count + 1;

                    -- Idempotently create in-app notification in guardian_notifications
                    IF v_student.guardian_ref_id IS NOT NULL THEN
                        INSERT INTO public.guardian_notifications (
                            guardian_id, student_id, attendance_record_id, attendance_date, title, message, is_read
                        )
                        VALUES (
                            v_student.guardian_ref_id,
                            v_student.id,
                            v_record_id,
                            v_today,
                            'Hostel Absence Notice',
                            format('Aapka ward %s aaj %s ki hostel attendance roll-call (10:30 PM) mein absent mark hua hai. Kripya hostel warden se sampark karein.', v_student.full_name, v_today),
                            false
                        )
                        ON CONFLICT DO NOTHING;
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
        'message', format('Absence detection complete: %s students marked absent for schedule %s.', v_absent_count, v_schedule.name)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. BATCH RUNNER FOR ALL ACTIVE SCHEDULES
-- Processes every active attendance schedule across the campus
CREATE OR REPLACE FUNCTION public.process_all_active_schedules_absences(
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_sched RECORD;
    v_total_absent INTEGER := 0;
    v_sched_count INTEGER := 0;
    v_res JSONB;
BEGIN
    FOR v_sched IN
        SELECT id, name FROM public.attendance_schedules WHERE is_active = true
    LOOP
        v_res := public.detect_and_mark_absences(v_sched.id, NULL, p_force);
        IF (v_res->>'success')::boolean IS TRUE THEN
            v_total_absent := v_total_absent + COALESCE((v_res->>'absent_count')::int, 0);
            v_sched_count := v_sched_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'schedules_processed', v_sched_count,
        'total_newly_marked_absent', v_total_absent,
        'timestamp', timezone('Asia/Kolkata', now())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. HEADLESS AUTOMATION VIA PG_CRON
-- Schedules nightly finalization at 17:01 UTC (22:31 IST / 10:31 PM IST)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
        -- Daily at 17:01 UTC = 22:31 IST (10:31 PM IST)
        PERFORM cron.schedule(
            'finalize-nightly-absences-1031pm-ist',
            '1 17 * * *',
            'SELECT public.process_all_active_schedules_absences(false)'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- If pg_cron cannot be scheduled via user DDL in this project tier, edge function & client hooks handle execution
    NULL;
END $$;
