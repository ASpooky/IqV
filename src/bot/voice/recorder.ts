import { EndBehaviorType, VoiceConnection } from "@discordjs/voice";
import prism from "prism-media";
import { createWriteStream, mkdirSync } from "fs";
import { join } from "path";

const RECORDINGS_DIR = join(process.cwd(), "recordings");
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SIZE = 960;

function wavHeader(dataBytes: number): Buffer {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(dataBytes + 36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                           // PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);  // byte rate
  buf.writeUInt16LE(CHANNELS * 2, 32);                // block align
  buf.writeUInt16LE(16, 34);                          // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

export function startRecordingUser(
  connection: VoiceConnection,
  userId: string,
): void {
  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 2_000 },
  });

  const decoder = new prism.opus.Decoder({
    frameSize: FRAME_SIZE,
    channels: CHANNELS,
    rate: SAMPLE_RATE,
  });

  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(RECORDINGS_DIR, `${userId}_${ts}.wav`);
  const chunks: Buffer[] = [];

  decoder.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  decoder.on("end", () => {
    const data = Buffer.concat(chunks);
    const ws = createWriteStream(filePath);
    ws.write(wavHeader(data.length));
    ws.write(data);
    ws.end();
    console.log(`[recorder] saved ${filePath}`);
  });

  opusStream.pipe(decoder);
}
