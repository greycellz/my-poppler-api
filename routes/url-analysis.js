const express = require('express')
const router = express.Router()
const OpenAI = require('openai')
const vision = require('@google-cloud/vision')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const { compressImage, getCompressionSettings } = require('../utils/image-compression')
const { quickComplexityCheck } = require('../utils/image-complexity-detector')
const { splitTallImage, mergeFieldExtractions } = require('../utils/image-splitter')
const { withTimeout, TIMEOUTS } = require('../utils/timeout')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Initialize Google Vision client (for screenshotUrls array processing)
let visionClient = null

function initializeVisionClient() {
  if (visionClient) {
    return visionClient
  }

  try {
    let credentials
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        console.log('✅ Google Vision credentials loaded from environment variable')
      } catch (error) {
        console.error('❌ Error parsing Google Vision credentials JSON:', error.message)
        throw new Error('Invalid Google Vision credentials JSON format')
      }
    } else {
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

// Groq model selection
const USE_GROQ_LLAMA = process.env.USE_GROQ_LLAMA === 'TRUE'
const GROQ_MODEL = USE_GROQ_LLAMA ? 'llama-3.3-70b-versatile' : 'openai/gpt-oss-20b'

// Simple token estimator for debugging (rough: ~3.5 chars per token for JSON/text)
function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(String(text).length / 3.5)
}

// Helper function to extract text from Vision API block
function getBlockText(block) {
  if (!block || !block.paragraphs) return ''
  
  return block.paragraphs
    .flatMap(p => p.words || [])
    .map(w => (w.symbols || []).map(s => s.text).join(''))
    .join(' ')
}

// Configuration
const SPLIT_MAX_HEIGHT = parseInt(process.env.IMAGE_SPLIT_MAX_HEIGHT || '4000', 10)
const SPLIT_OVERLAP = parseInt(process.env.IMAGE_SPLIT_OVERLAP || '20', 10) // Default: 20px (reduced from 200px)

/**
 * POST /analyze-url
 * Analyze a form URL by taking screenshot, splitting if needed, and processing with Vision API
 * 
 * Supports two modes:
 * 1. screenshotUrls array: Uses Google Vision + Groq (like PDF analysis)
 * 2. url or screenshotUrl: Uses OpenAI GPT-4o Vision (backward compatible)
 */
