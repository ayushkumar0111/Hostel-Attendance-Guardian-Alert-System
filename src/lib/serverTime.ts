// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Time Synchronization & Asia/Kolkata Window Engine (Production Ready)
// Developed by CT | Built by Ayush Kumar
// Reliable server-synced time provider for tamper-resistant attendance
// ==============================================================================

import { AttendanceSchedule } from '../types/database';

export type AttendanceTimerStatus =
  | 'BEFORE_WINDOW'
  | 'WINDOW_OPEN'
  | 'WARNING_15M'
  | 'WARNING_5M'
  | 'EXPIRED';

export type StudentDisplayStatus =
  | 'Upcoming'
  | 'Attendance Open'
  | 'Present'
  | 'Absent'
  | 'Attendance Closed';

export interface CountdownState {
  status: AttendanceTimerStatus;
  displayStatus: StudentDisplayStatus;
  statusLabel: string;
  statusDescription: string;
  formatted: string; // HH:MM:SS
  hours: string;
  minutes: string;
  seconds: string;
  remainingMs: number;
  totalWindowMs: number;
  percentageElapsed: number;
  isWithinWindow: boolean;
  isExpired: boolean;
  isWarning15m: boolean;
  isUrgent5m: boolean;
  currentIstTimeStr: string;
  currentIstDateStr: string;
  windowStartTimeStr: string;
  windowDeadlineTimeStr: string;
  isServerSynced: boolean;
  simulatedTimeMs: number | null;
}

// In-memory server offset relative to client performance/wall-clock
let serverOffsetMs = 0;
let hasSyncedWithServer = false;
let isSyncInProgress = false;
let lastSyncTimestamp = 0;

/**
 * Initializes and synchronizes time with the Supabase HTTP server.
 * Uses HTTP Date header with half-roundtrip latency compensation.
 */
export async function syncServerTime(force = false): Promise<number> {
  const now = Date.now();
  if (!force && hasSyncedWithServer && now - lastSyncTimestamp < 45000) {
    return serverOffsetMs;
  }
  if (isSyncInProgress) return serverOffsetMs;

  isSyncInProgress = true;
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

    if (supabaseUrl) {
      const tStart = Date.now();
      const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: supabaseAnonKey },
        cache: 'no-store'
      });
      const tEnd = Date.now();
      const serverDateHeader = resp.headers.get('date');

      if (serverDateHeader) {
        const latency = Math.max(0, (tEnd - tStart) / 2);
        const serverTime = new Date(serverDateHeader).getTime() + latency;
        serverOffsetMs = serverTime - tEnd;
        hasSyncedWithServer = true;
        lastSyncTimestamp = Date.now();

        try {
          sessionStorage.setItem('ct_server_offset_ms', serverOffsetMs.toString());
        } catch {
          // Ignore storage restrictions
        }
      }
    }
  } catch (err) {
    console.warn('[serverTime] Live time sync fallback notice:', err);
    if (!hasSyncedWithServer) {
      try {
        const stored = sessionStorage.getItem('ct_server_offset_ms');
        if (stored) {
          serverOffsetMs = parseInt(stored, 10);
          hasSyncedWithServer = true;
        }
      } catch {
        // Fallback to local clock
      }
    }
  } finally {
    isSyncInProgress = false;
  }

  return serverOffsetMs;
}

// Auto-sync on page load and window focus
if (typeof window !== 'undefined') {
  syncServerTime();
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncServerTime(true);
    }
  });
  window.addEventListener('focus', () => {
    syncServerTime(false);
  });
}

/**
 * Returns the real synchronized timestamp (UTC milliseconds).
 * SECURITY: ALWAYS reflects actual server-synced time. Never modified by simulations.
 */
export function getRealSyncedTimestamp(): number {
  return Date.now() + serverOffsetMs;
}

/**
 * Returns the real current date in Asia/Kolkata timezone.
 * SECURITY: Used by FaceAttendanceModal and absenceDetection to ensure
 * attendance can NEVER be validated using simulated or tampered clocks.
 */
export function getSyncedIstDate(): Date {
  const ts = getRealSyncedTimestamp();
  const istStr = new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  return new Date(istStr);
}

