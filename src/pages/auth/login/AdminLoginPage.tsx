import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  Shield,
  Activity,
  UserCheck,
  FileCheck2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { Logo } from '../../../components/layout/Logo'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login } = useAuth()
  const { toast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const redirectParam = searchParams.get('redirect')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both your administrative email and password.')
      return
    }

    if (!email.includes('@') || !email.includes('.')) {
      setErrorMessage('Please enter a valid administrative email address.')
      return
    }

    setLoading(true)
    try {
      const authUser = await login({ email: email.trim().toLowerCase(), password })
      if (authUser.role !== 'admin' && authUser.role !== 'super_admin') {
        setErrorMessage('Access denied. This portal requires verified administrative credentials.')
        toast('This portal requires administrative privileges.', 'error')
        return
      }
      toast('Signed in to Admin Portal.', 'success')
      const destination = redirectParam || '/admin'
      navigate(destination, { replace: true })
    } catch (error: any) {
      if (error?.code === 'ERR_NETWORK' || error?.message?.includes('Network Error')) {
        setErrorMessage('Cannot reach backend server. Please verify your Render service is awake or check connection.')
        toast('Network Error: Unable to reach backend.', 'error')
      } else if (error?.response?.status === 401) {
        setErrorMessage('Invalid admin email or password. Use: admin@foodbridge.org / Admin@123')
        toast('Invalid credentials.', 'error')
      } else {
        const msg = error?.response?.data?.message || error?.message || 'Admin authentication failed. Please verify credentials.'
        setErrorMessage(msg)
        toast(msg, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const fillDefaultCredentials = () => {
    setEmail('admin@foodbridge.org')
    setPassword('Admin@123')
    setErrorMessage(null)
  }

  return (
    <div className="min-h-screen w-full bg-[#050B09] text-slate-100 flex flex-col justify-between selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Top Header Bar */}
      <header className="w-full border-b border-slate-800/80 bg-[#050B09]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo light size="sm" />
          </Link>
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="text-slate-400">Regular user?</span>
            <Link
              to="/auth/login"
              className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 transition-colors"
            >
              Public login
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Two-Column Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 w-full items-stretch min-h-[640px]">
          {/* ========================================================================= */}
          {/* LEFT SIDE — BRANDING & ADMIN GOVERNANCE */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 relative rounded-3xl overflow-hidden border border-slate-800/80 bg-slate-900 shadow-2xl flex flex-col justify-between p-6 sm:p-10 min-h-[500px] lg:min-h-full">
            {/* Background Image with Dark Atmospheric Overlay */}
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity scale-105 transition-transform duration-1000"
              style={{ backgroundImage: "url('/receiver-login-bg.jpg')" }}
            />
            {/* Dual gradient overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#050B09] via-[#050B09]/85 to-[#050B09]/90" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050B09]/90 via-transparent to-[#050B09]/60" />

            {/* Content Layer */}
            <div className="relative z-10 space-y-6">
              {/* Brand Tagline Header */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="text-xs uppercase tracking-widest font-bold text-emerald-400">
                    FoodBridge Trust &amp; Governance
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-medium pl-10">
                  Platform Oversight • Organization Vetting
                </p>
              </div>

              {/* Main Headline */}
              <div className="space-y-3 pt-2">
                <h1 className="text-3xl sm:text-4xl lg:text-[44px] font-black tracking-tight text-white leading-tight">
                  Secure administration <br />
                  &amp; community <br />
                  <span className="text-emerald-400">verification center.</span>
                </h1>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-md">
                  Authorized control plane to review NGO registrations, verify donor hygiene licenses, and oversee redistribution logistics.
                </p>
              </div>

              {/* Three Admin Capabilities */}
              <div className="space-y-3.5 pt-2">
                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Organization approvals</h4>
                    <p className="text-xs text-slate-400">Vet receiver NGOs, charities, and community shelters</p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <FileCheck2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Compliance &amp; safety</h4>
                    <p className="text-xs text-slate-400">Validate donor FSSAI licensing and food handling standards</p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Live network metrics</h4>
                    <p className="text-xs text-slate-400">Monitor active pickups, kg redistributed, and emergency alerts</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Security Notice */}
            <div className="relative z-10 pt-8 border-t border-slate-800/80 mt-6 flex items-end justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-300 font-medium italic">
                  &ldquo;Platform trust is the bedrock of feeding communities safely.&rdquo;
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                    Role-Based Access Control • Audit Logging Active
                  </span>
                </div>
              </div>
              <div className="hidden sm:block opacity-60">
                <ShieldAlert className="w-8 h-8 text-emerald-400" />
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* RIGHT SIDE — ADMIN LOGIN CARD */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="rounded-3xl bg-[#0D1624] border border-slate-800 p-6 sm:p-10 shadow-2xl space-y-6">
              {/* Admin Badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  ADMIN PORTAL
                </span>
                <span className="text-[11px] text-amber-400 font-medium hidden sm:inline flex items-center gap-1">
                  🔒 Restricted Access
                </span>
              </div>

              {/* Headings */}
              <div className="space-y-1.5">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Admin Portal Login
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Sign in with authorized credentials to access FoodBridge platform governance, approvals, and system analytics.
                </p>
              </div>

              {/* Inline Error Notice */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2.5 animate-fade-in">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Quick credentials card */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700/60 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-slate-400">Default Admin: </span>
                  <span className="text-emerald-400 font-mono font-medium">admin@foodbridge.org</span>
                  <span className="text-slate-500"> / </span>
                  <span className="text-slate-300 font-mono">Admin@123</span>
                </div>
                <button
                  type="button"
                  onClick={fillDefaultCredentials}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold transition-colors shrink-0"
                >
                  Auto-fill
                </button>
              </div>

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                {/* Email Address */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Admin Email Address <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="admin@foodbridge.org"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border border-slate-700/80 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Password <span className="text-red-400">*</span>
                    </label>
                    <span className="text-[11px] text-slate-500">256-bit encrypted</span>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter admin password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-900/90 border border-slate-700/80 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Primary Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-bold shadow-lg transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Authenticating administrator...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in to Admin Portal</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="relative py-2 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800" />
                  </div>
                  <span className="relative bg-[#0D1624] px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    ROLE PORTALS
                  </span>
                </div>

                {/* Role Switch Links */}
                <div className="grid grid-cols-2 gap-2.5 pt-1 text-center">
                  <Link
                    to="/auth/login/donor"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 text-xs font-medium transition-all"
                  >
                    <span>Donor Portal</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                  <Link
                    to="/auth/login/receiver"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 text-xs font-medium transition-all"
                  >
                    <span>Receiver Portal</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </form>

              {/* Trust & Security Indicators */}
              <div className="pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Shield className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">Audit Trails</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">All actions logged &amp; timestamped.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <UserCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">Strict RBAC</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Role-scoped permissions only.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Activity className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">Platform Guard</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Zero tolerance for bad actors.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer copyright */}
      <footer className="border-t border-slate-800/60 py-4 text-center text-xs text-slate-500">
        FoodBridge &copy; 2026. Empowering Communities Through Food Redistribution.
      </footer>
    </div>
  )
}

