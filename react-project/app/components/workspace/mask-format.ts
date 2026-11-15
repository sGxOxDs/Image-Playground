const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function maskHeaderSize(bytes: Uint8Array): [number, number] | undefined {
  if (bytes.length < 33 || !pngSignature.every((byte, index) => bytes[index] === byte)) return;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(12) !== 0x49484452 || (bytes[25] !== 4 && bytes[25] !== 6)) return;
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width && height) return [width, height];
}
