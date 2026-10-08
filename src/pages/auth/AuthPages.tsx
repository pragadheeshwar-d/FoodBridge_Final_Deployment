import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock } from 'lucide-react'
import { AuthShell } from './AuthShell'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../context/ToastContext'
import api from '../../lib/api'

export function ForgotPasswordPage() {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast('Please enter your email.', 'warning')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
      toast('Reset link sent! Check your inbox.', 'success')
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Failed to send reset link', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a secure reset link."
    >
      {sent ? (
        <div className="text-center py-4 space-y-3">
          <p className="text-green-600 font-semibold">Reset link sent to {email}</p>
          <p className="text-sm text-text-secondary">Check your inbox and follow the link to create a new password.</p>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={Mail}
            required
          />
          <Button variant="primary" className="w-full" type="submit" loading={loading}>
            Send Reset Link
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const token = searchParams.get('token') || ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || password.length < 8) {
      toast('Password must be at least 8 characters.', 'warning')
      return
    }
    if (password !== confirmPassword) {
      toast('Passwords do not match.', 'error')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      toast('Password reset successfully. Please log in.', 'success')
      navigate('/auth/login', { replace: true })
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Failed to reset password', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Create a new password"
      subtitle="Use a strong password to protect your FoodBridge account."
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <Input
          label="New Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          icon={Lock}
          required
        />
        <Input
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          icon={Lock}
          required
        />
        <Button variant="primary" className="w-full" type="submit" loading={loading}>
          Update Password
        </Button>
      </form>
    </AuthShell>
  )
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [verifiedUser, setVerifiedUser] = useState<any | null>(null)
  const token = searchParams.get('token') || ''

  const hasVerified = useRef(false)

  const verify = async () => {
    if (!token) {
      toast('No verification token found in URL.', 'error')
      return
    }
    setStatus('loading')
    try {
      const res = await api.post('/auth/verify-email', { token })
      const u = res?.data?.user || res?.data?.data?.user
      const authToken = res?.data?.token || res?.data?.data?.token

      if (authToken) {
        localStorage.setItem('token', authToken)
      }
      if (u) {
        localStorage.setItem('user', JSON.stringify(u))
        setVerifiedUser(u)
      }

      setStatus('success')
      toast('Email verified successfully!', 'success')
    } catch (err: any) {
      setStatus('error')
      toast(err?.response?.data?.message || 'Verification failed. Link may be invalid or expired.', 'error')
    }
  }

  useEffect(() => {
    if (token && !hasVerified.current) {
      hasVerified.current = true
      void verify()
    }
  }, [token])

  const targetDashboard = verifiedUser?.role === 'receiver' ? '/receiver' : '/donor'
  const targetLogin = verifiedUser?.role === 'receiver' ? '/auth/login/receiver' : '/auth/login/donor'

  return (
    <AuthShell
      title={status === 'success' ? 'Email Verified Successfully!' : 'Confirm Your Email'}
      subtitle={
        status === 'success'
          ? 'Your email address has been verified. Welcome to FoodBridge!'
          : 'Please wait while we verify your email address...'
      }
    >
      <div className="space-y-6">
        {status === 'success' && (
          <div className="space-y-4">
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center flex flex-col items-center">
              <div className="w-14 h-14 bg-emerald-500 text-white rounded-2xl flex items-center justify-center mb-3 shadow-glow">
                <span className="text-2xl font-bold">✓</span>
              </div>
              <h3 className="text-lg font-bold text-text dark:text-white">Email Confirmed!</h3>
              <p className="text-sm text-text-secondary mt-1 max-w-sm">
                {verifiedUser?.organization ? `${verifiedUser.organization} (${verifiedUser.name})` : verifiedUser?.name || 'Your account'} is now fully verified and activated.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <Button
                variant="primary"
                className="w-full shadow-glow"
                onClick={() => navigate(targetDashboard)}
              >
                Continue to {verifiedUser?.role === 'receiver' ? 'Receiver' : 'Donor'} Dashboard
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => navigate(targetLogin)}
              >
                Go to Sign In
              </Button>
              <Button
                variant="ghost"
                className="w-full text-xs text-text-secondary"
                onClick={() => navigate('/')}
              >
                Back to Home
              </Button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4 text-center">
            <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20">
              <p className="text-red-600 dark:text-red-400 font-bold mb-1">Verification Link Expired or Invalid</p>
              <p className="text-xs text-text-secondary">
                Please request a new verification link or sign in to resend.
              </p>
            </div>
            <div className="space-y-2">
              <Button
                variant="primary"
                className="w-full"
                onClick={() => navigate('/auth/login')}
              >
                Go to Sign In
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => navigate('/')}
              >
                Back to Home
              </Button>
            </div>
          </div>
        )}

        {(status === 'idle' || status === 'loading') && (
          <div className="space-y-4 text-center py-4">
            <p className="text-sm text-text-secondary">
              Verifying your email token with FoodBridge servers...
            </p>
            <Button
              variant="primary"
              className="w-full"
              loading={status === 'loading'}
              onClick={verify}
            >
              Verify Email Address
            </Button>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
