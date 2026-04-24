"use client";

import type { Recording } from "./use-recorder";

/**
 * Склеивает несколько записей в один WAV-файл.
 * WAV выбран намеренно: его легко собрать в браузере без внешних зависимостей,
 * и он надёжно открывается почти на любом устройстве.
 */
export async function mergeRecordingsToWav(
  recordings: Recording[]
): Promise<Blob> {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Браузер не поддерживает экспорт объединённой записи.");
  }

  const audioContext = new AudioCtx();
  try {
    const decoded = await Promise.all(
      recordings.map(async (recording) => {
        const arrayBuffer = await recording.blob.arrayBuffer();
        return audioContext.decodeAudioData(arrayBuffer.slice(0));
      })
    );

    const sampleRate = decoded[0]?.sampleRate ?? 44100;
    const totalLength = decoded.reduce((sum, buffer) => {
      const normalizedLength =
        buffer.sampleRate === sampleRate
          ? buffer.length
          : Math.round((buffer.length / buffer.sampleRate) * sampleRate);
      return sum + normalizedLength;
    }, 0);
    const merged = audioContext.createBuffer(1, totalLength, sampleRate);
    const output = merged.getChannelData(0);

    let offset = 0;
    for (const buffer of decoded) {
      const mono = mixToMono(buffer);
      if (buffer.sampleRate === sampleRate) {
        output.set(mono, offset);
        offset += mono.length;
        continue;
      }

      const resampledLength = Math.round((mono.length / buffer.sampleRate) * sampleRate);
      const resampled = resampleChannel(mono, buffer.sampleRate, sampleRate, resampledLength);
      output.set(resampled, offset);
      offset += resampled.length;
    }

    return encodeWav(merged);
  } finally {
    await audioContext.close();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const result = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      result[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return result;
}

function resampleChannel(
  input: Float32Array,
  inSampleRate: number,
  outSampleRate: number,
  outLength: number
): Float32Array {
  const output = new Float32Array(outLength);
  const ratio = inSampleRate / outSampleRate;

  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const frac = position - leftIndex;
    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;
    output[i] = left + (right - left) * frac;
  }

  return output;
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channelData = buffer.getChannelData(0);
  const pcm = new Int16Array(channelData.length);

  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(44 + i * 2, pcm[i], true);
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
