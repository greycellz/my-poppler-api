/**
 * Manual integration test for HTML scraping endpoint
 * Tests the /api/analyze-url-html endpoint with a real form URL
 */

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'
const FORM_URL = process.env.FORM_URL || 'https://www.chatterforms.com/forms/form_1765518416011_bszeswqcu'

async function testHtmlScraping() {
  console.log('🚀 Testing HTML Scraping Endpoint\n')
  console.log(`Railway URL: ${RAILWAY_URL}`)
  console.log(`Form URL: ${FORM_URL}\n`)

  try {
    console.log('📤 Sending request to Railway /api/analyze-url-html...\n')
    const startTime = Date.now()
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-url-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: FORM_URL
      })
    })

    const totalTime = Date.now() - startTime

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Request failed:', response.status)
      console.error('Error:', JSON.stringify(errorData, null, 2))
      process.exit(1)
    }

    const data = await response.json()
    
    console.log('✅ Analysis completed\n')
    console.log('Results:')
    console.log(`  Success: ${data.success}`)
    console.log(`  Fields extracted: ${data.fields?.length || 0}`)
    console.log(`  Method: ${data.method}`)
    console.log(`  Processing time: ${data.processingTimeMs}ms`)
    console.log(`  Total time: ${totalTime}ms\n`)

    if (data.metadata) {
      console.log('Metadata:')
      console.log(`  URL: ${data.metadata.url}`)
      console.log(`  Field count: ${data.metadata.fieldCount}`)
      if (data.metadata.fieldTypes) {
        console.log(`  Field types:`, JSON.stringify(data.metadata.fieldTypes, null, 2))
      }
      console.log('')
    }

    if (data.fields && data.fields.length > 0) {
      console.log(`📋 Sample fields (first 10):`)
      data.fields.slice(0, 10).forEach((field, i) => {
        const optionsStr = field.options && field.options.length > 0 
          ? ` [${field.options.length} options]` 
          : ''
        const requiredStr = field.required ? ' *' : ''
        console.log(`  ${i + 1}. ${field.label}${requiredStr} (${field.type})${optionsStr}`)
      })
      
      if (data.fields.length > 10) {
        console.log(`  ... and ${data.fields.length - 10} more fields`)
      }
      console.log('')
    } else {
      console.log('⚠️ No fields extracted')
    }

    // Field type breakdown
    if (data.fields && data.fields.length > 0) {
      const typeCounts = {}
      data.fields.forEach(f => {
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1
      })
      
      console.log('📊 Field type breakdown:')
      Object.entries(typeCounts).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`)
      })
      console.log('')
    }

    console.log(`⏱️ Total time: ${(totalTime / 1000).toFixed(2)}s\n`)

    // Compare with expected count
    const expectedCount = 120
    const actualCount = data.fields?.length || 0
    if (actualCount < expectedCount * 0.9) {
      console.log(`⚠️ Field count lower than expected (expected ~${expectedCount}, got ${actualCount})`)
    } else {
      console.log(`✅ Field count looks good (expected ~${expectedCount}, got ${actualCount})`)
    }

    // Check for question number preservation
    if (data.fields && data.fields.length > 0) {
      const fieldsWithNumbers = data.fields.filter(f => 
        /^\d+\.\s/.test(f.label) // Matches patterns like "1. ", "2. ", etc.
      )
      console.log(`\n🔢 Question number preservation:`)
      console.log(`  Fields with question numbers: ${fieldsWithNumbers.length} / ${data.fields.length}`)
      if (fieldsWithNumbers.length > 0) {
        console.log(`  Sample numbered fields:`)
        fieldsWithNumbers.slice(0, 5).forEach(f => {
          console.log(`    - "${f.label}"`)
        })
      }
    }

    // Validate field structure
    console.log(`\n✅ Field structure validation:`)
    const invalidFields = data.fields.filter(f => {
      return !f.id || !f.label || !f.type
    })
    if (invalidFields.length > 0) {
      console.log(`  ⚠️ Found ${invalidFields.length} fields with missing required properties`)
    } else {
      console.log(`  ✅ All fields have required properties (id, label, type)`)
    }

    // Check for required fields
    const requiredFields = data.fields.filter(f => f.required)
    console.log(`  Required fields: ${requiredFields.length} / ${data.fields.length}`)

  } catch (error) {
    console.error('❌ Test failed:', error)
    if (error.stack) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

testHtmlScraping()
