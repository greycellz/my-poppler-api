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

module.exports = router

