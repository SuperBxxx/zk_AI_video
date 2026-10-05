// ACT: 在浏览器里把录到的音频重新编码成 WAV。
//
// 为什么需要：MediaRecorder 在 Chrome/Edge 上默认输出 webm/opus，
// 而百炼的声音复刻只接受 wav / mpeg / mp4，服务端的音频转换又只吃 WAV 输入
// （apps/server/src/utils/media/audioProcessor.ts 明确不支持解码压缩格式），
// 因此必须在客户端转码，否则录音样本根本提交不上去。
//
// 做法：用 AudioContext.decodeAudioData 解码（浏览器能播的基本都能解），
// 再按 RIFF/WAVE 手工封装 16 位 PCM。不依赖 ffmpeg，也不需要额外下载。
const wavMimeType = "audio/wav";

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
}

/** 把 AudioBuffer 封装成 16 位 PCM 的 WAV。多声道会混成单声道——复刻样本不需要立体声。 */
export function audioBufferToWav(buffer: AudioBuffer) {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(frames);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++) mono[i] += data[i]! / channels;
  }
  const bytesPerSample = 2;
  const dataBytes = frames * bytesPerSample;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]!));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([output], { type: wavMimeType });
}

/** 把任意浏览器可解码的音频转成 WAV。失败时抛出可直接展示给用户的错误。 */
export async function toWavBlob(source: Blob) {
  const bytes = await source.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    return audioBufferToWav(decoded);
  } catch {
    throw new Error("无法解码这段音频，请改用 wav 或 mp3 格式的文件");
  } finally {
    void context.close();
  }
}

/** 已经是 WAV 就不用再转，避免无谓的重编码。 */
export function needsWavConversion(blob: Blob, name: string) {
  if (blob.type && /audio\/(wav|x-wav|vnd\.wave)/i.test(blob.type)) return false;
  return !/\.wav$/i.test(name);
}
