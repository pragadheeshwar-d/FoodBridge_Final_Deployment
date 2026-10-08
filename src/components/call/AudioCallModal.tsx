/**
 * AudioCallModal - Complete Responsive UI for Real-time Audio Calls in FoodBridge
 * Renders:
 * 1. Incoming Call Popup with Accept/Decline and Ringing Animation
 * 2. Outgoing Calling Dialog with Status and End Call
 * 3. Active Connected Audio Call Interface with Duration Timer, Mute & Speaker
 * 4. Graceful Error & Ended Banners
 */

import { motion, AnimatePresence } from 'framer-motion'
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  AlertCircle,
  X,
} from 'lucide-react'
import { useCall } from '../../context/CallContext'
import { getAvatarBg, getInitials } from '../../services/messagingService'

export function AudioCallModal() {
  const {
    callState,
    activeCall,
    formattedDuration,
    isMuted,
    isSpeakerOn,
    permissionError,
    callErrorMessage,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    dismissCall,
    clearPermissionError,
  } = useCall()

  // Render permission error toast banner if any
  const renderPermissionError = () => {
    if (!permissionError) return null
    return (
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] max-w-md w-full px-4">
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-rose-950/90 border border-rose-500/40 text-rose-200 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <p className="text-xs sm:text-sm font-medium">{permissionError}</p>
          </div>
          <button
            type="button"
            onClick={clearPermissionError}
            className="p-1 rounded-lg hover:bg-rose-900/50 text-rose-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  if (callState === 'idle') {
    return renderPermissionError()
  }

  const partnerName = activeCall?.partnerName || 'Partner'
  const partnerRole = activeCall?.partnerRole || 'Participant'
  const initials = getInitials(partnerName)
  const avatarBg = getAvatarBg(activeCall?.partnerId || partnerName)

  return (
    <>
      {renderPermissionError()}

      <AnimatePresence>
        <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-sm rounded-3xl bg-[#0D1624] border border-slate-800 shadow-2xl p-6 text-center text-white overflow-hidden"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-16 -left-16 w-36 h-36 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -right-16 w-36 h-36 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

            {/* ================================================================= */}
            {/* 1. INCOMING CALL POPUP                                            */}
            {/* ================================================================= */}
            {callState === 'ringing' && (
              <div className="flex flex-col items-center">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-emerald-400 mb-4 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30">
                  Incoming Audio Call
                </span>

                {/* Animated Pulsing Ringing Avatar */}
                <div className="relative my-4">
                  <span className="absolute inset-0 rounded-3xl bg-emerald-500/20 animate-ping" />
                  <span className="absolute -inset-2 rounded-3xl bg-emerald-500/10 animate-pulse" />
                  <div
                    className={`relative w-24 h-24 rounded-3xl flex items-center justify-center text-2xl font-extrabold border-2 border-emerald-500/50 shadow-xl ${avatarBg}`}
                  >
                    {activeCall?.partnerAvatar ? (
                      <img
                        src={activeCall.partnerAvatar}
                        alt={partnerName}
                        className="w-full h-full object-cover rounded-3xl"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                </div>

                <h3 className="text-lg font-bold text-white mt-1 truncate max-w-[260px]">
                  {partnerName}
                </h3>
                <p className="text-xs text-slate-400 capitalize mt-0.5">
                  {partnerRole} • Incoming audio call
                </p>

                {/* Action Buttons: Decline & Accept */}
                <div className="flex items-center justify-center gap-6 mt-8 w-full">
                  <button
                    type="button"
                    onClick={declineCall}
                    className="flex flex-col items-center gap-1.5 group focus:outline-none"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-rose-500/20 group-hover:bg-rose-500 border border-rose-500/40 group-hover:border-rose-500 text-rose-400 group-hover:text-white flex items-center justify-center transition-all duration-200 shadow-lg shadow-rose-950/50">
                      <PhoneOff className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400 group-hover:text-rose-300">
                      Decline
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void acceptCall()}
                    className="flex flex-col items-center gap-1.5 group focus:outline-none"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500 group-hover:bg-emerald-400 text-slate-950 flex items-center justify-center transition-all duration-200 shadow-lg shadow-emerald-950/60 ring-4 ring-emerald-500/20">
                      <PhoneCall className="w-6 h-6 text-slate-950" />
                    </div>
                    <span className="text-[11px] font-semibold text-emerald-400 group-hover:text-emerald-300">
                      Accept
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* 2. OUTGOING CALLING / CONNECTING                                  */}
            {/* ================================================================= */}
            {(callState === 'calling' || callState === 'connecting') && (
              <div className="flex flex-col items-center">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-4 px-3 py-1 rounded-full bg-slate-900 border border-slate-800">
                  {callState === 'calling' ? 'Calling...' : 'Connecting...'}
                </span>

                <div className="relative my-4">
                  <div
                    className={`w-24 h-24 rounded-3xl flex items-center justify-center text-2xl font-extrabold border border-slate-700/80 shadow-xl ${avatarBg}`}
                  >
                    {activeCall?.partnerAvatar ? (
                      <img
                        src={activeCall.partnerAvatar}
                        alt={partnerName}
                        className="w-full h-full object-cover rounded-3xl"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#0D1624] animate-ping" />
                </div>

                <h3 className="text-lg font-bold text-white mt-1 truncate max-w-[260px]">
                  {partnerName}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {callState === 'calling' ? 'Waiting for answer...' : 'Establishing encrypted connection...'}
                </p>

                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={endCall}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-950/60"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>End Call</span>
                  </button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* 3. ACTIVE CONNECTED AUDIO CALL                                   */}
            {/* ================================================================= */}
            {callState === 'connected' && (
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Connected • {formattedDuration}</span>
                </div>

                <div className="my-3">
                  <div
                    className={`w-20 h-20 rounded-3xl flex items-center justify-center text-xl font-bold border border-emerald-500/40 shadow-lg ${avatarBg}`}
                  >
                    {activeCall?.partnerAvatar ? (
                      <img
                        src={activeCall.partnerAvatar}
                        alt={partnerName}
                        className="w-full h-full object-cover rounded-3xl"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                </div>

                <h3 className="text-base font-bold text-white mt-1 truncate max-w-[240px]">
                  {partnerName}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Real-time Encrypted Audio</p>

                {/* Call Controls: Mute, Speaker, End */}
                <div className="flex items-center justify-center gap-4 mt-8 pt-4 border-t border-slate-800/80 w-full">
                  {/* Microphone Toggle */}
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    className={`flex flex-col items-center gap-1 p-3 rounded-2xl border transition-all ${
                      isMuted
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                        : 'bg-slate-900/80 border-slate-700/70 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-emerald-400" />}
                    <span className="text-[10px] font-semibold">
                      {isMuted ? 'Muted' : 'Mic On'}
                    </span>
                  </button>

                  {/* Speaker Toggle */}
                  <button
                    type="button"
                    onClick={toggleSpeaker}
                    aria-label={isSpeakerOn ? 'Speaker on' : 'Speaker off'}
                    className={`flex flex-col items-center gap-1 p-3 rounded-2xl border transition-all ${
                      !isSpeakerOn
                        ? 'bg-slate-900/40 border-slate-800 text-slate-500'
                        : 'bg-slate-900/80 border-slate-700/70 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {isSpeakerOn ? <Volume2 className="w-5 h-5 text-emerald-400" /> : <VolumeX className="w-5 h-5" />}
                    <span className="text-[10px] font-semibold">Speaker</span>
                  </button>

                  {/* End Call Button */}
                  <button
                    type="button"
                    onClick={endCall}
                    aria-label="End call"
                    className="flex flex-col items-center gap-1 p-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-lg shadow-rose-950/60"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">End</span>
                  </button>
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* 4. DECLINED / MISSED / ENDED / FAILED NOTIFICATIONS               */}
            {/* ================================================================= */}
            {(callState === 'declined' ||
              callState === 'missed' ||
              callState === 'ended' ||
              callState === 'failed') && (
              <div className="flex flex-col items-center py-4">
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl mb-3 ${
                    callState === 'declined'
                      ? 'bg-rose-950/50 border border-rose-500/30 text-rose-400'
                      : callState === 'missed'
                      ? 'bg-amber-950/50 border border-amber-500/30 text-amber-400'
                      : callState === 'failed'
                      ? 'bg-rose-950/50 border border-rose-500/30 text-rose-400'
                      : 'bg-slate-900 border border-slate-800 text-emerald-400'
                  }`}
                >
                  {callState === 'declined' && <PhoneOff className="w-6 h-6" />}
                  {callState === 'missed' && <Phone className="w-6 h-6" />}
                  {callState === 'ended' && <Phone className="w-6 h-6" />}
                  {callState === 'failed' && <AlertCircle className="w-6 h-6" />}
                </div>

                <h3 className="text-base font-bold text-white">
                  {callState === 'declined' && 'Call Declined'}
                  {callState === 'missed' && 'Missed Audio Call'}
                  {callState === 'ended' && 'Call Ended'}
                  {callState === 'failed' && 'Connection Failed'}
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-[220px]">
                  {callState === 'declined' && `${partnerName} declined the audio call.`}
                  {callState === 'missed' && 'No answer. Marked as missed call.'}
                  {callState === 'ended' &&
                    (formattedDuration !== '00:00'
                      ? `Duration: ${formattedDuration}`
                      : 'Call session ended.')}
                  {callState === 'failed' && (callErrorMessage || 'Unable to establish peer connection.')}
                </p>

                <button
                  type="button"
                  onClick={dismissCall}
                  className="mt-6 px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </AnimatePresence>
    </>
  )
}
