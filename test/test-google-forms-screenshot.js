/**
 * Test script for Google Forms URL with per-page screenshot approach
 * Tests the /screenshot-pages endpoint and then OCR extraction
 * 
 * Usage: node test/test-google-forms-screenshot.js
 * 
 * Environment variables:
 * - RAILWAY_URL: Railway backend URL (default: https://my-poppler-api-dev.up.railway.app)
 * - FORM_URL: Form URL to test (default: Google Forms URL from issue)
 */

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'
const FORM_URL = process.env.FORM_URL || 'https://docs.google.com/forms/d/e/1FAIpQLScsEI0BPB3USqckuCsyXdfNct15nhZxEDtaiilIsBztA189ig/viewform'

const fs = require('fs')
const path = require('path')

async function testScreenshotPages() {
  console.log('\n🚀 Testing Per-Page Screenshot Capture\n')
  console.log(`Railway URL: ${RAILWAY_URL}`)
  console.log(`Form URL: ${FORM_URL}\n`)

  try {
    // Step 1: Test screenshot-pages endpoint
    console.log('📸 Step 1: Testing /screenshot-pages endpoint...\n')
    const screenshotStartTime = Date.now()
    
    const screenshotResponse = await fetch(`${RAILWAY_URL}/screenshot-pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: FORM_URL,
        options: {
          viewport: { width: 1280, height: 800 },
          waitTime: 4000,
          scrollDelay: 500,
          overlap: 50
        }
      })
    })

    const screenshotTime = Date.now() - screenshotStartTime

    if (!screenshotResponse.ok) {
      const errorData = await screenshotResponse.json().catch(() => ({}))
      console.error('❌ Screenshot capture failed:', screenshotResponse.status)
      console.error('Error:', JSON.stringify(errorData, null, 2))
      process.exit(1)
    }

    const screenshotData = await screenshotResponse.json()
    
    console.log('✅ Screenshot capture completed\n')
    console.log('Results:')
    console.log(`  Success: ${screenshotData.success}`)
    console.log(`  Total pages: ${screenshotData.metadata?.totalPages || 0}`)
    console.log(`  Total height: ${screenshotData.metadata?.totalHeight || 0}px`)
    console.log(`  Viewport: ${screenshotData.metadata?.viewportWidth || 0}x${screenshotData.metadata?.viewportHeight || 0}px`)
    console.log(`  Processing time: ${screenshotData.metadata?.processingTime || screenshotTime}ms`)
    console.log(`  Screenshots captured: ${screenshotData.screenshots?.length || 0}\n`)

    if (!screenshotData.screenshots || screenshotData.screenshots.length === 0) {
      console.error('❌ No screenshots captured!')
      process.exit(1)
    }

    // Display screenshot details
    console.log('📸 Screenshot Details:\n')
    screenshotData.screenshots.forEach((screenshot, index) => {
      console.log(`  ${index + 1}. Page ${screenshot.pageNumber}`)
      console.log(`     URL: ${screenshot.url}`)
      console.log(`     Scroll position: ${screenshot.scrollPosition}px`)
      console.log(`     Cached: ${screenshot.cached ? 'Yes' : 'No'}`)
      console.log(`     Size: ${(screenshot.size / 1024).toFixed(2)} KB`)
      console.log('')
    })

    // Step 2: Test OCR extraction for each screenshot
    console.log('\n🔍 Step 2: Testing OCR extraction from each screenshot...\n')
    
    const visionResults = []
    
    for (let i = 0; i < screenshotData.screenshots.length; i++) {
      const screenshot = screenshotData.screenshots[i]
      console.log(`📄 Processing screenshot ${i + 1}/${screenshotData.screenshots.length}...`)
      console.log(`   URL: ${screenshot.url}`)
      
      try {
        // Fetch the screenshot
        const imageResponse = await fetch(screenshot.url)
        if (!imageResponse.ok) {
          console.error(`   ❌ Failed to fetch screenshot: ${imageResponse.status}`)
          continue
        }

        const arrayBuffer = await imageResponse.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const base64Content = buffer.toString('base64')

        // Call Vision API directly (if you have access) or use the analyze-url endpoint
        // For now, let's use the analyze-url endpoint with single screenshotUrl
        const ocrResponse = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screenshotUrl: screenshot.url,
            url: FORM_URL
          })
        })

        if (!ocrResponse.ok) {
          const errorData = await ocrResponse.json().catch(() => ({}))
          console.error(`   ❌ OCR failed: ${ocrResponse.status}`)
          console.error(`   Error: ${JSON.stringify(errorData, null, 2)}`)
          continue
        }

        // For single screenshot, we get OpenAI Vision response
        // Let's extract what we can from the response
        const ocrData = await ocrResponse.json()
        
        console.log(`   ✅ OCR completed`)
        if (ocrData.fields) {
          console.log(`   Fields found: ${ocrData.fields.length}`)
          console.log(`   Sample fields:`)
          ocrData.fields.slice(0, 3).forEach((field, idx) => {
            console.log(`     - ${field.label} (${field.type})`)
          })
        }
        console.log('')

        visionResults.push({
          pageNumber: screenshot.pageNumber,
          scrollPosition: screenshot.scrollPosition,
          fields: ocrData.fields || [],
          fieldCount: ocrData.fields?.length || 0
        })

      } catch (error) {
        console.error(`   ❌ Error processing screenshot ${i + 1}:`, error.message)
        console.log('')
      }
    }

    // Step 3: Test full pipeline with screenshotUrls array
    console.log('\n🔄 Step 3: Testing full pipeline with screenshotUrls array...\n')
    
    const fullPipelineStartTime = Date.now()
    
    const fullPipelineResponse = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screenshotUrls: screenshotData.screenshots.map(s => s.url),
        url: FORM_URL,
        additionalContext: `Multi-page Google Form (${screenshotData.screenshots.length} pages)`
      })
    })

    const fullPipelineTime = Date.now() - fullPipelineStartTime

    if (!fullPipelineResponse.ok) {
      const errorData = await fullPipelineResponse.json().catch(() => ({}))
      console.error('❌ Full pipeline failed:', fullPipelineResponse.status)
      console.error('Error:', JSON.stringify(errorData, null, 2))
      process.exit(1)
    }

    const fullPipelineData = await fullPipelineResponse.json()
    
    console.log('✅ Full pipeline completed\n')
    console.log('Results:')
    console.log(`  Success: ${fullPipelineData.success}`)
    console.log(`  Fields extracted: ${fullPipelineData.fields?.length || 0}`)
    console.log(`  Images analyzed: ${fullPipelineData.imagesAnalyzed || 0}`)
    console.log(`  Images requested: ${fullPipelineData.imagesRequested || 0}`)
    console.log(`  Images failed: ${fullPipelineData.imagesFailed || 0}`)
    console.log(`  Method: ${fullPipelineData.method || 'unknown'}`)
    console.log(`  Processing time: ${fullPipelineTime}ms\n`)

    // Analyze fields for duplication
    if (fullPipelineData.fields && fullPipelineData.fields.length > 0) {
      console.log('📊 Field Analysis:\n')
      
      // Check for duplicates
      const fieldLabels = fullPipelineData.fields.map(f => f.label?.trim().toLowerCase() || '')
      const uniqueLabels = new Set(fieldLabels)
      const duplicates = fieldLabels.length - uniqueLabels.size
      
      console.log(`  Total fields: ${fullPipelineData.fields.length}`)
      console.log(`  Unique labels: ${uniqueLabels.size}`)
      console.log(`  Duplicates: ${duplicates}`)
      
      if (duplicates > 0) {
        console.log('\n  ⚠️ Duplicate fields detected!')
        
        // Find most common duplicates
        const labelCounts = {}
        fieldLabels.forEach(label => {
          labelCounts[label] = (labelCounts[label] || 0) + 1
        })
        
        const duplicatesList = Object.entries(labelCounts)
          .filter(([label, count]) => count > 1)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
        
        console.log('\n  Most duplicated fields:')
        duplicatesList.forEach(([label, count]) => {
          console.log(`    "${label}": ${count} times`)
        })
      }
      
      // Field type breakdown
      const typeCounts = {}
      fullPipelineData.fields.forEach(f => {
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1
      })
      
      console.log('\n  Field type breakdown:')
      Object.entries(typeCounts).forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`)
      })
      
      // Show all fields
      console.log('\n📋 All Extracted Fields:\n')
      fullPipelineData.fields.forEach((field, i) => {
        const optionsStr = field.options && field.options.length > 0 
          ? ` [${field.options.length} options]` 
          : ''
        const requiredStr = field.required ? ' *' : ''
        console.log(`  ${i + 1}. "${field.label}"${requiredStr} (${field.type})${optionsStr}`)
      })
    } else {
      console.log('⚠️ No fields extracted')
    }

    // Compare with per-screenshot results
    console.log('\n📊 Per-Screenshot Field Count:\n')
    visionResults.forEach(result => {
      console.log(`  Page ${result.pageNumber} (scroll: ${result.scrollPosition}px): ${result.fieldCount} fields`)
    })
    
    const totalFieldsFromIndividual = visionResults.reduce((sum, r) => sum + r.fieldCount, 0)
    console.log(`\n  Total from individual screenshots: ${totalFieldsFromIndividual}`)
    console.log(`  Total from full pipeline: ${fullPipelineData.fields?.length || 0}`)
    
    if (totalFieldsFromIndividual > (fullPipelineData.fields?.length || 0) * 1.5) {
      console.log('\n  ⚠️ Individual screenshots have more fields - deduplication might be too aggressive')
    }

    console.log(`\n⏱️ Total test time: ${((Date.now() - screenshotStartTime) / 1000).toFixed(2)}s\n`)

    // Expected fields for this Google Form
    const expectedFields = [
      'Email',
      'Student Name (First and Last Name)',
      'Grade Level',
      'Parent/Guardian Name (First and Last)',
      'Parent/Guardian Email',
      'Parent/Guardian Cell Number',
      'Which of the following are you reporting?',
      'Date of Single-day Absence',
      'Multi-day Absence',
      'Late Arrival: Approximate arrival time',
      'Early Departure: Departure time',
      'Reason for Absence',
      'has this student been diagnosed',
      'Please name the diagnosis',
      'Date of first symptoms'
    ]

    console.log('✅ Expected Fields Check:\n')
    const foundFields = new Set(fullPipelineData.fields?.map(f => f.label?.toLowerCase()) || [])
    expectedFields.forEach(expected => {
      const found = Array.from(foundFields).some(f => 
        f.includes(expected.toLowerCase()) || expected.toLowerCase().includes(f)
      )
      console.log(`  ${found ? '✅' : '❌'} ${expected}`)
    })

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// Run test
testScreenshotPages().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

