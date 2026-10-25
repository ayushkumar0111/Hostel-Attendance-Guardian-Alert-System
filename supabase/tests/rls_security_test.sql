-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Automated Row Level Security (RLS), Scoping & Business Logic Test Suite
-- File: supabase/tests/rls_security_test.sql
-- ==============================================================================
-- INSTRUCTIONS:
-- Run this script in your Supabase SQL Editor AFTER running the initial migration.
-- It executes within a transaction and ROLLBACKS at the end so it leaves ZERO
-- junk/test data in your database.
-- ==============================================================================

BEGIN;

-- Temporarily drop the auth.users foreign key inside the transaction so that
-- mock test users can be simulated without writing dummy accounts into auth.users.
-- PostgreSQL transactions are fully atomic; the constraint is restored on ROLLBACK.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $$
DECLARE
    -- Mock test UUIDs
    test_student_a_auth_id UUID := '11111111-1111-1111-1111-111111111111';
    test_student_b_auth_id UUID := '22222222-2222-2222-2222-222222222222';
    test_warden_auth_id    UUID := '33333333-3333-3333-3333-333333333333';
    test_hostel_a_id       UUID := '44444444-4444-4444-4444-444444444444';
    test_hostel_b_id       UUID := '44444444-4444-4444-4444-444444444445';
    test_guardian_a_id     UUID := '55555555-5555-5555-5555-555555555555';
    test_guardian_b_id     UUID := '66666666-6666-6666-6666-666666666666';
    test_student_a_id      UUID := '77777777-7777-7777-7777-777777777777';
    test_student_b_id      UUID := '88888888-8888-8888-8888-888888888888';
    test_room_a_id         UUID := '99999999-9999-9999-9999-999999999991';
    test_room_b_id         UUID := '99999999-9999-9999-9999-999999999992';
    test_sched_id          UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    test_rec_id            UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    query_count INTEGER;
    exception_caught BOOLEAN := FALSE;
