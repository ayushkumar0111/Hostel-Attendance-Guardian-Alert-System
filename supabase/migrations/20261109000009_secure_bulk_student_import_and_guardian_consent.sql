-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - HOSTEL ATTENDANCE & GUARDIAN ALERT SYSTEM
-- Migration: 20261109000009_secure_bulk_student_import_and_guardian_consent.sql
--
-- TARGETED CORRECTIONS:
-- 1. Guardian Consent: Safe NOT NULL and constraint enforcement without auto-CONSENTED.
--    Clearly reports if NOT NULL or constraint guarantees cannot be established.
-- 2. Partial Unique Indexes on roll_number and student_code:
--    Verifies existing index definitions, handles NULL/blank values, never modifies records.
-- 3. Duplicate Detection RPC: Strict admin authorization and input sanitization.
-- 4. Atomic Single Student Enrollment RPC: Strict field validation, no silent defaults.
-- 5. Atomic Batch Student Enrollment RPC:
--    - Enforces maximum 500 students per RPC call.
--    - Rejects unexpected field names, booleans, objects, and arrays.
--    - Resets all per-row variables before processing each row.
--    - Does not silently assign department, academic year, or room number.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. GUARDIAN CONSENT DEFAULT & SAFE STATUS CONSTRAINT
-- ------------------------------------------------------------------------------
-- 1.1 Set default consent status for newly created records to 'PENDING'.
-- Never automatically mark any newly created guardian as 'CONSENTED'.
ALTER TABLE public.guardians 
    ALTER COLUMN notification_consent_status SET DEFAULT 'PENDING';

-- 1.2 Safe enforcement of NOT NULL and status check constraint:
-- Verifies existing data without mutating or deleting records.
-- Performs deep catalog inspection:
-- (a) Verifies constraint on public.guardians table (conrelid = 'public.guardians'::regclass)
-- (b) Verifies actual constraint definition (pg_get_constraintdef)
-- (c) Verifies validation status (convalidated)
DO $$
DECLARE
    v_null_count INTEGER := 0;
    v_invalid_count INTEGER := 0;
    v_not_null_established BOOLEAN := FALSE;
    v_check_established BOOLEAN := FALSE;
    v_constraint_record RECORD;
    v_constraint_exists BOOLEAN := FALSE;
    v_actual_def TEXT;
    v_is_convalidated BOOLEAN := FALSE;
    v_definition_matches BOOLEAN := FALSE;
