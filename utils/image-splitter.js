const sharp = require('sharp')

/**
 * Configuration for image splitting
 * Can be overridden via environment variables
 */
const SPLIT_CONFIG = {
  MAX_HEIGHT: parseInt(process.env.IMAGE_SPLIT_MAX_HEIGHT || '4000', 10), // Default: 4000px
  OVERLAP: parseInt(process.env.IMAGE_SPLIT_OVERLAP || '200', 10) // Default: 200px
}

/**
 * Split very tall images into sections for Vision API processing
 * Vision API has limits on processing very tall images (only processes top portion)
 * 
 * @param {Buffer} imageBuffer - Image to split
 * @param {number} maxHeight - Maximum height per section (default: from env or 4000px)
 * @param {number} overlap - Overlap between sections in pixels (default: from env or 200px)
 * @returns {Array} Array of image sections with metadata
 */
async function splitTallImage(imageBuffer, maxHeight = SPLIT_CONFIG.MAX_HEIGHT, overlap = SPLIT_CONFIG.OVERLAP) {
  try {
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()
    
    const width = metadata.width || 1280
    const height = metadata.height || 0
    
    // If image is not too tall, return as single section
    if (height <= maxHeight) {
      return [{
        buffer: imageBuffer,
        section: 'full',
        yOffset: 0,
        height: height,
        sectionIndex: 0,
        totalSections: 1
      }]
    }
    
    // Calculate number of sections needed
    const numSections = Math.ceil(height / maxHeight)
    const sections = []
    
    console.log(`📐 Splitting image: ${width}x${height}px into ${numSections} sections (max ${maxHeight}px each)`)
    
    // Split into sections with overlap to avoid cutting fields in half
    // Calculate base section height (without overlap)
    const baseSectionHeight = Math.floor((height - overlap) / numSections) + overlap
    
    for (let i = 0; i < numSections; i++) {
      // Calculate Y offset for this section
      // First section starts at 0, subsequent sections start with overlap
      const yOffset = i === 0 ? 0 : i * (baseSectionHeight - overlap)
      
      // Calculate height for this section
      // Last section takes remaining height, others use baseSectionHeight
      let sectionHeight
      if (i === numSections - 1) {
        // Last section: take all remaining height
        sectionHeight = height - yOffset
      } else {
        // Other sections: use baseSectionHeight (includes overlap for next section)
        sectionHeight = baseSectionHeight
      }
      
      // Ensure we don't exceed image bounds
      if (yOffset + sectionHeight > height) {
        sectionHeight = height - yOffset
      }
      
      if (sectionHeight <= 0 || yOffset >= height) {
        console.warn(`⚠️ Section ${i + 1} has invalid dimensions (yOffset: ${yOffset}, height: ${sectionHeight}), skipping`)
        continue
      }
      
      // Create a new sharp instance for each section (can't reuse the same pipeline)
      const sectionBuffer = await sharp(imageBuffer)
        .extract({
          left: 0,
          top: yOffset,
          width: width,
          height: sectionHeight
        })
        .toBuffer()
      
      sections.push({
        buffer: sectionBuffer,
        section: i === 0 ? 'top' : i === numSections - 1 ? 'bottom' : 'middle',
        sectionIndex: i,
        yOffset: yOffset,
        height: sectionHeight,
        totalSections: numSections
      })
    }
    
    return sections
  } catch (error) {
    console.error('Image splitting error:', error)
    // Return original image if splitting fails
    const metadata = await sharp(imageBuffer).metadata().catch(() => ({}))
    return [{
      buffer: imageBuffer,
      section: 'full',
      yOffset: 0,
      height: metadata.height || 0,
      sectionIndex: 0,
      totalSections: 1
    }]
  }
}

/**
 * Merge field extractions from multiple sections
 * Deduplicates fields that appear in overlap regions
 * Uses multiple strategies to ensure robust deduplication
 * 
 * @param {Array} sectionResults - Array of {fields: [], sectionIndex: number}
 * @returns {Array} Merged and deduplicated fields
 */
function mergeFieldExtractions(sectionResults) {
  const allFields = []
  const seenFields = new Set()
  
  // Sort by section index to process in order
  const sortedResults = [...sectionResults].sort((a, b) => a.sectionIndex - b.sectionIndex)
  
  for (const sectionResult of sortedResults) {
    const fields = sectionResult.fields || []
    
    for (const field of fields) {
      // Strategy 1: Normalized label + type + required status
      const normalizedLabel = field.label?.toLowerCase().trim().replace(/\s+/g, ' ') || ''
      const fieldKey1 = `${normalizedLabel}_${field.type}_${field.required ? 'req' : 'opt'}`
      
      // Strategy 2: Label + type (ignore required for exact matches)
      const fieldKey2 = `${normalizedLabel}_${field.type}`
      
      // Strategy 3: Label only (for cases where same field appears with different types)
      const fieldKey3 = normalizedLabel
      
      // Check all strategies - if any match, consider it a duplicate
      if (seenFields.has(fieldKey1) || seenFields.has(fieldKey2)) {
        console.log(`🔄 Deduplicating field: "${field.label}" (appeared in overlap region)`)
        continue
      }
      
      // For Strategy 3, only check if label is substantial (not empty/short)
      if (normalizedLabel.length > 3 && seenFields.has(fieldKey3)) {
        // Additional check: if options match, it's definitely a duplicate
        if (field.options && field.options.length > 0) {
          const existingField = allFields.find(f => 
            f.label?.toLowerCase().trim() === normalizedLabel
          )
          if (existingField && existingField.options) {
            const optionsMatch = JSON.stringify(existingField.options.sort()) === JSON.stringify(field.options.sort())
            if (optionsMatch) {
              console.log(`🔄 Deduplicating field: "${field.label}" (same label and options)`)
              continue
            }
          }
        }
      }
      
      // Add to seen sets
      seenFields.add(fieldKey1)
      seenFields.add(fieldKey2)
      if (normalizedLabel.length > 3) {
        seenFields.add(fieldKey3)
      }
      
      allFields.push(field)
    }
  }
  
  console.log(`✅ Merged ${allFields.length} unique fields from ${sectionResults.length} sections`)
  return allFields
}

module.exports = {
  splitTallImage,
  mergeFieldExtractions
}
