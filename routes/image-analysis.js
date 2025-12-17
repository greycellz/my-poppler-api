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
 * POST /analyze-images
 * Analyze multiple images with Google Vision API (OCR) + Groq (field extraction)
 * Replaces GPT-4o Vision for better performance and cost
 */
router.post('/analyze-images', async (req, res) => {
  try {
    const { imageUrls, systemMessage, userMessage } = req.body

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
    
    // Format blocks with spatial information for LLM
    const spatialBlocks = allBlocks.map((block, idx) => {
      const text = getBlockText(block).trim()
      const box = block.boundingBox
      
      if (box && box.vertices && box.vertices.length >= 4) {
        const topLeft = box.vertices[0]
        const bottomRight = box.vertices[2]
        const width = bottomRight.x - topLeft.x
        const height = Math.abs(bottomRight.y - topLeft.y)  // Use abs() to handle negative heights
        
        return {
          index: idx + 1,
          text: text,
          x: topLeft.x,
          y: topLeft.y,
          width: width,
          height: height
        }
      }
      
      return null
    }).filter(b => b !== null && b.text.length > 0)  // Remove null entries and empty text
    
    console.log(`📊 Formatted ${spatialBlocks.length} blocks with spatial data for LLM`)
    
    // Log first 5 blocks as sample
    console.log('📍 Sample spatial blocks:')
    spatialBlocks.slice(0, 5).forEach(b => {
      console.log(`  [${b.index}] "${b.text.substring(0, 40)}" at (x:${b.x}, y:${b.y}, w:${b.width}, h:${b.height})`)
    })

    // Step 3: Combine OCR text from all pages
    const combinedText = visionResults
      .map((result, index) => `=== PAGE ${result.page} ===\n${result.text}`)
      .join('\n\n')

    // Step 4: Send to Groq API for field identification
    console.log('🤖 Step 3: Sending OCR text to Groq API for field identification...')
    const groqStartTime = Date.now()

    // Build spatial context for Groq
    // Only send first 50 blocks as representative examples (not exhaustive list)
    const maxSampleBlocks = 50
    const sampleBlocks = spatialBlocks.slice(0, maxSampleBlocks)
    const spatialContextHint = sampleBlocks.length > 0 
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
   → Create richtext field with <h1> tag

2. **Section Headers**:
   - Medium-large height (typically 18-25px)
   - Standalone text with semantic meaning (e.g., "APPLICANT DETAILS", "Contact Information", "Part I")
   - No colon at end, not followed immediately by input
   → Create richtext field with <h2> tag

3. **Instructions/Legal Text/Disclaimers**:
   - Multi-line (large height >40px) OR long text (>100 chars)
   - Explanatory content (e.g., "Disclaimer:", "Before you begin", "Under penalties of perjury")
   - Not a field label
   → Create richtext field with <p> tag or <h3> tag if shorter

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

**CRITICAL RICHTEXT EXAMPLES**:

Example 1 - Form Title (Block 1: "APPLICATION FORM" at y:225, h:30):
{
  "label": "APPLICATION FORM",
  "type": "richtext",
  "richTextContent": "<h1>APPLICATION FORM</h1>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.98,
  "pageNumber": 1
}

Example 2 - Section Header (Block 4: "CONTACT INFORMATION" at y:433, h:23):
{
  "label": "CONTACT INFORMATION",
  "type": "richtext",
  "richTextContent": "<h2>CONTACT INFORMATION</h2>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.95,
  "pageNumber": 1
}

Example 3 - Instructions (Block 2: "Please complete all sections..." at y:302, h:89):
{
  "label": "Please complete all sections of this form. Fields marked with an asterisk (*) are required...",
  "type": "richtext",
  "richTextContent": "<p>Please complete all sections of this form. Fields marked with an asterisk (*) are required...</p>",
  "richTextMaxHeight": 0,
  "required": false,
  "confidence": 0.90,
  "pageNumber": 1
}

**IMPORTANT**:
- Use spatial proximity (x, y coordinates) to understand field relationships
- Use height to distinguish titles/headers (large) from regular fields (small)
- Consider vertical ordering (y-coord) for proper field sequence
- CREATE RICHTEXT FIELDS FIRST (in order of y-coord), then input fields
- DO NOT skip titles, headers, or instructions - they are essential for form structure
`
      : ''

    // Use provided system message or default (text-focused prompt for OCR analysis)
    const defaultSystemMessage = (systemMessage || `You are a form structure analysis expert. You will receive OCR TEXT from blank PDF form templates (not filled forms) along with SPATIAL LAYOUT DATA.

**YOUR TASK**: Analyze the text AND spatial data to identify the form's structure and create a digital version:
1. **Input fields** (text boxes, email fields, phone numbers, checkboxes, etc.) - where users will enter data
2. **Richtext fields** (titles, section headers, instructions, legal text) - for display/organization

IMPORTANT: You are analyzing a BLANK FORM TEMPLATE to understand its structure, not extracting data from a filled form. Do NOT skip titles, headers, or instructions. These must be included as richtext fields to preserve the form structure.`) + spatialContextHint + `

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
   - richtext: for display-only text (titles, section headers, instructions, legal disclaimers)
   
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
- **Display types**: richtext (for titles/headers/instructions)
- **Advanced types** (rare): rating, file, signature, payment
- **Manual types** (not from OCR): image, calendly

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

**FOR RICHTEXT FIELDS** (titles, headers, instructions):
[
  {
    "label": "The actual text content (e.g., 'APPLICATION FORM', 'Contact Information', 'Please fill out this form completely...')",
    "type": "richtext",
    "richTextContent": "<h1>Title</h1>|<h2>Header</h2>|<p>Instructions...</p>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.95,
    "pageNumber": 1
  }
]

**IMPORTANT FOR RICHTEXT**: The "label" field should contain the ACTUAL TEXT CONTENT from the form, not generic descriptions like "Form Title" or "Section Header". Identify the real text and use it as the label.

**NOTE**: Focus on common OCR-detectable types (text, email, tel, number, textarea, select, date, radio-with-other, checkbox-with-other, richtext). Advanced types (rating, file, signature, payment) are rare but supported if found in scanned forms.

**OUTPUT ORDER**: Create fields in VISUAL ORDER (sorted by y-coordinate):
1. Form titles/headers first (top of page)
2. Section headers in order
3. Input fields in order
4. Mix richtext and input fields based on their position

IMPORTANT: For most fields, allowOther should be false. Only set to true when the text clearly shows "Other:" with a text input field.

**COMPLETE EXAMPLE MIXING RICHTEXT AND INPUT FIELDS**:
Given spatial data showing:
- Block 1: "REGISTRATION FORM" (y:225, h:30)
- Block 2: "Instructions: ..." (y:302, h:89)
- Block 3: "APPLICANT INFORMATION" (y:433, h:23)
- Block 4: "First Name:" (y:505, h:21)
- Block 5: "Last Name:" (y:506, h:19)

Correct output (mixed, in visual order):
[
  {
    "label": "REGISTRATION FORM",
    "type": "richtext",
    "richTextContent": "<h1>REGISTRATION FORM</h1>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.98,
    "pageNumber": 1
  },
  {
    "label": "Instructions: Please complete all fields below",
    "type": "richtext",
    "richTextContent": "<p>Instructions: Please complete all fields below</p>",
    "richTextMaxHeight": 0,
    "required": false,
    "confidence": 0.90,
    "pageNumber": 1
  },
  {
    "label": "APPLICANT INFORMATION",
    "type": "richtext",
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
- Richtext fields do NOT need: placeholder, options, allowOther, otherLabel, otherPlaceholder
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
1. Richtext fields (titles, section headers, instructions, legal text)
2. Input fields (text, email, phone, checkboxes, etc.)

OCR TEXT:
${combinedText}

Identify ALL form elements in visual order (top to bottom based on y-coordinates from spatial data). Include both richtext fields for display AND input fields where users will enter data.`
    
    // If user provided additional context, append it
    if (userMessage) {
      groqUserMessage += `\n\nAdditional context: ${userMessage}`
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: defaultSystemMessage
          },
          {
            role: 'user',
            content: groqUserMessage
          }
        ],
        max_completion_tokens: 65536,  // Increased for complex forms with many fields
        temperature: 0.1
      })
    })

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json().catch(() => ({}))
      throw new Error(`Groq API error: ${groqResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    const groqData = await groqResponse.json()
    const groqTime = Date.now() - groqStartTime

    console.log(`✅ Groq API completed in ${groqTime}ms`)

    // Parse Groq response
    const choice = groqData.choices?.[0]
    if (!choice) {
      throw new Error('No response from Groq API')
    }

    // Check if response was truncated due to token limit
    const finishReason = choice.finish_reason
    console.log(`🏁 Groq finish_reason: ${finishReason}`)
    if (finishReason === 'length') {
      console.warn('⚠️ WARNING: Groq response was truncated due to max_completion_tokens limit!')
      console.warn('⚠️ Consider reducing form complexity or increasing token limit')
    }

    const responseText = choice.message?.content || ''
    
    // Log response for debugging
    console.log('🔍 Groq Response Length:', responseText.length)
    console.log('🔍 Groq Response (first 500 chars):', responseText.substring(0, 500))
    console.log('🔍 Groq Response (last 200 chars):', responseText.substring(Math.max(0, responseText.length - 200)))
    
    let fields = []

    // Helper function to strip JavaScript-style comments from JSON
    const stripComments = (jsonString) => {
      // Remove /* ... */ style comments
      let cleaned = jsonString.replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove // ... style comments (but preserve URLs like https://)
      cleaned = cleaned.replace(/([^:])\/\/[^\n]*/g, '$1')
      return cleaned
    }

    try {
      // Try to parse as JSON (strip comments first)
      const cleaned = stripComments(responseText)
      const parsed = JSON.parse(cleaned)
      // Handle both { fields: [...] } and direct array
      fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
      console.log('✅ Direct JSON parse succeeded')
    } catch (parseError) {
      console.log('⚠️ Direct JSON parse failed, trying fallback extraction...')
      
      // Try multiple fallback patterns
      let jsonMatch = null
      
      // Pattern 1: Markdown-wrapped array
      jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
      
      // Pattern 2: Markdown-wrapped object with fields
      if (!jsonMatch) {
        jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?"fields"[\s\S]*?\})\s*```/)
      }
      
      // Pattern 3: Plain array anywhere in text
      if (!jsonMatch) {
        jsonMatch = responseText.match(/(\[[\s\S]*\])/)
      }
      
      // Pattern 4: Plain object with fields
      if (!jsonMatch) {
        jsonMatch = responseText.match(/(\{[\s\S]*?"fields"[\s\S]*?\})/)
      }
      
      if (jsonMatch) {
        console.log('✅ Fallback extraction succeeded with pattern')
        const cleaned = stripComments(jsonMatch[1])
        const extracted = JSON.parse(cleaned)
        fields = Array.isArray(extracted) ? extracted : (extracted.fields || [])
      } else {
        console.error('❌ All parsing attempts failed')
        console.error('❌ Response text:', responseText)
        throw new Error('Failed to parse Groq response as JSON - no valid JSON found in response')
      }
    }

    // Add id field for frontend compatibility
    fields = fields.map((field, index) => ({
      id: field.id || `field_${Date.now()}_${index}`,
      ...field
    }))

    console.log(`✅ Successfully extracted ${fields.length} fields (with ids)`)

    return res.json({
      success: true,
      fields: fields,
      imagesAnalyzed: imageUrls.length
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

