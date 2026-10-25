// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// GPS Geofencing & Location Verification Service
// Haversine Geospatial Distance Calculation & Precision Boundary Enforcement
// ==============================================================================

import { Hostel } from '../types/database';

export interface GeofenceConfig {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  source: 'HOSTEL_RECORD' | 'CAMPUS_ENVIRONMENT' | 'CAMPUS_DEFAULT';
  hostelName?: string;
}

export interface GeolocationPositionResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface GeofenceValidationResult {
  isValid: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
  accuracyMeters: number;
  maxAccuracyMeters: number;
  rejectionReason?: 'OUTSIDE_GEOFENCE' | 'POOR_GPS_ACCURACY' | 'COORDINATES_UNCONFIGURED' | 'PERMISSION_DENIED' | 'LOCATION_UNAVAILABLE';
  message: string;
}

/**
 * Calculates the great-circle distance between two geographic coordinates
 * on the WGS-84 reference ellipsoid using the Haversine formula.
 * @returns Distance in meters.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_METERS = 6371000; // Mean Earth radius in meters

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_METERS * c;
  return parseFloat(distance.toFixed(2));
}

/**
 * Resolves the active geofencing configuration:
 * 1. Specific assigned hostel record in Supabase (if reference coordinates are set)
 * 2. Institutional environment variables (.env / .env.local)
 * 3. Official CT Group of Institutions campus coordinates
 */
export function getCampusGeofenceConfig(hostel?: Hostel | null): GeofenceConfig {
  // 1. Check hostel record
  if (
    hostel &&
    hostel.reference_latitude !== null &&
    hostel.reference_latitude !== undefined &&
    hostel.reference_longitude !== null &&
    hostel.reference_longitude !== undefined &&
    !isNaN(Number(hostel.reference_latitude)) &&
    !isNaN(Number(hostel.reference_longitude))
  ) {
    return {
      latitude: Number(hostel.reference_latitude),
      longitude: Number(hostel.reference_longitude),
      radiusMeters: Number(hostel.geofence_radius_meters) || 150,
      maxAccuracyMeters: Number(import.meta.env.VITE_MAX_GPS_ACCURACY_METERS) || 100,
      source: 'HOSTEL_RECORD',
      hostelName: hostel.name
    };
  }

  // 2. Check environment variables
  const envLat = parseFloat(import.meta.env.VITE_CAMPUS_LATITUDE || '');
  const envLng = parseFloat(import.meta.env.VITE_CAMPUS_LONGITUDE || '');
  const envRadius = parseFloat(import.meta.env.VITE_GEOFENCE_RADIUS_METERS || import.meta.env.VITE_CAMPUS_RADIUS_METERS || '');
  const envMaxAccuracy = parseFloat(import.meta.env.VITE_MAX_GPS_ACCURACY_METERS || import.meta.env.VITE_GPS_MAX_ACCURACY_METERS || '');

  if (!isNaN(envLat) && !isNaN(envLng)) {
    return {
      latitude: envLat,
      longitude: envLng,
      radiusMeters: !isNaN(envRadius) ? envRadius : 535,
      maxAccuracyMeters: !isNaN(envMaxAccuracy) ? envMaxAccuracy : 100,
      source: 'CAMPUS_ENVIRONMENT'
    };
  }

  // 3. Official CT Group of Institutions Campus Defaults (Shahpur Campus, Jalandhar)
  // Pin Coordinates: 31.236872, 75.553745. Measured physical road extent: 435m + 100m margin = 535m
  return {
    latitude: 31.236872,
    longitude: 75.553745,
    radiusMeters: 535,
    maxAccuracyMeters: 100,
    source: 'CAMPUS_DEFAULT'
  };
}

/**
 * Requests real device coordinates via browser Geolocation API with high accuracy.
 */
export async function requestDeviceLocation(): Promise<GeolocationPositionResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser or operating system.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: parseFloat(position.coords.accuracy.toFixed(1)),
          timestamp: position.timestamp
        });
      },
      (error) => {
        let errorMsg = 'Failed to obtain GPS coordinates.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg =
              'GPS location permission was denied. Institutional geofencing requires device location to verify presence within hostel bounds. Please enable location permissions in your browser.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg =
              'GPS location signal is unavailable. Please verify that location services are active on your device.';
            break;
          case error.TIMEOUT:
            errorMsg =
              'GPS location acquisition timed out. Please ensure you have clear satellite reception and retry.';
            break;
        }
        const err = new Error(errorMsg);
        (err as any).code = error.code;
        reject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}

/**
 * Validates device coordinates against the target geofence:
 * 1. Checks if GPS accuracy is within the required confidence threshold.
 * 2. Calculates distance to geofence center using Haversine formula.
 * 3. Enforces boundary radius.
 */
export function validateGeofencePresence(
  coords: GeolocationPositionResult,
  config: GeofenceConfig
): GeofenceValidationResult {
  // 1. Validate GPS Accuracy Threshold
  if (coords.accuracy > config.maxAccuracyMeters) {
    return {
      isValid: false,
      distanceMeters: -1,
      allowedRadiusMeters: config.radiusMeters,
      accuracyMeters: coords.accuracy,
      maxAccuracyMeters: config.maxAccuracyMeters,
      rejectionReason: 'POOR_GPS_ACCURACY',
      message: `GPS accuracy too low (±${coords.accuracy}m). Maximum acceptable margin for hostel verification is ±${config.maxAccuracyMeters}m. Please step near a window or outdoors and retry.`
    };
  }

  // 2. Compute Haversine distance
  const distance = calculateHaversineDistance(
    coords.latitude,
    coords.longitude,
    config.latitude,
    config.longitude
  );

  // 3. Boundary Radius Enforcement
  const isInside = distance <= config.radiusMeters;

  if (!isInside) {
    return {
      isValid: false,
      distanceMeters: distance,
      allowedRadiusMeters: config.radiusMeters,
      accuracyMeters: coords.accuracy,
      maxAccuracyMeters: config.maxAccuracyMeters,
      rejectionReason: 'OUTSIDE_GEOFENCE',
      message: `Location rejected: Your device is ${distance}m away from the campus hostel boundary (maximum permitted radius: ${config.radiusMeters}m). Attendance cannot be marked from outside the hostel premises.`
    };
  }

  return {
    isValid: true,
    distanceMeters: distance,
    allowedRadiusMeters: config.radiusMeters,
    accuracyMeters: coords.accuracy,
    maxAccuracyMeters: config.maxAccuracyMeters,
    message: `Geofence Verified: Device is ${distance}m from campus center (within ${config.radiusMeters}m boundary, accuracy ±${coords.accuracy}m).`
  };
}
