import React, { useState } from 'react';
import { Download, X, Smartphone, CheckCircle2, ShieldAlert, Sparkles, Share, MoreVertical } from 'lucide-react';

interface PwaInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNativeInstall?: () => Promise<void>;
  hasNativePrompt: boolean;
}

export const PwaInstallModal: React.FC<PwaInstallModalProps> = ({
  isOpen,
  onClose,
  onNativeInstall,
  hasNativePrompt
}) => {
  const [activeTab, setActiveTab] = useState<'android' | 'ios'>('android');
  const [isInstalling, setIsInstalling] = useState(false);

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    if (onNativeInstall) {
      setIsInstalling(true);
      try {
        await onNativeInstall();
      } finally {
        setIsInstalling(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-ct-navy via-slate-900 to-ct-navy-light p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-md shrink-0">
              CT
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Installable PWA
                </span>
                <span className="text-xs text-slate-300">Android Chrome</span>
              </div>
              <h2 className="text-lg font-bold text-white mt-0.5">Install CT Hostel App</h2>
            </div>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Get instant home screen access, fast biometric camera check-in, and offline reliability on your Android phone.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3">
          <button
            onClick={() => setActiveTab('android')}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'android'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-4 h-4 text-emerald-600" />
            <span>Android (Chrome)</span>
          </button>
          <button
            onClick={() => setActiveTab('ios')}
            className={`pb-2.5 px-4 text-xs font-bold border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'ios'
                ? 'border-ct-navy text-ct-navy'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Share className="w-3.5 h-3.5 text-blue-600" />
            <span>iOS (Safari)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {hasNativePrompt && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  One-Click Install Available
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Your browser supports direct installation. Tap below to add CT Hostel directly.
                </p>
              </div>
              <button
                onClick={handleInstallClick}
                disabled={isInstalling}
                className="px-4 py-2 bg-ct-navy hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span>{isInstalling ? 'Installing...' : 'Install Now'}</span>
              </button>
            </div>
          )}

          {activeTab === 'android' ? (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Step-by-Step Android Chrome Instructions:
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Open in Google Chrome</p>
                    <p className="text-[11px] text-slate-500">
                      Visit the secure portal URL (<span className="font-mono text-slate-700">HTTPS</span>) in Google Chrome on your phone.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                      <span>Tap Menu</span>
                      <MoreVertical className="w-3.5 h-3.5 inline text-slate-700" />
                      <span>in top-right corner</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Tap the three vertical dots located next to the address bar.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Select "Install app" or "Add to Home screen"
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Tap the install option in the menu. Confirm the dialog prompt.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    ✓
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Instant Fullscreen App Experience</p>
                    <p className="text-[11px] text-slate-500">
                      "CT Hostel" will appear in your Android app drawer with native-like performance and zero browser chrome.
                    </p>
                  </div>
                </div>
              </div>

              {/* Crucial Permissions Notice */}
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div className="text-[11px] text-blue-900 leading-relaxed">
                  <span className="font-bold">Required Permissions: </span>
                  Upon opening, please grant <strong>Camera</strong> (for face recognition) and <strong>Location</strong> (for 9:30–10:30 PM Shahpur campus curfew verification).
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Step-by-Step iOS Safari Instructions:
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Open in Safari</p>
                    <p className="text-[11px] text-slate-500">
                      Ensure you are using Apple Safari on iOS.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                      <span>Tap the Share button</span>
                      <Share className="w-3.5 h-3.5 inline text-blue-600" />
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Located in the bottom navigation bar of Safari.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-6 h-6 rounded-full bg-ct-navy text-white text-xs font-bold flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Tap "Add to Home Screen"</p>
                    <p className="text-[11px] text-slate-500">
                      Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong> in the top-right corner.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Feature Highlights */}
          <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Face recognition check-in</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Shahpur GPS geofencing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Hostel room & leave tracking</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Offline shell caching</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">CT Group of Institutions</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-sm transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
