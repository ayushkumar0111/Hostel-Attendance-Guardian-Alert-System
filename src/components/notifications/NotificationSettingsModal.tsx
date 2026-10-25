// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Web Push Notification Settings & Multi-Device Manager
// Built by Ayush Kumar | Developed for CT Group of Institutions
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  isPushNotificationSupported,
  getNotificationPermission,
  detectDeviceType,
  subscribeUserToPush,
  unsubscribeUserFromPush,
  getActiveDeviceSubscription,
  updateSubscriptionPreferences,
  sendTestPushNotification
} from '../../lib/webPush';
import { PushSubscriptionRecord } from '../../types/database';
import {
  Bell,
  BellOff,
  BellRing,
  X,
  Smartphone,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  Send,
  Loader2,
  Sliders,
  ShieldCheck
} from 'lucide-react';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose
}) => {
  const { user } = useAuth();

  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [activeSub, setActiveSub] = useState<PushSubscriptionRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Preference Toggles
  const [reminders, setReminders] = useState<boolean>(true);
  const [statusUpdates, setStatusUpdates] = useState<boolean>(true);
  const [absenceAlerts, setAbsenceAlerts] = useState<boolean>(true);

  const deviceType = detectDeviceType();

  const refreshSubscriptionState = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const isSupp = isPushNotificationSupported();
    setSupported(isSupp);
    if (!isSupp) {
      setIsLoading(false);
      return;
    }

    setPermission(getNotificationPermission());

    try {
      const sub = await getActiveDeviceSubscription(user.id);
      setActiveSub(sub);
      if (sub) {
        setReminders(sub.attendance_reminders_enabled);
        setStatusUpdates(sub.attendance_status_updates_enabled);
        setAbsenceAlerts(sub.absence_alerts_enabled);
      }
    } catch (err) {
      console.warn('Error loading push subscription:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      refreshSubscriptionState();
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleToggleSubscribe = async () => {
    if (!user) return;
    setIsSubscribing(true);
    setFeedback(null);

    try {
      if (activeSub) {
        // Unsubscribe
        const res = await unsubscribeUserFromPush(user.id);
        if (res.success) {
          setActiveSub(null);
          setFeedback({
            type: 'info',
            message: 'Notifications disabled for this device.'
          });
        } else {
          setFeedback({
            type: 'error',
            message: res.error || 'Failed to disable notifications.'
          });
        }
      } else {
        // Subscribe
        const res = await subscribeUserToPush(user.id);
        if (res.success && res.subscription) {
          setActiveSub(res.subscription);
          setPermission('granted');
          setFeedback({
            type: 'success',
            message: 'Web Push notifications successfully enabled! Your device is now connected.'
          });
        } else {
          setPermission(getNotificationPermission());
          setFeedback({
            type: 'error',
            message: res.error || 'Failed to enable notifications. Please grant browser permission.'
          });
        }
      }
    } finally {
      setIsSubscribing(false);
    }
  };

  const handlePreferenceChange = async (
    key: 'reminders' | 'statusUpdates' | 'absenceAlerts',
    value: boolean
  ) => {
    if (!activeSub) return;

    if (key === 'reminders') setReminders(value);
    if (key === 'statusUpdates') setStatusUpdates(value);
    if (key === 'absenceAlerts') setAbsenceAlerts(value);

    await updateSubscriptionPreferences(activeSub.id, {
      attendance_reminders_enabled: key === 'reminders' ? value : reminders,
      attendance_status_updates_enabled: key === 'statusUpdates' ? value : statusUpdates,
      absence_alerts_enabled: key === 'absenceAlerts' ? value : absenceAlerts
    });
  };

  const handleSendTestPush = async () => {
    setIsSendingTest(true);
    setFeedback(null);

    try {
      const res = await sendTestPushNotification();
      if (res.success) {
        setFeedback({
          type: 'success',
          message: res.message
        });
      } else {
        // If Edge Function endpoint is awaiting deployment, show clear message
        setFeedback({
          type: 'info',
          message: `${res.message} If using local daemon, trigger worker test on port 5001.`
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error sending test push'
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-ct-navy via-slate-900 to-ct-navy-light p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-md shrink-0">
              <BellRing className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Web Push (VAPID)
                </span>
                <span className="text-xs text-slate-300 capitalize">{deviceType}</span>
              </div>
              <h2 className="text-lg font-bold text-white mt-0.5">Notification Settings</h2>
            </div>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Receive real-time attendance curfew reminders, roll-call verification receipts, and absence alerts even when this web app is closed.
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Unsupported Browser Alert */}
          {!supported && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-rose-900">Push Notifications Not Supported</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  Your current browser does not support the W3C Web Push API. For background notifications on mobile, please use Google Chrome on Android.
                </p>
              </div>
            </div>
          )}

          {/* Feedback Banner */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : feedback.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : feedback.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <Bell className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{feedback.message}</span>
            </div>
          )}

          {/* Device & Permission Status Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {deviceType === 'android' ? (
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Laptop className="w-4 h-4 text-blue-600" />
                )}
                <span className="text-xs font-bold text-slate-800">This Device</span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  activeSub
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    : 'bg-slate-200 text-slate-700 border-slate-300'
                }`}
              >
                {activeSub ? 'Connected (VAPID)' : 'Not Subscribed'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-200">
              <div>
                <span className="text-slate-500">Browser Permission: </span>
                <span
                  className={`font-semibold capitalize ${
                    permission === 'granted'
                      ? 'text-emerald-700'
                      : permission === 'denied'
                      ? 'text-rose-700'
                      : 'text-amber-700'
                  }`}
                >
                  {permission}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Device Platform: </span>
                <span className="font-semibold text-slate-700 capitalize">{deviceType}</span>
              </div>
            </div>

            {/* Permission Denied Guide */}
            {permission === 'denied' && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  Notifications are blocked in your browser
                </p>
                <p>
                  To re-enable: Tap the lock/tune icon in Chrome's address bar $\rightarrow$ tap <strong>Site settings</strong> $\rightarrow$ tap <strong>Notifications</strong> $\rightarrow$ select <strong>Allow</strong>.
                </p>
              </div>
            )}

            {/* Primary Subscription Action Button */}
            {supported && (
              <div className="pt-2">
                <button
                  onClick={handleToggleSubscribe}
                  disabled={isSubscribing || isLoading}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm ${
                    activeSub
                      ? 'bg-slate-200 hover:bg-rose-50 hover:text-rose-700 text-slate-700 border border-slate-300'
                      : 'bg-ct-navy hover:bg-slate-800 text-white'
                  } disabled:opacity-50`}
                >
                  {isSubscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : activeSub ? (
                    <BellOff className="w-4 h-4" />
                  ) : (
                    <Bell className="w-4 h-4 text-amber-400" />
                  )}
                  <span>
                    {isSubscribing
                      ? 'Processing...'
                      : activeSub
                      ? 'Disable Notifications on This Device'
                      : 'Enable Push Notifications'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Granular Notification Preferences */}
          {activeSub && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Sliders className="w-4 h-4 text-ct-gold-dark" />
                <span>Notification Preferences</span>
              </div>

              <div className="space-y-2.5">
                <label className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100/60 transition cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reminders}
                    onChange={(e) => handlePreferenceChange('reminders', e.target.checked)}
                    className="mt-0.5 rounded text-ct-navy focus:ring-ct-gold h-4 w-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Attendance Window Reminders
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Receive an alert 15 minutes before the 21:30 IST night curfew roll-call window opens.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100/60 transition cursor-pointer">
                  <input
                    type="checkbox"
                    checked={statusUpdates}
                    onChange={(e) => handlePreferenceChange('statusUpdates', e.target.checked)}
                    className="mt-0.5 rounded text-ct-navy focus:ring-ct-gold h-4 w-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Attendance &amp; Leave Status Updates
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Instant confirmation when your face &amp; GPS attendance is recorded as PRESENT or when leave is approved.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100/60 transition cursor-pointer">
                  <input
                    type="checkbox"
                    checked={absenceAlerts}
                    onChange={(e) => handlePreferenceChange('absenceAlerts', e.target.checked)}
                    className="mt-0.5 rounded text-ct-navy focus:ring-ct-gold h-4 w-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Absence &amp; Curfew Notices
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Critical notifications if roll call is missed by the 22:30 IST cutoff (for Guardians and Residents).
                    </p>
                  </div>
                </label>
              </div>

              {/* Send Test Notification Button */}
              <div className="pt-2">
                <button
                  onClick={handleSendTestPush}
                  disabled={isSendingTest}
                  className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSendingTest ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-amber-700" />
                  )}
                  <span>Send Test Push Notification to This Device</span>
                </button>
              </div>
            </div>
          )}

          {/* Privacy & Zero-Cost Notice */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-600 leading-relaxed">
              <span className="font-bold text-slate-800">Privacy &amp; Security: </span>
              Web Push messages are end-to-end encrypted with your browser's unique keys. Notifications contain no sensitive student records, do not incur cellular carrier fees ($0 cost), and operate strictly with your consent.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">CT Group Shahpur Campus</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-sm transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
