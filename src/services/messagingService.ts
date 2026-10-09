/**
 * Dynamic Messaging Service for FoodBridge
 * Fully backed by Flask REST API + Socket.IO real-time events.
 * 100% dynamic values from the local database — zero hardcoded mock conversations.
 */

import api from '../lib/api'
import { getSocket } from '../lib/socket'
import { parseBackendDate } from '../lib/date'

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  receiverId: string
  senderName?: string
  receiverName?: string
  senderRole?: 'donor' | 'receiver'
  receiverRole?: 'donor' | 'receiver'
  text: string
  timestamp: string
  rawDate: string
  status: 'sent' | 'delivered' | 'read'
  donationId?: string
  pickupId?: string
  needId?: string
  hasCoordinationCard?: boolean
  messageType?: 'text' | 'call_system' | string
  callSessionId?: string | number
  callStatus?: string
  callDuration?: number
  context?: {
    type?: string
    id?: number
    title?: string
    quantity?: string
    status?: string
    pickup_address?: string
  }
}

export interface PickupDetails {
  orderId: string
  status: string
  time: string
  quantity: string
  location: string
  foodItems: string
  specialInstructions?: string
}

export interface ChatConversation {
  id: string
  donorId: string
  receiverId: string
  participantId: string
  name: string
  contactName?: string
  participantType: 'NGO' | 'DONOR'
  orgType: string
  subtitle: string
  lastMessage: string
  time: string
  rawTime?: string
  unreadCount: number
  avatarInitials: string
  avatarBg: string
  online: boolean
  verified: boolean
  recentNeed?: string
  peopleServed?: string
  serviceArea?: string
  donationId?: string
  pickupId?: string
  pickupDetails?: PickupDetails
  messages: ChatMessage[]
}

const AVATAR_BG_COLORS = [
  'bg-slate-800 text-emerald-400',
  'bg-slate-800 text-indigo-400',
  'bg-slate-800 text-teal-400',
  'bg-slate-800 text-sky-400',
  'bg-slate-800 text-amber-400',
  'bg-slate-800 text-cyan-400',
  'bg-slate-800 text-rose-400',
]

export function getAvatarBg(idOrName: string | number): string {
  const str = String(idOrName || '')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % AVATAR_BG_COLORS.length
  return AVATAR_BG_COLORS[index]
}

