/**
 * Resizes an image in the browser before upload, so a 5 MB phone photo becomes
 * a few hundred KB. Browsers that can't encode WebP fall back to PNG.
 */
export async function resizeImage(file: Blob, options: { maxSide: number; square?: boolean }): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap

  let sx = 0
  let sy = 0
  let sw = width
  let sh = height
  if (options.square) {
    const side = Math.min(width, height)
    sx = (width - side) / 2
    sy = (height - side) / 2
    sw = side
    sh = side
  }

  const scale = Math.min(1, options.maxSide / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read this image.'))), 'image/webp', 0.85),
  )
}

export function extensionFor(blob: Blob) {
  return blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp'
}
