interface Vint {
  length: number
  value: number | null
}

function vint(buffer: Buffer, offset: number): Vint | null {
  const first = buffer[offset]
  if (first === undefined || first === 0) return null
  let length = 1
  let marker = 0x80
  while (length <= 8 && (first & marker) === 0) {
    length += 1
    marker >>= 1
  }
  if (length > 8 || offset + length > buffer.length) return null

  let value = first & (marker - 1)
  let unknown = value === marker - 1
  for (let i = 1; i < length; i += 1) {
    const byte = buffer[offset + i]!
    value = value * 256 + byte
    unknown &&= byte === 0xff
  }
  return { length, value: unknown ? null : value }
}

function ebmlId(buffer: Buffer, offset: number): { length: number; value: number } | null {
  const first = buffer[offset]
  if (first === undefined || first === 0) return null
  let length = 1
  let marker = 0x80
  while (length <= 4 && (first & marker) === 0) {
    length += 1
    marker >>= 1
  }
  if (length > 4 || offset + length > buffer.length) return null
  let value = 0
  for (let i = 0; i < length; i += 1) value = value * 256 + buffer[offset + i]!
  return { length, value }
}

function find(buffer: Buffer, bytes: readonly number[], from = 0): number {
  for (let i = from; i <= buffer.length - bytes.length; i += 1) {
    if (bytes.every((byte, index) => buffer[i + index] === byte)) return i
  }
  return -1
}

function unsigned(buffer: Buffer, offset: number, length: number): number | null {
  if (length < 1 || length > 8 || offset + length > buffer.length) return null
  let value = 0
  for (let i = 0; i < length; i += 1) value = value * 256 + buffer[offset + i]!
  return Number.isSafeInteger(value) ? value : null
}

function webmDuration(buffer: Buffer): number | null {
  let timecodeScale = 1_000_000
  const scaleAt = find(buffer, [0x2a, 0xd7, 0xb1])
  if (scaleAt >= 0) {
    const size = vint(buffer, scaleAt + 3)
    if (size?.value) {
      timecodeScale = unsigned(buffer, scaleAt + 3 + size.length, size.value) ?? timecodeScale
    }
  }

  let declared = 0
  const durationAt = find(buffer, [0x44, 0x89])
  if (durationAt >= 0) {
    const size = vint(buffer, durationAt + 2)
    const start = durationAt + 2 + (size?.length ?? 0)
    if (size?.value === 4 && start + 4 <= buffer.length) declared = buffer.readFloatBE(start)
    if (size?.value === 8 && start + 8 <= buffer.length) declared = buffer.readDoubleBE(start)
  }

  let lastTimecode = 0
  let clusterAt = find(buffer, [0x1f, 0x43, 0xb6, 0x75])
  while (clusterAt >= 0) {
    const size = vint(buffer, clusterAt + 4)
    if (!size) break
    let offset = clusterAt + 4 + size.length
    const end = size.value === null ? buffer.length : Math.min(buffer.length, offset + size.value)
    let clusterTimecode = 0
    const relativeBlocks: number[] = []

    while (offset < end) {
      const id = ebmlId(buffer, offset)
      if (!id) break
      const elementSize = vint(buffer, offset + id.length)
      if (!elementSize) break
      const dataStart = offset + id.length + elementSize.length
      if (elementSize.value === null || dataStart + elementSize.value > end) break

      if (id.value === 0xe7) {
        clusterTimecode = unsigned(buffer, dataStart, elementSize.value) ?? clusterTimecode
      } else if (id.value === 0xa3 && elementSize.value >= 4) {
        const track = vint(buffer, dataStart)
        const timecodeAt = dataStart + (track?.length ?? 0)
        if (track && timecodeAt + 2 <= dataStart + elementSize.value) {
          relativeBlocks.push(buffer.readInt16BE(timecodeAt))
        }
      }
      offset = dataStart + elementSize.value
    }

    lastTimecode = Math.max(lastTimecode, clusterTimecode)
    for (const relative of relativeBlocks) {
      lastTimecode = Math.max(lastTimecode, clusterTimecode + relative)
    }
    clusterAt = find(buffer, [0x1f, 0x43, 0xb6, 0x75], end)
  }

  const seconds = Math.max(declared, lastTimecode) * (timecodeScale / 1_000_000_000)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function mp4Duration(buffer: Buffer): number | null {
  let typeAt = find(buffer, [0x6d, 0x76, 0x68, 0x64]) // mvhd
  while (typeAt >= 4) {
    const atomSize = buffer.readUInt32BE(typeAt - 4)
    const version = buffer[typeAt + 4]
    const timeScaleAt = typeAt + (version === 1 ? 24 : 16)
    const durationAt = timeScaleAt + 4
    if (atomSize >= (version === 1 ? 40 : 28) && durationAt + (version === 1 ? 8 : 4) <= buffer.length) {
      const timeScale = buffer.readUInt32BE(timeScaleAt)
      const duration =
        version === 1 ? Number(buffer.readBigUInt64BE(durationAt)) : buffer.readUInt32BE(durationAt)
      if (timeScale > 0 && Number.isFinite(duration)) return duration / timeScale
    }
    typeAt = find(buffer, [0x6d, 0x76, 0x68, 0x64], typeAt + 4)
  }
  return null
}

function wavDuration(buffer: Buffer): number | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  const byteRate = buffer.readUInt32LE(28)
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data' && byteRate > 0) return size / byteRate
    offset += 8 + size + (size % 2)
  }
  return null
}

