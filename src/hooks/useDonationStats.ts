import { useCallback, useEffect, useState } from 'react'
import api, { BASE_URL } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useRealtimeSync } from './useRealtimeSync'

function normalizeDonationImageUrl(image?: string | null) {
  if (!image) return 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&h=300&fit=crop'
  if (image.startsWith('http://') || image.startsWith('https://')) return image
  const path = image.startsWith('/') ? image : `/${image}`
  if (path.startsWith('/api/')) return `${BASE_URL}${path}`
  if (path.startsWith('/uploads/')) return `${BASE_URL}/api/donations${path}`
  return `${BASE_URL}${path}`
}

export function useDonationStats() {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    totalMeals: 0,
    mealsDonatedThisMonth: 0,
    totalKg: 0,
    todayDonations: 0,
    pendingPickups: 0,
    expiringSoon: 0,
    totalDonationEvents: 0,
    foodWastePrevented: 0,
    carbonReduced: 0,
    certificates: 0,
  })
  const [loading, setLoading] = useState(true)

  const fetchStats = useCallback(async () => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    try {
      const res = await api.get('/dashboard/donor')
      const s = res.data.stats || {}
      setStats({
        totalMeals: s.meals_donated ?? 0,
        mealsDonatedThisMonth: s.meals_donated_month ?? 0,
        totalKg: s.food_waste_prevented ?? 0,
        todayDonations: s.todays_donations ?? 0,
        pendingPickups: s.pending_pickups ?? 0,
        expiringSoon: s.expiring_soon ?? 0,
        totalDonationEvents: s.total_donations ?? 0,
        foodWastePrevented: s.food_waste_prevented ?? 0,
        carbonReduced: s.carbon_reduced ?? 0,
        certificates: s.certificates ?? 0,
      })
    } catch (error) {
      console.error('useDonationStats fetch error:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  useRealtimeSync([
    'new_donation',
    'pickup_requested',
    'pickup_approved',
    'pickup_rejected',
    'pickup_completed',
    'qr_generated',
    'qr_verified',
    'dashboard_updated',
  ], fetchStats, Boolean(user?.id))

  return { stats, loading, refetch: fetchStats }
}

export function useDonorDonations() {
  const { user } = useAuth()
  const [donations, setDonations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDonations = useCallback(async () => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    try {
      const res = await api.get('/donations', { params: { donor_id: user.id } })
      const parseUtc = (d: string | null) => d ? new Date(d.endsWith('Z') ? d : `${d}Z`) : null;
      const items = (res.data.donations ?? []).map((d: any) => ({
        ...d,
        id: String(d.id),
        createdAt: d.created_at ? parseUtc(d.created_at) : new Date(),
        food: d.food_name || 'Food',
        category: d.food_type || 'Meal',
        meals: d.unit === 'kg' ? Math.round((d.quantity_number || 0) * 2) : Number(d.quantity_number || d.quantity || 0),
        total_quantity: d.total_quantity !== undefined ? Number(d.total_quantity) : Number(d.quantity_number ?? 0),
        allocated_quantity: d.allocated_quantity !== undefined ? Number(d.allocated_quantity) : 0,
        remaining_quantity: d.remaining_quantity !== undefined ? Number(d.remaining_quantity) : Number(d.quantity_number ?? 0),
        pickup_requests: d.pickup_requests || [],
        receiver: d.receiver_name || 'Unassigned',
        pickupTime: d.pickup_time ? parseUtc(d.pickup_time)!.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
        expiryTime: d.expiry_time ? parseUtc(d.expiry_time)!.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
        image: normalizeDonationImageUrl(d.food_image || d.image),
        pickupAddress: d.pickup_address,
        status: d.status || 'Available',
      }))
      setDonations(items)
    } catch (error) {
      console.error('useDonorDonations fetch error:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void fetchDonations()
  }, [fetchDonations])

  useRealtimeSync([
    'new_donation',
    'pickup_requested',
    'pickup_approved',
    'pickup_rejected',
    'pickup_completed',
    'qr_verified',
    'dashboard_updated',
  ], fetchDonations, Boolean(user?.id))

  return { donations, loading, refetch: fetchDonations }
}

export function useDonorPickups() {
  const { user } = useAuth()
  const [pickups, setPickups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPickups = useCallback(async () => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    try {
      const res = await api.get('/pickup-requests')
      const parseUtc = (d: string | null) => d ? new Date(d.endsWith('Z') ? d : `${d}Z`) : null;
      const items = (res.data.pickup_requests ?? []).map((pr: any) => ({
        id: String(pr.id),
        donationId: String(pr.donation_id),
        receiverId: pr.receiver_id != null ? Number(pr.receiver_id) : (pr.receiverId != null ? Number(pr.receiverId) : undefined),
        receiver_id: pr.receiver_id != null ? Number(pr.receiver_id) : (pr.receiverId != null ? Number(pr.receiverId) : undefined),
        donorId: pr.donor_id != null ? Number(pr.donor_id) : (pr.donation?.donor_id != null ? Number(pr.donation.donor_id) : undefined),
        donor_id: pr.donor_id != null ? Number(pr.donor_id) : (pr.donation?.donor_id != null ? Number(pr.donation.donor_id) : undefined),
        receiverName: pr.receiver_name || 'Unknown',
        receiverOrganization: pr.receiver_organization || 'Unknown',
        requestMessage: pr.request_message || '',
        food: pr.food_name || pr.donation?.food_name || 'Food',
        quantity: pr.quantity || pr.donation?.quantity || '—',
        requested_quantity: pr.requested_quantity !== undefined ? pr.requested_quantity : null,
        allocated_quantity: pr.allocated_quantity !== undefined ? pr.allocated_quantity : null,
        requestedAtDate: parseUtc(pr.requested_at),
        completedAtDate: parseUtc(pr.completed_at),
        requestedAt: pr.requested_at ? parseUtc(pr.requested_at)!.toLocaleString('en-IN') : '—',
        status: pr.status || 'Pending',
        pickupAddress: pr.pickup_address || pr.donation?.pickup_address || '—',
        pickupTime: pr.pickup_time ? parseUtc(pr.pickup_time)!.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
        qr_status: pr.qr_status || pr.donation?.qr_status || '',
      }))
      setPickups(items)
    } catch (error) {
      console.error('useDonorPickups fetch error:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void fetchPickups()
  }, [fetchPickups])

  useRealtimeSync([
    'pickup_requested',
    'pickup_approved',
    'pickup_rejected',
    'pickup_completed',
    'qr_generated',
    'qr_verified',
    'dashboard_updated',
  ], fetchPickups, Boolean(user?.id))

  return { pickups, loading, refetch: fetchPickups }
}
