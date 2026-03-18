class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input.length > 0) {
      const float32Data = input[0]
      const int16Data = new Int16Array(float32Data.length)

      for (let index = 0; index < float32Data.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, float32Data[index]))
        int16Data[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      }

      this.port.postMessage({ buffer: int16Data.buffer }, [int16Data.buffer])
    }

    return true
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor)