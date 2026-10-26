// Generates the iOS and Android app icons from src-tauri/icon-src.png.
//
//   pnpm icon:mobile
//
// The master is a macOS icon: a dark rounded square on a transparent canvas,
// which is right for the Dock and wrong for a phone. Both phones draw their own
// shape around an icon, so it has to arrive as the full square:
//
// - iOS masks the corners itself and rejects an icon with an alpha channel, so
//   every iOS size is flattened onto the square's own colour and written as
//   plain RGB — the transparent corners become more of the square.
// - Android's adaptive icon is a background layer and a foreground layer that
//   the launcher crops to a circle, squircle or square. The background is that
//   same colour and the foreground is the master scaled down, so the owl sits
//   inside the circle every launcher keeps, with nothing to show at the seam.
//
// The desktop icons in src-tauri/icons are left as `pnpm icon` made them; only
// icons/ios and icons/android are replaced, plus the Xcode project's asset
// catalog when `tauri ios init` has created one.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const TAURI = resolve(here, '../src-tauri')
const MASTER = join(TAURI, 'icon-src.png')
const ICONS = join(TAURI, 'icons')
const XCODE_ICONS = join(TAURI, 'gen/apple/Assets.xcassets/AppIcon.appiconset')

/** The master's square, sampled from it: the colour the corners are filled with. */
const BG = [0x1b, 0x1a, 0x18]
const BG_HEX = '#1B1A18'
/** Foreground size within Android's 108dp layer, as `tauri icon` takes it. */
const ANDROID_FG_SCALE = 85

// --- PNG in --------------------------------------------------------------------

/** Decodes an 8-bit RGB or RGBA PNG, the only kinds `tauri icon` writes. */
function decode(file) {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const data = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) {
        throw new Error('expected an 8-bit, non-interlaced RGB or RGBA PNG')
      }
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      pixels[y * stride + x] = (value + predict(filter, left, up, corner)) & 0xff
    }
  }
  return { width, height, channels, pixels }
}

function predict(filter, left, up, corner) {
  switch (filter) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return up
    case 3:
      return (left + up) >> 1
    case 4: {
      const p = left + up - corner
      const pl = Math.abs(p - left)
      const pu = Math.abs(p - up)
      const pc = Math.abs(p - corner)
      return pl <= pu && pl <= pc ? left : pu <= pc ? up : corner
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`)
  }
}

// --- PNG out -------------------------------------------------------------------

/** Composites onto BG and encodes as RGB, so there is no alpha channel at all. */
function flatten({ width, height, channels, pixels }) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * channels
      const alpha = channels === 4 ? pixels[from + 3] / 255 : 1
      for (let c = 0; c < 3; c += 1) {
        raw[y * (width * 3 + 1) + 1 + x * 3 + c] = Math.round(pixels[from + c] * alpha + BG[c] * (1 - alpha))
      }
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// Last, so the PNG helpers above (and their CRC table) exist when it runs.
main()

function main() {
  const work = mkdtempSync(join(tmpdir(), 'hmmchat-icons-'))
  try {
    const manifest = join(work, 'manifest.json')
    writeFileSync(
      manifest,
      JSON.stringify({ default: MASTER, bg_color: BG_HEX, android_fg: MASTER, android_fg_scale: ANDROID_FG_SCALE }),
    )
    const out = join(work, 'out')
    execFileSync('pnpm', ['-s', 'tauri', 'icon', manifest, '-o', out], { stdio: 'inherit', cwd: resolve(here, '..') })

    rmSync(join(ICONS, 'android'), { recursive: true, force: true })
    cpSync(join(out, 'android'), join(ICONS, 'android'), { recursive: true })

    rmSync(join(ICONS, 'ios'), { recursive: true, force: true })
    cpSync(join(out, 'ios'), join(ICONS, 'ios'), { recursive: true })
    for (const name of readdirSync(join(ICONS, 'ios')).filter((file) => file.endsWith('.png'))) {
      const opaque = flatten(decode(readFileSync(join(ICONS, 'ios', name))))
      writeFileSync(join(ICONS, 'ios', name), opaque)
      if (existsSync(XCODE_ICONS)) writeFileSync(join(XCODE_ICONS, name), opaque)
    }
    console.log(`\nicons/ios (opaque RGB) and icons/android written${existsSync(XCODE_ICONS) ? ', Xcode asset catalog updated' : ''}.`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
