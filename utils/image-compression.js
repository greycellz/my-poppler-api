const sharp = require('sharp')

/**
 * Compression options
 */
const DEFAULT_OPTIONS = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 85,
  format: 'jpeg'
}

/**
 * Compress image before sending to Vision API
 * Reduces file size while maintaining readability
 */
async function compressImage(imageBuffer, options = {}) {
  const {
    maxWidth = DEFAULT_OPTIONS.maxWidth,
    maxHeight = DEFAULT_OPTIONS.maxHeight,
    quality = DEFAULT_OPTIONS.quality,
    format = DEFAULT_OPTIONS.format
  } = options

  try {
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()

    // Determine if resizing is needed
    const needsResize = 
      (metadata.width && metadata.width > maxWidth) ||
      (metadata.height && metadata.height > maxHeight)

    let pipeline = image

    // Resize if needed (maintains aspect ratio)
    if (needsResize) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
    }

    // Convert and compress based on format
    let compressedBuffer
    let mimeType
    
    if (format === 'jpeg') {
      compressedBuffer = await pipeline
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      mimeType = 'image/jpeg'
    } else if (format === 'png') {
      compressedBuffer = await pipeline
        .png({ compressionLevel: 9, quality })
        .toBuffer()
      mimeType = 'image/png'
    } else {
      compressedBuffer = await pipeline
        .webp({ quality })
        .toBuffer()
      mimeType = 'image/webp'
    }

    return {
      buffer: compressedBuffer,
      mimeType,
      originalSize: imageBuffer.length,
      compressedSize: compressedBuffer.length,
      compressionRatio: ((1 - compressedBuffer.length / imageBuffer.length) * 100).toFixed(1)
    }
  } catch (error) {
    console.error('Image compression error:', error)
    // Return original buffer if compression fails
    return {
      buffer: imageBuffer,
      mimeType: 'image/png',
      originalSize: imageBuffer.length,
      compressedSize: imageBuffer.length,
      compressionRatio: 0
    }
  }
}

/**
 * Get optimal compression settings based on image type
 */
function getCompressionSettings(mimeType) {
  if (mimeType && mimeType.includes('png')) {
    return {
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 90,
      format: 'png'
    }
  }
  
  // Default to JPEG for photos/scans
  return {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 85,
    format: 'jpeg'
  }
}

module.exports = {
  compressImage,
  getCompressionSettings
}
