import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { validateBatchTotal, validateInventoryDraw, validateTreatmentDates } from '../dist/lib/invariants.js'
import { resolveUploadRoot } from '../dist/lib/storage.js'
import { audioDurationSeconds } from '../dist/lib/audio-duration.js'

test('rejects a batch total below all committed honey exits', () => {
  assert.throws(
    () => validateBatchTotal(12, 5, 8),
    (error) => error?.code === 'below_committed' && /13/.test(error.message),
  )
})

test('accepts a batch total equal to packed plus bulk sold honey', () => {
  assert.doesNotThrow(() => validateBatchTotal(13, 5, 8))
})

test('rejects drawing more packaging material than is on the shelf', () => {
  assert.throws(
    () => validateInventoryDraw('Poklopci', 90, 100),
    (error) => error?.code === 'insufficient_material' && /Poklopci/.test(error.message),
  )
})

test('rejects a treatment ending before it starts', () => {
  assert.throws(
    () => validateTreatmentDates('2026-08-07', '2026-08-06'),
    (error) => error?.code === 'invalid_dates',
  )
})

// '' rather than undefined: undefined triggers the default parameter, which reads the real
// UPLOAD_DIR, so this assertion would fail on any machine — or CI run — that exports one.
test('resolves the default upload directory from the project, not process cwd', () => {
  assert.equal(resolveUploadRoot(''), path.resolve(import.meta.dirname, '../../uploads'))
})

test('resolves a relative configured upload directory from the project root', () => {
  assert.equal(resolveUploadRoot('private/uploads'), path.resolve(import.meta.dirname, '../../private/uploads'))
})

test('reads WAV duration locally before transcription', () => {
  const wav = Buffer.alloc(44 + 16_000)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8_000, 24)
  wav.writeUInt32LE(16_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(16_000, 40)
  assert.equal(audioDurationSeconds(wav, 'audio/wav'), 1)
})

test('reads a WebM cluster timecode without calling a provider', () => {
  const webm = Buffer.from([
    0x1f, 0x43, 0xb6, 0x75, 0x8b,
    0xe7, 0x83, 0x02, 0xbf, 0x20,
    0xa3, 0x84, 0x81, 0x00, 0x00, 0x00,
  ])
  assert.equal(audioDurationSeconds(webm, 'audio/webm'), 180)
})
