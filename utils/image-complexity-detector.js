const sharp = require('sharp')

/**
 * Quick heuristic: simple pages are usually < 1MB and < 4MP
 * Returns true if image is simple (can use low detail)
 */
function quickComplexityCheck(imageBuffer, width, height) {
  const fileSizeMB = imageBuffer.length / (1024 * 1024)
  
  // If dimensions provided, check megapixels
  if (width && height) {
    const megapixels = (width * height) / 1_000_000
    // Simple pages: small file size and resolution
    return fileSizeMB < 1 && megapixels < 4
  }
  
  // Fallback: just check file size
  return fileSizeMB < 1
}

/**
 * Analyze image to determine if high detail is needed
 * More sophisticated analysis (optional, for future)
 */
async function detectImageComplexity(imageBuffer) {
  try {
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()
    
    const reasons = []
    let score = 0
    
    // Factor 1: Image resolution
    const totalPixels = (metadata.width || 0) * (metadata.height || 0)
    const megapixels = totalPixels / 1_000_000
    
    if (megapixels > 8) {
      score += 0.2
      reasons.push('high resolution')
    }
    
    // Factor 2: Aspect ratio (forms are usually portrait)
    if (metadata.width && metadata.height) {
      const aspectRatio = metadata.width / metadata.height
      if (aspectRatio < 0.7) {
        score += 0.1
        reasons.push('portrait orientation (likely form)')
      }
    }
    
    // Factor 3: File size (larger = more content)
    const fileSizeMB = imageBuffer.length / (1024 * 1024)
    if (fileSizeMB > 2) {
      score += 0.3
      reasons.push('large file size')
    }
    
    // Default: assume forms need high detail unless proven simple
    // This is conservative - better accuracy than speed
    const needsHighDetail = score > 0.3 || fileSizeMB > 1
    
    return {
      score,
      needsHighDetail,
      reasons
    }
  } catch (error) {
    console.error('Complexity detection error:', error)
    // Default to high detail on error (conservative)
    return {
      score: 1,
      needsHighDetail: true,
      reasons: ['detection failed, defaulting to high detail']
    }
  }
}

module.exports = {
  quickComplexityCheck,
  detectImageComplexity
}