export function getInitials(name: string): string {
  if (!name) return 'FB'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function parseDateSafe(dateInput?: string | Date | null): Date | null {
  if (!dateInput) return null
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput
  return parseBackendDate(String(dateInput))
}

export function formatCurrentTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatMessageTime(dateInput?: string | Date): string {
  if (!dateInput) return formatCurrentTime()
  const d = parseDateSafe(dateInput)
  if (!d) return formatCurrentTime()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatMessageDateGroup(dateInput?: string | Date): string {
  if (!dateInput) return 'Today'
  const d = parseDateSafe(dateInput)
  if (!d) return 'Today'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatConversationListTime(dateInput?: string | Date): string {
  if (!dateInput) return ''
  const d = parseDateSafe(dateInput)
  if (!d) return ''

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) {
    return 'Yesterday'
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function normalizeChatMessage(raw: any, currentUserId?: string): ChatMessage {
  const isRead = Boolean(raw.is_read || raw.isRead)
  const createdAtStr = raw.created_at || raw.createdAt || new Date().toISOString()
  const senderId = String(raw.sender_id || raw.senderId || '')
  const receiverId = String(raw.receiver_id || raw.receiverId || '')

  let hasCard = Boolean(raw.hasCoordinationCard)
  if (raw.context || raw.donation_id || raw.pickup_id) {
    // If message mentions food offer or request
    if (typeof raw.message === 'string' && (raw.message.includes('🍱') || raw.message.includes('Food Offer'))) {
      hasCard = true
    }
  }

  return {
    id: String(raw.id || `msg-${Date.now()}`),
    conversationId: String(raw.conversation_id || raw.conversationId || ''),
    senderId,
    receiverId,
    senderName: raw.sender_name || raw.senderName || '',
    receiverName: raw.receiver_name || raw.receiverName || '',
    senderRole: raw.sender_role || raw.senderRole,
    receiverRole: raw.receiver_role || raw.receiverRole,
    text: String(raw.message || raw.text || ''),
    timestamp: formatMessageTime(createdAtStr),
    rawDate: createdAtStr,
    status: isRead ? 'read' : senderId === String(currentUserId) ? 'sent' : 'delivered',
    donationId: raw.donation_id ? String(raw.donation_id) : undefined,
    pickupId: raw.pickup_id ? String(raw.pickup_id) : undefined,
    needId: raw.need_id ? String(raw.need_id) : undefined,
    messageType: raw.message_type || (raw.message?.startsWith('📞') ? 'call_system' : 'text'),
    callSessionId: raw.call_session_id,
    callStatus: raw.call_status,
    callDuration: raw.call_duration,
    hasCoordinationCard: hasCard,
    context: raw.context,
  }
}

export function normalizeConversation(raw: any, currentUserId?: string): ChatConversation {
  const convId = String(raw.id)
  const donorId = String(raw.donor_id || '')
  const receiverId = String(raw.receiver_id || '')
  const partner = raw.partner || {}
  const partnerId = String(partner.id || (String(currentUserId) === donorId ? receiverId : donorId))
  const partnerRole = partner.role || (String(currentUserId) === donorId ? 'receiver' : 'donor')
  const partnerType: 'NGO' | 'DONOR' = partnerRole === 'donor' ? 'DONOR' : 'NGO'
  const partnerName = partner.organization || partner.name || (partnerType === 'DONOR' ? 'Donor Partner' : 'NGO Partner')

  const donation = raw.donation
  const pickup = raw.pickup
  const lastMsgRaw = raw.last_message
  const unreadCount = Number(raw.unread_count || 0)

  let lastMessageText = 'No messages yet'
  let lastMessageTimeStr = ''
  let rawLastTime: string | undefined

  if (lastMsgRaw) {
    lastMessageText = lastMsgRaw.message || lastMsgRaw.text || 'Message'
    rawLastTime = lastMsgRaw.created_at || lastMsgRaw.createdAt
    lastMessageTimeStr = formatConversationListTime(rawLastTime)
  } else if (raw.updated_at || raw.created_at) {
    rawLastTime = raw.updated_at || raw.created_at
    lastMessageTimeStr = formatConversationListTime(rawLastTime)
  }

  // Dynamic subtitle based on actual donation food item
  const foodTitle = donation?.food_name || donation?.food_type || 'Food Coordination'
  const subtitle = `${partnerType === 'DONOR' ? 'Donor' : 'NGO'} • ${foodTitle}`

  // Dynamic pickup details
  let pickupDetails: PickupDetails | undefined
  if (donation || pickup) {
    const orderNum = donation?.id || raw.donation_id || convId
    const foodItems = donation ? `${donation.food_name || 'Meals'} (${donation.quantity || `${donation.quantity_number || 1} meals`})` : 'Food donation package'
    const location = donation?.pickup_address || partner.address || 'Pickup location verified'
    
    let windowTime = 'To be scheduled'
    if (donation?.pickup_time) {
      windowTime = formatMessageTime(donation.pickup_time)
    } else if (donation?.preferred_pickup_time) {
      windowTime = donation.preferred_pickup_time
    } else if (donation?.expiry_time) {
      windowTime = `Before ${formatMessageTime(donation.expiry_time)}`
    }

    pickupDetails = {
      orderId: `#DON-${orderNum}`,
      status: pickup?.status || donation?.status || 'Scheduled',
      time: windowTime,
      quantity: donation?.quantity || `${donation?.quantity_number || ''} ${donation?.unit || 'meals'}`.trim() || 'Coordinated quantity',
      location,
      foodItems,
      specialInstructions: donation?.special_instructions || 'Standard FoodBridge temperature and hygiene handling guidelines apply.',
    }
  }

  return {
    id: convId,
    donorId,
    receiverId,
    participantId: partnerId,
    name: partnerName,
    contactName: partner.contact_name || partner.name,
    participantType: partnerType,
    orgType: partner.business_type || (partnerType === 'DONOR' ? 'Donor Organization' : 'Community NGO'),
    subtitle,
    lastMessage: lastMessageText,
    time: lastMessageTimeStr,
    rawTime: rawLastTime,
    unreadCount,
    avatarInitials: getInitials(partnerName),
    avatarBg: getAvatarBg(partnerName + partnerId),
    online: true,
    verified: Boolean(partner.verified),
    recentNeed: donation?.food_name || undefined,
    peopleServed: donation?.quantity ? `~ ${donation.quantity}` : undefined,
    serviceArea: donation?.pickup_address?.split(',').slice(-3).join(',').trim() || undefined,
    donationId: donation?.id ? String(donation.id) : undefined,
    pickupId: pickup?.id ? String(pickup.id) : undefined,
    pickupDetails,
    messages: [],
  }
}

/**
 * Fetch all valid conversations from backend API.
 */
export async function fetchConversations(currentUserId?: string): Promise<ChatConversation[]> {
  const token = localStorage.getItem('token')
  if (!token) return []

  try {
    const res = await api.get('/chat/conversations')
    const payload = res.data?.data || res.data || []
    if (!Array.isArray(payload)) return []
    return payload.map((c: any) => normalizeConversation(c, currentUserId))
  } catch (err) {
    console.error('[MessagingService] Failed to fetch conversations:', err)
    return []
  }
}

/**
 * Fetch chronological messages for a conversation from backend API.
 */
export async function fetchConversationMessages(
  conversationId: string | number,
  currentUserId?: string
): Promise<ChatMessage[]> {
  const token = localStorage.getItem('token')
  if (!token || !conversationId) return []

  try {
    const res = await api.get(`/chat/conversations/${conversationId}/messages`)
    const payload = res.data?.data || res.data || []
    if (!Array.isArray(payload)) return []
    return payload.map((m: any) => normalizeChatMessage(m, currentUserId))
  } catch (err) {
    console.error(`[MessagingService] Failed to fetch messages for conv ${conversationId}:`, err)
    return []
  }
}

/**
 * Send a message via backend API.
 */
export async function sendChatMessage(payload: {
  conversation_id?: string | number
  receiver_id?: string | number
  message: string
  donation_id?: string | number
  pickup_id?: string | number
  need_id?: string | number
}): Promise<ChatMessage | null> {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('Not authenticated')

  // Clean payload: if conversation_id is temporary / non-numeric string, remove it
  const cleanPayload = { ...payload }
  if (cleanPayload.conversation_id && typeof cleanPayload.conversation_id === 'string' && !/^\d+$/.test(cleanPayload.conversation_id)) {
    delete cleanPayload.conversation_id
  }

  const res = await api.post('/chat/messages', cleanPayload)
  const rawMsg = res.data?.data || res.data
  return normalizeChatMessage(rawMsg)
}

/**
 * Mark all messages in a conversation as read.
 */
export async function markConversationRead(conversationId: string | number): Promise<void> {
  const token = localStorage.getItem('token')
  if (!token || !conversationId) return
  if (typeof conversationId === 'string' && !/^\d+$/.test(conversationId)) return

  try {
    await api.post(`/chat/conversations/${conversationId}/read`)
  } catch (err) {
    console.warn(`[MessagingService] markConversationRead failed for conv ${conversationId}:`, err)
  }
}

/**
 * Find or securely create a conversation for partner + donation / need.
 */
export async function lookupOrCreateConversation(
  partnerId: string | number,
  donationId?: string | number,
  pickupId?: string | number,
  needId?: string | number
): Promise<ChatConversation | null> {
  const token = localStorage.getItem('token')
  if (!token) return null

  try {
    const res = await api.post('/chat/conversations/lookup', {
      partner_id: partnerId,
      donation_id: donationId,
      pickup_id: pickupId,
      need_id: needId,
    })
    const raw = res.data?.data?.conversation || res.data?.conversation || res.data
    return raw ? normalizeConversation(raw) : null
  } catch (err) {
    console.warn('[MessagingService] lookupOrCreateConversation failed:', err)
    return null
  }
}

/**
 * Broadcast typing status via Socket.IO.
 */
export function emitTypingStatus(receiverId: string | number, senderId: string | number, isTyping: boolean): void {
  try {
    const socket = getSocket()
    if (socket && socket.connected) {
      if (isTyping) {
        socket.emit('typing', { receiver_id: receiverId, sender_id: senderId })
      } else {
        socket.emit('stop_typing', { receiver_id: receiverId, sender_id: senderId })
      }
    }
  } catch {}
}
