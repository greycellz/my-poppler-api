const express = require('express')
const router = express.Router()
const vision = require('@google-cloud/vision')
const fs = require('fs')
const path = require('path')
const { withTimeout, TIMEOUTS } = require('../utils/timeout')

// Initialize Vision client
let visionClient = null

function initializeVisionClient() {
  if (visionClient) {
    return visionClient
  }

  try {
    let credentials
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Use environment variable (Railway)
      try {
        credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        console.log('✅ Google Vision credentials loaded from environment variable')
      } catch (error) {
        console.error('❌ Error parsing Google Vision credentials JSON:', error.message)
        throw new Error('Invalid Google Vision credentials JSON format')
      }
    } else {
      // Use key file (local development)
      const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json')
      if (!fs.existsSync(keyPath)) {
        throw new Error('Google Vision credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable or place chatterforms-app-key.json in project root.')
      }
      credentials = keyPath
      console.log('✅ Google Vision credentials loaded from key file')
    }

    visionClient = new vision.ImageAnnotatorClient({
      credentials: credentials,
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'chatterforms'
    })

    console.log('✅ Google Vision client initialized successfully')
    return visionClient
  } catch (error) {
    console.error('❌ Error initializing Google Vision client:', error)
    throw error
  }
}

// Groq model selection - using OSS 20B for better speed and lower cost
const USE_GROQ_LLAMA = process.env.USE_GROQ_LLAMA === 'TRUE'
const GROQ_MODEL = USE_GROQ_LLAMA ? 'llama-3.3-70b-versatile' : 'openai/gpt-oss-20b'

if (!process.env.GROQ_API_KEY) {
  console.error('⚠️ WARNING: GROQ_API_KEY not set in Railway environment')
}

/**
 * Helper functions for spatial layout analysis
 */

// Extract text from a Vision API block
function getBlockText(block) {
  if (!block || !block.paragraphs) return ''
  
  return block.paragraphs
    .flatMap(p => p.words || [])
    .map(w => (w.symbols || []).map(s => s.text).join(''))
    .join(' ')
}

// Calculate bounding box height
function getBlockHeight(block) {
  if (!block || !block.boundingBox || !block.boundingBox.vertices || block.boundingBox.vertices.length < 3) {
    return 0
  }
  const vertices = block.boundingBox.vertices
  return vertices[2].y - vertices[0].y
}

// Calculate median text height across all blocks (more robust than average)
/* 
 * DEPRECATED: Heuristic-based detection replaced by LLM-based classification
 * The functions below are preserved for reference but no longer used.
 * LLM now uses spatial data directly to classify form elements contextually.
 * 
function calculateMedianHeight(blocks) {
  const heights = blocks
    .map(b => getBlockHeight(b))
    .filter(h => h > 0)
    .sort((a, b) => a - b)
  
  if (heights.length === 0) return 0
  
  const mid = Math.floor(heights.length / 2)
  if (heights.length % 2 === 0) {
    return (heights[mid - 1] + heights[mid]) / 2
  }
  return heights[mid]
}

// Detect read-only text (headers, instructions, labels without inputs)
function detectSectionHeaders(blocks) {
  const headers = []
  const medianHeight = calculateMedianHeight(blocks)
  
  if (medianHeight === 0) return headers
  
  console.log(`📏 Median text height: ${medianHeight.toFixed(1)}px (more robust than average)`)
  console.log(`📏 Large text threshold (1.3x): ${(medianHeight * 1.3).toFixed(1)}px`)
  
  // Log all blocks for debugging
  console.log(`\n🔍 Analyzing ${blocks.length} blocks:`)
  
  blocks.forEach((block, index) => {
    const text = getBlockText(block).trim()
    if (!text) return
    
    const height = getBlockHeight(block)
    const relativeSize = height / medianHeight
    
    // Log first 10 blocks with details
    if (index < 10) {
      console.log(`  Block ${index + 1}: "${text.substring(0, 50)}" | ${height.toFixed(1)}px (${relativeSize.toFixed(2)}x median)`)
    }
    
    // Detect read-only text (headers, instructions, standalone labels)
    // Key indicators:
    // 1. Somewhat larger than typical (but not necessarily huge)
    // 2. Looks like a heading/label (all caps, or matches common patterns)
    // 3. NOT a field label (no colon like "Name:")
    // 4. Reasonable length (not a full paragraph, not just 1-2 chars)
    
    const isLargerThanTypical = relativeSize > 1.3  // More lenient than 1.5
    const isSignificantlyLarger = relativeSize > 1.8
    const isAllCaps = text === text.toUpperCase() && text.length > 3
    const isTitleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(text)  // "Contact Information", "Personal Information"
    const hasNoColon = !text.includes(':')
    const isReasonableLength = text.length >= 4 && text.length < 100
    const matchesHeaderPattern = /^(PART|SECTION|INFORMATION|CONTACT|EMERGENCY|HISTORY|AUTHORIZATION|CONSENT|DEMOGRAPHIC|PERSONAL|FINANCIAL|FORM|WELCOME|EDUCATION|EMPLOYMENT|FAMILY|LEGAL|APPLICATION|REGISTRATION|DETAILS|BACKGROUND|EXPERIENCE)/i.test(text)
    
    // Log check results for potential read-only text
    if (matchesHeaderPattern || isLargerThanTypical) {
      console.log(`  🔎 Potential read-only text: "${text.substring(0, 40)}"`)
      console.log(`     - Size: ${relativeSize.toFixed(2)}x | Larger? ${isLargerThanTypical}`)
      console.log(`     - AllCaps? ${isAllCaps} | TitleCase? ${isTitleCase} | NoColon? ${hasNoColon}`)
      console.log(`     - Length: ${text.length} | HeaderPattern? ${matchesHeaderPattern}`)
    }
    
    // Detection paths:
    // Path 1: Strong pattern match (pattern + (all caps OR title case) + no colon) - size-agnostic for short text
    // Path 2: Large + structured (all caps OR pattern) + not field label
    // Path 3: Very large + not field label + not too long (avoid paragraphs/options)
    const strongPatternMatch = matchesHeaderPattern && (isAllCaps || isTitleCase) && hasNoColon && text.length < 50
    const structuredHeader = (isAllCaps || matchesHeaderPattern) && hasNoColon && isReasonableLength
    const largeStructuredMatch = isLargerThanTypical && structuredHeader
    const veryLargeMatch = isSignificantlyLarger && hasNoColon && text.length < 60  // Stricter length to avoid "5. Religious background ( circle one ) Protestant..."
    
    if (strongPatternMatch || largeStructuredMatch || veryLargeMatch) {
      // Determine confidence
      let confidence = 'medium'
      if (strongPatternMatch) {
        confidence = 'high'  // Strong structural signals (pattern + formatting)
      } else if (isSignificantlyLarger && matchesHeaderPattern && (isAllCaps || isTitleCase)) {
        confidence = 'high'
      } else if (matchesHeaderPattern && (isAllCaps || isTitleCase)) {
        confidence = 'medium'
      } else {
        confidence = 'low'
      }
      
      // Determine header level based on relative size
      let headerLevel = 2  // default h2
      if (relativeSize > 1.8) {
        headerLevel = 1  // significantly large = h1
      } else if (relativeSize < 1.3) {
        headerLevel = 3  // moderately large = h3
      }
      
      headers.push({
        text: text,
        height: height,
        relativeSize: relativeSize,
        headerLevel: headerLevel,
        confidence: confidence
      })
      
      console.log(`✨ Detected read-only text: "${text}" (size: ${relativeSize.toFixed(2)}x, level: h${headerLevel}, confidence: ${confidence})`)
    }
  })
  
  return headers
}
*/

