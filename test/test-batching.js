/**
 * Test cases for Phase 2 Batching functionality
 * Tests batching mode, single-request mode, edge cases, and error handling
 * 
 * Usage:
 *   RAILWAY_URL=https://my-poppler-api-dev.up.railway.app node test/test-batching.js
 *   PDF_PATH=/path/to/pdf.pdf node test/test-batching.js
 *   AUTH_TOKEN=your_token node test/test-batching.js
 */

const fs = require('fs')
const path = require('path')

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app'
const PDF_PATH = process.env.PDF_PATH || path.join(__dirname, '../../chatterforms/Heinz_Intake Questionnaire.pdf')
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJYV2lmNU1rZ0MySVcya21oRXBNNiIsImVtYWlsIjoiYWtqX3dvcmsrMTI0QHlhaG9vLmNvbSIsImlhdCI6MTc2NjgyMzQyOSwiZXhwIjoxNzY3NDI4MjI5fQ.GbqPQ4Jtcz6pWDvBdCCbqGiNjqrqg-9Sowr83AW-g2k'

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  summary: {}
}

// Helper function to log test results
function logTest(name, passed, details = {}) {
  if (passed) {
    console.log(`✅ PASS: ${name}`)
    testResults.passed.push({ name, details })
  } else {
    console.error(`❌ FAIL: ${name}`)
    console.error('   Details:', details)
    testResults.failed.push({ name, details })
  }
}

// Helper function to test PDF analysis with specific parameters
async function testPdfAnalysis(options = {}) {
  const {
    enableBatching = false,
    batchSize = 5,
    useReasoningEffort = null,
    description = 'PDF Analysis'
  } = options

  console.log(`\n📋 ${description}`)
  console.log(`   Batching: ${enableBatching ? `enabled (batchSize: ${batchSize})` : 'disabled'}`)
  console.log(`   Reasoning Effort: ${useReasoningEffort || 'none'}`)

  // Check if PDF file exists
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`PDF file not found: ${PDF_PATH}`)
  }

  try {
    // Step 1: Upload PDF and convert to images
    const pdfBuffer = fs.readFileSync(PDF_PATH)
    const FormData = require('form-data')
    const https = require('https')
    const { URL } = require('url')
    
    const formData = new FormData()
    formData.append('pdf', pdfBuffer, {
      filename: path.basename(PDF_PATH),
      contentType: 'application/pdf'
    })

    const url = new URL(`${RAILWAY_URL}/upload`)
    const headers = {
      ...formData.getHeaders(),
      'Authorization': `Bearer ${AUTH_TOKEN}`
    }
    
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
      const errorText = await uploadResponse.text()
      throw new Error(`PDF upload failed: ${uploadResponse.status} - ${errorText}`)
    }

    const uploadData = await uploadResponse.json()
    const uuid = uploadData.uuid
    const pages = uploadData.totalPages || uploadData.pages

    if (!uuid || !pages) {
      throw new Error('Invalid upload response: missing uuid or pages')
    }

    console.log(`   ✅ PDF uploaded: ${uuid}, ${pages} pages`)

    // Step 2: Get image URLs
    const imageUrls = []
    for (let i = 1; i <= pages; i++) {
      imageUrls.push(`${RAILWAY_URL}/output/${uuid}/page-${i}.png`)
    }

    // Step 3: Analyze images with batching options
    const analyzeUrl = new URL(`${RAILWAY_URL}/api/analyze-images`)
    const analyzeResponse = await new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        imageUrls,
        enableBatching,
        batchSize,
        useReasoningEffort
      })

      const req = https.request({
        hostname: analyzeUrl.hostname,
        port: analyzeUrl.port || 443,
        path: analyzeUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
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
      req.write(requestBody)
      req.end()
    })

    if (!analyzeResponse.ok) {
      const errorText = await analyzeResponse.text()
      throw new Error(`Analysis failed: ${analyzeResponse.status} - ${errorText}`)
    }

    const analysisData = await analyzeResponse.json()

    if (!analysisData.success) {
      throw new Error(`Analysis failed: ${analysisData.error}`)
    }

    // Step 4: Cleanup
    const cleanupUrl = new URL(`${RAILWAY_URL}/api/cleanup-pdf/${uuid}`)
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: cleanupUrl.hostname,
        port: cleanupUrl.port || 443,
        path: cleanupUrl.pathname,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }, (res) => {
        res.on('data', () => {})
        res.on('end', resolve)
      })
      
      req.on('error', reject)
      req.end()
    })

    return {
      success: true,
      fields: analysisData.fields || [],
      analytics: analysisData.analytics || {},
      pages,
      uuid
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      fields: [],
      analytics: {},
      pages: 0,
      uuid: null
    }
  }
}

