-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261104000008_production_pg_cron_absence_automation.sql
-- Production Automated Absence Processing via pg_cron & Secure Function
--
-- STRICT ARCHITECTURAL REQUIREMENTS:
-- 1. Accurate Timezone: now() for TIMESTAMPTZ, (now() AT TIME ZONE 'Asia/Kolkata') for local date/time.
-- 2. Safe Dry-Run Mode: p_dry_run = TRUE simulates without attendance writes and logs status 'DRY_RUN'.
-- 3. Premature Force Lockdown: Only Administrators or service authority can force live absence processing before 22:31 IST.
-- 4. Scope Isolation: Strictly processes CT Group Shahpur Campus schedule (Pin: 31.236872, 75.553745).
-- 5. No Guardian Telephony: Web Push directly to student registered endpoints; zero guardian calls or table dependencies.
-- 6. Strict Preservation: Verified PRESENT, APPROVED_LEAVE, and EXCUSED records are never overwritten.
-- 7. Verified pg_cron Registration: Validates to_regclass('cron.job') and to_regproc('cron.schedule') explicitly.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXECUTION AUDIT TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.absence_processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    schedule_id UUID REFERENCES public.attendance_schedules(id) ON DELETE SET NULL,
    schedule_name TEXT NOT NULL,
    attendance_date DATE NOT NULL,
    status TEXT NOT NULL, -- 'SUCCESS', 'DRY_RUN', 'SKIPPED_WINDOW_OPEN', 'FAILED'
    execution_source TEXT NOT NULL DEFAULT 'PG_CRON', -- 'PG_CRON', 'EDGE_FUNCTION', 'MANUAL_TEST'
    is_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    total_eligible_students INTEGER NOT NULL DEFAULT 0,
    present_count INTEGER NOT NULL DEFAULT 0,
    approved_leave_count INTEGER NOT NULL DEFAULT 0,
    absent_marked_count INTEGER NOT NULL DEFAULT 0,
    duration_ms NUMERIC NOT NULL DEFAULT 0,
    message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.absence_processing_logs ENABLE ROW LEVEL SECURITY;

-- Staff Read Policy (Admins and Wardens only)
DROP POLICY IF EXISTS "Staff view absence processing logs" ON public.absence_processing_logs;
CREATE POLICY "Staff view absence processing logs"
    ON public.absence_processing_logs FOR SELECT
    TO authenticated
    USING (public.current_user_role() IN ('admin', 'warden'));

-- Service Role Full Access
DROP POLICY IF EXISTS "Service role manage absence processing logs" ON public.absence_processing_logs;
CREATE POLICY "Service role manage absence processing logs"
    ON public.absence_processing_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 2. SAFE SHAHPUR CAMPUS HOSTEL & ATTENDANCE SCHEDULE PROVISIONING
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_hostel_id UUID;
    v_schedule_id UUID;
