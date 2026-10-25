# CT GROUP OF INSTITUTIONS
## Hostel Attendance & Guardian Alert System
### Supabase Database Architecture & Security Guide

**Project:** CT Group of Institutions – Hostel Attendance & Guardian Alert System  
**Developed by:** CT  
**Built by:** Ayush Kumar  

---

### 1. Database Schema & Migration Overview
* **Migration File:** [`supabase/migrations/20261021000001_initial_ct_hostel_schema.sql`](file:///c:/Users/ayush/OneDrive/Desktop/my%20project/supabase/migrations/20261021000001_initial_ct_hostel_schema.sql)
* **Total Tables (16 Entities):**
  1. `profiles` — User profiles linked directly to `auth.users` with strict role enforcement.
  2. `hostels` — Institutional campus hostel units with GPS geofence definitions.
  3. `guardians` — Registered emergency contacts with relationship and notification consent.
  4. `students` — Academic and residential student roster linked to profiles, hostels, and guardians.
  5. `attendance_schedules` — Configurable roll-call and night curfew check windows.
  6. `attendance_records` — Daily student attendance check-ins with status and verification flags.
  7. `verification_submissions` — Photo storage path, device GPS coordinates, and accuracy distance metadata.
  8. `leave_requests` — Institutional student leave management and approval records.
  9. `notification_events` — Outbound SMS and alert queue logs.
  10. `call_sessions` — Automated telephony session logs and DTMF transfer records.
  11. `audit_logs` — Immutable audit trail for system governance.
  12. `hostel_blocks` — Campus hostel wings/blocks with gender designations and floor counts.
  13. `warden_hostel_assignments` — Explicit mapping binding wardens to authorized hostels.
  14. `hostel_rooms` — Room inventory with room types, floor numbers, capacities, and live occupancy counts.
  15. `room_allocations` — Tenancy and bed assignment records for students.
  16. `attendance_corrections` — Immutable audit trail recording attendance overrides and justifications.

* **Custom ENUM Types (11 ENUMs):**
  * `user_role` ('student', 'warden', 'admin')
  * `attendance_status` ('PRESENT', 'ABSENT', 'APPROVED_LEAVE', 'PENDING_VERIFICATION', 'LATE_SUBMISSION', 'EXCUSED', 'CORRECTED')
  * `verification_status` ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'FAILED', 'FLAGGED')
  * `leave_approval_status` ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
  * `notification_channel` ('sms', 'voice')
  * `notification_status` ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')
  * `call_session_status` ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER')
  * `room_type` ('SINGLE', 'DOUBLE', 'TRIPLE', 'DORMITORY')
  * `room_occupancy_status` ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'RESERVED')
  * `allocation_status` ('ACTIVE', 'VACATED', 'TRANSFERRED', 'CANCELLED')
  * `correction_type` ('MANUAL_OVERRIDE', 'MEDICAL_EXCUSE', 'SYSTEM_GLITCH', 'LATE_VERIFIED', 'OFFICIAL_DUTY')

---

### 2. Row Level Security (RLS) & Scope Hardening
* **100% Coverage:** RLS is enabled on all 16 tables.
* **Student Privacy:** Students can only view their own student roster record, their own linked guardian, their own room allocation, their own attendance records, and their own leave requests.
* **Warden Hostel Scoping:** Using the security helper function `can_warden_access_hostel(hostel_id)`, wardens only access students, guardians, attendance records, leaves, and rooms belonging to their assigned hostels.
* **Role Escalation Protection:**
  - `handle_new_user()` trigger enforces `student` on all public self-registrations.
  - `protect_profile_role()` trigger blocks non-admins from changing roles or account activation statuses.
* **Automated Business Logic Triggers:**
  - `trg_log_attendance_correction`: Automatically creates an immutable audit row in `attendance_corrections` when an attendance record status is modified.
  - `trg_sync_room_occupancy`: Automatically recalculates active occupants and updates room occupancy status (`AVAILABLE` vs `OCCUPIED`).

---

### 3. How to Apply the Migration in Supabase

1. Open your project at the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to the **SQL Editor** tab (`>_` icon on the left sidebar).
3. Click **+ New Query**.
4. Open [`supabase/migrations/20261021000001_initial_ct_hostel_schema.sql`](file:///c:/Users/ayush/OneDrive/Desktop/my%20project/supabase/migrations/20261021000001_initial_ct_hostel_schema.sql) in your local editor, copy all text (`Ctrl` + `A`, `Ctrl` + `C`), and paste it into the query box.
5. Click **Run** (`Ctrl` + `Enter`).
6. Supabase will output: `Success. No rows returned`.
7. Refresh your app at `http://localhost:5173/` to see the green active database connection.

---

### 4. How to Bootstrap the First Institutional Administrator

By design, public registration can **never** grant the `admin` or `warden` role. To establish the initial administrator:

1. In the app (`http://localhost:5173/`), register an institutional account using your official email (e.g. `admin@ctgroup.in`). The database trigger will safely create the profile with `role = 'student'`.
2. Open the **SQL Editor** in your Supabase Dashboard and run this one-time promotion query:
   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE id = (
       SELECT id FROM auth.users WHERE email = 'admin@ctgroup.in'
   );
   ```
3. Refresh the app. The account now has full access to the **Central Administration Console**, where wardens and campus facilities can be configured.
