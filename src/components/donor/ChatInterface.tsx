import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Search,
  CheckCheck,
  Phone,
  MoreVertical,
  CheckCircle2,
  Calendar,
  Send,
  Paperclip,
  Smile,
  ArrowLeft,
  ExternalLink,
  ChevronDown,
  Info,
  MessageSquare,
} from 'lucide-react'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useCall } from '../../context/CallContext'
import {
  type ChatMessage,
  type ChatConversation,
  fetchConversations,
  fetchConversationMessages,
  sendChatMessage,
  markConversationRead,
  lookupOrCreateConversation,
  emitTypingStatus,
  formatMessageDateGroup,
  normalizeChatMessage,
  getInitials,
  getAvatarBg,
} from '../../services/messagingService'
import { getSocket } from '../../lib/socket'

export interface ChatInterfaceProps {
  role?: 'donor' | 'receiver'
}

export function ChatInterface({ role: propRole }: ChatInterfaceProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { startCall, callState } = useCall()
  const location = useLocation()

  // Determine current active user role (donor or receiver)
  const currentRole: 'donor' | 'receiver' = useMemo(() => {
    if (propRole) return propRole
    if (user?.role === 'receiver' || location.pathname.startsWith('/receiver')) {
      return 'receiver'
    }
    return 'donor'
  }, [propRole, user?.role, location.pathname])

  const currentUserId = useMemo(() => {
    return user?.id ? String(user.id) : ''
  }, [user?.id])

  // Conversations state loaded directly from the database
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoadingConvs, setIsLoadingConvs] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'All' | 'Unread' | 'Active' | 'Completed'>('All')
  const [messageText, setMessageText] = useState('')
  const [showMobileChat, setShowMobileChat] = useState(false)
  const [showDonationModal, setShowDonationModal] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isPartnerTyping, setIsPartnerTyping] = useState(false)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedIdRef = useRef<string>(selectedId)
  selectedIdRef.current = selectedId

  // Active conversation object
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedId) || null
  }, [conversations, selectedId])

  // 1. Initial Load: Fetch conversations from backend
  const loadConversations = useCallback(async () => {
    if (!currentUserId) return
    try {
      const items = await fetchConversations(currentUserId)
      // Strictly one conversation per partner in the UI
      const seenPartners = new Set<string>()
      const uniqueItems: ChatConversation[] = []
      for (const item of items) {
        if (!seenPartners.has(item.participantId)) {
          seenPartners.add(item.participantId)
          uniqueItems.push(item)
        }
      }

      // Handle query parameters if present (e.g. ?partnerId=... or ?conversationId=...)
      const searchStr = location.search || window.location.search || ''
      const params = new URLSearchParams(searchStr)
      const urlConvId = params.get('conversationId')
      const partnerId = params.get('partnerId')
      const partnerName = params.get('partnerName')
      const partnerOrg = params.get('partnerOrg')
      const donationId = params.get('donationId')
      const pickupId = params.get('pickupId')
      const needId = params.get('needId')

      let matchedConv: ChatConversation | undefined

      if (urlConvId) {
        matchedConv = uniqueItems.find((c) => c.id === urlConvId)
      }
      if (!matchedConv && partnerId) {
        matchedConv = uniqueItems.find(
          (c) =>
            c.participantId === partnerId ||
            (donationId && c.donationId === donationId) ||
            (pickupId && c.pickupId === pickupId)
        )
      }

      // If partnerId specified in URL and not in uniqueItems, immediately lookup or create conversation!
      if (!matchedConv && partnerId) {
        try {
          const created = await lookupOrCreateConversation(
            partnerId,
            donationId || undefined,
            pickupId || undefined,
            needId || undefined
          )

          if (created) {
            uniqueItems.unshift(created)
            matchedConv = created
          } else {
            const stubName = partnerOrg || partnerName || 'Partner'
            const stubConv: ChatConversation = {
              id: `conv-temp-${partnerId}`,
              donorId: currentRole === 'donor' ? currentUserId : partnerId,
              receiverId: currentRole === 'receiver' ? currentUserId : partnerId,
              participantId: partnerId,
              name: stubName,
              contactName: partnerName || stubName,
              participantType: currentRole === 'receiver' ? 'DONOR' : 'NGO',
              orgType: partnerOrg || (currentRole === 'receiver' ? 'Donor Partner' : 'Community NGO'),
              subtitle: `${currentRole === 'receiver' ? 'Donor' : 'NGO'} • Food Coordination`,
              lastMessage: 'No messages yet',
              time: '',
              unreadCount: 0,
              avatarInitials: getInitials(stubName),
              avatarBg: getAvatarBg(stubName + partnerId),
              online: true,
              verified: true,
              donationId: donationId || undefined,
              pickupId: pickupId || undefined,
              messages: [],
            }
            uniqueItems.unshift(stubConv)
            matchedConv = stubConv
          }
        } catch (e) {
          console.warn('lookupOrCreateConversation error:', e)
        }
      }

      setConversations(uniqueItems)

      if (matchedConv) {
        setShowMobileChat(true)
      }

      setSelectedId((prevSelected) => {
        if (matchedConv) return matchedConv.id
        if (prevSelected && uniqueItems.some((c) => c.id === prevSelected)) {
          return prevSelected
        }
        return uniqueItems[0]?.id || ''
      })
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      setIsLoadingConvs(false)
    }
  }, [currentUserId, currentRole])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations, location.search])

  // 2. Fetch messages whenever selected conversation changes
  useEffect(() => {
    if (!selectedId || !currentUserId) {
      setMessages([])
      return
    }

    let isMounted = true
    setIsLoadingMessages(true)

    void fetchConversationMessages(selectedId, currentUserId).then((msgs) => {
      if (!isMounted) return
      setMessages(msgs)
      setIsLoadingMessages(false)

      // Mark conversation as read on backend
      void markConversationRead(selectedId)

      // Reset unread count in local state
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c))
      )
    })

    return () => {
      isMounted = false
    }
  }, [selectedId, currentUserId])

  // 3. Smart Auto-Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, selectedId])

  // 4. Socket.IO Realtime Listeners
  useEffect(() => {
    const socket = getSocket()

    const handleIncomingMessage = (payload: any) => {
      const raw = payload?.data || payload?.message || payload
      if (!raw || !raw.message) return

      const incoming = normalizeChatMessage(raw, currentUserId)
      const currentSelected = selectedIdRef.current

      // If message belongs to active conversation
      const isForActive =
        (raw.conversation_id && String(raw.conversation_id) === String(currentSelected)) ||
        (activeConversation &&
          raw.sender_id === Number(activeConversation.participantId) &&
          raw.receiver_id === Number(currentUserId))

      if (isForActive) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev
          return [...prev, incoming]
        })
        setIsPartnerTyping(false)
        void markConversationRead(currentSelected)
      }

      // Update sidebar conversations
      setConversations((prev) => {
        const matchingIndex = prev.findIndex(
          (c) =>
            (raw.conversation_id && String(c.id) === String(raw.conversation_id)) ||
            c.participantId === String(raw.sender_id)
        )

        if (matchingIndex !== -1) {
          const isSelected = String(prev[matchingIndex].id) === String(currentSelected)
          const updated = [...prev]
          updated[matchingIndex] = {
            ...updated[matchingIndex],
            lastMessage: incoming.text,
            time: 'Just now',
            unreadCount: isSelected || incoming.senderId === currentUserId ? 0 : (updated[matchingIndex].unreadCount || 0) + 1,
          }
          // Move to top of list
          const [conv] = updated.splice(matchingIndex, 1)
          return [conv, ...updated]
        }

        // New conversation received: refresh list from server
        void fetchConversations(currentUserId).then((fresh) => {
          if (fresh.length > 0) {
            const seen = new Set<string>()
            const unique: ChatConversation[] = []
            for (const item of fresh) {
              if (!seen.has(item.participantId)) {
                seen.add(item.participantId)
                unique.push(item)
              }
            }
            setConversations(unique)
          }
        })
        return prev
      })
    }

    const handleMessagesRead = (payload: any) => {
      if (!payload) return
      const targetConvId = String(payload.conversation_id || '')
      const readIds = payload.message_ids ? payload.message_ids.map(String) : []

      if (targetConvId === selectedIdRef.current || readIds.length > 0) {
        setMessages((prev) =>
          prev.map((m) =>
            readIds.includes(m.id) || m.senderId === currentUserId ? { ...m, status: 'read' as const } : m
          )
        )
      }
    }

    const handlePartnerTyping = (payload: any) => {
      const senderId = String(payload?.user_id || payload?.sender_id || '')
      if (senderId && activeConversation && senderId === activeConversation.participantId) {
        setIsPartnerTyping(true)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = setTimeout(() => setIsPartnerTyping(false), 3000)
      }
    }

    const handlePartnerStopTyping = (payload: any) => {
      const senderId = String(payload?.user_id || payload?.sender_id || '')
      if (senderId && activeConversation && senderId === activeConversation.participantId) {
        setIsPartnerTyping(false)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      }
    }

    socket.on('new_message', handleIncomingMessage)
    socket.on('messages_read', handleMessagesRead)
    socket.on('message_read', handleMessagesRead)
    socket.on('user_typing', handlePartnerTyping)
    socket.on('typing_indicator', handlePartnerTyping)
    socket.on('user_stop_typing', handlePartnerStopTyping)

    return () => {
      socket.off('new_message', handleIncomingMessage)
      socket.off('messages_read', handleMessagesRead)
      socket.off('message_read', handleMessagesRead)
      socket.off('user_typing', handlePartnerTyping)
      socket.off('typing_indicator', handlePartnerTyping)
      socket.off('user_stop_typing', handlePartnerStopTyping)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (userTypingTimerRef.current) clearTimeout(userTypingTimerRef.current)
    }
  }, [currentUserId, activeConversation])

  // 5. Automatic Fallback Polling (3s for active messages, 8s for conversation list)
  useEffect(() => {
    if (!selectedId || !currentUserId) return

    const messagesInterval = setInterval(async () => {
      try {
        const freshMsgs = await fetchConversationMessages(selectedId, currentUserId)
        if (freshMsgs.length > 0) {
          setMessages((prev) => {
            if (freshMsgs.length === prev.length && freshMsgs[freshMsgs.length - 1]?.id === prev[prev.length - 1]?.id) {
              return prev
            }
            return freshMsgs
          })
        }
      } catch {}
    }, 3000)

    return () => clearInterval(messagesInterval)
  }, [selectedId, currentUserId])

  useEffect(() => {
    if (!currentUserId) return

    const convsInterval = setInterval(async () => {
      try {
        const freshConvs = await fetchConversations(currentUserId)
        if (freshConvs.length > 0) {
          const currentSelected = selectedIdRef.current
          setConversations(
            freshConvs.map((fc) => {
              if (fc.id === currentSelected) {
                return { ...fc, unreadCount: 0 }
              }
              return fc
            })
          )
        }
      } catch {}
    }, 8000)

    return () => clearInterval(convsInterval)
  }, [currentUserId])

  // 6. Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showDonationModal) {
        setShowDonationModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showDonationModal])

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.serviceArea && c.serviceArea.toLowerCase().includes(searchQuery.toLowerCase()))

      if (!matchesSearch) return false
      if (filter === 'Unread') return (c.unreadCount || 0) > 0
      if (filter === 'Active') return c.online
      if (filter === 'Completed') return c.pickupDetails?.status === 'Completed'
      return true
    })
  }, [conversations, searchQuery, filter])

  // Select conversation
  const handleSelectConversation = useCallback(
    (convId: string) => {
      setSelectedId(convId)
      setShowMobileChat(true)
      setIsPartnerTyping(false)
      void markConversationRead(convId)
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c))
      )
    },
    []
  )

  // Typing emitter
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setMessageText(val)

    if (activeConversation && currentUserId) {
      emitTypingStatus(activeConversation.participantId, currentUserId, val.trim().length > 0)
      if (userTypingTimerRef.current) clearTimeout(userTypingTimerRef.current)
      userTypingTimerRef.current = setTimeout(() => {
        emitTypingStatus(activeConversation.participantId, currentUserId, false)
      }, 2000)
    }
  }

  // Send message
  const handleSendMessage = useCallback(
    async (customText?: string) => {
      const text = customText !== undefined ? customText : messageText
      const trimmed = text.trim()
      if (!trimmed || isSending || !activeConversation || !currentUserId) return

      setIsSending(true)
      emitTypingStatus(activeConversation.participantId, currentUserId, false)

      const tempId = `temp-${Date.now()}`
      const optimisticMsg: ChatMessage = {
        id: tempId,
        conversationId: activeConversation.id,
        senderId: currentUserId,
        receiverId: activeConversation.participantId,
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        rawDate: new Date().toISOString(),
        status: 'sent',
        donationId: activeConversation.donationId,
        pickupId: activeConversation.pickupId,
      }

      // Optimistically append
      setMessages((prev) => [...prev, optimisticMsg])
      if (customText === undefined) {
        setMessageText('')
      }

      // Update sidebar conversation preview
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? { ...c, lastMessage: trimmed, time: 'Just now' }
            : c
        )
      )

      try {
        const savedMsg = await sendChatMessage({
          conversation_id: activeConversation.id,
          receiver_id: activeConversation.participantId,
          message: trimmed,
          donation_id: activeConversation.donationId,
          pickup_id: activeConversation.pickupId,
        })

        if (savedMsg) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? savedMsg : m))
          )
          if (savedMsg.conversationId && activeConversation.id !== savedMsg.conversationId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? { ...c, id: savedMsg.conversationId }
                  : c
              )
            )
            setSelectedId(savedMsg.conversationId)
          }
        }
      } catch (err: any) {
        console.error('Failed to send message:', err)
        toast(err?.response?.data?.message || 'Failed to send message. Please try again.', 'error')
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
      } finally {
        setIsSending(false)
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.focus()
        }
      }
    },
    [messageText, isSending, activeConversation, currentUserId, toast]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSendMessage()
    }
  }

  // Quick Action Buttons using 100% dynamic values
  const handleQuickAction = (actionType: 'pickup_confirmed' | 'food_ready' | 'share_location' | 'send_details') => {
    if (!activeConversation) return

    if (actionType === 'pickup_confirmed') {
      void handleSendMessage('Pickup has been confirmed.')
    } else if (actionType === 'food_ready') {
      void handleSendMessage('The food is ready for pickup.')
    } else if (actionType === 'share_location') {
      const loc = activeConversation.pickupDetails?.location || activeConversation.serviceArea || 'Pickup location confirmed on file'
      void handleSendMessage(`📍 Pickup Location: ${loc}`)
    } else if (actionType === 'send_details') {
      const orderId = activeConversation.pickupDetails?.orderId || `#DON-${activeConversation.donationId || activeConversation.id}`
      const items = activeConversation.pickupDetails?.foodItems || activeConversation.recentNeed || 'Food Donation'
      const time = activeConversation.pickupDetails?.time || 'Scheduled'
      void handleSendMessage(`📄 Donation Details (${orderId}): ${items} • Window: ${time}`)
    }
  }

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 h-[calc(100vh-210px)] min-h-[640px] select-none">
      {/* ========================================================================= */}
      {/* LEFT COLUMN: CONVERSATION INBOX (~30-35% / 4 of 12 cols)                  */}
      {/* ========================================================================= */}
      <div
        className={`lg:col-span-4 rounded-3xl bg-[#0D1624] border border-slate-800 flex flex-col overflow-hidden shadow-2xl ${
          showMobileChat ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {/* Inbox Header */}
        <div className="p-4 border-b border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white tracking-tight">Messages</h2>
            <span className="text-[11px] text-slate-400 font-medium">
              {filteredConversations.length} {filteredConversations.length === 1 ? 'chat' : 'chats'}
            </span>
          </div>

          {/* Search bar & Filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            {/* Filter Dropdown */}
            <div className="relative">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                aria-label="Filter conversations"
                className="appearance-none pl-3 pr-7 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-slate-300 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="All">All</option>
                <option value="Unread">Unread</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-2 space-y-1 scrollbar-thin">
          {isLoadingConvs ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60" />
              <p className="font-semibold text-slate-300">No conversations yet</p>
              <p className="text-[11px] text-slate-500 mt-1">
                {currentRole === 'donor'
                  ? 'Conversations will appear when an NGO requests your donation.'
                  : 'Conversations will appear when you request a food donation.'}
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedId
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full p-3 rounded-2xl text-left transition-all flex items-start gap-3 relative ${
                    isSelected
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-transparent border border-transparent hover:bg-slate-900/60'
                  }`}
                >
                  {/* Avatar with Online indicator */}
                  <div className="relative shrink-0 mt-0.5">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-xs border border-slate-700/60 ${conv.avatarBg}`}
                    >
                      {conv.avatarInitials}
                    </div>
                    {conv.online && (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0D1624] absolute -bottom-0.5 -right-0.5" />
                    )}
                  </div>

                  {/* Conversation Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-white truncate">{conv.name}</span>
                        {conv.verified && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                        {conv.time}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 truncate mb-1">{conv.subtitle}</p>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-300 truncate leading-snug">
                        {conv.lastMessage}
                      </p>
                      {conv.unreadCount > 0 ? (
                        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 animate-pulse">
                          {conv.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RIGHT COLUMN: ACTIVE CONVERSATION (~65-70% / 8 of 12 cols)                 */}
      {/* ========================================================================= */}
      <div
        className={`lg:col-span-8 rounded-3xl bg-[#0D1624] border border-slate-800 flex flex-col overflow-hidden shadow-2xl ${
          !showMobileChat ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {!activeConversation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-2xl mb-4 text-emerald-400">
              💬
            </div>
            <h3 className="text-base font-bold text-white mb-1">No conversation selected</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              {currentRole === 'donor'
                ? 'Select an NGO request from the list or wait for food pickup requests.'
                : 'Select a conversation from the list to coordinate food pickup.'}
            </p>
          </div>
        ) : (
          <>
            {/* Conversation Header */}
            <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Back button for mobile view */}
                <button
                  type="button"
                  onClick={() => setShowMobileChat(false)}
                  className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                {/* Partner Avatar */}
                <div className="relative">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs border border-slate-700/60 ${activeConversation.avatarBg}`}
                  >
                    {activeConversation.avatarInitials}
                  </div>
                  {activeConversation.online && (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0D1624] absolute -bottom-0.5 -right-0.5" />
                  )}
                </div>

                {/* Partner Names & Status */}
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white">{activeConversation.name}</h3>
                    {activeConversation.verified && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{activeConversation.subtitle}</span>
                    <span>•</span>
                    {isPartnerTyping ? (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Typing...
                      </span>
                    ) : activeConversation.online ? (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Online
                      </span>
                    ) : (
                      <span className="text-slate-500 font-medium">Offline</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Header Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeConversation) return
                    void startCall(
                      {
                        id: activeConversation.participantId,
                        name: activeConversation.name,
                        avatar: null,
                        role: activeConversation.participantType === 'DONOR' ? 'donor' : 'receiver',
                      },
                      activeConversation.id
                    )
                  }}
                  disabled={callState !== 'idle'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80 bg-slate-900/70 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors ${
                    callState !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Call</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDonationModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700/80 bg-slate-900/70 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors"
                >
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  <span className="hidden sm:inline">View Details</span>
                </button>

                <button
                  type="button"
                  aria-label="More options"
                  onClick={() =>
                    toast(
                      `Conversation options for ${activeConversation.name}.`,
                      'info'
                    )
                  }
                  className="p-1.5 rounded-xl border border-slate-700/80 bg-slate-900/70 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Context Strip */}
            <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">
                    {currentRole === 'donor' ? '🍱 Food Request:' : '🍲 Food Donation:'}
                  </span>
                  <span className="font-semibold text-slate-200">
                    {activeConversation.recentNeed || 'Food Coordination'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">
                    {currentRole === 'donor' ? '👥 Quantity:' : '📦 Quantity:'}
                  </span>
                  <span className="font-semibold text-slate-200">
                    {activeConversation.peopleServed || activeConversation.pickupDetails?.quantity || 'Meals'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">
                    {currentRole === 'donor' ? '📍 Pickup Address:' : '📍 Location:'}
                  </span>
                  <span className="font-semibold text-slate-200 truncate max-w-[200px]">
                    {activeConversation.serviceArea || activeConversation.pickupDetails?.location || 'Tamil Nadu'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  toast(
                    `Viewing verified profile for ${activeConversation.name}`,
                    'info'
                  )
                }
                className="text-emerald-400 hover:text-emerald-300 font-semibold text-xs inline-flex items-center gap-1 transition-colors ml-auto"
              >
                <span>
                  {activeConversation.participantType === 'DONOR'
                    ? 'View Donor Profile'
                    : 'View NGO Profile'}
                </span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            {/* Chat Messages Area */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin"
            >
              {isLoadingMessages ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading chat history...
                </div>
              ) : messages.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  <p className="font-medium text-slate-400">No messages in this conversation yet.</p>
                  <p className="text-[11px] mt-1 text-slate-500">
                    Start the conversation below to coordinate pickup and distribution.
                  </p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isOutgoing = String(msg.senderId) === String(currentUserId)
                  const showDateGroup =
                    index === 0 ||
                    formatMessageDateGroup(msg.rawDate) !==
                      formatMessageDateGroup(messages[index - 1].rawDate)

                  return (
                    <React.Fragment key={msg.id}>
                      {/* Dynamic Date Separator Header */}
                      {showDateGroup && (
                        <div className="flex items-center justify-center my-2">
                          <span className="px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-medium text-slate-400">
                            {formatMessageDateGroup(msg.rawDate)}
                          </span>
                        </div>
                      )}

                      {msg.messageType === 'call_system' || msg.text?.startsWith('📞') ? (
                        <div className="flex items-center justify-center my-3 w-full">
                          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300 shadow-sm backdrop-blur-sm">
                            <Phone className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-medium">{msg.text}</span>
                            <span className="text-[10px] text-slate-500 ml-1">{msg.timestamp}</span>
                          </div>
                        </div>
                      ) : (
                        <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                          <div
                            className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-3.5 shadow-sm text-xs sm:text-sm leading-relaxed ${
                              isOutgoing
                                ? 'bg-emerald-950/40 border border-emerald-500/30 text-slate-100 rounded-br-sm'
                                : 'bg-[#141E30] border border-slate-700/60 text-slate-100 rounded-bl-sm'
                            }`}
                          >
                            <p className="whitespace-pre-line">{msg.text}</p>

                            <div
                              className={`flex items-center gap-1.5 mt-1.5 text-[10px] ${
                                isOutgoing
                                  ? 'justify-end text-emerald-400/80'
                                  : 'justify-start text-slate-400'
                              }`}
                            >
                              <span>{msg.timestamp}</span>
                              {isOutgoing && <CheckCheck className="w-3 h-3 text-emerald-400" />}
                            </div>
                          </div>

                          {/* Embedded Donation / Pickup Context Card */}
                          {msg.hasCoordinationCard && activeConversation.pickupDetails && (
                            <div className="mt-3 w-full max-w-[85%] sm:max-w-[70%] p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                                  <Calendar className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-white">
                                      📅 {activeConversation.pickupDetails.status}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
                                      {activeConversation.pickupDetails.time}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-300 mt-1">
                                    {activeConversation.pickupDetails.quantity} •{' '}
                                    {activeConversation.pickupDetails.location}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => setShowDonationModal(true)}
                                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all shrink-0 text-center"
                              >
                                View Donation Details
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Action Chips with Dynamic Data */}
            <div className="px-5 pt-2 pb-1 border-t border-slate-800/80 bg-slate-950/20 flex items-center gap-2 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => handleQuickAction('pickup_confirmed')}
                className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 hover:border-emerald-500 hover:text-emerald-300 text-slate-300 text-[11px] font-medium whitespace-nowrap transition-colors"
              >
                👍 Pickup confirmed
              </button>
              <button
                type="button"
                onClick={() => handleQuickAction('food_ready')}
                className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 hover:border-emerald-500 hover:text-emerald-300 text-slate-300 text-[11px] font-medium whitespace-nowrap transition-colors"
              >
                🍽 Food is ready
              </button>
              <button
                type="button"
                onClick={() => handleQuickAction('share_location')}
                className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 hover:border-emerald-500 hover:text-emerald-300 text-slate-300 text-[11px] font-medium whitespace-nowrap transition-colors"
              >
                📍 Share location
              </button>
              <button
                type="button"
                onClick={() => handleQuickAction('send_details')}
                className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 hover:border-emerald-500 hover:text-emerald-300 text-slate-300 text-[11px] font-medium whitespace-nowrap transition-colors"
              >
                📄 Send details
              </button>
            </div>

            {/* Message Composer */}
            <div className="p-4 bg-slate-900/50 border-t border-slate-800">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSendMessage()
                }}
                className="flex items-center gap-2"
              >
                {/* Attachment & Emoji actions */}
                <div className="flex items-center gap-1 text-slate-400">
                  <button
                    type="button"
                    aria-label="Attach file"
                    onClick={() => toast('Attach donation document dialog.', 'info')}
                    className="p-2 rounded-xl hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Add emoji"
                    onClick={() => toast('Emoji picker opened.', 'info')}
                    className="p-2 rounded-xl hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                </div>

                {/* Input box supporting multiline (Shift+Enter) and Enter to send */}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  placeholder="Type a message..."
                  value={messageText}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors resize-none leading-normal overflow-hidden min-h-[42px] max-h-[120px]"
                />

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!messageText.trim() || isSending}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-xs sm:text-sm font-bold shadow-lg transition-all active:scale-95 shrink-0"
                >
                  <span>{isSending ? 'Sending...' : 'Send'}</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* DONATION DETAILS MODAL                                                    */}
      {/* ========================================================================= */}
      {showDonationModal && activeConversation && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDonationModal(false)
            }
          }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-3xl bg-[#0D1624] border border-slate-800 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Calendar className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Donation Coordination Summary
                  </h3>
                  <p className="text-xs text-slate-400">
                    Order ID: {activeConversation.pickupDetails?.orderId || `#DON-${activeConversation.donationId || activeConversation.id}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDonationModal(false)}
                className="text-slate-400 hover:text-white text-sm p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">
                    {activeConversation.participantType === 'DONOR'
                      ? 'Donor Organization:'
                      : 'Coordinating NGO:'}
                  </span>
                  <span className="font-bold text-white">{activeConversation.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pickup Window:</span>
                  <span className="font-bold text-emerald-400">
                    {activeConversation.pickupDetails?.time || 'Scheduled for pickup'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Food Items:</span>
                  <span className="text-slate-200 font-medium">
                    {activeConversation.pickupDetails?.foodItems ||
                      activeConversation.recentNeed ||
                      'Meals'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pickup Address:</span>
                  <span className="text-slate-200 font-medium text-right max-w-[60%]">
                    {activeConversation.pickupDetails?.location ||
                      activeConversation.serviceArea ||
                      'Address verified on file'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-emerald-300 text-[11px] leading-relaxed">
                {activeConversation.pickupDetails?.specialInstructions ||
                  '✓ Vehicle assigned for temperature-controlled transport. OTP confirmation will be exchanged upon physical handover.'}
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  toast(
                    `Donation manifest for ${activeConversation.pickupDetails?.orderId || `#DON-${activeConversation.id}`} downloaded.`,
                    'success'
                  )
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
              >
                Download Manifest
              </button>
              <button
                type="button"
                onClick={() => setShowDonationModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-slate-300 font-medium text-xs hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
