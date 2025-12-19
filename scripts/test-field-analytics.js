/**
 * Field Analytics Integration Test Script
 * Tests the field analytics endpoint with real Railway API and GCP services
 * 
 * To run: node scripts/test-field-analytics.js
 * 
 * Requires:
 * - Railway dev server running at https://my-poppler-api-dev.up.railway.app
 * - GCP credentials configured
 * - Test form with submissions
 * 
 * Usage:
 *   node scripts/test-field-analytics.js [formId] [dateRange]
 * 
 * Example:
 *   node scripts/test-field-analytics.js form_1234567890_abc 30
 */

// Use built-in fetch (Node 18+) or require node-fetch
// Note: If using Node < 18, install node-fetch: npm install node-fetch
const fetch = globalThis.fetch || require('node-fetch');

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';

// Get form ID and date range from command line args
const formId = process.argv[2] || process.env.TEST_FORM_ID;
const dateRange = process.argv[3] || '30';

if (!formId) {
  console.error('❌ Error: Form ID is required');
  console.log('Usage: node scripts/test-field-analytics.js <formId> [dateRange]');
  console.log('   or set TEST_FORM_ID environment variable');
  process.exit(1);
}

async function testFieldAnalytics() {
  console.log('🧪 Testing Field Analytics Endpoint\n');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📍 Railway URL: ${RAILWAY_URL}`);
  console.log(`📋 Form ID: ${formId}`);
  console.log(`📅 Date Range: ${dateRange} days\n`);

  try {
    // Test 1: Basic field analytics request
    console.log('📊 Test 1: Fetching field analytics...');
    const url = `${RAILWAY_URL}/analytics/forms/${formId}/fields?dateRange=${dateRange}`;
    console.log(`   URL: ${url}\n`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Request failed:');
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    // Validate response structure
    console.log('✅ Response received\n');
    console.log('📋 Response Structure:');
    console.log(`   success: ${data.success}`);
    console.log(`   formId: ${data.formId}`);
    console.log(`   dateRange: ${data.dateRange?.start} to ${data.dateRange?.end}`);
    console.log(`   fields count: ${data.fields?.length || 0}`);
    if (data.errors && data.errors.length > 0) {
      console.log(`   errors count: ${data.errors.length}`);
    }
    console.log('');

    // Display field analytics
    if (data.fields && data.fields.length > 0) {
      console.log('📊 Field Analytics:\n');
      data.fields.forEach((field, index) => {
        console.log(`   ${index + 1}. ${field.label} (${field.type})`);
        console.log(`      Field ID: ${field.fieldId}`);
        console.log(`      Semantic Type: ${field.semanticType}`);
        console.log(`      Total Responses: ${field.analytics.totalResponses}`);
        console.log(`      Completion Rate: ${field.analytics.completionRate}%`);

        // Type-specific analytics
        if (field.analytics.optionCounts) {
          console.log(`      Options:`);
          Object.entries(field.analytics.optionCounts).forEach(([option, count]) => {
            const percentage = field.analytics.percentages?.[option] || 0;
            console.log(`        - ${option}: ${count} (${percentage}%)`);
          });
        }

        if (field.analytics.mean !== undefined) {
          console.log(`      Mean: ${field.analytics.mean}`);
          console.log(`      Median: ${field.analytics.median}`);
          console.log(`      Mode: ${field.analytics.mode}`);
        }

        if (field.analytics.yesCount !== undefined) {
          console.log(`      Yes: ${field.analytics.yesCount} (${field.analytics.yesPercentage}%)`);
          console.log(`      No: ${field.analytics.noCount} (${field.analytics.noPercentage}%)`);
        }

        if (field.analytics.averageWordCount !== undefined) {
          console.log(`      Avg Words: ${field.analytics.averageWordCount}`);
          console.log(`      Avg Characters: ${field.analytics.averageCharacterCount}`);
        }

        if (field.analytics.min !== undefined) {
          console.log(`      Min: ${field.analytics.min}`);
          console.log(`      Max: ${field.analytics.max}`);
          console.log(`      Mean: ${field.analytics.mean}`);
          console.log(`      Median: ${field.analytics.median}`);
        }

        if (field.analytics.distribution) {
          console.log(`      Distribution: ${Object.keys(field.analytics.distribution).length} unique values`);
        }

        console.log('');
      });
    } else {
      console.log('⚠️  No field analytics returned');
      if (data.message) {
        console.log(`   Message: ${data.message}`);
      }
    }

    // Display errors if any
    if (data.errors && data.errors.length > 0) {
      console.log('⚠️  Errors (graceful degradation):\n');
      data.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Field ${error.fieldId}: ${error.error}`);
      });
      console.log('');
    }

    // Test 2: Test with different date ranges
    console.log('📊 Test 2: Testing different date ranges...\n');
    const dateRanges = ['7', '30', '90'];
    
    for (const range of dateRanges) {
      console.log(`   Testing ${range} days...`);
      const rangeResponse = await fetch(
        `${RAILWAY_URL}/analytics/forms/${formId}/fields?dateRange=${range}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );
      
      const rangeData = await rangeResponse.json();
      if (rangeResponse.ok) {
        console.log(`   ✅ ${range} days: ${rangeData.fields?.length || 0} fields`);
      } else {
        console.log(`   ❌ ${range} days: ${rangeData.error || 'Failed'}`);
      }
    }
    console.log('');

    // Test 3: Test dateRange with 'd' suffix
    console.log('📊 Test 3: Testing dateRange with "d" suffix...\n');
    const suffixResponse = await fetch(
      `${RAILWAY_URL}/analytics/forms/${formId}/fields?dateRange=30d`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    const suffixData = await suffixResponse.json();
    if (suffixResponse.ok) {
      console.log(`   ✅ dateRange=30d works: ${suffixData.fields?.length || 0} fields`);
    } else {
      console.log(`   ❌ dateRange=30d failed: ${suffixData.error || 'Failed'}`);
    }
    console.log('');

    // Test 4: Test with non-existent form
    console.log('📊 Test 4: Testing with non-existent form...\n');
    const invalidResponse = await fetch(
      `${RAILWAY_URL}/analytics/forms/invalid-form-id-12345/fields?dateRange=30`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    const invalidData = await invalidResponse.json();
    if (invalidResponse.status === 404) {
      console.log('   ✅ Correctly returns 404 for non-existent form');
    } else {
      console.log(`   ⚠️  Unexpected status: ${invalidResponse.status}`);
    }
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ All tests completed!\n');

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run tests
testFieldAnalytics();
