const SAMPLE_RATE = 24000
const BUFFER_SIZE_BYTES = 4800

export interface BrowserAudioChunk {
  base64Data: string
  pcmChunk: Int16Array
}

export type BrowserAudioCaptureErrorCode = 'microphone-denied' | 'microphone-unavailable' | 'worklet-load-failure'

export class BrowserAudioCaptureError extends Error {
  readonly code: BrowserAudioCaptureErrorCode

  constructor(code: BrowserAudioCaptureErrorCode, message: string) {
    super(message)
    this.name = 'BrowserAudioCaptureError'
    this.code = code
  }
}

function base64FromInt16Array(buffer: Int16Array) {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let binary = ''

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }

  return window.btoa(binary)
}

function buildWavBlobFromPcm16(samples: Int16Array, sampleRate: number) {
  const headerSize = 44
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(headerSize + index * 2, samples[index] || 0, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export class BrowserAudioCapture {
  private audioContext: AudioContext | null = null
  private audioNode: AudioWorkletNode | null = null
  private audioStream: MediaStream | null = null
  private silentGainNode: GainNode | null = null
  private audioBuffer = new Int16Array(0)
  private capturedChunks: Int16Array[] = []
  private capturedSampleCount = 0
  private muted = false

  async start(onAudioChunk: (chunk: BrowserAudioChunk) => void) {
    if (this.audioContext) {
      return
    }

    this.audioBuffer = new Int16Array(0)
    this.capturedChunks = []
    this.capturedSampleCount = 0
    this.muted = false

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    } catch (error) {
      const microphoneError = error instanceof DOMException && error.name === 'NotAllowedError'
      throw new BrowserAudioCaptureError(
        microphoneError ? 'microphone-denied' : 'microphone-unavailable',
        microphoneError
          ? 'Microphone access was denied. Allow microphone access to start Wulo Scribe.'
          : 'The microphone could not be started in this browser session.',
      )
    }

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })

    try {
      await this.audioContext.audioWorklet.addModule('/audio-capture-worklet.js')
    } catch {
      await this.stop()
      throw new BrowserAudioCaptureError(
        'worklet-load-failure',
        'The browser audio processor could not be loaded. Refresh and try Wulo Scribe again.',
      )
    }

    const sourceNode = this.audioContext.createMediaStreamSource(this.audioStream)
    this.audioNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor')
    this.silentGainNode = this.audioContext.createGain()
    this.silentGainNode.gain.value = 0

    this.audioNode.port.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer }>) => {
      if (this.muted || !event.data?.buffer) {
        return
      }

      const incoming = new Int16Array(event.data.buffer)
      this.capturedChunks.push(incoming.slice())
      this.capturedSampleCount += incoming.length

      const merged = new Int16Array(this.audioBuffer.length + incoming.length)
      merged.set(this.audioBuffer)
      merged.set(incoming, this.audioBuffer.length)

      const samplesPerChunk = BUFFER_SIZE_BYTES / 2
      let offset = 0
      while (offset + samplesPerChunk <= merged.length) {
        const chunk = merged.slice(offset, offset + samplesPerChunk)
        onAudioChunk({
          base64Data: base64FromInt16Array(chunk),
          pcmChunk: chunk,
        })
        offset += samplesPerChunk
      }

      this.audioBuffer = merged.slice(offset)
    }

    sourceNode.connect(this.audioNode)
    this.audioNode.connect(this.silentGainNode)
    this.silentGainNode.connect(this.audioContext.destination)
  }

  async stop(options?: { discardCapturedAudio?: boolean }) {
    this.audioNode?.disconnect()
    this.audioNode = null

    this.silentGainNode?.disconnect()
    this.silentGainNode = null

    for (const track of this.audioStream?.getTracks() || []) {
      track.stop()
    }
    this.audioStream = null

    if (this.audioContext?.state !== 'closed') {
      await this.audioContext?.close()
    }
    this.audioContext = null
    this.audioBuffer = new Int16Array(0)
    this.muted = false

    if (options?.discardCapturedAudio) {
      this.capturedChunks = []
      this.capturedSampleCount = 0
    }
  }

  takeCapturedWavBlob() {
    if (this.capturedSampleCount === 0) {
      this.capturedChunks = []
      return null
    }

    const merged = new Int16Array(this.capturedSampleCount)
    let offset = 0
    for (const chunk of this.capturedChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    this.capturedChunks = []
    this.capturedSampleCount = 0
    return buildWavBlobFromPcm16(merged, SAMPLE_RATE)
  }

  toggleMute() {
    this.muted = !this.muted
    return this.muted
  }

  isMuted() {
    return this.muted
  }
}