router.post('/analyze-url', async (req, res) => {
  try {
    const { url, screenshotUrl, screenshotUrls, systemMessage, userMessage, additionalContext } = req.body

    // NEW: Handle screenshotUrls array (per-page screenshots)
    if (screenshotUrls && Array.isArray(screenshotUrls) && screenshotUrls.length > 0) {
      console.log(`🔍 Processing ${screenshotUrls.length} screenshots with Google Vision + Groq...`)
      
      if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({
          success: false,
          error: 'GROQ_API_KEY not configured in environment'
        })
      }

      // Initialize Vision client
      const visionClient = initializeVisionClient()

      // Step 1: Process all screenshots with Google Vision API (using allSettled for partial failures)
      console.log('📄 Step 1: Processing screenshots with Google Vision OCR...')
      const visionStartTime = Date.now()
      
      const visionResults = await Promise.allSettled(
        screenshotUrls.map(async (imageUrl, index) => {
          const imageStartTime = Date.now()
          try {
            console.log(`📥 Fetching screenshot ${index + 1}/${screenshotUrls.length}: ${imageUrl}`)
            const response = await fetch(imageUrl)
            if (!response.ok) {
              throw new Error(`Failed to fetch image: ${response.status}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const base64Content = buffer.toString('base64')
            
            console.log(`🔍 Calling Vision API for screenshot ${index + 1}...`)
            const [result] = await visionClient.documentTextDetection({
              image: { content: base64Content }
            })

            const imageTime = Date.now() - imageStartTime
            const extractedText = result.fullTextAnnotation?.text || ''
            
            // Extract bounding box data for spatial analysis
            const pages = result.fullTextAnnotation?.pages || []
            const blocks = pages.flatMap(page => page.blocks || [])
            
            console.log(`✅ Screenshot ${index + 1} processed in ${imageTime}ms (${extractedText.length} chars, ${blocks.length} blocks)`)
            
            return {
              page: index + 1,
              text: extractedText,
              blocks: blocks,
              processingTime: imageTime
            }
          } catch (error) {
            console.error(`❌ Error processing screenshot ${index + 1}:`, error)
            throw error
          }
        })
      )

      // Filter successful results and log failures
      const successfulResults = visionResults
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)

      const failedResults = visionResults
        .filter((result) => result.status === 'rejected')
        .map((result, index) => ({ 
          screenshotIndex: index + 1, 
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        }))

      if (failedResults.length > 0) {
        console.warn(`⚠️ ${failedResults.length} screenshots failed to process:`, failedResults)
      }

      if (successfulResults.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'All screenshots failed to process with Vision API',
          details: failedResults,
          suggestions: [
            'Check if screenshot URLs are accessible',
            'Verify Google Vision API credentials are valid',
            'Check Vision API quota and rate limits'
          ]
        })
      }

      const visionTotalTime = Date.now() - visionStartTime
      const totalCharacters = successfulResults.reduce((sum, r) => sum + r.text.length, 0)

      console.log(`✅ ${successfulResults.length}/${screenshotUrls.length} screenshots processed in ${visionTotalTime}ms`)
      console.log(`📝 Total OCR text: ${totalCharacters} characters`)
      
      // Validate that we have some OCR text
      if (totalCharacters === 0) {
        return res.status(400).json({
          success: false,
          error: 'No text extracted from screenshots',
          details: 'Vision API returned empty OCR results for all screenshots. The form may be image-only, inaccessible, or contain no text.',
          screenshotsProcessed: successfulResults.length,
          suggestions: [
            'Verify the form contains visible text',
            'Check if the form requires authentication',
            'Ensure screenshots are clear and readable',
            'Try capturing screenshots manually'
          ]
        })
      }

      // Step 2: Format spatial layout data for LLM
      console.log('🔍 Formatting spatial layout data for LLM...')
      const allBlocks = successfulResults.flatMap(r => r.blocks || [])
      console.log(`📦 Total blocks from Vision API: ${allBlocks.length}`)
      
      // Format blocks with spatial information
      const spatialBlocks = allBlocks.map((block, idx) => {
        const text = getBlockText(block).trim()
        const box = block.boundingBox
        
        if (box && box.vertices && box.vertices.length >= 4) {
          const topLeft = box.vertices[0]
          const bottomRight = box.vertices[2]
          const width = bottomRight.x - topLeft.x
          const height = Math.abs(bottomRight.y - topLeft.y)
          
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
      }).filter(b => b !== null && b.text.length > 0)
      
      console.log(`📊 Formatted ${spatialBlocks.length} blocks with spatial data for LLM`)

      // Step 3: Combine OCR text from all pages
      const combinedText = successfulResults
        .map((result, index) => `=== PAGE ${result.page} ===\n${result.text}`)
        .join('\n\n')

      // Step 4: Send to Groq API for field identification
      console.log('🤖 Step 2: Sending OCR text to Groq API for field identification...')
      const groqStartTime = Date.now()

      // Build spatial context (sample first 50 blocks)
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
- Large height (>25px) or large width (>400px) near top = Form title/header (use <h1>)
- Medium-large height (18-25px) standalone text = Section header (use <h2>)
- Multi-line or long text (>100 chars) = Instructions/legal text (use <p>)
- Text ending with ":" = Field label (remove ":" for label)
- Fields at similar y-coordinates = Same row
- Sort ALL fields by y-coordinate (top to bottom)
`
        : ''

      // Use provided system message or default
      const defaultSystemMessage = (systemMessage || `You are a form structure analysis expert. You will receive OCR TEXT from web form screenshots along with SPATIAL LAYOUT DATA.

**YOUR TASK**: Analyze the text AND spatial data to identify the form's structure and create a digital version:
1. **Input fields** (text boxes, email fields, phone numbers, checkboxes, etc.) - where users will enter data
2. **Label fields** (titles, section headers, instructions, legal text) - for display/organization

IMPORTANT: You are analyzing a BLANK FORM TEMPLATE to understand its structure, not extracting data from a filled form. Do NOT skip titles, headers, or instructions. These must be included as label fields to preserve the form structure.`) + spatialContextHint + `

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields have similar text (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects.

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ..." as its OWN field, not just explanation.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options, attach ALL options to a SINGLE field object in the "options" array.

For each field you identify, determine:

1. **Field Label**: The visible text label (exactly as shown). Remove trailing colons (":") from labels.
2. **Field Type**: text, email, tel, number, textarea, select, date, radio-with-other, checkbox-with-other, label
3. **Required Status**: Look for asterisks (*) or "(required)" text
4. **Options**: For select/radio/checkbox fields, include all visible options
5. **Page Number**: Include the page number where field is found
6. **Confidence**: Rate 0.0-1.0

Return ONLY a JSON array with this structure:
[
  {
    "label": "Field Name",
    "type": "text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other|label",
    "required": true/false,
    "placeholder": "placeholder if visible",
    "options": ["option1", "option2"],
    "allowOther": false,
    "otherLabel": "Other:",
    "otherPlaceholder": "Please specify...",
    "confidence": 0.95,
    "pageNumber": 1,
    "richTextContent": "<h1>Title</h1>" // ONLY for label type fields
  }
]

**CRITICAL**: Sort fields by y-coordinate (top to bottom). Lower y-value = appears first.`

      // Build user message with OCR text
      let groqUserMessage = `Analyze this OCR text from web form screenshots and identify BOTH:
1. Label fields (titles, section headers, instructions - display-only form text)
2. Input fields (text, email, phone, checkboxes, etc.)

OCR TEXT:
${combinedText}

🚨 CRITICAL: Return fields in STRICT TOP-TO-BOTTOM ORDER based on y-coordinates from the spatial data above. Sort by y-coordinate (vertical position), NOT by field type or OCR text order. Lower y-value = higher on page = appears first in your output array.

**OUTPUT FORMAT**: Return ONLY a valid JSON array. Do NOT include any explanation, reasoning, or text outside the JSON array. Start with [ and end with ].`
      
      // If user provided additional context, append it
      if (additionalContext) {
        groqUserMessage += `\n\nAdditional context: ${additionalContext}`
      }
      if (userMessage) {
        groqUserMessage += `\n\n${userMessage}`
      }

      // DEBUG: Estimate Groq input tokens before calling API
      const systemTokens = estimateTokens(defaultSystemMessage)
      const userTokens = estimateTokens(groqUserMessage)
      const ocrTokens = estimateTokens(combinedText)
      const spatialTokens = estimateTokens(spatialContextHint)
      const estimatedInputTokens = systemTokens + userTokens + ocrTokens + spatialTokens

      console.log('📊 [DEBUG][Groq] Estimated input tokens:', {
        systemTokens,
        userTokens,
        ocrTokens,
        spatialTokens,
        estimatedInputTokens
      })

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
          max_completion_tokens: 65536,
          temperature: 0.1,
          reasoning_effort: "low"  // Minimize reasoning token consumption
        })
      })

      if (!groqResponse.ok) {
        const errorData = await groqResponse.json().catch(() => ({}))
        throw new Error(`Groq API error: ${groqResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
      }

      const groqData = await groqResponse.json()
      const groqTime = Date.now() - groqStartTime

      // DEBUG: Log Groq usage if available
      const groqUsage = groqData.usage || groqData.usage_metadata || null

      console.log(`✅ Groq API completed in ${groqTime}ms`)
      if (groqUsage) {
        console.log('📊 [DEBUG][Groq] Actual token usage:', JSON.stringify(groqUsage, null, 2))
      } else {
        console.log('📊 [DEBUG][Groq] No usage field returned in response')
      }

      // Parse Groq response
      const choice = groqData.choices?.[0]
      if (!choice) {
        throw new Error('No response from Groq API')
      }

      const finishReason = choice.finish_reason
      console.log(`🏁 Groq finish_reason: ${finishReason}`)
      
      if (finishReason === 'length') {
        console.warn('⚠️ WARNING: Groq response was truncated due to max_completion_tokens limit!')
      }

      // Check if reasoning mode is accidentally enabled (should be disabled)
      if (choice.message?.reasoning) {
        console.warn('⚠️ WARNING: Reasoning mode detected - this should be disabled!')
        const reasoningLength = typeof choice.message.reasoning === 'string' 
          ? choice.message.reasoning.length 
          : JSON.stringify(choice.message.reasoning).length
        console.warn('⚠️ Reasoning field length:', reasoningLength, 'characters')
        console.warn('⚠️ Reasoning mode may be enabled by default for this model - consider using a different model or contact Groq support')
      }

      // Check for empty content
      if (!choice.message?.content) {
        console.error('❌ Groq response has no content!')
        console.error('📋 Full choice object:', JSON.stringify(choice, null, 2))
        if (finishReason === 'length') {
          throw new Error('Groq response truncated - content empty and finish_reason is "length". Possible reasoning mode issue.')
        }
        throw new Error('Groq response has no content - unable to extract fields')
      }

      const responseText = choice.message?.content || ''

      // DEBUG: Estimate completion tokens from response length
      const estimatedCompletionTokens = estimateTokens(responseText)
      console.log('📊 [DEBUG][Groq] Estimated completion tokens from responseText:', estimatedCompletionTokens)
      
      // Helper function to sanitize LLM-generated JSON
      const sanitizeJSON = (jsonString) => {
        let cleaned = jsonString
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* ... */ comments
        cleaned = cleaned.replace(/([^:])\/\/[^\n]*/g, '$1') // Remove // comments
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        cleaned = cleaned.replace(/'([^']*)':/g, '"$1":') // Replace single quotes
        return cleaned
      }

      let fields = []

      try {
        const cleaned = sanitizeJSON(responseText)
        const parsed = JSON.parse(cleaned)
        fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
        console.log('✅ Direct JSON parse succeeded')
      } catch (parseError) {
        console.log('⚠️ Direct JSON parse failed, trying fallback extraction...')
        console.log('⚠️ Parse error:', parseError instanceof Error ? parseError.message : String(parseError))
        console.log('⚠️ Response preview (first 500 chars):', responseText.substring(0, 500))
        
        let jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
        if (!jsonMatch) {
          jsonMatch = responseText.match(/(\[[\s\S]*\])/)
        }
        
        if (jsonMatch) {
          try {
            const cleaned = sanitizeJSON(jsonMatch[1])
            const extracted = JSON.parse(cleaned)
            fields = Array.isArray(extracted) ? extracted : (extracted.fields || [])
            console.log('✅ Fallback JSON extraction succeeded')
          } catch (fallbackError) {
            console.error('❌ Fallback JSON extraction also failed:', fallbackError)
            throw new Error(`Failed to parse Groq response as JSON. Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}. Response length: ${responseText.length} chars.`)
          }
        } else {
          throw new Error(`Failed to find JSON array in Groq response. Response length: ${responseText.length} chars. First 200 chars: ${responseText.substring(0, 200)}`)
        }
      }
      
      // Validate fields array
      if (!Array.isArray(fields) || fields.length === 0) {
        console.warn('⚠️ Groq returned empty or invalid fields array')
        // Don't throw error, return empty array - let frontend handle it
        fields = []
      }

      // Add id field for frontend compatibility
      fields = fields.map((field, index) => ({
        id: field.id || `field_${Date.now()}_${index}`,
        ...field
      }))

      console.log(`✅ Successfully extracted ${fields.length} fields using Google Vision + Groq`)

      return res.json({
        success: true,
        fields: fields,
        imagesAnalyzed: successfulResults.length,
        imagesRequested: screenshotUrls.length,
        imagesFailed: failedResults.length,
        method: 'google-vision-groq',
        wasSplit: false
      })
    }

    // BACKWARD COMPATIBILITY: Handle single screenshotUrl or url (OpenAI GPT-4o Vision)
    if (!screenshotUrl && !url) {
      return res.status(400).json({
        success: false,
        error: 'Either url, screenshotUrl, or screenshotUrls array is required'
      })
    }

    // If URL provided, take screenshot (existing Railway screenshot endpoint)
    let screenshotImageUrl = screenshotUrl
    if (url && !screenshotUrl) {
      // Call Railway screenshot endpoint
      // Construct URL properly - ensure it has protocol
      let puppeteerServiceUrl = process.env.PUPPETEER_SERVICE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://my-poppler-api-production.up.railway.app'
      // If RAILWAY_PUBLIC_DOMAIN is set without protocol, add it
      if (puppeteerServiceUrl && !puppeteerServiceUrl.startsWith('http')) {
        puppeteerServiceUrl = `https://${puppeteerServiceUrl}`
      }
      const screenshotResponse = await fetch(`${puppeteerServiceUrl}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          options: {
            viewport: { width: 1280, height: 800 },
            waitTime: 4000,
            fullPage: true
          }
        })
      })
      
      if (!screenshotResponse.ok) {
        throw new Error('Failed to capture screenshot')
      }
      
      const screenshotData = await screenshotResponse.json()
      screenshotImageUrl = screenshotData.screenshot?.url
      
      if (!screenshotImageUrl) {
        throw new Error('Screenshot URL not returned')
      }
    }

    console.log(`🔍 Analyzing URL screenshot: ${screenshotImageUrl}`)

    // Fetch screenshot
    const fetchPromise = fetch(screenshotImageUrl)
    const response = await withTimeout(
      fetchPromise,
      TIMEOUTS.IMAGE_FETCH,
      'Screenshot fetch timed out'
    )
    
    if (!response.ok) {
      throw new Error(`Failed to fetch screenshot: ${response.status}`)
    }

    const arrayBufferPromise = response.arrayBuffer()
    const arrayBuffer = await withTimeout(
      arrayBufferPromise,
      TIMEOUTS.IMAGE_FETCH,
      'Screenshot download timed out'
    )

    const originalBuffer = Buffer.from(arrayBuffer)
    const mimeType = response.headers.get('content-type') || 'image/png'

    // Check image dimensions
    const metadata = await sharp(originalBuffer).metadata()
    const imageHeight = metadata.height || 0
    const imageWidth = metadata.width || 0

    console.log(`📐 Screenshot dimensions: ${imageWidth}x${imageHeight}px`)

    // Check if image is very tall (needs splitting)
    if (imageHeight > SPLIT_MAX_HEIGHT) {
      console.log(`📐 Screenshot is very tall (${imageHeight}px > ${SPLIT_MAX_HEIGHT}px), splitting into sections...`)
      
      // Split image into sections
      const sections = await splitTallImage(originalBuffer, SPLIT_MAX_HEIGHT, SPLIT_OVERLAP)
      
      console.log(`📐 Split into ${sections.length} sections`)
      
      // Process each section separately
      const sectionFields = await Promise.all(
        sections.map(async (section, sectionIndex) => {
          try {
            // Compress section
            const compressionSettings = getCompressionSettings(mimeType)
            const compressionPromise = compressImage(section.buffer, compressionSettings)
            const compressionResult = await withTimeout(
              compressionPromise,
              TIMEOUTS.IMAGE_COMPRESSION,
              `Section ${sectionIndex + 1} compression timed out`
            )

            // Determine detail level
            const sectionMetadata = await sharp(compressionResult.buffer).metadata()
            const needsHighDetail = !quickComplexityCheck(
              compressionResult.buffer,
              sectionMetadata.width,
              sectionMetadata.height
            )
            const detailLevel = needsHighDetail ? 'high' : 'low'
            
            // Convert to base64 for Vision API
            const base64 = compressionResult.buffer.toString('base64')
            
            // Call GPT-4o Vision for this section
            const completionPromise = openai.chat.completions.create({
              model: 'gpt-4o',
              response_format: { type: 'json_object' }, // Force JSON output
              messages: [
                {
                  role: 'system',
                  content: systemMessage || `You are a form analysis expert. Extract all form fields from this section of a form. You MUST respond with ONLY valid JSON.`
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Analyze this section (${sectionIndex + 1} of ${sections.length}) of the form and extract all visible form fields. This is part of a larger form that has been split into sections.

Return a JSON object with this exact structure:
{
  "fields": [
    {
      "label": "Field Name",
      "type": "text",
      "required": false,
      "options": [],
      "pageNumber": 1
    }
  ]
}

Field types: text, email, tel, textarea, select, date, radio-with-other, checkbox-with-other
Extract fields exactly as they appear.${additionalContext ? `\n\nAdditional context: ${additionalContext}` : ''}`
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:${compressionResult.mimeType};base64,${base64}`,
                        detail: detailLevel
                      }
                    }
                  ]
                }
              ],
              max_tokens: 15000,
              temperature: 0.1
            })
            
            const completion = await withTimeout(
              completionPromise,
              TIMEOUTS.GPT_VISION_API,
              `Section ${sectionIndex + 1} Vision API call timed out`
            )
            
            // Check if we got a valid response
            if (!completion || !completion.choices || !completion.choices[0]) {
              console.error(`Section ${sectionIndex + 1}: Invalid completion structure:`, completion)
              return { fields: [], sectionIndex }
            }
            
            // Parse response
            const responseText = completion.choices[0].message?.content
            
            if (!responseText) {
              console.error(`Section ${sectionIndex + 1}: Empty response from Vision API`)
              return { fields: [], sectionIndex }
            }
            
            // Log first 200 chars for debugging
            const preview = responseText.substring(0, 200)
            console.log(`📝 Section ${sectionIndex + 1} response preview: ${preview}...`)
            
            let parsedResponse
            try {
              // Try to extract JSON from response (might have markdown code fences)
              let cleanedText = responseText.trim()
              
              // Remove markdown code fences if present
              if (cleanedText.startsWith('```json')) {
                cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/\s*```$/g, '')
              } else if (cleanedText.startsWith('```')) {
                cleanedText = cleanedText.replace(/^```\s*/i, '').replace(/\s*```$/g, '')
              }
              
              // Try to find JSON object in the response
              const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                parsedResponse = JSON.parse(jsonMatch[0])
              } else {
                // If no JSON object found, try parsing the whole thing
                parsedResponse = JSON.parse(cleanedText)
              }
            } catch (parseError) {
              console.error(`❌ Failed to parse section ${sectionIndex + 1} response:`)
              console.error(`   Error: ${parseError.message}`)
              console.error(`   Response starts with: ${responseText.substring(0, 100)}`)
              console.error(`   Response length: ${responseText.length} chars`)
              return { fields: [], sectionIndex }
            }
            
            console.log(`✅ Section ${sectionIndex + 1}: Extracted ${parsedResponse.fields?.length || 0} fields`)
            
            return {
              fields: parsedResponse.fields || [],
              sectionIndex: sectionIndex
            }
          } catch (error) {
            console.error(`Error processing section ${sectionIndex + 1}:`, error)
            return { fields: [], sectionIndex }
          }
        })
      )
      
      // Merge results from all sections
      const mergedFields = mergeFieldExtractions(sectionFields)
      
      console.log(`✅ Processed ${sections.length} sections, extracted ${mergedFields.length} total unique fields`)
      
      return res.json({
        success: true,
        fields: mergedFields,
        wasSplit: true,
        numSections: sections.length,
        originalHeight: imageHeight,
        splitThreshold: SPLIT_MAX_HEIGHT
      })
    } else {
      // Normal processing for images that aren't too tall
      // Compress image
      const compressionSettings = getCompressionSettings(mimeType)
      const compressionPromise = compressImage(originalBuffer, compressionSettings)
      const compressionResult = await withTimeout(
        compressionPromise,
        TIMEOUTS.IMAGE_COMPRESSION,
        'Image compression timed out'
      )

      // Determine detail level
      const metadataAfterCompression = await sharp(compressionResult.buffer).metadata()
      const needsHighDetail = !quickComplexityCheck(
        compressionResult.buffer,
        metadataAfterCompression.width,
        metadataAfterCompression.height
      )
      const detailLevel = needsHighDetail ? 'high' : 'low'
      
      // Convert to base64
      const base64 = compressionResult.buffer.toString('base64')
      
      // Call GPT-4o Vision API
      const completionPromise = openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemMessage || 'You are a form analysis expert. Extract all form fields from the provided screenshot.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userMessage || `Analyze this screenshot of a form${url ? ` from URL: ${url}` : ''} and extract all visible form fields.${additionalContext ? `\n\nAdditional context: ${additionalContext}` : ''}`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${compressionResult.mimeType};base64,${base64}`,
                  detail: detailLevel
                }
              }
            ]
          }
        ],
        max_tokens: 15000,
        temperature: 0.1
      })

      const completion = await withTimeout(
        completionPromise,
        TIMEOUTS.GPT_VISION_API,
        'GPT-4o Vision API call timed out'
      )

      const choice = completion.choices?.[0]
      
      if (!choice) {
        return res.status(500).json({
          success: false,
          error: 'No response from GPT-4 Vision'
        })
      }
      
      const responseText = choice.message?.content
      const finishReason = choice.finish_reason

      if (finishReason === 'length') {
        return res.status(413).json({
          success: false,
          error: 'This form is too large to process in one go. Please try splitting it into smaller sections or use a form with fewer fields.',
          errorType: 'TOKEN_LIMIT_EXCEEDED'
        })
      }

      if (!responseText) {
        return res.status(500).json({
          success: false,
          error: 'No response from GPT-4 Vision'
        })
      }

      // Parse JSON response
      let parsedResponse
      try {
        let cleanedText = responseText.trim()
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/\s*```$/g, '')
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/i, '').replace(/\s*```$/g, '')
        }
        
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0])
        } else {
          parsedResponse = JSON.parse(cleanedText)
        }
      } catch (parseError) {
        console.error('Failed to parse GPT response:', responseText)
        const openBraces = (responseText.match(/\{/g)?.length || 0)
        const closeBraces = (responseText.match(/\}/g)?.length || 0)
        const isTruncated = openBraces > closeBraces
        
        if (isTruncated) {
          return res.status(413).json({
            success: false,
            error: 'This form is too large to process in one go. Please try splitting it into smaller sections or use a form with fewer fields.',
            errorType: 'TOKEN_LIMIT_EXCEEDED'
          })
        }
        
        return res.status(500).json({
          success: false,
          error: 'Failed to parse form data. Please try again or contact support if the issue persists.',
          rawResponse: responseText
        })
      }

      console.log(`✅ Successfully analyzed screenshot (${imageHeight}px tall)`)

      return res.json({
        success: true,
        fields: parsedResponse.fields || [],
        rawResponse: responseText,
        wasSplit: false
      })
    }

  } catch (error) {
    console.error('❌ URL analysis error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'URL analysis failed'
    })
  }
})

module.exports = router