BEGIN
    RAISE NOTICE '=====================================================';
    RAISE NOTICE 'Starting Automated CT Hostel Security & RLS Suite';
    RAISE NOTICE '=====================================================';

    -- --------------------------------------------------------------------------
    -- 0. SETUP TEMPORARY TEST DATA (As database service_role)
    -- --------------------------------------------------------------------------
    INSERT INTO public.hostels (id, name, warden_contact)
    VALUES 
        (test_hostel_a_id, 'CTIEMT Test Hostel Alpha', '+919876543210'),
        (test_hostel_b_id, 'CTIEMT Test Hostel Beta',  '+919876543211');

    INSERT INTO public.profiles (id, full_name, role, is_active)
    VALUES 
        (test_student_a_auth_id, 'Student A', 'student', TRUE),
        (test_student_b_auth_id, 'Student B', 'student', TRUE),
        (test_warden_auth_id,    'Warden Officer', 'warden', TRUE);

    -- Assign Warden specifically to Hostel Alpha
    INSERT INTO public.warden_hostel_assignments (warden_profile_id, hostel_id, is_primary)
    VALUES (test_warden_auth_id, test_hostel_a_id, TRUE);

    INSERT INTO public.guardians (id, full_name, relationship, phone_number)
    VALUES 
        (test_guardian_a_id, 'Guardian A (Father)', 'Father', '+919999900001'),
        (test_guardian_b_id, 'Guardian B (Mother)', 'Mother', '+919999900002');

    -- Student A is in Hostel Alpha (assigned to Warden); Student B is in Hostel Beta (different hostel)
    INSERT INTO public.students (id, student_code, roll_number, full_name, department, academic_year, hostel_id, room_number, profile_id, guardian_id)
    VALUES 
        (test_student_a_id, 'CT-A1', 'ROLL-101', 'Student A', 'CSE', '2023-2027', test_hostel_a_id, '101', test_student_a_auth_id, test_guardian_a_id),
        (test_student_b_id, 'CT-B2', 'ROLL-102', 'Student B', 'ECE', '2023-2027', test_hostel_b_id, '102', test_student_b_auth_id, test_guardian_b_id);

    INSERT INTO public.hostel_rooms (id, hostel_id, room_number, capacity)
    VALUES 
        (test_room_a_id, test_hostel_a_id, '101', 2),
        (test_room_b_id, test_hostel_b_id, '102', 2);

    INSERT INTO public.room_allocations (student_id, room_id, bed_label, status)
    VALUES 
        (test_student_a_id, test_room_a_id, 'Bed A', 'ACTIVE'),
        (test_student_b_id, test_room_b_id, 'Bed B', 'ACTIVE');

    INSERT INTO public.attendance_schedules (id, name, hostel_id, start_time, deadline_time)
    VALUES (test_sched_id, 'Morning Roll Call', test_hostel_a_id, '07:30', '08:00');

    INSERT INTO public.attendance_records (id, student_id, schedule_id, attendance_date, status)
    VALUES (test_rec_id, test_student_a_id, test_sched_id, CURRENT_DATE, 'PENDING_VERIFICATION');

    -- --------------------------------------------------------------------------
    -- TEST 1: ANONYMOUS ACCESS (PUBLIC INTERNET) IS COMPLETELY BLOCKED
    -- --------------------------------------------------------------------------
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" = '{}';

    SELECT count(*) INTO query_count FROM public.profiles;
    IF query_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: Anon can read profiles!'; END IF;

    SELECT count(*) INTO query_count FROM public.guardians;
    IF query_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: Anon can read guardians!'; END IF;

    SELECT count(*) INTO query_count FROM public.students;
    IF query_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: Anon can read students!'; END IF;

    SELECT count(*) INTO query_count FROM public.attendance_records;
    IF query_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: Anon can read attendance!'; END IF;

    SELECT count(*) INTO query_count FROM public.room_allocations;
    IF query_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: Anon can read room allocations!'; END IF;

    RAISE NOTICE 'TEST 1 PASSED: Anonymous public role has 0 access to all private tables.';

    -- --------------------------------------------------------------------------
    -- TEST 2: STUDENT PRIVACY ISOLATION (STUDENT A CANNOT SEE STUDENT B)
    -- --------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    EXECUTE format('SET LOCAL "request.jwt.claims" = ''{"sub": "%s", "role": "authenticated"}''', test_student_a_auth_id);

    -- Check Student A only sees self in students table
    SELECT count(*) INTO query_count FROM public.students;
    IF query_count <> 1 THEN 
        RAISE EXCEPTION 'SECURITY FAIL: Student A saw % students instead of exactly 1 self record!', query_count; 
    END IF;

    -- Check Student A only sees their own guardian, NOT Student B's guardian
    SELECT count(*) INTO query_count FROM public.guardians;
    IF query_count <> 1 THEN 
        RAISE EXCEPTION 'SECURITY FAIL: Student A accessed other guardians (Count: %)!', query_count; 
    END IF;

    -- Verify the guardian returned is indeed Guardian A
    SELECT count(*) INTO query_count FROM public.guardians WHERE id = test_guardian_a_id;
    IF query_count <> 1 THEN
        RAISE EXCEPTION 'SECURITY FAIL: Student A could not access their own linked guardian!';
    END IF;

    -- Check Student A only sees their own room allocation
    SELECT count(*) INTO query_count FROM public.room_allocations;
    IF query_count <> 1 THEN
        RAISE EXCEPTION 'SECURITY FAIL: Student A saw other student room allocations (Count: %)!', query_count;
    END IF;

    RAISE NOTICE 'TEST 2 PASSED: Student can only view their own record, own guardian, and own room allocation.';

    -- --------------------------------------------------------------------------
    -- TEST 3: LEAVE SELF-APPROVAL TAMPERING IS PREVENTED
    -- --------------------------------------------------------------------------
    exception_caught := FALSE;
    BEGIN
        INSERT INTO public.leave_requests (student_id, start_date, end_date, reason_category, approval_status)
        VALUES (test_student_a_id, CURRENT_DATE, CURRENT_DATE + 2, 'Medical', 'APPROVED');
    EXCEPTION WHEN OTHERS THEN
        exception_caught := TRUE;
    END;

    IF NOT exception_caught THEN
        RAISE EXCEPTION 'SECURITY FAIL: Student was able to insert a pre-approved leave request!';
    END IF;

    -- Valid pending submission should succeed
    INSERT INTO public.leave_requests (student_id, start_date, end_date, reason_category, approval_status)
    VALUES (test_student_a_id, CURRENT_DATE, CURRENT_DATE + 2, 'Medical', 'PENDING');

    RAISE NOTICE 'TEST 3 PASSED: Student self-approval of leaves is strictly blocked.';

    -- --------------------------------------------------------------------------
    -- TEST 4: PRIVILEGE SELF-ESCALATION IS PREVENTED BY TRIGGER
    -- --------------------------------------------------------------------------
    exception_caught := FALSE;
    BEGIN
        UPDATE public.profiles
        SET role = 'admin'
        WHERE id = test_student_a_auth_id;
    EXCEPTION WHEN OTHERS THEN
        exception_caught := TRUE;
    END;

    IF NOT exception_caught THEN
        RAISE EXCEPTION 'SECURITY FAIL: Student was able to update their own role to admin!';
    END IF;

    RAISE NOTICE 'TEST 4 PASSED: Student attempt to escalate role to admin was blocked by trigger.';

    -- --------------------------------------------------------------------------
    -- TEST 5: WARDEN HOSTEL SCOPING ENFORCEMENT
    -- --------------------------------------------------------------------------
    EXECUTE format('SET LOCAL "request.jwt.claims" = ''{"sub": "%s", "role": "authenticated"}''', test_warden_auth_id);

    -- Warden is assigned to Hostel Alpha, so should only see Student A (Hostel Alpha), NOT Student B (Hostel Beta)
    SELECT count(*) INTO query_count FROM public.students;
    IF query_count <> 1 THEN
        RAISE EXCEPTION 'SECURITY FAIL: Warden accessed students from unassigned hostels (Count: % instead of 1)!', query_count;
    END IF;

    -- Warden can only see Guardian A (from assigned hostel student)
    SELECT count(*) INTO query_count FROM public.guardians;
    IF query_count <> 1 THEN
        RAISE EXCEPTION 'SECURITY FAIL: Warden accessed guardians from unassigned hostels (Count: % instead of 1)!', query_count;
    END IF;

    RAISE NOTICE 'TEST 5 PASSED: Warden access is strictly scoped to assigned hostels only.';

    -- --------------------------------------------------------------------------
    -- TEST 6: ATTENDANCE CORRECTION AUDIT TRAIL AUTOMATION
    -- --------------------------------------------------------------------------
    -- Update attendance record as Warden with reason
    UPDATE public.attendance_records
    SET status = 'EXCUSED',
        review_reason = 'Medical certificate verified by warden'
    WHERE id = test_rec_id;

    -- Verify that the trigger automatically created an attendance_corrections audit record
    SELECT count(*) INTO query_count 
    FROM public.attendance_corrections
    WHERE attendance_record_id = test_rec_id 
      AND previous_status = 'PENDING_VERIFICATION' 
      AND new_status = 'EXCUSED';

    IF query_count <> 1 THEN
        RAISE EXCEPTION 'SECURITY FAIL: Automated attendance correction audit log was not created!';
    END IF;

    RAISE NOTICE 'TEST 6 PASSED: Automated attendance correction audit trail recorded successfully.';

    RAISE NOTICE '=====================================================';
    RAISE NOTICE 'ALL 6 SECURITY & SCOPING TESTS PASSED SUCCESSFULLY!';
    RAISE NOTICE '=====================================================';
END $$;

-- Rollback entire test transaction so no test records remain
ROLLBACK;
