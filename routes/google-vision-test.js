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

    const defaultSystemMessage = `You are a form analysis expert. Analyze OCR text extracted from PDF form pages and extract ALL visible form fields.

CRITICAL INSTRUCTIONS - READ CAREFULLY:

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields look similar (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects.

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ...", and every table/row instruction as its OWN field.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options:
- Identify the main question label
- Attach ALL options for that question to a SINGLE field object in the "options" array
- If you see "Other: ______" below radio/checkboxes, set allowOther: true

**ROW-BASED STRUCTURES**: In tables or repeated rows:
- If each row asks for user input, treat each column as a separate field
- Include the question number or context in the label (e.g., "5. Medication Name (row 1)")

**LABEL DISAMBIGUATION**: When two fields share the same base label but refer to different contexts, include that context in the label.

For each field you identify, determine:
1. **Field Label**: The visible text label (exactly as shown, including question numbers)
2. **Field Type**: text, email, tel, textarea, select, date, radio-with-other, checkbox-with-other
3. **Required Status**: Look for asterisks, "(required)", "(optional)" text
4. **Options Extraction**: For dropdowns/radio/checkboxes, extract ALL visible options
5. **Page Number**: Include the page number where each field is found
6. **Confidence**: Rate 0.0-1.0 how confident you are about this field

Return ONLY a JSON array with this exact structure:
[
  {
    "label": "Field Label Text",
    "type": "text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other",
    "required": true/false,
    "placeholder": "Placeholder text if visible",
    "options": ["Option 1", "Option 2"],
    "allowOther": true/false,
    "otherLabel": "Other:",
    "otherPlaceholder": "Please specify...",
    "confidence": 0.95,
    "pageNumber": 1
  }
]`

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
        model: 'llama-3.3-70b-versatile',
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
        max_tokens: 32768,
        temperature: 0.1
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

