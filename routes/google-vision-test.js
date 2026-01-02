const express = require('express')
const router = express.Router()
const vision = require('@google-cloud/vision')
const fs = require('fs')
const path = require('path')

// Initialize Vision client with same credential pattern as gcp-client.js
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
        console.log('🔑 Service Account Email:', credentials.client_email)
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

/**
 * POST /api/test-google-vision
 * Test Google Vision API OCR on an image
 * 
 * Body options:
 * - imagePath: Path to image file (relative to project root, e.g., "output/{uuid}/page-1.png")
 * - imageUrl: URL to fetch image from
 * - imageBuffer: Base64 encoded image buffer
 */
router.post('/test-google-vision', async (req, res) => {
  try {
    const { imagePath, imageUrl, imageBuffer } = req.body

    if (!imagePath && !imageUrl && !imageBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Either imagePath, imageUrl, or imageBuffer is required'
      })
    }

    // Initialize client
    const client = initializeVisionClient()

    let imageInput

    // Handle different input types
    if (imagePath) {
      // Read from file path
      const fullPath = path.join(__dirname, '..', imagePath)
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          success: false,
          error: `Image file not found: ${fullPath}`
        })
      }
      imageInput = { image: { source: { filename: fullPath } } }
      console.log(`📄 Reading image from file: ${fullPath}`)
    } else if (imageUrl) {
      // Fetch from URL
      console.log(`📥 Fetching image from URL: ${imageUrl}`)
      const response = await fetch(imageUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      // Google Vision API expects base64-encoded string for content
      imageInput = { image: { content: buffer.toString('base64') } }
      console.log(`📄 Fetched image from URL: ${imageUrl}`)
      console.log(`📦 Image buffer size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`)
    } else if (imageBuffer) {
      // Use provided buffer (base64 or buffer)
      const buffer = Buffer.isBuffer(imageBuffer) 
        ? imageBuffer 
        : Buffer.from(imageBuffer, 'base64')
      // Google Vision API expects base64-encoded string for content
      imageInput = { image: { content: buffer.toString('base64') } }
      console.log(`📄 Using provided image buffer (${buffer.length} bytes)`)
    }

    console.log('🔍 Calling Google Vision API documentTextDetection...')
    console.log(`📋 Image input structure:`, JSON.stringify(Object.keys(imageInput.image || {}), null, 2))
    if (imageInput.image?.content) {
      console.log(`📋 Buffer size: ${imageInput.image.content.length} bytes`)
    }
    const startTime = Date.now()

    // Call Google Vision API
    let result
    try {
      [result] = await client.documentTextDetection(imageInput)
      console.log(`📊 Vision API response received`)
      console.log(`📊 Full text annotation present: ${!!result.fullTextAnnotation}`)
      if (result.error) {
        console.error(`❌ Vision API returned error:`, result.error)
        throw new Error(result.error.message || 'Vision API error')
      }
    } catch (visionError) {
      console.error(`❌ Vision API call failed:`, visionError)
      console.error(`❌ Error details:`, JSON.stringify(visionError, null, 2))
      throw visionError
    }

    const processingTime = Date.now() - startTime

    // Extract text
    const fullTextAnnotation = result.fullTextAnnotation
    const extractedText = fullTextAnnotation?.text || ''
    const pages = fullTextAnnotation?.pages || []

    console.log(`✅ Google Vision API completed in ${processingTime}ms`)
    console.log(`📝 Extracted text length: ${extractedText.length} characters`)
    console.log(`📄 Number of pages detected: ${pages.length}`)

    // Return results
    res.json({
      success: true,
      text: extractedText,
      pages: pages.length,
      processingTimeMs: processingTime,
      fullTextAnnotation: fullTextAnnotation,
      message: `Successfully extracted ${extractedText.length} characters from image`
    })

  } catch (error) {
    console.error('❌ Google Vision API test error:', error)
    res.status(500).json({
      success: false,
      error: 'Google Vision API test failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

/**
 * GET /api/test-google-vision
 * Simple health check endpoint
 */
router.get('/test-google-vision', async (req, res) => {
  try {
    // Try to initialize client
    const client = initializeVisionClient()
    
    res.json({
      success: true,
      message: 'Google Vision API test endpoint is ready',
      clientInitialized: !!client,
      hasCredentials: !!(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
                        fs.existsSync(path.join(__dirname, '..', 'chatterforms-app-key.json')))
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Google Vision API client initialization failed',
      details: error.message
    })
  }
})

/**
 * POST /api/test-google-vision-full
 * Process all PDF page images with Google Vision OCR, combine text, and structure with Groq
 * 
 * Body:
 * - imageUrls: Array of image URLs to process
 * - systemMessage: Optional system message for Groq (defaults to form extraction prompt)
 */
router.post('/test-google-vision-full', async (req, res) => {
  const overallStartTime = Date.now()
  const analytics = {
    totalTime: 0,
    visionApi: {
      totalTime: 0,
      perImage: [],
      averageTime: 0,
      totalCharacters: 0
    },
    groqApi: {
      time: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    },
    fields: {
      count: 0,
      byType: {},
      byPage: {}
    }
  }

  try {
    const { imageUrls, systemMessage } = req.body

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'imageUrls array is required'
      })
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GROQ_API_KEY not configured in environment'
      })
    }

    console.log(`🔍 Processing ${imageUrls.length} images with Google Vision + Groq...`)

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
          
          analytics.visionApi.perImage.push({
            page: index + 1,
            time: imageTime,
            characters: extractedText.length,
            url: imageUrl
          })
          
          console.log(`✅ Image ${index + 1} processed in ${imageTime}ms (${extractedText.length} chars)`)
          
          return {
            page: index + 1,
            text: extractedText,
            processingTime: imageTime
          }
        } catch (error) {
          console.error(`❌ Error processing image ${index + 1}:`, error)
          throw error
        }
      })
    )

    analytics.visionApi.totalTime = Date.now() - visionStartTime
    analytics.visionApi.averageTime = analytics.visionApi.totalTime / imageUrls.length
    analytics.visionApi.totalCharacters = visionResults.reduce((sum, r) => sum + r.text.length, 0)

    console.log(`✅ All images processed in ${analytics.visionApi.totalTime}ms`)
    console.log(`📝 Total OCR text: ${analytics.visionApi.totalCharacters} characters`)

    // Step 2: Combine OCR text from all pages
    const combinedText = visionResults
      .map((result, index) => `=== PAGE ${result.page} ===\n${result.text}`)
      .join('\n\n')

    // Step 3: Send to Groq API for field extraction
    console.log('🤖 Step 2: Sending OCR text to Groq API for field extraction...')
    const groqStartTime = Date.now()

    const defaultSystemMessage = `You are a form analysis expert. Analyze OCR text extracted from PDF form pages and extract ALL visible form fields with high accuracy.

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields look similar (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects. Examples:
- "Phone (Work)" and "Phone (Other, please specify)" must be separate fields, even if both look like phone inputs
- Repeated "Yes/No" questions on different pages must each be separate fields
- "If living, age and health status" for Mother vs Father must be separate fields

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ...", "If you have used..., do you feel...", and every table/row instruction as its OWN field, not just explanation. Even if the wording is short and looks like a sub-clause, if it asks the user to provide information or choose an option, it must be a field.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options:
- Identify the main question label (the line that describes what is being asked)
- Attach ALL options for that question to a SINGLE field object in the "options" array
- Do NOT create separate fields for each option; they must be grouped under the main question
- CRITICAL: When you see Yes/No questions, ALWAYS include BOTH options. If you see "Yes" and "No, please mail it to my home address" or similar variations, include ALL of them in the options array. Look carefully in the OCR text - if a question has "Yes" mentioned, search for the corresponding "No" option even if it's on a different line or has additional text like "No, please mail it to my home address"
- If you see "Other: ______" below radio/checkboxes, set allowOther: true, otherLabel, and otherPlaceholder
- CRITICAL: When you see patterns like "(If yes) Full-time" and "(If yes) Part-time" under the same question, combine them into ONE field with label "If yes, Full-time/Part-time" (use forward slash, remove duplicate "If yes" prefix). Do NOT create separate fields for each option. Do NOT create duplicate fields - if you see the same field label, it should only appear once.

**ROW-BASED STRUCTURES**: In tables or repeated rows (e.g. medication charts, hospitalization charts):
- If each row asks for user input (e.g. Medication Name, Dosage, When Started), treat each column that expects text as a separate field
- Include the question number or context in the label (e.g. "5. Medication Name (row 1)", "5. Medication Name (row 2)")
- Do NOT merge or deduplicate rows just because the column labels are the same

**LABEL DISAMBIGUATION**: When two fields share the same base label but refer to different people or contexts, include that context in the label:
- e.g. "Emergency Contact (Phone)" vs "Mother's Phone", "Father's Phone"
- e.g. "Hospitalization date (physical)" vs "Hospitalization date (mental health)" if both exist
- Prefer slightly longer, more specific labels over shorter generic ones to avoid collapsing distinct fields

For each field you identify, determine:

1. **Field Label**: The visible text label (exactly as shown). IMPORTANT: If a field is part of a numbered question (e.g., "2. Question text"), include the question number in the label (e.g., "2. Medication Name" not just "Medication Name"). Preserve the full context including question numbers when they appear before field labels. Remove trailing colons (":") from labels - they are formatting, not part of the label.

2. **Field Type**: Choose the most appropriate type based on structure:
   - text: for single-line text inputs (names, addresses, single values). CRITICAL: If a field label appears with a blank line or input field underneath it (even if OCR captured a filled-in value like "Male" for Gender), treat it as type "text" - do NOT infer radio/select types from filled sample data. If you see a label like "3. Gender" followed by what appears to be a text input field (even with a sample value), use type "text", NOT "select" or "radio"
   - email: for email address fields
   - tel: for phone/telephone number fields  
   - textarea: for large text areas, comments, messages, or multi-line inputs
   - select: ONLY for dropdown menus with arrow indicators OR when you see multiple distinct options listed (like "Yes", "No", "Maybe"). Do NOT use "select" for fields that appear to be free text inputs, even if OCR shows a sample value
   - radio-with-other: for radio buttons that include "Other:" with text input
   - checkbox-with-other: for checkbox groups that include "Other:" with text input
   - date: for date picker fields
   
   IMPORTANT: Do NOT infer field types from filled sample data. If a form field appears as a blank text input (even if OCR shows a sample value filled in like "Male"), use type "text", not "radio" or "select" based on that value. Only use "select" or "radio" when you can clearly see multiple options presented as choices (Yes/No buttons, dropdown lists, etc.)

3. **Required Status**: Look for visual indicators:
   - Red asterisks (*)
   - "(required)" text
   - "(optional)" text (mark as not required)
   - Red field borders or labels

4. **Options Extraction**: For dropdowns/radio buttons/checkboxes, extract ALL visible options and group them with the main question label:
   - CRITICAL: When extracting Yes/No questions, ALWAYS capture ALL options. If you see "Yes" and "No" or "Yes" and "No, please mail it to my home address" or similar, include ALL options in the array. Never drop the "No" option or its variations. Search the entire OCR text around the question - if you see "Yes", look for the corresponding "No" option even if it's on a different line, has additional text, or appears after other content. If a question asks "is it OK to email statements to you?" and you see "Yes", you MUST also look for "No" or "No, please mail" or similar variations - they are part of the same question's options.
   - CRITICAL: allowOther should ALWAYS be false by default
   - ONLY set allowOther: true if you can clearly see ANY "Other" option (with or without colon) AND a text input field
   - If you see "Other" (with or without colon) with a text input field, set allowOther: true and use that as otherLabel
   - Do NOT add "Other" options to fields that don't have them in the original form
   - Most fields will have allowOther: false - only set to true when you see an actual "Other" with text input
   - IMPORTANT: If you set allowOther: true, do NOT include ANY "Other" option in the options array - it should only be in otherLabel
   - Extract "Yes-Other" as a regular option, but ANY "Other" with text input should trigger allowOther: true
   - CRITICAL: When you see conditional options like "(If yes) Full-time" and "(If yes) Part-time" appearing together under the same question context, combine them into ONE field with label "If yes, Full-time/Part-time" and options ["Full-time", "Part-time"]. Do NOT create separate fields for each conditional option. Do NOT create duplicate fields.

5. **Page Number**: IMPORTANT - Include the page number where each field is found

6. **Confidence**: Rate 0.0-1.0 how confident you are about this field

Return ONLY a JSON array with this exact structure:
[
  {
    "label": "Field Label Text",
    "type": "text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other",
    "required": true/false,
    "placeholder": "Placeholder text if visible",
    "options": ["Option 1", "Option 2"] (for select/radio/checkbox),
    "allowOther": true/false (ONLY true if you see "Other:" with text input),
    "otherLabel": "Other:" (ONLY if allowOther is true),
    "otherPlaceholder": "Please specify..." (ONLY if allowOther is true),
    "confidence": 0.95,
    "pageNumber": 1
  }
]

IMPORTANT: For most fields, allowOther should be false. Only set to true when you clearly see "Other:" with a text input field.

EXAMPLE: If you see options like:
- "No"
- "Yes-Flu A" 
- "Yes-Flu B"
- "Yes-Other"
- "Other:" (with text input field)

The correct extraction should be:
{
  "options": ["No", "Yes-Flu A", "Yes-Flu B", "Yes-Other"],
  "allowOther": true,
  "otherLabel": "Other:",
  "otherPlaceholder": "Please specify..."
}

Notice: "Other:" is NOT in the options array because it's handled by allowOther: true`

    const userMessage = `Analyze this OCR text extracted from PDF form pages and extract all visible form fields.

OCR TEXT:
${combinedText}

Extract all form fields with their exact labels, types, and options as they appear in the text.`

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          {
            role: 'system',
            content: systemMessage || defaultSystemMessage
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_completion_tokens: 32768,
        temperature: 0.1,
        reasoning_effort: "none"  // Disable reasoning mode to prevent token waste on internal thinking
      })
    })

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json().catch(() => ({}))
      throw new Error(`Groq API error: ${groqResponse.status} - ${errorData.error?.message || 'Unknown error'}`)
    }

    const groqData = await groqResponse.json()
    analytics.groqApi.time = Date.now() - groqStartTime
    
    if (groqData.usage) {
      analytics.groqApi.inputTokens = groqData.usage.prompt_tokens || 0
      analytics.groqApi.outputTokens = groqData.usage.completion_tokens || 0
      analytics.groqApi.totalTokens = groqData.usage.total_tokens || 0
    }

    console.log(`✅ Groq API completed in ${analytics.groqApi.time}ms`)

    // Parse Groq response
    const choice = groqData.choices?.[0]
    if (!choice) {
      throw new Error('No response from Groq API')
    }

    // Check if reasoning mode is accidentally enabled (should be disabled)
    if (choice.message?.reasoning) {
      console.warn('⚠️ WARNING: Reasoning mode detected - this should be disabled!')
      const reasoningLength = typeof choice.message.reasoning === 'string' 
        ? choice.message.reasoning.length 
        : JSON.stringify(choice.message.reasoning).length
      console.warn('⚠️ Reasoning field length:', reasoningLength, 'characters')
      console.warn('⚠️ This indicates reasoning_effort parameter may not be working correctly')
    }

    const responseText = choice.message?.content || ''
    let fields = []

    try {
      // Try to parse as JSON
      const parsed = JSON.parse(responseText)
      // Handle both { fields: [...] } and direct array
      fields = Array.isArray(parsed) ? parsed : (parsed.fields || [])
    } catch (parseError) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) || 
                       responseText.match(/(\[[\s\S]*\])/)
      if (jsonMatch) {
        fields = JSON.parse(jsonMatch[1])
      } else {
        throw new Error('Failed to parse Groq response as JSON')
      }
    }

    // Calculate field analytics
    analytics.fields.count = fields.length
    fields.forEach(field => {
      // Count by type
      const type = field.type || 'unknown'
      analytics.fields.byType[type] = (analytics.fields.byType[type] || 0) + 1
      
      // Count by page
      const page = field.pageNumber || 0
      analytics.fields.byPage[page] = (analytics.fields.byPage[page] || 0) + 1
    })

    analytics.totalTime = Date.now() - overallStartTime

    console.log(`✅ Complete! Total time: ${analytics.totalTime}ms`)
    console.log(`📊 Fields extracted: ${analytics.fields.count}`)
    console.log(`📊 Analytics:`, JSON.stringify(analytics, null, 2))

    res.json({
      success: true,
      fields,
      analytics,
      ocrText: {
        totalCharacters: analytics.visionApi.totalCharacters,
        perPage: visionResults.map(r => ({
          page: r.page,
          characters: r.text.length,
          text: r.text.substring(0, 200) + (r.text.length > 200 ? '...' : '') // Preview
        }))
      },
      message: `Successfully extracted ${analytics.fields.count} fields from ${imageUrls.length} pages`
    })

  } catch (error) {
    console.error('❌ Full pipeline error:', error)
    analytics.totalTime = Date.now() - overallStartTime
    
    res.status(500).json({
      success: false,
      error: 'Full pipeline failed',
      details: error.message,
      analytics,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

module.exports = router

