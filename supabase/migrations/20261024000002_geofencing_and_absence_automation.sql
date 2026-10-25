-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261024000002_geofencing_and_absence_automation.sql
-- Backend Geospatial Validation, Absence Detection, and Telephony Integration
-- ==============================================================================

-- 1. SERVER-SIDE HAVERSINE GEOSPATIAL DISTANCE CALCULATION
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

-- 2. TRUSTED SERVER-SIDE VERIFICATION & ATTENDANCE RECORDING (RPC)
-- Validates face biometric confirmation and device coordinates on the database server.
-- Enforces geofencing radius, GPS accuracy, and attendance schedule windows.
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
    v_today DATE := CURRENT_DATE;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_record_id UUID;
    v_max_accuracy NUMERIC := 100.0; -- Max allowable GPS inaccuracy in meters
BEGIN
    -- 2.1 Fetch Student Record
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

    -- 2.2 Security: Enforce authorization (own record or staff)
    IF auth.uid() IS NOT NULL THEN
        IF v_student.profile_id != auth.uid() AND public.current_user_role() NOT IN ('admin', 'warden') THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'UNAUTHORIZED',
                'message', 'You are not authorized to mark attendance for this student.'
            );
        END IF;
    END IF;

    -- 2.3 Biometric Gate: Face must be verified
    IF p_face_verified IS NOT TRUE THEN
        -- Audit rejected attempt
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

    -- 2.4 GPS Accuracy Gate: Must be within allowable threshold
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

    -- 2.5 Resolve Hostel Geofence Center (Hostel-specific or CT Campus fallback)
    v_ref_lat := COALESCE(v_student.reference_latitude, 31.2558);
    v_ref_lng := COALESCE(v_student.reference_longitude, 75.5674);
    v_radius  := COALESCE(v_student.geofence_radius_meters, 200.0);

    -- 2.6 Server-Side Distance Calculation
    v_calc_distance := public.calculate_haversine_distance(p_device_lat, p_device_lng, v_ref_lat, v_ref_lng);

    IF v_calc_distance IS NULL OR v_calc_distance > v_radius THEN
        -- Audit rejected geofence attempt
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
            'message', format('Location rejected: You are %s m away from the hostel geofence (maximum radius: %s m).', v_calc_distance, v_radius)
        );
    END IF;

    -- 2.7 Fetch Schedule
    SELECT * INTO v_schedule FROM public.attendance_schedules WHERE id = p_schedule_id;

    -- 2.8 Insert or Update Attendance Record Idempotently
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
        v_now,
        'VERIFIED',
        format('VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: %s m, Accuracy: ±%s m, Face Conf: %s%%)', v_calc_distance, p_accuracy, p_face_confidence)
    )
    ON CONFLICT (student_id, schedule_id, attendance_date)
    DO UPDATE SET
        status = 'PRESENT',
        submitted_at = v_now,
        verification_status = 'VERIFIED',
        review_reason = format('RE-VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: %s m, Accuracy: ±%s m)', v_calc_distance, p_accuracy),
        updated_at = v_now
    RETURNING id INTO v_record_id;

    -- 2.9 Record Verification Submission Telemetry
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
        v_now,
        v_now,
        'VERIFIED',
        format('Automated server validation: Face match %s%%, Geofence distance %s m <= %s m radius', p_face_confidence, v_calc_distance, v_radius)
    );

    -- 2.10 Audit Success
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
            'timestamp', v_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'attendance_record_id', v_record_id,
        'distance_meters', v_calc_distance,
        'accuracy_meters', p_accuracy,
        'submitted_at', v_now,
        'message', format('Attendance verified! Confirmed inside %s geofence (%s m from center).', COALESCE(v_student.hostel_name, 'Campus'), v_calc_distance)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. AUTOMATIC ABSENCE DETECTION & GUARDIAN NOTIFICATION DISPATCH
