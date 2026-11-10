// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Live Attendance Countdown Timer Component (Production Ready)
// Developed by CT | Built by Ayush Kumar
// Strict Student vs. Authorized Staff (Warden/Admin) Mode Segregation
// ==============================================================================

import React, { useState, useEffect } from 'react';
import {
  Clock,
  ShieldCheck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Lock,
  Radio,
  Sparkles,
  Camera,
  Scan,
  RefreshCw,
  XCircle,
  Calendar
} from 'lucide-react';
import { AttendanceSchedule } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import {
  calculateAttendanceCountdown,
  calculateSimulationOffset,
  CountdownState,
  syncServerTime
} from '../../lib/serverTime';

interface AttendanceCountdownTimerProps {
  schedule?: AttendanceSchedule | null;
  hasSubmittedToday?: boolean;
  todayStatus?: string | null;
  todaySubmissionTime?: string | null;
  onCheckInClick?: () => void;
  showEnrollmentPrompt?: boolean;
  onEnrollClick?: () => void;
  /**
   * Only authorized staff (Warden / Admin) are permitted to enable simulation controls.
   * Student Dashboard explicitly passes false (or omits it), completely hiding the test drawer.
   */
  allowSimulation?: boolean;
  /**
   * Optional custom label context (e.g. "STUDENT PORTAL" or "WARDEN DESK")
   */
  portalContext?: 'student' | 'staff';
}