BEGIN
    -- 2.1 Locate existing Shahpur Campus hostel by exact name or campus GPS pin (31.236872, 75.553745)
    SELECT id INTO v_hostel_id
    FROM public.hostels
    WHERE name = 'CT Boys & Girls Hostel (Shahpur Campus)'
       OR (
           reference_latitude IS NOT NULL AND reference_longitude IS NOT NULL
           AND ABS(reference_latitude - 31.236872) < 0.005
           AND ABS(reference_longitude - 75.553745) < 0.005
       )
    LIMIT 1;

    -- If no Shahpur hostel exists, provision it specifically without modifying other hostels
    IF v_hostel_id IS NULL THEN
        INSERT INTO public.hostels (
            name,
            institution_name,
            campus_unit,
            reference_latitude,
            reference_longitude,
            geofence_radius_meters,
            is_active
        )
        VALUES (
            'CT Boys & Girls Hostel (Shahpur Campus)',
            'CT GROUP OF INSTITUTIONS',
            'CTIEMT',
            31.236872,
            75.553745,
            535,
            true
        )
        RETURNING id INTO v_hostel_id;
        RAISE NOTICE 'Provisioned Shahpur Campus Hostel with ID: %', v_hostel_id;
    ELSE
        -- Ensure active status and verified campus geofence configuration (535m radius)
        UPDATE public.hostels
        SET reference_latitude = 31.236872,
            reference_longitude = 75.553745,
            geofence_radius_meters = 535,
            is_active = true
        WHERE id = v_hostel_id;
        RAISE NOTICE 'Verified existing Shahpur Campus Hostel with ID: %', v_hostel_id;
    END IF;

    -- 2.2 Provision or verify Shahpur Night Curfew Attendance Schedule (21:30 to 22:30 IST)
    SELECT id INTO v_schedule_id
    FROM public.attendance_schedules
    WHERE (hostel_id = v_hostel_id OR hostel_id IS NULL)
      AND (
          name = 'Night Curfew Roll-Call (Shahpur Campus)'
          OR (start_time = '21:30:00' AND deadline_time = '22:30:00')
      )
    LIMIT 1;

    IF v_schedule_id IS NULL THEN
        INSERT INTO public.attendance_schedules (
            name,
            hostel_id,
            start_time,
            deadline_time,
            grace_period_minutes,
            is_active
        )
        VALUES (
            'Night Curfew Roll-Call (Shahpur Campus)',
            v_hostel_id,
            '21:30:00',
            '22:30:00',
            1,
            true
        )
        RETURNING id INTO v_schedule_id;
        RAISE NOTICE 'Provisioned Night Curfew Attendance Schedule with ID: %', v_schedule_id;
    ELSE
        UPDATE public.attendance_schedules
        SET is_active = true,
            grace_period_minutes = 1,
            hostel_id = COALESCE(hostel_id, v_hostel_id)
        WHERE id = v_schedule_id;
        RAISE NOTICE 'Verified existing Attendance Schedule with ID: %', v_schedule_id;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. PRODUCTION HARDENED ABSENCE FINALIZATION PROCEDURE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_nightly_absence_finalization(
    p_dry_run BOOLEAN DEFAULT FALSE,
    p_force BOOLEAN DEFAULT FALSE,
    p_source TEXT DEFAULT 'PG_CRON'
)
RETURNS JSONB AS $$
DECLARE
    v_start_ts TIMESTAMPTZ := clock_timestamp();
    v_end_ts TIMESTAMPTZ;
    v_duration_ms NUMERIC;
    v_utc_now TIMESTAMPTZ := now();
    -- Accurate local date and time in Asia/Kolkata timezone
    v_ist_time TIME := ((now() AT TIME ZONE 'Asia/Kolkata'))::time;
    v_today DATE := ((now() AT TIME ZONE 'Asia/Kolkata'))::date;
    v_sched RECORD;
    v_student RECORD;
    v_leave RECORD;
    v_finalization_time TIME;
    v_sched_processed INTEGER := 0;
    v_total_absent INTEGER := 0;
    v_sched_absent INTEGER := 0;
    v_sched_present INTEGER := 0;
    v_sched_leave INTEGER := 0;
    v_sched_eligible INTEGER := 0;
    v_record_id UUID;
    v_status TEXT;
    v_batch_summary JSONB := '[]'::jsonb;
    v_caller_role user_role;
