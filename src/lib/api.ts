/**
 * Central Axios instance for all Flask REST API calls.
 * Automatically attaches the JWT token from localStorage
 * and handles 401 (expired token) globally.
 */
import axios from 'axios'

const DEFAULT_API_URL = import.meta.env?.DEV
  ? ''
  : 'https://foodbridge-api-9tjt.onrender.com'

export const BASE_URL = ((import.meta.env?.VITE_API_URL as string) || DEFAULT_API_URL).replace(/\/+$/, '')

const api = axios.create({
  baseURL: BASE_URL ? `${BASE_URL}/api` : '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (config.data instanceof FormData && config.headers) {
    delete (config.headers as Record<string, unknown>)['Content-Type']
    delete (config.headers as Record<string, unknown>)['content-type']
  }
  return config
})

function getLoginPathForStoredRole(): string {
  const rawUser = localStorage.getItem('user')
  if (!rawUser) return '/auth/login/donor'

  try {
    const parsed = JSON.parse(rawUser) as { role?: string }
    if (parsed.role === 'receiver') return '/auth/login/receiver'
    return '/auth/login/donor'
  } catch {
    return '/auth/login/donor'
  }
}

api.interceptors.response.use(
  (res) => {
    const payload = res.data
    if (
      payload &&
      typeof payload === 'object' &&
      'success' in payload &&
      (payload as { success?: boolean }).success !== false &&
      'data' in payload
    ) {
      res.data = (payload as { data: unknown }).data
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      // Token expired or invalid. Clear storage and send users back to their portal.
      const redirectPath = getLoginPathForStoredRole()
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (!window.location.pathname.startsWith('/auth')) {
        window.location.href = redirectPath
      }
    }
    return Promise.reject(err)
  },
)

export default api