/**
 * Helper Functions for Batch Processing
 */

// Split vision results into batches
function splitIntoBatches(visionResults, batchSize) {
  const batches = []
  for (let i = 0; i < visionResults.length; i += batchSize) {
    batches.push(visionResults.slice(i, i + batchSize))
  }
  return batches
}

// Filter spatial blocks for a specific batch
function filterSpatialBlocksForBatch(spatialBlocks, batchPages) {
  if (!Array.isArray(batchPages) || batchPages.length === 0) {
    throw new Error('batchPages must be a non-empty array')
  }
  return spatialBlocks
    .filter(block => batchPages.includes(block.pageNumber))
    .map((block, idx) => ({
      ...block,
      index: idx + 1  // Re-index relative to batch
    }))
}

// Call Groq API with retry logic: if JSON parsing fails, retry once, then repair
async function callGroqWithRetry(requestBody, context = '') {
  const groqStartTime = Date.now()
  
  // First attempt
  let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  })

  if (!groqResponse.ok) {
    const errorData = await groqResponse.json().catch(() => ({}))
    throw new Error(`Groq API error: ${groqResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
  }

  let groqData = await groqResponse.json()
  const choice = groqData.choices?.[0]
  if (!choice) {
    throw new Error('No response from Groq API')
  }

  const finishReason = choice.finish_reason
  if (finishReason === 'length') {
    console.warn(`⚠️ ${context}First attempt - Response truncated (finish_reason: length)`)
  }

  let responseText = choice.message?.content || ''
  
  // Check for empty content
  if (!responseText) {
    if (finishReason === 'length') {
      throw new Error('Groq response truncated - content empty and finish_reason is "length". This indicates reasoning mode may have consumed all tokens.')
    }
    throw new Error('Groq response has no content - unable to extract fields')
  }
  
  // Try to parse JSON without repair first
  let parseSuccess = false
  let fields = []
  
  try {
    const parsed = JSON.parse(responseText)
    console.log(`🔍 [DEBUG] ${context}Parsed JSON type:`, Array.isArray(parsed) ? 'array' : typeof parsed)
    console.log(`🔍 [DEBUG] ${context}Parsed JSON keys:`, Array.isArray(parsed) ? `array[${parsed.length}]` : Object.keys(parsed || {}))
    fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
    console.log(`🔍 [DEBUG] ${context}Extracted fields count:`, fields?.length || 0)
    parseSuccess = true
    console.log(`✅ ${context}First attempt - Direct JSON parse succeeded (no repair needed)`)
  } catch (error) {
    console.log(`⚠️ ${context}First attempt - JSON parse failed: ${error.message}`)
  }

  // If parsing failed, retry the LLM call once
  if (!parseSuccess) {
    console.log(`🔄 ${context}Retrying LLM call...`)
    
    const retryStartTime = Date.now()
    groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json().catch(() => ({}))
      throw new Error(`Groq API retry error: ${groqResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    groqData = await groqResponse.json()
    const retryChoice = groqData.choices?.[0]
    if (!retryChoice) {
      throw new Error('No response from Groq API on retry')
    }

    const retryFinishReason = retryChoice.finish_reason
    if (retryFinishReason === 'length') {
      console.warn(`⚠️ ${context}Retry - Response truncated (finish_reason: length)`)
    }

    responseText = retryChoice.message?.content || ''
    
    // Check for empty content on retry
    if (!responseText) {
      if (retryFinishReason === 'length') {
        throw new Error('Groq retry response truncated - content empty and finish_reason is "length"')
      }
      throw new Error('Groq retry response has no content - unable to extract fields')
    }
    
    const retryTime = Date.now() - retryStartTime
    console.log(`✅ ${context}Retry completed in ${retryTime}ms`)

    // Try to parse retry response without repair
    try {
      const parsed = JSON.parse(responseText)
      fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
      parseSuccess = true
      console.log(`✅ ${context}Retry - Direct JSON parse succeeded (no repair needed)`)
    } catch (retryError) {
      console.log(`⚠️ ${context}Retry - JSON parse also failed: ${retryError.message}`)
      console.log(`🔧 ${context}Applying JSON repair as last resort...`)
      
      // Last resort: try repair
      try {
        const cleaned = repairJsonSyntax(responseText, { logRepairs: true })
        const parsed = JSON.parse(cleaned)
        fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
        parseSuccess = true
        console.log(`✅ ${context}JSON repair succeeded`)
      } catch (repairError) {
        // Try fallback extraction with repair
        let jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
        if (!jsonMatch) {
          jsonMatch = responseText.match(/(\[[\s\S]*\])/)
        }
        if (!jsonMatch) {
          jsonMatch = responseText.match(/(\{[\s\S]*?"fields"[\s\S]*?\})/)
        }
        
        if (jsonMatch) {
          try {
            const cleaned = repairJsonSyntax(jsonMatch[0], { logRepairs: true })
            const extracted = JSON.parse(cleaned)
            fields = Array.isArray(extracted) ? extracted : (extracted.fields || [])
            parseSuccess = true
            console.log(`✅ ${context}Fallback extraction with repair succeeded`)
          } catch (fallbackError) {
            throw new Error(`Failed to parse Groq response after retry and repair: ${fallbackError.message}`)
          }
        } else {
          throw new Error(`Failed to parse Groq response - no valid JSON found after retry and repair`)
        }
      }
    }
  }

  const groqTime = Date.now() - groqStartTime
  // Use the final groqData (from retry if retry happened, otherwise from first attempt)
  const finalChoice = groqData.choices?.[0]
  const groqUsage = groqData.usage || groqData.usage_metadata || null
  // Use finish_reason from final response (retry if retry happened, otherwise first attempt)
  const finalFinishReason = finalChoice?.finish_reason || finishReason || null

  return {
    fields,
    groqUsage,
    groqTime,
    finishReason: finalFinishReason,
    groqData
  }
}

// Build spatial context hint for LLM
function buildSpatialContextHint(spatialBlocks, maxSampleBlocks = 50) {
  const sampleBlocks = spatialBlocks.slice(0, maxSampleBlocks)
  return sampleBlocks.length > 0 
    ? `

**SPATIAL LAYOUT DATA** (Sample for Context Only):
Below are ${maxSampleBlocks} representative text blocks from ${spatialBlocks.length} total blocks. These are provided as CONTEXT ONLY to help you understand text sizes and layout patterns. DO NOT create a field for every block listed here. Instead, use this spatial information to inform your classification when identifying form fields from the OCR TEXT below.

${sampleBlocks.map(b => 
  `Block ${b.index}: "${b.text.substring(0, 60)}${b.text.length > 60 ? '...' : ''}" at (x:${b.x}, y:${b.y}, w:${b.width}, h:${b.height})`
).join('\n')}
...(${spatialBlocks.length - maxSampleBlocks} more blocks exist but omitted here for brevity)

**SPATIAL CLASSIFICATION RULES**:

1. **Form Titles/Main Headers**: 
   - Large height (typically >25px) OR large width (>400px)
   - Near top of page (low y-value, typically <200)
   - All caps or title case, no colon at end
   → Create label field with <h1> tag

2. **Section Headers**:
   - Medium-large height (typically 18-25px)
   - Standalone text with semantic meaning (e.g., "APPLICANT DETAILS", "Contact Information", "Part I")
   - No colon at end, not followed immediately by input
   → Create label field with <h2> tag

3. **Instructions/Legal Text/Disclaimers**:
   - Multi-line (large height >40px) OR long text (>100 chars)
   - Explanatory content (e.g., "Disclaimer:", "Before you begin", "Under penalties of perjury")
   - Not a field label
   → Create label field with <p> tag or <h3> tag if shorter

4. **Field Labels**:
   - Typically ends with ":" (e.g., "First Name:", "Address:")
   - Small-medium height (12-20px)
   - Followed by input area (next block at similar y-coord or slightly below)
   → Use as label for input field (remove the ":" from label)

5. **Field Options/Checkboxes**:
   - Contains ☐, ☑, or multiple choices separated by spaces
   - Part of a parent field (e.g., "Gender: ☐ Male ☐ Female ☐ Other")
   → Include as options array in the field

6. **Horizontal Grouping**:
   - Fields at similar y-coordinates (within 10px) are on the same row
   - Create separate fields but note they're visually grouped

7. **Numbered Fields**:
   - Start with number (e.g., "1 Name of entity", "3a Check the box")
   - Number is part of label, keep it

**⚠️ IMPORTANT - FIELD IDENTIFICATION STRATEGY**:
The spatial blocks above are REFERENCE DATA for understanding layout patterns (text sizes, positions). 
When identifying form fields, work from the OCR TEXT below, NOT from the spatial block list.
Use spatial data to INFORM your classification decisions (is this text a header? a label? an instruction?), but do NOT create a field for every spatial block shown above.
Focus on identifying the form's input fields (text boxes, checkboxes, radios) and structural elements (titles, section headers, instructions) from the OCR text.

**CRITICAL LABEL EXAMPLES**:

Example 1 - Form Title (Block 1: "APPLICATION FORM" at y:225, h:30):
{
  "label": "",
  "type": "label",
  "richTextContent": "<h1>APPLICATION FORM</h1>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.98,
  "pageNumber": 1
}

Example 2 - Section Header (Block 4: "CONTACT INFORMATION" at y:433, h:23):
{
  "label": "",
  "type": "label",
  "richTextContent": "<h2>CONTACT INFORMATION</h2>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.95,
  "pageNumber": 1
}

Example 3 - Instructions (Block 2: "Please complete all sections..." at y:302, h:89):
{
  "label": "",
  "type": "label",
  "richTextContent": "<p>Please complete all sections of this form. Fields marked with an asterisk (*) are required...</p>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.90,
  "pageNumber": 1
}

**IMPORTANT**:
- Use spatial proximity (x, y coordinates) to understand field relationships
- Use height to distinguish titles/headers (large) from regular fields (small)
- Sort ALL fields (label AND input) by y-coordinate - DO NOT separate label and input fields
- Mix label and input fields in the order they appear vertically on the page
- DO NOT skip titles, headers, or instructions - they are essential for form structure
`
    : ''
}

// Update system message with batch context
function updateSystemMessageForBatch(systemMessage, batchPages, totalPages) {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error('totalPages must be a positive integer')
  }
  if (!Array.isArray(batchPages) || batchPages.length === 0) {
    throw new Error('batchPages must be a non-empty array')
  }
  const pageRange = batchPages.length === 1 
    ? `page ${batchPages[0]}` 
    : `pages ${batchPages[0]}-${batchPages[batchPages.length-1]}`
  const batchContext = `\n\n**BATCH CONTEXT**: You are analyzing ${pageRange} of ${totalPages} total pages. Extract fields only from these pages. Ensure all extracted fields have pageNumber set to one of: ${batchPages.join(', ')}.`
  return systemMessage + batchContext
}

