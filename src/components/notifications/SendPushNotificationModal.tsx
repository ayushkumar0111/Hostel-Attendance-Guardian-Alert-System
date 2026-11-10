// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Modal: Send Push Notification (Individual or Batch to Absent Students)
// Developed by CT | Built by Ayush Kumar
// Server-Side Web Push Dispatcher with VAPID Delivery
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { sendPushNotificationToUsers, sendTestPushNotification } from '../../lib/webPush';
import { PushNotificationType } from '../../types/database';
import {
  BellRing,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Users,
  User,
  Smartphone,
  Sparkles
} from 'lucide-react';

export interface StudentRecipient {
  id: string;
  full_name: string;
  roll_number: string;
  profile_id?: string | null;
  room_number?: string;
  hostel_name?: string;
}

interface SendPushNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  singleStudent?: StudentRecipient | null;
  studentList?: StudentRecipient[];
  defaultTitle?: string;
  defaultBody?: string;
  defaultNotificationType?: PushNotificationType;
  onSuccess?: (deliveredCount: number) => void;
}

const TEMPLATES = [
  {
    id: 'curfew',
    label: 'Curfew Warning (22:30 IST)',
    type: 'ATTENDANCE_REMINDER' as PushNotificationType,
    title: 'CT Hostel - Night Curfew Warning',
    body: 'Curfew deadline is 22:30 IST. Please return to your assigned room immediately to complete roll call.'
  },
  {
    id: 'absence',
    label: 'Absence Notice (Immediate Action)',
    type: 'ABSENCE_ALERT' as PushNotificationType,
    title: 'CT Hostel - Unrecorded Absence Alert',
    body: 'You have been marked ABSENT for evening roll call. Report to the Warden Office immediately.'
  },
  {
    id: 'rollcall',
    label: 'Roll-Call Active Reminder',
    type: 'ATTENDANCE_REMINDER' as PushNotificationType,
    title: 'CT Hostel - Attendance Window Open',
    body: 'Evening hostel roll-call check-in is now open. Open the app to verify your face and GPS attendance.'
  },
  {
    id: 'inspection',
    label: 'Room Inspection Alert',
    type: 'ATTENDANCE_REMINDER' as PushNotificationType,
    title: 'CT Hostel - Room Inspection Notice',
    body: 'Routine hostel floor inspection is in progress. Please remain present in your room.'
  },
  {
    id: 'custom',
    label: 'Custom Message',
    type: 'ATTENDANCE_REMINDER' as PushNotificationType,
    title: 'CT Hostel - Important Warden Notice',
    body: ''
  }
];

