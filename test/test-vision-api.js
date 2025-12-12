/**
 * Vision API Test Script
 * 
 * Tests the full flow:
 * 1. Capture screenshot via backend
 * 2. Call Vision API directly with screenshot URL
 * 3. Analyze response for issues
 * 
 * Usage:
 *   node test/test-vision-api.js <form-url>
 * 
 * Example:
 *   node test/test-vision-api.js https://www.chatterforms.com/forms/form_1765518416011_bszeswqcu
 */

// Load environment variables (dotenv is optional)
try {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
} catch (e) {
  // dotenv not available, use environment variables directly
}

const PUPPETEER_SERVICE_URL = process.env.PUPPETEER_SERVICE_URL || 'https://my-poppler-api-dev.up.railway.app';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found in environment variables');
  process.exit(1);
}

// Simple token estimation
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// Test Vision API directly
async function testVisionAPI(imageUrl, sourceUrl) {
  console.log('\n🤖 ========== TESTING VISION API DIRECTLY ==========');
  console.log('📸 Image URL:', imageUrl);
  console.log('🔗 Source URL:', sourceUrl);
  
  const systemMessage = `You are a form analysis expert. Analyze this screenshot of a web form and extract ALL visible form fields with high accuracy.

For each field you can clearly identify on the screenshot, determine:

1. **Field Label**: The exact visible text label as shown
2. **Field Type**: Choose the most appropriate type (text, email, tel, textarea, select, radio-with-other, checkbox-with-other, date)
3. **Required Status**: Look for visual indicators (red asterisks, "(required)" text)
4. **Options Extraction**: For dropdowns, radio buttons, and checkboxes, extract ALL visible options
5. **Confidence Score**: Rate 0.1-1.0 based on visibility

**CRITICAL**: Extract ALL visible fields. Do not stop early. Continue through the entire form.

Return ONLY a JSON array with this exact structure:
[
  {
    "label": "Exact field label as shown",
    "type": "field_type",
    "required": true_or_false,
    "placeholder": "placeholder text if visible",
    "options": ["option1", "option2"],
    "allowOther": false,
    "confidence": 0.95
  }
]

If no form fields are visible, return an empty array: []`;

  const userMessage = `Analyze this screenshot of a form from URL: ${sourceUrl}

Please extract ALL visible form fields with their exact labels, types, and options as they appear in the screenshot. Extract every single field you can see, from top to bottom.`;

  // Calculate estimated tokens
  const systemTokens = estimateTokens(systemMessage);
  const userTokens = estimateTokens(userMessage);
  const imageTokens = 170; // High detail mode
  const estimatedInputTokens = systemTokens + userTokens + imageTokens;

  console.log('\n📊 Token Estimation (before API call):');
  console.log('  - System message tokens:', systemTokens);
  console.log('  - User message tokens:', userTokens);
  console.log('  - Image tokens (high detail):', imageTokens);
  console.log('  - Total estimated input tokens:', estimatedInputTokens);
  console.log('  - Max output tokens (max_tokens):', 16384);

  const visionStartTime = Date.now();

  try {
    console.log('\n🚀 Calling OpenAI Vision API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemMessage },
          {
            role: "user",
            content: [
              { type: "text", text: userMessage },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 16384,
        temperature: 0.1
      })
    });

    const apiCallTime = Date.now() - visionStartTime;
    console.log(`⏱️  HTTP request completed in ${apiCallTime}ms`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Vision API HTTP error:', response.status);
      console.error('❌ Error response:', JSON.stringify(errorData, null, 2));
      throw new Error(`OpenAI Vision API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    const usage = data.usage;

    console.log('\n📊 ========== VISION API RESPONSE ==========');
    console.log('✅ Finish reason:', finishReason);
    console.log('📊 Usage tokens:', JSON.stringify(usage, null, 2));

    if (usage) {
      console.log('\n📊 Token Usage Breakdown:');
      console.log('  - Prompt tokens:', usage.prompt_tokens);
      console.log('  - Completion tokens:', usage.completion_tokens);
      console.log('  - Total tokens:', usage.total_tokens);
      console.log('  - Estimated vs actual input tokens:', estimatedInputTokens, 'vs', usage.prompt_tokens, '(diff:', usage.prompt_tokens - estimatedInputTokens, ')');
    }

    if (finishReason === 'length') {
      console.error('\n❌ ========== TRUNCATION DETECTED ==========');
      console.error('❌ Response was truncated due to max_tokens limit');
      console.error('❌ Completion tokens used:', usage?.completion_tokens || 'unknown');
      console.error('❌ Max tokens limit:', 16384);
      console.error('❌ Response content length:', content?.length || 0, 'characters');
      return { error: 'TRUNCATED', fields: [], usage, finishReason };
    }

    if (!content) {
      console.error('❌ No content in response');
      console.error('❌ Full response data:', JSON.stringify(data, null, 2));
      throw new Error('No content received from OpenAI Vision API');
    }

    const contentTokens = estimateTokens(content);
    console.log('\n📊 Response Analysis:');
    console.log('  - Response content length:', content.length, 'characters');
    console.log('  - Estimated response tokens:', contentTokens);
    console.log('  - Actual completion tokens:', usage?.completion_tokens || 'unknown');
    console.log('  - Response preview (first 500 chars):', content.substring(0, 500) + '...');

    // Extract JSON from response
    let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\[[\s\S]*?\]/);
    }

    if (!jsonMatch) {
      console.error('\n❌ No JSON found in response');
      console.error('❌ Full response content:', content);
      return { error: 'NO_JSON', content, usage, finishReason };
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    const jsonStringTokens = estimateTokens(jsonString);

    console.log('\n📋 JSON Extraction:');
    console.log('  - JSON string length:', jsonString.length, 'characters');
    console.log('  - Estimated JSON tokens:', jsonStringTokens);

    try {
      const extractedFields = JSON.parse(jsonString);

      console.log('\n✅ ========== PARSED RESULTS ==========');
      console.log('📊 Parsed fields count:', extractedFields.length);
      console.log('📊 Field summary:', extractedFields.slice(0, 10).map(f => `${f.label} (${f.type})`).join(', '));
      if (extractedFields.length > 10) {
        console.log(`   ... and ${extractedFields.length - 10} more fields`);
      }

      // Check for potential issues
      console.log('\n🔍 ========== ANALYSIS ==========');
      if (extractedFields.length < 10) {
        console.warn('⚠️  WARNING: Very few fields extracted (' + extractedFields.length + '). Expected 120+ fields.');
      }
      if (finishReason !== 'stop') {
        console.warn('⚠️  WARNING: Finish reason is not "stop":', finishReason);
      }
      if (usage?.completion_tokens && usage.completion_tokens > 15000) {
        console.warn('⚠️  WARNING: Used ' + usage.completion_tokens + ' tokens, close to limit of 16384');
      }

      const visionTotalTime = Date.now() - visionStartTime;
      console.log(`\n⏱️  Total Vision API processing time: ${visionTotalTime}ms`);
      console.log('🤖 ========== VISION API TEST END ==========\n');

      return {
        success: true,
        fields: extractedFields,
        fieldCount: extractedFields.length,
        usage,
        finishReason,
        processingTime: visionTotalTime
      };

    } catch (parseError) {
      console.error('\n❌ JSON parse error:', parseError);
      console.error('❌ Failed to parse JSON string (first 1000 chars):', jsonString.substring(0, 1000));
      console.error('❌ JSON string length:', jsonString.length);
      return { error: 'PARSE_ERROR', parseError: parseError.message, jsonString, usage, finishReason };
    }

  } catch (error) {
    const visionTotalTime = Date.now() - visionStartTime;
    console.error('\n❌ Vision API error after', visionTotalTime, 'ms:', error);
    console.error('❌ Error details:', error instanceof Error ? {
      message: error.message,
      stack: error.stack
    } : error);
    return { error: 'API_ERROR', message: error.message };
  }
}

// Test screenshot endpoint
async function testScreenshotEndpoint(url) {
  console.log('\n📸 ========== TESTING SCREENSHOT ENDPOINT ==========');
  console.log('🔗 URL:', url);
  console.log('🌐 Service URL:', PUPPETEER_SERVICE_URL);

  const startTime = Date.now();

  try {
    const response = await fetch(`${PUPPETEER_SERVICE_URL}/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        options: {
          viewport: { width: 1280, height: 800 },
          waitTime: 4000,
          fullPage: true
        }
      })
    });

    const fetchTime = Date.now() - startTime;
    console.log(`⏱️  HTTP request completed in ${fetchTime}ms`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Screenshot endpoint error:', response.status);
      console.error('❌ Error response:', JSON.stringify(errorData, null, 2));
      throw new Error(`Screenshot endpoint error: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Screenshot capture failed');
    }

    const totalTime = Date.now() - startTime;
    console.log('\n✅ Screenshot captured successfully');
    console.log('📊 Response data:', JSON.stringify({
      urlHash: data.urlHash,
      screenshotUrl: data.screenshot.url,
      cached: data.screenshot.cached,
      size: data.screenshot.size,
      metadata: data.metadata
    }, null, 2));
    console.log(`⏱️  Total screenshot capture time: ${totalTime}ms`);
    console.log('📸 ========== SCREENSHOT TEST END ==========\n');

    return data;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error('\n❌ Screenshot endpoint error after', totalTime, 'ms:', error);
    throw error;
  }
}

// Main test function
async function runTest(formUrl) {
  console.log('🧪 ========== VISION API TEST SUITE ==========');
  console.log('📅 Test started at:', new Date().toISOString());
  console.log('🔗 Form URL:', formUrl);
  console.log('🌐 Backend URL:', PUPPETEER_SERVICE_URL);
  console.log('🔑 OpenAI API Key:', OPENAI_API_KEY ? 'Present' : 'Missing');

  const testStartTime = Date.now();

  try {
    // Step 1: Get screenshot
    console.log('\n📸 Step 1: Capturing screenshot...');
    const screenshotData = await testScreenshotEndpoint(formUrl);
    const screenshotUrl = screenshotData.screenshot.url;

    // Step 2: Test Vision API
    console.log('\n🤖 Step 2: Testing Vision API with screenshot...');
    const visionResult = await testVisionAPI(screenshotUrl, formUrl);

    // Step 3: Summary
    const totalTime = Date.now() - testStartTime;
    console.log('\n📊 ========== TEST SUMMARY ==========');
    console.log('⏱️  Total test time:', totalTime, 'ms');
    console.log('📸 Screenshot:', screenshotData.screenshot.cached ? 'Cached' : 'Newly captured');
    console.log('📊 Screenshot size:', (screenshotData.screenshot.size / 1024).toFixed(2), 'KB');
    
    if (visionResult.success) {
      console.log('✅ Vision API: Success');
      console.log('📊 Fields extracted:', visionResult.fieldCount);
      console.log('📊 Token usage:', visionResult.usage?.total_tokens || 'unknown');
      console.log('📊 Finish reason:', visionResult.finishReason);
      
      if (visionResult.fieldCount < 10) {
        console.warn('\n⚠️  WARNING: Only', visionResult.fieldCount, 'fields extracted. Expected 120+ fields.');
        console.warn('⚠️  This suggests the Vision API may not be processing the full form.');
      }
    } else {
      console.log('❌ Vision API: Failed');
      console.log('❌ Error:', visionResult.error);
    }

    console.log('\n🧪 ========== TEST SUITE END ==========\n');

    return {
      screenshot: screenshotData,
      vision: visionResult,
      totalTime
    };

  } catch (error) {
    const totalTime = Date.now() - testStartTime;
    console.error('\n❌ Test suite failed after', totalTime, 'ms:', error);
    console.error('❌ Error details:', error instanceof Error ? {
      message: error.message,
      stack: error.stack
    } : error);
    process.exit(1);
  }
}

// Run test
const formUrl = process.argv[2];

if (!formUrl) {
  console.error('❌ Please provide a form URL as an argument');
  console.error('Usage: node test/test-vision-api.js <form-url>');
  console.error('Example: node test/test-vision-api.js https://www.chatterforms.com/forms/form_1765518416011_bszeswqcu');
  process.exit(1);
}

runTest(formUrl)
  .then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });

