/**
 * Test Google Vision + Groq full pipeline
 * 
 * Usage:
 *   RAILWAY_URL=https://my-poppler-api-dev.up.railway.app node test/test-google-vision-full.js
 */

const fetch = global.fetch || require('node-fetch')

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'
const API_URL = `${RAILWAY_URL}/api/test-google-vision-full`

// Example image URLs from PDF upload
const TEST_IMAGE_URLS = process.env.IMAGE_URLS 
  ? JSON.parse(process.env.IMAGE_URLS)
  : [
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-1.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-2.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-3.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-4.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-5.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-6.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-7.png',
      'https://my-poppler-api-dev.up.railway.app/output/48fec35c-3845-4906-acd0-bce41db9f40b/page-8.png'
    ]

async function testFullPipeline() {
  console.log('🚀 Testing Google Vision + Groq Full Pipeline\n')
  console.log(`Railway URL: ${RAILWAY_URL}`)
  console.log(`Images to process: ${TEST_IMAGE_URLS.length}\n`)

  try {
    const startTime = Date.now()
    
    console.log('📤 Sending request to full pipeline endpoint...')
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageUrls: TEST_IMAGE_URLS
      })
    })

    const totalTime = Date.now() - startTime

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Request failed:', response.status)
      console.error(JSON.stringify(errorData, null, 2))
      process.exit(1)
    }

    const data = await response.json()

    if (!data.success) {
      console.error('❌ Pipeline failed')
      console.error(JSON.stringify(data, null, 2))
      process.exit(1)
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ FULL PIPELINE SUCCESS')
    console.log('='.repeat(80))
    
    // Analytics Summary
    console.log('\n📊 ANALYTICS SUMMARY:')
    console.log('─'.repeat(80))
    console.log(`Total Time: ${data.analytics.totalTime}ms (${(data.analytics.totalTime / 1000).toFixed(2)}s)`)
    console.log(`\n🔍 Google Vision API:`)
    console.log(`   Total Time: ${data.analytics.visionApi.totalTime}ms (${(data.analytics.visionApi.totalTime / 1000).toFixed(2)}s)`)
    console.log(`   Average per Image: ${data.analytics.visionApi.averageTime.toFixed(0)}ms`)
    console.log(`   Total Characters: ${data.analytics.visionApi.totalCharacters.toLocaleString()}`)
    console.log(`\n   Per Image Breakdown:`)
    data.analytics.visionApi.perImage.forEach((img, i) => {
      console.log(`   Page ${img.page}: ${img.time}ms, ${img.characters.toLocaleString()} chars`)
    })
    
    console.log(`\n🤖 Groq API:`)
    console.log(`   Time: ${data.analytics.groqApi.time}ms (${(data.analytics.groqApi.time / 1000).toFixed(2)}s)`)
    console.log(`   Input Tokens: ${data.analytics.groqApi.inputTokens.toLocaleString()}`)
    console.log(`   Output Tokens: ${data.analytics.groqApi.outputTokens.toLocaleString()}`)
    console.log(`   Total Tokens: ${data.analytics.groqApi.totalTokens.toLocaleString()}`)
    
    console.log(`\n📋 Fields Extracted:`)
    console.log(`   Total: ${data.analytics.fields.count}`)
    console.log(`   By Type:`)
    Object.entries(data.analytics.fields.byType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`)
    })
    console.log(`   By Page:`)
    Object.entries(data.analytics.fields.byPage)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .forEach(([page, count]) => {
        console.log(`     Page ${page}: ${count} fields`)
      })

    // Performance Comparison
    console.log('\n⚡ PERFORMANCE COMPARISON:')
    console.log('─'.repeat(80))
    const visionTime = data.analytics.visionApi.totalTime
    const groqTime = data.analytics.groqApi.time
    const totalTime = data.analytics.totalTime
    const baselineTime = 200000 // ~200s for GPT-4o Vision baseline
    
    console.log(`Current (Google Vision + Groq): ${(totalTime / 1000).toFixed(2)}s`)
    console.log(`  - Vision OCR: ${(visionTime / 1000).toFixed(2)}s`)
    console.log(`  - Groq Structuring: ${(groqTime / 1000).toFixed(2)}s`)
    console.log(`Baseline (GPT-4o Vision): ~${(baselineTime / 1000).toFixed(2)}s`)
    console.log(`Speedup: ${(baselineTime / totalTime).toFixed(1)}x faster`)

    // Sample Fields
    console.log('\n📝 SAMPLE FIELDS (first 10):')
    console.log('─'.repeat(80))
    data.fields.slice(0, 10).forEach((field, i) => {
      console.log(`${i + 1}. ${field.label}`)
      console.log(`   Type: ${field.type}, Required: ${field.required}, Page: ${field.pageNumber || 'N/A'}`)
      if (field.options && field.options.length > 0) {
        console.log(`   Options: ${field.options.slice(0, 3).join(', ')}${field.options.length > 3 ? '...' : ''}`)
      }
    })
    if (data.fields.length > 10) {
      console.log(`\n... and ${data.fields.length - 10} more fields`)
    }

    // OCR Text Preview
    console.log('\n📄 OCR TEXT PREVIEW (first 500 chars from page 1):')
    console.log('─'.repeat(80))
    if (data.ocrText.perPage && data.ocrText.perPage.length > 0) {
      console.log(data.ocrText.perPage[0].text)
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ TEST COMPLETE')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

testFullPipeline().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