function oggDuration(buffer: Buffer): number | null {
  const lastPage = buffer.lastIndexOf('OggS')
  if (lastPage < 0 || lastPage + 14 > buffer.length) return null
  const granule = Number(buffer.readBigUInt64LE(lastPage + 6))
  const opusHead = buffer.indexOf('OpusHead')
  const preSkip = opusHead >= 0 && opusHead + 12 <= buffer.length ? buffer.readUInt16LE(opusHead + 10) : 0
  const seconds = (granule - preSkip) / 48_000
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function mp3Duration(buffer: Buffer): number | null {
  let offset = 0
  if (buffer.toString('ascii', 0, 3) === 'ID3' && buffer.length >= 10) {
    const size =
      (buffer[6]! << 21) | (buffer[7]! << 14) | (buffer[8]! << 7) | buffer[9]!
    offset = 10 + size
  }

  const mpeg1Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const mpeg2Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const sampleRates = [44_100, 48_000, 32_000]
  let seconds = 0
  let frames = 0

  while (offset + 4 <= buffer.length) {
    const header = buffer.readUInt32BE(offset)
    const version = (header >>> 19) & 0x3
    const layer = (header >>> 17) & 0x3
    const bitrateIndex = (header >>> 12) & 0xf
    const sampleIndex = (header >>> 10) & 0x3
    if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || bitrateIndex < 1 || bitrateIndex > 14 || sampleIndex > 2) {
      offset += 1
      continue
    }

    const bitrate = (version === 3 ? mpeg1Rates[bitrateIndex]! : mpeg2Rates[bitrateIndex]!) * 1000
    const divisor = version === 3 ? 1 : version === 2 ? 2 : 4
    const sampleRate = sampleRates[sampleIndex]! / divisor
    const padding = (header >>> 9) & 1
    const samples = version === 3 ? 1152 : 576
    const frameLength = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate + padding)
    if (frameLength < 4 || offset + frameLength > buffer.length) break
    seconds += samples / sampleRate
    frames += 1
    offset += frameLength
  }
  return frames > 0 ? seconds : null
}

/** Reads duration locally so an oversized recording is rejected before a billable provider call. */
export function audioDurationSeconds(buffer: Buffer, mimeType: string): number | null {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase()
  const seconds =
    mime === 'audio/webm'
      ? webmDuration(buffer)
      : mime === 'audio/mp4' || mime === 'audio/x-m4a'
        ? mp4Duration(buffer)
        : mime === 'audio/wav'
          ? wavDuration(buffer)
          : mime === 'audio/ogg'
            ? oggDuration(buffer)
            : mime === 'audio/mpeg'
              ? mp3Duration(buffer)
              : null
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null
}
