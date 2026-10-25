import React from 'react';
import { Shield, Code, Building, Cpu } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-900 text-slate-400 text-xs border-t border-slate-800 mt-auto py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2 text-white font-bold text-sm mb-2">
              <Building className="w-4 h-4 text-ct-gold" />
              <span>CT GROUP OF INSTITUTIONS</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-xs">
              Hostel Attendance &amp; Guardian Alert System. Standardizing safety, verifiable attendance,
              and immediate guardian escalation across campus residential facilities.
            </p>
          </div>

          <div>
            <div className="flex items-center space-x-2 text-white font-bold text-sm mb-2">
              <Code className="w-4 h-4 text-emerald-400" />
              <span>Credits &amp; Development</span>
            </div>
            <ul className="space-y-1 text-slate-400">
              <li>
                <span className="text-slate-200 font-medium">Built by:</span> Ayush Kumar
              </li>
              <li>
                <span className="text-slate-200 font-medium">Developed by:</span> CT (CT Group of Institutions)
              </li>
              <li>
                <span className="text-slate-200 font-medium">Platform:</span> Responsive PWA + Supabase PostgreSQL
              </li>
            </ul>
          </div>

          <div>
            <div className="flex items-center space-x-2 text-white font-bold text-sm mb-2">
              <Shield className="w-4 h-4 text-sky-400" />
              <span>Phase 1 Scope &amp; Compliance</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Foundation release: Role-based architecture, Supabase schema migrations, secure session handling,
              and zero simulated/fake mock records. Real telephony, AI voice, and GPS geofencing engage in subsequent phases.
            </p>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between text-slate-500 text-[11px] gap-2">
          <p>© 2026 CT GROUP OF INSTITUTIONS. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-ct-gold" />
            <span>CT Hostel System v1.0 (Phase 1: Foundation)</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
