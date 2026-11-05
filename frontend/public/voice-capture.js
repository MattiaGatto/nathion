// Microphone stays inside the browser until an explicit active session detects a turn.
class NathionCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (let i = 0; i < input.length; i++) {
      this.buffer[this.offset++] = input[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("nathion-capture", NathionCapture);
