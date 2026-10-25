import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Shield, Lock, Mail, User, AlertCircle, ArrowRight, Eye, EyeOff, Sparkles, GraduationCap, Building2, HeartHandshake } from 'lucide-react';

export const LoginForm: React.FC = () => {
  const { signIn, signUp, setPreviewRole } = useAuth();
  const [portalType, setPortalType] = useState<'student' | 'guardian' | 'staff'>('student');
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        if (!fullName.trim()) {
          setErrorMessage('Please enter your full name');
          setIsSubmitting(false);
          return;
        }
        const targetRole = portalType === 'guardian' ? 'guardian' : 'student';
        const { error } = await signUp(email, password, fullName, targetRole);
        if (error) {
          setErrorMessage(error.message);
        } else {
          setSuccessMessage('Registration submitted! Please verify your email or sign in below.');
          setIsSignUp(false);
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          setErrorMessage(error.message);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('An unexpected authentication error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-100 via-slate-50 to-slate-200">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Institutional Monogram */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-ct-navy flex items-center justify-center border-2 border-ct-gold shadow-xl">
            <span className="text-ct-gold font-black text-2xl tracking-wider">CT</span>
          </div>
        </div>

        <h2 className="mt-4 text-center text-xl sm:text-2xl font-black text-slate-900 tracking-tight uppercase">
          CT GROUP OF INSTITUTIONS
        </h2>
        <p className="mt-1 text-center text-xs font-semibold text-slate-600">
          Hostel Attendance &amp; Guardian Alert System
        </p>
        <p className="text-center text-[11px] text-slate-500 font-medium">
          Built by Ayush Kumar • Developed by CT
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl sm:px-10 border border-slate-200">
          {/* Clearly Visible Role Segmented Control */}
          <div className="grid grid-cols-3 p-1 bg-slate-100 rounded-xl mb-6 border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setPortalType('student');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`py-2 px-2 text-xs font-bold rounded-lg flex items-center justify-center space-x-1 transition-all ${
                portalType === 'student'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 shrink-0" />
              <span>Student</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPortalType('guardian');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`py-2 px-2 text-xs font-bold rounded-lg flex items-center justify-center space-x-1 transition-all ${
                portalType === 'guardian'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <HeartHandshake className="w-3.5 h-3.5 shrink-0" />
              <span>Guardian</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPortalType('staff');
                setIsSignUp(false);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`py-2 px-2 text-xs font-bold rounded-lg flex items-center justify-center space-x-1 transition-all ${
                portalType === 'staff'
                  ? 'bg-ct-navy text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>Staff</span>
            </button>
          </div>

          {/* Form Header */}
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
            <div>
              <div className="flex items-center space-x-2">
                {portalType === 'student' ? (
                  <GraduationCap className="w-5 h-5 text-emerald-700" />
                ) : portalType === 'guardian' ? (
                  <HeartHandshake className="w-5 h-5 text-amber-600" />
                ) : (
                  <Building2 className="w-5 h-5 text-ct-navy" />
                )}
                <h3 className="text-base font-bold text-slate-900">
                  {portalType === 'student'
                    ? isSignUp
                      ? 'Register Student Account'
                      : 'Student Resident Sign-In'
                    : portalType === 'guardian'
                    ? isSignUp
                      ? 'Register Guardian Account'
                      : 'Guardian Portal Sign-In'
                    : 'Staff & Administration Portal'}
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {portalType === 'student'
                  ? isSignUp
                    ? 'Create your resident credentials for hostel access'
                    : 'Sign in to submit daily roll-call, view room allocation & leaves'
                  : portalType === 'guardian'
                  ? isSignUp
                    ? 'Register to receive in-app absence notices & track attendance'
                    : 'Sign in to view ward roll-call status and notifications'
                  : 'Authorized login for Wardens and Administrators'}
              </p>
            </div>
            <span
              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded border ${
                portalType === 'student'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : portalType === 'guardian'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-purple-50 text-purple-800 border-purple-200'
              }`}
            >
              {portalType === 'student' ? 'Student' : portalType === 'guardian' ? 'Guardian' : 'Staff'}
            </span>
          </div>

          {/* Error / Success Feedback */}
          {errorMessage && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start space-x-2">
              <Shield className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Supabase Form */}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {isSignUp && portalType !== 'staff' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {portalType === 'guardian' ? 'Guardian Full Name' : 'Student Full Name'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={portalType === 'guardian' ? 'e.g. Rajesh Kumar' : 'e.g. Ayush Kumar'}
                      className="block w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-ct-navy focus:border-ct-navy"
                    />
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border text-xs ${
                    portalType === 'guardian'
                      ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                      : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Enrolled Role:</span>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                        portalType === 'guardian'
                          ? 'bg-amber-200 text-amber-950'
                          : 'bg-emerald-200 text-emerald-900'
                      }`}
                    >
                      {portalType === 'guardian' ? 'Guardian / Parent' : 'Student Resident'}
                    </span>
                  </div>
                  <p className="text-[11px] mt-1.5 leading-normal opacity-90">
                    {portalType === 'guardian'
                      ? 'Guardian accounts provide in-app absence notices, attendance status, and direct hostel warden connectivity.'
                      : 'Public registration strictly provisions accounts with the Student role. Wardens and Administrators are authorized by institutional governance.'}
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {portalType === 'student'
                  ? 'Student Institutional Email'
                  : portalType === 'guardian'
                  ? 'Registered Guardian Email'
                  : 'Official Staff Email'}{' '}
                <span className="text-rose-500">*</span>
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    portalType === 'student'
                      ? 'rollnumber@ctgroup.in (e.g. 2404391@ctgroup.in)'
                      : portalType === 'guardian'
                      ? 'guardian@example.com (emergency email on file)'
                      : 'warden@ctgroup.in or admin@ctgroup.in'
                  }
                  className="block w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-ct-navy focus:border-ct-navy"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full pl-9 pr-10 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-ct-navy focus:border-ct-navy"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-xs font-bold text-white transition-colors disabled:opacity-50 ${
                  portalType === 'student'
                    ? 'bg-emerald-700 hover:bg-emerald-800 focus:ring-emerald-700'
                    : portalType === 'guardian'
                    ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-600'
                    : 'bg-ct-navy hover:bg-ct-navy-light focus:ring-ct-navy'
                }`}
              >
                {isSubmitting ? (
                  <span>Authenticating...</span>
                ) : (
                  <>
                    <span>
                      {portalType === 'student'
                        ? isSignUp
                          ? 'Register Student Resident'
                          : 'Sign In as Student'
                        : portalType === 'guardian'
                        ? isSignUp
                          ? 'Register Guardian Account'
                          : 'Sign In as Guardian'
                        : 'Sign In to Staff Console'}
                    </span>
                    <ArrowRight className="ml-2 w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Toggle between Sign In and Sign Up for Students and Guardians */}
          {portalType !== 'staff' && (
            <div className="mt-5 text-center">
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`text-xs font-semibold hover:underline ${
                  portalType === 'student' ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                {isSignUp
                  ? 'Already have an enrolled account? Sign in here'
                  : `New ${portalType === 'student' ? 'student resident' : 'guardian'}? Register account here`}
              </button>
            </div>
          )}

          {/* Staff Info Note */}
          {portalType === 'staff' && (
            <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">Governance Notice:</span> Warden and Administrator accounts are provisioned exclusively through institutional governance. Self-registration is strictly restricted to student resident and guardian accounts.
            </div>
          )}

          {/* Inspection & Foundation Phase Review Access */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-ct-gold" />
                Phase 1 Inspection
              </span>
              <span className="text-[10px] text-slate-400">Offline View</span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3 leading-normal">
              Inspect the planned dashboard architecture without credentials:
            </p>

            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setPreviewRole('student')}
                className="px-2 py-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center transition-colors"
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => setPreviewRole('guardian')}
                className="px-2 py-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg text-center transition-colors"
              >
                Guardian
              </button>
              <button
                type="button"
                onClick={() => setPreviewRole('warden')}
                className="px-2 py-1.5 text-[11px] font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-center transition-colors"
              >
                Warden
              </button>
              <button
                type="button"
                onClick={() => setPreviewRole('admin')}
                className="px-2 py-1.5 text-[11px] font-semibold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-center transition-colors"
              >
                Admin
              </button>
            </div>
          </div>
        </div>

        {/* Security / Compliance Notice */}
        <p className="mt-4 text-center text-[11px] text-slate-500">
          Strict role-based access enforced via PostgreSQL Row Level Security (RLS).
        </p>
      </div>
    </div>
  );
};
