// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Guardian Portal & In-App Notification Center
// Built by Ayush Kumar | Developed for CT Group of Institutions
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Guardian, Student, GuardianNotification, AttendanceRecord } from '../../types/database';
import {
  Bell,
  CheckCircle2,
  Clock,
  AlertTriangle,
  GraduationCap,
  Building2,
  Phone,
  Calendar,
  CheckCheck,
  RefreshCw,
  Shield,
  Eye,
  X,
  Copy,
  Check,
  Link as LinkIcon
} from 'lucide-react';

export const GuardianDashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const configured = isSupabaseConfigured();

  // State
  const [guardianRecord, setGuardianRecord] = useState<Guardian | null>(null);
  const [linkedStudent, setLinkedStudent] = useState<Student | null>(null);
  const [notifications, setNotifications] = useState<GuardianNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<{
    notice: GuardianNotification;
    record?: AttendanceRecord | null;
  } | null>(null);
  const [isFetchingDetail, setIsFetchingDetail] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<boolean>(false);

  // Self-Service Roster Link Modal State (for guardians not yet linked)
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [linkRollNumber, setLinkRollNumber] = useState<string>('');
  const [linkPhone, setLinkPhone] = useState<string>('');
  const [isLinking, setIsLinking] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  // Load Guardian Profile, Linked Ward, and Notifications
  const loadGuardianData = async () => {
    if (!configured) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setActionFeedback(null);

    try {
      let currentGuardian: Guardian | null = null;

      // 1. Find guardian linked to this auth profile
      if (user) {
        const { data: gData } = await supabase
          .from('guardians')
          .select('*')
          .eq('profile_id', user.id)
          .maybeSingle();

        if (gData) {
          currentGuardian = gData as Guardian;
        } else if (user.email) {
          // Fallback: match by email if profile_id not set yet
          const { data: gEmail } = await supabase
            .from('guardians')
            .select('*')
            .eq('email', user.email)
            .maybeSingle();

          if (gEmail) {
            currentGuardian = gEmail as Guardian;
            // Auto-bind profile_id
            await supabase
              .from('guardians')
              .update({ profile_id: user.id })
              .eq('id', gEmail.id);
          }
        }
      }

      setGuardianRecord(currentGuardian);

      // 2. Fetch linked student if guardian is identified
      if (currentGuardian) {
        const { data: sData } = await supabase
          .from('students')
          .select('*, hostels(*)')
          .eq('guardian_id', currentGuardian.id)
          .maybeSingle();

        if (sData) {
          setLinkedStudent(sData as Student);
        }

        // 3. Fetch in-app notifications for this guardian
        const { data: notifData, error: nErr } = await supabase
          .from('guardian_notifications')
          .select('*, student:students(*, hostels(*))')
          .eq('guardian_id', currentGuardian.id)
          .order('created_at', { ascending: false });

        if (!nErr && notifData) {
          const list = notifData as GuardianNotification[];
          setNotifications(list);
          setUnreadCount(list.filter((n) => !n.is_read).length);
        }
      } else {
        // Unlinked or preview mode: check if any student has this guardian phone or show demo notifications
        if (profile?.phone_number) {
          const { data: gPhone } = await supabase
            .from('guardians')
            .select('*')
            .eq('phone_number', profile.phone_number)
            .maybeSingle();

          if (gPhone) {
            setGuardianRecord(gPhone as Guardian);
            const { data: sData } = await supabase
              .from('students')
              .select('*, hostels(*)')
              .eq('guardian_id', gPhone.id)
              .maybeSingle();
            if (sData) setLinkedStudent(sData as Student);
          }
        }
      }
    } catch (err) {
      console.warn('Error loading guardian data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGuardianData();

    // Set up Realtime subscription for instant in-app alerts
    if (configured && guardianRecord?.id) {
      const channel = supabase
        .channel(`guardian-notifs-${guardianRecord.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'guardian_notifications',
            filter: `guardian_id=eq.${guardianRecord.id}`
          },
          (payload) => {
            const newNotif = payload.new as GuardianNotification;
            setNotifications((prev) => [newNotif, ...prev]);
            setUnreadCount((c) => c + 1);
            setActionFeedback('New hostel attendance notification received!');
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [configured, user, guardianRecord?.id]);

  // Mark single notification as read
  const handleMarkAsRead = async (notificationId: string) => {
    const updatedNotifs = notifications.map((n) =>
      n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
    );
    setNotifications(updatedNotifs);
    setUnreadCount(updatedNotifs.filter((n) => !n.is_read).length);

    try {
      await supabase
        .from('guardian_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
    } catch (err) {
      console.warn('Failed to mark notification as read:', err);
    }
  };

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    if (!guardianRecord) return;

    const updatedNotifs = notifications.map((n) => ({
      ...n,
      is_read: true,
      read_at: new Date().toISOString()
    }));
    setNotifications(updatedNotifs);
    setUnreadCount(0);
    setActionFeedback('All notifications marked as read.');

    try {
      // Try RPC first
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('mark_all_guardian_notifications_read', {
        p_guardian_id: guardianRecord.id
      });

      if (rpcErr || !rpcRes) {
        // Fallback update
        await supabase
          .from('guardian_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('guardian_id', guardianRecord.id)
          .eq('is_read', false);
      }
    } catch (err) {
      console.warn('Failed to mark all as read:', err);
    }
  };

  // View details modal
  const handleViewDetails = async (notice: GuardianNotification) => {
    setSelectedRecordForDetail({ notice, record: null });
    setIsFetchingDetail(true);

    // If unread, mark read automatically when inspected
    if (!notice.is_read) {
      handleMarkAsRead(notice.id);
    }

    if (notice.attendance_record_id) {
      try {
        const { data: attData } = await supabase
          .from('attendance_records')
          .select('*, schedule:attendance_schedules(*), student:students(*, hostels(*))')
          .eq('id', notice.attendance_record_id)
          .maybeSingle();

        if (attData) {
          setSelectedRecordForDetail({ notice, record: attData as AttendanceRecord });
        }
      } catch (err) {
        console.warn('Detail fetch note:', err);
      }
    }
    setIsFetchingDetail(false);
  };

  // Copy Profile UUID helper
  const handleCopyUuid = () => {
    if (!user) return;
    navigator.clipboard.writeText(user.id);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2500);
  };

  // Self-Service Roster Link Submission
  const handleSelfServiceLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLinkError(null);
    setLinkSuccess(null);
    setIsLinking(true);

    try {
      // Find student by roll number
      const { data: student, error: stErr } = await supabase
        .from('students')
        .select('*, guardians(*)')
        .ilike('roll_number', linkRollNumber.trim())
        .maybeSingle();

      if (stErr || !student) {
        setLinkError(`No student roster record found with Roll Number "${linkRollNumber.trim()}". Please verify with hostel warden.`);
        setIsLinking(false);
        return;
      }

      const guardian = student.guardians;
      if (!guardian) {
        setLinkError('This student does not have a registered guardian profile on file. Please contact administration.');
        setIsLinking(false);
        return;
      }

      // Verification: Check if phone matches last 4 digits or exact
      const enteredPhoneClean = linkPhone.replace(/\D/g, '');
      const recordPhoneClean = (guardian.phone_number || '').replace(/\D/g, '');

      if (enteredPhoneClean.length >= 4 && !recordPhoneClean.endsWith(enteredPhoneClean)) {
        setLinkError(`The phone number entered does not match the emergency contact number on file for ${student.full_name}.`);
        setIsLinking(false);
        return;
      }

      // Link guardian record to authenticated user profile
      const { error: linkErr } = await supabase
        .from('guardians')
        .update({
          profile_id: user.id,
          email: user.email || guardian.email
        })
        .eq('id', guardian.id);

      if (linkErr) {
        throw linkErr;
      }

      setLinkSuccess(`Successfully linked to ${student.full_name} (${student.roll_number})!`);
      setShowLinkModal(false);
      loadGuardianData();
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'Linking failed. Please contact hostel administration.');
    } finally {
      setIsLinking(false);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'unread') return !n.is_read;
    if (filter === 'read') return n.is_read;
    return true;
  });

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-3">
        <div className="w-10 h-10 border-4 border-amber-600 border-t-amber-200 rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Loading Guardian Portal...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Identity */}
      <div className="bg-gradient-to-r from-slate-900 via-ct-navy to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-md bg-amber-400 text-slate-950 border border-amber-300">
                Guardian Portal
              </span>
              <span className="text-xs text-slate-300 font-medium">
                CT Group of Institutions — Hostel Security
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {guardianRecord?.full_name ? `Welcome, ${guardianRecord.full_name}` : 'Guardian Attendance & Alert Center'}
            </h1>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Track your ward&apos;s daily curfew roll-call attendance, receive automated instant absence notices, and directly connect with hostel administration.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={loadGuardianData}
              className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition-colors shadow-sm"
              title="Refresh attendance records"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Feedback message */}
        {actionFeedback && (
          <div className="mt-4 p-2.5 rounded-lg bg-emerald-900/60 border border-emerald-500/50 text-emerald-200 text-xs flex items-center justify-between">
            <span>{actionFeedback}</span>
            <button onClick={() => setActionFeedback(null)} className="text-emerald-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 2. Unlinked State Banner (If guardian account is not yet connected to a student record) */}
      {!guardianRecord && (
        <div className="p-6 bg-amber-50 rounded-2xl border-2 border-amber-200 shadow-sm space-y-4">
          <div className="flex items-start space-x-3">
            <div className="p-2.5 bg-amber-100 rounded-xl text-amber-800 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-amber-950">Awaiting Student Roster Link</h3>
              <p className="text-xs text-amber-900/80 leading-relaxed">
                Your authenticated account is not yet connected to your ward&apos;s institutional student record. Once linked, you will see your ward&apos;s room allocation, attendance history, and receive instant in-app alerts.
              </p>
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">Registered Email</span>
              <span className="font-mono font-bold text-slate-800">{user?.email || 'N/A'}</span>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">Your Profile UUID</span>
              <div className="flex items-center space-x-2">
                <span className="font-mono font-bold text-purple-900 truncate">{user?.id || 'N/A'}</span>
                {user && (
                  <button
                    onClick={handleCopyUuid}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors shrink-0"
                    title="Copy Profile UUID"
                  >
                    {copiedUuid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={() => setShowLinkModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-sm transition-colors"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>Link Ward via Roll Number</span>
            </button>
            <span className="text-xs text-slate-500">
              Or provide your Profile UUID to the Hostel Warden for instant administrative linking.
            </span>
          </div>
        </div>
      )}

      {/* 3. Linked Student Summary Card */}
      {linkedStudent && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-100 gap-2">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200 font-bold">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{linkedStudent.full_name}</h3>
                <p className="text-xs text-slate-500">
                  Roll No: <span className="font-mono font-semibold text-slate-800">{linkedStudent.roll_number}</span> • Dept: {linkedStudent.department}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
                Active Resident
              </span>
              <span className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 rounded-lg">
                Relation: {guardianRecord?.relationship || 'Guardian'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Hostel Name</span>
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-ct-navy" />
                {linkedStudent.hostel?.name || (linkedStudent.hostels as any)?.name || 'Campus Hostel'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Allocated Room</span>
              <span className="font-bold text-slate-800">Room {linkedStudent.room_number || 'TBD'}</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Roll-Call Window</span>
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                21:30 - 22:30 IST
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Warden Duty Contact</span>
              <a
                href={`tel:${linkedStudent.hostel?.warden_contact || '+91-181-2955999'}`}
                className="font-bold font-mono text-purple-700 hover:underline flex items-center gap-1"
              >
                <Phone className="w-3.5 h-3.5" />
                {linkedStudent.hostel?.warden_contact || '+91-181-2955999'}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 4. Guardian In-App Notifications Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Section Header with Unread Badge & Filters */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                <Bell className="w-5 h-5" />
              </div>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-pulse">
                  {unreadCount}
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">Attendance Notifications</h2>
                {unreadCount > 0 ? (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                    {unreadCount} Unread
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-slate-100 text-slate-600">
                    All caught up
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Official absence alerts triggered at 22:31 IST for unrecorded roll-calls
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Filter buttons */}
            <div className="flex p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filter === 'unread' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'
                }`}
              >
                Unread ({unreadCount})
              </button>
              <button
                onClick={() => setFilter('read')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  filter === 'read' ? 'bg-white text-slate-900 shadow-sm' : 'hover:text-slate-900'
                }`}
              >
                Read ({notifications.length - unreadCount})
              </button>
            </div>

            {/* Mark all as read button */}
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors border border-slate-200 shrink-0"
                title="Mark all notifications as read"
              >
                <CheckCheck className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">Mark All as Read</span>
              </button>
            )}
          </div>
        </div>

        {/* Notification List */}
        {filteredNotifications.length === 0 ? (
          /* 5. Helpful Empty State */
          <div className="p-12 text-center space-y-3">
            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto border border-emerald-200 text-emerald-600 shadow-sm">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-800">
              {filter === 'unread' ? 'No Unread Notifications' : 'No Absence Notifications on Record'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              {filter === 'unread'
                ? 'All roll-call notifications have been marked as read.'
                : 'All hostel roll-calls for your ward are recorded as Present or approved sanctioned leave. Any unrecorded absence at 22:31 IST will appear here automatically.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredNotifications.map((notice) => {
              const studentName = notice.student?.full_name || linkedStudent?.full_name || 'Your Ward';
              const formattedDate = new Date(notice.attendance_date).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              });
              const formattedTime = new Date(notice.created_at).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Kolkata'
              });

              return (
                <div
                  key={notice.id}
                  className={`p-5 transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                    notice.is_read ? 'bg-white hover:bg-slate-50/70' : 'bg-rose-50/30 hover:bg-rose-50/50'
                  }`}
                >
                  <div className="flex items-start space-x-3.5">
                    {/* Status Dot */}
                    <div className="pt-0.5 shrink-0">
                      {!notice.is_read ? (
                        <div className="w-3 h-3 rounded-full bg-rose-600 border-2 border-white shadow-sm ring-2 ring-rose-200" title="Unread" />
                      ) : (
                        <div className="w-3 h-3 rounded-full bg-slate-300" title="Read" />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{notice.title}</span>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {studentName}
                        </span>
                        <span className="text-[11px] font-semibold text-rose-700 bg-rose-100/70 px-2 py-0.5 rounded border border-rose-200 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formattedDate}
                        </span>
                      </div>

                      {/* Official Message in Hindi */}
                      <p className="text-xs text-slate-700 leading-relaxed font-normal bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs">
                        {notice.message}
                      </p>

                      <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Generated at {formattedTime} IST
                        </span>
                        <span>•</span>
                        <span>
                          {notice.is_read ? (
                            <span className="text-emerald-700 font-medium">Read</span>
                          ) : (
                            <span className="text-rose-700 font-bold">Unread</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 shrink-0 self-end sm:self-start">
                    <button
                      onClick={() => handleViewDetails(notice)}
                      className="flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                      <span>View Details</span>
                    </button>

                    {!notice.is_read && (
                      <button
                        onClick={() => handleMarkAsRead(notice.id)}
                        className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg border border-emerald-200 transition-colors"
                        title="Mark as Read"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Mark Read</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Detail & Attendance Record Modal */}
      {selectedRecordForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-ct-navy" />
                <h3 className="text-sm font-bold text-slate-900">Hostel Attendance Record Detail</h3>
              </div>
              <button
                onClick={() => setSelectedRecordForDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Absence Alert Message</span>
                <p className="text-slate-800 leading-relaxed">{selectedRecordForDetail.notice.message}</p>
              </div>

              {isFetchingDetail ? (
                <div className="py-6 text-center text-slate-400">Loading attendance telemetry...</div>
              ) : selectedRecordForDetail.record ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Attendance Date</span>
                      <span className="font-bold text-slate-800">{selectedRecordForDetail.record.attendance_date}</span>
                    </div>
                    <div className="p-2.5 bg-rose-50 rounded-lg border border-rose-100">
                      <span className="text-[10px] text-rose-500 uppercase font-semibold block">Recorded Status</span>
                      <span className="font-black text-rose-700">{selectedRecordForDetail.record.status}</span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">System Review Notes</span>
                    <span className="font-medium text-slate-700">
                      {selectedRecordForDetail.record.review_reason || 'Automated roll-call finalization cutoff.'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-amber-50 text-amber-900 border border-amber-200">
                  Attendance record details are archived or pending server synchronization.
                </div>
              )}

              <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-1">
                <span className="font-bold text-purple-950 block">Need Clarification?</span>
                <p className="text-purple-900 leading-normal">
                  If your ward was present or on approved sanctioned leave, contact the hostel duty warden directly:
                </p>
                <a
                  href={`tel:${linkedStudent?.hostel?.warden_contact || '+91-181-2955999'}`}
                  className="font-bold font-mono text-purple-800 hover:underline inline-flex items-center gap-1 mt-1"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {linkedStudent?.hostel?.warden_contact || '+91-181-2955999'}
                </a>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedRecordForDetail(null)}
                className="px-4 py-2 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Self-Service Roster Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <LinkIcon className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Link Student Roster Record</h3>
              </div>
              <button
                onClick={() => setShowLinkModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {linkError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{linkError}</span>
              </div>
            )}

            {linkSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{linkSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSelfServiceLink} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Student Institutional Roll Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2404391"
                  value={linkRollNumber}
                  onChange={(e) => setLinkRollNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Registered Guardian Emergency Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 98765 43210 or last 4 digits"
                  value={linkPhone}
                  onChange={(e) => setLinkPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Must match the emergency contact number provided during hostel admission.
                </span>
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLinking}
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isLinking ? 'Verifying...' : 'Verify & Link Ward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
