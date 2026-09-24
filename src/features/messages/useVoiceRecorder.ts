import { useCallback, useEffect, useRef, useState } from 'react'

export const MAX_RECORDING_MS = 5 * 60 * 1000

// Chrome/Firefox record WebM/Opus; Safari records MP4/AAC.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export type RecorderError = 'blocked' | 'unsupported'

interface Recording {
  file: File
  durationMs: number
}

/**
 * Records a voice note with MediaRecorder. `stop()` resolves with the file;
 * `cancel()` throws it away. The microphone is released as soon as either happens.
 */
export function useVoiceRecorder(onLimitReached?: (recording: Recording) => void) {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<RecorderError | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const onLimit = useRef(onLimitReached)
  useEffect(() => {
    onLimit.current = onLimitReached
  })

  const release = useCallback(() => {
    window.clearInterval(timer.current)
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
    setRecording(false)
    setElapsedMs(0)
  }, [])

  const stop = useCallback(
    (): Promise<Recording | null> =>
      new Promise((resolve) => {
        const r = recorder.current
        if (!r || r.state === 'inactive') return resolve(null)
        const durationMs = Date.now() - startedAt.current
        r.onstop = () => {
          const type = r.mimeType || 'audio/webm'
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          const file = new File(chunks.current, `voice-${Date.now()}.${extension}`, { type })
          release()
          resolve(durationMs > 500 ? { file, durationMs } : null) // ignore accidental taps
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
    stream.current?.getTracks().forEach((track) => track.stop())
  }, [])

  return { recording, elapsedMs, error, start, stop, cancel, clearError: () => setError(null) }
}
