import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Shield,
  Users,
  Leaf,
  Truck,
  Heart,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { Logo } from '../../../components/layout/Logo'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'

export function ReceiverLoginPage() {
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
      setErrorMessage('Please enter both your email address and password.')
      return
    }

    // Basic email format check
    if (!email.includes('@') || !email.includes('.')) {
      setErrorMessage('Please enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      const authUser = await login({ email: email.trim().toLowerCase(), password, role: 'receiver' })
      toast('Signed in to Receiver Portal successfully.', 'success')
      const destination = redirectParam || (authUser.role === 'receiver' ? '/receiver' : '/donor')
      navigate(destination, { replace: true })
    } catch (error: any) {
      const code = error?.response?.data?.code
      const msg = error?.response?.data?.message || error?.message || 'Login failed.'
      if (error?.code === 'ERR_NETWORK' || error?.message?.includes('Network Error')) {
        setErrorMessage('Cannot reach backend server. If Render was idle, please wait a moment for it to wake up.')
        toast('Network Error: Server waking up.', 'error')
      } else if (code === 'EMAIL_NOT_VERIFIED' || code === 'EMAIL_UNVERIFIED') {
        setErrorMessage('Your email address is not verified yet. Please check your inbox.')
        toast('Please verify your email first.', 'warning')
      } else if (code === 'ROLE_MISMATCH') {
        setErrorMessage('This account is registered under a different portal. Please sign in via the Donor Portal.')
        toast('Role mismatch: use the Donor Portal.', 'warning')
      } else {
        setErrorMessage(msg || 'Invalid credentials. Please verify your email and password.')
        toast('Authentication failed.', 'error')
      }
    } finally {
      setLoading(false)
    }
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
            <span className="text-slate-400">Donor?</span>
            <Link
              to="/auth/login/donor"
              className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 transition-colors"
            >
              Sign in here
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Two-Column Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 w-full items-stretch min-h-[640px]">
          {/* ========================================================================= */}
          {/* LEFT SIDE — BRANDING & COMMUNITY MISSION */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 relative rounded-3xl overflow-hidden border border-slate-800/80 bg-slate-900 shadow-2xl flex flex-col justify-between p-6 sm:p-10 min-h-[500px] lg:min-h-full">
            {/* Background Image with Dark Atmospheric Overlay */}
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 mix-blend-luminosity scale-105 transition-transform duration-1000"
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
                    <Leaf className="w-4 h-4" />
                  </div>
                  <span className="text-xs uppercase tracking-widest font-bold text-emerald-400">
                    FoodBridge Receiver Network
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-medium pl-10">
                  Connecting Food • Creating Hope
                </p>
              </div>

              {/* Main Headline */}
              <div className="space-y-3 pt-2">
                <h1 className="text-3xl sm:text-4xl lg:text-[44px] font-black tracking-tight text-white leading-tight">
                  Together, <br />
                  we can feed <br />
                  <span className="text-emerald-400">brighter tomorrows.</span>
                </h1>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-md">
                  Sign in to your receiver portal and continue making a difference in your community.
                </p>
              </div>

              {/* Three Receiver Benefits */}
              <div className="space-y-3.5 pt-2">
                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Request food</h4>
                    <p className="text-xs text-slate-400">Get food support for your community</p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Coordinate collections</h4>
                    <p className="text-xs text-slate-400">Coordinate pickups and deliveries efficiently</p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <Heart className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Serve your community</h4>
                    <p className="text-xs text-slate-400">Manage distributions and track your impact</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Quote & Community Illustration */}
            <div className="relative z-10 pt-8 border-t border-slate-800/80 mt-6 flex items-end justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-300 font-medium italic">
                  &ldquo;Good food reaches people. <br />
                  Hope grows stronger.&rdquo;
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                    Communities Are Stronger Together
                  </span>
                </div>
              </div>
              <div className="hidden sm:block opacity-60">
                <Leaf className="w-8 h-8 text-emerald-400" />
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* RIGHT SIDE — RECEIVER LOGIN CARD */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="rounded-3xl bg-[#0D1624] border border-slate-800 p-6 sm:p-10 shadow-2xl space-y-6">
              {/* Receiver Portal Badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Users className="w-3.5 h-3.5" />
                  RECEIVER PORTAL
                </span>
                <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
                  Authorized NGOs & Shelters
                </span>
              </div>

              {/* Headings */}
              <div className="space-y-1.5">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Welcome Back!
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Sign in to your receiver portal and continue your mission of serving the community.
                </p>
              </div>

              {/* Inline Error Notice */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2.5 animate-fade-in">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                {/* Email Address */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Email Address <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="Enter your organization email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border border-slate-700/80 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Password with Forgot Password link */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      Password <span className="text-red-400">*</span>
                    </label>
                    <Link
                      to="/auth/forgot-password"
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
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
                      <span>Signing in to receiver portal...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in to receiver portal</span>
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
                    OR
                  </span>
                </div>

                {/* Create Account Section */}
                <div className="space-y-2 pt-1 text-center">
                  <p className="text-xs text-slate-400">Don&apos;t have an account?</p>
                  <Link
                    to="/auth/signup/receiver"
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900/60 hover:bg-slate-800/80 text-slate-200 text-xs sm:text-sm font-semibold transition-all active:scale-[0.99]"
                  >
                    <span>Create receiver account</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </form>

              {/* Trust Indicators */}
              <div className="pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Shield className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">Secure access</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Your data is safe with us.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Users className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">Verified organizations</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Building trust for greater impact.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-xl bg-slate-900/40">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Leaf className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-[11px]">A better tomorrow</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Because every meal matters.</p>
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
