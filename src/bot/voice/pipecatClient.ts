import {
  VoiceConnection,
  EndBehaviorType,
  createAudioResource,
  StreamType,
  AudioPlayer,
  createAudioPlayer,
} from "@discordjs/voice";
import prism from "prism-media";
import { WebSocket } from "ws";
import { PassThrough } from "stream";

const PIPECAT_URL = process.env.PIPECAT_URL;
if (!PIPECAT_URL) throw new Error("PIPECAT_URL is not set");

// 48kHz stereo int16 LE → 16kHz mono int16 LE
// Box-car average of 3 consecutive stereo frames (simple low-pass) + L/R downmix
function resample48to16mono(input: Buffer): Buffer {
  const outputFrames = Math.floor(input.length / 4 / 3);
  const out = Buffer.alloc(outputFrames * 2);
  for (let i = 0; i < outputFrames; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const base = (i * 3 + j) * 4;
      sum += input.readInt16LE(base) + input.readInt16LE(base + 2); // L + R
    }
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / 6))), i * 2);
  }
  return out;
}

// 16kHz mono int16 LE → 48kHz stereo int16 LE (3x upsample + duplicate channel)
// StreamType.Raw requires 48kHz stereo s16le
function resample16to48stereo(input: Buffer): Buffer {
  const inputFrames = input.length / 2;
  const out = Buffer.alloc(inputFrames * 3 * 4);
  for (let i = 0; i < inputFrames; i++) {
    const s = input.readInt16LE(i * 2);
    for (let j = 0; j < 3; j++) {
      const offset = (i * 3 + j) * 4;
      out.writeInt16LE(s, offset);     // L
      out.writeInt16LE(s, offset + 2); // R
    }
  }
  return out;
}

function mixPcm(a: Buffer, b: Buffer): Buffer {
  const len = Math.max(a.length, b.length);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i += 2) {
    const sa = i < a.length ? a.readInt16LE(i) : 0;
    const sb = i < b.length ? b.readInt16LE(i) : 0;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sa + sb)), i);
  }
  return out;
}

export class PipecatClient {
  private ws: WebSocket | null = null;
  private player: AudioPlayer;
  private destroyed = false;
  private audioStream: PassThrough | null = null;
  private audioEndTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<string, { opusStream: { destroy(): void } }>();
  private pendingMix: Buffer | null = null;
  private mixScheduled = false;

  constructor(private connection: VoiceConnection) {
    this.player = createAudioPlayer();
    connection.subscribe(this.player);
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(PIPECAT_URL!);
    ws.binaryType = "nodebuffer";

    ws.on("open", () => {
      this.ws = ws;
    });

    ws.on("message", (data: Buffer | string) => {
      if (Buffer.isBuffer(data)) {
        this.playPcm(data);
      }
    });

    ws.on("close", () => {
      this.ws = null;
      if (this.destroyed) return;
      setTimeout(() => this.connect(), 3_000);
    });

    ws.on("error", (err) => {
      console.error("[pipecat] ws error:", err.message, err);
    });
  }

  streamUser(userId: string): void {
    if (this.subscriptions.has(userId)) return;

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });

    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48_000,
    });

    opusStream.pipe(decoder);

    decoder.on("data", (chunk: Buffer) => {
      const pcm16 = resample48to16mono(chunk);
      this.enqueueMix(pcm16);
    });

    decoder.on("end", () => {
      this.subscriptions.delete(userId);
    });

    this.subscriptions.set(userId, { opusStream });
  }

  private enqueueMix(pcm: Buffer): void {
    this.pendingMix = this.pendingMix ? mixPcm(this.pendingMix, pcm) : pcm;
    if (this.mixScheduled) return;
    this.mixScheduled = true;
    setImmediate(() => {
      const buf = this.pendingMix!;
      this.pendingMix = null;
      this.mixScheduled = false;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(buf);
      }
    });
  }

  private playPcm(pcm: Buffer): void {
    const pcm48stereo = resample16to48stereo(pcm);

    if (this.audioEndTimer) {
      clearTimeout(this.audioEndTimer);
      this.audioEndTimer = null;
    }

    if (!this.audioStream) {
      this.audioStream = new PassThrough();
      const resource = createAudioResource(this.audioStream, { inputType: StreamType.Raw });
      this.player.play(resource);
    }

    this.audioStream.write(pcm48stereo);

    this.audioEndTimer = setTimeout(() => {
      this.audioStream?.end();
      this.audioStream = null;
      this.audioEndTimer = null;
    }, 400);
  }

  destroy(): void {
    this.destroyed = true;
    for (const { opusStream } of this.subscriptions.values()) {
      opusStream.destroy();
    }
    this.subscriptions.clear();
    this.ws?.close();
    this.player.stop();
  }
}
