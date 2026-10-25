# CT GROUP OF INSTITUTIONS
## Hostel Attendance & Guardian Alert System
### Phase 1: Foundation Release

**Built by:** Ayush Kumar  
**Developed by:** CT (CT Group of Institutions)  
**Institution:** CT GROUP OF INSTITUTIONS  
**Platform:** Progressive Web App (PWA) + React + TypeScript + Vite + Supabase  

---

## 1. Overview & Architecture

The **CT Hostel Attendance & Guardian Alert System** is an institutional attendance management and guardian escalation platform designed to replace paper roll calls, eliminate proxy attendance, and immediately alert parents when a student is unconfirmed absent.

### Architecture Highlights:
* **Frontend:** Mobile-first Progressive Web App (PWA) powered by React 18, TypeScript, Vite, and Tailwind CSS.
* **Authentication & Role-Based Access Control (RBAC):** Supabase Auth with PostgreSQL Row Level Security (RLS) policies distinguishing `student`, `warden`, and `admin` roles.
* **Database & Migrations:** PostgreSQL schema version-controlled in `supabase/migrations/` with tables for profiles, hostels, guardians, students, schedules, attendance records, leaves, alert logs, and audit trails.
* **PWA & Offline Strategy:** Web App Manifest with CT branding and Service Worker with static asset caching. In accordance with safety policies (PRD FR-14), attendance submission mandates real server confirmation and is never falsely cached as submitted.
* **Safety & Integrity Guarantee:** Zero fake mock users, zero simulated phone calls, and zero fake attendance records.

---

## 2. Separate Role Dashboards

### 1. Student Dashboard
* **Student Identity Card:** Displays registered student details, roll number, hostel room, and masked guardian contact for privacy.
* **Attendance Check-In Portal:** Active roll-call window tracker (Morning / Curfew), countdown to deadline, and server-confirmed check-in submission.
* **Leave Management:** Official student leave application modal (Medical, Home Visit, Academic, Emergency).
* **Attendance History Log:** Searchable log of past check-ins with verification badges.

### 2. Warden Operations Desk
* **Daily Attendance Tracker:** Filterable by date with live counts for Present, Absent, Pending Verification, and Approved Leave.
* **Auditable Attendance Corrections (FR-05):** Warden manual correction dialog requiring mandatory justification for compliance and audit logging.
* **Student Roster:** Searchable directory by room, roll number, and department.
* **CSV Roster Import Specification (FR-02):** Validated template schema for importing student batches.
* **Leave Review:** Approve or reject pending student leave requests.
* **Guardian Alert Queue:** Status monitor for outbound notifications and warden bridge transfer.

### 3. Administrator Console
* **Campus Facilities & Geofences:** Manage hostel units, GPS coordinates, and geofence tolerance radiuses.
* **Attendance Windows:** Configure daily roll-call schedules, deadlines, and grace periods.
* **Escalation Protocol Rules:** Configure absence trigger thresholds and notification templates.
* **Staff Roster:** Manage warden and admin accounts.
* **Append-Only Audit Trail:** Central governance log for administrative actions.

---

## 3. Getting Started on Windows

### Prerequisites
* Node.js (v18+)

### Step 1: Install Dependencies
> **Important Note for Windows PowerShell users:** If PowerShell script execution policy blocks `npm`, run with `npm.cmd`:
```powershell
npm.cmd install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Update your Supabase credentials in `.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Step 3: Run Database Migrations
Apply the initial schema from:
`supabase/migrations/20261021000001_initial_ct_hostel_schema.sql`
You can run this directly in the Supabase Web Dashboard SQL Editor.

### Step 4: Start the Local Development Server
```powershell
npm.cmd run dev
```
Open your browser at: `http://localhost:5173`

### Step 5: Build for Production
```powershell
npm.cmd run build
```
Preview production build:
```powershell
npm.cmd run preview
```