/**
 * Returns the current date string in Asia/Kolkata timezone in 'YYYY-MM-DD' format.
 * Guarantees date matches the PostgreSQL database Asia/Kolkata date.
 */
export function getSyncedIstDateString(): string {
  const ist = getIstCalendarParts(getRealSyncedTimestamp());
  return `${ist.year}-${ist.month.toString().padStart(2, '0')}-${ist.day.toString().padStart(2, '0')}`;
}

/**
 * Alias for backward compatibility with existing components.
 */
export function getSyncedTimestamp(): number {
  return getRealSyncedTimestamp();
}

/**
 * Breaks down any timestamp into Asia/Kolkata calendar components.
 */
export function getIstCalendarParts(timestamp: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value])
  );

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10)
  };
}

/**
 * Converts a time string (e.g. "21:30" or "22:30:00") on a specific IST calendar date
 * to an absolute UTC timestamp (milliseconds).
 * Since Asia/Kolkata is strictly UTC+5:30 (no DST):
 * UTC Time = IST Time - 5h 30m.
 */
export function istTimeToUtcTimestamp(
  year: number,
  month: number,
  day: number,
  timeStr: string
): number {
  const [hStr, mStr, sStr = '0'] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const s = parseInt(sStr, 10);

  // Subtract 5 hours and 30 minutes to get UTC
  let utcH = h - 5;
  let utcM = m - 30;
  if (utcM < 0) {
    utcM += 60;
    utcH -= 1;
  }

  return Date.UTC(year, month - 1, day, utcH, utcM, s);
}

/**
 * Calculates the complete live countdown state for the evening roll-call window.
 * Default schedule: 09:30 PM (21:30:00) to 10:30 PM (22:30:00) Asia/Kolkata.
 *
 * @param schedule Optional active attendance schedule
 * @param simulationOffsetMs Optional simulation offset for authorized staff testing sandbox only
 * @param studentAttendanceStatus Optional today's attendance status ('PRESENT' | 'ABSENT' | null)
 */
