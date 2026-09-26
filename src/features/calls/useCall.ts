import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { User } from '@/types/chat'

/**
 * One-to-one voice and video calls over WebRTC. Audio and video go directly between
 * the two browsers (encrypted by WebRTC); only the signalling (who's calling, and the
 * connection details) travels through the conversation's private Realtime channel.
 *
 * Limits: calls ring only while Hamsa is open, and without a TURN relay server (VITE_TURN_URL)
 * some networks (strict NATs, many mobile carriers) can't connect directly.
 */

/** Public STUN servers: they only help each browser learn its public address. */
const STUN: RTCIceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
/** Optional TURN relay: carries the call when the two networks can't reach each other directly. */
const TURN_URLS = (import.meta.env.VITE_TURN_URL ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
const ICE_SERVERS: RTCIceServer[] = TURN_URLS.length
  ? [
      STUN,
      {
        urls: TURN_URLS,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL,
      },
    ]
  : [STUN]
const RING_TIMEOUT_MS = 45_000
const ENDED_NOTICE_MS = 2500
/** Buzz, pause, buzz, when a call comes in (phones only). */
const RING_VIBRATION_MS = [300, 200, 300]

type EndReason = 'ended' | 'declined' | 'noAnswer' | 'failed' | 'busy' | 'needsDevices'

type CallState =
  | { phase: 'idle' }
  | {
      phase: 'outgoing' | 'incoming' | 'connecting' | 'active'
      callId: string
      conversationId: string
      peer: User
      video: boolean
      /** When the call connected, for the timer. */
      startedAt?: number
    }
  | { phase: 'ended'; reason: EndReason; peer: User }

type Signal =
  | { type: 'invite'; callId: string; from: string; video: boolean }
  | { type: 'accept' | 'decline' | 'busy' | 'hangup'; callId: string; from: string }
  | { type: 'offer' | 'answer'; callId: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; callId: string; from: string; candidate: RTCIceCandidateInit }

function isSignal(value: unknown): value is Signal {
  const s = value as Partial<Signal> | null
  return typeof s?.type === 'string' && typeof s.callId === 'string' && typeof s.from === 'string'
}

interface Options {
  userId: string
  /** Finds the other person in a one-to-one conversation. */
  peerOf: (conversationId: string) => User | undefined
  send: (conversationId: string, signal: Signal) => void
}

export function useCall({ userId, peerOf, send }: Options) {
  const [state, setState] = useState<CallState>({ phase: 'idle' })
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)

  // The latest state for callbacks and signal handlers, updated right after each render.
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  const pc = useRef<RTCPeerConnection | null>(null)
  const local = useRef<MediaStream | null>(null)
  // Network candidates that arrive before the other side's description is set.
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const ringTimer = useRef<number | undefined>(undefined)
  const endTimer = useRef<number | undefined>(undefined)

  const cleanup = useCallback(() => {
    window.clearTimeout(ringTimer.current)
    pc.current?.close()
    pc.current = null
    local.current?.getTracks().forEach((track) => track.stop())
    local.current = null
    pendingIce.current = []
    setLocalStream(null)
    setRemoteStream(null)
    setMuted(false)
    setCameraOff(false)
  }, [])

  const end = useCallback(
    (reason: EndReason, notify: boolean) => {
      const current = stateRef.current
      if (current.phase === 'idle' || current.phase === 'ended') return
      if (notify) send(current.conversationId, { type: 'hangup', callId: current.callId, from: userId })
      cleanup()
      setState({ phase: 'ended', reason, peer: current.peer })
      window.clearTimeout(endTimer.current)
      endTimer.current = window.setTimeout(() => setState({ phase: 'idle' }), ENDED_NOTICE_MS)
    },
    [cleanup, send, userId],
  )

  const getMedia = useCallback(async (video: boolean) => {
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false })
      // No camera, or it's busy in another app: the call goes on with sound only.
      .catch((error: unknown) => {
        if (!video) throw error
        return navigator.mediaDevices.getUserMedia({ audio: true })
      })
    if (video && stream.getVideoTracks().length === 0) setCameraOff(true)
    local.current = stream
    setLocalStream(stream)
    return stream
  }, [])

  /** No camera or microphone (or no permission): say so, a little longer than other endings. */
  const failNeedsDevices = useCallback(
    (peer: User) => {
      cleanup()
      setState({ phase: 'ended', reason: 'needsDevices', peer })
      endTimer.current = window.setTimeout(() => setState({ phase: 'idle' }), ENDED_NOTICE_MS * 2)
    },
    [cleanup],
  )

  const connect = useCallback(
    (conversationId: string, callId: string, stream: MediaStream) => {
      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pc.current = connection
      stream.getTracks().forEach((track) => connection.addTrack(track, stream))
      connection.onicecandidate = (e) => {
        if (e.candidate) send(conversationId, { type: 'ice', callId, from: userId, candidate: e.candidate.toJSON() })
      }
      connection.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]))
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected') {
          setState((s) => (s.phase === 'connecting' ? { ...s, phase: 'active', startedAt: Date.now() } : s))
        }
        if (connection.connectionState === 'failed') end('failed', true)
      }
      return connection
    },
    [send, userId, end],
  )

  const flushIce = useCallback(async () => {
    for (const candidate of pendingIce.current.splice(0))
      await pc.current?.addIceCandidate(candidate).catch(() => undefined)
  }, [])

  /** Calls the other person in a one-to-one conversation. */
  const start = useCallback(
    async (conversationId: string, video: boolean) => {
      const peer = peerOf(conversationId)
      if (!peer || stateRef.current.phase !== 'idle') return
      const callId = crypto.randomUUID()
      setState({ phase: 'outgoing', callId, conversationId, peer, video })
      try {
        await getMedia(video)
      } catch {
        failNeedsDevices(peer)
        return
      }
      send(conversationId, { type: 'invite', callId, from: userId, video })
      ringTimer.current = window.setTimeout(() => end('noAnswer', true), RING_TIMEOUT_MS)
    },
    [peerOf, send, userId, end, getMedia, failNeedsDevices],
  )

  const accept = useCallback(async () => {
    const current = stateRef.current
    if (current.phase !== 'incoming') return
    setState({ ...current, phase: 'connecting' })
    try {
      await getMedia(current.video)
    } catch {
      send(current.conversationId, { type: 'decline', callId: current.callId, from: userId })
      failNeedsDevices(current.peer)
      return
    }
    connect(current.conversationId, current.callId, local.current!)
    send(current.conversationId, { type: 'accept', callId: current.callId, from: userId })
  }, [send, userId, getMedia, connect, failNeedsDevices])

  const decline = useCallback(() => {
    const current = stateRef.current
    if (current.phase !== 'incoming') return
    send(current.conversationId, { type: 'decline', callId: current.callId, from: userId })
    setState({ phase: 'idle' })
  }, [send, userId])

  const hangUp = useCallback(() => end('ended', true), [end])

  /** Everything the other side sends. Signals from anyone but the call's peer are ignored. */
  const handleSignal = useCallback(
    async (conversationId: string, value: unknown) => {
      if (!isSignal(value) || value.from === userId) return
      const signal = value
      const current = stateRef.current

      if (signal.type === 'invite') {
        const peer = peerOf(conversationId)
        if (!peer || peer.id !== signal.from) return
        if (current.phase !== 'idle' && current.phase !== 'ended') {
          send(conversationId, { type: 'busy', callId: signal.callId, from: userId })
          return
        }
        window.clearTimeout(endTimer.current)
        setState({ phase: 'incoming', callId: signal.callId, conversationId, peer, video: signal.video })
        navigator.vibrate?.(RING_VIBRATION_MS)
        return
      }

      if (current.phase === 'idle' || current.phase === 'ended') return
      if (signal.callId !== current.callId || signal.from !== current.peer.id) return

      switch (signal.type) {
        case 'accept': {
          if (current.phase !== 'outgoing' || !local.current) return
          window.clearTimeout(ringTimer.current)
          setState({ ...current, phase: 'connecting' })
          const connection = connect(conversationId, current.callId, local.current)
          const offer = await connection.createOffer()
          await connection.setLocalDescription(offer)
          send(conversationId, { type: 'offer', callId: current.callId, from: userId, sdp: offer })
          return
        }
        case 'offer': {
          const connection = pc.current
          if (!connection) return
          await connection.setRemoteDescription(signal.sdp)
          await flushIce()
          const answer = await connection.createAnswer()
          await connection.setLocalDescription(answer)
          send(conversationId, { type: 'answer', callId: current.callId, from: userId, sdp: answer })
          return
        }
        case 'answer':
          await pc.current?.setRemoteDescription(signal.sdp)
          await flushIce()
          return
        case 'ice':
          if (pc.current?.remoteDescription) await pc.current.addIceCandidate(signal.candidate).catch(() => undefined)
          else pendingIce.current.push(signal.candidate)
          return
        case 'decline':
          end('declined', false)
          return
        case 'busy':
          end('busy', false)
          return
        case 'hangup':
          // Hung up before you answered: the ringing just stops.
          if (current.phase === 'incoming') setState({ phase: 'idle' })
          else end('ended', false)
          return
      }
    },
    [userId, peerOf, send, end, connect, flushIce],
  )

  const toggleMute = useCallback(() => {
    const next = !muted
    local.current?.getAudioTracks().forEach((track) => (track.enabled = !next))
    setMuted(next)
  }, [muted])

  const toggleCamera = useCallback(() => {
    const next = !cameraOff
    local.current?.getVideoTracks().forEach((track) => (track.enabled = !next))
    setCameraOff(next)
  }, [cameraOff])

  // Leaving the page ends the call properly for the other person.
  useEffect(() => {
    const onLeave = () => end('ended', true)
    window.addEventListener('pagehide', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      cleanup()
    }
  }, [end, cleanup])

  return {
    state,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    start,
    accept,
    decline,
    hangUp,
    toggleMute,
    toggleCamera,
    handleSignal,
  }
}
