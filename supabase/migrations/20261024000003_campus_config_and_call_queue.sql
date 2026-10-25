-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261024000003_campus_config_and_call_queue.sql
-- Campus Geofence Pin (31.236872, 75.553745), 535m Radius, 21:30-22:30 Schedule,
-- 22:31 Absence Finalization, and Sequential Idempotent Guardian Call Queue
-- ==============================================================================

-- 1. EXTEND CALL SESSIONS TELEMETRY COLUMNS
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS dtmf_input TEXT;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS guardian_response TEXT;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- 2. ENSURE STRICT IDEMPOTENCY: ONE CALL SESSION PER ATTENDANCE RECORD (DATE + STUDENT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_sessions_attendance_record_unique
ON public.call_sessions(attendance_record_id)
WHERE attendance_record_id IS NOT NULL;

-- 3. UPDATE HAVERSINE IMMUTABLE DISTANCE CALCULATION
CREATE OR REPLACE FUNCTION public.calculate_haversine_distance(
    lat1 NUMERIC,
    lon1 NUMERIC,
    lat2 NUMERIC,
    lon2 NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
    r CONSTANT NUMERIC := 6371000.0; -- Mean Earth radius in meters
    dlat NUMERIC;
    dlon NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;

    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);

    a := sin(dlat / 2.0)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2.0)^2;
    c := 2.0 * atan2(sqrt(a), sqrt(1.0 - a));

    RETURN round(r * c, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. SERVER-SIDE VERIFY AND MARK ATTENDANCE (WITH 31.236872, 75.553745 AND 535m RADIUS)
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
    v_today DATE := (timezone('Asia/Kolkata', now()))::date;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
    v_record_id UUID;
    v_max_accuracy NUMERIC := 100.0; -- Max allowable GPS inaccuracy in meters
BEGIN
    -- 4.1 Fetch Student Record
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

    -- 4.2 Security: Enforce authorization (own record or staff)
    IF auth.uid() IS NOT NULL THEN
        IF v_student.profile_id != auth.uid() AND public.current_user_role() NOT IN ('admin', 'warden') THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'UNAUTHORIZED',
                'message', 'You are not authorized to mark attendance for this student.'
            );
        END IF;
    END IF;

    -- 4.3 Biometric Gate: Face must be verified
    IF p_face_verified IS NOT TRUE THEN
        INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
        VALUES (
            auth.uid(),
            'ATTENDANCE_REJECTED_FACE_MISMATCH',
            'attendance_records',
            p_student_id,
            'Attendance rejected: Face biometric verification failed.',
            jsonb_build_object('student_id', p_student_id, 'face_confidence', p_face_confidence)
        );

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'FACE_VERIFICATION_FAILED',
            'message', 'Biometric identity verification failed. Face does not match registered resident template.'
        );
    END IF;

    -- 4.4 GPS Accuracy Gate: Must be within allowable threshold (<= 100m)
    IF p_accuracy IS NULL OR p_accuracy > v_max_accuracy THEN
        INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, details)
        VALUES (
            auth.uid(),
            'ATTENDANCE_REJECTED_GPS_ACCURACY',
            'attendance_records',
            p_student_id,
            'Attendance rejected: GPS accuracy margin too wide.',
            jsonb_build_object('accuracy', p_accuracy, 'max_allowed', v_max_accuracy)
        );

        RETURN jsonb_build_object(
            'success', false,
            'reason', 'POOR_GPS_ACCURACY',
            'message', format('GPS accuracy margin (±%s m) exceeds maximum acceptable confidence of ±%s m.', p_accuracy, v_max_accuracy)
        );
    END IF;

    -- 4.5 Resolve Campus Geofence Center (Campus Pin: 31.236872, 75.553745; Extent: 435m + 100m margin = 535m)
    v_ref_lat := COALESCE(v_student.reference_latitude, 31.236872);
    v_ref_lng := COALESCE(v_student.reference_longitude, 75.553745);
    v_radius  := COALESCE(v_student.geofence_radius_meters, 535.0);

    -- 4.6 Server-Side Distance Calculation
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
            'message', format('Location rejected: You are %s m away from campus geofence (maximum allowed radius: %s m).', v_calc_distance, v_radius)
        );
    END IF;

    -- 4.7 Insert or Re-verify Attendance Record Idempotently
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
        review_reason = format('RE-VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: %s m, Accuracy: ±%s m)', v_calc_distance, p_accuracy),
        updated_at = v_ist_now
    RETURNING id INTO v_record_id;

    -- 4.8 Record Telemetry
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
        format('Verified: Face match %s%%, Geofence distance %s m <= %s m radius', p_face_confidence, v_calc_distance, v_radius)
    );

    RETURN jsonb_build_object(
        'success', true,
        'attendance_record_id', v_record_id,
        'distance_meters', v_calc_distance,
        'allowed_radius_meters', v_radius,
        'message', format('Attendance verified successfully! You are %s m from campus center (Allowed: %s m).', v_calc_distance, v_radius)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. SERVER-SIDE ABSENCE FINALIZATION & SEQUENTIAL CALL QUEUEING
-- Finalizes unrecorded students at 22:31 IST.
-- STRICT REQUIREMENT: Never changes a verified PRESENT or APPROVED_LEAVE record to ABSENT.
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
    v_record_id UUID;
    v_notification_id UUID;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
    v_ist_time TIME := (timezone('Asia/Kolkata', now()))::time;
    v_today DATE := COALESCE(p_date, (timezone('Asia/Kolkata', now()))::date);
    v_finalization_time TIME;
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
            'message', format('Roll-call window closes at %s IST. Absence finalization and guardian call queue start at %s IST.', v_schedule.deadline_time, v_finalization_time)
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

                    -- Idempotently queue automated guardian voice notification call
                    -- Prevent duplicate calls for the same student and attendance date
                    IF v_student.guardian_ref_id IS NOT NULL THEN
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
        'queued_calls', v_queued_calls,
        'message', format('Absence detection complete: %s students marked absent, %s guardian call(s) queued sequentially.', v_absent_count, v_queued_calls)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. FETCH NEXT QUEUED CALL SESSION (FOR SEQUENTIAL PROCESSING)
CREATE OR REPLACE FUNCTION public.fetch_next_queued_call_session()
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
    v_student RECORD;
    v_guardian RECORD;
    v_hostel RECORD;
    v_warden RECORD;
BEGIN
    -- Select the oldest pending call session (QUEUED or retrying)
    SELECT cs.*
    INTO v_session
    FROM public.call_sessions cs
    WHERE cs.call_status = 'QUEUED'
       OR (cs.call_status = 'RETRYING' AND (cs.next_retry_at IS NULL OR cs.next_retry_at <= now()))
    ORDER BY cs.created_at ASC
    LIMIT 1;

    IF v_session IS NULL THEN
        RETURN jsonb_build_object('has_session', false);
    END IF;

    -- Fetch associated student, guardian, hostel, and warden contact
    SELECT ar.student_id INTO v_student
    FROM public.attendance_records ar
    WHERE ar.id = v_session.attendance_record_id;

    SELECT s.full_name, s.roll_number, s.hostel_id, g.full_name AS guardian_name, g.phone_number AS guardian_phone, h.name AS hostel_name, h.warden_contact
    INTO v_student
    FROM public.students s
    JOIN public.guardians g ON g.id = s.guardian_id
    LEFT JOIN public.hostels h ON h.id = s.hostel_id
    WHERE s.id = v_student.student_id;

    RETURN jsonb_build_object(
        'has_session', true,
        'session_id', v_session.id,
        'attendance_record_id', v_session.attendance_record_id,
        'guardian_id', v_session.guardian_id,
        'guardian_name', v_student.guardian_name,
        'guardian_phone', v_student.guardian_phone,
        'student_name', v_student.full_name,
        'roll_number', v_student.roll_number,
        'hostel_name', v_student.hostel_name,
        'warden_contact', v_student.warden_contact,
        'attempts', v_session.attempts,
        'retry_count', v_session.retry_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. UPDATE CALL SESSION STATUS (CALLED BY WORKER)
CREATE OR REPLACE FUNCTION public.update_call_session_progress(
    p_session_id UUID,
    p_status TEXT,
    p_guardian_response TEXT DEFAULT NULL,
    p_transfer_requested BOOLEAN DEFAULT FALSE,
    p_transfer_result TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_retry_in_minutes INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_next_retry TIMESTAMPTZ := NULL;
    v_retry_count INTEGER;
BEGIN
    IF p_retry_in_minutes IS NOT NULL AND p_retry_in_minutes > 0 THEN
        v_next_retry := now() + (p_retry_in_minutes || ' minutes')::interval;
    END IF;

    UPDATE public.call_sessions
    SET call_status = p_status::call_session_status,
        guardian_response = COALESCE(p_guardian_response, guardian_response),
        transfer_requested = p_transfer_requested,
        transfer_result = COALESCE(p_transfer_result, transfer_result),
        error_message = p_error_message,
        last_attempt_at = now(),
        attempts = attempts + 1,
        next_retry_at = v_next_retry,
        ended_at = CASE WHEN p_status IN ('COMPLETED', 'FAILED') THEN now() ELSE ended_at END
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'session_id', p_session_id, 'status', p_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. TELEPHONY IVR DTMF RESPONSE HANDLER (WITH EXACT HINDI SCRIPT)
CREATE OR REPLACE FUNCTION public.handle_call_session_ivr(
    p_session_id UUID,
    p_digit_pressed TEXT,
    p_warden_phone TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
BEGIN
    SELECT * INTO v_session FROM public.call_sessions WHERE id = p_session_id;
    IF v_session IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Call session not found.');
    END IF;

    IF p_digit_pressed = '1' THEN
        -- Digit 1: Guardian Acknowledged Absence
        UPDATE public.call_sessions
        SET call_status = 'COMPLETED',
            dtmf_input = '1',
            guardian_response = 'ACKNOWLEDGED',
            transfer_requested = false,
            transfer_result = 'ACKNOWLEDGED_BY_GUARDIAN',
            ended_at = now()
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'HANGUP',
            'prompt_hi', 'Aapki pushti darj kar li gayi hai. Dhanyawad.',
            'message', 'Guardian acknowledged absence. Ending call politely.'
        );

    ELSIF p_digit_pressed = '2' THEN
        -- Digit 2: Guardian Requested Connection to Warden or AI Assistant
        UPDATE public.call_sessions
        SET call_status = 'IN_PROGRESS',
            dtmf_input = '2',
            guardian_response = 'ASSISTANCE_REQUESTED',
            transfer_requested = true,
            transfer_result = CASE
                WHEN p_warden_phone IS NOT NULL THEN 'CONNECTING_TO_WARDEN: ' || p_warden_phone
                ELSE 'CONNECTING_TO_AI_ASSISTANT'
            END
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'TRANSFER',
            'transfer_to', COALESCE(p_warden_phone, 'AI_VOICE_ASSISTANT'),
            'prompt_hi', 'Kripya pratiksha karein, aapki call hostel warden ya assistant se jodi ja rahi hai.',
            'message', 'Guardian requested assistance. Bridging call to warden or AI assistant.'
        );

    ELSE
        -- Invalid Input Pressed
        RETURN jsonb_build_object(
            'success', false,
            'action', 'RETRY',
            'prompt_hi', 'Amaniya vikalp. Jankari ki pushti ke liye 1, ya sahayak se baat karne ke liye 2 dabayein.',
            'message', 'Invalid key pressed. Prompting retry.'
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
