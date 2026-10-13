// Generates src-tauri/icon-src.png, the 1024x1024 master that `tauri icon`
// derives the .icns/.png set from. Written by hand (zlib + PNG chunks) so the
// project needs no image dependency for a build-time asset.
//
// The mark: a warm near-black rounded square with a light "stacked panes"
// glyph — two offset rectangles read as parallel answers, which is what the
// app is for.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const here = dirname(fileURLToPath(import.meta.url))

const BG = [26, 25, 23] // warm near-black
const PANE_BACK = [92, 90, 85]
const PANE_FRONT = [242, 240, 236]

/** Signed distance to a rounded rectangle, used to antialias the shape edges. */
function roundedRectSDF(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - radius
}

/** Coverage in [0,1] for a pixel, given an SDF value (1px antialiasing band). */
function coverage(distance) {
  return Math.min(Math.max(0.5 - distance, 0), 1)
}

function blend(target, source, alpha) {
  for (let i = 0; i < 3; i += 1) {
    target[i] = Math.round(target[i] * (1 - alpha) + source[i] * alpha)
  }
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const px = x + 0.5
    const py = y + 0.5
    const rgb = [0, 0, 0]
    let alpha = 0

    // Back pane, offset up-left; front pane, offset down-right. The overlap
    // reads as depth without any gradient.
    const panes = [
      { color: PANE_BACK, cx: 430, cy: 430, half: 150, radius: 34 },
      { color: PANE_FRONT, cx: 592, cy: 592, half: 152, radius: 34 },
    ]

    let base = coverage(roundedRectSDF(px, py, 512, 512, 512, 512, 232))
    if (base > 0) {
      rgb[0] = BG[0]
      rgb[1] = BG[1]
      rgb[2] = BG[2]
      alpha = base
    }

    for (const pane of panes) {
      const d = roundedRectSDF(px, py, pane.cx, pane.cy, pane.half, pane.half, pane.radius)
      const a = coverage(d) * base
      if (a > 0) blend(rgb, pane.color, a)
    }

    const i = (y * SIZE + x) * 4
    pixels[i] = rgb[0]
    pixels[i + 1] = rgb[1]
    pixels[i + 2] = rgb[2]
    pixels[i + 3] = Math.round(alpha * 255)
  }
}

// --- Minimal PNG encoder -----------------------------------------------------

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
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

// One filter byte (0 = None) per scanline, then the RGBA row.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = resolve(here, '../src-tauri/icon-src.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KiB)`)
