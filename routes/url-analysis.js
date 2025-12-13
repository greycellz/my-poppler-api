const express = require('express')
const router = express.Router()
const OpenAI = require('openai')
const sharp = require('sharp')
const { compressImage, getCompressionSettings } = require('../utils/image-compression')
const { quickComplexityCheck } = require('../utils/image-complexity-detector')
const { splitTallImage, mergeFieldExtractions } = require('../utils/image-splitter')
const { withTimeout, TIMEOUTS } = require('../utils/timeout')

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Configuration
const SPLIT_MAX_HEIGHT = parseInt(process.env.IMAGE_SPLIT_MAX_HEIGHT || '4000', 10)
const SPLIT_OVERLAP = parseInt(process.env.IMAGE_SPLIT_OVERLAP || '200', 10)

/**
 * POST /analyze-url
 * Analyze a form URL by taking screenshot, splitting if needed, and processing with Vision API
 */
router.post('/analyze-url', async (req, res) => {
  try {
    const { url, screenshotUrl, systemMessage, userMessage, additionalContext } = req.body

    if (!screenshotUrl && !url) {
      return res.status(400).json({
        success: false,
        error: 'Either url or screenshotUrl is required'
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
