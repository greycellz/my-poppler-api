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

// Groq model selection
const USE_GROQ_LLAMA = process.env.USE_GROQ_LLAMA === 'TRUE'
const GROQ_MODEL = USE_GROQ_LLAMA ? 'llama-3.3-70b-versatile' : 'openai/gpt-oss-120b'

if (!process.env.GROQ_API_KEY) {
  console.error('⚠️ WARNING: GROQ_API_KEY not set in Railway environment')
}

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

    const visionTotalTime = Date.now() - visionStartTime
    const totalCharacters = visionResults.reduce((sum, r) => sum + r.text.length, 0)

    console.log(`✅ All images processed in ${visionTotalTime}ms`)
    console.log(`📝 Total OCR text: ${totalCharacters} characters`)

    // Step 2: Combine OCR text from all pages
    const combinedText = visionResults
      .map((result, index) => `=== PAGE ${result.page} ===\n${result.text}`)
      .join('\n\n')

    // Step 3: Send to Groq API for field extraction
    console.log('🤖 Step 2: Sending OCR text to Groq API for field extraction...')
    const groqStartTime = Date.now()

    // Use provided system message or default
    const defaultSystemMessage = systemMessage || `You are a form analysis expert. Analyze OCR text extracted from PDF form pages and extract ALL visible form fields with high accuracy.

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields look similar (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects.

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ..." as its OWN field.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options, attach ALL options to a SINGLE field object.

For each field, determine: label, type (text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other), required status, placeholder, options (if applicable), allowOther (if applicable), pageNumber, and confidence.

Return ONLY a JSON array with this structure:
[
  {
    "label": "Field Label Text",
    "type": "text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other",
    "required": true/false,
    "placeholder": "Placeholder text if visible",
    "options": ["Option 1", "Option 2"] (for select/radio/checkbox),
    "allowOther": true/false,
    "otherLabel": "Other:" (if allowOther is true),
    "otherPlaceholder": "Please specify..." (if allowOther is true),
    "confidence": 0.95,
    "pageNumber": 1
  }
]`

    const groqUserMessage = userMessage || `Analyze this OCR text extracted from PDF form pages and extract all visible form fields.

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
        max_completion_tokens: 32768,
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

    console.log(`✅ Successfully extracted ${fields.length} fields`)

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