BEGIN
    -- 3.1 Security Access Control:
    -- If called via authenticated user session, verify privileges
    IF auth.uid() IS NOT NULL THEN
        v_caller_role := public.current_user_role();
        IF v_caller_role NOT IN ('admin', 'warden') THEN
            RAISE EXCEPTION 'Access Denied: Only authorized hostel staff or system cron can execute absence finalization.'
                USING ERRCODE = '42501';
        END IF;

        -- Prevent premature forced live absence processing by ordinary wardens
        -- Only Administrators or backend service authority can force live absence processing before 22:31 IST
        IF p_force IS TRUE AND p_dry_run IS FALSE AND v_caller_role != 'admin' THEN
            RAISE EXCEPTION 'Access Denied: Premature live absence finalization before 22:31 IST is strictly restricted to Administrators and system authority.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 3.2 Scope Isolation: Strictly iterate active Shahpur Campus schedule
    FOR v_sched IN
        SELECT s.*
        FROM public.attendance_schedules s
        LEFT JOIN public.hostels h ON h.id = s.hostel_id
        WHERE s.is_active = true
          AND (
              s.name = 'Night Curfew Roll-Call (Shahpur Campus)'
              OR (
                  h.name = 'CT Boys & Girls Hostel (Shahpur Campus)'
                  AND s.start_time = '21:30:00'
                  AND s.deadline_time = '22:30:00'
              )
              OR (
                  h.reference_latitude IS NOT NULL AND h.reference_longitude IS NOT NULL
                  AND ABS(h.reference_latitude - 31.236872) < 0.005
                  AND ABS(h.reference_longitude - 75.553745) < 0.005
                  AND s.start_time = '21:30:00'
              )
          )
    LOOP
        v_sched_absent := 0;
        v_sched_present := 0;
        v_sched_leave := 0;
        v_sched_eligible := 0;
        v_finalization_time := v_sched.deadline_time + (COALESCE(v_sched.grace_period_minutes, 1) || ' minutes')::interval;

        -- Acquire transaction-level advisory lock per schedule and date to prevent concurrent duplicate runs
        PERFORM pg_advisory_xact_lock(hashtext('absence_finalization_' || v_sched.id::text || '_' || v_today::text));

        -- 3.3 Timing Gate: Cutoff is 22:31:00 IST (10:31 PM Asia/Kolkata)
        IF v_ist_time < v_finalization_time AND p_force IS NOT TRUE THEN
            -- Record skipped log
            INSERT INTO public.absence_processing_logs (
                execution_time, schedule_id, schedule_name, attendance_date, status, execution_source,
                is_dry_run, total_eligible_students, present_count, approved_leave_count, absent_marked_count,
                duration_ms, message
            )
            VALUES (
                v_utc_now, v_sched.id, v_sched.name, v_today, 'SKIPPED_WINDOW_OPEN', p_source,
                p_dry_run, 0, 0, 0, 0, 0,
                format('Finalization skipped: Roll-call window open until %s IST. Finalization cutoff is %s IST.',
                    to_char(v_sched.deadline_time, 'HH12:MI AM'),
                    to_char(v_finalization_time, 'HH12:MI AM')
                )
            );
            CONTINUE;
        END IF;

        -- 3.4 Iterate eligible active enrolled students for Shahpur Campus
        FOR v_student IN
            SELECT s.*
            FROM public.students s
            WHERE (v_sched.hostel_id IS NULL OR s.hostel_id = v_sched.hostel_id)
              AND s.enrollment_status = 'ACTIVE'
        LOOP
            v_sched_eligible := v_sched_eligible + 1;

            -- 3.5 CRITICAL PRESERVATION: Check for existing verified records
            -- A verified check-in (PRESENT, APPROVED_LEAVE, EXCUSED) must NEVER be overwritten
            IF EXISTS (
                SELECT 1 FROM public.attendance_records ar
                WHERE ar.student_id = v_student.id
                  AND ar.schedule_id = v_sched.id
                  AND ar.attendance_date = v_today
                  AND ar.status = 'PRESENT'
            ) THEN
                v_sched_present := v_sched_present + 1;
                CONTINUE;
            ELSIF EXISTS (
                SELECT 1 FROM public.attendance_records ar
                WHERE ar.student_id = v_student.id
                  AND ar.schedule_id = v_sched.id
                  AND ar.attendance_date = v_today
                  AND ar.status IN ('APPROVED_LEAVE', 'EXCUSED')
            ) THEN
                v_sched_leave := v_sched_leave + 1;
                CONTINUE;
            END IF;

            -- 3.6 Check for active approved leave covering today
            SELECT * INTO v_leave
            FROM public.leave_requests lr
            WHERE lr.student_id = v_student.id
              AND lr.approval_status = 'APPROVED'
              AND v_today >= lr.start_date
              AND v_today <= lr.end_date
            LIMIT 1;

            IF v_leave IS NOT NULL THEN
                v_sched_leave := v_sched_leave + 1;
                -- Write only if not dry-run
                IF p_dry_run IS FALSE THEN
                    INSERT INTO public.attendance_records (
                        student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                    )
                    VALUES (
                        v_student.id, v_sched.id, v_today, 'APPROVED_LEAVE', v_utc_now, 'VERIFIED',
                        format('Sanctioned Leave: %s (%s to %s)', v_leave.reason_category, v_leave.start_date, v_leave.end_date)
                    )
                    ON CONFLICT (student_id, schedule_id, attendance_date) DO NOTHING;
                END IF;
            ELSE
                -- 3.7 Unrecorded student: Mark or simulate ABSENT
                v_sched_absent := v_sched_absent + 1;

                IF p_dry_run IS FALSE THEN
                    INSERT INTO public.attendance_records (
                        student_id, schedule_id, attendance_date, status, submitted_at, verification_status, review_reason
                    )
                    VALUES (
                        v_student.id, v_sched.id, v_today, 'ABSENT', v_utc_now, 'VERIFIED',
                        'Automated roll-call finalization at 22:31 IST: Missed attendance window.'
                    )
                    ON CONFLICT (student_id, schedule_id, attendance_date)
                    DO UPDATE SET
                        status = 'ABSENT',
                        review_reason = 'Automated roll-call finalization at 22:31 IST: Confirmed Absent.',
                        updated_at = v_utc_now
                    WHERE public.attendance_records.status NOT IN ('PRESENT', 'APPROVED_LEAVE', 'EXCUSED')
                    RETURNING id INTO v_record_id;
                END IF;
            END IF;
        END LOOP;

        v_sched_processed := v_sched_processed + 1;
        v_total_absent := v_total_absent + v_sched_absent;

        -- Record Audit Log for this schedule
        v_end_ts := clock_timestamp();
        v_duration_ms := ROUND((EXTRACT(EPOCH FROM (v_end_ts - v_start_ts)) * 1000)::numeric, 2);
        v_status := CASE WHEN p_dry_run THEN 'DRY_RUN' ELSE 'SUCCESS' END;

        INSERT INTO public.absence_processing_logs (
            execution_time, schedule_id, schedule_name, attendance_date, status, execution_source,
            is_dry_run, total_eligible_students, present_count, approved_leave_count, absent_marked_count,
            duration_ms, message
        )
        VALUES (
            v_utc_now, v_sched.id, v_sched.name, v_today, v_status, p_source,
            p_dry_run, v_sched_eligible, v_sched_present, v_sched_leave, v_sched_absent,
            v_duration_ms,
            format('%s for "%s": %s marked absent, %s present, %s on leave (Total eligible: %s).',
                CASE WHEN p_dry_run THEN 'Dry-run evaluation complete (simulation only; no database modifications were made)' ELSE 'Finalization complete' END,
                v_sched.name, v_sched_absent, v_sched_present, v_sched_leave, v_sched_eligible
            )
        );

        v_batch_summary := v_batch_summary || jsonb_build_object(
            'schedule_id', v_sched.id,
            'schedule_name', v_sched.name,
            'eligible', v_sched_eligible,
            'present', v_sched_present,
            'approved_leave', v_sched_leave,
            'absent_marked', v_sched_absent
        );
    END LOOP;

    v_end_ts := clock_timestamp();
    v_duration_ms := ROUND((EXTRACT(EPOCH FROM (v_end_ts - v_start_ts)) * 1000)::numeric, 2);

    RETURN jsonb_build_object(
        'success', true,
        'dry_run', p_dry_run,
        'execution_source', p_source,
        'attendance_date', v_today,
        'schedules_processed', v_sched_processed,
        'total_absent_marked', v_total_absent,
        'duration_ms', v_duration_ms,
        'details', v_batch_summary,
        'timestamp', v_utc_now
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Restrict execution privileges
REVOKE ALL ON FUNCTION public.process_nightly_absence_finalization(BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_nightly_absence_finalization(BOOLEAN, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_nightly_absence_finalization(BOOLEAN, BOOLEAN, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. BACKWARD COMPATIBILITY WRAPPER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_all_active_schedules_absences(
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.process_nightly_absence_finalization(false, p_force, 'EDGE_FUNCTION');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.process_all_active_schedules_absences(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_all_active_schedules_absences(BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_all_active_schedules_absences(BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. VERIFIED PG_CRON SCHEDULE REGISTRATION (17:01 UTC / 22:31 ASIA/KOLKATA)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_cron_available BOOLEAN := FALSE;
    v_existing_job_id BIGINT;
BEGIN
    -- 5.1 Check if pg_cron is available in pg_available_extensions
    SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') INTO v_cron_available;

    IF NOT v_cron_available THEN
        RAISE EXCEPTION 'CRITICAL: pg_cron extension is not available in pg_available_extensions for this database.'
            USING ERRCODE = '0A000';
    END IF;

    -- 5.2 Ensure pg_cron extension is installed
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

    -- 5.3 Verify that cron.job table and cron.schedule function actually exist
    IF to_regclass('cron.job') IS NULL THEN
        RAISE EXCEPTION 'CRITICAL: Table "cron.job" was not found after activating pg_cron. Check extension schema.'
            USING ERRCODE = '42P01';
    END IF;

    IF to_regproc('cron.schedule') IS NULL THEN
        RAISE EXCEPTION 'CRITICAL: Function "cron.schedule" was not found after activating pg_cron.'
            USING ERRCODE = '42883';
    END IF;

    -- 5.4 Safely unschedule existing jobs to prevent duplicate entries
    FOR v_existing_job_id IN
        SELECT jobid FROM cron.job
        WHERE jobname IN ('nightly-absence-finalization-1031pm-ist', 'finalize-nightly-absences-1031pm-ist')
    LOOP
        PERFORM cron.unschedule(v_existing_job_id);
        RAISE NOTICE 'Unscheduled existing cron job with ID % to update schedule definition.', v_existing_job_id;
    END LOOP;

    -- 5.5 Register the production schedule
    -- Cron syntax: '1 17 * * *' = Daily at 17:01 UTC (22:31 Asia/Kolkata / 10:31 PM IST)
    PERFORM cron.schedule(
        'nightly-absence-finalization-1031pm-ist',
        '1 17 * * *',
        'SELECT public.process_nightly_absence_finalization(false, false, ''PG_CRON'')'
    );

    -- 5.6 Verify registration succeeded
    IF NOT EXISTS (
        SELECT 1 FROM cron.job
        WHERE jobname = 'nightly-absence-finalization-1031pm-ist' AND active = true
    ) THEN
        RAISE EXCEPTION 'FAILED: pg_cron job registration failed. Job is not active in cron.job table.'
            USING ERRCODE = 'XX000';
    ELSE
        RAISE NOTICE 'SUCCESS: pg_cron job "nightly-absence-finalization-1031pm-ist" registered and verified for 17:01 UTC (22:31 IST).';
    END IF;
END $$;
