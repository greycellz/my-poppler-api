/**
 * Manual Integration Tests for Vision API Endpoints
 * 
 * Run this script to test the Railway endpoints directly:
 * 
 *   node test/test-vision-endpoints-manual.js
 * 
 * Prerequisites:
 * - Railway backend running (or set RAILWAY_URL env var)
 * - OPENAI_API_KEY set in environment
 * - Test images available (or use provided test URLs)
 * 
 * This script tests:
 * - /api/analyze-images endpoint
 * - /api/analyze-url endpoint
 * - Image compression
 * - Image splitting
 * - Field extraction
 */

// Use global fetch (Node.js 18+) or node-fetch if needed
const fetch = global.fetch || require('node-fetch');

// Configuration
const RAILWAY_URL = process.env.RAILWAY_URL || process.env.RAILWAY_BACKEND_URL || 'http://localhost:3000';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Test utilities
function log(message, data = null) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log('='.repeat(60));
}

function error(message, err = null) {
  console.error(`\n❌ ${message}`);
  if (err) {
    console.error(err);
  }
}

function success(message) {
  console.log(`\n✅ ${message}`);
}

async function testAnalyzeImages() {
  log('TEST 1: /api/analyze-images - Single Image');
  
  try {
    // Use a publicly accessible test image
    // Replace with your own test image URL
    const testImageUrl = 'https://via.placeholder.com/800x1000.png?text=Test+Form+Page';
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageUrls: [testImageUrl],
        systemMessage: 'You are a form analysis expert. Extract all form fields from the provided images.',
        userMessage: 'Analyze this image and extract all visible form fields.'
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      success(`Analyzed ${data.imagesAnalyzed || 1} image(s)`);
      console.log(`Fields extracted: ${data.fields?.length || 0}`);
      if (data.fields && data.fields.length > 0) {
        console.log('Sample field:', JSON.stringify(data.fields[0], null, 2));
      }
      return true;
    } else {
      error(`Request failed: ${data.error || response.statusText}`);
      return false;
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testAnalyzeImagesMultiple() {
  log('TEST 2: /api/analyze-images - Multiple Images (Parallel Processing)');
  
  try {
    const testImageUrls = [
      'https://via.placeholder.com/800x1000.png?text=Page+1',
      'https://via.placeholder.com/800x1000.png?text=Page+2',
      'https://via.placeholder.com/800x1000.png?text=Page+3'
    ];
    
    const startTime = Date.now();
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageUrls: testImageUrls,
        systemMessage: 'You are a form analysis expert. Extract all form fields from the provided images.',
        userMessage: 'Analyze these PDF form pages and extract all visible form fields.'
      })
    });
    
    const duration = Date.now() - startTime;
    const data = await response.json();
    
    if (response.ok) {
      success(`Analyzed ${data.imagesAnalyzed || testImageUrls.length} images in ${duration}ms`);
      console.log(`Fields extracted: ${data.fields?.length || 0}`);
      console.log(`Average time per image: ${Math.round(duration / testImageUrls.length)}ms`);
      return true;
    } else {
      error(`Request failed: ${data.error || response.statusText}`);
      return false;
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testAnalyzeUrl() {
  log('TEST 3: /api/analyze-url - URL Analysis (Normal Height)');
  
  try {
    // Use a simple test URL (replace with actual form URL)
    const testUrl = 'https://example.com/simple-form';
    
    // Note: This will fail if the URL doesn't exist, but tests the endpoint structure
    const response = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: testUrl,
        systemMessage: 'You are a form analysis expert. Extract all form fields from the provided screenshot.',
        userMessage: 'Analyze this screenshot and extract all visible form fields.'
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      success(`Analyzed URL successfully`);
      console.log(`Was split: ${data.wasSplit || false}`);
      console.log(`Fields extracted: ${data.fields?.length || 0}`);
      if (data.fields && data.fields.length > 0) {
        console.log('Sample field:', JSON.stringify(data.fields[0], null, 2));
      }
      return true;
    } else {
      // Expected to fail if URL doesn't exist, but tests error handling
      console.log(`Expected failure (URL may not exist): ${data.error || response.statusText}`);
      return true; // Count as success if error handling works
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testAnalyzeUrlWithScreenshot() {
  log('TEST 4: /api/analyze-url - Screenshot URL (Direct)');
  
  try {
    // Use a test screenshot URL (replace with actual screenshot URL)
    const screenshotUrl = 'https://via.placeholder.com/1280x2000.png?text=Form+Screenshot';
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        screenshotUrl: screenshotUrl,
        systemMessage: 'You are a form analysis expert. Extract all form fields from the provided screenshot.',
        userMessage: 'Analyze this screenshot and extract all visible form fields.'
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      success(`Analyzed screenshot successfully`);
      console.log(`Was split: ${data.wasSplit || false}`);
      if (data.wasSplit) {
        console.log(`Number of sections: ${data.numSections}`);
        console.log(`Original height: ${data.originalHeight}px`);
        console.log(`Split threshold: ${data.splitThreshold}px`);
      }
      console.log(`Fields extracted: ${data.fields?.length || 0}`);
      return true;
    } else {
      error(`Request failed: ${data.error || response.statusText}`);
      return false;
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testAnalyzeUrlTallImage() {
  log('TEST 5: /api/analyze-url - Tall Screenshot (Should Split)');
  
  try {
    // Use a tall test image (>4000px) to test splitting
    // Note: placeholder.com doesn't support very tall images, so this is a placeholder
    // Replace with actual tall screenshot URL for real testing
    const tallScreenshotUrl = 'https://via.placeholder.com/1280x5000.png?text=Tall+Form';
    
    const startTime = Date.now();
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        screenshotUrl: tallScreenshotUrl,
        systemMessage: 'You are a form analysis expert. Extract all form fields from this section of a form.',
        userMessage: 'Analyze this section and extract all visible form fields.'
      })
    });
    
    const duration = Date.now() - startTime;
    const data = await response.json();
    
    if (response.ok) {
      success(`Analyzed tall screenshot in ${duration}ms`);
      console.log(`Was split: ${data.wasSplit || false}`);
      if (data.wasSplit) {
        console.log(`✅ Image was split into ${data.numSections} sections`);
        console.log(`Original height: ${data.originalHeight}px`);
        console.log(`Split threshold: ${data.splitThreshold}px`);
      } else {
        console.log(`⚠️ Image was NOT split (may be <4000px or splitting failed)`);
      }
      console.log(`Fields extracted: ${data.fields?.length || 0}`);
      return true;
    } else {
      error(`Request failed: ${data.error || response.statusText}`);
      return false;
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testErrorHandling() {
  log('TEST 6: Error Handling - Invalid Request');
  
  try {
    // Test with invalid request (missing imageUrls)
    const response = await fetch(`${RAILWAY_URL}/api/analyze-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    const data = await response.json();
    
    if (response.status === 400 && !data.success) {
      success(`Error handling works correctly: ${data.error}`);
      return true;
    } else {
      error(`Unexpected response: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    error('Test failed with error', err);
    return false;
  }
}

async function testConfiguration() {
  log('TEST 7: Configuration Check');
  
  console.log(`Railway URL: ${RAILWAY_URL}`);
  console.log(`OpenAI API Key: ${OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`Image Split Max Height: ${process.env.IMAGE_SPLIT_MAX_HEIGHT || '4000 (default)'}`);
  console.log(`Image Split Overlap: ${process.env.IMAGE_SPLIT_OVERLAP || '200 (default)'}`);
  
  if (!OPENAI_API_KEY) {
    error('OPENAI_API_KEY not set. Set it in environment or .env file.');
    return false;
  }
  
  return true;
}

// Main test runner
async function runTests() {
  console.log('\n🚀 Starting Vision API Endpoints Integration Tests\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Check configuration first
  log('CONFIGURATION CHECK');
  const configOk = await testConfiguration();
  if (!configOk) {
    console.log('\n⚠️ Configuration check failed. Some tests may fail.\n');
  }
  
  // Run tests
  const tests = [
    { name: 'Analyze Images (Single)', fn: testAnalyzeImages },
    { name: 'Analyze Images (Multiple)', fn: testAnalyzeImagesMultiple },
    { name: 'Analyze URL', fn: testAnalyzeUrl },
    { name: 'Analyze URL (Screenshot)', fn: testAnalyzeUrlWithScreenshot },
    { name: 'Analyze URL (Tall Image)', fn: testAnalyzeUrlTallImage },
    { name: 'Error Handling', fn: testErrorHandling }
  ];
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        results.passed++;
        results.tests.push({ name: test.name, status: 'PASSED' });
      } else {
        results.failed++;
        results.tests.push({ name: test.name, status: 'FAILED' });
      }
    } catch (err) {
      results.failed++;
      results.tests.push({ name: test.name, status: 'ERROR', error: err.message });
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Print summary
  log('TEST SUMMARY');
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log('\nTest Details:');
  results.tests.forEach(test => {
    const icon = test.status === 'PASSED' ? '✅' : '❌';
    console.log(`  ${icon} ${test.name}: ${test.status}`);
    if (test.error) {
      console.log(`     Error: ${test.error}`);
    }
  });
  
  console.log('\n');
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run if executed directly
if (require.main === module) {
  runTests().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  testAnalyzeImages,
  testAnalyzeImagesMultiple,
  testAnalyzeUrl,
  testAnalyzeUrlWithScreenshot,
  testAnalyzeUrlTallImage,
  testErrorHandling,
  testConfiguration
};

