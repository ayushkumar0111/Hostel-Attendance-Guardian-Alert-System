// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Student Notification Permission Banner Component
// Developed by CT | Built by Ayush Kumar
// Accessible, user-gesture-compliant Web Push subscription banner
// ==============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  getActiveDeviceSubscription,
  subscribeUserToPush,
  detectDeviceType
} from '../../lib/webPush';
import {
  Bell,
  BellRing,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Loader2,
  ShieldCheck
} from 'lucide-react';

interface NotificationPermissionBannerProps {
  userId: string;
  onSubscriptionChange?: () => void;
}

export const NotificationPermissionBanner: React.FC<NotificationPermissionBannerProps> = ({
  userId,
  onSubscriptionChange
}) => {
  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [hasActiveSub, setHasActiveSub] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  const dismissalStorageKey = `ct_hostel_push_dismissed_${userId}`;
  const deviceType = detectDeviceType();

  // 1. Initial State Check (Strictly read-only; does NOT trigger native prompt)
  const evaluatePermissionState = useCallback(async () => {
    if (!userId) {
      setIsChecking(false);
      return;
    }

    const isSupp = isPushNotificationSupported();
    setSupported(isSupp);
    if (!isSupp) {
      setIsChecking(false);
      return;
    }

    const currentPermission = getNotificationPermission();
    setPermission(currentPermission);

    // Check if student dismissed the default prompt previously
    const previouslyDismissed = localStorage.getItem(dismissalStorageKey) === 'true';
    setIsDismissed(previouslyDismissed);

    try {
      const activeSub = await getActiveDeviceSubscription(userId);
      setHasActiveSub(Boolean(activeSub));
    } catch {
      setHasActiveSub(false);
    } finally {
      setIsChecking(false);
    }
  }, [userId, dismissalStorageKey]);

  useEffect(() => {
    evaluatePermissionState();
  }, [evaluatePermissionState]);

  // 2. User-Gesture Driven Subscription Handler
  // Strictly called ONLY after user clicks the button
  const handleEnableNotifications = async () => {
    if (!userId || isSubscribing) return;

    setIsSubscribing(true);
    setErrorMessage(null);

    try {
      const result = await subscribeUserToPush(userId);

      // Refresh permission state from browser
      const updatedPermission = getNotificationPermission();
      setPermission(updatedPermission);

      if (result.success && result.subscription) {
        setHasActiveSub(true);
        setErrorMessage(null);
        // Clear any previous dismissal since user explicitly opted in
        localStorage.removeItem(dismissalStorageKey);
        setIsDismissed(false);
        if (onSubscriptionChange) onSubscriptionChange();
      } else {
        setErrorMessage(
          result.error || 'Failed to enable notifications. Please try again.'
        );
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred during subscription.'
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem(dismissalStorageKey, 'true');
    } catch {
      // Storage unavailable (private mode)
    }
  };

  // 3. Render State: Checking or Unsupported Browser
  if (isChecking || !supported) {
    // Hide gracefully if browser does not support Web Push (W3C Push API / ServiceWorker)
    return null;
  }

  // 4. Render State: ERROR
  if (errorMessage) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="bg-amber-50 border border-amber-300 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-800"
      >
        <div className="flex items-start space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0 mt-0.5 sm:mt-0">
            <AlertTriangle className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-amber-900">Notification Setup Notice</h4>
            <p className="text-[11px] text-amber-800 mt-0.5">{errorMessage}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-amber-200">
          <button
            onClick={handleEnableNotifications}
            disabled={isSubscribing}
            aria-label="Retry enabling notifications"
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isSubscribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Retry</span>
          </button>
          <button
            onClick={() => setErrorMessage(null)}
            aria-label="Close error notice"
            className="p-1.5 text-amber-700 hover:text-amber-900 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // 5. Render State: DENIED (Browser notifications blocked in settings)
  if (permission === 'denied') {
    if (isDismissed) return null;
    return (
      <div
        role="region"
        aria-label="Notifications blocked notice"
        className="bg-slate-100 border border-slate-300 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-800"
      >
        <div className="flex items-start space-x-3">
          <div className="w-9 h-9 rounded-xl bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 shrink-0 mt-0.5 sm:mt-0">
            <BellOff className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Notifications Blocked in Browser</h4>
            <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
              Curfew warnings and attendance alerts are blocked. To re-enable: click the <strong>lock / tune icon</strong> in your address bar $\rightarrow$ allow <strong>Notifications</strong> $\rightarrow$ refresh this page.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200">
          <button
            onClick={handleDismiss}
            aria-label="Dismiss blocked notification warning"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // 6. Render State: GRANTED + ACTIVE SUBSCRIPTION (Device Connected)
  if (permission === 'granted' && hasActiveSub) {
    if (isDismissed) return null;
    return (
      <div
        role="region"
        aria-label="Notifications active confirmation"
        className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3 text-emerald-900"
      >
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-emerald-950 block">Hostel Notifications Active</span>
            <span className="text-[11px] text-emerald-700 block">
              This {deviceType} is registered for 21:30 roll-call reminders, face attendance receipts, and curfew alerts.
            </span>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss active notification badge"
          className="p-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 rounded-lg transition-colors shrink-0 cursor-pointer"
          title="Hide notice"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // 7. Render State: GRANTED BUT NO ACTIVE SUBSCRIPTION (Browser allowed, but record missing)
  if (permission === 'granted' && !hasActiveSub) {
    if (isDismissed) return null;
    return (
      <div
        role="region"
        aria-label="Connect device notifications"
        className="bg-gradient-to-r from-slate-900 via-ct-navy to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-slate-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="flex items-start space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-ct-gold/40 flex items-center justify-center text-ct-gold shrink-0">
            <BellRing className="w-5 h-5 text-ct-gold" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs sm:text-sm font-bold text-white">Complete Device Notification Link</h3>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-400/20 text-ct-gold rounded-full border border-ct-gold/30">
                Action Required
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Browser permission is already granted, but this device is not yet registered in your student profile. Connect now to receive scheduled curfew alerts.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 w-full md:w-auto justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
          <button
            onClick={handleDismiss}
            aria-label="Dismiss device registration prompt"
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Later
          </button>
          <button
            onClick={handleEnableNotifications}
            disabled={isSubscribing}
            aria-label="Connect This Device for push notifications"
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-ct-gold hover:from-amber-600 hover:to-amber-500 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubscribing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-slate-950" />
                <span>Connect Device</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // 8. Render State: DEFAULT (Unsubscribed / Fresh Session)
  if (permission === 'default') {
    if (isDismissed) return null;
    return (
      <div
        role="region"
        aria-label="Enable hostel push notifications banner"
        className="bg-gradient-to-r from-slate-900 via-ct-navy to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-slate-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="flex items-start space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-ct-gold/40 flex items-center justify-center text-ct-gold shrink-0">
            <BellRing className="w-5 h-5 text-ct-gold animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs sm:text-sm font-bold text-white">Enable Hostel Roll-Call &amp; Curfew Alerts</h3>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-400/20 text-ct-gold rounded-full border border-ct-gold/30">
                Recommended
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Receive 21:30 IST night curfew reminders, real-time face verification receipts, and warden leave notices directly on this {deviceType}.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 w-full md:w-auto justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
          <button
            onClick={handleDismiss}
            aria-label="Dismiss notification prompt for now"
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Later
          </button>
          <button
            onClick={handleEnableNotifications}
            disabled={isSubscribing}
            aria-label="Enable Push Notifications on this device"
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-ct-gold hover:from-amber-600 hover:to-amber-500 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubscribing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Subscribing...</span>
              </>
            ) : (
              <>
                <Bell className="w-3.5 h-3.5 text-slate-950" />
                <span>Enable Notifications</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return null;
};
