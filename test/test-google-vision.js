/**
 * Test Google Vision API endpoint
 * 
 * Usage:
 *   # Test with local image path
 *   node test/test-google-vision.js --path output/{uuid}/page-1.png
 * 
 *   # Test with image URL
 *   node test/test-google-vision.js --url https://example.com/image.png
 * 
 *   # Test health check
 *   node test/test-google-vision.js --health
 */

const fetch = global.fetch || require('node-fetch')
const fs = require('fs')
const path = require('path')

const RAILWAY_URL = process.env.RAILWAY_URL || 'http://localhost:3000'
const API_URL = `${RAILWAY_URL}/api/test-google-vision`

async function testHealthCheck() {
  console.log('🔍 Testing Google Vision API health check...\n')
  
  try {
    const response = await fetch(`${API_URL}`, {
      method: 'GET'
    })
    
    const data = await response.json()
    
    if (data.success) {
      console.log('✅ Health check passed')
      console.log(JSON.stringify(data, null, 2))
    } else {
      console.error('❌ Health check failed')
      console.error(JSON.stringify(data, null, 2))
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Health check error:', error.message)
    process.exit(1)
  }
}

async function testWithImagePath(imagePath) {
  console.log(`🔍 Testing Google Vision API with image path: ${imagePath}\n`)
  
  // Check if file exists locally
  const fullPath = path.join(__dirname, '..', imagePath)
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Image file not found: ${fullPath}`)
    process.exit(1)
  }
  
  console.log(`📄 Image file found: ${fullPath}`)
  console.log(`📄 File size: ${(fs.statSync(fullPath).size / 1024).toFixed(2)} KB\n`)
  
  try {
    const startTime = Date.now()
    
    const response = await fetch(`${API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imagePath: imagePath
      })
    })
    
    const totalTime = Date.now() - startTime
    const data = await response.json()
    
    if (data.success) {
      console.log('✅ Google Vision API test passed')
      console.log(`⏱️  Total time: ${totalTime}ms`)
      console.log(`⏱️  Processing time: ${data.processingTimeMs}ms`)
      console.log(`📝 Extracted text length: ${data.text.length} characters`)
      console.log(`📄 Pages detected: ${data.pages}`)
      console.log('\n📄 First 500 characters of extracted text:')
      console.log('─'.repeat(60))
      console.log(data.text.substring(0, 500))
      if (data.text.length > 500) {
        console.log(`\n... (${data.text.length - 500} more characters)`)
      }
      console.log('─'.repeat(60))
    } else {
      console.error('❌ Google Vision API test failed')
      console.error(JSON.stringify(data, null, 2))
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Test error:', error.message)
    process.exit(1)
  }
}

async function testWithImageUrl(imageUrl) {
  console.log(`🔍 Testing Google Vision API with image URL: ${imageUrl}\n`)
  
  try {
    const startTime = Date.now()
    
    const response = await fetch(`${API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageUrl: imageUrl
      })
    })
    
    const totalTime = Date.now() - startTime
    const data = await response.json()
    
    if (data.success) {
      console.log('✅ Google Vision API test passed')
      console.log(`⏱️  Total time: ${totalTime}ms`)
      console.log(`⏱️  Processing time: ${data.processingTimeMs}ms`)
      console.log(`📝 Extracted text length: ${data.text.length} characters`)
      console.log(`📄 Pages detected: ${data.pages}`)
      console.log('\n📄 First 500 characters of extracted text:')
      console.log('─'.repeat(60))
      console.log(data.text.substring(0, 500))
      if (data.text.length > 500) {
        console.log(`\n... (${data.text.length - 500} more characters)`)
      }
      console.log('─'.repeat(60))
    } else {
      console.error('❌ Google Vision API test failed')
      console.error(JSON.stringify(data, null, 2))
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Test error:', error.message)
    process.exit(1)
  }
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.includes('--health')) {
    await testHealthCheck()
  } else if (args.includes('--path')) {
    const pathIndex = args.indexOf('--path')
    const imagePath = args[pathIndex + 1]
    if (!imagePath) {
      console.error('❌ --path requires an image path argument')
      process.exit(1)
    }
    await testWithImagePath(imagePath)
  } else if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url')
    const imageUrl = args[urlIndex + 1]
    if (!imageUrl) {
      console.error('❌ --url requires an image URL argument')
      process.exit(1)
    }
    await testWithImageUrl(imageUrl)
  } else {
    console.log('Usage:')
    console.log('  node test/test-google-vision.js --health')
    console.log('  node test/test-google-vision.js --path output/{uuid}/page-1.png')
    console.log('  node test/test-google-vision.js --url https://example.com/image.png')
    console.log('\nOr set RAILWAY_URL environment variable:')
    console.log('  RAILWAY_URL=https://my-poppler-api-dev.up.railway.app node test/test-google-vision.js --health')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

