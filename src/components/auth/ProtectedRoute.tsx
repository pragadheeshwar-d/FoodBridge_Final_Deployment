import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth, type UserRole } from '../../context/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
  roles?: UserRole[]
  requireApproved?: boolean
}

export function ProtectedRoute({ children, roles, requireApproved = true }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-secondary">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) {
    const preferredLogin =
      roles?.includes('admin') || roles?.includes('super_admin')
        ? '/admin/login'
        : roles?.includes('receiver') && !roles?.includes('donor')
          ? '/auth/login/receiver'
          : '/auth/login/donor'

    return <Navigate to={`${preferredLogin}?redirect=${encodeURIComponent(location.pathname)}`} replace />
  }

  // Admins always bypass organization approval check
  if (user.role === 'admin' || user.role === 'super_admin') {
    if (roles?.length && !roles.includes(user.role)) {
      return <Navigate to="/admin" replace />
    }
    return <>{children}</>
  }

  // Non-admin roles check
  if (roles?.length && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  if (requireApproved) {
    if (!user.verified && (user.role === 'donor' || user.role === 'receiver')) {
      return <Navigate to="/auth/registration-success" replace />
    }
    if (user.status !== 'approved') {
      return <Navigate to="/pending" replace />
    }
  }

  return <>{children}</>
}

