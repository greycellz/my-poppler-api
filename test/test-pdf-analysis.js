/**
 * Manual integration test for PDF analysis via Railway backend
 * Tests the complete flow: PDF upload → image conversion → Vision API analysis
 * 
 * Usage:
 *   RAILWAY_URL=https://my-poppler-api-dev.up.railway.app node test/test-pdf-analysis.js
 *   PDF_PATH=/path/to/pdf.pdf node test/test-pdf-analysis.js
 */

const fs = require('fs')
const path = require('path')

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'
const PDF_PATH = process.env.PDF_PATH || path.join(__dirname, '../../chatterforms/Heinz_Intake Questionnaire.pdf')

async function testPdfAnalysis() {
  console.log('🚀 Testing PDF Analysis via Railway Backend\n')
  console.log(`Railway URL: ${RAILWAY_URL}`)
  console.log(`PDF Path: ${PDF_PATH}\n`)

  // Check if PDF file exists
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`❌ PDF file not found: ${PDF_PATH}`)
    console.error('Please provide PDF_PATH environment variable or place PDF in expected location')
    process.exit(1)
  }

  const pdfStats = fs.statSync(PDF_PATH)
  console.log(`📄 PDF File: ${path.basename(PDF_PATH)}`)
  console.log(`   Size: ${(pdfStats.size / 1024 / 1024).toFixed(2)} MB\n`)

  try {
    // Step 1: Upload PDF and convert to images
    console.log('📤 Step 1: Uploading PDF and converting to images...')
    const pdfBuffer = fs.readFileSync(PDF_PATH)
    
    // Use form-data package for Node.js with proper stream handling
    const FormData = require('form-data')
    const https = require('https')
    const { URL } = require('url')
    
    const formData = new FormData()
    formData.append('pdf', pdfBuffer, {
      filename: path.basename(PDF_PATH),
      contentType: 'application/pdf'
    })

    const uploadStartTime = Date.now()
    
    // Parse URL for https request
    const url = new URL(`${RAILWAY_URL}/upload`)
    const headers = formData.getHeaders()
    
    // Use https.request with form-data stream
    const uploadResponse = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: headers
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            json: async () => {
              try {
                return JSON.parse(data)
              } catch (e) {
                return { error: data }
              }
            },
            text: async () => data
          })
        })
      })
      
      req.on('error', reject)
      formData.pipe(req)
    })

    if (!uploadResponse.ok) {
      let errorData = {}
      try {
        const text = await uploadResponse.text()
        try {
          errorData = JSON.parse(text)
        } catch {
          errorData = { error: text || 'Unknown error' }
        }
      } catch (e) {
        errorData = { error: 'Failed to parse error response' }
      }
      console.error('❌ PDF upload failed:', uploadResponse.status)
      console.error('Error:', JSON.stringify(errorData, null, 2))
      console.error('Response headers:', Object.fromEntries(uploadResponse.headers.entries()))
      process.exit(1)
    }

    const uploadData = await uploadResponse.json()
    const uploadTime = Date.now() - uploadStartTime

    console.log(`✅ PDF converted to images (${uploadTime}ms)`)
    console.log(`   UUID: ${uploadData.uuid}`)
    console.log(`   Total pages: ${uploadData.totalPages}`)
    console.log(`   Images: ${uploadData.images?.length || 0}\n`)

    if (!uploadData.images || uploadData.images.length === 0) {
      console.error('❌ No images generated from PDF')
      process.exit(1)
    }

    // Step 2: Analyze images with Vision API
    console.log('🔍 Step 2: Analyzing images with Vision API...')
    const imageUrls = uploadData.images.map(img => img.url)
    console.log(`   Processing ${imageUrls.length} page(s)...\n`)

    const analysisStartTime = Date.now()
    const analysisResponse = await fetch(`${RAILWAY_URL}/api/analyze-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls,
        systemMessage: `You are a form analysis expert. Analyze these PDF page images and extract ALL visible form fields.

For each field you identify, determine:

1. **Field Label**: The visible text label (exactly as shown). IMPORTANT: If a field is part of a numbered question (e.g., "2. Question text"), include the question number in the label (e.g., "2. Medication Name" not just "Medication Name"). Preserve the full context including question numbers when they appear before field labels.

2. **Field Type**: Choose the most appropriate type based on visual structure:
   - text: for single-line text inputs (names, addresses, single values)
   - email: for email address fields
   - tel: for phone/telephone number fields  
   - textarea: for large text areas, comments, messages
   - select: for dropdown menus with arrow indicators
   - radio-with-other: for radio buttons that include "Other:" with text input
   - checkbox-with-other: for checkbox groups that include "Other:" with text input
   - date: for date picker fields

3. **Required Status**: Look for visual indicators:
   - Red asterisks (*)
   - "(required)" text
   - "(optional)" text (mark as not required)
   - Red field borders or labels

4. **Options Extraction**: For dropdowns/radio buttons/checkboxes, extract ALL visible options

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
]`,
        userMessage: 'Analyze these PDF form pages and extract all visible form fields.'
      })
    })

    const analysisTime = Date.now() - analysisStartTime
    const totalTime = Date.now() - uploadStartTime

    if (!analysisResponse.ok) {
      const errorData = await analysisResponse.json().catch(() => ({}))
      console.error('❌ Image analysis failed:', analysisResponse.status)
      console.error('Error:', JSON.stringify(errorData, null, 2))
      
      // Cleanup before exiting
      try {
        await fetch(`${RAILWAY_URL}/cleanup/${uploadData.uuid}`, { method: 'DELETE' })
      } catch (e) {
        // Ignore cleanup errors
      }
      process.exit(1)
    }

    const analysisData = await analysisResponse.json()
    
    console.log('✅ Analysis completed\n')
    console.log('Results:')
    console.log(`  Success: ${analysisData.success !== false}`)
    console.log(`  Fields extracted: ${analysisData.fields?.length || 0}`)
    console.log(`  Images analyzed: ${analysisData.imagesAnalyzed || imageUrls.length}`)
    console.log(`  Analysis time: ${analysisTime}ms`)
    console.log(`  Total time: ${totalTime}ms\n`)

    if (analysisData.fields && analysisData.fields.length > 0) {
      console.log(`📋 All extracted fields (${analysisData.fields.length} total):\n`)
      analysisData.fields.forEach((field, i) => {
        const optionsStr = field.options && field.options.length > 0 
          ? ` [${field.options.length} options: ${field.options.slice(0, 3).join(', ')}${field.options.length > 3 ? '...' : ''}]` 
          : ''
        const requiredStr = field.required ? ' *' : ''
        const otherStr = field.allowOther ? ' [has Other option]' : ''
        const pageStr = field.pageNumber ? ` [page ${field.pageNumber}]` : ''
        const confStr = field.confidence ? ` (${(field.confidence * 100).toFixed(0)}% confidence)` : ''
        console.log(`  ${i + 1}. "${field.label}"${requiredStr} (${field.type})${optionsStr}${otherStr}${pageStr}${confStr}`)
      })
      console.log('')
    } else {
      console.log('⚠️ No fields extracted')
    }

    // Field type breakdown
    if (analysisData.fields && analysisData.fields.length > 0) {
      const typeCounts = {}
      analysisData.fields.forEach(f => {
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1
      })
      
      console.log('📊 Field type breakdown:')
      Object.entries(typeCounts).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`)
      })
      console.log('')
    }

    // Page distribution
    if (analysisData.fields && analysisData.fields.length > 0) {
      const pageCounts = {}
      analysisData.fields.forEach(f => {
        const page = f.pageNumber || 1
        pageCounts[page] = (pageCounts[page] || 0) + 1
      })
      
      console.log('📄 Fields per page:')
      Object.entries(pageCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([page, count]) => {
        console.log(`  Page ${page}: ${count} fields`)
      })
      console.log('')
    }

    console.log(`⏱️ Performance Metrics:`)
    console.log(`  PDF upload: ${uploadTime}ms`)
    console.log(`  Image analysis: ${analysisTime}ms`)
    console.log(`  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`)
    console.log(`  Average per page: ${Math.round(analysisTime / imageUrls.length)}ms\n`)

    // Validate field structure
    console.log(`✅ Field structure validation:`)
    const invalidFields = analysisData.fields?.filter(f => {
      return !f.label || !f.type
    }) || []
    if (invalidFields.length > 0) {
      console.log(`  ⚠️ Found ${invalidFields.length} fields with missing required properties`)
    } else {
      console.log(`  ✅ All fields have required properties (label, type)`)
    }

    // Check for required fields
    const requiredFields = analysisData.fields?.filter(f => f.required) || []
    console.log(`  Required fields: ${requiredFields.length} / ${analysisData.fields?.length || 0}`)

    // Check for question number preservation
    if (analysisData.fields && analysisData.fields.length > 0) {
      const fieldsWithNumbers = analysisData.fields.filter(f => 
        /^\d+\.\s/.test(f.label) // Matches patterns like "1. ", "2. ", etc.
      )
      console.log(`\n🔢 Question number preservation:`)
      console.log(`  Fields with question numbers: ${fieldsWithNumbers.length} / ${analysisData.fields.length}`)
      if (fieldsWithNumbers.length > 0) {
        console.log(`  Sample numbered fields:`)
        fieldsWithNumbers.slice(0, 5).forEach(f => {
          console.log(`    - "${f.label}"`)
        })
      }
    }

    // Step 3: Cleanup
    console.log('\n🗑️ Step 3: Cleaning up Railway files...')
    try {
      const cleanupResponse = await fetch(`${RAILWAY_URL}/cleanup/${uploadData.uuid}`, {
        method: 'DELETE'
      })
      if (cleanupResponse.ok) {
        console.log('✅ Cleanup successful\n')
      } else {
        console.log('⚠️ Cleanup failed (non-critical)\n')
      }
    } catch (error) {
      console.log('⚠️ Cleanup error (non-critical):', error.message)
    }

    console.log('🎉 PDF analysis test completed successfully!')
    return {
      success: true,
      fieldsExtracted: analysisData.fields?.length || 0,
      totalTime,
      analysisTime,
      uploadTime
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    if (error.stack) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

// Note: Using form-data package for FormData in Node.js

// Run the test
if (require.main === module) {
  testPdfAnalysis()
    .then(result => {
      if (result && result.success) {
        console.log(`\n✅ Test Summary:`)
        console.log(`   Fields extracted: ${result.fieldsExtracted}`)
        console.log(`   Total time: ${(result.totalTime / 1000).toFixed(2)}s`)
        console.log(`   Analysis time: ${(result.analysisTime / 1000).toFixed(2)}s`)
        console.log(`   Upload time: ${(result.uploadTime / 1000).toFixed(2)}s`)
      }
      process.exit(0)
    })
    .catch(error => {
      console.error('Unhandled error:', error)
      process.exit(1)
    })
}

module.exports = { testPdfAnalysis }