export function calculateAttendanceCountdown(
  schedule?: AttendanceSchedule | null,
  simulationOffsetMs?: number | null,
  studentAttendanceStatus?: string | null
): CountdownState {
  const realTs = getRealSyncedTimestamp();
  const currentTs = simulationOffsetMs ? realTs + simulationOffsetMs : realTs;
  const ist = getIstCalendarParts(currentTs);

  const startTimeStr = schedule?.start_time || '21:30:00';
  const deadlineTimeStr = schedule?.deadline_time || '22:30:00';

  // Absolute UTC timestamps for start and deadline today in IST
  const windowStartTs = istTimeToUtcTimestamp(ist.year, ist.month, ist.day, startTimeStr);
  const windowDeadlineTs = istTimeToUtcTimestamp(ist.year, ist.month, ist.day, deadlineTimeStr);

  const totalWindowMs = Math.max(1000, windowDeadlineTs - windowStartTs);

  // 15-minute and 5-minute warning timestamps
  const warning15mTs = windowDeadlineTs - 15 * 60 * 1000;
  const warning5mTs = windowDeadlineTs - 5 * 60 * 1000;

  let status: AttendanceTimerStatus = 'WINDOW_OPEN';
  let displayStatus: StudentDisplayStatus = 'Attendance Open';
  let statusLabel = 'Attendance Window Open';
  let statusDescription = 'Evening hostel roll-call check-in is live. Submit face & location verification.';
  let remainingMs = 0;
  let isWithinWindow = false;
  let isExpired = false;
  let isWarning15m = false;
  let isUrgent5m = false;

  if (currentTs < windowStartTs) {
    status = 'BEFORE_WINDOW';
    displayStatus = 'Upcoming';
    statusLabel = 'Attendance Starts at 09:30 PM';
    statusDescription = 'Daily evening roll-call opens promptly at 09:30 PM IST. Return to your hostel room.';
    remainingMs = windowStartTs - currentTs;
  } else if (currentTs >= windowDeadlineTs) {
    status = 'EXPIRED';
    displayStatus = 'Attendance Closed';
    statusLabel = 'Attendance Window Closed';
    statusDescription = 'Attendance deadline expired at 10:30 PM IST. Unrecorded residents are processed for absence.';
    remainingMs = 0;
    isExpired = true;
  } else {
    // Inside active 21:30 - 22:30 window
    isWithinWindow = true;
    displayStatus = 'Attendance Open';
    remainingMs = windowDeadlineTs - currentTs;

    if (currentTs >= warning5mTs) {
      status = 'WARNING_5M';
      statusLabel = 'CRITICAL: Under 5 Minutes Remaining!';
      statusDescription = 'Curfew deadline is 10:30 PM IST. Complete face identity scan immediately to avoid absence alert!';
      isUrgent5m = true;
      isWarning15m = true;
    } else if (currentTs >= warning15mTs) {
      status = 'WARNING_15M';
      statusLabel = '15 Minutes Remaining';
      statusDescription = 'Attendance window closes soon at 10:30 PM IST. Please verify your room attendance.';
      isWarning15m = true;
    } else {
      status = 'WINDOW_OPEN';
      statusLabel = 'Attendance Window Open';
      statusDescription = 'Evening roll-call window is open until 10:30 PM IST. Tap below to verify your presence.';
    }
  }

  // Override displayStatus if student has already been marked Present or Absent
  if (studentAttendanceStatus === 'PRESENT') {
    displayStatus = 'Present';
  } else if (studentAttendanceStatus === 'ABSENT') {
    displayStatus = 'Absent';
  }

  // Calculate elapsed percentage of the 60-minute window
  let percentageElapsed = 0;
  if (currentTs <= windowStartTs) {
    percentageElapsed = 0;
  } else if (currentTs >= windowDeadlineTs) {
    percentageElapsed = 100;
  } else {
    const elapsed = currentTs - windowStartTs;
    percentageElapsed = Math.min(100, Math.max(0, Math.round((elapsed / totalWindowMs) * 100)));
  }

  // Format HH:MM:SS
  const safeMs = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const hours = h.toString().padStart(2, '0');
  const minutes = m.toString().padStart(2, '0');
  const seconds = s.toString().padStart(2, '0');
  const formatted = `${hours}:${minutes}:${seconds}`;

  // Format current IST clock
  const currentIstTimeStr = new Date(currentTs).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const currentIstDateStr = `${ist.year}-${ist.month.toString().padStart(2, '0')}-${ist.day.toString().padStart(2, '0')}`;

  return {
    status,
    displayStatus,
    statusLabel,
    statusDescription,
    formatted,
    hours,
    minutes,
    seconds,
    remainingMs,
    totalWindowMs,
    percentageElapsed,
    isWithinWindow,
    isExpired,
    isWarning15m,
    isUrgent5m,
    currentIstTimeStr,
    currentIstDateStr,
    windowStartTimeStr: '09:30 PM',
    windowDeadlineTimeStr: '10:30 PM',
    isServerSynced: hasSyncedWithServer,
    simulatedTimeMs: simulationOffsetMs ? currentTs : null
  };
}

/**
 * Computes the target simulation offset in ms for a specific test state relative to current IST date.
 * SECURITY: Pure function. Does NOT mutate global state.
 */
export function calculateSimulationOffset(
  mode: 'real' | 'before' | 'open' | 'warning15' | 'warning5' | 'closed'
): number | null {
  if (mode === 'real') return null;

  const realTs = getRealSyncedTimestamp();
  const ist = getIstCalendarParts(realTs);

  let targetHour = 21;
  let targetMinute = 30;

  switch (mode) {
    case 'before':
      targetHour = 21;
      targetMinute = 0; // 09:00 PM IST
      break;
    case 'open':
      targetHour = 21;
      targetMinute = 45; // 09:45 PM IST
      break;
    case 'warning15':
      targetHour = 22;
      targetMinute = 18; // 10:18 PM IST (12m left)
      break;
    case 'warning5':
      targetHour = 22;
      targetMinute = 27; // 10:27 PM IST (3m left)
      break;
    case 'closed':
      targetHour = 22;
      targetMinute = 32; // 10:32 PM IST
      break;
  }

  const targetUtcTs = istTimeToUtcTimestamp(ist.year, ist.month, ist.day, `${targetHour}:${targetMinute}:00`);
  return targetUtcTs - realTs;
}