export const SendPushNotificationModal: React.FC<SendPushNotificationModalProps> = ({
  isOpen,
  onClose,
  singleStudent,
  studentList = [],
  defaultTitle,
  defaultBody,
  defaultNotificationType = 'ATTENDANCE_REMINDER',
  onSuccess
}) => {
  const isBatchMode = !singleStudent && studentList.length > 0;

  // Selected students for batch mode
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('curfew');
  const [title, setTitle] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [notificationType, setNotificationType] = useState<PushNotificationType>(defaultNotificationType);

  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
    details?: string;
  } | null>(null);

  // Initialize modal state on open
  useEffect(() => {
    if (!isOpen) {
      setFeedback(null);
      return;
    }

    if (isBatchMode) {
      // By default select all students who have a linked profile_id
      const defaultSelected = studentList.map((s) => s.id);
      setSelectedIds(defaultSelected);
    }

    if (defaultTitle || defaultBody) {
      setTitle(defaultTitle || 'CT Hostel Notice');
      setBody(defaultBody || '');
      setSelectedTemplate('custom');
    } else {
      const initialTemplate = isBatchMode ? TEMPLATES[1] : TEMPLATES[0];
      setSelectedTemplate(initialTemplate.id);
      setTitle(initialTemplate.title);
      setBody(initialTemplate.body);
      setNotificationType(initialTemplate.type);
    }
  }, [isOpen, isBatchMode, singleStudent, studentList, defaultTitle, defaultBody]);

  if (!isOpen) return null;

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tmpl = TEMPLATES.find((t) => t.id === templateId);
    if (tmpl) {
      setTitle(tmpl.title);
      setBody(tmpl.body);
      setNotificationType(tmpl.type);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === studentList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(studentList.map((s) => s.id));
    }
  };

  const handleToggleStudent = (studentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleSendPush = async () => {
    setFeedback(null);

    // 1. Gather target profile_ids
    let targetStudents: StudentRecipient[] = [];
    if (singleStudent) {
      targetStudents = [singleStudent];
    } else {
      targetStudents = studentList.filter((s) => selectedIds.includes(s.id));
    }

    if (targetStudents.length === 0) {
      setFeedback({
        type: 'warning',
        message: 'Please select at least one student recipient.'
      });
      return;
    }

    if (!title.trim() || !body.trim()) {
      setFeedback({
        type: 'warning',
        message: 'Notification title and message body cannot be empty.'
      });
      return;
    }

    // Filter students with linked profile_id (auth account)
    const validUserIds = targetStudents
      .map((s) => s.profile_id)
      .filter((pid): pid is string => Boolean(pid && pid.trim() !== ''));

    const unlinkedCount = targetStudents.length - validUserIds.length;

    if (validUserIds.length === 0) {
      setFeedback({
        type: 'error',
        message: 'None of the selected students have linked their user accounts yet.',
        details: 'Students must sign in at least once so their profile is linked in Supabase.'
      });
      return;
    }

    setIsSending(true);

    try {
      const res = await sendPushNotificationToUsers({
        userIds: validUserIds,
        title: title.trim(),
        body: body.trim(),
        notificationType,
        url: '/'
      });

      if (res.success) {
        let msg = `Dispatched push to ${res.delivered} active device(s)!`;
        let details: string | undefined = undefined;

        if (res.delivered === 0) {
          msg = 'No active push device subscriptions found for the selected student(s).';
          details = 'The students have not enabled push notifications on their phone or browser yet.';
        } else if (res.delivered < validUserIds.length) {
          details = `${validUserIds.length - res.delivered} student(s) did not have an active push subscription registered.`;
        }

        if (unlinkedCount > 0) {
          details = (details ? details + ' ' : '') + `(${unlinkedCount} student(s) were skipped because their profile is not yet linked).`;
        }

        setFeedback({
          type: res.delivered > 0 ? 'success' : 'warning',
          message: msg,
          details
        });

        if (onSuccess) onSuccess(res.delivered);
      } else {
        setFeedback({
          type: 'error',
          message: res.message || 'Push dispatch failed.'
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send notification.'
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSendTestToSelf = async () => {
    setIsSendingTest(true);
    setFeedback(null);
    try {
      const res = await sendTestPushNotification();
      if (res.success) {
        setFeedback({
          type: 'success',
          message: '✓ Test notification dispatched to your active device(s)!',
          details: 'Check your screen or system tray for the alert.'
        });
      } else {
        setFeedback({
          type: 'warning',
          message: res.message,
          details: 'To receive push tests, ensure you have enabled notifications on this browser via the Header Bell icon.'
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send test push.'
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-slideUp">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-ct-navy text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-ct-gold/40 flex items-center justify-center text-ct-gold">
              <BellRing className="w-5 h-5 text-ct-gold" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {singleStudent ? 'Send Student Push Notification' : 'Send Push to Absent Students'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {singleStudent
                  ? `${singleStudent.full_name} (${singleStudent.roll_number})`
                  : `Batch dispatch to ${selectedIds.length} of ${studentList.length} student(s)`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Target Student Preview (Single Mode) */}
          {singleStudent && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-ct-navy/10 flex items-center justify-center text-ct-navy font-bold">
                  <User className="w-4 h-4 text-ct-navy" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900">{singleStudent.full_name}</span>
                    <span className="font-mono text-slate-500 font-semibold">{singleStudent.roll_number}</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Hostel: {singleStudent.hostel_name || 'Assigned'} • Room: {singleStudent.room_number || 'N/A'}
                  </span>
                </div>
              </div>
              <div>
                {singleStudent.profile_id ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <Smartphone className="w-3 h-3 text-emerald-600" />
                    <span>Account Linked</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                    <span>Awaiting Link</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Batch Recipients Selector (Absent Mode) */}
          {isBatchMode && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-ct-navy" />
                  <span>Select Absent Recipients ({selectedIds.length}/{studentList.length})</span>
                </span>
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-[11px] font-bold text-ct-navy hover:underline cursor-pointer"
                >
                  {selectedIds.length === studentList.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white p-1">
                {studentList.map((s) => {
                  const isChecked = selectedIds.includes(s.id);
                  const isLinked = Boolean(s.profile_id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer hover:bg-slate-50 transition-colors ${
                        isChecked ? 'bg-amber-50/50' : ''
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleStudent(s.id)}
                          className="w-3.5 h-3.5 text-ct-navy rounded border-slate-300 focus:ring-ct-navy"
                        />
                        <span className="font-semibold text-slate-900">{s.full_name}</span>
                        <span className="font-mono text-slate-500 text-[11px]">({s.roll_number})</span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px]">
                        <span className="text-slate-500">Room {s.room_number || 'N/A'}</span>
                        {!isLinked && (
                          <span className="text-amber-700 bg-amber-100/70 px-1.5 py-0.2 rounded font-semibold">
                            Not Linked
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Template Pills */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-ct-gold" />
              <span>Quick Message Templates</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => handleTemplateSelect(tmpl.id)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                    selectedTemplate === tmpl.id
                      ? 'bg-ct-navy text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notification Title */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Notification Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. CT Hostel - Night Curfew Warning"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-ct-navy focus:outline-none"
            />
          </div>

          {/* Notification Message Body */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Message Body</label>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enter message text that will appear in the push alert banner..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-ct-navy focus:outline-none resize-none"
            />
            <p className="text-[10px] text-slate-400">
              Delivered via W3C Web Push with VAPID encryption to phone system tray &amp; desktop notifications.
            </p>
          </div>

          {/* Feedback & Delivery Results Banner */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl text-xs flex items-start space-x-2.5 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : feedback.type === 'warning'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    feedback.type === 'warning' ? 'text-amber-600' : 'text-rose-600'
                  }`}
                />
              )}
              <div className="flex-1">
                <p className="font-bold">{feedback.message}</p>
                {feedback.details && <p className="text-[11px] mt-0.5 opacity-90">{feedback.details}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleSendTestToSelf}
            disabled={isSendingTest || isSending}
            title="Sends a test push alert to your own currently logged-in browser"
            className="text-xs text-slate-600 hover:text-ct-navy font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSendingTest ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span>Send Test to My Device</span>
          </button>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSendPush}
              disabled={isSending || (isBatchMode && selectedIds.length === 0)}
              className="px-4 py-2 bg-gradient-to-r from-ct-navy to-ct-navy-light hover:from-slate-900 hover:to-ct-navy text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Dispatching...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-ct-gold" />
                  <span>
                    {singleStudent
                      ? 'Send Push Alert'
                      : `Send Push to (${selectedIds.length})`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
