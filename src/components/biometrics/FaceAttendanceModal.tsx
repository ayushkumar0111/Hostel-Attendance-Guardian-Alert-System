import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  UserCheck,
  Scan,
  MapPin,
  Navigation
} from 'lucide-react';
import { Student, AttendanceSchedule, AttendanceRecord } from '../../types/database';
import {
  extractFaceDescriptor,
  compareFaceDescriptors,
  loadFaceRecognitionModels,
  areModelsLoaded,
  getStudentFaceTemplate,
  StoredFaceTemplate
} from '../../lib/faceRecognition';
import {
  requestDeviceLocation,
  getCampusGeofenceConfig,
  validateGeofencePresence,
  GeofenceConfig
} from '../../lib/geofencing';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { getSyncedIstDate, getSyncedIstDateString } from '../../lib/serverTime';
import { sendPushNotificationToUsers } from '../../lib/webPush';

interface FaceAttendanceModalProps {
  student: Student;
  activeSchedule: AttendanceSchedule;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (record: AttendanceRecord) => void;
  onOpenEnrollment: () => void;
}

export const FaceAttendanceModal: React.FC<FaceAttendanceModalProps> = ({
  student,
  activeSchedule,
  isOpen,
  onClose,
  onSuccess,
  onOpenEnrollment
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<number | null>(null);

  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifyingStep, setVerifyingStep] = useState<
    'IDLE' | 'ANALYZING_FACE' | 'ACQUIRING_GPS' | 'VALIDATING_GEOFENCE' | 'RECORDING'
  >('IDLE');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [registeredTemplate, setRegisteredTemplate] = useState<StoredFaceTemplate | null>(null);

  const [geofenceConfig, setGeofenceConfig] = useState<GeofenceConfig | null>(null);

  const [liveFaceStatus, setLiveFaceStatus] = useState<{
    detected: boolean;
    count: number;
    message: string;
  }>({
    detected: false,
    count: 0,
    message: 'Initializing biometric scanner...'
  });

  const [verificationSuccess, setVerificationSuccess] = useState<{
    confidence: number;
    faceDistance: number;
    geofenceDistance: number;
    accuracy: number;
    hostelName: string;
    timestamp: string;
  } | null>(null);

  // Stop camera stream cleanly
  const stopCamera = () => {
    if (detectionIntervalRef.current) {
      window.clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // Start live webcam with MediaDevices API
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setVerificationError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support webcam access via MediaDevices API.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      // Periodic face detection for real-time visual indicator
      startLiveDetectionLoop();
    } catch (err: unknown) {
      const error = err as Error;
      console.warn('Camera error:', error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera permission denied. Camera access is strictly required for biometric facial identity verification. Please enable camera access in your browser settings.'
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraError(
          'No camera or webcam was found on this device. A functional camera is required for attendance roll call.'
        );
      } else if (error.name === 'NotReadableError') {
        setCameraError(
          'Webcam could not be started because it is being used by another application. Please close other camera apps and retry.'
        );
      } else {
        setCameraError(error.message || 'Unable to open camera stream. Please try again.');
      }
      setCameraActive(false);
    }
  };

  const startLiveDetectionLoop = () => {
    if (detectionIntervalRef.current) {
      window.clearInterval(detectionIntervalRef.current);
    }

    detectionIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;

      try {
        const result = await extractFaceDescriptor(videoRef.current);
        if (result.success) {
          setLiveFaceStatus({
            detected: true,
            count: 1,
            message: 'Face detected and aligned inside frame'
          });
        } else if (result.error === 'MULTIPLE_FACES') {
          setLiveFaceStatus({
            detected: false,
            count: result.faceCount,
            message: 'Multiple faces detected. Please be alone in view.'
          });
        } else {
          setLiveFaceStatus({
            detected: false,
            count: 0,
            message: 'Align your face directly within the target frame'
          });
        }
      } catch {
        // Ignored during passive loop
      }
    }, 700);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    let isMounted = true;
    (async () => {
      setIsLoadingModels(true);
      setVerificationSuccess(null);
      setVerificationError(null);
      setVerifyingStep('IDLE');

      // 1. Resolve geofence configuration for student's hostel
      const config = getCampusGeofenceConfig(student.hostel);
      setGeofenceConfig(config);

      // 2. Check enrolled biometric template
      const template = getStudentFaceTemplate(student.id, student.roll_number);
      setRegisteredTemplate(template);

      try {
        if (!areModelsLoaded()) {
          await loadFaceRecognitionModels();
        }
        if (isMounted) {
          setIsLoadingModels(false);
          if (template) {
            await startCamera();
          }
        }
      } catch (err) {
        if (isMounted) {
          setIsLoadingModels(false);
          setCameraError(
            err instanceof Error
              ? err.message
              : 'Failed to load biometric face recognition neural models.'
          );
        }
      }
    })();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, student.id]);

  // Integrated Biometric Face Match & GPS Geofencing Attendance Check-In
  const handleVerifyAndMarkAttendance = async (forceBypassWindow = false) => {
    if (!registeredTemplate) {
      setVerificationError(
        'No registered face biometric template found. Please register your face before marking attendance.'
      );
      return;
    }

    if (!videoRef.current) {
      setVerificationError('Camera feed is not ready. Please wait or reload.');
      return;
    }

    // 0. Enforce Attendance Window: 9:30 PM to 10:30 PM IST Only (Synchronized Server Time)
    const istNow = getSyncedIstDate();
    const currentIstMinutes = istNow.getHours() * 60 + istNow.getMinutes();
    const [startH, startM] = (activeSchedule.start_time || '21:30:00').split(':').map(Number);
    const [deadH, deadM] = (activeSchedule.deadline_time || '22:30:00').split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const deadlineTotal = deadH * 60 + deadM;

    const isWithinWindow = currentIstMinutes >= startTotal && currentIstMinutes <= deadlineTotal;

    if (!isWithinWindow && !forceBypassWindow) {
      const formattedIst = istNow.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      setVerificationError(
        `Attendance check-in is allowed from 9:30 PM to 10:30 PM IST only. Current time is ${formattedIst} IST. Window is closed.`
      );
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);
    setVerifyingStep('ANALYZING_FACE');

    try {
      // ========================================================================
      // STEP 1: CAPTURE FRAME & EXTRACT 128-D BIOMETRIC DESCRIPTOR
      // ========================================================================
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      }
      const snapshotUrl = canvas.toDataURL('image/jpeg', 0.85);

      const liveExtraction = await extractFaceDescriptor(videoRef.current);

      if (!liveExtraction.success || !liveExtraction.descriptor) {
        setVerificationError(
          liveExtraction.message || 'Face detection failed. Ensure good lighting and look directly into the camera.'
        );
        setIsVerifying(false);
        setVerifyingStep('IDLE');
        return;
      }

      // Compare against enrolled reference template
      const matchResult = compareFaceDescriptors(
        liveExtraction.descriptor,
        registeredTemplate.descriptor,
        0.55
      );

      if (!matchResult.isMatch) {
        // Audit rejected attempt
        try {
          await supabase.from('audit_logs').insert([
            {
              action: 'ATTENDANCE_REJECTED_FACE_MISMATCH',
              entity_type: 'attendance_records',
              entity_id: student.id,
              reason: `Face biometric mismatch: Confidence ${matchResult.confidence}%, Distance ${matchResult.distance}`,
              details: {
                student_id: student.id,
                roll_number: student.roll_number,
                distance: matchResult.distance,
                threshold: matchResult.threshold
              }
            }
          ]);
        } catch {
          // Ignored
        }

        setVerificationError(
          `Face Biometric Mismatch! The live face in the camera did not match the enrolled biometric profile for ${student.full_name}. (Confidence: ${matchResult.confidence}%, Euclidean Distance: ${matchResult.distance} exceeds limit ${matchResult.threshold}). Attendance rejected.`
        );
        setIsVerifying(false);
        setVerifyingStep('IDLE');
        return;
      }

      // ========================================================================
      // STEP 2: GPS BROWSER GEOLOCATION & CAMPUS GEOFENCE VERIFICATION
      // ========================================================================
      setVerifyingStep('ACQUIRING_GPS');

      let deviceCoords;
      try {
        deviceCoords = await requestDeviceLocation();
      } catch (geoErr: any) {
        const errorMsg = geoErr?.message || 'GPS location acquisition failed.';
        // Audit rejected location attempt
        try {
          await supabase.from('audit_logs').insert([
            {
              action: 'ATTENDANCE_REJECTED_GPS_UNAVAILABLE',
              entity_type: 'attendance_records',
              entity_id: student.id,
              reason: errorMsg,
              details: { student_id: student.id, error: errorMsg }
            }
          ]);
        } catch {
          // Ignored
        }

        setVerificationError(`Location verification blocked: ${errorMsg}`);
        setIsVerifying(false);
        setVerifyingStep('IDLE');
        return;
      }

      setVerifyingStep('VALIDATING_GEOFENCE');
      const activeConfig = geofenceConfig || getCampusGeofenceConfig(student.hostel);

      const geofenceResult = validateGeofencePresence(deviceCoords, activeConfig);

      if (!geofenceResult.isValid) {
        // Audit rejected location attempt
        try {
          await supabase.from('audit_logs').insert([
            {
              action: `ATTENDANCE_REJECTED_${geofenceResult.rejectionReason}`,
              entity_type: 'attendance_records',
              entity_id: student.id,
              reason: geofenceResult.message,
              details: {
                student_id: student.id,
                device_lat: deviceCoords.latitude,
                device_lng: deviceCoords.longitude,
                accuracy_meters: deviceCoords.accuracy,
                distance_meters: geofenceResult.distanceMeters,
                allowed_radius_meters: geofenceResult.allowedRadiusMeters
              }
            }
          ]);
        } catch {
          // Ignored
        }

        setVerificationError(geofenceResult.message);
        setIsVerifying(false);
        setVerifyingStep('IDLE');
        return;
      }

      // ========================================================================
      // STEP 3: TRUSTED SERVER-SIDE DATABASE RECORDING
      // ========================================================================
      setVerifyingStep('RECORDING');
      const configured = isSupabaseConfigured();
      if (!configured) {
        setVerificationError(
          'Supabase is not configured yet. Server attendance ledger requires live database connection.'
        );
        setIsVerifying(false);
        setVerifyingStep('IDLE');
        return;
      }

      const today = getSyncedIstDateString();
      const submittedAt = new Date().toISOString();

      // 3.1 Try Server-Side Stored Procedure (RPC) First for Trusted Backend Enforcement
      let serverRecordId: string | null = null;
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('verify_and_mark_attendance', {
          p_student_id: student.id,
          p_schedule_id: activeSchedule.id,
          p_device_lat: deviceCoords.latitude,
          p_device_lng: deviceCoords.longitude,
          p_accuracy: deviceCoords.accuracy,
          p_face_verified: true,
          p_face_confidence: matchResult.confidence,
          p_photo_path: snapshotUrl ? 'data:image/jpeg;biometric_verified_snapshot' : null
        });

        if (!rpcError && rpcData) {
          if (rpcData.success) {
            serverRecordId = rpcData.attendance_record_id;
          } else {
            setVerificationError(rpcData.message || 'Server attendance verification rejected.');
            setIsVerifying(false);
            setVerifyingStep('IDLE');
            return;
          }
        }
      } catch (rpcEx) {
        console.info('Server RPC fallback to application database client:', rpcEx);
      }

      // 3.2 If RPC was not present, execute resilient standard insert
      if (!serverRecordId) {
        const { data: record, error: insertError } = await supabase
          .from('attendance_records')
          .insert([
            {
              student_id: student.id,
              schedule_id: activeSchedule.id,
              attendance_date: today,
              status: 'PRESENT',
              submitted_at: submittedAt,
              verification_status: 'VERIFIED',
              review_reason: `VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: ${geofenceResult.distanceMeters}m, Accuracy: ±${deviceCoords.accuracy}m, Face Conf: ${matchResult.confidence}%)`
            }
          ])
          .select('*, schedule:attendance_schedules(name)')
          .single();

        if (insertError) {
          if (
            insertError.code === '23505' ||
            insertError.message.includes('unique_student_schedule_date')
          ) {
            setVerificationError(
              'Attendance for today has already been recorded for this schedule window. Duplicate check-ins are prevented.'
            );
          } else {
            setVerificationError(`Database error: ${insertError.message}`);
          }
          setIsVerifying(false);
          setVerifyingStep('IDLE');
          return;
        }

        if (record) {
          serverRecordId = record.id;
          // Insert verification evidence submission
          try {
            await supabase.from('verification_submissions').insert([
              {
                attendance_record_id: record.id,
                photo_storage_path: snapshotUrl ? 'data:image/jpeg;biometric_verified_snapshot' : null,
                device_latitude: deviceCoords.latitude,
                device_longitude: deviceCoords.longitude,
                location_accuracy_meters: deviceCoords.accuracy,
                calculated_distance_meters: geofenceResult.distanceMeters,
                client_capture_time: submittedAt,
                review_status: 'VERIFIED',
                review_notes: `Face match ${matchResult.confidence}%, Geofence distance ${geofenceResult.distanceMeters}m <= ${geofenceResult.allowedRadiusMeters}m`
              }
            ]);

            await supabase.from('audit_logs').insert([
              {
                action: 'ATTENDANCE_VERIFIED_SUCCESS',
                entity_type: 'attendance_records',
                entity_id: record.id,
                reason: `Biometric & Geofence Verified for ${student.full_name} (${student.roll_number})`,
                details: {
                  distance_meters: geofenceResult.distanceMeters,
                  accuracy_meters: deviceCoords.accuracy,
                  face_confidence: matchResult.confidence,
                  submitted_at: submittedAt
                }
              }
            ]);
          } catch (subErr) {
            console.warn('Verification submission telemetry note:', subErr);
          }
        }
      }

      // ========================================================================
      // STEP 4: VERIFICATION SUCCESS STATE
      // ========================================================================
      setVerificationSuccess({
        confidence: matchResult.confidence,
        faceDistance: matchResult.distance,
        geofenceDistance: geofenceResult.distanceMeters,
        accuracy: deviceCoords.accuracy,
        hostelName: activeConfig.hostelName || student.hostel?.name || 'Campus Hostel',
        timestamp: submittedAt
      });

      stopCamera();

      // Trigger Web Push status notification to the resident
      if (student.profile_id) {
        try {
          const formattedTime = new Date().toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          sendPushNotificationToUsers({
            userIds: [student.profile_id],
            title: 'CT Hostel - Attendance Verified',
            body: `Your attendance has been confirmed present within campus bounds at ${formattedTime} IST.`,
            notificationType: 'ATTENDANCE_VERIFIED',
            url: '/?tab=attendance',
            eventReference: `att_verified_${student.id}_${today}`
          }).catch((err) => console.warn('Attendance WebPush dispatch notice:', err));
        } catch {
          // Gracefully continue
        }
      }

      // Trigger parent callback after brief animation
      setTimeout(() => {
        onSuccess({
          id: serverRecordId || 'verified-record',
          student_id: student.id,
          schedule_id: activeSchedule.id,
          attendance_date: today,
          status: 'PRESENT',
          submitted_at: submittedAt,
          verification_status: 'VERIFIED',
          created_at: submittedAt,
          updated_at: submittedAt,
          review_reason: `VERIFIED_VIA_FACE_AND_GEOFENCE (Distance: ${geofenceResult.distanceMeters}m, Accuracy: ±${deviceCoords.accuracy}m)`
        } as AttendanceRecord);
      }, 1500);
    } catch (err: unknown) {
      setVerificationError(
        err instanceof Error ? err.message : 'An unexpected error occurred during biometric & geofence verification.'
      );
    } finally {
      setIsVerifying(false);
      setVerifyingStep('IDLE');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ct-navy to-ct-navy-light text-ct-gold flex items-center justify-center border border-ct-gold/40 shadow-sm">
              <Scan className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                Biometric &amp; Geofence Attendance
              </h3>
              <p className="text-xs text-slate-500">
                Slot: <span className="font-semibold text-slate-800">{activeSchedule.name}</span>
                {' '}• Window: <span className="font-mono text-slate-700">{activeSchedule.start_time} – {activeSchedule.deadline_time}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="mt-4 space-y-4">
          {/* Case 1: No Face Template Enrolled */}
          {!registeredTemplate ? (
            <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto border border-amber-300">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-950">
                  Biometric Face Enrollment Required
                </h4>
                <p className="text-xs text-amber-800 mt-1 max-w-sm mx-auto leading-relaxed">
                  You have not enrolled your reference facial biometric template yet. Institutional roll-call attendance requires a verified reference face profile.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onOpenEnrollment();
                  }}
                  className="px-4 py-2.5 bg-ct-gold hover:bg-ct-gold-dark text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Enroll Face Biometrics Now</span>
                </button>
              </div>
            </div>
          ) : isLoadingModels ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 bg-slate-50 rounded-2xl border border-slate-200">
              <RefreshCw className="w-8 h-8 text-ct-navy animate-spin" />
              <p className="text-xs font-bold text-slate-700">Loading Biometric Neural Networks...</p>
              <p className="text-[11px] text-slate-500 max-w-xs text-center">
                Preparing face recognition matching models...
              </p>
            </div>
          ) : verificationSuccess ? (
            <div className="py-6 px-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto border-2 border-emerald-300 shadow-md">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-black text-emerald-950">
                  Face &amp; Geofence Verified! Attendance Marked
                </h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Recorded status: <span className="font-bold">PRESENT</span>
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-left bg-white p-3 rounded-xl border border-emerald-200 text-xs">
                  <div className="p-2 rounded-lg bg-emerald-50/60">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Face Match</span>
                    <span className="font-mono font-bold text-emerald-800">{verificationSuccess.confidence}% Confidence</span>
                    <span className="text-[10px] text-slate-400 block">Distance {verificationSuccess.faceDistance}</span>
                  </div>

                  <div className="p-2 rounded-lg bg-emerald-50/60">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Hostel Geofence</span>
                    <span className="font-mono font-bold text-emerald-800">{verificationSuccess.geofenceDistance}m from Center</span>
                    <span className="text-[10px] text-slate-400 block">GPS Accuracy ±{verificationSuccess.accuracy}m</span>
                  </div>
                </div>

                <div className="mt-2 text-[10px] text-slate-400 font-mono">
                  Server Timestamp: {new Date(verificationSuccess.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ) : cameraError ? (
            <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
              <div className="flex items-center space-x-2 text-rose-800 font-bold text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Camera Verification Blocked</span>
              </div>
              <p className="text-xs text-rose-700 leading-relaxed">{cameraError}</p>
              <button
                onClick={startCamera}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Camera</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Camera Video Viewport */}
              <div className="relative w-full aspect-video bg-slate-950 rounded-2xl overflow-hidden shadow-inner border-2 border-slate-700 flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className="w-full h-full object-cover transform scale-x-[-1]"
                />

                {/* Biometric Oval Alignment Reticle Overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div
                    className={`w-44 h-56 rounded-[50%] border-2 transition-all duration-300 flex items-center justify-center ${
                      liveFaceStatus.detected
                        ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.5)] bg-emerald-500/10'
                        : liveFaceStatus.count > 1
                        ? 'border-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.5)] bg-rose-500/10'
                        : 'border-ct-gold/70 shadow-[0_0_15px_rgba(245,158,11,0.3)] bg-ct-gold/5'
                    }`}
                  >
                    <div className="w-full h-0.5 bg-ct-gold/40 animate-pulse" />
                  </div>
                </div>

                {/* Live Floating Status Badge */}
                <div className="absolute bottom-3 inset-x-4 flex items-center justify-between pointer-events-none">
                  <div
                    className={`px-3 py-1 rounded-full text-[11px] font-bold backdrop-blur-md flex items-center gap-1.5 shadow-md ${
                      liveFaceStatus.detected
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-400/50'
                        : liveFaceStatus.count > 1
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-400/50'
                        : 'bg-slate-950/80 text-amber-300 border border-amber-400/50'
                    }`}
                  >
                    {liveFaceStatus.detected ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>{liveFaceStatus.message}</span>
                  </div>

                  <div className="px-2 py-1 rounded bg-black/60 text-slate-300 text-[10px] font-mono">
                    LIVE FEED
                  </div>
                </div>
              </div>

              {/* Dual Gate Indicator: Face Recognition + GPS Geofence */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center space-x-1.5 text-slate-700 font-semibold mb-0.5">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Gate 1: Face Match</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Template: <span className="font-bold text-slate-700">Enrolled</span>
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center space-x-1.5 text-slate-700 font-semibold mb-0.5">
                    <MapPin className="w-3.5 h-3.5 text-ct-gold" />
                    <span>Gate 2: Geofence</span>
                  </div>
                  <span className="text-[11px] text-slate-500 truncate block">
                    Hostel: <span className="font-bold text-slate-700">{geofenceConfig?.hostelName || student.hostel?.name || 'Campus'}</span>
                  </span>
                </div>
              </div>

              {verificationError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{verificationError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {registeredTemplate && !verificationSuccess && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleVerifyAndMarkAttendance(false)}
                disabled={!cameraActive || isVerifying}
                className="px-5 py-2.5 text-xs font-black bg-ct-gold hover:bg-ct-gold-dark text-slate-950 rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>
                      {verifyingStep === 'ANALYZING_FACE' && 'Analyzing Face Biometrics...'}
                      {verifyingStep === 'ACQUIRING_GPS' && 'Acquiring GPS Coordinates...'}
                      {verifyingStep === 'VALIDATING_GEOFENCE' && 'Validating Geofence Boundary...'}
                      {verifyingStep === 'RECORDING' && 'Saving Attendance to Server...'}
                      {verifyingStep === 'IDLE' && 'Processing Verification...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Navigation className="w-4 h-4 text-slate-950" />
                    <span>Verify Face &amp; Location (9:30–10:30 PM IST)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
