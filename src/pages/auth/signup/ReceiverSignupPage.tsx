import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Shield,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { Logo } from '../../../components/layout/Logo'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import api from '../../../lib/api'

const ORGANIZATION_TYPES = [
  'NGO',
  'Shelter',
  'Community Kitchen',
  'Orphanage',
  'Old Age Home',
  'School',
  'Charity Organization',
  'Community Centre',
  'Other',
]

// Flow states:
// 1. 'form': Initial registration form
// 2. 'email_sent': Email verification screen with "Open Email" & "Resend"
// 3. 'verified_pending_admin': Shows Email Verified and Admin Verification status card
type SignupStep = 'form' | 'email_sent' | 'verified_pending_admin'

export function ReceiverSignupPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const { toast } = useToast()

  // Page flow state
  const [currentStep, setCurrentStep] = useState<SignupStep>('form')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Form State - strictly empty by default (no dummy values)
  const [form, setForm] = useState({
    orgName: '',
    contactPerson: '',
    orgType: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    pincode: '',
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Admin verification simulation tab for user inspection
  const [adminStatus, setAdminStatus] = useState<'pending' | 'verified' | 'action_required' | 'rejected'>('pending')

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: 'bg-slate-700' }
    let score = 0
    if (pass.length >= 8) score += 1
    if (/[A-Z]/.test(pass)) score += 1
    if (/[0-9]/.test(pass)) score += 1
    if (/[^A-Za-z0-9]/.test(pass)) score += 1

    if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' }
    if (score === 2) return { score: 2, label: 'Fair', color: 'bg-amber-500' }
    if (score === 3) return { score: 3, label: 'Good', color: 'bg-blue-400' }
    return { score: 4, label: 'Strong', color: 'bg-emerald-500' }
  }

  const passwordStrength = getPasswordStrength(form.password)

  // Validate form
  const validate = () => {
    const errs: Record<string, string> = {}

    if (!form.orgName.trim()) {
      errs.orgName = 'Organization name is required.'
    }
    if (!form.contactPerson.trim()) {
      errs.contactPerson = 'Primary contact person is required.'
    }
    if (!form.orgType) {
      errs.orgType = 'Please select an organization type.'
    }
    if (!form.email.trim()) {
      errs.email = 'Official email address is required.'
    } else if (!form.email.includes('@') || !form.email.includes('.')) {
      errs.email = 'Please enter a valid email address.'
    }
    if (!form.phone.trim()) {
      errs.phone = 'Phone number is required.'
    }
    if (!form.address.trim()) {
      errs.address = 'Organization address is required.'
    }
    if (!form.city.trim()) {
      errs.city = 'City is required.'
    }
    if (!form.pincode.trim()) {
      errs.pincode = 'Pincode is required.'
    }
    if (!form.password) {
      errs.password = 'Password is required.'
    } else if (form.password.length < 8) {
      errs.password = 'Password must be at least 8 characters long.'
    }
    if (form.password !== form.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.'
    }
    if (!form.agreeTerms) {
      errs.agreeTerms = 'You must agree to the Terms & Conditions and Privacy Policy.'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!validate()) {
      setErrorMessage('Please fill in all required fields accurately.')
      return
    }

    setLoading(true)
    try {
      // Backend API registration call
      const createdUser = await register({
        name: form.contactPerson.trim(),
        organization: form.orgName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: 'receiver',
        phone: form.phone.trim(),
        address: `${form.address.trim()}, ${form.city.trim()} - ${form.pincode.trim()}`,
        businessType: form.orgType,
        organizationType: form.orgType,
      })

      if (createdUser && (createdUser.verified || localStorage.getItem('token'))) {
        toast('Account created successfully! Welcome to FoodBridge.', 'success')
        navigate('/receiver', { replace: true })
      } else {
        toast('Account created! A verification link has been sent to your email.', 'success')
        setCurrentStep('email_sent')
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || 'Account registration failed. Please try again.'
      setErrorMessage(msg)
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Resend email handler
  const handleResendEmail = async () => {
    if (!form.email.trim()) {
      toast('Please enter your email address.', 'error')
      return
    }
    setResending(true)
    try {
      await api.post('/auth/resend-verification', { email: form.email.trim().toLowerCase() })
      toast(`Verification email resent to ${form.email}`, 'success')
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || 'Failed to resend verification email. Please try again later.'
      toast(msg, 'error')
    } finally {
      setResending(false)
    }
  }

  // Open email provider helper
  const handleOpenEmail = () => {
    const domain = form.email.split('@')[1]?.toLowerCase()
    if (domain?.includes('gmail')) {
      window.open('https://mail.google.com', '_blank')
    } else if (domain?.includes('outlook') || domain?.includes('hotmail')) {
      window.open('https://outlook.live.com', '_blank')
    } else if (domain?.includes('yahoo')) {
      window.open('https://mail.yahoo.com', '_blank')
    } else {
      window.open(`https://${domain}`, '_blank')
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#050B09] text-slate-100 flex flex-col justify-between selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* ========================================================================= */}
      {/* TOP BRANDING HEADER                                                      */}
      {/* ========================================================================= */}
      <header className="w-full border-b border-slate-800/80 bg-[#050B09]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo light size="sm" />
            </Link>
            <div className="hidden sm:block border-l border-slate-800 pl-3">
              <p className="text-[11px] leading-tight text-slate-400 font-medium">
                Connecting Food <br />
                <span className="text-emerald-400 font-semibold">Creating Hope</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="text-slate-400">Already have an account?</span>
            <Link
              to="/auth/login/receiver"
              className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 transition-colors"
            >
              Sign in
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MAIN CONTAINER — CENTERED WIDE ROUNDED DARK NAVY CARD                    */}
      {/* ========================================================================= */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 flex items-center justify-center">
        <div className="w-full rounded-3xl bg-[#0D1624] border border-slate-800 p-6 sm:p-10 shadow-2xl transition-all">
          
          {/* ===================================================================== */}
          {/* STEP 1: INITIAL SIGNUP FORM                                           */}
          {/* ===================================================================== */}
          {currentStep === 'form' && (
            <div className="space-y-6">
              {/* Receiver Portal Badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Users className="w-3.5 h-3.5" />
                  RECEIVER PORTAL
                </span>
                <span className="text-[11px] text-slate-400 font-medium">
                  Verified Organizations & Communities
                </span>
              </div>

              {/* Headings */}
              <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Create your receiver account
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Join FoodBridge and connect your community with surplus food.
                </p>
              </div>

              {/* Inline Error Notice */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2.5 animate-fade-in">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Form Body */}
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                {/* 2-Column Row: Organization Name & Primary Contact Person */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Organization Name <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Hope Community Centre"
                        value={form.orgName}
                        onChange={(e) => setForm({ ...form, orgName: e.target.value })}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.orgName ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
                      />
                    </div>
                    {errors.orgName && <p className="text-[11px] text-red-400 mt-1">{errors.orgName}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Primary Contact Person <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. Priya Kumar"
                        value={form.contactPerson}
                        onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.contactPerson ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
                      />
                    </div>
                    {errors.contactPerson && (
                      <p className="text-[11px] text-red-400 mt-1">{errors.contactPerson}</p>
                    )}
                  </div>
                </div>

                {/* Organization Type Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Organization Type <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <select
                      required
                      value={form.orgType}
                      onChange={(e) => setForm({ ...form, orgType: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                        errors.orgType ? 'border-red-500/60' : 'border-slate-700/80'
                      }`}
                    >
                      <option value="" disabled className="bg-slate-900 text-slate-500">
                        Select organization type
                      </option>
                      {ORGANIZATION_TYPES.map((type) => (
                        <option key={type} value={type} className="bg-slate-900 text-slate-200">
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  {errors.orgType && <p className="text-[11px] text-red-400 mt-1">{errors.orgType}</p>}
                </div>

                {/* 2-Column Row: Email Address & Phone Number */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        placeholder="organization@example.com"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.email ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
                      />
                    </div>
                    {errors.email && <p className="text-[11px] text-red-400 mt-1">{errors.email}</p>}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-300">
                        Phone Number <span className="text-red-400">*</span>
                      </label>
                      <span className="text-[10px] text-slate-400">(Contact only • No OTP)</span>
                    </div>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="tel"
                        required
                        placeholder="+91 XXXXX XXXXX"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.phone ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
                      />
                    </div>
                    {errors.phone && <p className="text-[11px] text-red-400 mt-1">{errors.phone}</p>}
                  </div>
                </div>

                {/* Location / Address */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Location / Address <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="Enter your organization address"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                        errors.address ? 'border-red-500/60' : 'border-slate-700/80'
                      }`}
                    />
                  </div>
                  {errors.address && <p className="text-[11px] text-red-400 mt-1">{errors.address}</p>}
                </div>

                {/* 2-Column Row: City & Pincode */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      City <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder=""
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                        errors.city ? 'border-red-500/60' : 'border-slate-700/80'
                      }`}
                    />
                    {errors.city && <p className="text-[11px] text-red-400 mt-1">{errors.city}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Pincode <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder=""
                      value={form.pincode}
                      onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                        errors.pincode ? 'border-red-500/60' : 'border-slate-700/80'
                      }`}
                    />
                    {errors.pincode && <p className="text-[11px] text-red-400 mt-1">{errors.pincode}</p>}
                  </div>
                </div>

                {/* 2-Column Row: Password & Confirm Password */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Password <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        placeholder="Create a password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.password ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
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
                    {/* Password strength indicator */}
                    {form.password && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Strength:</span>
                          <span className="font-semibold text-slate-300">{passwordStrength.label}</span>
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden flex gap-1">
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              passwordStrength.score >= 1 ? passwordStrength.color : 'bg-transparent'
                            }`}
                            style={{ width: '25%' }}
                          />
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              passwordStrength.score >= 2 ? passwordStrength.color : 'bg-transparent'
                            }`}
                            style={{ width: '25%' }}
                          />
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              passwordStrength.score >= 3 ? passwordStrength.color : 'bg-transparent'
                            }`}
                            style={{ width: '25%' }}
                          />
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              passwordStrength.score >= 4 ? passwordStrength.color : 'bg-transparent'
                            }`}
                            style={{ width: '25%' }}
                          />
                        </div>
                      </div>
                    )}
                    {errors.password && <p className="text-[11px] text-red-400 mt-1">{errors.password}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Confirm Password <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        placeholder="Confirm your password"
                        value={form.confirmPassword}
                        onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-900/90 border rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors ${
                          errors.confirmPassword ? 'border-red-500/60' : 'border-slate-700/80'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-[11px] text-red-400 mt-1">{errors.confirmPassword}</p>
                    )}
                  </div>
                </div>

                {/* Terms Checkbox */}
                <div className="pt-2">
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={form.agreeTerms}
                      onChange={(e) => setForm({ ...form, agreeTerms: e.target.checked })}
                      className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
                    />
                    <span>
                      I agree to the{' '}
                      <span className="text-emerald-400 hover:underline">FoodBridge Terms &amp; Conditions</span> and{' '}
                      <span className="text-emerald-400 hover:underline">Privacy Policy</span>.
                    </span>
                  </label>
                  {errors.agreeTerms && (
                    <p className="text-[11px] text-red-400 mt-1 ml-6">{errors.agreeTerms}</p>
                  )}
                </div>

                {/* Primary Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-bold shadow-lg transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating receiver account...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Receiver Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Bottom Information */}
                <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span>Already have an account?</span>
                    <Link
                      to="/auth/login/receiver"
                      className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1"
                    >
                      Sign in to receiver portal
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>

                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Your information is securely handled.</span>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* ===================================================================== */}
          {/* STEP 2: EMAIL VERIFICATION SCREEN                                     */}
          {/* ===================================================================== */}
          {currentStep === 'email_sent' && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
                <Mail className="w-8 h-8" />
              </div>

              <div className="space-y-2 max-w-md mx-auto">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Verify your email
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  We&apos;ve sent a verification link to your registered email address.
                </p>
              </div>

              {/* Registered Email Card */}
              <div className="max-w-md mx-auto p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-center gap-2.5">
                <Mail className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white break-all">
                  {form.email || 'organization@example.com'}
                </span>
              </div>

              <div className="max-w-md mx-auto p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 text-xs text-slate-400 leading-relaxed">
                Click the link in the verification email to confirm your organization address. FoodBridge does not use mobile OTP for account security.
              </div>

              {/* Buttons */}
              <div className="max-w-md mx-auto space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleOpenEmail}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg transition-all active:scale-[0.99]"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Email</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resending}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 text-xs sm:text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {resending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Resending email...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Resend verification email</span>
                    </>
                  )}
                </button>

                {/* Progression Button to demonstrate the verified pending state */}
                <div className="pt-4 border-t border-slate-800/60">
                  <button
                    type="button"
                    onClick={() => setCurrentStep('verified_pending_admin')}
                    className="text-xs text-emerald-400/90 hover:text-emerald-300 underline font-medium"
                  >
                    I have verified my email → View Account Review Status
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* STEP 3: AFTER EMAIL VERIFICATION & ADMIN VERIFICATION STATUS          */}
          {/* ===================================================================== */}
          {currentStep === 'verified_pending_admin' && (
            <div className="space-y-6">
              {/* Success Header */}
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Email Verified
                    <span className="text-emerald-400 text-xs">✓</span>
                  </h3>
                  <p className="text-xs text-emerald-300/80">
                    Your email has been confirmed. Your account is pending admin verification.
                  </p>
                </div>
              </div>

              {/* Headings */}
              <div className="space-y-1.5">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Account Verification Status
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Our FoodBridge team will review your organization details. Once approved, you&apos;ll be able to request and receive surplus food from verified donors.
                </p>
              </div>

              {/* Status Progression Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {/* 1. Email Verified Card */}
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Email Address</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      ✓ Verified
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {form.email || 'organization@example.com'}
                  </p>
                </div>

                {/* 2. Organization Verification Card */}
                <div
                  className={`p-4 rounded-2xl bg-slate-900/80 border space-y-2 ${
                    adminStatus === 'verified'
                      ? 'border-emerald-500/40'
                      : adminStatus === 'action_required'
                      ? 'border-amber-500/40'
                      : adminStatus === 'rejected'
                      ? 'border-red-500/40'
                      : 'border-amber-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Organization Review</span>
                    {adminStatus === 'verified' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        ✓ Verified
                      </span>
                    ) : adminStatus === 'action_required' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        ⚠ Info Needed
                      </span>
                    ) : adminStatus === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                        ✕ Unsuccessful
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        🟡 Pending Review
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {adminStatus === 'verified'
                      ? 'Verified Receiver'
                      : adminStatus === 'action_required'
                      ? 'Additional Information Required'
                      : adminStatus === 'rejected'
                      ? 'Verification Unsuccessful'
                      : 'Pending admin review'}
                  </p>
                </div>

                {/* 3. Account Status Card */}
                <div
                  className={`p-4 rounded-2xl bg-slate-900/80 border space-y-2 ${
                    adminStatus === 'verified' ? 'border-emerald-500/40' : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Account Status</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        adminStatus === 'verified'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {adminStatus === 'verified' ? 'Active' : 'Pending Approval'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {adminStatus === 'verified' ? 'Full receiver access granted' : 'Pending final approval'}
                  </p>
                </div>
              </div>

              {/* Status explanation narrative */}
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 leading-relaxed space-y-1">
                  <p className="font-semibold text-white">How FoodBridge Admin Verification Works:</p>
                  <p>
                    To ensure food safety and community accountability, every receiver organization is manually vetted by FoodBridge administrators. We confirm registration credentials and contact information. You will receive an email once the review is completed.
                  </p>
                </div>
              </div>

              {/* Status Simulator switch (lets user preview all states requested in prompt) */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400 font-semibold">
                  Preview Admin Verification States:
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAdminStatus('pending')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      adminStatus === 'pending'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🟡 Pending Review
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminStatus('verified')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      adminStatus === 'verified'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ✓ Verified Receiver
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminStatus('action_required')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      adminStatus === 'action_required'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚠ Info Needed
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminStatus('rejected')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      adminStatus === 'rejected'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ✕ Unsuccessful
                  </button>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/auth/login/receiver')}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg transition-all active:scale-[0.99]"
                >
                  <span>Continue to Login</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ========================================================================= */}
      {/* FOOTER                                                                   */}
      {/* ========================================================================= */}
      <footer className="border-t border-slate-800/60 py-4 text-center text-xs text-slate-500">
        FoodBridge &copy; 2026. Empowering Communities Through Food Redistribution.
      </footer>
    </div>
  )
}

