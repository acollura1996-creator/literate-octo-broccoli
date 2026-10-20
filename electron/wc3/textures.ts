// Textures of Warcraft III models: BLP1 (classic and Reforged SD art; JPEG or paletted, decoded by
// war3-model), DDS (DXT1/3/5 and plain RGBA, as some Reforged files are) and TGA, to RGBA pixels at
// one size for the game's texture array.
import { decodeBLP, getBLPImageData } from 'war3-model';

export interface Image {
  width: number;
  height: number;
  /** RGBA, rows top first. */
  data: Uint8Array;
}

export function decodeTexture(bytes: Uint8Array): Image {
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic === 'BLP1') return decodeBlp(bytes);
  if (magic === 'DDS ') return decodeDds(bytes);
  if (bytes.length > 18 && (bytes[2] === 2 || bytes[2] === 10)) return decodeTga(bytes);
  throw new Error(`unknown texture format ${JSON.stringify(magic)}`);
}

function decodeBlp(bytes: Uint8Array): Image {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blp = decodeBLP(ab);
  const img = getBLPImageData(blp, 0);
  return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
}

// ------------------------------------------------------------------ DDS
function decodeDds(bytes: Uint8Array): Image {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const height = v.getUint32(12, true);
  const width = v.getUint32(16, true);
  const pfFlags = v.getUint32(80, true);
  let fourCC = String.fromCharCode(bytes[84]!, bytes[85]!, bytes[86]!, bytes[87]!);
  let offset = 128;
  if (fourCC === 'DX10') {
    const dxgi = v.getUint32(128, true);
    offset += 20;
    fourCC = dxgi === 71 || dxgi === 72 ? 'DXT1' : dxgi === 74 || dxgi === 75 ? 'DXT3' : dxgi === 77 || dxgi === 78 ? 'DXT5' : dxgi === 28 || dxgi === 29 ? 'RGBA' : dxgi === 87 || dxgi === 91 ? 'BGRA' : `dxgi${dxgi}`;
  }
  const out = new Uint8Array(width * height * 4);
  if (fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5') {
    decodeBc(bytes.subarray(offset), width, height, fourCC, out);
    return { width, height, data: out };
  }
  if (fourCC === 'RGBA' || fourCC === 'BGRA' || !(pfFlags & 4)) {
    // Uncompressed: 32 bits with channel masks (or a DX10 RGBA/BGRA format).
    const bits = fourCC === 'RGBA' || fourCC === 'BGRA' ? 32 : v.getUint32(88, true);
    if (bits !== 32 && bits !== 24) throw new Error(`DDS: ${bits}-bit pixels not supported`);
    const masks = fourCC === 'RGBA' ? [0xff, 0xff00, 0xff0000, 0xff000000] : fourCC === 'BGRA' ? [0xff0000, 0xff00, 0xff, 0xff000000] : [v.getUint32(92, true), v.getUint32(96, true), v.getUint32(100, true), v.getUint32(104, true)];
    const shift = masks.map((m) => (m ? Math.log2(m & -m) : 0));
    const step = bits / 8;
    for (let i = 0; i < width * height; i++) {
      const p = offset + i * step;
      const px = bits === 32 ? v.getUint32(p, true) : bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
      for (let c = 0; c < 4; c++) out[i * 4 + c] = masks[c] ? ((px & masks[c]!) >>> shift[c]!) & 255 : 255;
    }
    return { width, height, data: out };
  }
  throw new Error(`DDS: format ${fourCC} not supported`);
}

