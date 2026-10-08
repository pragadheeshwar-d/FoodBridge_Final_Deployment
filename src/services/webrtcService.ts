/**
 * WebRTC Audio Call Service for FoodBridge
 * Handles audio-only media stream acquisition, RTCPeerConnection lifecycle,
 * ICE candidates, and local track mute/unmute.
 */

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    ...(import.meta.env.VITE_TURN_SERVER_URL
      ? [
          {
            urls: import.meta.env.VITE_TURN_SERVER_URL as string,
            username: (import.meta.env.VITE_TURN_USERNAME as string) || undefined,
            credential: (import.meta.env.VITE_TURN_CREDENTIAL as string) || undefined,
          },
        ]
      : []),
  ],
  iceCandidatePoolSize: 10,
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private candidateQueue: RTCIceCandidateInit[] = []
  private audioElement: HTMLAudioElement | null = null

  /**
   * Request microphone permission and acquire local audio stream.
   * STRICTLY AUDIO ONLY - never requests video.
   */
  public async acquireLocalAudioStream(): Promise<MediaStream> {
    if (this.localStream) {
      return this.localStream
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser does not support audio calling.')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    this.localStream = stream
    return stream
  }

  /**
   * Get the current remote audio stream.
   */
  public getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  /**
   * Initialize or retrieve an HTMLAudioElement to play the incoming remote audio.
   */
  private getAudioElement(): HTMLAudioElement {
    if (!this.audioElement) {
      this.audioElement = new Audio()
      this.audioElement.autoplay = true
      // Needed for iOS Safari / Mobile webkit playback
      ;(this.audioElement as any).playsInline = true
    }
    return this.audioElement
  }

  /**
   * Create RTCPeerConnection and bind listeners.
   */
  public createPeerConnection(callbacks: {
    onTrack?: (stream: MediaStream) => void
    onIceCandidate?: (candidate: RTCIceCandidate) => void
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  }): RTCPeerConnection {
    this.cleanupPeerConnection()

    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.peerConnection = pc
    this.candidateQueue = []

    // Attach local audio tracks if stream is already acquired
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!)
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && callbacks.onIceCandidate) {
        callbacks.onIceCandidate(event.candidate)
      }
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) {
        this.remoteStream = stream
        const audio = this.getAudioElement()
        audio.srcObject = stream
        void audio.play().catch((err) => {
          console.warn('[WebRTC] Audio autoplay error (user gesture may be needed):', err)
        })
        if (callbacks.onTrack) {
          callbacks.onTrack(stream)
        }
      }
    }

    pc.onconnectionstatechange = () => {
      if (callbacks.onConnectionStateChange) {
        callbacks.onConnectionStateChange(pc.connectionState)
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      if (state === 'connected' || state === 'completed') {
        if (callbacks.onConnectionStateChange) {
          callbacks.onConnectionStateChange('connected')
        }
      }
    }

    return pc
  }

  /**
   * Create SDP Offer (Caller side).
   */
  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized')
    }
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    })
    await this.peerConnection.setLocalDescription(offer)
    return offer
  }

  /**
   * Set Remote Description from incoming offer (Receiver side).
   */
  public async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized')
    }
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    await this.flushQueuedCandidates()
  }

  /**
   * Create SDP Answer (Receiver side).
   */
  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized')
    }
    const answer = await this.peerConnection.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    })
    await this.peerConnection.setLocalDescription(answer)
    return answer
  }

  /**
   * Set Remote Description from incoming answer (Caller side).
   */
  public async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized')
    }
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
    await this.flushQueuedCandidates()
  }

  /**
   * Add ICE candidate received from signaling server.
   * Queues candidate if remote description has not been set yet.
   */
  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.candidateQueue.push(candidate)
      return
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn('[WebRTC] Error adding ICE candidate:', err)
    }
  }

  private async flushQueuedCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return
    while (this.candidateQueue.length > 0) {
      const cand = this.candidateQueue.shift()
      if (cand) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand))
        } catch (err) {
          console.warn('[WebRTC] Error flushing queued candidate:', err)
        }
      }
    }
  }

  /**
   * Mute or unmute local microphone track.
   */
  public setMicrophoneMuted(muted: boolean): boolean {
    if (!this.localStream) return false
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    return muted
  }

  /**
   * Toggle speaker / audio output device where supported (Chrome / Edge).
   */
  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    const audio = this.getAudioElement()
    if (typeof (audio as any).setSinkId === 'function') {
      try {
        await (audio as any).setSinkId(deviceId)
        return true
      } catch (err) {
        console.warn('[WebRTC] Could not set audio sink:', err)
      }
    }
    return false
  }

  /**
   * Tear down peer connection only.
   */
  public cleanupPeerConnection(): void {
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null
      this.peerConnection.ontrack = null
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.close()
      this.peerConnection = null
    }
    this.candidateQueue = []
  }

  /**
   * Full teardown: stop local media tracks, close connection, reset streams.
   */
  public cleanup(): void {
    this.cleanupPeerConnection()

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }

    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.srcObject = null
      this.audioElement = null
    }

    this.remoteStream = null
  }
}

export const webrtcService = new WebRTCService()
