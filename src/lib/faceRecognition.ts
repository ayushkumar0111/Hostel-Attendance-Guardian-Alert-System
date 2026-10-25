// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Biometric Face Recognition & Identity Verification Service
// Built using @vladmandic/face-api with Tiny Face Detector + 68 Landmarks
// ==============================================================================

import * as faceapi from '@vladmandic/face-api';
import { supabase } from './supabase';

export interface FaceVerificationResult {
  isMatch: boolean;
  distance: number;
  confidence: number;
  threshold: number;
  message: string;
}

export interface FaceExtractionResult {
  success: boolean;
  descriptor?: number[];
  faceCount: number;
  error?: 'NO_FACE_DETECTED' | 'MULTIPLE_FACES' | 'DETECTION_FAILED';
  message: string;
}

export interface StoredFaceTemplate {
  studentId: string;
  studentName: string;
  rollNumber: string;
  descriptor: number[];
  photoDataUrl?: string;
  registeredAt: string;
  consentSigned: boolean;
  version: string;
}

let modelsLoaded = false;
let modelsLoadingPromise: Promise<void> | null = null;

/**
 * Loads the client-side neural network models from the local /models public directory.
 * Tiny Face Detector + Face Landmark 68 Tiny + Face Recognition Net.
 */
export async function loadFaceRecognitionModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    try {
      const modelPath = '/models';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
      ]);
      modelsLoaded = true;
    } catch (err) {
      console.error('Failed to load face recognition neural nets:', err);
      modelsLoadingPromise = null;
      throw new Error(
        'Could not initialize biometric neural models. Please check your network connection and reload.'
      );
    }
  })();

  return modelsLoadingPromise;
}

/**
 * Checks whether the models are currently loaded and ready for inference.
 */
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

/**
 * Detects faces in an HTMLVideoElement or HTMLCanvasElement or HTMLImageElement,
 * ensuring exactly 1 face is present, and computes the 128-float biometric descriptor vector.
 */
export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<FaceExtractionResult> {
  if (!modelsLoaded) {
    await loadFaceRecognitionModels();
  }

  // Use TinyFaceDetector with balanced sensitivity
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5
  });

  const detections = await faceapi
    .detectAllFaces(input, options)
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (!detections || detections.length === 0) {
    return {
      success: false,
      faceCount: 0,
      error: 'NO_FACE_DETECTED',
      message: 'No face detected in camera view. Please align your face inside the target frame.'
    };
  }

  if (detections.length > 1) {
    return {
      success: false,
      faceCount: detections.length,
      error: 'MULTIPLE_FACES',
      message: `Multiple faces detected (${detections.length}). For security and integrity, only one resident may be present in front of the camera.`
    };
  }

  const singleDetection = detections[0];
  const descriptorArray = Array.from(singleDetection.descriptor);

  return {
    success: true,
    faceCount: 1,
    descriptor: descriptorArray,
    message: 'Face detected and biometric descriptor successfully extracted.'
  };
}

/**
 * Compares two 128-dimensional facial descriptors using Euclidean distance metric.
 * Default standard matching threshold is 0.55.
 * Values below threshold are classified as positive biometric identity matches.
 */
export function compareFaceDescriptors(
  descriptor1: number[] | Float32Array,
  descriptor2: number[] | Float32Array,
  threshold = 0.55
): FaceVerificationResult {
  const d1 = descriptor1 instanceof Float32Array ? descriptor1 : new Float32Array(descriptor1);
  const d2 = descriptor2 instanceof Float32Array ? descriptor2 : new Float32Array(descriptor2);

  const distance = faceapi.euclideanDistance(d1, d2);
  const isMatch = distance < threshold;

  // Compute confidence percentage (0 to 100%)
  // Euclidean distance < 0.35 is very high confidence (~95-100%)
  // Distance 0.55 is baseline threshold (~65%)
  const confidence = Math.max(
    0,
    Math.min(100, Math.round((1 - distance / 0.8) * 100))
  );

  return {
    isMatch,
    distance: parseFloat(distance.toFixed(4)),
    confidence,
    threshold,
    message: isMatch
      ? `Biometric Identity Verified (Confidence: ${confidence}%, Distance: ${distance.toFixed(4)})`
      : `Biometric Identity Mismatch (Distance: ${distance.toFixed(4)} exceeds security limit ${threshold})`
  };
}

/**
 * Local storage keys for biometric storage.
 */
const TEMPLATE_PREFIX = 'ct_biometric_template_';

/**
 * Persists a student's facial biometric template:
 * 1. Saved securely in local resident device storage (localStorage)
 * 2. Recorded in institutional audit_logs in Supabase (if authenticated)
 */
export async function saveStudentFaceTemplate(
  template: StoredFaceTemplate,
  actorProfileId?: string
): Promise<void> {
  const serialized = JSON.stringify(template);

  // 1. Save locally by studentId and rollNumber
  if (template.studentId) {
    localStorage.setItem(`${TEMPLATE_PREFIX}${template.studentId}`, serialized);
  }
  if (template.rollNumber) {
    localStorage.setItem(`${TEMPLATE_PREFIX}${template.rollNumber.toUpperCase()}`, serialized);
  }

  // 2. Insert into institutional audit_logs table in Supabase
  try {
    const { error } = await supabase.from('audit_logs').insert([
      {
        actor_profile_id: actorProfileId || null,
        action: 'STUDENT_FACE_TEMPLATE_REGISTERED',
        entity_type: 'student_biometrics',
        entity_id: template.studentId || null,
        reason: `Enrolled facial biometric template for resident ${template.studentName} (${template.rollNumber}) with explicit resident consent.`,
        details: {
          student_id: template.studentId,
          student_name: template.studentName,
          roll_number: template.rollNumber,
          registered_at: template.registeredAt,
          consent_signed: template.consentSigned,
          version: template.version,
          descriptor_length: template.descriptor.length,
          descriptor_preview: template.descriptor.slice(0, 5)
        }
      }
    ]);

    if (error) {
      console.warn('Audit log registration note:', error.message);
    }
  } catch (err) {
    console.warn('Audit log write error:', err);
  }
}

/**
 * Retrieves a student's enrolled face template from storage.
 */
export function getStudentFaceTemplate(
  studentId?: string,
  rollNumber?: string
): StoredFaceTemplate | null {
  if (studentId) {
    const byId = localStorage.getItem(`${TEMPLATE_PREFIX}${studentId}`);
    if (byId) {
      try {
        return JSON.parse(byId) as StoredFaceTemplate;
      } catch {
        // fallback
      }
    }
  }

  if (rollNumber) {
    const byRoll = localStorage.getItem(`${TEMPLATE_PREFIX}${rollNumber.toUpperCase()}`);
    if (byRoll) {
      try {
        return JSON.parse(byRoll) as StoredFaceTemplate;
      } catch {
        // fallback
      }
    }
  }

  return null;
}

/**
 * Checks whether a student has an enrolled facial recognition biometric template on file.
 */
export function hasStudentFaceTemplate(studentId?: string, rollNumber?: string): boolean {
  return getStudentFaceTemplate(studentId, rollNumber) !== null;
}
