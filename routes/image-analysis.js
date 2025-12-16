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

    // Use provided system message or default (text-focused prompt for OCR analysis)
    const defaultSystemMessage = systemMessage || `You are a form analysis expert. You will receive OCR TEXT (not images) extracted from PDF form pages. Analyze this TEXT to extract ALL form fields with high accuracy.

**NO DEDUPLICATION**: Do NOT deduplicate fields. If two fields have similar text (same label, same wording, same type) but appear in different locations, rows, or pages, return them as SEPARATE field objects. Examples:
- "Phone (Work)" and "Phone (Other, please specify)" must be separate fields, even if both are phone inputs
- Repeated "Yes/No" questions on different pages must each be separate fields
- "If living, age and health status" for Mother vs Father must be separate fields

**ALWAYS KEEP CONDITIONAL QUESTIONS**: Treat every "If yes, ...", "If no, ...", "If applicable, ...", "If you have used..., do you feel...", and every table/row instruction as its OWN field, not just explanation. Even if the wording is short and appears to be a sub-clause, if it asks the user to provide information or choose an option, it must be a field.

**GROUP OPTIONS WITH MAIN QUESTION**: For checkbox, radio, or dropdown options:
- Identify the main question label (the line that describes what is being asked)
- Attach ALL options for that question to a SINGLE field object in the "options" array
- Do NOT create separate fields for each option; they must be grouped under the main question
- CRITICAL: When the text contains Yes/No questions, ALWAYS include BOTH options. If the text shows "Yes" and "No, please mail it to my home address" or similar variations, include ALL of them in the options array. Search carefully in the OCR text - if a question has "Yes" mentioned, search for the corresponding "No" option even if it's on a different line or has additional text like "No, please mail it to my home address"
- If the text shows "Other: ______" below radio/checkboxes, set allowOther: true, otherLabel, and otherPlaceholder
- CRITICAL: When the text shows patterns like "(If yes) Full-time" and "(If yes) Part-time" under the same question, combine them into ONE field with label "If yes, Full-time/Part-time" (use forward slash, remove duplicate "If yes" prefix). Do NOT create separate fields for each option. Do NOT create duplicate fields - if the same field label appears multiple times, it should only be extracted once.

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

2. **Field Type**: Choose the most appropriate type based on what you find in the OCR text:
   - text: for single-line text inputs (names, addresses, single values). CRITICAL: If the OCR text shows a field label with a blank line or filled value underneath, treat it as type "text" - do NOT infer radio/select types from filled sample data. If the text shows "3. Gender" followed by a value like "Male", use type "text", NOT "select" or "radio"
   - email: for email address fields
   - tel: for phone/telephone number fields  
   - textarea: for large text areas, comments, messages, or multi-line inputs
   - select: ONLY when the OCR text shows multiple distinct options listed together (like "Yes", "No", "Maybe") indicating a dropdown or selection. Do NOT use "select" for fields that show only a single value
   - radio-with-other: when the OCR text shows multiple radio button options AND includes "Other:" with a text input
   - checkbox-with-other: when the OCR text shows multiple checkbox options AND includes "Other:" with a text input
   - date: for date picker fields (usually shown as mm/dd/yyyy or similar)
   
   IMPORTANT: Do NOT infer field types from filled sample data in the OCR text. If a form field shows only a single value (even something like "Male"), use type "text", not "radio" or "select". Only use "select" or "radio" when the OCR text explicitly shows multiple choice options.

3. **Required Status**: Find text indicators in the OCR:
   - Asterisks (*) near field labels
   - "(required)" text
   - "(optional)" text (mark as not required)
   - Default to false if no indicator found

4. **Options Extraction**: When the OCR text shows multiple choice options, extract ALL of them and group with the main question label:
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
[
  {
    "label": "Field Label Text",
    "type": "text|email|tel|textarea|select|date|radio-with-other|checkbox-with-other",
    "required": true/false,
    "placeholder": "Placeholder text if visible",
    "options": ["Option 1", "Option 2"] (for select/radio/checkbox),
    "allowOther": true/false (ONLY true if the text shows "Other:" with text input),
    "otherLabel": "Other:" (ONLY if allowOther is true),
    "otherPlaceholder": "Please specify..." (ONLY if allowOther is true),
    "confidence": 0.95,
    "pageNumber": 1
  }
]

IMPORTANT: For most fields, allowOther should be false. Only set to true when the text clearly shows "Other:" with a text input field.

EXAMPLE: If the text contains options like:
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
    
    // Log response for debugging
    console.log('🔍 Groq Response Length:', responseText.length)
    console.log('🔍 Groq Response (first 500 chars):', responseText.substring(0, 500))
    console.log('🔍 Groq Response (last 200 chars):', responseText.substring(Math.max(0, responseText.length - 200)))
    
    let fields = []

    try {
      // Try to parse as JSON
      const parsed = JSON.parse(responseText)
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
        const extracted = JSON.parse(jsonMatch[1])
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