// JSON Repair Function - Extracted for reuse
const ENABLE_JSON_REPAIR = true  // Set to false to disable JSON repair

const repairJsonSyntax = (jsonString, options = {}) => {
  const {
    enableRepair = ENABLE_JSON_REPAIR,
    logRepairs = true,
    repairSteps = {
      removeComments: true,
      fixMissingQuotes: true,
      fixMissingColonValue: true,
      fixMissingCommas: true,
      fixTrailingCommas: true,
      fixSingleQuotes: true
    }
  } = options

  // Early return if disabled
  if (!enableRepair) {
    if (logRepairs) {
      console.log('🔧 JSON Repair: DISABLED (skipping repair)')
    }
    return jsonString
  }

  let cleaned = jsonString
  const appliedRepairs = []

  // STEP 1: Remove Comments
  if (repairSteps.removeComments) {
    const before = cleaned
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
    cleaned = cleaned.replace(/([^:])\/\/[^\n]*/g, '$1')
    if (before !== cleaned) {
      appliedRepairs.push('removeComments')
    }
  }

  // STEP 2: Fix Missing Quotes Before Property Names
  if (repairSteps.fixMissingQuotes) {
    const before = cleaned
    cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\":/g, (match, prefix, propName, offset) => {
      const beforePropName = cleaned.substring(0, offset + prefix.length)
      const quoteCount = (beforePropName.match(/"/g) || []).length
      const propNameStart = offset + prefix.length
      const charBeforeProp = propNameStart > 0 ? cleaned[propNameStart - 1] : ''
      const isAlreadyQuoted = charBeforeProp === '"'
      
      if (quoteCount % 2 === 0 && !isAlreadyQuoted) {
        return `${prefix}"${propName}":`
      }
      return match
    })
    if (before !== cleaned) {
      appliedRepairs.push('fixMissingQuotes')
    }
  }

  // STEP 3: Fix Missing Colon/Value Pattern
  // Match property names in object contexts, NOT array values
  // Fixes: { "propertyName", and { "prop1": "value", "prop2",
  // Avoids: ["Yes", "No", (array values)
  if (repairSteps.fixMissingColonValue) {
    const before = cleaned
    // Strategy: Match "propertyName", in two contexts:
    // 1. After { (object start): { "prop",
    // 2. After , that follows an object property value (not array element)
    //    We match after: "value", "prop", OR }, "prop", OR number/boolean/null, "prop",
    //    But NOT ], "prop", (to avoid array values)
    
    // Pattern 1: { "propertyName",
    cleaned = cleaned.replace(/\{\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,(\s*)(?="|{|\[|\n|$)/g, '{ "$1": "",$2')
    
    // Pattern 2: , "propertyName", after a value that's an object property
    // Match after: "string", "prop", OR }, "prop", OR number/boolean/null, "prop",
    // Exclude: ], "prop", (array end) - we explicitly don't match after ]
    // We match the value pattern before the comma to ensure context
    // Note: ["}] matches ", }, but NOT ] (] closes the class, so it's not included)
    // For numbers, we match digits (including decimals and negatives)
    cleaned = cleaned.replace(/(["}]|-?\d+\.?\d*|true|false|null)\s*,\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,(\s*)(?="|{|\[|\n|$)/g, '$1, "$2": "",$3')
    
    if (before !== cleaned) {
      appliedRepairs.push('fixMissingColonValue')
    }
  }

  // STEP 4: Fix Missing Commas
  if (repairSteps.fixMissingCommas) {
    const before = cleaned
    cleaned = cleaned.replace(/(["\}\]\d])\s*("[\w_][\w\d_]*"\s*:)/g, '$1, $2')
    if (before !== cleaned) {
      appliedRepairs.push('fixMissingCommas')
    }
  }

  // STEP 5: Fix Trailing Commas
  if (repairSteps.fixTrailingCommas) {
    const before = cleaned
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1')
    if (before !== cleaned) {
      appliedRepairs.push('fixTrailingCommas')
    }
  }

  // STEP 6: Fix Single Quotes to Double Quotes
  if (repairSteps.fixSingleQuotes) {
    const before = cleaned
    cleaned = cleaned.replace(/'([^']*)':/g, '"$1":')
    if (before !== cleaned) {
      appliedRepairs.push('fixSingleQuotes')
    }
  }

  // Log repairs if enabled
  if (logRepairs && appliedRepairs.length > 0) {
    console.log(`🔧 JSON Repair applied: ${appliedRepairs.join(', ')}`)
  } else if (logRepairs && enableRepair) {
    console.log('🔧 JSON Repair: No repairs needed (JSON was valid)')
  }

  // Validate repaired JSON (don't throw, just log warning)
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch (validationError) {
    if (logRepairs) {
      console.warn(`⚠️ JSON Repair: Repaired JSON is still invalid after all steps: ${validationError.message}`)
    }
    return cleaned // Return anyway, fallback extraction will try to handle
  }
}

// Merge batch results into single array with statistics
function mergeBatchResults(batchResults, totalPages) {
  if (!Array.isArray(batchResults)) {
    throw new Error('batchResults must be an array')
  }
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error('totalPages must be a positive integer')
  }
  // Flatten all batch results
  const allFields = batchResults.flat()
  const totalFieldsBeforeMerge = allFields.length
  
  // Track statistics
  let invalidFieldsFiltered = 0
  
  // Validate and filter fields
  const validFields = allFields.filter(field => {
    // Check for required properties
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      invalidFieldsFiltered++
      return false
    }
    
    // Validate pageNumber
    if (!field.pageNumber || field.pageNumber < 1 || field.pageNumber > totalPages) {
      console.warn(`⚠️ Invalid pageNumber ${field.pageNumber} in field, filtering out`)
      invalidFieldsFiltered++
      return false
    }
    
    // Validate required properties based on field type
    if (field.type === 'label') {
      if (!field.richTextContent) {
        console.warn('⚠️ Label field missing richTextContent, filtering out')
        invalidFieldsFiltered++
        return false
      }
    } else {
      if (!field.type) {
        console.warn('⚠️ Input field missing type, filtering out')
        invalidFieldsFiltered++
        return false
      }
    }
    
    return true
  })
  
  // Sort by pageNumber (ascending), preserve Groq's order within each page
  // Create a copy to avoid mutating the original array
  const sortedFields = [...validFields].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber
    }
    // Same page - preserve original order (Groq already sorted by y-coordinate)
    return 0
  })
  
  const mergeStats = {
    invalidFieldsFiltered,
    totalFieldsBeforeMerge,
    totalFieldsAfterMerge: sortedFields.length
  }
  
  return { fields: sortedFields, mergeStats }
}

// Process a single batch - returns { fields, analytics }
// Note: reasoningEffortLevel is passed directly (already parsed in main flow)
async function processBatch(batch, spatialBlocksForBatch, systemMessage, reasoningEffortLevel, userMessage, totalPages) {
  const batchStartTime = Date.now()
  const batchPages = batch.map(b => b.page)
  
  // Combine OCR text for batch pages only
  const combinedText = batch
    .map((result) => `=== PAGE ${result.page} ===\n${result.text}`)
    .join('\n\n')
  
  // Build spatial context hint for this batch
  const spatialContextHint = buildSpatialContextHint(spatialBlocksForBatch)
  if (spatialBlocksForBatch.length === 0) {
    console.warn(`⚠️ Batch (pages ${batchPages.join(',')}) - No spatial blocks found for this batch`)
  }
  
  // Build user message with batch context
  const pageRange = batchPages.length === 1 
    ? `page ${batchPages[0]}` 
    : `pages ${batchPages[0]}-${batchPages[batchPages.length-1]}`
  
  let groqUserMessage = `Analyze this OCR text from ${pageRange} of ${totalPages} total pages in a blank form template and identify BOTH:
1. Label fields (titles, section headers, instructions, legal text - display-only form text)
2. Input fields (text, email, phone, checkboxes, etc.)

OCR TEXT:
${combinedText}

🚨 CRITICAL: Return fields in STRICT TOP-TO-BOTTOM ORDER based on y-coordinates from the spatial data above. Sort by y-coordinate (vertical position), NOT by field type or OCR text order. Lower y-value = higher on page = appears first in your output array.

**OUTPUT FORMAT**: Return ONLY a valid JSON array. Do NOT include any explanation, reasoning, or text outside the JSON array. Start with [ and end with ].`
  
  // If user provided additional context, append it
  if (userMessage) {
    groqUserMessage += `\n\nAdditional context: ${userMessage}`
  }
  
  // Build request body
  // Note: reasoningEffortLevel is already parsed in main flow, just use it directly
  
  const requestBody = {
    model: GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: systemMessage + spatialContextHint
      },
      {
        role: 'user',
        content: groqUserMessage
      }
    ],
    max_completion_tokens: 65536,
    temperature: 0.1
  }
  
  if (reasoningEffortLevel) {
    requestBody.reasoning_effort = reasoningEffortLevel
  }
  
  // Call Groq API with retry logic
  const context = `Batch (pages ${batchPages.join(',')}) - `
  const result = await callGroqWithRetry(requestBody, context)
  
  const { fields, groqUsage, groqTime, finishReason } = result
  
  if (fields.length === 0) {
    console.warn(`⚠️ ${context}No fields extracted (may be valid for blank pages)`)
  } else {
    console.log(`✅ ${context}Extracted ${fields.length} fields`)
  }
  
  const analytics = {
    tokenUsage: groqUsage ? {
      prompt_tokens: groqUsage.prompt_tokens || groqUsage.input_tokens || null,
      completion_tokens: groqUsage.completion_tokens || groqUsage.output_tokens || null,
      total_tokens: groqUsage.total_tokens || null,
      reasoning_tokens: groqUsage.completion_tokens_details?.reasoning_tokens || null
    } : null,
    processingTime: groqTime,
    finishReason: finishReason,
    reasoningTokens: groqUsage?.completion_tokens_details?.reasoning_tokens || null
  }
  
  return { fields, analytics }
}

/**
 * POST /analyze-images
 * Analyze multiple images with Google Vision API (OCR) + Groq (field extraction)
 * Replaces GPT-4o Vision for better performance and cost
 */
router.post('/analyze-images', async (req, res) => {
  try {
    const { imageUrls, systemMessage, userMessage, useReasoningEffort, enableBatching, batchSize } = req.body

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Image URLs are required'
      })
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GROQ_API_KEY not configured in environment'
      })
    }

    console.log(`🔍 Processing ${imageUrls.length} images with Google Vision + Groq (${GROQ_MODEL})...`)

    // Parse and validate batching flags
    const shouldEnableBatching = enableBatching === true || enableBatching === 'true' || process.env.ENABLE_BATCHING === 'true'
    let batchSizeValue = batchSize || parseInt(process.env.BATCH_SIZE) || 5
    // Validate batchSizeValue - handle NaN and invalid values
    if (isNaN(batchSizeValue) || batchSizeValue < 1) batchSizeValue = 5  // Default to 5 if invalid
    if (batchSizeValue > imageUrls.length) batchSizeValue = imageUrls.length  // Don't exceed total pages

    if (shouldEnableBatching) {
      console.log(`📦 Batching enabled: ${batchSizeValue} pages per batch`)
    }

    // Initialize Vision client
    const visionClient = initializeVisionClient()

    // Step 1: Process all images with Google Vision API (in parallel)
    console.log('📄 Step 1: Processing images with Google Vision OCR...')
    const visionStartTime = Date.now()
    
    const visionResults = await Promise.all(
      imageUrls.map(async (imageUrl, index) => {
        const imageStartTime = Date.now()
        try {
          console.log(`📥 Fetching image ${index + 1}/${imageUrls.length}: ${imageUrl}`)
          const response = await fetch(imageUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const base64Content = buffer.toString('base64')
          
          console.log(`🔍 Calling Vision API for image ${index + 1}...`)
          const [result] = await visionClient.documentTextDetection({
            image: { content: base64Content }
          })

          const imageTime = Date.now() - imageStartTime
          const extractedText = result.fullTextAnnotation?.text || ''
          
          // Extract bounding box data for spatial analysis
          const pages = result.fullTextAnnotation?.pages || []
          const blocks = pages.flatMap(page => page.blocks || [])
          
          console.log(`✅ Image ${index + 1} processed in ${imageTime}ms (${extractedText.length} chars, ${blocks.length} blocks)`)
          
          return {
            page: index + 1,
            text: extractedText,
            blocks: blocks,
            processingTime: imageTime
          }
        } catch (error) {
          console.error(`❌ Error processing image ${index + 1}:`, error)
          throw error
        }
      })
    )

    const visionTotalTime = Date.now() - visionStartTime
    const totalCharacters = visionResults.reduce((sum, r) => sum + r.text.length, 0)

    console.log(`✅ All images processed in ${visionTotalTime}ms`)
    console.log(`📝 Total OCR text: ${totalCharacters} characters`)

    // Step 2: Format spatial layout data for LLM
    console.log('🔍 Formatting spatial layout data for LLM...')
    const allBlocks = visionResults.flatMap(r => r.blocks || [])
    console.log(`📦 Total blocks from Vision API: ${allBlocks.length}`)
    
    // Format blocks with spatial information for LLM - CRITICAL: Include pageNumber for batching
    const spatialBlocks = visionResults.flatMap((result, pageIndex) => {
      const pageNumber = result.page
      return (result.blocks || []).map((block, blockIndex) => {
      const text = getBlockText(block).trim()
      const box = block.boundingBox
      
      if (box && box.vertices && box.vertices.length >= 4) {
        const topLeft = box.vertices[0]
        const bottomRight = box.vertices[2]
        const width = bottomRight.x - topLeft.x
        const height = Math.abs(bottomRight.y - topLeft.y)  // Use abs() to handle negative heights
        
        return {
            index: blockIndex + 1,
            pageNumber: pageNumber,  // CRITICAL: Add page number for batch filtering
          text: text,
          x: topLeft.x,
          y: topLeft.y,
          width: width,
          height: height
        }
      }
      
      return null
      })
    }).filter(b => b !== null && b.text.length > 0)  // Remove null entries and empty text
    
    console.log(`📊 Formatted ${spatialBlocks.length} blocks with spatial data for LLM`)
    
    // Log first 5 blocks as sample
    console.log('📍 Sample spatial blocks:')
    spatialBlocks.slice(0, 5).forEach(b => {
      console.log(`  [${b.index}] "${b.text.substring(0, 40)}" at (x:${b.x}, y:${b.y}, w:${b.width}, h:${b.height})`)
    })

    // Build default system message (used by both batching and single-request flows)
    const defaultSystemMessage = (systemMessage || `You are a form structure analysis expert. You will receive OCR TEXT from blank PDF form templates (not filled forms) along with SPATIAL LAYOUT DATA.

**YOUR TASK**: Analyze the text AND spatial data to identify the form's structure and create a digital version:
1. **Input fields** (text boxes, email fields, phone numbers, checkboxes, etc.) - where users will enter data
2. **Label fields** (titles, section headers, instructions, legal text) - for display/organization

**IMPORTANT CONTEXT - NO PRIVACY OR CLINICAL CONCERNS**:
- You are analyzing BLANK FORM TEMPLATES to understand their structure, not extracting personal data
- The OCR text contains placeholder/example data (like "John Doe", "123 Main St") that is part of the form template itself
- This is NOT patient information, personal data, or clinical advice - it's structural analysis of blank forms
- Your task is to identify form fields and structure, not to extract or analyze any personal information
- There is no privacy concern, no HIPAA concern, and no clinical advice being requested
- You are simply analyzing the layout and structure of a blank form template

**CRITICAL**: You must identify BOTH label fields (for display) AND input fields (for data entry). Do NOT skip titles, headers, or instructions - they are essential for form structure.

**IMPORTANT**: You are analyzing a BLANK FORM TEMPLATE to understand its structure, not extracting data from a filled form. Do NOT skip titles, headers, or instructions. These must be included as label fields to preserve the form structure.`)

    // Parse reasoningEffortLevel (used by both batching and single-request flows)
    let reasoningEffortLevel = null
    if (useReasoningEffort !== undefined) {
      if (useReasoningEffort === false) {
        reasoningEffortLevel = null  // Baseline - no parameter
      } else if (typeof useReasoningEffort === 'string') {
        // Direct level specified: "low", "medium", "high"
        reasoningEffortLevel = useReasoningEffort
      } else if (useReasoningEffort === true) {
        // Default to "low" if true
        reasoningEffortLevel = "low"
      }
    } else if (process.env.USE_REASONING_EFFORT) {
      // Environment variable can be: "false", "low", "medium", "high"
      if (process.env.USE_REASONING_EFFORT === 'false') {
        reasoningEffortLevel = null
      } else {
        reasoningEffortLevel = process.env.USE_REASONING_EFFORT
      }
    }
    
    // When batching is enabled, default to "low" reasoning effort if not explicitly set
    // This minimizes reasoning token consumption which can cause token limit issues
    if (shouldEnableBatching && reasoningEffortLevel === null) {
      reasoningEffortLevel = "low"
      console.log('🔧 Batching enabled: Setting reasoning_effort to "low" to minimize token usage')
    }

    // Step 3: Process with batching or single request
    let fields = []
    let analytics = {
      visionApi: {
        time: visionTotalTime,
        totalCharacters: totalCharacters,
        pages: visionResults.map(r => ({
          page: r.page,
          time: r.processingTime,
          characters: r.text.length
        }))
      },
      totalTime: Date.now() - visionStartTime
    }

    if (shouldEnableBatching) {
      // BATCHING MODE
      console.log(`📦 Processing ${imageUrls.length} pages in batches of ${batchSizeValue}...`)
      const batches = splitIntoBatches(visionResults, batchSizeValue)
      const batchResults = []
      const batchErrors = []
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const batchPages = batch.map(b => b.page)
        try {
          console.log(`\n🔄 Processing batch ${i + 1}/${batches.length} (pages ${batchPages.join(', ')})...`)
          
          const spatialBlocksForBatch = filterSpatialBlocksForBatch(spatialBlocks, batchPages)
          const batchSystemMessage = updateSystemMessageForBatch(defaultSystemMessage, batchPages, imageUrls.length)
          
          // Process batch - returns { fields, analytics }
          const { fields: batchFields, analytics: batchAnalytics } = await processBatch(
            batch, 
            spatialBlocksForBatch, 
            batchSystemMessage, 
            reasoningEffortLevel,
            userMessage,
            imageUrls.length
          )
          
          batchResults.push({ 
            batchIndex: i, 
            fields: batchFields, 
            pages: batchPages,
            tokenUsage: batchAnalytics.tokenUsage,
            processingTime: batchAnalytics.processingTime,
            finishReason: batchAnalytics.finishReason,
            reasoningTokens: batchAnalytics.reasoningTokens
          })
          
          console.log(`✅ Batch ${i + 1}/${batches.length} completed: ${batchFields.length} fields extracted`)
        } catch (error) {
          console.error(`❌ Batch ${i + 1}/${batches.length} (pages ${batchPages.join(',')}) failed:`, error.message)
          console.error('❌ Full error:', error)
          batchErrors.push({ 
            batchIndex: i, 
            pages: batchPages,
            error: error.message,
            stack: error.stack 
          })
          // Continue with next batch
        }
      }
      
      // Check if we have any successful batches
      if (batchResults.length === 0) {
        throw new Error('All batches failed to process')
      }
      
      // Merge all batch results - returns { fields, mergeStats }
      const { fields: mergedFields, mergeStats } = mergeBatchResults(
        batchResults.map(r => r.fields), 
        imageUrls.length
      )
      fields = mergedFields
      
      // If some batches failed, mark as partial results
      const hasPartialResults = batchErrors.length > 0 && batchResults.length > 0
      
      // Update analytics with batch info
      analytics.batching = {
        enabled: true,
        batchCount: batches.length,
        batchSize: batchSizeValue,
        successfulBatches: batchResults.length,
        failedBatches: batchErrors.length,
        partialResults: hasPartialResults,
        batchResults: batchResults.map(r => ({
          batchIndex: r.batchIndex,
          pages: r.pages,
          fieldCount: r.fields.length,
          tokenUsage: r.tokenUsage,
          processingTime: r.processingTime,
          finishReason: r.finishReason,
          reasoningTokens: r.reasoningTokens
        })),
        batchErrors: batchErrors.length > 0 ? batchErrors : undefined,
        mergeStats: mergeStats
      }
      
      // Aggregate token usage across all batches
      const totalTokens = batchResults.reduce((sum, r) => {
        return sum + (r.tokenUsage?.total_tokens || 0)
      }, 0)
      const totalPromptTokens = batchResults.reduce((sum, r) => {
        return sum + (r.tokenUsage?.prompt_tokens || 0)
      }, 0)
      const totalCompletionTokens = batchResults.reduce((sum, r) => {
        return sum + (r.tokenUsage?.completion_tokens || 0)
      }, 0)
      const totalReasoningTokens = batchResults.reduce((sum, r) => {
        return sum + (r.reasoningTokens || 0)
      }, 0)
      
      analytics.groqApi = {
        time: batchResults.reduce((sum, r) => sum + r.processingTime, 0),
        inputTokens: totalPromptTokens || null,
        outputTokens: totalCompletionTokens || null,
        totalTokens: totalTokens || null,
        finishReason: batchResults.every(r => r.finishReason === 'stop') ? 'stop' : 'mixed',
        reasoningTokens: totalReasoningTokens || null
      }
      
      console.log(`\n✅ Batching complete: ${fields.length} total fields from ${batchResults.length}/${batches.length} successful batches`)
      if (hasPartialResults) {
        console.warn(`⚠️ Partial results: ${batchErrors.length} batch(es) failed`)
      }
      analytics.totalTime = Date.now() - visionStartTime
    } else {
      // SINGLE REQUEST MODE (existing logic)
      // Step 3: Combine OCR text from all pages
      const combinedText = visionResults
        .map((result, index) => `=== PAGE ${result.page} ===\n${result.text}`)
        .join('\n\n')

      // Step 4: Send to Groq API for field identification
      console.log('🤖 Step 3: Sending OCR text to Groq API for field identification...')

      // Build spatial context for Groq using extracted function
      const spatialContextHint = buildSpatialContextHint(spatialBlocks)

    // Use provided system message or default (text-focused prompt for OCR analysis)
      // Note: defaultSystemMessage is already defined above, and we add spatialContextHint
      // The single-request flow uses a longer system message with more detailed instructions
      // (defaultSystemMessage already contains the basic task and privacy context, so we just add the extended instructions)
      const extendedSystemMessage = defaultSystemMessage + spatialContextHint + `

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields have similar text (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects. Examples:
- "Phone (Work)" and "Phone (Other, please specify)" must be separate fields, even if both are phone inputs
- Repeated "Yes/No" questions on different pages must each be separate fields
- "Current Address" vs "Mailing Address" must be separate fields even if both collect the same type of data

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ...", "If you have used..., do you feel...", and every table/row instruction as its OWN field, not just explanation. Even if the wording is short and appears to be a sub-clause, if it asks the user to provide information or choose an option, it must be a field.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options:
- Identify the main question label (the line that describes what is being asked)
- Attach ALL options for that question to a SINGLE field object in the "options" array
- Do NOT create separate fields for each option; they must be grouped under the main question
- CRITICAL: When the text contains Yes/No questions, ALWAYS include BOTH options. If the text shows "Yes" and "No, please mail it to my home address" or similar variations, include ALL of them in the options array. Search carefully in the OCR text - if a question has "Yes" mentioned, search for the corresponding "No" option even if it's on a different line or has additional text like "No, please mail it to my home address"
- If the text shows "Other: ______" below radio/checkboxes, set allowOther: true, otherLabel, and otherPlaceholder
- CRITICAL: When the text shows patterns like "(If yes) Full-time" and "(If yes) Part-time" under the same question, combine them into ONE field with label "If yes, Full-time/Part-time" (use forward slash, remove duplicate "If yes" prefix). Do NOT create separate fields for each option. Do NOT create duplicate fields - if the same field label appears multiple times, it should only be identified once.

**ROW-BASED STRUCTURES**: In tables or repeated rows (e.g. product lists, item tables, experience charts):
- If each row asks for user input (e.g. Item Name, Quantity, Date), treat each column that expects text as a separate field
- Include the question number or context in the label (e.g. "5. Item Name (row 1)", "5. Item Name (row 2)")
- Do NOT merge or deduplicate rows just because the column labels are the same

**LABEL DISAMBIGUATION**: When two fields share the same base label but refer to different people or contexts, include that context in the label:
- e.g. "Emergency Contact (Phone)" vs "Primary Contact (Phone)", "Secondary Contact (Phone)"
- e.g. "Employment Start Date (Current Job)" vs "Employment Start Date (Previous Job)" if both exist
- Prefer slightly longer, more specific labels over shorter generic ones to avoid collapsing distinct fields

For each field you identify, determine:

1. **Field Label**: The visible text label (exactly as shown). IMPORTANT: If a field is part of a numbered question (e.g., "2. Question text"), include the question number in the label (e.g., "2. Item Name" not just "Item Name"). Preserve the full context including question numbers when they appear before field labels. Remove trailing colons (":") from labels - they are formatting, not part of the label.

2. **Field Type**: Choose the most appropriate type based on what you find in the OCR text:
   
   **Common types from OCR:**
   - text: for single-line text inputs (names, addresses, single values). CRITICAL: If the OCR text shows a field label with a blank line or filled value underneath, treat it as type "text" - do NOT infer radio/select types from filled sample data. If the text shows "3. Gender" followed by a value like "Male", use type "text", NOT "select" or "radio"
   - email: for email address fields
   - tel: for phone/telephone number fields
   - number: for numeric inputs (age, quantity, ID numbers)
   - textarea: for large text areas, comments, messages, or multi-line inputs
   - select: ONLY when the OCR text shows multiple distinct options listed together (like "Yes", "No", "Maybe") indicating a dropdown or selection. Do NOT use "select" for fields that show only a single value
   - radio-with-other: when the OCR text shows multiple radio button options AND includes "Other:" with a text input
   - checkbox-with-other: when the OCR text shows multiple checkbox options AND includes "Other:" with a text input
   - date: for date picker fields (usually shown as mm/dd/yyyy or similar)
   - label: for display-only text (titles, section headers, instructions, legal disclaimers)
   
   **Advanced types** (rarely in scanned forms, use only if explicitly shown):
   - rating: for star ratings or scale (1-5, 1-10)
   - file: for file upload fields (rarely in scanned PDFs)
   - signature: for signature fields (usually shown as "Signature: ___________")
   - payment: for credit card, bank account, or payment information fields (e.g., "Card Number:", "Account Number:", "Routing Number:", "CVV:", "Expiration Date:")
   
   IMPORTANT: Do NOT infer field types from filled sample data in the OCR text. If a form field shows only a single value (even something like "Male"), use type "text", not "radio" or "select". Only use "select" or "radio" when the OCR text explicitly shows multiple choice options.

3. **Required Status**: Find text indicators in the OCR:
   - Asterisks (*) near field labels
   - "(required)" text
   - "(optional)" text (mark as not required)
   - Default to false if no indicator found

4. **Options Detection**: When the OCR text shows multiple choice options, identify ALL of them and group with the main question label:
   - CRITICAL: When you find Yes/No questions in the text, ALWAYS capture ALL options. If the text contains "Yes" and "No" or "Yes" and "No, please mail it to my home address", include ALL options in the array. Never drop the "No" option or its variations. Search the OCR text around the question - if you find "Yes", search for the corresponding "No" option even if it's on a different line or has additional text. If a question asks "is it OK to email statements to you?" and the text shows "Yes", you MUST also search for "No" or "No, please mail" - they are part of the same question's options.
   - CRITICAL: allowOther should ALWAYS be false by default
   - ONLY set allowOther: true if the OCR text clearly shows an "Other" option (with or without colon) AND a text input field or blank line for text entry
   - If the text shows "Other" (with or without colon) with an input field, set allowOther: true and use that as otherLabel
   - Do NOT add "Other" options to fields that don't have them in the OCR text
   - Most fields will have allowOther: false - only set to true when the text shows an actual "Other" with input capability
   - IMPORTANT: If you set allowOther: true, do NOT include ANY "Other" option in the options array - it should only be in otherLabel
   - Extract "Yes-Other" as a regular option, but ANY "Other" with text input should trigger allowOther: true
   - CRITICAL: When the text shows conditional options like "(If yes) Full-time" and "(If yes) Part-time" together under the same question, combine them into ONE field with label "If yes, Full-time/Part-time" and options ["Full-time", "Part-time"]. Do NOT create separate fields for each conditional option.

5. **Page Number**: IMPORTANT - Include the page number where each field is found

6. **Confidence**: Rate 0.0-1.0 how confident you are about this field

Return ONLY a JSON array with this exact structure:

**SUPPORTED FIELD TYPES**:
- **Common types** (from OCR): text, email, tel, number, textarea, select, date, radio-with-other, checkbox-with-other
- **Display types**: label (for titles/headers/instructions - display-only form text)
- **Advanced types** (rare): rating, file, signature, payment
- **Manual types** (not from OCR): image, calendly, richtext (user-editable rich content)

**FOR INPUT FIELDS** (text, email, phone, checkboxes, etc.):
[
  {
    "label": "First Name",
    "type": "text|email|tel|number|textarea|select|date|radio-with-other|checkbox-with-other|rating|file|signature|payment",
    "required": true/false,
    "placeholder": "Placeholder text if visible",
    "options": ["Option 1", "Option 2"] (for select/radio/checkbox/rating),
    "allowOther": true/false (ONLY true if the text shows "Other:" with text input),
    "otherLabel": "Other:" (ONLY if allowOther is true),
    "otherPlaceholder": "Please specify..." (ONLY if allowOther is true),
    "confidence": 0.95,
    "pageNumber": 1
  }
]

**FOR LABEL FIELDS** (titles, headers, instructions - display-only form text):
[
  {
    "label": "",
    "type": "label",
    "richTextContent": "<h1>APPLICATION FORM</h1>|<h2>Contact Information</h2>|<p>Please fill out this form completely...</p>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.95,
    "pageNumber": 1
  }
]

**CRITICAL FOR LABEL FIELDS**: 
- The "label" field MUST be an EMPTY STRING ("") for label fields
- The actual text content goes ONLY in "richTextContent" with proper HTML tags
- Do NOT put the text in both label and richTextContent
- Label fields are for display only - the content itself is what users see, not a label input

**NOTE**: Focus on common OCR-detectable types (text, email, tel, number, textarea, select, date, radio-with-other, checkbox-with-other, label). Advanced types (rating, file, signature, payment) are rare but supported if found in scanned forms.

**🚨 CRITICAL: OUTPUT ORDER - SORT BY Y-COORDINATE 🚨**:

You MUST return fields in STRICT VISUAL ORDER from top to bottom of the page. This means:

1. **Sort ALL fields (label AND input) by their y-coordinate value** (vertical position on the page)
2. **Lower y-value = higher on page = should appear FIRST in the array**
3. **Process the form from top to bottom**, not by field type or by the OCR text sequence

Example with y-coordinates:
- Block at y:150 ("PATIENT INFORMATION" header) → comes FIRST
- Block at y:192 ("LEGAL NAME:" label) → comes SECOND  
- Block at y:210 ("Last" input under Legal Name) → comes THIRD
- Block at y:212 ("First" input under Legal Name) → comes FOURTH
- Block at y:214 ("Middle" input under Legal Name) → comes FIFTH
- Block at y:247 ("ADDRESS:" label) → comes SIXTH
- Block at y:265 ("Street" input under Address) → comes SEVENTH

DO NOT group by section or field type. Return fields in the exact order they appear visually (top to bottom).

IMPORTANT: For most fields, allowOther should be false. Only set to true when the text clearly shows "Other:" with a text input field.

**COMPLETE EXAMPLE MIXING LABEL AND INPUT FIELDS**:
Given spatial data showing:
- Block 1: "REGISTRATION FORM" (y:225, h:30)
- Block 2: "Instructions: ..." (y:302, h:89)
- Block 3: "APPLICANT INFORMATION" (y:433, h:23)
- Block 4: "First Name:" (y:505, h:21)
- Block 5: "Last Name:" (y:506, h:19)

Correct output (mixed, in visual order BY Y-COORDINATE):
[
  {
    "label": "",
    "type": "label",
    "richTextContent": "<h1>REGISTRATION FORM</h1>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.98,
    "pageNumber": 1
  },
  {
    "label": "",
    "type": "label",
    "richTextContent": "<p>Instructions: Please complete all fields below</p>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.90,
    "pageNumber": 1
  },
  {
    "label": "",
    "type": "label",
    "richTextContent": "<h2>APPLICANT INFORMATION</h2>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.95,
    "pageNumber": 1
  },
  {
    "label": "First Name",
    "type": "text",
    "required": false,
    "placeholder": "",
    "options": [],
    "allowOther": false,
    "otherLabel": "",
    "otherPlaceholder": "",
    "confidence": 0.97,
    "pageNumber": 1
  },
  {
    "label": "Last Name",
    "type": "text",
    "required": false,
    "placeholder": "",
    "options": [],
    "allowOther": false,
    "otherLabel": "",
    "otherPlaceholder": "",
    "confidence": 0.97,
    "pageNumber": 1
  }
]

**CRITICAL**: 
- Label fields do NOT need: placeholder, options, allowOther, otherLabel, otherPlaceholder
- Input fields MUST have ALL fields even if empty: placeholder, options, allowOther, otherLabel, otherPlaceholder

**OPTIONS DETECTION EXAMPLE**: If the text contains options like:
- "No"
- "Yes-Option A" 
- "Yes-Option B"
- "Yes-Other"
- "Other:" (with text input field)

The correct output should be:
{
  "options": ["No", "Yes-Option A", "Yes-Option B", "Yes-Other"],
  "allowOther": true,
  "otherLabel": "Other:",
  "otherPlaceholder": "Please specify..."
}

Notice: "Other:" is NOT in the options array because it's handled by allowOther: true`

    // Build user message with OCR text
    // IMPORTANT: Always include the OCR text, even if userMessage is provided
    let groqUserMessage = `Analyze this OCR text from a blank form template and identify BOTH:
1. Label fields (titles, section headers, instructions, legal text - display-only form text)
2. Input fields (text, email, phone, checkboxes, etc.)

OCR TEXT:
${combinedText}

🚨 CRITICAL: Return fields in STRICT TOP-TO-BOTTOM ORDER based on y-coordinates from the spatial data above. Sort by y-coordinate (vertical position), NOT by field type or OCR text order. Lower y-value = higher on page = appears first in your output array.

**OUTPUT FORMAT**: Return ONLY a valid JSON array. Do NOT include any explanation, reasoning, or text outside the JSON array. Start with [ and end with ].`
    
    // If user provided additional context, append it
    if (userMessage) {
      groqUserMessage += `\n\nAdditional context: ${userMessage}`
    }

    // Build request body
    // Note: reasoningEffortLevel is already defined above (shared with batching flow)
    const requestBody = {
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
          content: extendedSystemMessage
          },
          {
            role: 'user',
            content: groqUserMessage
          }
        ],
        max_completion_tokens: 65536,
        temperature: 0.1
    }
    
    // Add reasoning_effort if specified
    if (reasoningEffortLevel) {
      requestBody.reasoning_effort = reasoningEffortLevel
      console.log(`🔧 Using reasoning_effort: "${reasoningEffortLevel}"`)
    } else {
      console.log('🔧 NOT using reasoning_effort parameter (baseline test)')
    }
    
    // Note: Removed response_format - Groq doesn't support it and it was causing 400 errors
    // Prompt explicitly requests JSON array output
    
    // Call Groq API with retry logic
    const result = await callGroqWithRetry(requestBody, '')
    ({ fields, groqUsage, groqTime, finishReason, groqData } = result)
    
    console.log(`✅ Groq API completed in ${groqTime}ms`)
    console.log(`🔍 [DEBUG] Fields from callGroqWithRetry: ${fields?.length || 0} fields`)
    if (fields && fields.length > 0) {
      console.log(`🔍 [DEBUG] First field sample:`, JSON.stringify(fields[0], null, 2))
    } else {
      console.log(`⚠️ [DEBUG] Fields array is empty or undefined!`)
      console.log(`🔍 [DEBUG] Fields type:`, typeof fields, Array.isArray(fields))
    }
    if (groqUsage) {
      console.log('📊 [DEBUG][Groq] Actual token usage:', JSON.stringify(groqUsage, null, 2))
    } else {
      console.log('📊 [DEBUG][Groq] No usage field returned in response')
    }
    
    console.log(`🏁 Groq finish_reason: ${finishReason}`)
    
    if (finishReason === 'length') {
      console.warn('⚠️ WARNING: Groq response was truncated due to max_completion_tokens limit!')
      console.warn('⚠️ Consider reducing form complexity or increasing token limit')
    }

    // Check if reasoning mode is accidentally enabled (should be disabled)
    const choice = groqData.choices?.[0]
    if (choice?.message?.reasoning) {
      console.warn('⚠️ WARNING: Reasoning mode detected - this should be disabled!')
      const reasoningLength = typeof choice.message.reasoning === 'string' 
        ? choice.message.reasoning.length 
        : JSON.stringify(choice.message.reasoning).length
      console.warn('⚠️ Reasoning field length:', reasoningLength, 'characters')
      console.warn('⚠️ Reasoning mode may be enabled by default for this model - consider using a different model or contact Groq support')
    }

    // Add id field for frontend compatibility
    fields = fields.map((field, index) => ({
      id: field.id || `field_${Date.now()}_${index}`,
      ...field
    }))

    console.log(`✅ Successfully extracted ${fields.length} fields (with ids)`)

    // Update analytics object with Groq API data
    analytics.groqApi = {
      time: groqTime,
      inputTokens: groqUsage?.prompt_tokens || groqUsage?.input_tokens || null,
      outputTokens: groqUsage?.completion_tokens || groqUsage?.output_tokens || null,
      totalTokens: groqUsage?.total_tokens || null,
      finishReason: finishReason,
      reasoningTokens: groqUsage?.completion_tokens_details?.reasoning_tokens || null
    }
    analytics.totalTime = Date.now() - visionStartTime
    } // Close else block for single-request mode

    // Update totalTime if not already set (should be set in both branches, but just in case)
    if (!analytics.totalTime) {
      analytics.totalTime = Date.now() - visionStartTime
    }

    return res.json({
      success: true,
      fields: fields,
      imagesAnalyzed: imageUrls.length,
      analytics: analytics
    })

  } catch (error) {
    console.error('❌ Image analysis error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Image analysis failed'
    })
  }
})

module.exports = router

