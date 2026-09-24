import { useCallback, useEffect, useRef, useState } from 'react'

export const MAX_RECORDING_MS = 5 * 60 * 1000
/** How many bars a voice note's waveform is squeezed into. */
export const WAVEFORM_BARS = 48
/** How many bars the live view shows while recording. */
const LIVE_BARS = 40

// Chrome/Firefox record WebM/Opus; Safari records MP4/AAC.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export type RecorderError = 'blocked' | 'unsupported'

export interface Recording {
  file: File
  durationMs: number
  waveform: number[]
}

/** Averages many loudness samples into a fixed number of bars, scaled 0–100. */
function toBars(samples: number[], bars: number) {
  if (samples.length === 0) return Array(bars).fill(8)
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * samples.length) / bars)
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars))
    const slice = samples.slice(from, to)
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length)
  }
  const peak = Math.max(...out, 0.02)
  return out.map((v) => Math.max(8, Math.round((v / peak) * 100)))
}

/**
 * Records a voice note with MediaRecorder, and measures loudness with an AnalyserNode
 * for the live waveform. `stop()` resolves with the file; `cancel()` throws it away.
 * The microphone is released as soon as either happens.
 */
export function useVoiceRecorder(onLimitReached?: (recording: Recording) => void) {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState<RecorderError | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const frame = useRef(0)
  const chunks = useRef<Blob[]>([])
  const samples = useRef<number[]>([])
  const startedAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const onLimit = useRef(onLimitReached)
  useEffect(() => {
    onLimit.current = onLimitReached
  })

  const release = useCallback(() => {
    window.clearInterval(timer.current)
    cancelAnimationFrame(frame.current)
    audioContext.current?.close().catch(() => undefined)
    audioContext.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
    setRecording(false)
    setElapsedMs(0)
    setLevels([])
  }, [])

  const stop = useCallback(
    (): Promise<Recording | null> =>
      new Promise((resolve) => {
        const r = recorder.current
        if (!r || r.state === 'inactive') return resolve(null)
        const durationMs = Date.now() - startedAt.current
        const waveform = toBars(samples.current, WAVEFORM_BARS)
        r.onstop = () => {
          const type = r.mimeType || 'audio/webm'
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          const file = new File(chunks.current, `voice-${Date.now()}.${extension}`, { type })
          release()
          resolve(durationMs > 500 ? { file, durationMs, waveform } : null) // ignore accidental taps
        }
        r.stop()
      }),
    [release],
  )

  const start = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('unsupported')
      return
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('blocked')
      return
    }

    // Loudness for the waveform, ~every animation frame.
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream.current).connect(analyser)
    audioContext.current = context
    const data = new Uint8Array(analyser.fftSize)
    samples.current = []
    let lastSample = 0
    const measure = (now: number) => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += ((v - 128) / 128) ** 2
      const rms = Math.sqrt(sum / data.length)
      if (now - lastSample > 60) {
        lastSample = now
        samples.current.push(rms)
        setLevels((l) => [...l.slice(-(LIVE_BARS - 1)), Math.min(1, rms * 4)])
      }
      frame.current = requestAnimationFrame(measure)
    }
    frame.current = requestAnimationFrame(measure)

    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined)
    chunks.current = []
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    r.start(250)
    recorder.current = r
    startedAt.current = Date.now()
    setRecording(true)
    timer.current = window.setInterval(async () => {
      const elapsed = Date.now() - startedAt.current
      setElapsedMs(elapsed)
      if (elapsed >= MAX_RECORDING_MS) {
        const result = await stop()
        if (result) onLimit.current?.(result)
      }
    }, 200)
  }, [stop])

  const cancel = useCallback(() => {
    const r = recorder.current
    if (r && r.state !== 'inactive') {
      r.onstop = () => release()
      r.stop()
    } else {
      release()
    }
  }, [release])

  // Leaving the chat mid-recording releases the microphone.
  useEffect(() => () => {
    window.clearInterval(timer.current)
    cancelAnimationFrame(frame.current)
    audioContext.current?.close().catch(() => undefined)
    stream.current?.getTracks().forEach((track) => track.stop())
  }, [])

  return { recording, elapsedMs, levels, error, start, stop, cancel, clearError: () => setError(null) }
}
