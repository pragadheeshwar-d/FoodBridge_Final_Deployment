/**
 * CallContext - Centralized state machine & WebRTC signaling orchestrator
 * for FoodBridge real-time audio calling.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { useAuth } from './AuthContext'
import { getSocket } from '../lib/socket'
import { webrtcService } from '../services/webrtcService'
import { soundManager } from '../utils/sound'

export type CallState =
  | 'idle'
  | 'calling' // Outgoing call ringing on caller side
  | 'ringing' // Incoming call ringing on callee side
  | 'connecting' // WebRTC SDP offer/answer exchange in progress
  | 'connected' // Call active and audio flowing
  | 'declined' // Call was declined
  | 'missed' // Call timed out / unanswered
  | 'ended' // Call was completed / hung up
  | 'failed' // Audio or connection failure

export interface ActiveCallData {
  callId: string
  conversationId: string
  partnerId: string
  partnerName: string
  partnerAvatar?: string | null
  partnerRole?: string
  isCaller: boolean
}

interface CallContextType {
  callState: CallState
  activeCall: ActiveCallData | null
  duration: number
  formattedDuration: string
  isMuted: boolean
  isSpeakerOn: boolean
  permissionError: string | null
  callErrorMessage: string | null
  startCall: (
    partner: {
      id: string | number
      name: string
      avatar?: string | null
      role?: string
    },
    conversationId: string
  ) => Promise<void>
  acceptCall: () => Promise<void>
  declineCall: () => void
  endCall: () => void
  toggleMute: () => void
  toggleSpeaker: () => void
  dismissCall: () => void
  clearPermissionError: () => void
}

const CallContext = createContext<CallContextType | undefined>(undefined)

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const currentUserId = user?.id ? String(user.id) : null

  const [callState, setCallState] = useState<CallState>('idle')
  const [activeCall, setActiveCall] = useState<ActiveCallData | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [callErrorMessage, setCallErrorMessage] = useState<string | null>(null)

  const activeCallRef = useRef<ActiveCallData | null>(null)
  activeCallRef.current = activeCall

  const callStateRef = useRef<CallState>(callState)
  callStateRef.current = callState

  const durationRef = useRef<number>(0)
  durationRef.current = duration

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Format seconds to mm:ss
  const formattedDuration = useMemo(() => {
    const mins = Math.floor(duration / 60)
    const secs = duration % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }, [duration])

  // Stop call timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Start duration timer (only when connected)
  const startTimer = useCallback(() => {
    stopTimer()
    setDuration(0)
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1)
    }, 1000)
  }, [stopTimer])

  // Clean all audio sounds & timers
  const stopAllAudioAndTimers = useCallback(() => {
    soundManager.stopAll()
    stopTimer()
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current)
      ringTimeoutRef.current = null
    }
  }, [stopTimer])

  // Full cleanup helper
  const performCleanup = useCallback(() => {
    stopAllAudioAndTimers()
    webrtcService.cleanup()
    setIsMuted(false)
    setCallErrorMessage(null)
  }, [stopAllAudioAndTimers])

  // Reset to idle with optional delayed auto-close
  const scheduleResetToIdle = useCallback(
    (delayMs = 2500) => {
      if (autoResetTimeoutRef.current) {
        clearTimeout(autoResetTimeoutRef.current)
      }
      autoResetTimeoutRef.current = setTimeout(() => {
        performCleanup()
        setCallState('idle')
        setActiveCall(null)
        setDuration(0)
      }, delayMs)
    },
    [performCleanup]
  )

  // Immediate dismiss
  const dismissCall = useCallback(() => {
    if (autoResetTimeoutRef.current) {
      clearTimeout(autoResetTimeoutRef.current)
    }
    performCleanup()
    setCallState('idle')
    setActiveCall(null)
    setDuration(0)
  }, [performCleanup])

  // Clear permission error banner
  const clearPermissionError = useCallback(() => {
    setPermissionError(null)
  }, [])

  // 1. OUTGOING CALL: Caller clicks "Call"
  const startCall = useCallback(
    async (
      partner: {
        id: string | number
        name: string
        avatar?: string | null
        role?: string
      },
      conversationId: string
    ) => {
      if (!currentUserId) return
      if (callStateRef.current !== 'idle') {
        console.warn('[Call] Already in a call session')
        return
      }

      setPermissionError(null)
      setCallErrorMessage(null)

      // 1. Request microphone access upfront
      try {
        await webrtcService.acquireLocalAudioStream()
      } catch (err: any) {
        console.error('[Call] Microphone access denied or unavailable:', err)
        setPermissionError('Microphone access is required to make an audio call.')
        return
      }

      const clientCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const callData: ActiveCallData = {
        callId: clientCallId,
        conversationId: String(conversationId),
        partnerId: String(partner.id),
        partnerName: partner.name || 'Partner',
        partnerAvatar: partner.avatar,
        partnerRole: partner.role,
        isCaller: true,
      }

      setActiveCall(callData)
      setCallState('calling')
      soundManager.startRingback()

      const socket = getSocket()
      socket.emit('call:initiate', {
        call_id: clientCallId,
        conversation_id: conversationId,
        caller_id: currentUserId,
        receiver_id: String(partner.id),
      })

      // 30s ringing timeout for unanswered call
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current)
      ringTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === 'calling') {
          socket.emit('call:timeout', {
            call_id: clientCallId,
            conversation_id: conversationId,
          })
          soundManager.stopRingback()
          setCallState('missed')
          scheduleResetToIdle(3000)
        }
      }, 30000)
    },
    [currentUserId, scheduleResetToIdle]
  )

  // 2. ACCEPT CALL: Callee clicks "Accept"
  const acceptCall = useCallback(async () => {
    const currentCall = activeCallRef.current
    if (!currentCall) return

    stopAllAudioAndTimers()
    setCallState('connecting')

    try {
      await webrtcService.acquireLocalAudioStream()
    } catch (err: any) {
      console.error('[Call] Microphone permission failed on accept:', err)
      setPermissionError('Microphone access is required to take the call.')
      setCallState('failed')
      scheduleResetToIdle(3000)
      return
    }

    const socket = getSocket()

    // Initialize peer connection with callbacks
    webrtcService.createPeerConnection({
      onIceCandidate: (candidate) => {
        socket.emit('call:ice_candidate', {
          call_id: currentCall.callId,
          candidate: candidate.toJSON(),
          sender_id: currentUserId,
        })
      },
      onConnectionStateChange: (state) => {
        if (state === 'connected') {
          setCallState('connected')
          startTimer()
        } else if (state === 'failed') {
          setCallState('failed')
          scheduleResetToIdle(3000)
        } else if (state === 'disconnected') {
          setTimeout(() => {
            const current = webrtcService.getConnectionState()
            if (current === 'disconnected' || current === 'failed') {
              setCallState('failed')
              scheduleResetToIdle(3000)
            }
          }, 4000)
        }
      },
    })

    socket.emit('call:accept', {
      call_id: currentCall.callId,
      conversation_id: currentCall.conversationId,
      user_id: currentUserId,
    })
  }, [currentUserId, scheduleResetToIdle, startTimer, stopAllAudioAndTimers])

  // 3. DECLINE CALL: Callee clicks "Decline"
  const declineCall = useCallback(() => {
    const currentCall = activeCallRef.current
    stopAllAudioAndTimers()

    if (currentCall) {
      const socket = getSocket()
      socket.emit('call:decline', {
        call_id: currentCall.callId,
        conversation_id: currentCall.conversationId,
      })
    }

    setCallState('declined')
    scheduleResetToIdle(1500)
  }, [scheduleResetToIdle, stopAllAudioAndTimers])

  // 4. END CALL: Either user clicks "End Call"
  const endCall = useCallback(() => {
    const currentCall = activeCallRef.current
    const finalDuration = durationRef.current
    stopAllAudioAndTimers()

    if (currentCall) {
      const socket = getSocket()
      socket.emit('call:end', {
        call_id: currentCall.callId,
        conversation_id: currentCall.conversationId,
        duration: finalDuration,
        user_id: currentUserId,
        reason: 'user_ended',
      })
    }

    setCallState('ended')
    scheduleResetToIdle(1500)
  }, [currentUserId, scheduleResetToIdle, stopAllAudioAndTimers])

  // 5. MUTE TOGGLE
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      webrtcService.setMicrophoneMuted(next)
      return next
    })
  }, [])

  // 6. SPEAKER TOGGLE
  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => !prev)
  }, [])

  // =========================================================================
  // Real-time Socket.IO Signaling Listeners
  // =========================================================================
  useEffect(() => {
    if (!currentUserId) return

    const socket = getSocket()

    // INCOMING CALL
    const handleIncomingCall = (payload: any) => {
      if (!payload || !payload.call_id) return

      // If already in a call, notify caller busy and ignore
      if (callStateRef.current !== 'idle') {
        socket.emit('call:end', {
          call_id: payload.call_id,
          reason: 'busy',
        })
        return
      }

      const callData: ActiveCallData = {
        callId: payload.call_id,
        conversationId: String(payload.conversation_id),
        partnerId: String(payload.caller_id),
        partnerName: payload.caller_name || 'Caller',
        partnerAvatar: payload.caller_avatar,
        partnerRole: payload.caller_role,
        isCaller: false,
      }

      setActiveCall(callData)
      setCallState('ringing')
      soundManager.startRingtone()

      // 35s safety timer if caller drops abruptly
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current)
      ringTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === 'ringing') {
          soundManager.stopRingtone()
          setCallState('missed')
          scheduleResetToIdle(2500)
        }
      }, 35000)
    }

    // CALL ACCEPTED (Caller receives this)
    const handleCallAccepted = async (payload: any) => {
      const currentCall = activeCallRef.current
      if (!currentCall || payload.call_id !== currentCall.callId) return

      stopAllAudioAndTimers()
      setCallState('connecting')

      // Caller creates RTCPeerConnection and sends SDP Offer
      try {
        webrtcService.createPeerConnection({
          onIceCandidate: (candidate) => {
            socket.emit('call:ice_candidate', {
              call_id: currentCall.callId,
              candidate: candidate.toJSON(),
              sender_id: currentUserId,
            })
          },
          onConnectionStateChange: (state) => {
            if (state === 'connected') {
              setCallState('connected')
              startTimer()
            } else if (state === 'failed') {
              setCallState('failed')
              scheduleResetToIdle(3000)
            } else if (state === 'disconnected') {
              setTimeout(() => {
                const current = webrtcService.getConnectionState()
                if (current === 'disconnected' || current === 'failed') {
                  setCallState('failed')
                  scheduleResetToIdle(3000)
                }
              }, 4000)
            }
          },
        })

        const offer = await webrtcService.createOffer()
        socket.emit('call:offer', {
          call_id: currentCall.callId,
          conversation_id: currentCall.conversationId,
          sdp: offer,
        })
      } catch (err) {
        console.error('[Call] Error creating offer:', err)
        setCallState('failed')
        scheduleResetToIdle(2500)
      }
    }

    // CALL DECLINED (Caller receives this)
    const handleCallDeclined = (payload: any) => {
      const currentCall = activeCallRef.current
      if (currentCall && payload.call_id === currentCall.callId) {
        stopAllAudioAndTimers()
        setCallState('declined')
        scheduleResetToIdle(2500)
      }
    }

    // WEBRTC SDP OFFER (Receiver receives this)
    const handleCallOffer = async (payload: any) => {
      const currentCall = activeCallRef.current
      if (!currentCall || payload.call_id !== currentCall.callId || !payload.sdp) return

      try {
        await webrtcService.handleRemoteOffer(payload.sdp)
        const answer = await webrtcService.createAnswer()
        socket.emit('call:answer', {
          call_id: currentCall.callId,
          conversation_id: currentCall.conversationId,
          sdp: answer,
        })
      } catch (err) {
        console.error('[Call] Error handling offer and creating answer:', err)
        setCallState('failed')
        scheduleResetToIdle(2500)
      }
    }

    // WEBRTC SDP ANSWER (Caller receives this)
    const handleCallAnswer = async (payload: any) => {
      const currentCall = activeCallRef.current
      if (!currentCall || payload.call_id !== currentCall.callId || !payload.sdp) return

      try {
        await webrtcService.handleRemoteAnswer(payload.sdp)
      } catch (err) {
        console.error('[Call] Error setting remote answer:', err)
      }
    }

    // ICE CANDIDATE (Both sides receive this)
    const handleIceCandidate = async (payload: any) => {
      const currentCall = activeCallRef.current
      if (!currentCall || payload.call_id !== currentCall.callId || !payload.candidate) return

      try {
        await webrtcService.addIceCandidate(payload.candidate)
      } catch (err) {
        console.error('[Call] Error adding remote candidate:', err)
      }
    }

    // CALL ENDED (Remotely terminated)
    const handleCallEnded = (payload: any) => {
      const currentCall = activeCallRef.current
      if (currentCall && (!payload.call_id || payload.call_id === currentCall.callId)) {
        stopAllAudioAndTimers()
        if (payload.reason === 'timeout' || payload.reason === 'missed') {
          setCallState('missed')
        } else {
          setCallState('ended')
        }
        scheduleResetToIdle(2000)
      }
    }

    // CALL MISSED
    const handleCallMissed = (payload: any) => {
      const currentCall = activeCallRef.current
      if (currentCall && payload.call_id === currentCall.callId) {
        stopAllAudioAndTimers()
        setCallState('missed')
        scheduleResetToIdle(2500)
      }
    }

    // CALL ERROR / UNAVAILABLE
    const handleCallError = (payload: any) => {
      console.warn('[Call] Call error from server:', payload?.message)
      stopAllAudioAndTimers()
      setCallErrorMessage(payload?.message || 'Unable to establish peer connection.')
      setCallState('failed')
      scheduleResetToIdle(4000)
    }

    socket.on('call:incoming', handleIncomingCall)
    socket.on('call:accepted', handleCallAccepted)
    socket.on('call:declined', handleCallDeclined)
    socket.on('call:offer', handleCallOffer)
    socket.on('call:answer', handleCallAnswer)
    socket.on('call:ice_candidate', handleIceCandidate)
    socket.on('call:ended', handleCallEnded)
    socket.on('call:missed', handleCallMissed)
    socket.on('call:error', handleCallError)

    // Handle tab closing or browser refresh
    const handleBeforeUnload = () => {
      const call = activeCallRef.current
      if (call && callStateRef.current !== 'idle') {
        socket.emit('call:end', {
          call_id: call.callId,
          conversation_id: call.conversationId,
          duration: durationRef.current,
          reason: 'tab_closed',
        })
        webrtcService.cleanup()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      socket.off('call:incoming', handleIncomingCall)
      socket.off('call:accepted', handleCallAccepted)
      socket.off('call:declined', handleCallDeclined)
      socket.off('call:offer', handleCallOffer)
      socket.off('call:answer', handleCallAnswer)
      socket.off('call:ice_candidate', handleIceCandidate)
      socket.off('call:ended', handleCallEnded)
      socket.off('call:missed', handleCallMissed)
      socket.off('call:error', handleCallError)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [currentUserId, scheduleResetToIdle, startTimer, stopAllAudioAndTimers])

  return (
    <CallContext.Provider
      value={{
        callState,
        activeCall,
        duration,
        formattedDuration,
        isMuted,
        isSpeakerOn,
        permissionError,
        callErrorMessage,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleSpeaker,
        dismissCall,
        clearPermissionError,
      }}
    >
      {children}
    </CallContext.Provider>
  )
}

export function useCall(): CallContextType {
  const ctx = useContext(CallContext)
  if (!ctx) {
    throw new Error('useCall must be used within a CallProvider')
  }
  return ctx
}