/** Block-compressed (BC1-3) pixels. */
function decodeBc(src: Uint8Array, width: number, height: number, kind: 'DXT1' | 'DXT3' | 'DXT5', out: Uint8Array): void {
  const blockBytes = kind === 'DXT1' ? 8 : 16;
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const colors = new Uint8Array(16);
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const b = (by * bw + bx) * blockBytes;
      if (b + blockBytes > src.length) return;
      const c = kind === 'DXT1' ? b : b + 8;
      // Alpha.
      alpha.fill(255);
      if (kind === 'DXT3') {
        for (let i = 0; i < 16; i++) alpha[i] = ((src[b + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17;
      } else if (kind === 'DXT5') {
        const a0 = src[b]!;
        const a1 = src[b + 1]!;
        const table = [a0, a1];
        if (a0 > a1) for (let k = 1; k < 7; k++) table.push(((7 - k) * a0 + k * a1) / 7);
        else {
          for (let k = 1; k < 5; k++) table.push(((5 - k) * a0 + k * a1) / 5);
          table.push(0, 255);
        }
        let bits = 0;
        for (let k = 0; k < 6; k++) bits += src[b + 2 + k]! * 2 ** (8 * k);
        for (let i = 0; i < 16; i++) alpha[i] = Math.round(table[Math.floor(bits / 2 ** (3 * i)) & 7]!);
      }
      // Colour.
      const c0 = src[c]! | (src[c + 1]! << 8);
      const c1 = src[c + 2]! | (src[c + 3]! << 8);
      const rgb = (x: number): [number, number, number] => [((x >> 11) & 31) * 255 / 31, ((x >> 5) & 63) * 255 / 63, (x & 31) * 255 / 31];
      const p0 = rgb(c0);
      const p1 = rgb(c1);
      const palette: Array<[number, number, number, number]> = [
        [...p0, 255],
        [...p1, 255],
      ];
      if (c0 > c1 || kind !== 'DXT1') {
        palette.push([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3, 255]);
        palette.push([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3, 255]);
      } else {
        palette.push([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 255]);
        palette.push([0, 0, 0, 0]);
      }
      const idx = src[c + 4]! | (src[c + 5]! << 8) | (src[c + 6]! << 16) | (src[c + 7]! * 2 ** 24);
      for (let i = 0; i < 16; i++) colors[i] = Math.floor(idx / 2 ** (2 * i)) & 3;
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const i = py * 4 + px;
          const col = palette[colors[i]!]!;
          const o = (y * width + x) * 4;
          out[o] = Math.round(col[0]);
          out[o + 1] = Math.round(col[1]);
          out[o + 2] = Math.round(col[2]);
          out[o + 3] = kind === 'DXT1' ? col[3] : alpha[i]!;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ TGA
function decodeTga(bytes: Uint8Array): Image {
  const idLength = bytes[0]!;
  const type = bytes[2]!;
  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const bpp = bytes[16]!;
  const topFirst = (bytes[17]! & 0x20) !== 0;
  if (bpp !== 24 && bpp !== 32) throw new Error(`TGA: ${bpp}-bit pixels not supported`);
  const step = bpp / 8;
  const pixels = new Uint8Array(width * height * 4);
  let p = 18 + idLength;
  let i = 0;
  const put = (): void => {
    pixels[i * 4] = bytes[p + 2]!;
    pixels[i * 4 + 1] = bytes[p + 1]!;
    pixels[i * 4 + 2] = bytes[p]!;
    pixels[i * 4 + 3] = step === 4 ? bytes[p + 3]! : 255;
    i++;
  };
  if (type === 2) {
    while (i < width * height) {
      put();
      p += step;
    }
  } else {
    while (i < width * height && p < bytes.length) {
      const head = bytes[p++]!;
      const n = (head & 127) + 1;
      if (head & 128) {
        for (let k = 0; k < n; k++) put();
        p += step;
      } else {
        for (let k = 0; k < n; k++) {
          put();
          p += step;
        }
      }
    }
  }
  if (topFirst) return { width, height, data: pixels };
  const flipped = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) flipped.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  return { width, height, data: flipped };
}

// ------------------------------------------------------------------ resizing
/** The image at size × size: box-filtered down, bilinear up. */
export function resize(img: Image, size: number): Image {
  if (img.width === size && img.height === size) return img;
  const out = new Uint8Array(size * size * 4);
  const sx = img.width / size;
  const sy = img.height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (sx >= 1 && sy >= 1) {
        // Average the source pixels this one covers.
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        const acc = [0, 0, 0, 0];
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 4; c++) acc[c]! += img.data[(yy * img.width + xx) * 4 + c]!;
        const n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c]! / n);
      } else {
        const fx = Math.max(0, (x + 0.5) * sx - 0.5);
        const fy = Math.max(0, (y + 0.5) * sy - 0.5);
        const x0 = Math.min(img.width - 1, Math.floor(fx)), x1 = Math.min(img.width - 1, x0 + 1);
        const y0 = Math.min(img.height - 1, Math.floor(fy)), y1 = Math.min(img.height - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 4; c++) {
          const a = img.data[(y0 * img.width + x0) * 4 + c]! * (1 - tx) + img.data[(y0 * img.width + x1) * 4 + c]! * tx;
          const b = img.data[(y1 * img.width + x0) * 4 + c]! * (1 - tx) + img.data[(y1 * img.width + x1) * 4 + c]! * tx;
          out[o + c] = Math.round(a * (1 - ty) + b * ty);
        }
      }
    }
  }
  return { width: size, height: size, data: out };
}