// Test 1: Single-request mode (batching disabled)
async function testSingleRequestMode() {
  console.log('\n🧪 Test 1: Single-Request Mode (Batching Disabled)')
  
  const result = await testPdfAnalysis({
    enableBatching: false,
    description: 'Single-Request Mode Test'
  })

  const checks = {
    success: result.success,
    hasFields: result.fields.length > 0,
    hasAnalytics: !!result.analytics,
    noBatching: !result.analytics.batching,
    hasGroqApi: !!result.analytics.groqApi
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Single-Request Mode', passed, {
    fieldCount: result.fields.length,
    analytics: result.analytics,
    checks
  })

  return { result, checks }
}

// Test 2: Batching mode enabled
async function testBatchingMode() {
  console.log('\n🧪 Test 2: Batching Mode Enabled')
  
  const result = await testPdfAnalysis({
    enableBatching: true,
    batchSize: 3,
    description: 'Batching Mode Test (batchSize: 3)'
  })

  const checks = {
    success: result.success,
    hasFields: result.fields.length > 0,
    hasAnalytics: !!result.analytics,
    hasBatching: !!result.analytics.batching,
    batchingEnabled: result.analytics.batching?.enabled === true,
    hasBatchCount: typeof result.analytics.batching?.batchCount === 'number',
    hasBatchSize: result.analytics.batching?.batchSize === 3,
    hasMergeStats: !!result.analytics.batching?.mergeStats,
    hasGroqApi: !!result.analytics.groqApi
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Batching Mode', passed, {
    fieldCount: result.fields.length,
    batchCount: result.analytics.batching?.batchCount,
    batchSize: result.analytics.batching?.batchSize,
    mergeStats: result.analytics.batching?.mergeStats,
    checks
  })

  return { result, checks }
}

// Test 3: Batching with different batch sizes
async function testDifferentBatchSizes() {
  console.log('\n🧪 Test 3: Different Batch Sizes')
  
  const batchSizes = [2, 5, 10]
  const results = []

  for (const batchSize of batchSizes) {
    const result = await testPdfAnalysis({
      enableBatching: true,
      batchSize,
      description: `Batching with batchSize: ${batchSize}`
    })

    results.push({
      batchSize,
      success: result.success,
      fieldCount: result.fields.length,
      batchCount: result.analytics.batching?.batchCount,
      mergeStats: result.analytics.batching?.mergeStats
    })
  }

  const checks = {
    allSuccessful: results.every(r => r.success),
    allHaveFields: results.every(r => r.fieldCount > 0),
    batchCountsValid: results.every(r => r.batchCount > 0)
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Different Batch Sizes', passed, {
    results,
    checks
  })

  return { results, checks }
}

// Test 4: Edge case - batchSize larger than total pages
async function testBatchSizeLargerThanPages() {
  console.log('\n🧪 Test 4: Batch Size Larger Than Total Pages')
  
  const result = await testPdfAnalysis({
    enableBatching: true,
    batchSize: 100, // Much larger than typical PDF
    description: 'Batch Size Larger Than Pages Test'
  })

  const checks = {
    success: result.success,
    hasFields: result.fields.length > 0,
    batchCount: result.analytics.batching?.batchCount === 1, // Should be clamped to 1 batch
    batchSizeClamped: result.analytics.batching?.batchSize <= result.pages
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Batch Size Larger Than Pages', passed, {
    pages: result.pages,
    batchCount: result.analytics.batching?.batchCount,
    batchSize: result.analytics.batching?.batchSize,
    checks
  })

  return { result, checks }
}

// Test 5: Edge case - batchSize = 1 (each page separately)
async function testBatchSizeOne() {
  console.log('\n🧪 Test 5: Batch Size = 1 (Each Page Separately)')
  
  const result = await testPdfAnalysis({
    enableBatching: true,
    batchSize: 1,
    description: 'Batch Size = 1 Test'
  })

  const checks = {
    success: result.success,
    hasFields: result.fields.length > 0,
    batchCount: result.analytics.batching?.batchCount === result.pages, // Should equal page count
    batchSize: result.analytics.batching?.batchSize === 1
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Batch Size = 1', passed, {
    pages: result.pages,
    batchCount: result.analytics.batching?.batchCount,
    batchSize: result.analytics.batching?.batchSize,
    checks
  })

  return { result, checks }
}

// Test 6: Compare field counts between batching and single-request
async function testFieldCountComparison() {
  console.log('\n🧪 Test 6: Field Count Comparison (Batching vs Single-Request)')
  
  const [singleResult, batchResult] = await Promise.all([
    testPdfAnalysis({
      enableBatching: false,
      description: 'Single-Request for Comparison'
    }),
    testPdfAnalysis({
      enableBatching: true,
      batchSize: 3,
      description: 'Batching for Comparison'
    })
  ])

  const singleFieldCount = singleResult.fields.length
  const batchFieldCount = batchResult.fields.length
  const difference = Math.abs(singleFieldCount - batchFieldCount)
  const percentDifference = singleFieldCount > 0 
    ? ((difference / singleFieldCount) * 100).toFixed(2)
    : 0

  const checks = {
    bothSuccessful: singleResult.success && batchResult.success,
    bothHaveFields: singleFieldCount > 0 && batchFieldCount > 0,
    reasonableDifference: percentDifference < 20 // Allow 20% difference
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Field Count Comparison', passed, {
    singleRequestFields: singleFieldCount,
    batchingFields: batchFieldCount,
    difference,
    percentDifference: `${percentDifference}%`,
    checks
  })

  return { singleResult, batchResult, checks }
}

