import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Loader2,
  MapPinned,
  Navigation,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  MessageSquare,
  UserCheck,
} from 'lucide-react'
import { ReceiverShell } from '../../components/receiver/ReceiverShell'
import { Input, Select } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import api from '../../lib/api'
import { createPickupRequest } from '../../services/pickupRequestService'
import { useRealtimeSync } from '../../hooks/useRealtimeSync'
import { PublicProfileModal } from '../../components/profile/PublicProfileModal'
import { ClaimQuantityModal } from '../../components/receiver/ClaimQuantityModal'
import {
  OpenStreetMapView,
  createDonationMarkerIcon,
  type MapMarker,
  type RouteLine,
} from '../../components/maps/OpenStreetMapView'

type LocationStatus = 'loading' | 'ready' | 'denied' | 'manual'
type DonationMode = 'driving'
type VegFilter = 'all' | 'veg' | 'nonveg' | 'vegan'

type NearbyDonation = {
  id: string
  food_name: string
  food_type: string
  category?: string | null
  veg_type?: string | null
  quantity: string
  quantity_number?: number | null
  total_quantity?: number | null
  remaining_quantity?: number | null
  allocated_quantity?: number | null
  unit?: string | null
  donor_id?: number | null
  donorId?: number | null
  donor_name?: string | null
  donor_organization?: string | null
  pickup_address?: string | null
  latitude?: number | null
  longitude?: number | null
  expiry_time?: string | null
  pickup_time?: string | null
  image?: string | null
  road_distance_km?: number
  estimated_travel_minutes?: number
  status?: string
}

