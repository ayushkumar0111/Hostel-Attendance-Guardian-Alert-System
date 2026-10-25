import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  AlertCircle,
  CheckCircle2,
  Shield,
  RefreshCw,
  X,
  UserCheck
} from 'lucide-react';
import { Student } from '../../types/database';
import {
  extractFaceDescriptor,
  loadFaceRecognitionModels,
  areModelsLoaded,
  saveStudentFaceTemplate,
  StoredFaceTemplate
} from '../../lib/faceRecognition';
import { useAuth } from '../../context/AuthContext';

interface FaceEnrollmentModalProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (template: StoredFaceTemplate) => void;
}

export const FaceEnrollmentModal: React.FC<FaceEnrollmentModalProps> = ({
  student,
  isOpen,
  onClose,
  onSuccess
}) => {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<number | null>(null);

  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveFaceStatus, setLiveFaceStatus] = useState<{
    detected: boolean;
    count: number;
    message: string;
  }>({
    detected: false,
    count: 0,
    message: 'Initializing biometric scanner...'
  });

  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  // Stop camera tracks cleanly
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

  // Start live webcam
  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setEnrollmentError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera access via MediaDevices API.');
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

      // Begin periodic live detection for real-time visual feedback
      startLiveDetectionLoop();
    } catch (err: unknown) {
      const error = err as Error;
      console.warn('Camera error:', error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera access was denied by your browser. Please allow camera permissions in your browser address bar to enroll your face biometric.'
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraError(
          'No camera or webcam hardware was detected on this device. Please connect an operational camera.'
        );
      } else if (error.name === 'NotReadableError') {
        setCameraError(
          'Camera is in use by another application. Please close other applications using the webcam and retry.'
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
            message: 'Position your face clearly within the oval frame'
          });
        }
      } catch {
        // Ignored during periodic frames
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
      try {
        if (!areModelsLoaded()) {
          await loadFaceRecognitionModels();
        }
        if (isMounted) {
          setIsLoadingModels(false);
          await startCamera();
        }
      } catch (err) {
        if (isMounted) {
          setIsLoadingModels(false);
          setCameraError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize biometric recognition neural networks.'
          );
        }
      }
    })();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen]);

  const handleCaptureAndEnroll = async () => {
    if (!consentChecked) {
      setEnrollmentError('You must confirm consent to register your facial biometric template.');
      return;
    }

    if (!videoRef.current) {
      setEnrollmentError('Webcam stream is not ready. Please wait a moment or restart the camera.');
      return;
    }

    setIsProcessing(true);
    setEnrollmentError(null);

    try {
      // 1. Capture snapshot to canvas for image preview
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      }
      const snapshotUrl = canvas.toDataURL('image/jpeg', 0.85);

      // 2. Extract biometric 128-float descriptor vector
      const extraction = await extractFaceDescriptor(videoRef.current);

      if (!extraction.success || !extraction.descriptor) {
        setEnrollmentError(
          extraction.message || 'Face detection failed. Ensure good lighting and look directly into the camera.'
        );
        setIsProcessing(false);
        return;
      }

      // 3. Assemble biometric template
      const template: StoredFaceTemplate = {
        studentId: student.id,
        studentName: student.full_name,
        rollNumber: student.roll_number,
        descriptor: extraction.descriptor,
        photoDataUrl: snapshotUrl,
        registeredAt: new Date().toISOString(),
        consentSigned: true,
        version: '1.0'
      };

      // 4. Persist in storage & audit ledger
      await saveStudentFaceTemplate(template, user?.id);

      stopCamera();
      onSuccess(template);
    } catch (err: unknown) {
      setEnrollmentError(
        err instanceof Error ? err.message : 'An error occurred while saving the biometric template.'
      );
    } finally {
      setIsProcessing(false);
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
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                Register Face Biometrics
              </h3>
              <p className="text-xs text-slate-500">
                Resident: <span className="font-semibold text-slate-800">{student.full_name}</span> ({student.roll_number})
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
          {isLoadingModels ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 bg-slate-50 rounded-2xl border border-slate-200">
              <RefreshCw className="w-8 h-8 text-ct-navy animate-spin" />
              <p className="text-xs font-bold text-slate-700">Loading AI Biometric Neural Networks...</p>
              <p className="text-[11px] text-slate-500 max-w-xs text-center">
                Initializing Tiny Face Detector and landmark extractor from local cache...
              </p>
            </div>
          ) : cameraError ? (
            <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
              <div className="flex items-center space-x-2 text-rose-800 font-bold text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Camera Activation Failed</span>
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
              {/* Camera Video Viewport with Biometric Overlay */}
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

              {/* Instructions */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-ct-navy" />
                  <span>Biometric Enrollment Guidelines:</span>
                </p>
                <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5 pl-1">
                  <li>Position your face upright inside the central guide oval.</li>
                  <li>Ensure your face is well-lit without strong backlight or shadows.</li>
                  <li>Remove sunglasses, heavy face coverings, or hats.</li>
                </ul>
              </div>

              {/* Legal Biometric Consent Checkbox */}
              <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 space-y-2">
                <label className="flex items-start space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-ct-navy focus:ring-ct-navy border-slate-300"
                  />
                  <span className="text-[11px] text-amber-900 leading-snug">
                    <strong>Resident Biometric Consent:</strong> I explicitly consent to the extraction and secure storage of a 128-dimensional mathematical facial descriptor template for automated daily hostel roll-call attendance verification.
                  </span>
                </label>
              </div>

              {enrollmentError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{enrollmentError}</span>
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

          <button
            type="button"
            onClick={handleCaptureAndEnroll}
            disabled={!cameraActive || isProcessing || !consentChecked}
            className="px-5 py-2.5 text-xs font-black bg-ct-gold hover:bg-ct-gold-dark text-slate-950 rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                <span>Processing Neural Template...</span>
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4 text-slate-950" />
                <span>Capture &amp; Enroll Face</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
