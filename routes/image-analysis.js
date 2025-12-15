const express = require('express')
const router = express.Router()
const OpenAI = require('openai')
const sharp = require('sharp')
const { compressImage, getCompressionSettings } = require('../utils/image-compression')
const { quickComplexityCheck } = require('../utils/image-complexity-detector')
const { withTimeout, TIMEOUTS } = require('../utils/timeout')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

if (!process.env.OPENAI_API_KEY) {
  console.error('⚠️ WARNING: OPENAI_API_KEY not set in Railway environment')
}

/**
 * POST /analyze-images
 * Analyze multiple images with GPT-4o Vision
 * Handles compression, detail level selection on Railway
 * Note: Splitting is handled in /api/analyze-url endpoint
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

    console.log(`🔍 Analyzing ${imageUrls.length} images with GPT-4 Vision...`)

    // Process images in parallel (Railway has no limits)
    const imageProcessingResults = await Promise.all(
      imageUrls.map(async (url, index) => {
        try {
          // Fetch image with timeout
          const fetchPromise = fetch(url)
          const response = await withTimeout(
            fetchPromise,
            TIMEOUTS.IMAGE_FETCH,
            `Image ${index + 1} fetch timed out`
          )
          
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
          }

          const arrayBufferPromise = response.arrayBuffer()
          const arrayBuffer = await withTimeout(
            arrayBufferPromise,
            TIMEOUTS.IMAGE_FETCH,
            `Image ${index + 1} download timed out`
          )

          const originalBuffer = Buffer.from(arrayBuffer)
          const mimeType = response.headers.get('content-type') || 'image/png'

          // Compress image (on Railway - no limits)
          const compressionSettings = getCompressionSettings(mimeType)
          const compressionPromise = compressImage(originalBuffer, compressionSettings)
          const compressionResult = await withTimeout(
            compressionPromise,
            TIMEOUTS.IMAGE_COMPRESSION,
            `Image ${index + 1} compression timed out`
          )

          // Log compression stats
          console.log(`📦 Image ${index + 1}: ${(compressionResult.originalSize / 1024).toFixed(1)}KB → ${(compressionResult.compressedSize / 1024).toFixed(1)}KB (${compressionResult.compressionRatio}% reduction)`)

          // Determine detail level
          const metadataAfterCompression = await sharp(compressionResult.buffer).metadata()
          const needsHighDetail = !quickComplexityCheck(
            compressionResult.buffer,
            metadataAfterCompression.width,
            metadataAfterCompression.height
          )
          const detailLevel = needsHighDetail ? 'high' : 'low'
          console.log(`🔍 Image ${index + 1}: Using detail="${detailLevel}"`)

          // Convert to base64
          const base64 = compressionResult.buffer.toString('base64')

          return {
            type: 'image_url',
            image_url: {
              url: `data:${compressionResult.mimeType};base64,${base64}`,
              detail: detailLevel
            }
          }
        } catch (error) {
          if (error.message && error.message.includes('timed out')) {
            console.error(`⏱️ Timeout: ${error.message}`)
            return null
          }
          console.error(`Failed to fetch/compress image ${url}:`, error)
          return null
        }
      })
    )

    // Filter out failed image fetches
    const validImages = imageProcessingResults.filter(img => img !== null)

    if (validImages.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch all images'
      })
    }

    // Call GPT-4 Vision API with timeout
    try {
      // Match production screenshot prompts (Vercel /api/analyze-images fallback)
      // so we can compare behavior apples-to-apples.
      const completionPromise = openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            // Use the same default as frontend's processWithCurrentImplementation
            content: systemMessage || 'You are a form analysis expert. Extract all form fields from the provided images.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                // Same default user message as frontend
                text: userMessage || 'Analyze these images and extract all form fields.'
              },
              ...validImages
            ]
          }
        ],
        // Use a high but model-safe max_tokens (GPT-4o cap is 16384)
        max_tokens: 16000,
        temperature: 0.1
        // Note: Not using response_format: json_object because we need array/fields array,
        // parsing logic below already handles both array and object-with-fields.
      })

      const completion = await withTimeout(
        completionPromise,
        TIMEOUTS.GPT_VISION_API,
        `GPT-4o Vision API call timed out after ${TIMEOUTS.GPT_VISION_API}ms`
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

      // Check if response was truncated due to token limit
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
        
        // Try to match JSON array first (most common for field extraction)
        let jsonMatch = cleanedText.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0])
        } else {
          // Try to match JSON object
          jsonMatch = cleanedText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            parsedResponse = JSON.parse(jsonMatch[0])
          } else {
            // Try parsing the whole cleaned text
            parsedResponse = JSON.parse(cleanedText)
          }
        }
      } catch (parseError) {
        console.error('Failed to parse GPT response:', responseText)
        const openBraces = (responseText.match(/\{/g)?.length || 0)
        const closeBraces = (responseText.match(/\}/g)?.length || 0)
        const openBrackets = (responseText.match(/\[/g)?.length || 0)
        const closeBrackets = (responseText.match(/\]/g)?.length || 0)
        const isTruncated = (openBraces > closeBraces) || (openBrackets > closeBrackets)
        
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

      console.log(`✅ Successfully analyzed ${validImages.length} images`)

      // Handle both array response and object with fields property
      let fields = []
      if (Array.isArray(parsedResponse)) {
        fields = parsedResponse
      } else if (parsedResponse.fields && Array.isArray(parsedResponse.fields)) {
        fields = parsedResponse.fields
      } else if (parsedResponse && typeof parsedResponse === 'object') {
        // If it's an object but no fields property, try to extract fields
        console.warn('⚠️ Unexpected response format, attempting to extract fields')
        fields = []
      }

      return res.json({
        success: true,
        fields: fields,
        imagesAnalyzed: validImages.length
      })

    } catch (error) {
      if (error.message && error.message.includes('timed out')) {
        return res.status(504).json({
          success: false,
          error: error.message,
          errorType: 'TIMEOUT',
          suggestion: 'Try splitting the form into smaller sections or reducing image resolution.'
        })
      }
      throw error
    }

  } catch (error) {
    console.error('❌ Image analysis error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Image analysis failed'
    })
  }
})

module.exports = router
