import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, Download, Bell } from 'lucide-react';
import { UserRole } from '../../types/database';

interface HeaderProps {
  onInstallClick?: () => void;
  onNotificationsClick?: () => void;
  canInstall?: boolean;
  isStandalone?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onInstallClick,
  onNotificationsClick,
  canInstall,
  isStandalone
}) => {
  const { user, profile, role, previewRole, setPreviewRole, signOut } = useAuth();

  const getRoleBadgeColor = (r: UserRole | null) => {
    switch (r) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'warden':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'guardian':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'student':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <header className="bg-ct-navy text-white shadow-lg sticky top-0 z-40 border-b-2 border-ct-gold/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Brand Logo & Titles */}
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-ct-navy-light to-ct-navy flex items-center justify-center border-2 border-ct-gold shadow-md shrink-0">
              <span className="text-ct-gold font-black text-xl tracking-wider">CT</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base sm:text-lg tracking-wide text-white uppercase">
                  CT GROUP OF INSTITUTIONS
                </span>
                <span className="hidden md:inline-block px-2 py-0.5 text-[10px] font-semibold bg-ct-gold/20 text-ct-gold border border-ct-gold/40 rounded-full">
                  CT
                </span>
              </div>
              <h1 className="text-xs sm:text-sm font-medium text-slate-300 flex items-center gap-1.5">
                <span>Hostel Attendance &amp; Guardian Alert System</span>
                <span className="hidden lg:inline text-slate-400">• Built by Ayush Kumar</span>
              </h1>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-3">
            {/* PWA Install Button */}
            {!isStandalone && onInstallClick && (
              <>
                <button
                  onClick={onInstallClick}
                  className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-ct-gold hover:bg-ct-gold-dark text-slate-950 rounded-lg shadow-sm transition-all"
                  title={canInstall ? "Install CT Hostel App (One-click install ready)" : "Install CT Hostel App"}
                >
                  <Download className="w-4 h-4" />
                  <span>{canInstall ? "Install App" : "Get App"}</span>
                </button>
                <button
                  onClick={onInstallClick}
                  className="flex sm:hidden items-center justify-center p-2 text-xs font-semibold bg-ct-gold hover:bg-ct-gold-dark text-slate-950 rounded-lg shadow-sm transition-all"
                  title={canInstall ? "Install CT Hostel App (One-click install ready)" : "Install CT Hostel App"}
                  aria-label="Install CT Hostel App"
                >
                  <Download className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Web Push Notification Settings Button */}
            {onNotificationsClick && (
              <button
                onClick={onNotificationsClick}
                className="p-2 rounded-lg bg-ct-navy-light hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700 transition relative shrink-0"
                title="Notification Settings (Web Push)"
                aria-label="Notification Settings"
              >
                <Bell className="w-4 h-4 text-ct-gold" />
              </button>
            )}

            {/* Role / User Info */}
            {role ? (
              <div className="flex items-center space-x-3">
                {/* Active Role Pill */}
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1.5">
                    {previewRole && (
                      <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">
                        Preview Mode
                      </span>
                    )}
                    <span
                      className={`px-2.5 py-0.5 text-xs font-bold uppercase rounded-md border ${getRoleBadgeColor(
                        role
                      )}`}
                    >
                      {role}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-300 hidden sm:inline">
                    {profile?.full_name || user?.email || 'Logged In'}
                  </span>
                </div>

                {/* Switch Role Quick Dropdown (Restricted to Administrators or Unauthenticated Preview) */}
                {(!user || profile?.role === 'admin') && (
                  <div className="relative group">
                    <select
                      value={role || ''}
                      onChange={(e) => setPreviewRole((e.target.value as UserRole) || null)}
                      className="bg-ct-navy-light text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-ct-gold cursor-pointer"
                      title="Switch Dashboard Role View"
                    >
                      <option value="student">Preview: Student</option>
                      <option value="guardian">Preview: Guardian</option>
                      <option value="warden">Preview: Warden</option>
                      <option value="admin">Preview: Admin</option>
                    </select>
                  </div>
                )}

                {/* Sign Out Button */}
                <button
                  onClick={() => signOut()}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-300 hidden sm:inline">Phase 1 Foundation</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
