function matches(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
  return matches(bytes, offset, [...value].map(char => char.charCodeAt(0)))
}

export function imageExtension(bytes: Uint8Array): string | null {
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return '.png'
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return '.jpg'
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return '.gif'
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return '.webp'
  if (ascii(bytes, 4, 'ftyp')) {
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 32); offset += 4) {
      if (ascii(bytes, offset, 'avif') || ascii(bytes, offset, 'avis')) return '.avif'
    }
  }
  return null
}