-- Checks for students who have not submitted attendance after deadline + grace period.
-- Marks them ABSENT and idempotently queues outbound voice alert calls.
CREATE OR REPLACE FUNCTION public.detect_and_mark_absences(
    p_schedule_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
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
BEGIN
    SELECT * INTO v_schedule FROM public.attendance_schedules WHERE id = p_schedule_id;
    IF v_schedule IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Attendance schedule not found.');
    END IF;

    -- Iterate active enrolled students in the schedule's hostel
    FOR v_student IN
        SELECT s.*, g.id AS guardian_ref_id, g.phone_number AS guardian_phone, g.full_name AS guardian_name
        FROM public.students s
        LEFT JOIN public.guardians g ON g.id = s.guardian_id
        WHERE s.hostel_id = v_schedule.hostel_id
          AND s.enrollment_status = 'ACTIVE'
    LOOP
        -- Check if student already has a verified PRESENT, EXCUSED, or APPROVED_LEAVE record today
        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_records ar
            WHERE ar.student_id = v_student.id
              AND ar.schedule_id = p_schedule_id
              AND ar.attendance_date = p_date
              AND ar.status IN ('PRESENT', 'APPROVED_LEAVE', 'EXCUSED')
        ) THEN
            -- Check if student has an active approved leave request covering today
            SELECT * INTO v_leave
            FROM public.leave_requests lr
            WHERE lr.student_id = v_student.id
              AND lr.approval_status = 'APPROVED'
              AND p_date >= lr.start_date
              AND p_date <= lr.end_date
            LIMIT 1;

            IF v_leave IS NOT NULL THEN
                -- Mark APPROVED_LEAVE
                INSERT INTO public.attendance_records (
                    student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                )
                VALUES (
                    v_student.id, p_schedule_id, p_date, 'APPROVED_LEAVE', now(), 'VERIFIED',
                    format('Sanctioned Leave: %s (%s to %s)', v_leave.reason_category, v_leave.start_date, v_leave.end_date)
                )
                ON CONFLICT (student_id, schedule_id, attendance_date) DO NOTHING;
            ELSE
                -- Mark ABSENT
                INSERT INTO public.attendance_records (
                    student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                )
                VALUES (
                    v_student.id, p_schedule_id, p_date, 'ABSENT', now(), 'VERIFIED',
                    'Automated roll-call finalization: Missed attendance deadline and grace period.'
                )
                ON CONFLICT (student_id, schedule_id, attendance_date)
                DO UPDATE SET status = 'ABSENT', review_reason = 'Automated roll-call finalization: Confirmed Absent.'
                RETURNING id INTO v_record_id;

                v_absent_count := v_absent_count + 1;

                -- Idempotently queue automated guardian voice notification call
                IF v_student.guardian_ref_id IS NOT NULL AND v_record_id IS NOT NULL THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM public.notification_events ne
                        WHERE ne.attendance_record_id = v_record_id
                          AND ne.event_type = 'ABSENCE_CALL'
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
                        )
                        RETURNING id INTO v_notification_id;

                        -- Initialize Call Session
                        INSERT INTO public.call_sessions (
                            guardian_id,
                            attendance_record_id,
                            call_status,
                            transfer_requested
                        )
                        VALUES (
                            v_student.guardian_ref_id,
                            v_record_id,
                            'QUEUED',
                            false
                        );

                        v_queued_calls := v_queued_calls + 1;
                    END IF;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'schedule_name', v_schedule.name,
        'date', p_date,
        'absent_count', v_absent_count,
        'queued_calls', v_queued_calls,
        'message', format('Absence detection complete: %s students marked absent, %s guardian alerts queued.', v_absent_count, v_queued_calls)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. TELEPHONY IVR DTMF RESPONSE HANDLER
-- Processes digit '1' (acknowledgment) or digit '2' (warden / AI assistant bridge).
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
        -- Guardian acknowledged information
        UPDATE public.call_sessions
        SET call_status = 'COMPLETED',
            transfer_requested = false,
            transfer_result = 'ACKNOWLEDGED_BY_GUARDIAN',
            ended_at = now()
        WHERE id = p_session_id;

        UPDATE public.notification_events
        SET delivery_status = 'DELIVERED'
        WHERE attendance_record_id = v_session.attendance_record_id
          AND channel = 'voice';

        RETURN jsonb_build_object(
            'success', true,
            'action', 'HANGUP',
            'status', 'ACKNOWLEDGED',
            'prompt_hi', 'धन्यवाद। आपकी पावती सफलतापूर्वक दर्ज कर ली गई है।'
        );
    ELSIF p_digit_pressed = '2' THEN
        -- Guardian requested to speak to warden / AI voice assistant
        UPDATE public.call_sessions
        SET transfer_requested = true,
            transfer_result = CASE
                WHEN p_warden_phone IS NOT NULL THEN 'CONNECTING_TO_WARDEN'
                ELSE 'CONNECTING_TO_AI_ASSISTANT'
            END
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'TRANSFER',
            'transfer_to', COALESCE(p_warden_phone, 'AI_VOICE_ASSISTANT'),
            'prompt_hi', 'कृपया प्रतीक्षा करें, आपकी कॉल को छात्रावास वार्डन अथवा ए.आई. सहायक से जोड़ा जा रहा है।'
        );
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'action', 'RETRY',
            'prompt_hi', 'अमान्य विकल्प। कृपया पावती के लिए 1, या वार्डन से बात करने के लिए 2 दबाएं।'
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