type RoutePreview = {
  distance_km: number
  distance_m: number
  travel_minutes: number
  geometry?: {
    type: 'LineString'
    coordinates: [number, number][]
  } | null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiry(value?: string | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDistance(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  return value >= 10 ? `${value.toFixed(1)} km` : `${value.toFixed(2)} km`
}

function donationTone(donation: NearbyDonation): 'emerald' | 'amber' | 'rose' | 'blue' {
  const vegType = (donation.veg_type || '').toLowerCase()
  const category = (donation.category || '').toLowerCase()
  if (vegType === 'veg') return 'emerald'
  if (vegType === 'vegan') return 'blue'
  if (vegType === 'nonveg') return 'rose'
  if (category.includes('dessert') || category.includes('fruit')) return 'amber'
  return 'amber'
}

function donationLabel(donation: NearbyDonation) {
  const source = donation.veg_type || donation.category || donation.food_type || donation.food_name
  return source.slice(0, 2)
}

function buildPopupHtml(donation: NearbyDonation) {
  const name = escapeHtml(donation.food_name || 'Food donation')
  const quantity = escapeHtml(donation.quantity || '-')
  const donor = escapeHtml(donation.donor_organization || donation.donor_name || 'Unknown donor')
  const expiry = escapeHtml(formatExpiry(donation.expiry_time))
  const address = escapeHtml(donation.pickup_address || 'Pickup address unavailable')
  const distance = escapeHtml(formatDistance(donation.road_distance_km))
  const eta = escapeHtml(
    donation.estimated_travel_minutes ? `${donation.estimated_travel_minutes} min` : '-',
  )

  return `
    <div class="space-y-1">
      <div class="text-sm font-semibold text-slate-900">${name}</div>
      <div class="text-xs text-slate-600">${donor}</div>
      <div class="text-xs text-slate-700">Qty: ${quantity}</div>
      <div class="text-xs text-slate-700">Expiry: ${expiry}</div>
      <div class="text-xs text-slate-700">Road distance: ${distance}</div>
      <div class="text-xs text-slate-700">Travel time: ${eta}</div>
      <div class="text-xs text-slate-700">Pickup: ${address}</div>
    </div>
  `
}

export default function ReceiverDonationsPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [locationStatus, setLocationStatus] = useState<LocationStatus>('ready')
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>({ lat: 13.0827, lng: 80.2707 })
  const [searchAddress, setSearchAddress] = useState('')
  const [searchText, setSearchText] = useState('')
  const [vegFilter, setVegFilter] = useState<VegFilter>('all')
  const [radiusKm, setRadiusKm] = useState('15')
  const [mode] = useState<DonationMode>('driving')
  const [donations, setDonations] = useState<NearbyDonation[]>([])
  const [loadingDonations, setLoadingDonations] = useState(true)
  const [selectedDonationId, setSelectedDonationId] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())

  // Two-way modals
  const [selectedDonorId, setSelectedDonorId] = useState<number | null>(null)
  const [claimModalDonation, setClaimModalDonation] = useState<any | null>(null)

  const selectedDonation = useMemo(
    () => donations.find((donation) => donation.id === selectedDonationId) || null,
    [donations, selectedDonationId],
  )

  const fetchNearbyDonations = async (location: { lat: number; lng: number }) => {
    setLoadingDonations(true)
    try {
      const res = await api.get('/donations/nearby', {
        params: {
          lat: location.lat,
          lng: location.lng,
          radius_km: Number(radiusKm),
          mode,
        },
      })
      const items = (res.data.donations ?? []) as NearbyDonation[]
      setDonations(items)
      setSelectedDonationId((current) => {
        if (!current) return items[0]?.id ?? null
        return items.some((item) => item.id === current) ? current : items[0]?.id ?? null
      })
    } catch (error: any) {
      console.error('Failed to load nearby donations', error)
      toast(error?.response?.data?.message || 'Could not load nearby donations', 'error')
      setDonations([])
    } finally {
      setLoadingDonations(false)
    }
  }

  const loadRoutePreview = async (donation: NearbyDonation) => {
    if (!origin || !donation.latitude || !donation.longitude) {
      setRoute(null)
      return
    }

    setRouteLoading(true)
    try {
      const res = await api.get('/donations/route', {
        params: {
          origin_lat: origin.lat,
          origin_lng: origin.lng,
          dest_lat: donation.latitude,
          dest_lng: donation.longitude,
          mode,
        },
      })
      const preview = res.data.route as RoutePreview | undefined
      setRoute(preview || null)
    } catch (error) {
      console.error('Failed to load route preview', error)
      setRoute(null)
    } finally {
      setRouteLoading(false)
    }
  }

  const selectDonation = (donation: NearbyDonation) => {
    setSelectedDonationId(donation.id)
    void loadRoutePreview(donation)
  }

  const requestPickup = async (donationId: string) => {
    const donation = donations.find((item) => item.id === donationId)
    if (!donation) return
    if (!user) {
      toast('Please sign in to request a pickup.', 'warning')
      return
    }

    setRequestingId(donationId)
    try {
      await createPickupRequest({
        donationId,
        requestMessage: `Pickup request for ${donation.food_name}`,
      })
      setRequestedIds((prev) => new Set(prev).add(donationId))
      toast(`Pickup request sent for ${donation.food_name}.`, 'success')
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to send pickup request'
      toast(message, 'error')
    } finally {
      setRequestingId(null)
    }
  }

  const resolveBrowserLocation = async () => {
    if (!navigator.geolocation) {
      setLocationStatus('denied')
      setOrigin({ lat: 13.0827, lng: 80.2707 })
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        setOrigin(next)
        setLocationStatus('ready')
      },
      () => {
        setLocationStatus('denied')
        setOrigin({ lat: 13.0827, lng: 80.2707 })
      },
      { enableHighAccuracy: true, timeout: 6_000 },
    )
  }

  const searchManualAddress = async () => {
    if (!searchAddress.trim()) {
      toast('Enter an address to search.', 'warning')
      return
    }

    try {
      const res = await api.post('/donations/geocode', { address: searchAddress.trim() })
      const next = {
        lat: res.data.latitude as number,
        lng: res.data.longitude as number,
      }
      setOrigin(next)
      setLocationStatus('manual')
    } catch (error: any) {
      toast(error?.response?.data?.message || 'Could not find that address', 'error')
    }
  }

  useEffect(() => {
    void resolveBrowserLocation()
  }, [])

  useEffect(() => {
    if (!origin) return
    void fetchNearbyDonations(origin)
  }, [origin, radiusKm, mode])

  useEffect(() => {
    if (selectedDonation) {
      void loadRoutePreview(selectedDonation)
    } else {
      setRoute(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDonationId])

  useRealtimeSync(['new_donation', 'donation_updated'], () => {
    if (origin) {
      void fetchNearbyDonations(origin)
    }
  }, Boolean(origin))

  const filteredDonations = useMemo(() => {
    return donations.filter((donation) => {
      if (requestedIds.has(donation.id)) return false
      if (vegFilter !== 'all' && (donation.veg_type || '').toLowerCase() !== vegFilter) return false
      if (searchText.trim()) {
        const haystack = [
          donation.food_name,
          donation.food_type,
          donation.category || '',
          donation.donor_organization || '',
          donation.donor_name || '',
          donation.pickup_address || '',
        ].join(' ').toLowerCase()
        if (!haystack.includes(searchText.trim().toLowerCase())) return false
      }
      return true
    })
  }, [donations, requestedIds, searchText, vegFilter])

  const markerData = useMemo<MapMarker[]>(() => {
    return filteredDonations
      .filter((donation) => donation.latitude && donation.longitude)
      .map((donation) => ({
        id: donation.id,
        lat: Number(donation.latitude),
        lng: Number(donation.longitude),
        popup: buildPopupHtml(donation),
        popupActionLabel: 'Request Pickup',
        onPopupAction: requestPickup,
        onClick: (donationId) => {
          const item = filteredDonations.find((candidate) => candidate.id === donationId)
          if (item) selectDonation(item)
        },
        icon: createDonationMarkerIcon({
          tone: donationTone(donation),
          label: donationLabel(donation),
        }),
      }))
  }, [filteredDonations])

  const routeLines = useMemo<RouteLine[]>(() => {
    if (!route?.geometry?.coordinates?.length) return []
    return [
      {
        id: 'selected-route',
        positions: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        color: '#2563eb',
        weight: 5,
      },
    ]
  }, [route])

  return (
    <ReceiverShell>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Nearby donation map
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Browse live donations on the map</h1>
          <p className="max-w-2xl text-text-secondary">
            Donations are sorted by real road distance and travel time using OSRM, with route previews and clustered map pins.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Location</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
              <MapPinned className="h-4 w-4 text-primary" />
              {locationStatus === 'ready' ? 'Browser geolocation' : locationStatus === 'manual' ? 'Manual address search' : 'Location needed'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Radius</p>
            <p className="mt-1 text-sm font-semibold">{radiusKm} km</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Mode</p>
            <p className="mt-1 text-sm font-semibold capitalize">{mode}</p>
          </div>
        </div>
      </div>

      {locationStatus === 'denied' && (
        <div className="glass-card mb-6 border-amber-200/70 bg-amber-50/70 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Location access was denied</p>
              <p className="text-sm text-amber-800/80 dark:text-amber-100/75">
                Search an address manually to load nearby donations and route previews.
              </p>
            </div>
            <div className="flex flex-1 gap-3">
              <Input
                icon={Search}
                placeholder="Search your address or landmark"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
              />
              <Button variant="secondary" onClick={searchManualAddress}>
                Search
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card mb-6 p-4 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <Input
              icon={Search}
              placeholder="Search by food, donor, category, or address"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:w-[420px]">
            <Select
              label="Veg Type"
              value={vegFilter}
              onChange={(e) => setVegFilter(e.target.value as VegFilter)}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'veg', label: 'Vegetarian' },
                { value: 'nonveg', label: 'Non-Veg' },
                { value: 'vegan', label: 'Vegan' },
              ]}
            />
            <Select
              label="Radius"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              options={[
                { value: '10', label: '10 km' },
                { value: '15', label: '15 km' },
                { value: '25', label: '25 km' },
                { value: '50', label: '50 km' },
              ]}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" icon={RefreshCw} onClick={() => origin && void fetchNearbyDonations(origin)}>
              Refresh
            </Button>
            <Button variant="secondary" icon={Navigation} onClick={() => void resolveBrowserLocation()}>
              Recheck location
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.95fr]">
        <div className="space-y-4">
          <div className="glass-card p-3">
            {origin ? (
              <OpenStreetMapView
                center={[origin.lat, origin.lng]}
                zoom={13}
                height={620}
                markers={markerData}
                routes={routeLines}
                autoFitRoutes={Boolean(routeLines.length)}
                clusterMarkers
              />
            ) : (
              <div className="flex h-[620px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/70 p-8 text-center text-text-secondary dark:border-gray-800 dark:bg-gray-950/60">
                <div className="max-w-md space-y-3">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  <p className="text-lg font-semibold text-text dark:text-white">Finding your location</p>
                  <p>
                    We are waiting for browser geolocation. If you block access, use the manual address search above.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="stat-card">
              <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Visible pins</p>
              <p className="stat-value mt-2">{loadingDonations ? '-' : filteredDonations.length}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Route</p>
              <p className="stat-value mt-2">
                {routeLoading ? 'Loading' : route ? `${route.distance_km.toFixed(2)} km` : 'Select a pin'}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Travel time</p>
              <p className="stat-value mt-2">
                {routeLoading ? 'Loading' : route ? `${route.travel_minutes} min` : '-'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Nearby donations</h2>
                <p className="text-sm text-text-secondary">
                  Sorted by road distance. Click a card to preview the route.
                </p>
              </div>
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            </div>
          </div>

          <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
            {loadingDonations ? (
              <div className="glass-card flex items-center justify-center gap-3 p-8 text-text-secondary">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Scanning for nearby donations...</span>
              </div>
            ) : filteredDonations.length === 0 ? (
              <div className="glass-card p-8 text-center text-text-secondary">
                <AlertTriangle className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-lg font-semibold text-text dark:text-white">No nearby donations found</p>
                <p className="mt-2">Try widening the radius or searching a different area.</p>
              </div>
            ) : (
              filteredDonations.map((donation) => {
                const isSelected = donation.id === selectedDonationId
                return (
                  <button
                    key={donation.id}
                    type="button"
                    onClick={() => selectDonation(donation)}
                    className={`glass-card block w-full overflow-hidden text-left transition-all ${isSelected ? 'ring-2 ring-primary shadow-elevated' : 'hover:-translate-y-0.5 hover:shadow-elevated'}`}
                  >
                    <div className="p-5">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">
                            {donation.donor_organization || donation.donor_name || 'Nearby donor'}
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-text dark:text-white">{donation.food_name}</h3>
                        </div>
                        <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          {formatDistance(donation.road_distance_km)}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                          <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">
                            {donation.status?.toLowerCase() === 'partially_allocated' ? 'Remaining' : 'Quantity'}
                          </p>
                          <p className="mt-1 font-semibold text-text dark:text-white">
                            {donation.remaining_quantity !== undefined && donation.remaining_quantity !== null
                              ? `${donation.remaining_quantity} ${donation.unit || 'meals'}`
                              : donation.quantity}
                            {donation.status?.toLowerCase() === 'partially_allocated' && donation.total_quantity ? (
                              <span className="text-xs font-normal text-text-secondary block">
                                (Total: {donation.total_quantity} {donation.unit || 'meals'})
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                          <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Travel</p>
                          <p className="mt-1 font-semibold">
                            {donation.estimated_travel_minutes ? `${donation.estimated_travel_minutes} min` : '-'}
                          </p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                          <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Expiry</p>
                          <p className="mt-1 font-semibold">{formatExpiry(donation.expiry_time)}</p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                          <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Pickup</p>
                          <p className="mt-1 font-semibold">{donation.pickup_address || 'Unknown'}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              const donorId = donation.donor_id || (donation as any).donorId
                              if (donorId) {
                                setSelectedDonorId(Number(donorId))
                              } else {
                                toast('Donor profile not found', 'error')
                              }
                            }}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            View Donor
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="px-2.5"
                            onClick={(e) => {
                              e.stopPropagation()
                              const donorId = donation.donor_id || (donation as any).donorId
                              if (donorId) {
                                navigate(`/receiver/messages?partnerId=${donorId}&donationId=${donation.id}`)
                              } else {
                                toast('Donor contact not found', 'error')
                              }
                            }}
                            title="Chat with Donor"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-2">
                          {requestedIds.has(donation.id) ? (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              Requested
                            </span>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              className="shadow-glow"
                              onClick={(event) => {
                                event.stopPropagation()
                                setClaimModalDonation(donation)
                              }}
                            >
                              Request Food
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {selectedDonation && (
            <div className="glass-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Selected donation</p>
                  <h3 className="mt-1 text-xl font-bold">{selectedDonation.food_name}</h3>
                </div>
                <button
                  type="button"
                  className="rounded-full p-2 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text dark:hover:bg-gray-800"
                  onClick={() => {
                    setSelectedDonationId(null)
                    setRoute(null)
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Road distance</p>
                  <p className="mt-1 font-semibold">{formatDistance(selectedDonation.road_distance_km)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Travel time</p>
                  <p className="mt-1 font-semibold">
                    {selectedDonation.estimated_travel_minutes ? `${selectedDonation.estimated_travel_minutes} min` : '-'}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Pickup window</p>
                  <p className="mt-1 font-semibold">{formatExpiry(selectedDonation.pickup_time)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">Status</p>
                  <p className="mt-1 font-semibold capitalize">{selectedDonation.status || 'Available'}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="primary"
                  className="flex-1"
                  loading={requestingId === selectedDonation.id}
                  onClick={() => void requestPickup(selectedDonation.id)}
                >
                  Request Pickup
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  icon={Navigation}
                  onClick={() => {
                    if (!origin || !selectedDonation.latitude || !selectedDonation.longitude) return
                    const routeUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.lat}%2C${origin.lng}%3B${selectedDonation.latitude}%2C${selectedDonation.longitude}`
                    window.open(routeUrl, '_blank', 'noopener,noreferrer')
                  }}
                >
                  Open route
                </Button>
              </div>

              {routeLoading && (
                <p className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading route preview...
                </p>
              )}

              {origin && (
                <p className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                  <Navigation className="h-3.5 w-3.5" />
                  {locationStatus === 'manual'
                    ? 'Manual address lookup is powering the map.'
                    : 'Browser geolocation is powering the map.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-text-secondary">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        <span>Pickups continue through the verified request flow with custom portions.</span>
      </div>

      {/* Public Donor Profile Modal */}
      <PublicProfileModal
        userId={selectedDonorId}
        isOpen={!!selectedDonorId}
        onClose={() => setSelectedDonorId(null)}
      />

      {/* Claim with Quantity Modal */}
      <ClaimQuantityModal
        donation={claimModalDonation}
        isOpen={!!claimModalDonation}
        onClose={() => setClaimModalDonation(null)}
        onSuccess={() => {
          if (origin) void fetchNearbyDonations(origin)
        }}
      />
    </ReceiverShell>
  )
}
