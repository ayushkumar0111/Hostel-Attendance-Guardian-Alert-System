import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { ConfigBanner } from './components/common/ConfigBanner';
import { LoginForm } from './components/auth/LoginForm';
import { StudentDashboard } from './components/student/StudentDashboard';
import { WardenDashboard } from './components/warden/WardenDashboard';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { GuardianDashboard } from './components/guardian/GuardianDashboard';
import { PwaInstallModal } from './components/common/PwaInstallModal';
import { NotificationSettingsModal } from './components/notifications/NotificationSettingsModal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DashboardRouter: React.FC = () => {
  const { user, role, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-3">
        <div className="w-10 h-10 border-4 border-ct-navy border-t-ct-gold rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500">Loading CT Hostel System...</p>
      </div>
    );
  }

  // If not authenticated and no preview role active, render institutional login form
  if (!user && !role) {
    return <LoginForm />;
  }

  // Route to the corresponding role dashboard
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {role === 'student' && <StudentDashboard />}
      {role === 'warden' && <WardenDashboard />}
      {role === 'admin' && <AdminDashboard />}
      {role === 'guardian' && <GuardianDashboard />}
      {!role && <LoginForm />}
    </div>
  );
};

export const AppContent: React.FC = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [showNotificationModal, setShowNotificationModal] = useState<boolean>(false);

  useEffect(() => {
    // Check if app is launched in standalone / display-mode standalone
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true);
    setIsStandalone(Boolean(isStandaloneMode));

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstallable(false);
          setInstallPrompt(null);
          setShowInstallModal(false);
          return;
        }
      } catch (err) {
        console.warn('Native install prompt encountered an issue:', err);
      }
    }
    // Show detailed illustrated modal for Android Chrome & iOS Safari
    setShowInstallModal(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header
        canInstall={isInstallable}
        isStandalone={isStandalone}
        onInstallClick={handleInstallClick}
        onNotificationsClick={() => setShowNotificationModal(true)}
      />
      <ConfigBanner />

      <main className="flex-1">
        <DashboardRouter />
      </main>

      <Footer />

      <PwaInstallModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        onNativeInstall={installPrompt ? handleInstallClick : undefined}
        hasNativePrompt={Boolean(installPrompt)}
      />

      <NotificationSettingsModal
        isOpen={showNotificationModal}
        onClose={() => setShowNotificationModal(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
