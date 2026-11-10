/**
 * ==============================================================================
 * CT GROUP OF INSTITUTIONS - HOSTEL ATTENDANCE SYSTEM
 * Student Import & Guardian Validation Utilities
 * ==============================================================================
 */

export interface PhoneValidationResult {
  isValid: boolean;
  normalized: string; // E.164 formatted: "+919876543210"
  error?: string;
}

/**
 * Validates and normalizes Indian mobile phone numbers.
 *
 * Requirements:
 * - Accept 10-digit Indian mobile numbers starting with 6, 7, 8, or 9.
 * - Accept country codes: +91, 91, and national trunk prefix 0.
 * - Normalize consistently to '+91XXXXXXXXXX'.
 * - Preserve phone number as a string (never numeric) to avoid loss of leading characters.
 * - Reject numbers that do not match valid Indian mobile network prefixes.
 */
export function validateIndianMobile(raw: unknown): PhoneValidationResult {
  if (raw === null || raw === undefined) {
    return {
      isValid: false,
      normalized: '',
      error: 'Guardian mobile phone number is required.'
    };
  }

  // Convert raw value to string safely without scientific notation loss
  let str = String(raw).trim();

  if (!str) {
    return {
      isValid: false,
      normalized: '',
      error: 'Guardian mobile phone number cannot be blank.'
    };
  }

  // Handle potential scientific notation from unformatted Excel numbers (e.g., 9.87654E+09)
  if (/^\d+\.?\d*e\+\d+$/i.test(str)) {
    try {
      const num = Number(str);
      if (!isNaN(num)) {
        str = BigInt(Math.floor(num)).toString();
      }
    } catch {
      // Keep original str if BigInt fails
    }
  }

  // Remove common punctuation: spaces, dashes, parentheses, dots
  const cleaned = str.replace(/[\s\-\(\)\.]/g, '');

  // 1. Format: +91XXXXXXXXXX (International format)
  if (cleaned.startsWith('+')) {
    if (!cleaned.startsWith('+91')) {
      return {
        isValid: false,
        normalized: '',
        error: `Invalid country code '${cleaned.slice(0, 3)}'. Only Indian mobile numbers (+91) are supported.`
      };
    }
    const digits = cleaned.slice(3);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        normalized: '',
        error: 'Indian mobile number must be 10 digits starting with 6, 7, 8, or 9 (e.g. +91 98765 43210).'
      };
    }
    return { isValid: true, normalized: `+91${digits}` };
  }

  // 2. Format: 91XXXXXXXXXX (12 digits with 91 prefix)
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    const digits = cleaned.slice(2);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        normalized: '',
        error: 'Indian mobile number must be 10 digits starting with 6, 7, 8, or 9 (e.g. +91 98765 43210).'
      };
    }
    return { isValid: true, normalized: `+91${digits}` };
  }

  // 3. Format: 0XXXXXXXXXX (11 digits with national trunk prefix 0)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const digits = cleaned.slice(1);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        normalized: '',
        error: 'Indian mobile number must be 10 digits starting with 6, 7, 8, or 9 (e.g. 09876543210).'
      };
    }
    return { isValid: true, normalized: `+91${digits}` };
  }

  // 4. Format: XXXXXXXXXX (Standard 10-digit Indian mobile)
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return { isValid: true, normalized: `+91${cleaned}` };
  }

  // Any other pattern is invalid (landlines, short codes, wrong prefixes)
  return {
    isValid: false,
    normalized: '',
    error: `Invalid mobile number '${str}'. Must be a valid 10-digit Indian number starting with 6-9.`
  };
}

/**
 * Normalizes Excel/CSV header strings into standard property keys.
 * Handles casing, spaces, underscores, and common institutional aliases.
 */
export function normalizeHeaderKey(header: string): string {
  const clean = header.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Roll Number aliases
  if (['rollnumber', 'rollno', 'roll', 'rollnum', 'studentroll', 'universityrollno'].includes(clean)) {
    return 'rollNumber';
  }

  // Student Full Name aliases
  if (['fullname', 'studentname', 'name', 'stuname', 'nameofstudent'].includes(clean)) {
    return 'fullName';
  }

  // Student Code / Registration aliases
  if (['studentcode', 'code', 'stucode', 'regno', 'registrationno', 'admissionno', 'idnumber'].includes(clean)) {
    return 'studentCode';
  }

  // Department / Branch aliases
  if (['department', 'dept', 'branch', 'course', 'program', 'stream'].includes(clean)) {
    return 'department';
  }

  // Academic Year / Batch aliases
  if (['academicyear', 'year', 'batch', 'session', 'academic_yr'].includes(clean)) {
    return 'academicYear';
  }

  // Room Number aliases
  if (['roomnumber', 'roomno', 'room', 'bedroom', 'bedno', 'roomassigned'].includes(clean)) {
    return 'roomNumber';
  }

  // Guardian Name aliases
  if (['guardianname', 'parentname', 'fathername', 'mothername', 'guardian', 'parent', 'father'].includes(clean)) {
    return 'guardianName';
  }

  // Guardian Emergency Phone aliases
  if (['guardianphone', 'parentphone', 'phone', 'phonenumber', 'mobile', 'emergencyno', 'emergencyphone', 'contact'].includes(clean)) {
    return 'guardianPhone';
  }

  // Guardian Relationship aliases
  if (['guardianrelation', 'relation', 'relationship', 'guardianrelationship'].includes(clean)) {
    return 'guardianRelation';
  }

  // Preferred Language aliases
  if (['preferredlanguage', 'language', 'preflanguage', 'lang', 'smslanguage'].includes(clean)) {
    return 'preferredLanguage';
  }

  return clean;
}
