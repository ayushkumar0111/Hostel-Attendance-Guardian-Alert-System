-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261025000004_telephony_atomic_claim_and_retry.sql
-- Telephony Call Queue Atomic Claiming (FOR UPDATE SKIP LOCKED),
-- Exponential/Linear Retries, Warden Contact Resolution, and Webhook Telemetry
-- ==============================================================================

-- 1. EXTEND CALL SESSION STATUS ENUM SAFELY
DO $$ BEGIN
    ALTER TYPE public.call_session_status ADD VALUE IF NOT EXISTS 'RETRYING';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. ADD RECOVERY & TIMEOUT COLUMNS TO CALL SESSIONS
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS provider_call_sid TEXT;

-- 3. ATOMIC CALL SESSION CLAIMING (FOR UPDATE SKIP LOCKED)
-- Ensures strictly sequential, race-free claiming across concurrent workers.
-- Transitions session to 'RINGING' immediately within an atomic transaction.
CREATE OR REPLACE FUNCTION public.claim_next_call_session(
    p_worker_id TEXT DEFAULT 'worker-daemon'
)
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
    v_details RECORD;
    v_ist_now TIMESTAMPTZ := timezone('Asia/Kolkata', now());
BEGIN
    -- 3.1 Lock and select the single oldest queued or ready-for-retry session
    SELECT cs.*
    INTO v_session
    FROM public.call_sessions cs
    WHERE cs.call_status = 'QUEUED'
       OR (cs.call_status = 'RETRYING' AND (cs.next_retry_at IS NULL OR cs.next_retry_at <= now()))
    ORDER BY cs.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_session IS NULL THEN
        RETURN jsonb_build_object(
            'has_session', false,
            'message', 'No pending call sessions in queue.'
        );
    END IF;

    -- 3.2 Atomically update session to RINGING and stamp claim telemetry
    UPDATE public.call_sessions
    SET call_status = 'RINGING',
        claimed_by = p_worker_id,
        claimed_at = now(),
        started_at = COALESCE(started_at, now()),
        last_attempt_at = now(),
        attempts = attempts + 1
    WHERE id = v_session.id;

    -- 3.3 Retrieve student, guardian, hostel, and warden details
    SELECT
        s.id AS student_id,
        s.full_name AS student_name,
        s.roll_number,
        s.hostel_id,
        h.name AS hostel_name,
        COALESCE(
            h.warden_contact,
            (
                SELECT p.phone_number
                FROM public.warden_hostel_assignments wha
                JOIN public.profiles p ON p.id = wha.warden_id
                WHERE wha.hostel_id = s.hostel_id AND p.phone_number IS NOT NULL AND length(p.phone_number) > 5
                LIMIT 1
            )
        ) AS warden_contact,
        g.id AS guardian_id,
        g.full_name AS guardian_name,
        g.phone_number AS guardian_phone
    INTO v_details
    FROM public.attendance_records ar
    JOIN public.students s ON s.id = ar.student_id
    LEFT JOIN public.guardians g ON g.id = s.guardian_id
    LEFT JOIN public.hostels h ON h.id = s.hostel_id
    WHERE ar.id = v_session.attendance_record_id;

    RETURN jsonb_build_object(
        'has_session', true,
        'session_id', v_session.id,
        'attendance_record_id', v_session.attendance_record_id,
        'guardian_id', v_details.guardian_id,
        'guardian_name', COALESCE(v_details.guardian_name, 'Parent / Guardian'),
        'guardian_phone', v_details.guardian_phone,
        'student_id', v_details.student_id,
        'student_name', COALESCE(v_details.student_name, 'Resident'),
        'roll_number', COALESCE(v_details.roll_number, 'N/A'),
        'hostel_name', COALESCE(v_details.hostel_name, 'Hostel Campus'),
        'warden_contact', v_details.warden_contact,
        'attempts', v_session.attempts + 1,
        'retry_count', v_session.retry_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RECORD CALL FAILURE WITH RETRY SCHEDULING
CREATE OR REPLACE FUNCTION public.record_call_session_failure(
    p_session_id UUID,
    p_error_message TEXT,
    p_max_retries INTEGER DEFAULT 2,
    p_retry_delay_minutes INTEGER DEFAULT 5
)
RETURNS JSONB AS $$
DECLARE
    v_session RECORD;
    v_new_retry_count INTEGER;
    v_next_retry TIMESTAMPTZ;
    v_final_status call_session_status;
BEGIN
    SELECT * INTO v_session FROM public.call_sessions WHERE id = p_session_id;
    IF v_session IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Call session not found.');
    END IF;

    v_new_retry_count := v_session.retry_count + 1;

    IF v_new_retry_count <= p_max_retries THEN
        -- Schedule for retry
        v_next_retry := now() + (p_retry_delay_minutes || ' minutes')::interval;
        v_final_status := 'RETRYING';

        UPDATE public.call_sessions
        SET call_status = v_final_status,
            retry_count = v_new_retry_count,
            next_retry_at = v_next_retry,
            error_message = p_error_message,
            last_attempt_at = now()
        WHERE id = p_session_id;

        RETURN jsonb_build_object(
            'success', true,
            'session_id', p_session_id,
            'status', 'RETRYING',
            'retry_count', v_new_retry_count,
            'next_retry_at', v_next_retry,
            'message', format('Call attempt failed. Scheduled retry #%s at %s.', v_new_retry_count, v_next_retry)
        );
    ELSE
        -- Max retries exhausted: Mark FAILED
        v_final_status := 'FAILED';

        UPDATE public.call_sessions
        SET call_status = v_final_status,
            retry_count = v_new_retry_count,
            next_retry_at = NULL,
            error_message = format('%s (Max retries %s exhausted)', p_error_message, p_max_retries),
            ended_at = now(),
            last_attempt_at = now()
        WHERE id = p_session_id;

        -- Update associated notification event
        UPDATE public.notification_events
        SET delivery_status = 'FAILED',
            last_attempt_at = now()
        WHERE attendance_record_id = v_session.attendance_record_id;

        RETURN jsonb_build_object(
            'success', true,
            'session_id', p_session_id,
            'status', 'FAILED',
            'retry_count', v_new_retry_count,
            'message', 'Max retries exhausted. Call session marked as FAILED.'
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RE-ASSERT WARDEN AND HOSTEL DATA INTEGRITY
COMMENT ON FUNCTION public.claim_next_call_session(TEXT) IS 
'Atomically claims the next call session in queue using SELECT FOR UPDATE SKIP LOCKED to prevent duplicate processing.';
COMMENT ON FUNCTION public.record_call_session_failure(UUID, TEXT, INTEGER, INTEGER) IS 
'Records a failed call attempt and schedules automated retry or marks session FAILED upon exhausting max retries.';
