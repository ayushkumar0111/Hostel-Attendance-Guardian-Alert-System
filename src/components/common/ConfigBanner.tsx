import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Database, AlertTriangle, CheckCircle, Info, ChevronDown, ChevronUp, FileCode } from 'lucide-react';

export const ConfigBanner: React.FC = () => {
  const { isConfigured, previewRole } = useAuth();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [schemaStatus, setSchemaStatus] = useState<'checking' | 'ready' | 'pending_migration'>('checking');

  useEffect(() => {
    if (!isConfigured) {
      setSchemaStatus('checking');
      return;
    }

    const checkSchema = async () => {
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error && (error.code === 'PGRST205' || error.message?.includes('schema cache'))) {
          setSchemaStatus('pending_migration');
        } else {
          setSchemaStatus('ready');
        }
      } catch {
        setSchemaStatus('pending_migration');
      }
    };

    checkSchema();
  }, [isConfigured]);

  if (isConfigured) {
    if (schemaStatus === 'pending_migration') {
      return (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-950 text-xs py-2.5 px-4 shadow-sm">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold">Supabase Connected:</span>{' '}
                <span>Database tables not detected yet. Run the SQL migration to create tables &amp; triggers.</span>
              </div>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
              <span className="font-mono text-[11px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 flex items-center gap-1">
                <FileCode className="w-3 h-3 text-amber-700" />
                <span>20261021000001_initial_ct_hostel_schema.sql</span>
              </span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-emerald-900/10 border-b border-emerald-500/20 text-emerald-800 text-xs py-2 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">Supabase Backend Connected:</span>
            <span>Live PostgreSQL authentication, tables, and RLS policies ready.</span>
          </div>
          <span className="text-[11px] text-emerald-700 font-mono hidden sm:inline">CT GROUP Schema v1.0</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs py-2.5 px-4 shadow-sm">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">Phase 1 Foundation Status:</span>{' '}
              <span>Supabase credentials not yet configured in <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-800">.env</code>.</span>
              {previewRole && (
                <span className="ml-2 font-medium bg-amber-200/80 text-amber-900 px-1.5 py-0.5 rounded text-[10px]">
                  Viewing {previewRole.toUpperCase()} Dashboard (Preview)
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center space-x-1 text-amber-800 hover:text-amber-950 font-semibold text-[11px] underline ml-4 shrink-0"
          >
            <span>{isExpanded ? 'Hide Setup Guide' : 'Setup Guide'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-amber-200/60 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-amber-800">
            <div>
              <p className="font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-amber-700" />
                1. Connect Your Supabase Project
              </p>
              <p className="text-[11px] leading-relaxed">
                Add your Supabase Project URL &amp; anon public key into <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">.env</code>:
              </p>
              <pre className="mt-1 bg-amber-100/70 p-2 rounded text-[10px] font-mono overflow-x-auto text-amber-950">
                VITE_SUPABASE_URL=https://your-project.supabase.co{'\n'}
                VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
              </pre>
            </div>
            <div>
              <p className="font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-700" />
                2. Apply Schema Migration
              </p>
              <p className="text-[11px] leading-relaxed">
                Run the SQL script located at <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">supabase/migrations/20261021000001_initial_ct_hostel_schema.sql</code> in your Supabase SQL Editor.
              </p>
              <p className="text-[10px] text-amber-700 mt-1 italic">
                Security Policy: Never paste or commit private API keys. Use the publishable anon key only in .env.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