// Test 7: Analytics structure validation
async function testAnalyticsStructure() {
  console.log('\n🧪 Test 7: Analytics Structure Validation')
  
  const result = await testPdfAnalysis({
    enableBatching: true,
    batchSize: 3,
    description: 'Analytics Structure Test'
  })

  const analytics = result.analytics
  const checks = {
    hasVisionApi: !!analytics.visionApi,
    hasGroqApi: !!analytics.groqApi,
    hasBatching: !!analytics.batching,
    visionApiHasTime: typeof analytics.visionApi?.time === 'number',
    groqApiHasTime: typeof analytics.groqApi?.time === 'number',
    groqApiHasTokens: typeof analytics.groqApi?.totalTokens === 'number' || analytics.groqApi?.totalTokens === null,
    batchingHasBatchCount: typeof analytics.batching?.batchCount === 'number',
    batchingHasMergeStats: !!analytics.batching?.mergeStats,
    mergeStatsHasFields: typeof analytics.batching?.mergeStats?.totalFieldsAfterMerge === 'number'
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Analytics Structure', passed, {
    analytics,
    checks
  })

  return { result, checks }
}

// Test 8: Error handling - invalid batchSize
async function testInvalidBatchSize() {
  console.log('\n🧪 Test 8: Invalid Batch Size Handling')
  
  // Test with NaN (should default to 5)
  const result1 = await testPdfAnalysis({
    enableBatching: true,
    batchSize: 'invalid', // Will be parsed as NaN
    description: 'Invalid Batch Size Test'
  })

  // Test with negative number (should default to 5)
  const result2 = await testPdfAnalysis({
    enableBatching: true,
    batchSize: -5,
    description: 'Negative Batch Size Test'
  })

  const checks = {
    invalidHandled: result1.success, // Should still work (defaults to 5)
    negativeHandled: result2.success, // Should still work (defaults to 5)
    bothHaveFields: result1.fields.length > 0 && result2.fields.length > 0
  }

  const passed = Object.values(checks).every(v => v === true)
  
  logTest('Invalid Batch Size Handling', passed, {
    invalidResult: { success: result1.success, fieldCount: result1.fields.length },
    negativeResult: { success: result2.success, fieldCount: result2.fields.length },
    checks
  })

  return { result1, result2, checks }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Batching Test Suite')
  console.log(`Railway URL: ${RAILWAY_URL}`)
  console.log(`PDF Path: ${PDF_PATH}\n`)

  try {
    // Run all tests
    await testSingleRequestMode()
    await testBatchingMode()
    await testDifferentBatchSizes()
    await testBatchSizeLargerThanPages()
    await testBatchSizeOne()
    await testFieldCountComparison()
    await testAnalyticsStructure()
    await testInvalidBatchSize()

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 TEST SUMMARY')
    console.log('='.repeat(60))
    console.log(`✅ Passed: ${testResults.passed.length}`)
    console.log(`❌ Failed: ${testResults.failed.length}`)
    console.log(`📈 Total: ${testResults.passed.length + testResults.failed.length}`)

    if (testResults.failed.length > 0) {
      console.log('\n❌ Failed Tests:')
      testResults.failed.forEach(test => {
        console.log(`   - ${test.name}`)
        if (test.details.error) {
          console.log(`     Error: ${test.details.error}`)
        }
      })
    }

    // Save results to file
    const timestamp = Date.now()
    const resultsFile = path.join(__dirname, `../test-results-batching-${timestamp}.json`)
    fs.writeFileSync(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        passed: testResults.passed.length,
        failed: testResults.failed.length,
        total: testResults.passed.length + testResults.failed.length
      },
      passed: testResults.passed,
      failed: testResults.failed
    }, null, 2))

    console.log(`\n💾 Results saved to: ${resultsFile}`)

    // Exit with appropriate code
    process.exit(testResults.failed.length > 0 ? 1 : 0)
  } catch (error) {
    console.error('❌ Test suite error:', error)
    process.exit(1)
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests()
}

module.exports = {
  testPdfAnalysis,
  testSingleRequestMode,
  testBatchingMode,
  testDifferentBatchSizes,
  testBatchSizeLargerThanPages,
  testBatchSizeOne,
  testFieldCountComparison,
  testAnalyticsStructure,
  testInvalidBatchSize,
  runAllTests
}