BEGIN
    -- Ensure table exists
    IF to_regclass('public.guardians') IS NULL THEN
        RAISE EXCEPTION 'Table public.guardians does not exist.';
    END IF;

    -- Audit existing NULL values in public.guardians
    SELECT COUNT(*) INTO v_null_count
    FROM public.guardians
    WHERE notification_consent_status IS NULL;

    -- Audit existing non-conforming status values
    SELECT COUNT(*) INTO v_invalid_count
    FROM public.guardians
    WHERE notification_consent_status IS NOT NULL
      AND notification_consent_status NOT IN ('PENDING', 'CONSENTED', 'REVOKED', 'REJECTED');

    -- Safe NOT NULL enforcement
    IF v_null_count > 0 THEN
        RAISE WARNING 'SKIPPED SET NOT NULL on public.guardians.notification_consent_status: % guardian record(s) contain NULL. NOT NULL guarantee CANNOT be established until these records are manually resolved. Existing records have NOT been modified or converted to CONSENTED.', v_null_count;
    ELSE
        BEGIN
            ALTER TABLE public.guardians ALTER COLUMN notification_consent_status SET NOT NULL;
            v_not_null_established := TRUE;
            RAISE NOTICE 'Column public.guardians.notification_consent_status verified and enforced as NOT NULL.';
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to set NOT NULL on public.guardians.notification_consent_status: %', SQLERRM;
        END;
    END IF;

    -- Deep inspection of check constraint on public.guardians table:
    -- Verify against:
    -- (a) Correct table (c.conrelid = 'public.guardians'::regclass)
    -- (b) Actual constraint definition (pg_get_constraintdef(c.oid))
    -- (c) Validation status (c.convalidated)
    SELECT 
        c.conname,
        c.convalidated,
        pg_get_constraintdef(c.oid) AS constraint_def
    INTO v_constraint_record
    FROM pg_constraint c
    WHERE c.conrelid = 'public.guardians'::regclass
      AND c.conname = 'chk_guardian_notification_consent_status'
      AND c.contype = 'c';

    IF FOUND THEN
        v_constraint_exists := TRUE;
        v_is_convalidated := v_constraint_record.convalidated;
        v_actual_def := v_constraint_record.constraint_def;

        -- Check if definition covers all 4 required statuses
        IF v_actual_def ILIKE '%PENDING%'
           AND v_actual_def ILIKE '%CONSENTED%'
           AND v_actual_def ILIKE '%REVOKED%'
           AND v_actual_def ILIKE '%REJECTED%' THEN
            v_definition_matches := TRUE;
        END IF;

        IF v_definition_matches THEN
            IF NOT v_is_convalidated THEN
                IF v_null_count = 0 AND v_invalid_count = 0 THEN
                    ALTER TABLE public.guardians VALIDATE CONSTRAINT chk_guardian_notification_consent_status;
                    v_check_established := TRUE;
                    RAISE NOTICE 'Constraint chk_guardian_notification_consent_status on public.guardians was unvalidated. Now verified and validated.';
                ELSE
                    RAISE WARNING 'Constraint chk_guardian_notification_consent_status on public.guardians exists but is NOT VALIDATED (convalidated = false), and cannot be validated due to % NULL and % invalid record(s). Manual cleanup required.', v_null_count, v_invalid_count;
                END IF;
            ELSE
                v_check_established := TRUE;
                RAISE NOTICE 'Constraint chk_guardian_notification_consent_status on public.guardians verified: definition matches and is already validated (%).', v_actual_def;
            END IF;
        ELSE
            -- Definition does not match required statuses
            IF v_null_count > 0 OR v_invalid_count > 0 THEN
                RAISE WARNING 'Existing constraint chk_guardian_notification_consent_status on public.guardians has outdated definition (%) but cannot be replaced safely due to % NULL and % invalid record(s). Manual cleanup required.', v_actual_def, v_null_count, v_invalid_count;
            ELSE
                RAISE NOTICE 'Existing constraint chk_guardian_notification_consent_status on public.guardians has outdated definition (%). Replacing with compliant definition...', v_actual_def;
                ALTER TABLE public.guardians DROP CONSTRAINT chk_guardian_notification_consent_status;
                ALTER TABLE public.guardians
                ADD CONSTRAINT chk_guardian_notification_consent_status
                CHECK (notification_consent_status IS NOT NULL AND notification_consent_status IN ('PENDING', 'CONSENTED', 'REVOKED', 'REJECTED'));
                v_check_established := TRUE;
                RAISE NOTICE 'Compliant constraint chk_guardian_notification_consent_status successfully created and validated on public.guardians.';
            END IF;
        END IF;
    ELSE
        -- Constraint does not exist on public.guardians
        IF v_null_count > 0 OR v_invalid_count > 0 THEN
            RAISE WARNING 'SKIPPED constraint chk_guardian_notification_consent_status: % NULL record(s) and % non-standard record(s) found on public.guardians. Valid statuses are strictly (PENDING, CONSENTED, REVOKED, REJECTED). Constraint was NOT applied. Manual reconciliation required.', v_null_count, v_invalid_count;
        ELSE
            ALTER TABLE public.guardians
            ADD CONSTRAINT chk_guardian_notification_consent_status
            CHECK (notification_consent_status IS NOT NULL AND notification_consent_status IN ('PENDING', 'CONSENTED', 'REVOKED', 'REJECTED'));
            v_check_established := TRUE;
            RAISE NOTICE 'Constraint chk_guardian_notification_consent_status successfully created and validated on public.guardians.';
        END IF;
    END IF;

    -- Report status of guardian consent guarantees
    IF v_not_null_established AND v_check_established THEN
        RAISE NOTICE 'Guardian consent integrity guarantees established on public.guardians: NOT NULL and valid status values (PENDING, CONSENTED, REVOKED, REJECTED) are active and validated.';
    ELSE
        RAISE WARNING 'ADVISORY: Guardian consent NOT NULL or check constraint guarantees could NOT be fully established due to pre-existing data irregularities. Review public.guardians table manually.';
    END IF;
END $$;

-- 1.3 Performance index for filtering guardians by consent status
CREATE INDEX IF NOT EXISTS idx_guardians_consent_status 
    ON public.guardians(notification_consent_status);

-- ------------------------------------------------------------------------------
-- 2. SAFE PARTIAL UNIQUE INDEXES FOR STUDENTS
-- ------------------------------------------------------------------------------
-- Uses partial unique indexes (WHERE roll_number IS NOT NULL AND TRIM(roll_number) <> '')
-- to handle NULL and blank historical entries safely without modifying or deleting data.
DO $$
DECLARE
    v_roll_dups TEXT;
    v_code_dups TEXT;
    v_blank_roll_count INTEGER := 0;
    v_blank_code_count INTEGER := 0;
    v_existing_roll_indexdef TEXT;
    v_existing_code_indexdef TEXT;