export const AttendanceCountdownTimer: React.FC<AttendanceCountdownTimerProps> = ({
  schedule,
  hasSubmittedToday = false,
  todayStatus = null,
  todaySubmissionTime,
  onCheckInClick,
  showEnrollmentPrompt = false,
  onEnrollClick,
  allowSimulation = false,
  portalContext = 'student'
}) => {
  const { role, profile } = useAuth();

  // SECURITY: Simulation drawer is ONLY accessible if user has verified staff role (Admin or Warden)
  const isStaffAuthorized =
    role === 'admin' ||
    role === 'warden' ||
    profile?.role === 'admin' ||
    profile?.role === 'warden';

  const canShowSimulation = Boolean(allowSimulation && isStaffAuthorized);

  const [simMode, setSimMode] = useState<
    'real' | 'before' | 'open' | 'warning15' | 'warning5' | 'closed'
  >('real');
  const [simOffsetMs, setSimOffsetMs] = useState<number | null>(null);
  const [showSimControls, setShowSimControls] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Derive initial countdown
  const [countdown, setCountdown] = useState<CountdownState>(() =>
    calculateAttendanceCountdown(schedule, null, todayStatus)
  );

  // Update countdown every second (1000ms)
  useEffect(() => {
    // If user is a student, enforce real-time server calculation (simOffsetMs strictly null)
    const activeOffset = canShowSimulation ? simOffsetMs : null;
    setCountdown(calculateAttendanceCountdown(schedule, activeOffset, todayStatus));

    const intervalId = window.setInterval(() => {
      setCountdown(calculateAttendanceCountdown(schedule, activeOffset, todayStatus));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [schedule, simOffsetMs, canShowSimulation, todayStatus]);

  // Simulation handler (Staff only)
  const handleSimulate = (
    mode: 'real' | 'before' | 'open' | 'warning15' | 'warning5' | 'closed'
  ) => {
    if (!canShowSimulation) return;
    setSimMode(mode);
    const offset = calculateSimulationOffset(mode);
    setSimOffsetMs(offset);
    setCountdown(calculateAttendanceCountdown(schedule, offset, todayStatus));
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncServerTime(true);
    const activeOffset = canShowSimulation ? simOffsetMs : null;
    setCountdown(calculateAttendanceCountdown(schedule, activeOffset, todayStatus));
    setIsSyncing(false);
  };

  // Determine dynamic visual theme based on countdown state
  const isExpired = countdown.status === 'EXPIRED';
  const isUrgent = countdown.status === 'WARNING_5M';
  const isWarning = countdown.status === 'WARNING_15M';
  const isOpen = countdown.status === 'WINDOW_OPEN';
  const isBefore = countdown.status === 'BEFORE_WINDOW';

  const isMarkedPresent = todayStatus === 'PRESENT' || hasSubmittedToday;
  const isMarkedAbsent = todayStatus === 'ABSENT';

  // Dynamic Card Container Styling
  let containerBorder = 'border-ct-gold/50';
  let containerBg = 'from-slate-900 via-ct-navy to-slate-950';
  let digitBoxBg = 'bg-slate-950/80 border-slate-700/80 text-white';
  let pulseRing = '';

  if (isMarkedAbsent) {
    containerBorder = 'border-rose-600/80 shadow-rose-950/50 shadow-lg';
    containerBg = 'from-rose-950/70 via-slate-950 to-slate-950';
    digitBoxBg = 'bg-slate-950/80 border-rose-700/60 text-rose-300';
  } else if (isMarkedPresent) {
    containerBorder = 'border-emerald-500/70 shadow-emerald-950/40 shadow-lg';
    containerBg = 'from-emerald-950/50 via-slate-950 to-slate-950';
    digitBoxBg = 'bg-slate-950/80 border-emerald-500/50 text-emerald-200';
  } else if (isUrgent) {
    containerBorder = 'border-rose-500 shadow-rose-950/50 shadow-2xl animate-pulse';
    containerBg = 'from-rose-950 via-slate-950 to-slate-950';
    digitBoxBg = 'bg-rose-950/80 border-rose-500/80 text-rose-200';
    pulseRing = 'ring-2 ring-rose-500/50';
  } else if (isWarning) {
    containerBorder = 'border-amber-400 shadow-amber-950/40 shadow-xl';
    containerBg = 'from-amber-950/60 via-slate-950 to-slate-950';
    digitBoxBg = 'bg-amber-950/70 border-amber-500/80 text-amber-200';
    pulseRing = 'ring-1 ring-amber-400/40';
  } else if (isOpen) {
    containerBorder = 'border-emerald-500/60 shadow-emerald-950/30 shadow-xl';
    containerBg = 'from-slate-900 via-ct-navy to-slate-950';
    digitBoxBg = 'bg-slate-950/80 border-emerald-500/50 text-emerald-200';
  } else if (isBefore) {
    containerBorder = 'border-blue-500/50 shadow-blue-950/30 shadow-lg';
    containerBg = 'from-slate-900 via-slate-900 to-slate-950';
    digitBoxBg = 'bg-slate-950/80 border-blue-500/40 text-blue-200';
  } else if (isExpired) {
    containerBorder = 'border-slate-700 shadow-sm';
    containerBg = 'from-slate-900 via-slate-950 to-slate-950';
    digitBoxBg = 'bg-slate-950/60 border-slate-800 text-slate-400';
  }

  return (
    <div
      className={`rounded-2xl p-5 sm:p-6 bg-gradient-to-br ${containerBg} border-2 ${containerBorder} text-white shadow-xl relative overflow-hidden transition-all duration-500 ${pulseRing}`}
    >
      {/* Decorative Subtle Accent Lights */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-ct-gold/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Staff Simulation Sandbox Banner (Only shown if authorized staff actively running simulation) */}
      {canShowSimulation && simMode !== 'real' && (
        <div className="relative z-10 mb-4 p-2.5 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-200 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 font-bold">
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
            <span>STAFF TEST SANDBOX ACTIVE: Simulated state "{simMode}"</span>
          </div>
          <button
            onClick={() => handleSimulate('real')}
            className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold text-[10px] hover:bg-amber-300 transition-colors cursor-pointer"
          >
            Reset to Real Clock
          </button>
        </div>
      )}

      {/* Top Header: Campus Monogram, Deadline Badge & Server Clock Meta */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-ct-gold/20 border border-ct-gold/50 flex items-center justify-center shrink-0">
            <Clock className={`w-4 h-4 ${isUrgent ? 'text-rose-400 animate-spin' : 'text-ct-gold'}`} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-ct-gold">
                {portalContext === 'staff' ? 'STAFF MONITOR • CT SHAHPUR' : 'CT SHAHPUR CAMPUS • HOSTEL ROLL-CALL'}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wide bg-ct-navy-light/90 border border-ct-gold/40 text-ct-gold">
                Deadline: 10:30 PM IST
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-black text-white mt-0.5">
              Daily Attendance Window (09:30 PM – 10:30 PM IST)
            </h3>
          </div>
        </div>

        {/* Live Synchronized IST Clock Info */}
        <div className="flex items-center space-x-2 text-xs flex-wrap">
          <div
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-mono text-[11px] text-slate-300"
            title="Real-time synchronized clock in Asia/Kolkata timezone"
          >
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>IST: {countdown.currentIstTimeStr}</span>
          </div>

          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
            title="Re-synchronize with server time"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>

          {/* Toggle Simulation Controls: Rendered ONLY for authorized staff */}
          {canShowSimulation && (
            <button
              onClick={() => setShowSimControls((prev) => !prev)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-400/50 transition-colors cursor-pointer flex items-center gap-1"
              title="Toggle authorized testing simulation drawer"
            >
              <Sparkles className="w-3 h-3 text-purple-300" />
              <span>{showSimControls ? 'Hide Staff Sandbox' : 'Staff Test Drawer'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Countdown Centerpiece */}
      <div className="relative z-10 py-5 sm:py-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Left Side: Clear Five-State Attendance Status Badge & Description */}
        <div className="space-y-3 max-w-md">
          {/* Status Badge: Upcoming, Attendance Open, Present, Absent, Attendance Closed */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            {/* Status 1: Present */}
            {isMarkedPresent && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-emerald-500/30 text-emerald-200 border border-emerald-400/60 shadow-md">
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Attendance Status: Present</span>
              </span>
            )}

            {/* Status 2: Absent */}
            {isMarkedAbsent && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-rose-600/30 text-rose-200 border border-rose-500/70 shadow-md">
                <XCircle className="w-4 h-4 text-rose-300" />
                <span>Attendance Status: Absent</span>
              </span>
            )}

            {/* Status 3: Upcoming (Before 09:30 PM IST) */}
            {!isMarkedPresent && !isMarkedAbsent && isBefore && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-blue-500/20 text-blue-300 border border-blue-400/50">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <span>Status: Upcoming (Opens at 09:30 PM)</span>
              </span>
            )}

            {/* Status 4: Attendance Open (09:30 PM to 10:30 PM IST) */}
            {!isMarkedPresent && !isMarkedAbsent && isOpen && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-emerald-500/25 text-emerald-300 border border-emerald-400/50 shadow-sm animate-pulse">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>Status: Attendance Open</span>
              </span>
            )}

            {/* Warning Sub-Badges during active window */}
            {!isMarkedPresent && !isMarkedAbsent && isWarning && !isUrgent && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-amber-500/30 text-amber-200 border border-amber-400/60 shadow-md">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                <span>15 Minutes Remaining</span>
              </span>
            )}

            {!isMarkedPresent && !isMarkedAbsent && isUrgent && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-rose-600 text-white border border-rose-300 shadow-rose-900/50 shadow-lg animate-bounce">
                <Flame className="w-3.5 h-3.5 text-yellow-300" />
                <span>CRITICAL: Under 5 Minutes Remaining!</span>
              </span>
            )}

            {/* Status 5: Attendance Closed (At/After 10:30 PM IST) */}
            {!isMarkedPresent && !isMarkedAbsent && isExpired && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-slate-800 text-slate-300 border border-slate-700">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Status: Attendance Closed</span>
              </span>
            )}
          </div>

          {/* Description Text */}
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
            {isMarkedPresent
              ? 'Your attendance has been officially confirmed for tonight. No further action is required.'
              : isMarkedAbsent
              ? 'You have been marked ABSENT for evening roll call. Please contact your hostel warden immediately.'
              : countdown.statusDescription}
          </p>

          {/* Institutional Deadline & Tamper-Proof Server Assurance */}
          <div className="flex items-center space-x-2 text-[11px] text-slate-300 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-ct-gold" />
            <span>Curfew Deadline: 10:30 PM IST • Verified Asia/Kolkata Server Time</span>
          </div>
        </div>

        {/* Right Side: High-Impact HH:MM:SS Digit Boxes */}
        <div className="flex flex-col items-center justify-center">
          <div className="flex items-center space-x-1.5 sm:space-x-2.5 font-mono">
            {/* Hours Box */}
            <div className="flex flex-col items-center">
              <div
                className={`w-14 sm:w-20 h-16 sm:h-22 rounded-xl flex items-center justify-center font-black text-2xl sm:text-4xl shadow-inner border-2 ${digitBoxBg}`}
              >
                {countdown.hours}
              </div>
              <span className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 mt-1 tracking-wider">
                Hours
              </span>
            </div>

            {/* Colon Separator */}
            <div className="text-xl sm:text-3xl font-black text-ct-gold/80 pb-4">:</div>

            {/* Minutes Box */}
            <div className="flex flex-col items-center">
              <div
                className={`w-14 sm:w-20 h-16 sm:h-22 rounded-xl flex items-center justify-center font-black text-2xl sm:text-4xl shadow-inner border-2 ${digitBoxBg}`}
              >
                {countdown.minutes}
              </div>
              <span className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 mt-1 tracking-wider">
                Minutes
              </span>
            </div>

            {/* Colon Separator */}
            <div className="text-xl sm:text-3xl font-black text-ct-gold/80 pb-4">:</div>

            {/* Seconds Box */}
            <div className="flex flex-col items-center">
              <div
                className={`w-14 sm:w-20 h-16 sm:h-22 rounded-xl flex items-center justify-center font-black text-2xl sm:text-4xl shadow-inner border-2 ${digitBoxBg}`}
              >
                {countdown.seconds}
              </div>
              <span className="text-[10px] sm:text-xs uppercase font-bold text-slate-400 mt-1 tracking-wider">
                Seconds
              </span>
            </div>
          </div>

          {/* Under Timer Label */}
          <div className="text-[11px] text-slate-300 font-semibold mt-2 text-center">
            {isBefore
              ? 'Countdown until roll-call opens (09:30 PM IST)'
              : isExpired
              ? 'Roll-call window expired at 10:30 PM IST'
              : 'Remaining until roll-call curfew deadline (10:30 PM IST)'}
          </div>
        </div>
      </div>

      {/* Progress Bar for the 60-Minute Window */}
      {!isBefore && (
        <div className="relative z-10 pt-2 pb-1">
          <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
            <span>09:30 PM IST (Start)</span>
            <span>
              {isExpired ? '100% Elapsed' : `${countdown.percentageElapsed}% Window Elapsed`}
            </span>
            <span>10:30 PM IST (Curfew Deadline)</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-950/80 border border-slate-700/60 overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ${
                isUrgent
                  ? 'bg-gradient-to-r from-amber-500 to-rose-600'
                  : isWarning
                  ? 'bg-gradient-to-r from-emerald-500 to-amber-500'
                  : isExpired
                  ? 'bg-slate-600'
                  : 'bg-gradient-to-r from-ct-gold to-emerald-400'
              }`}
              style={{ width: `${countdown.percentageElapsed}%` }}
            />
          </div>
        </div>
      )}

      {/* Contextual Warning & Action Banners */}
      <div className="relative z-10 pt-3">
        {/* State: 5-Minute Critical Red Alert */}
        {isUrgent && !isMarkedPresent && !isMarkedAbsent && (
          <div className="p-3.5 rounded-xl bg-rose-600/30 border-2 border-rose-500 text-rose-100 flex items-start gap-3 shadow-lg">
            <Flame className="w-5 h-5 text-rose-300 shrink-0 mt-0.5 animate-bounce" />
            <div className="space-y-1 text-xs">
              <div className="font-black text-rose-200 uppercase tracking-wide">
                URGENT ATTENDANCE WARNING (UNDER 5 MINUTES REMAINING)
              </div>
              <p className="leading-relaxed">
                Roll-call closes promptly at 10:30 PM IST. If you fail to verify your face and GPS before the countdown reaches 00:00:00, you will be flagged as <strong>ABSENT</strong> and automated notifications will be queued for your hostel warden.
              </p>
              {onCheckInClick && (
                <button
                  onClick={onCheckInClick}
                  className="mt-2 px-4 py-2 rounded-lg font-black text-xs bg-rose-500 hover:bg-rose-400 text-white shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Scan className="w-4 h-4" />
                  <span>Verify Presence Immediately</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* State: 15-Minute Amber Warning */}
        {isWarning && !isUrgent && !isMarkedPresent && !isMarkedAbsent && (
          <div className="p-3.5 rounded-xl bg-amber-500/20 border-2 border-amber-400/60 text-amber-100 flex items-start gap-3 shadow-md">
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-bold text-amber-200 uppercase tracking-wide">
                15-Minute Attendance Deadline Notice
              </div>
              <p className="leading-relaxed">
                Only {countdown.minutes} minutes remaining before the 10:30 PM IST curfew roll-call deadline. Please complete face biometrics and location check-in now from your assigned hostel room.
              </p>
              {onCheckInClick && (
                <button
                  onClick={onCheckInClick}
                  className="mt-2 px-4 py-2 rounded-lg font-bold text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 shadow transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Scan className="w-4 h-4" />
                  <span>Mark Attendance Now</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* State: Present (Confirmed) */}
        {isMarkedPresent && (
          <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Attendance Confirmed (Present):</strong> Your presence has been verified for tonight's roll-call window.
              </span>
            </div>
            {todaySubmissionTime && (
              <span className="font-mono text-[11px] text-emerald-300 shrink-0">
                {new Date(todaySubmissionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {/* State: Absent */}
        {isMarkedAbsent && (
          <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-200 flex items-start gap-3 text-xs">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-rose-200">Attendance Status: Marked Absent</div>
              <p className="text-rose-300/80 leading-relaxed">
                You have been marked absent for tonight's roll-call window. An absence alert has been registered. If this is an error, request an in-person attendance audit correction with your hostel warden (FR-05).
              </p>
            </div>
          </div>
        )}

        {/* State: Expired (At/After 10:30 PM, not present/absent) */}
        {isExpired && !isMarkedPresent && !isMarkedAbsent && (
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-300 flex items-start gap-3 text-xs">
            <Lock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-white">Attendance Window Closed at 10:30 PM IST</div>
              <p className="text-slate-400 leading-relaxed">
                The scheduled evening roll-call window is now closed. Late submissions or attendance corrections must be reviewed in person by your hostel warden with a documented institutional reason (FR-05).
              </p>
            </div>
          </div>
        )}

        {/* State: Upcoming (Before 09:30 PM) */}
        {isBefore && !isMarkedPresent && !isMarkedAbsent && (
          <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200 flex items-start gap-3 text-xs">
            <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-blue-100">Roll-Call Check-In Window Starts at 09:30 PM IST</div>
              <p className="text-blue-300/80 leading-relaxed">
                Biometric face recognition and geofenced attendance verification will automatically activate once the countdown reaches 00:00:00. Please return to your assigned room.
              </p>
            </div>
          </div>
        )}

        {/* Missing Face Biometrics Prompt */}
        {showEnrollmentPrompt && onEnrollClick && (
          <div className="mt-3 p-3 rounded-xl bg-ct-gold/20 border border-ct-gold/50 text-slate-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-ct-gold shrink-0" />
              <span>Face biometrics enrollment is required prior to roll-call submission.</span>
            </div>
            <button
              onClick={onEnrollClick}
              className="px-3 py-1.5 rounded-lg font-black text-xs bg-ct-gold hover:bg-ct-gold-dark text-slate-950 shadow transition-all shrink-0 cursor-pointer"
            >
              Enroll Now
            </button>
          </div>
        )}
      </div>

      {/* Authorized Staff-Only Simulation Drawer (Completely hidden from Student Dashboard) */}
      {canShowSimulation && showSimControls && (
        <div className="relative z-10 mt-4 p-4 rounded-xl bg-slate-950/95 border border-purple-500/40 text-xs space-y-2.5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="font-bold text-purple-300 uppercase text-[11px] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Authorized Staff Sandbox: Timer State Testing Drawer</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Role: {role || profile?.role || 'Staff'} (Audit Access)
            </span>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed">
            This testing sandbox runs strictly within this staff console view. It lets you visually audit all timer states without waiting for night hours. <strong>Simulations never alter database records, trigger real absence marking, or dispatch student notifications.</strong>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
            <button
              onClick={() => handleSimulate('real')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'real'
                  ? 'bg-ct-gold text-slate-950 shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              Live Clock (IST)
            </button>

            <button
              onClick={() => handleSimulate('before')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'before'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              Before 9:30 PM
            </button>

            <button
              onClick={() => handleSimulate('open')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'open'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              Open (9:45 PM)
            </button>

            <button
              onClick={() => handleSimulate('warning15')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'warning15'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              15m Warning
            </button>

            <button
              onClick={() => handleSimulate('warning5')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'warning5'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              5m Critical
            </button>

            <button
              onClick={() => handleSimulate('closed')}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                simMode === 'closed'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              Expired (10:32 PM)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
