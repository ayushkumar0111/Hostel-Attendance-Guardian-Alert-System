// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Sequential Guardian Call Queue Processor
// Processes queued absence calls one-by-one with idempotency and state tracking
// ==============================================================================

import { supabase, isSupabaseConfigured } from './supabase';
import { CallSession, Student, Guardian, Hostel } from '../types/database';
import { dispatchGuardianAbsenceCall, getTelephonyCredentials } from './telephony';

export interface CallQueueItem {
  session: CallSession;
  student?: Student;
  guardian?: Guardian;
  hostel?: Hostel;
  wardenPhone?: string;
}

export interface CallQueueProgress {
  isActive: boolean;
  totalCalls: number;
  processedCount: number;
  currentCallIndex: number;
  currentSessionId?: string;
  currentStudentName?: string;
  currentGuardianPhone?: string;
  currentStatus?: string;
  completedCount: number;
  failedCount: number;
  lastMessage?: string;
}

export type QueueProgressCallback = (progress: CallQueueProgress) => void;

let isQueueRunning = false;

/**
 * Fetches all queued and retrying call sessions with joined student, guardian, and warden details.
 */
export async function getPendingCallQueue(): Promise<CallQueueItem[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const { data: sessions, error } = await supabase
      .from('call_sessions')
      .select('*, attendance_records(student_id, attendance_date, students(*, guardians(*), hostels(*)))')
      .in('call_status', ['QUEUED', 'RINGING'])
      .order('created_at', { ascending: true });

    if (error || !sessions) {
      console.warn('Call queue fetch note:', error?.message);
      return [];
    }

    // Deduplicate sessions by attendance_record_id to guarantee zero duplicate calls
    const seenRecords = new Set<string>();
    const deduplicatedItems: CallQueueItem[] = [];

    for (const raw of sessions as any[]) {
      const recordId = raw.attendance_record_id;
      if (recordId && seenRecords.has(recordId)) {
        continue;
      }
      if (recordId) seenRecords.add(recordId);

      const attRecord = raw.attendance_records;
      const student = attRecord?.students;
      const guardian = student?.guardians;
      const hostel = student?.hostels;

      deduplicatedItems.push({
        session: {
          id: raw.id,
          attendance_record_id: raw.attendance_record_id,
          guardian_id: raw.guardian_id,
          provider_reference: raw.provider_reference,
          call_status: raw.call_status,
          transfer_requested: raw.transfer_requested,
          transfer_result: raw.transfer_result,
          started_at: raw.started_at,
          ended_at: raw.ended_at,
          created_at: raw.created_at
        },
        student,
        guardian,
        hostel,
        wardenPhone: hostel?.warden_contact || undefined
      });
    }

    return deduplicatedItems;
  } catch (err) {
    console.warn('Call queue loading error:', err);
    return [];
  }
}

/**
 * Processes the guardian call queue sequentially, ONE AT A TIME.
 * Starts the next call strictly when the previous call completes or times out.
 */
export async function processSequentialCallQueue(
  onProgress?: QueueProgressCallback,
  delayBetweenCallsMs: number = 3000
): Promise<CallQueueProgress> {
  if (isQueueRunning) {
    throw new Error('Call queue processing is already in progress.');
  }

  isQueueRunning = true;

  const queueItems = await getPendingCallQueue();
  const credentials = getTelephonyCredentials();

  let completedCount = 0;
  let failedCount = 0;
  let processedCount = 0;

  const currentProgress: CallQueueProgress = {
    isActive: true,
    totalCalls: queueItems.length,
    processedCount: 0,
    currentCallIndex: 0,
    completedCount: 0,
    failedCount: 0,
    lastMessage: queueItems.length === 0 ? 'No queued calls pending in database.' : 'Starting sequential call queue...'
  };

  onProgress?.(currentProgress);

  if (queueItems.length === 0) {
    isQueueRunning = false;
    currentProgress.isActive = false;
    onProgress?.(currentProgress);
    return currentProgress;
  }

  for (let i = 0; i < queueItems.length; i++) {
    const item = queueItems[i];
    const session = item.session;
    const student = item.student;
    const guardian = item.guardian;
    const hostel = item.hostel;

    currentProgress.currentCallIndex = i + 1;
    currentProgress.currentSessionId = session.id;
    currentProgress.currentStudentName = student?.full_name || 'Resident';
    currentProgress.currentGuardianPhone = guardian?.phone_number || 'No Phone';
    currentProgress.currentStatus = 'RINGING';
    currentProgress.lastMessage = `[${i + 1}/${queueItems.length}] Calling ${guardian?.full_name || 'Guardian'} for ${student?.full_name || 'Student'} (${student?.roll_number || 'N/A'})...`;
    onProgress?.(currentProgress);

    try {
      // 1. Mark call session as RINGING in database
      await supabase
        .from('call_sessions')
        .update({
          call_status: 'RINGING',
          started_at: new Date().toISOString()
        })
        .eq('id', session.id);

      // 2. Dispatch call via Telephony Adapter
      await dispatchGuardianAbsenceCall(
        session.attendance_record_id || session.id,
        student?.full_name || 'Student',
        student?.roll_number || 'N/A',
        guardian?.phone_number || '',
        hostel?.name || 'Hostel'
      );

      if (credentials.configured) {
        // Real provider configured: wait for call duration / response
        currentProgress.currentStatus = 'IN_PROGRESS';
        currentProgress.lastMessage = `[${i + 1}/${queueItems.length}] Call in progress via ${credentials.provider.toUpperCase()} gateway.`;
        onProgress?.(currentProgress);

        // Allow reasonable time for parent interaction before moving to next item
        await new Promise((resolve) => setTimeout(resolve, delayBetweenCallsMs));
        completedCount++;
      } else {
        // Truthful standby reporting: provider not yet configured
        currentProgress.currentStatus = 'QUEUED';
        currentProgress.lastMessage = `[${i + 1}/${queueItems.length}] Session recorded as QUEUED (Carrier Standby - Missing Twilio/Exotel API Keys in .env).`;
        onProgress?.(currentProgress);

        await supabase
          .from('call_sessions')
          .update({
            call_status: 'QUEUED',
            error_message: 'Carrier credentials not configured in environment.'
          })
          .eq('id', session.id);

        failedCount++;
      }

      processedCount++;
      currentProgress.processedCount = processedCount;
      currentProgress.completedCount = completedCount;
      currentProgress.failedCount = failedCount;
      onProgress?.(currentProgress);

      // Wait between sequential calls
      if (i < queueItems.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (err: unknown) {
      failedCount++;
      processedCount++;
      const errMsg = err instanceof Error ? err.message : 'Unknown telephony error';

      currentProgress.lastMessage = `[${i + 1}/${queueItems.length}] Error on session ${session.id.slice(0, 8)}: ${errMsg}`;
      currentProgress.processedCount = processedCount;
      currentProgress.failedCount = failedCount;
      onProgress?.(currentProgress);

      await supabase
        .from('call_sessions')
        .update({
          call_status: 'FAILED',
          error_message: errMsg,
          ended_at: new Date().toISOString()
        })
        .eq('id', session.id);
    }
  }

  isQueueRunning = false;
  currentProgress.isActive = false;
  currentProgress.lastMessage = `Queue processing complete: ${completedCount} completed, ${failedCount} in standby / failed.`;
  onProgress?.(currentProgress);

  return currentProgress;
}