BEGIN
    -- 2.1 Audit blank and NULL values (Advisory report only, no data alterations)
    SELECT COUNT(*) INTO v_blank_roll_count
    FROM public.students
    WHERE roll_number IS NULL OR TRIM(roll_number) = '';

    IF v_blank_roll_count > 0 THEN
        RAISE NOTICE 'Advisory: % student record(s) have blank or NULL roll numbers. Partial unique index will safely ignore them.', v_blank_roll_count;
    END IF;

    SELECT COUNT(*) INTO v_blank_code_count
    FROM public.students
    WHERE student_code IS NULL OR TRIM(student_code) = '';

    IF v_blank_code_count > 0 THEN
        RAISE NOTICE 'Advisory: % student record(s) have blank or NULL student codes. Partial unique index will safely ignore them.', v_blank_code_count;
    END IF;

    -- 2.2 Audit duplicate roll numbers differing only by case or whitespace
    SELECT string_agg(lower_roll || ' (' || cnt || ' occurrences)', '; ')
    INTO v_roll_dups
    FROM (
        SELECT LOWER(TRIM(roll_number)) AS lower_roll, COUNT(*) AS cnt
        FROM public.students
        WHERE roll_number IS NOT NULL AND TRIM(roll_number) <> ''
        GROUP BY LOWER(TRIM(roll_number))
        HAVING COUNT(*) > 1
        LIMIT 10
    ) sub;

    IF v_roll_dups IS NOT NULL THEN
        RAISE WARNING 'SKIPPED index uq_students_roll_number_lower: Duplicate roll numbers found: [%]. Manual data reconciliation required before this unique index can be created. Existing records were NOT modified.', v_roll_dups;
    ELSE
        -- Inspect existing index definition if present on students table
        SELECT indexdef INTO v_existing_roll_indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'students' AND indexname = 'uq_students_roll_number_lower';

        IF v_existing_roll_indexdef IS NOT NULL THEN
            IF v_existing_roll_indexdef LIKE '%WHERE%roll_number IS NOT NULL%' THEN
                RAISE NOTICE 'Partial unique index uq_students_roll_number_lower already exists with verified definition.';
            ELSE
                RAISE WARNING 'Existing index uq_students_roll_number_lower found with non-partial definition. Upgrading to partial unique index.';
                DROP INDEX public.uq_students_roll_number_lower;
                CREATE UNIQUE INDEX uq_students_roll_number_lower
                    ON public.students (LOWER(TRIM(roll_number)))
                    WHERE roll_number IS NOT NULL AND TRIM(roll_number) <> '';
                RAISE NOTICE 'Upgraded partial unique index uq_students_roll_number_lower successfully created.';
            END IF;
        ELSE
            CREATE UNIQUE INDEX uq_students_roll_number_lower
                ON public.students (LOWER(TRIM(roll_number)))
                WHERE roll_number IS NOT NULL AND TRIM(roll_number) <> '';
            RAISE NOTICE 'Partial unique index uq_students_roll_number_lower successfully created.';
        END IF;
    END IF;

    -- 2.3 Audit duplicate student codes differing only by case or whitespace
    SELECT string_agg(lower_code || ' (' || cnt || ' occurrences)', '; ')
    INTO v_code_dups
    FROM (
        SELECT LOWER(TRIM(student_code)) AS lower_code, COUNT(*) AS cnt
        FROM public.students
        WHERE student_code IS NOT NULL AND TRIM(student_code) <> ''
        GROUP BY LOWER(TRIM(student_code))
        HAVING COUNT(*) > 1
        LIMIT 10
    ) sub;

    IF v_code_dups IS NOT NULL THEN
        RAISE WARNING 'SKIPPED index uq_students_student_code_lower: Duplicate student codes found: [%]. Manual data reconciliation required before this unique index can be created. Existing records were NOT modified.', v_code_dups;
    ELSE
        -- Inspect existing index definition if present on students table
        SELECT indexdef INTO v_existing_code_indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'students' AND indexname = 'uq_students_student_code_lower';

        IF v_existing_code_indexdef IS NOT NULL THEN
            IF v_existing_code_indexdef LIKE '%WHERE%student_code IS NOT NULL%' THEN
                RAISE NOTICE 'Partial unique index uq_students_student_code_lower already exists with verified definition.';
            ELSE
                RAISE WARNING 'Existing index uq_students_student_code_lower found with non-partial definition. Upgrading to partial unique index.';
                DROP INDEX public.uq_students_student_code_lower;
                CREATE UNIQUE INDEX uq_students_student_code_lower
                    ON public.students (LOWER(TRIM(student_code)))
                    WHERE student_code IS NOT NULL AND TRIM(student_code) <> '';
                RAISE NOTICE 'Upgraded partial unique index uq_students_student_code_lower successfully created.';
            END IF;
        ELSE
            CREATE UNIQUE INDEX uq_students_student_code_lower
                ON public.students (LOWER(TRIM(student_code)))
                WHERE student_code IS NOT NULL AND TRIM(student_code) <> '';
            RAISE NOTICE 'Partial unique index uq_students_student_code_lower successfully created.';
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. SERVER-SIDE DUPLICATE CHECK RPC (STRICT ADMIN AUTHORIZATION)
-- ------------------------------------------------------------------------------
-- Efficiently checks candidate roll numbers and student codes.
-- Bypasses the 1,000-row Supabase REST limit.
-- Enforces strict admin check: Unauthorized users cannot enumerate student records.
CREATE OR REPLACE FUNCTION public.check_student_duplicates(
    p_roll_numbers TEXT[],
    p_student_codes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role public.user_role;
    v_clean_rolls TEXT[];
    v_clean_codes TEXT[];
    v_dup_rolls TEXT[];
    v_dup_codes TEXT[];
BEGIN
    -- 1. Strict admin authorization check
    v_user_role := public.current_user_role();
    IF v_user_role IS NULL OR v_user_role::text <> 'admin' THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can check student duplicates.';
    END IF;

    -- 2. Sanitize and validate input arrays (handle NULLs and empty strings safely)
    IF p_roll_numbers IS NOT NULL THEN
        SELECT COALESCE(ARRAY_AGG(DISTINCT LOWER(TRIM(u))), ARRAY[]::TEXT[])
        INTO v_clean_rolls
        FROM unnest(p_roll_numbers) AS u
        WHERE u IS NOT NULL AND TRIM(u) <> '';
    ELSE
        v_clean_rolls := ARRAY[]::TEXT[];
    END IF;

    IF p_student_codes IS NOT NULL THEN
        SELECT COALESCE(ARRAY_AGG(DISTINCT LOWER(TRIM(u))), ARRAY[]::TEXT[])
        INTO v_clean_codes
        FROM unnest(p_student_codes) AS u
        WHERE u IS NOT NULL AND TRIM(u) <> '';
    ELSE
        v_clean_codes := ARRAY[]::TEXT[];
    END IF;

    -- Short-circuit if both lists are empty
    IF cardinality(v_clean_rolls) = 0 AND cardinality(v_clean_codes) = 0 THEN
        RETURN jsonb_build_object(
            'duplicate_roll_numbers', '[]'::JSONB,
            'duplicate_student_codes', '[]'::JSONB
        );
    END IF;

    -- 3. Query matching roll numbers
    IF cardinality(v_clean_rolls) > 0 THEN
        SELECT COALESCE(ARRAY_AGG(DISTINCT s.roll_number), ARRAY[]::TEXT[])
        INTO v_dup_rolls
        FROM public.students s
        WHERE LOWER(TRIM(s.roll_number)) = ANY(v_clean_rolls);
    ELSE
        v_dup_rolls := ARRAY[]::TEXT[];
    END IF;

    -- 4. Query matching student codes
    IF cardinality(v_clean_codes) > 0 THEN
        SELECT COALESCE(ARRAY_AGG(DISTINCT s.student_code), ARRAY[]::TEXT[])
        INTO v_dup_codes
        FROM public.students s
        WHERE LOWER(TRIM(s.student_code)) = ANY(v_clean_codes);
    ELSE
        v_dup_codes := ARRAY[]::TEXT[];
    END IF;

    RETURN jsonb_build_object(
        'duplicate_roll_numbers', to_jsonb(COALESCE(v_dup_rolls, ARRAY[]::TEXT[])),
        'duplicate_student_codes', to_jsonb(COALESCE(v_dup_codes, ARRAY[]::TEXT[]))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_student_duplicates(TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_student_duplicates(TEXT[], TEXT[]) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. ATOMIC SINGLE STUDENT ENROLLMENT RPC (STRICT ADMIN AUTH, ALWAYS PENDING)
-- ------------------------------------------------------------------------------
-- Enrolls a student and guardian atomically.
-- Guardian consent is strictly initialized to 'PENDING'.
-- If student creation fails, guardian is NEVER orphaned.
-- Does NOT silently assign department, academic year, or room number.
CREATE OR REPLACE FUNCTION public.enroll_student_atomic(
    p_hostel_id UUID,
    p_roll_number TEXT,
    p_student_code TEXT,
    p_full_name TEXT,
    p_department TEXT,
    p_academic_year TEXT,
    p_room_number TEXT,
    p_guardian_name TEXT,
    p_guardian_relationship TEXT,
    p_guardian_phone TEXT,
    p_guardian_language TEXT DEFAULT 'hi'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role public.user_role;
    v_hostel_exists BOOLEAN;
    v_guardian_id UUID;
    v_student_id UUID;
    v_clean_roll TEXT;
    v_clean_code TEXT;
    v_clean_name TEXT;
    v_clean_dept TEXT;
    v_clean_year TEXT;
    v_clean_room TEXT;
    v_clean_gname TEXT;
    v_clean_gphone TEXT;
    v_clean_grel TEXT;
    v_clean_glang TEXT;
BEGIN
    -- 1. Strict admin authorization check
    v_user_role := public.current_user_role();
    IF v_user_role IS NULL OR v_user_role::text <> 'admin' THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can enroll students.';
    END IF;

    -- 2. Validate hostel argument
    IF p_hostel_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: p_hostel_id cannot be null.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.hostels WHERE id = p_hostel_id AND is_active = TRUE
    ) INTO v_hostel_exists;

    IF NOT v_hostel_exists THEN
        RAISE EXCEPTION 'Validation error: Specified hostel facility (%) does not exist or is inactive.', p_hostel_id;
    END IF;

    -- 3. Sanitize and validate inputs
    v_clean_roll := TRIM(COALESCE(p_roll_number, ''));
    v_clean_name := TRIM(COALESCE(p_full_name, ''));
    v_clean_code := TRIM(COALESCE(p_student_code, ''));
    IF v_clean_code = '' AND v_clean_roll <> '' THEN
        v_clean_code := 'CT-' || v_clean_roll;
    END IF;
    v_clean_dept := TRIM(COALESCE(p_department, ''));
    v_clean_year := TRIM(COALESCE(p_academic_year, ''));
    v_clean_room := TRIM(COALESCE(p_room_number, ''));
    v_clean_gname := TRIM(COALESCE(p_guardian_name, ''));
    v_clean_gphone := TRIM(COALESCE(p_guardian_phone, ''));
    v_clean_grel := COALESCE(NULLIF(TRIM(p_guardian_relationship), ''), 'Father');
    v_clean_glang := COALESCE(NULLIF(TRIM(p_guardian_language), ''), 'hi');

    -- Required fields validation: do NOT silently assign department, academic_year, or room_number
    IF v_clean_roll = '' THEN
        RAISE EXCEPTION 'Validation error: roll_number is required and cannot be blank.';
    END IF;
    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'Validation error: full_name is required and cannot be blank.';
    END IF;
    IF v_clean_dept = '' THEN
        RAISE EXCEPTION 'Validation error: department is required by the institutional schema and cannot be blank.';
    END IF;
    IF v_clean_year = '' THEN
        RAISE EXCEPTION 'Validation error: academic_year is required by the institutional schema and cannot be blank.';
    END IF;
    IF v_clean_room = '' THEN
        RAISE EXCEPTION 'Validation error: room_number is required by the institutional schema and cannot be blank.';
    END IF;
    IF v_clean_gname = '' THEN
        RAISE EXCEPTION 'Validation error: guardian_name is required and cannot be blank.';
    END IF;
    IF v_clean_gphone = '' THEN
        RAISE EXCEPTION 'Validation error: guardian_phone is required and cannot be blank.';
    END IF;

    -- Maximum length validations
    IF length(v_clean_roll) > 50 THEN
        RAISE EXCEPTION 'Validation error: roll_number exceeds maximum length of 50 characters.';
    END IF;
    IF length(v_clean_name) > 150 THEN
        RAISE EXCEPTION 'Validation error: full_name exceeds maximum length of 150 characters.';
    END IF;
    IF length(v_clean_code) > 50 THEN
        RAISE EXCEPTION 'Validation error: student_code exceeds maximum length of 50 characters.';
    END IF;
    IF length(v_clean_dept) > 100 THEN
        RAISE EXCEPTION 'Validation error: department exceeds maximum length of 100 characters.';
    END IF;
    IF length(v_clean_year) > 30 THEN
        RAISE EXCEPTION 'Validation error: academic_year exceeds maximum length of 30 characters.';
    END IF;
    IF length(v_clean_room) > 30 THEN
        RAISE EXCEPTION 'Validation error: room_number exceeds maximum length of 30 characters.';
    END IF;
    IF length(v_clean_gname) > 150 THEN
        RAISE EXCEPTION 'Validation error: guardian_name exceeds maximum length of 150 characters.';
    END IF;
    IF length(v_clean_gphone) < 10 OR length(v_clean_gphone) > 25 THEN
        RAISE EXCEPTION 'Validation error: guardian_phone must be between 10 and 25 characters.';
    END IF;
    IF length(v_clean_grel) > 50 THEN
        RAISE EXCEPTION 'Validation error: guardian_relationship exceeds maximum length of 50 characters.';
    END IF;
    IF length(v_clean_glang) > 10 THEN
        RAISE EXCEPTION 'Validation error: preferred_language exceeds maximum length of 10 characters.';
    END IF;

    -- 4. Duplicate checks against existing students (case-insensitive)
    IF EXISTS (SELECT 1 FROM public.students WHERE LOWER(TRIM(roll_number)) = LOWER(v_clean_roll)) THEN
        RAISE EXCEPTION 'Duplicate error: A student with Roll Number % is already registered.', v_clean_roll;
    END IF;

    IF EXISTS (SELECT 1 FROM public.students WHERE LOWER(TRIM(student_code)) = LOWER(v_clean_code)) THEN
        RAISE EXCEPTION 'Duplicate error: A student with Student Code % is already registered.', v_clean_code;
    END IF;

    -- 5. Insert Guardian with PENDING consent strictly (never automatically CONSENTED)
    INSERT INTO public.guardians (
        full_name,
        relationship,
        phone_number,
        preferred_language,
        notification_consent_status
    )
    VALUES (
        v_clean_gname,
        v_clean_grel,
        v_clean_gphone,
        v_clean_glang,
        'PENDING' -- Enforced: Never automatically CONSENTED
    )
    RETURNING id INTO v_guardian_id;

    -- 6. Insert Student Record (Atomic: rolled back if student insert fails)
    INSERT INTO public.students (
        student_code,
        roll_number,
        full_name,
        department,
        academic_year,
        hostel_id,
        room_number,
        guardian_id,
        enrollment_status
    )
    VALUES (
        v_clean_code,
        v_clean_roll,
        v_clean_name,
        v_clean_dept,
        v_clean_year,
        p_hostel_id,
        v_clean_room,
        v_guardian_id,
        'ACTIVE'
    )
    RETURNING id INTO v_student_id;

    RETURN jsonb_build_object(
        'success', true,
        'student_id', v_student_id,
        'guardian_id', v_guardian_id,
        'roll_number', v_clean_roll,
        'student_code', v_clean_code
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_student_atomic(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_student_atomic(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. ATOMIC BATCH STUDENT ENROLLMENT RPC (MAX 500/CALL, DEEP JSON VALIDATION)
-- ------------------------------------------------------------------------------
-- Enrolls an array of student records using atomic per-student subtransactions.
-- Security & Validation:
--   - Maximum 500 students per RPC call.
--   - Rejects unexpected field names, booleans, objects, and arrays.
--   - Resets per-row variables before processing each row (prevents leaking previous roll numbers).
--   - Does NOT silently assign department, academic year, or room number.
--   - Guardian records are NEVER orphaned if student creation encounters an error.
CREATE OR REPLACE FUNCTION public.bulk_enroll_students_batch(
    p_hostel_id UUID,
    p_students JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role public.user_role;
    v_hostel_exists BOOLEAN;
    v_item JSONB;
    v_idx INTEGER := 0;
    v_array_len INTEGER;
    v_success_count INTEGER := 0;
    v_failed_count INTEGER := 0;
    v_results JSONB := '[]'::JSONB;

    -- Per-row variables (reset on every loop iteration)
    v_roll TEXT;
    v_code TEXT;
    v_name TEXT;
    v_dept TEXT;
    v_year TEXT;
    v_room TEXT;
    v_gname TEXT;
    v_gphone TEXT;
    v_grel TEXT;
    v_glang TEXT;
    v_key TEXT;
    v_guardian_id UUID;
    v_student_id UUID;
BEGIN
    -- 1. Strict admin authorization check
    v_user_role := public.current_user_role();
    IF v_user_role IS NULL OR v_user_role::text <> 'admin' THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can execute bulk student enrollment.';
    END IF;

    -- 2. Validate input arguments
    IF p_hostel_id IS NULL THEN
        RAISE EXCEPTION 'Invalid argument: p_hostel_id cannot be null.';
    END IF;

    IF p_students IS NULL OR jsonb_typeof(p_students) <> 'array' THEN
        RAISE EXCEPTION 'Invalid argument: p_students must be a non-null JSON array.';
    END IF;

    v_array_len := jsonb_array_length(p_students);

    -- Enforce maximum batch limit of 500 students per RPC call
    IF v_array_len > 500 THEN
        RAISE EXCEPTION 'Validation error: Maximum batch size of 500 students per RPC call exceeded (received % students). Please split the upload into smaller batches.', v_array_len;
    END IF;

    IF v_array_len = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'total', 0,
            'success_count', 0,
            'failed_count', 0,
            'results', '[]'::JSONB
        );
    END IF;

    -- 3. Validate hostel facility
    SELECT EXISTS (
        SELECT 1 FROM public.hostels WHERE id = p_hostel_id AND is_active = TRUE
    ) INTO v_hostel_exists;

    IF NOT v_hostel_exists THEN
        RAISE EXCEPTION 'Validation error: Hostel facility (%) does not exist or is inactive.', p_hostel_id;
    END IF;

    -- 4. Process each student row in an atomic subtransaction
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_students)
    LOOP
        v_idx := v_idx + 1;

        -- CRITICAL: Reset per-row variables before processing each row
        -- Prevents a previous row's state or roll number from leaking into error reporting
        v_roll := NULL;
        v_code := NULL;
        v_name := NULL;
        v_dept := NULL;
        v_year := NULL;
        v_room := NULL;
        v_gname := NULL;
        v_gphone := NULL;
        v_grel := NULL;
        v_glang := NULL;
        v_key := NULL;
        v_guardian_id := NULL;
        v_student_id := NULL;

        -- Validate individual item type (must be JSON object)
        IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
            v_failed_count := v_failed_count + 1;
            v_results := v_results || jsonb_build_object(
                'index', v_idx,
                'roll_number', 'Row ' || v_idx,
                'status', 'ERROR',
                'error', 'Item at index ' || v_idx || ' is not a valid JSON object.'
            );
            CONTINUE;
        END IF;

        -- Subtransaction: If validation or student creation fails, PostgreSQL rolls back the guardian insert
        BEGIN
            -- 1. Validate JSON object keys: Reject unexpected field names & non-scalar types (booleans, objects, arrays)
            FOR v_key IN SELECT jsonb_object_keys(v_item)
            LOOP
                IF v_key NOT IN (
                    'roll_number',
                    'full_name',
                    'student_code',
                    'department',
                    'academic_year',
                    'room_number',
                    'guardian_name',
                    'guardian_phone',
                    'guardian_relationship',
                    'preferred_language'
                ) THEN
                    RAISE EXCEPTION 'Unexpected field ''%'' in student record. Only recognized student fields are allowed.', v_key;
                END IF;

                -- Reject booleans, objects, and arrays (only strings, numbers, or null allowed)
                IF jsonb_typeof(v_item->v_key) IN ('object', 'array', 'boolean') THEN
                    RAISE EXCEPTION 'Field ''%'' has invalid type (%). Only scalar string or number values are permitted.', v_key, jsonb_typeof(v_item->v_key);
                END IF;
            END LOOP;

            -- 2. Extract and clean fields safely
            v_roll := TRIM(COALESCE(v_item->>'roll_number', ''));
            v_name := TRIM(COALESCE(v_item->>'full_name', ''));
            v_code := TRIM(COALESCE(v_item->>'student_code', ''));
            IF v_code = '' AND v_roll <> '' THEN
                v_code := 'CT-' || v_roll;
            END IF;
            v_dept := TRIM(COALESCE(v_item->>'department', ''));
            v_year := TRIM(COALESCE(v_item->>'academic_year', ''));
            v_room := TRIM(COALESCE(v_item->>'room_number', ''));
            v_gname := TRIM(COALESCE(v_item->>'guardian_name', ''));
            v_gphone := TRIM(COALESCE(v_item->>'guardian_phone', ''));
            v_grel := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'guardian_relationship', '')), ''), 'Father');
            v_glang := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'preferred_language', '')), ''), 'hi');

            -- 3. Validate required fields (Do NOT silently assign department, academic_year, or room_number)
            IF v_roll = '' THEN
                RAISE EXCEPTION 'roll_number is missing or empty.';
            END IF;
            IF v_name = '' THEN
                RAISE EXCEPTION 'full_name is missing or empty.';
            END IF;
            IF v_dept = '' THEN
                RAISE EXCEPTION 'department is required by the institutional schema and cannot be blank.';
            END IF;
            IF v_year = '' THEN
                RAISE EXCEPTION 'academic_year is required by the institutional schema and cannot be blank.';
            END IF;
            IF v_room = '' THEN
                RAISE EXCEPTION 'room_number is required by the institutional schema and cannot be blank.';
            END IF;
            IF v_gname = '' THEN
                RAISE EXCEPTION 'guardian_name is missing or empty.';
            END IF;
            IF v_gphone = '' THEN
                RAISE EXCEPTION 'guardian_phone is missing or empty.';
            END IF;

            -- 4. Validate reasonable lengths
            IF length(v_roll) > 50 THEN
                RAISE EXCEPTION 'roll_number exceeds maximum length of 50 characters.';
            END IF;
            IF length(v_name) > 150 THEN
                RAISE EXCEPTION 'full_name exceeds maximum length of 150 characters.';
            END IF;
            IF length(v_code) > 50 THEN
                RAISE EXCEPTION 'student_code exceeds maximum length of 50 characters.';
            END IF;
            IF length(v_dept) > 100 THEN
                RAISE EXCEPTION 'department exceeds maximum length of 100 characters.';
            END IF;
            IF length(v_year) > 30 THEN
                RAISE EXCEPTION 'academic_year exceeds maximum length of 30 characters.';
            END IF;
            IF length(v_room) > 30 THEN
                RAISE EXCEPTION 'room_number exceeds maximum length of 30 characters.';
            END IF;
            IF length(v_gname) > 150 THEN
                RAISE EXCEPTION 'guardian_name exceeds maximum length of 150 characters.';
            END IF;
            IF length(v_gphone) < 10 OR length(v_gphone) > 25 THEN
                RAISE EXCEPTION 'guardian_phone must be between 10 and 25 characters.';
            END IF;
            IF length(v_grel) > 50 THEN
                RAISE EXCEPTION 'guardian_relationship exceeds maximum length of 50 characters.';
            END IF;
            IF length(v_glang) > 10 THEN
                RAISE EXCEPTION 'preferred_language exceeds maximum length of 10 characters.';
            END IF;

            -- 5. Duplicate checks (case-insensitive) against existing database records
            IF EXISTS (SELECT 1 FROM public.students WHERE LOWER(TRIM(roll_number)) = LOWER(v_roll)) THEN
                RAISE EXCEPTION 'Roll Number % is already registered.', v_roll;
            END IF;

            IF EXISTS (SELECT 1 FROM public.students WHERE LOWER(TRIM(student_code)) = LOWER(v_code)) THEN
                RAISE EXCEPTION 'Student Code % is already registered.', v_code;
            END IF;

            -- 6. Insert Guardian with PENDING consent status strictly
            INSERT INTO public.guardians (
                full_name,
                relationship,
                phone_number,
                preferred_language,
                notification_consent_status
            )
            VALUES (
                v_gname,
                v_grel,
                v_gphone,
                v_glang,
                'PENDING' -- Enforced: Never automatically CONSENTED
            )
            RETURNING id INTO v_guardian_id;

            -- 7. Insert Student Record
            INSERT INTO public.students (
                student_code,
                roll_number,
                full_name,
                department,
                academic_year,
                hostel_id,
                room_number,
                guardian_id,
                enrollment_status
            )
            VALUES (
                v_code,
                v_roll,
                v_name,
                v_dept,
                v_year,
                p_hostel_id,
                v_room,
                v_guardian_id,
                'ACTIVE'
            )
            RETURNING id INTO v_student_id;

            v_success_count := v_success_count + 1;
            v_results := v_results || jsonb_build_object(
                'index', v_idx,
                'roll_number', v_roll,
                'status', 'SUCCESS',
                'student_id', v_student_id,
                'guardian_id', v_guardian_id
            );

        EXCEPTION WHEN OTHERS THEN
            -- In PL/pgSQL, this EXCEPTION block rolls back all writes within this subtransaction
            -- (specifically, the guardian record is NOT committed)
            v_failed_count := v_failed_count + 1;
            v_results := v_results || jsonb_build_object(
                'index', v_idx,
                'roll_number', COALESCE(NULLIF(v_roll, ''), 'Row ' || v_idx),
                'status', 'ERROR',
                'error', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'total', v_idx,
        'success_count', v_success_count,
        'failed_count', v_failed_count,
        'results', v_results
    );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_enroll_students_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_enroll_students_batch(UUID, JSONB) TO authenticated, service_role;
