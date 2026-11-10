import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { Hostel } from '../../types/database';
import {
  validateIndianMobile,
  normalizeHeaderKey
} from '../../lib/studentImportUtils';
import {
  FileSpreadsheet,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  FileCheck,
  RefreshCw,
  Building2,
  Check,
  Users,
  ShieldAlert,
  ShieldCheck,
  RotateCw
} from 'lucide-react';

export interface BulkStudentRow {
  rowNumber: number;
  rollNumber: string;
  fullName: string;
  studentCode: string;
  department: string;
  academicYear: string;
  roomNumber: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
  preferredLanguage: string;
  status:
    | 'READY'
    | 'DUPLICATE_IN_FILE'
    | 'ALREADY_REGISTERED'
    | 'MISSING_REQUIRED'
    | 'INVALID_PHONE'
    | 'SUCCESS'
    | 'FAILED';
  errorReason?: string;
}

export interface BatchProgressState {
  currentBatch: number;
  totalBatches: number;
  totalProcessed: number;
  totalStudents: number;
  successCount: number;
  failedCount: number;
  remainingCount: number;
}

interface BulkStudentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostels: Hostel[];
  selectedHostelId?: string;
  onSuccess: () => void;
}

export const BulkStudentUploadModal: React.FC<BulkStudentUploadModalProps> = ({
  isOpen,
  onClose,
  hostels,
  selectedHostelId,
  onSuccess
}) => {
  const [targetHostelId, setTargetHostelId] = useState<string>(
    selectedHostelId || (hostels.length > 0 ? hostels[0].id : '')
  );
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [duplicateLookupError, setDuplicateLookupError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<BulkStudentRow[]>([]);
  const [filterTab, setFilterTab] = useState<'all' | 'ready' | 'success' | 'issues'>('all');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgressState | null>(null);
  const [importResult, setImportResult] = useState<{
    completed: boolean;
    successCount: number;
    failedCount: number;
    errors: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // Download Sample Template (.xlsx and .csv) with verified schema and valid Indian mobile numbers
  const downloadSampleTemplate = (format: 'xlsx' | 'csv' = 'xlsx') => {
    const sampleHeaders = [
      'Roll Number',
      'Full Name',
      'Student Code',
      'Department',
      'Academic Year',
      'Room Number',
      'Guardian Name',
      'Guardian Phone',
      'Guardian Relationship',
      'Preferred Language'
    ];

    const sampleRows = [
      [
        'CT/2024/001',
        'Aarav Sharma',
        'CT-2024-001',
        'Computer Science & Engineering',
        '2024-2028',
        'A-101',
        'Rajesh Sharma',
        '+919876543210',
        'Father',
        'Hindi'
      ],
      [
        'CT/2024/002',
        'Gurpreet Singh',
        'CT-2024-002',
        'Mechanical Engineering',
        '2024-2028',
        'A-102',
        'Harjit Singh',
        '+919812345678',
        'Father',
        'Punjabi'
      ],
      [
        'CT/2024/003',
        'Priya Verma',
        'CT-2024-003',
        'Civil Engineering',
        '2024-2028',
        'B-201',
        'Sunita Verma',
        '+919876123456',
        'Mother',
        'English'
      ]
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleRows]);
    worksheet['!cols'] = [
      { wch: 16 }, // Roll Number
      { wch: 22 }, // Full Name
      { wch: 16 }, // Student Code
      { wch: 32 }, // Department
      { wch: 14 }, // Academic Year
      { wch: 14 }, // Room Number
      { wch: 20 }, // Guardian Name
      { wch: 20 }, // Guardian Phone
      { wch: 22 }, // Guardian Relationship
      { wch: 18 }  // Preferred Language
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students_Roster');

    if (format === 'xlsx') {
      XLSX.writeFile(workbook, 'CT_Group_Hostel_Student_Template.xlsx');
    } else {
      XLSX.writeFile(workbook, 'CT_Group_Hostel_Student_Template.csv', { bookType: 'csv' });
    }
  };

  /**
   * Safe duplicate detection query against Supabase.
   * Uses RPC function if available; falls back to chunked queries to bypass the 1,000-row limit.
   */
  const fetchExistingDuplicates = async (
    candidateRolls: string[],
    candidateCodes: string[]
  ): Promise<{ existingRolls: Set<string>; existingCodes: Set<string> }> => {
    // 1. Attempt PostgreSQL RPC (Atomic & efficient server-side filter)
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('check_student_duplicates', {
        p_roll_numbers: candidateRolls,
        p_student_codes: candidateCodes
      });

      if (!rpcError && rpcData) {
        const dupRolls = new Set<string>(
          (rpcData.duplicate_roll_numbers || []).map((r: string) => r.trim().toLowerCase())
        );
        const dupCodes = new Set<string>(
          (rpcData.duplicate_student_codes || []).map((c: string) => c.trim().toLowerCase())
        );
        return { existingRolls: dupRolls, existingCodes: dupCodes };
      }
    } catch {
      // RPC may not be applied yet, continue to chunked query fallback
    }

    // 2. Fallback: Chunked in-query to support arbitrarily large student databases without pagination limits
    const existingRolls = new Set<string>();
    const existingCodes = new Set<string>();
    const CHUNK_SIZE = 200;

    for (let i = 0; i < candidateRolls.length; i += CHUNK_SIZE) {
      const rollChunk = candidateRolls.slice(i, i + CHUNK_SIZE);
      const { data: rollData, error: rollErr } = await supabase
        .from('students')
        .select('roll_number')
        .in('roll_number', rollChunk);

      if (rollErr) {
        throw new Error(`Failed to verify roll number duplicates: ${rollErr.message}`);
      }
      (rollData || []).forEach((row) => {
        if (row.roll_number) existingRolls.add(row.roll_number.trim().toLowerCase());
      });
    }

    for (let i = 0; i < candidateCodes.length; i += CHUNK_SIZE) {
      const codeChunk = candidateCodes.slice(i, i + CHUNK_SIZE);
      const { data: codeData, error: codeErr } = await supabase
        .from('students')
        .select('student_code')
        .in('student_code', codeChunk);

      if (codeErr) {
        throw new Error(`Failed to verify student code duplicates: ${codeErr.message}`);
      }
      (codeData || []).forEach((row) => {
        if (row.student_code) existingCodes.add(row.student_code.trim().toLowerCase());
      });
    }

    return { existingRolls, existingCodes };
  };

  // Process File Selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setImportResult(null);
    setBatchProgress(null);
    setDuplicateLookupError(null);
    setFilterTab('all');
    setIsParsing(true);

    try {
      const data = await selectedFile.arrayBuffer();
      // Read workbook with raw: false to ensure phone numbers and codes stay formatted strings
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
        raw: false // Critical: Preserves leading zeroes and phone string formats
      });

      if (rawJson.length === 0) {
        alert('The uploaded file contains no data rows.');
        setIsParsing(false);
        return;
      }

      // Collect candidates for server duplicate verification
      const candidateRolls: string[] = [];
      const candidateCodes: string[] = [];

      rawJson.forEach((row) => {
        const normalized: Record<string, string> = {};
        Object.entries(row).forEach(([k, v]) => {
          normalized[normalizeHeaderKey(k)] = String(v ?? '').trim();
        });
        const roll = normalized['rollNumber'] || '';
        const code = normalized['studentCode'] || (roll ? `CT-${roll}` : '');
        if (roll) candidateRolls.push(roll);
        if (code) candidateCodes.push(code);
      });

      // Execute safe database duplicate check
      let existingRolls = new Set<string>();
      let existingCodes = new Set<string>();

      try {
        const dupResult = await fetchExistingDuplicates(candidateRolls, candidateCodes);
        existingRolls = dupResult.existingRolls;
        existingCodes = dupResult.existingCodes;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Database duplicate check failed.';
        setDuplicateLookupError(msg);
        console.error('Duplicate verification failure:', err);
        // Important: Halt parsing on duplicate lookup failure to prevent duplicate records
        setIsParsing(false);
        return;
      }

      // Internal file deduplication maps (record row number of first occurrence)
      const seenRollsInFile = new Map<string, number>();
      const seenCodesInFile = new Map<string, number>();
      const processed: BulkStudentRow[] = [];

      rawJson.forEach((row, index) => {
        const rowNumber = index + 2; // Excel 1-based indexing + header row
        const normalized: Record<string, string> = {};
        Object.entries(row).forEach(([k, v]) => {
          normalized[normalizeHeaderKey(k)] = String(v ?? '').trim();
        });

        // Skip completely empty rows
        const hasAnyContent = Object.values(normalized).some((val) => val.length > 0);
        if (!hasAnyContent) return;

        const rollNumber = normalized['rollNumber'] || '';
        const fullName = normalized['fullName'] || '';
        const studentCode = normalized['studentCode'] || (rollNumber ? `CT-${rollNumber}` : '');
        const department = normalized['department'] || '';
        const academicYear = normalized['academicYear'] || '';
        const roomNumber = normalized['roomNumber'] || '';
        const guardianName = normalized['guardianName'] || '';
        const rawGuardianPhone = normalized['guardianPhone'] || '';
        const guardianRelation = normalized['guardianRelation'] || 'Father';
        const preferredLanguage = normalized['preferredLanguage']?.toLowerCase() || 'hi';

        // 1. Phone Validation: Indian Mobile Numbers (+91, 10 digits starting with 6-9)
        const phoneValidation = validateIndianMobile(rawGuardianPhone);

        let status: BulkStudentRow['status'] = 'READY';
        let errorReason = '';

        const rollKey = rollNumber.toLowerCase();
        const codeKey = studentCode.toLowerCase();

        // 2. Strict Field Validation: Do not silently assign required fields
        if (!rollNumber || !fullName || !department || !academicYear || !roomNumber || !guardianName || !rawGuardianPhone) {
          status = 'MISSING_REQUIRED';
          const missingFields: string[] = [];
          if (!rollNumber) missingFields.push('Roll Number');
          if (!fullName) missingFields.push('Full Name');
          if (!department) missingFields.push('Department');
          if (!academicYear) missingFields.push('Academic Year');
          if (!roomNumber) missingFields.push('Room Number');
          if (!guardianName) missingFields.push('Guardian Name');
          if (!rawGuardianPhone) missingFields.push('Guardian Phone');
          errorReason = `Missing required: ${missingFields.join(', ')}`;
        } else if (!phoneValidation.isValid) {
          status = 'INVALID_PHONE';
          errorReason = phoneValidation.error || 'Invalid Indian mobile number';
        } else if (seenRollsInFile.has(rollKey)) {
          status = 'DUPLICATE_IN_FILE';
          errorReason = `Roll Number '${rollNumber}' is duplicate of row ${seenRollsInFile.get(rollKey)}`;
        } else if (seenCodesInFile.has(codeKey)) {
          status = 'DUPLICATE_IN_FILE';
          errorReason = `Student Code '${studentCode}' is duplicate of row ${seenCodesInFile.get(codeKey)}`;
        } else if (existingRolls.has(rollKey)) {
          status = 'ALREADY_REGISTERED';
          errorReason = `Roll Number '${rollNumber}' is already registered in database`;
        } else if (existingCodes.has(codeKey)) {
          status = 'ALREADY_REGISTERED';
          errorReason = `Student Code '${studentCode}' is already registered in database`;
        }

        if (rollNumber) seenRollsInFile.set(rollKey, rowNumber);
        if (studentCode) seenCodesInFile.set(codeKey, rowNumber);

        processed.push({
          rowNumber,
          rollNumber,
          fullName,
          studentCode,
          department,
          academicYear,
          roomNumber,
          guardianName,
          guardianPhone: phoneValidation.normalized || rawGuardianPhone,
          guardianRelation,
          preferredLanguage: preferredLanguage.startsWith('pun') ? 'pa' : preferredLanguage.startsWith('eng') ? 'en' : 'hi',
          status,
          errorReason
        });
      });

      setParsedRows(processed);
    } catch (err: unknown) {
      console.error('Failed to parse file:', err);
      alert(`Error reading file: ${err instanceof Error ? err.message : 'Invalid Excel/CSV format'}`);
    } finally {
      setIsParsing(false);
    }
  };

  /**
   * Sequential Batch Engine:
   * Chunks large student rosters into 500-student requests to adhere strictly to the
   * database RPC limit without requiring manual file splitting or artificial caps.
   * Tracks row-level status and preserves atomic rollback protection per student.
   */
  const executeImportBatches = async (rowsToProcess: BulkStudentRow[]) => {
    if (rowsToProcess.length === 0) {
      alert('There are no student rows to process.');
      return;
    }

    if (!targetHostelId) {
      alert('Please select a target hostel facility first.');
      return;
    }

    // Pre-flight check: Verify admin role
    try {
      const { data: roleData, error: roleError } = await supabase.rpc('current_user_role');
      if (roleError || roleData !== 'admin') {
        alert('Permission Denied: Only authenticated administrators can execute bulk student imports.');
        return;
      }
    } catch (authErr) {
      console.warn('Pre-flight role verification error:', authErr);
    }

    setIsImporting(true);
    setImportResult(null);

    const BATCH_SIZE = 500;
    const totalStudents = rowsToProcess.length;
    const totalBatches = Math.ceil(totalStudents / BATCH_SIZE);

    let cumulativeSuccess = 0;
    let cumulativeFailed = 0;
    let cumulativeProcessed = 0;
    const accumulatedErrors: string[] = [];

    // Mutable working copy of parsedRows for row-level status updates
    let currentParsedRows = [...parsedRows];

    setBatchProgress({
      currentBatch: 1,
      totalBatches,
      totalProcessed: 0,
      totalStudents,
      successCount: 0,
      failedCount: 0,
      remainingCount: totalStudents
    });

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const startIdx = batchIdx * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, totalStudents);
      const currentBatchSlice = rowsToProcess.slice(startIdx, endIdx);

      setBatchProgress({
        currentBatch: batchIdx + 1,
        totalBatches,
        totalProcessed: cumulativeProcessed,
        totalStudents,
        successCount: cumulativeSuccess,
        failedCount: cumulativeFailed,
        remainingCount: totalStudents - cumulativeProcessed
      });

      const batchPayload = currentBatchSlice.map((r) => ({
        roll_number: r.rollNumber,
        student_code: r.studentCode,
        full_name: r.fullName,
        department: r.department,
        academic_year: r.academicYear,
        room_number: r.roomNumber,
        guardian_name: r.guardianName,
        guardian_phone: r.guardianPhone,
        guardian_relationship: r.guardianRelation,
        preferred_language: r.preferredLanguage
      }));

      let batchHandledViaRpc = false;

      // Method 1: Atomic PostgreSQL Batch RPC (Server-side 500 max limit)
      try {
        const { data: batchResult, error: batchErr } = await supabase.rpc('bulk_enroll_students_batch', {
          p_hostel_id: targetHostelId,
          p_students: batchPayload
        });

        if (batchErr) {
          throw new Error(batchErr.message);
        }

        if (batchResult && Array.isArray(batchResult.results)) {
          batchHandledViaRpc = true;
          const results = batchResult.results as Array<{
            index: number;
            roll_number: string;
            status: string;
            error?: string;
          }>;

          results.forEach((res, i) => {
            const row = currentBatchSlice[i];
            if (!row) return;

            const rowIdx = currentParsedRows.findIndex((r) => r.rowNumber === row.rowNumber);

            if (res.status === 'SUCCESS') {
              cumulativeSuccess++;
              if (rowIdx !== -1) {
                currentParsedRows[rowIdx] = {
                  ...currentParsedRows[rowIdx],
                  status: 'SUCCESS',
                  errorReason: undefined
                };
              }
            } else {
              cumulativeFailed++;
              const errReason = res.error || 'Enrollment failed';
              accumulatedErrors.push(`${row.rollNumber || `Row ${row.rowNumber}`}: ${errReason}`);
              if (rowIdx !== -1) {
                currentParsedRows[rowIdx] = {
                  ...currentParsedRows[rowIdx],
                  status: 'FAILED',
                  errorReason: errReason
                };
              }
            }
          });
        }
      } catch (rpcErr) {
        console.warn('Batch RPC encountered error, executing client-side transactional fallback for this batch:', rpcErr);
      }

      // Method 2: Client-side Atomic Fallback with Orphan Guardian Rollback
      if (!batchHandledViaRpc) {
        for (const row of currentBatchSlice) {
          const rowIdx = currentParsedRows.findIndex((r) => r.rowNumber === row.rowNumber);
          let createdGuardianId: string | null = null;

          try {
            // 1. Insert guardian with strictly PENDING consent
            const { data: gData, error: gErr } = await supabase
              .from('guardians')
              .insert([
                {
                  full_name: row.guardianName,
                  relationship: row.guardianRelation,
                  phone_number: row.guardianPhone,
                  preferred_language: row.preferredLanguage,
                  notification_consent_status: 'PENDING'
                }
              ])
              .select('id')
              .single();

            if (gErr || !gData) {
              throw new Error(`Guardian creation failed: ${gErr?.message || 'Unknown'}`);
            }
            createdGuardianId = gData.id;

            // 2. Insert student linked to guardian
            const { error: sErr } = await supabase
              .from('students')
              .insert([
                {
                  student_code: row.studentCode,
                  roll_number: row.rollNumber,
                  full_name: row.fullName,
                  department: row.department,
                  academic_year: row.academicYear,
                  hostel_id: targetHostelId,
                  room_number: row.roomNumber,
                  guardian_id: createdGuardianId,
                  enrollment_status: 'ACTIVE'
                }
              ]);

            if (sErr) {
              // Atomic rollback of orphan guardian
              if (createdGuardianId) {
                await supabase.from('guardians').delete().eq('id', createdGuardianId);
              }
              throw new Error(`Student registration failed: ${sErr.message}`);
            }

            cumulativeSuccess++;
            if (rowIdx !== -1) {
              currentParsedRows[rowIdx] = {
                ...currentParsedRows[rowIdx],
                status: 'SUCCESS',
                errorReason: undefined
              };
            }
          } catch (err: unknown) {
            cumulativeFailed++;
            const errReason = err instanceof Error ? err.message : 'Unknown error';
            accumulatedErrors.push(`${row.rollNumber || `Row ${row.rowNumber}`}: ${errReason}`);
            if (rowIdx !== -1) {
              currentParsedRows[rowIdx] = {
                ...currentParsedRows[rowIdx],
                status: 'FAILED',
                errorReason: errReason
              };
            }
          }
        }
      }

      cumulativeProcessed += currentBatchSlice.length;

      // Update state after each batch completes to update UI in real-time
      currentParsedRows = [...currentParsedRows];
      setParsedRows(currentParsedRows);

      setBatchProgress({
        currentBatch: Math.min(batchIdx + 1, totalBatches),
        totalBatches,
        totalProcessed: cumulativeProcessed,
        totalStudents,
        successCount: cumulativeSuccess,
        failedCount: cumulativeFailed,
        remainingCount: totalStudents - cumulativeProcessed
      });
    }

    setIsImporting(false);
    setImportResult({
      completed: true,
      successCount: cumulativeSuccess,
      failedCount: cumulativeFailed,
      errors: accumulatedErrors
    });

    if (cumulativeSuccess > 0) {
      onSuccess();
    }
  };

  // Initial Import Action
  const handleExecuteImport = async () => {
    const readyRows = parsedRows.filter((r) => r.status === 'READY');
    if (readyRows.length === 0) {
      alert('There are no valid student rows ready to import.');
      return;
    }
    await executeImportBatches(readyRows);
  };

  // Safe Retry Action: Verifies duplicate state first, then retries only failed rows
  const handleRetryFailed = async () => {
    const failedRows = parsedRows.filter((r) => r.status === 'FAILED');
    if (failedRows.length === 0) {
      alert('There are no failed student rows to retry.');
      return;
    }

    setIsParsing(true);
    try {
      // 1. Re-check duplicates against database before retrying to prevent re-inserting
      // any student that might have actually succeeded during a transient network disconnect
      const candidateRolls = failedRows.map((r) => r.rollNumber).filter(Boolean);
      const candidateCodes = failedRows.map((r) => r.studentCode).filter(Boolean);
      const { existingRolls, existingCodes } = await fetchExistingDuplicates(candidateRolls, candidateCodes);

      const updatedRows = [...parsedRows];
      const retryCandidates: BulkStudentRow[] = [];

      failedRows.forEach((row) => {
        const targetIndex = updatedRows.findIndex((r) => r.rowNumber === row.rowNumber);
        const rollKey = row.rollNumber.trim().toLowerCase();
        const codeKey = row.studentCode.trim().toLowerCase();

        if (existingRolls.has(rollKey)) {
          if (targetIndex !== -1) {
            updatedRows[targetIndex] = {
              ...updatedRows[targetIndex],
              status: 'ALREADY_REGISTERED',
              errorReason: `Roll number '${row.rollNumber}' is already registered in database`
            };
          }
        } else if (existingCodes.has(codeKey)) {
          if (targetIndex !== -1) {
            updatedRows[targetIndex] = {
              ...updatedRows[targetIndex],
              status: 'ALREADY_REGISTERED',
              errorReason: `Student code '${row.studentCode}' is already registered in database`
            };
          }
        } else {
          // Safe to retry
          if (targetIndex !== -1) {
            updatedRows[targetIndex] = {
              ...updatedRows[targetIndex],
              status: 'READY',
              errorReason: undefined
            };
            retryCandidates.push(updatedRows[targetIndex]);
          }
        }
      });

      setParsedRows(updatedRows);
      setIsParsing(false);

      if (retryCandidates.length === 0) {
        alert('All previously failed student records have been verified as already registered in the database. No retry needed.');
        return;
      }

      // 2. Process retry candidates in sequential 500-student batches
      await executeImportBatches(retryCandidates);
    } catch (err: unknown) {
      setIsParsing(false);
      alert(`Failed to verify existing student records before retry: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const readyCount = parsedRows.filter((r) => r.status === 'READY').length;
  const successCount = parsedRows.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = parsedRows.filter((r) => r.status === 'FAILED').length;
  const issueCount = parsedRows.filter((r) =>
    ['DUPLICATE_IN_FILE', 'ALREADY_REGISTERED', 'MISSING_REQUIRED', 'INVALID_PHONE', 'FAILED'].includes(r.status)
  ).length;

  const displayedRows = parsedRows.filter((row) => {
    if (filterTab === 'ready') return row.status === 'READY';
    if (filterTab === 'success') return row.status === 'SUCCESS';
    if (filterTab === 'issues') {
      return ['DUPLICATE_IN_FILE', 'ALREADY_REGISTERED', 'MISSING_REQUIRED', 'INVALID_PHONE', 'FAILED'].includes(row.status);
    }
    return true;
  });

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full p-5 sm:p-7 shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Secure Bulk Student Import (Excel / CSV)</h4>
              <p className="text-xs text-slate-500">Atomic roster enrollment with sequential 500-student batch transactions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto flex-1 py-4 space-y-4">
          {/* Guardian Consent Security Notice */}
          <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-900 text-xs">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold">Guardian Consent Lifecycle: </span>
              Newly uploaded guardian contacts are strictly assigned a <code className="font-mono font-bold text-blue-800 bg-blue-100 px-1 py-0.5 rounded">PENDING</code> consent status. Automated voice calls, SMS, and WhatsApp alerts will <span className="font-bold underline">not</span> be dispatched until explicit guardian consent is documented.
            </div>
          </div>

          {/* Top Options Bar: Target Hostel & Sample Downloads */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            {/* Target Hostel Facility */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center space-x-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Target Hostel Facility:</span>
              </label>
              <select
                value={targetHostelId}
                onChange={(e) => setTargetHostelId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-ct-navy"
                disabled={isImporting}
              >
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.campus_unit || 'Shahpur Campus'})
                  </option>
                ))}
              </select>
            </div>

            {/* Template Download Buttons */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center space-x-1.5">
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Download Verified Template:</span>
              </label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => downloadSampleTemplate('xlsx')}
                  className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-50 rounded-lg shadow-sm transition-all"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadSampleTemplate('csv')}
                  className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg shadow-sm transition-all"
                >
                  <FileCheck className="w-3.5 h-3.5 text-slate-600" />
                  <span>CSV File (.csv)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Upload Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2 group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
              disabled={isImporting}
            />
            <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-200 group-hover:border-emerald-300 flex items-center justify-center text-slate-500 group-hover:text-emerald-700 transition-colors">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {file ? file.name : 'Click to select or drag & drop Excel / CSV file'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Supports arbitrarily large rosters (auto-batched in 500-student chunks)
              </p>
            </div>
            {file && (
              <span className="inline-flex items-center space-x-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <Check className="w-3 h-3" />
                <span>{(file.size / 1024).toFixed(1)} KB • Validated</span>
              </span>
            )}
          </div>

          {/* Duplicate Lookup Error Banner */}
          {duplicateLookupError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Database Verification Blocked:</p>
                <p>{duplicateLookupError}</p>
                <p className="text-[11px] text-rose-700 mt-1">Import is blocked to prevent accidental duplicate entries.</p>
              </div>
            </div>
          )}

          {/* Parsing State */}
          {isParsing && (
            <div className="flex items-center justify-center space-x-2 py-6 text-slate-600 text-xs font-medium">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Validating phone numbers, checking roll numbers and verifying duplicate entries...</span>
            </div>
          )}

          {/* Parsed Results Overview */}
          {parsedRows.length > 0 && !isParsing && (
            <div className="space-y-3">
              {/* Stat Badges & Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setFilterTab('all')}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                      filterTab === 'all'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    All Rows ({parsedRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('ready')}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center space-x-1 transition-all ${
                      filterTab === 'ready'
                        ? 'bg-emerald-700 text-white shadow-sm'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Ready ({readyCount})</span>
                  </button>
                  {successCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setFilterTab('success')}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center space-x-1 transition-all ${
                        filterTab === 'success'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Enrolled ({successCount})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFilterTab('issues')}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center space-x-1 transition-all ${
                      filterTab === 'issues'
                        ? 'bg-rose-700 text-white shadow-sm'
                        : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Errors / Issues ({issueCount})</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-500">
                  {readyCount > 0 ? (
                    <span className="text-emerald-700 font-semibold">
                      {readyCount} student(s) ready to enroll (Pending Consent)
                    </span>
                  ) : successCount > 0 && readyCount === 0 ? (
                    <span className="text-emerald-700 font-semibold">
                      All valid students enrolled successfully!
                    </span>
                  ) : (
                    <span className="text-rose-600 font-semibold">No valid rows to enroll</span>
                  )}
                </div>
              </div>

              {/* Data Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10">
                    <tr>
                      <th className="py-2 px-3 w-12 text-center">#</th>
                      <th className="py-2 px-3">Roll No</th>
                      <th className="py-2 px-3">Student Name</th>
                      <th className="py-2 px-3">Dept & Year</th>
                      <th className="py-2 px-3">Room</th>
                      <th className="py-2 px-3">Guardian Name</th>
                      <th className="py-2 px-3">Guardian Phone</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {displayedRows.map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={
                          row.status === 'SUCCESS'
                            ? 'bg-emerald-50/30 hover:bg-emerald-50/50'
                            : row.status !== 'READY'
                            ? 'bg-rose-50/40 hover:bg-rose-50/70'
                            : 'hover:bg-slate-50'
                        }
                      >
                        <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">{row.rowNumber}</td>
                        <td className="py-2 px-3 font-semibold font-mono text-slate-900">{row.rollNumber || '—'}</td>
                        <td className="py-2 px-3 text-slate-800">{row.fullName || '—'}</td>
                        <td className="py-2 px-3 text-slate-600 text-[11px]">
                          {row.department ? `${row.department} (${row.academicYear || '—'})` : '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-600 font-mono">{row.roomNumber || '—'}</td>
                        <td className="py-2 px-3 text-slate-700">
                          {row.guardianName} ({row.guardianRelation})
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700">{row.guardianPhone}</td>
                        <td className="py-2 px-3">
                          {row.status === 'SUCCESS' ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Enrolled</span>
                            </span>
                          ) : row.status === 'READY' ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                              <Check className="w-3 h-3 text-blue-600" />
                              <span>Ready</span>
                            </span>
                          ) : row.status === 'FAILED' ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <AlertTriangle className="w-3 h-3 text-rose-600" />
                                <span>Failed</span>
                              </span>
                              {row.errorReason && (
                                <p className="text-[10px] text-rose-600 font-medium leading-tight">{row.errorReason}</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                <span>{row.status}</span>
                              </span>
                              {row.errorReason && (
                                <p className="text-[10px] text-rose-600 font-medium leading-tight">{row.errorReason}</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Real-Time Batch Progress Bar */}
          {isImporting && batchProgress && (
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-emerald-950">
                <span className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-700" />
                  <span>
                    Processing Batch {batchProgress.currentBatch} of {batchProgress.totalBatches} ({Math.min(500, batchProgress.totalStudents)} students/batch)...
                  </span>
                </span>
                <span className="font-mono text-emerald-800">
                  {batchProgress.totalProcessed} / {batchProgress.totalStudents} ({Math.round((batchProgress.totalProcessed / batchProgress.totalStudents) * 100)}%)
                </span>
              </div>

              {/* Real-time counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                  <span className="text-slate-500 block">Total Students</span>
                  <span className="font-bold text-slate-800 text-sm font-mono">{batchProgress.totalStudents}</span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                  <span className="text-emerald-700 block">Successful</span>
                  <span className="font-bold text-emerald-700 text-sm font-mono">{batchProgress.successCount}</span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                  <span className="text-rose-700 block">Failed</span>
                  <span className="font-bold text-rose-700 text-sm font-mono">{batchProgress.failedCount}</span>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                  <span className="text-slate-600 block">Remaining</span>
                  <span className="font-bold text-slate-600 text-sm font-mono">{batchProgress.remainingCount}</span>
                </div>
              </div>

              <div className="w-full bg-emerald-200/60 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(2, (batchProgress.totalProcessed / batchProgress.totalStudents) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Import Result Notification */}
          {importResult && (
            <div
              className={`p-4 rounded-xl border ${
                importResult.failedCount === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50 border-amber-200 text-amber-950'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-2.5">
                  {importResult.failedCount === 0 ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-sm">
                      {importResult.successCount} student(s) successfully enrolled!
                    </p>
                    <p className="text-slate-600">
                      {batchProgress ? `${batchProgress.totalBatches} batch(es) processed sequentially in chunks of 500.` : ''} All guardians initialized strictly with <span className="font-mono font-bold text-blue-800 bg-blue-100 px-1 py-0.5 rounded">PENDING</span> consent.
                    </p>
                    {importResult.failedCount > 0 && (
                      <p className="font-semibold text-rose-700">
                        {importResult.failedCount} student(s) failed enrollment. You can retry them safely below.
                      </p>
                    )}
                  </div>
                </div>

                {/* Direct Retry Button inside Result Notification */}
                {failedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleRetryFailed}
                    disabled={isImporting || isParsing}
                    className="shrink-0 flex items-center space-x-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isParsing ? 'animate-spin' : ''}`} />
                    <span>Retry Failed ({failedCount})</span>
                  </button>
                )}
              </div>

              {/* Error Details */}
              {importResult.errors.length > 0 && (
                <div className="mt-3 text-[11px] bg-white/90 p-2.5 rounded-lg border border-amber-200 max-h-32 overflow-y-auto space-y-1">
                  <p className="font-bold text-slate-700">Failure Details ({importResult.errors.length}):</p>
                  {importResult.errors.map((e, idx) => (
                    <p key={idx} className="text-rose-700 font-mono text-[10px]">
                      • {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500">
            {isImporting && batchProgress ? (
              <span className="font-medium text-emerald-700">
                Batch {batchProgress.currentBatch} of {batchProgress.totalBatches} • {batchProgress.remainingCount} remaining
              </span>
            ) : failedCount > 0 ? (
              <span className="font-medium text-rose-600">
                {failedCount} failed student(s) ready to retry
              </span>
            ) : readyCount > 0 ? (
              <span className="font-medium text-emerald-700">
                {readyCount} valid student(s) ready (auto-chunked into batches of 500)
              </span>
            ) : (
              'Upload an Excel or CSV file to begin'
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold transition-colors"
            >
              {importResult?.completed ? 'Close' : 'Cancel'}
            </button>
            {failedCount > 0 && !isImporting && (
              <button
                type="button"
                onClick={handleRetryFailed}
                disabled={isImporting || isParsing}
                className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Retry Failed ({failedCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={isImporting || readyCount === 0 || !!duplicateLookupError}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    Enrolling {batchProgress ? `(${batchProgress.totalProcessed}/${batchProgress.totalStudents})` : '...'}
                  </span>
                </>
              ) : (
                <>
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    {readyCount > 500
                      ? `Import ${readyCount} Students (${Math.ceil(readyCount / 500)} Batches)`
                      : readyCount > 0
                      ? `Import ${readyCount} Students`
                      : 'Import Students'}
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