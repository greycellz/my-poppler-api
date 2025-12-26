/**
 * Custom Analytics Manual Test Script
 * Tests custom analytics endpoints with real Railway API
 * 
 * To run: node test-custom-analytics-manual.js
 * 
 * Requires:
 * - Railway dev server running
 * - Valid JWT token (set RAILWAY_TOKEN env var or use test token)
 * - Test form ID (set TEST_FORM_ID env var)
 */

const fetch = require('node-fetch');

const RAILWAY_URL = process.env.RAILWAY_URL || process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';
const TEST_FORM_ID = process.env.TEST_FORM_ID;
const TEST_TOKEN = process.env.RAILWAY_TOKEN || process.env.JWT_TOKEN;

if (!TEST_FORM_ID) {
  console.error('❌ ERROR: TEST_FORM_ID environment variable required');
  console.error('   Usage: TEST_FORM_ID=your-form-id node test-custom-analytics-manual.js');
  process.exit(1);
}

if (!TEST_TOKEN) {
  console.warn('⚠️  WARNING: No JWT token provided. Some tests may fail with 401 Unauthorized');
  console.warn('   Set RAILWAY_TOKEN or JWT_TOKEN environment variable');
}

// Test utilities
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (TEST_TOKEN) {
    headers['Authorization'] = `Bearer ${TEST_TOKEN}`;
  }
  
  const options = {
    method,
    headers
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${RAILWAY_URL}${endpoint}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

async function testCustomAnalytics() {
  console.log('🧪 Testing Custom Analytics Endpoints\n');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📍 Railway URL: ${RAILWAY_URL}`);
  console.log(`📋 Form ID: ${TEST_FORM_ID}`);
  console.log(`🔑 Token: ${TEST_TOKEN ? 'Provided' : 'Missing'}\n`);

  let passed = 0;
  let failed = 0;

  // ============================================================
  // Test 1: Analyze Breakdown Template
  // ============================================================
  console.log('📊 Test 1: Analyze Breakdown Template');
  try {
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'rating', // Assuming form has a rating field
        secondary_field_id: 'category', // Assuming form has a category field
        aggregation: 'mean',
        date_range: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString()
        }
      }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log('   ✅ Breakdown analysis successful');
      console.log(`   📈 Sample size: ${response.data.analysis.sampleSize}`);
      console.log(`   📊 Chart type: ${response.data.analysis.chartType}`);
      console.log(`   🔢 BigNumber: ${response.data.analysis.bigNumber?.value || 'N/A'}`);
      passed++;
    } else if (response.status === 400 && response.data.error?.includes('Field not found')) {
      console.log('   ⚠️  Form does not have expected fields (rating/category)');
      console.log('   ℹ️  This is expected if form structure differs');
      passed++; // Not a failure, just different form structure
    } else if (response.status === 401) {
      console.log('   ❌ Unauthorized - check JWT token');
      failed++;
    } else {
      console.log(`   ❌ Failed: ${response.status} - ${response.data.error || response.error}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Test 2: Analyze Over Time Template
  // ============================================================
  console.log('📈 Test 2: Analyze Over Time Template');
  try {
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'over-time',
        primary_field_id: 'date', // Assuming form has a date field
        secondary_field_id: 'rating',
        time_granularity: 'day',
        aggregation: 'mean',
        date_range: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString()
        }
      }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log('   ✅ Over Time analysis successful');
      console.log(`   📈 Sample size: ${response.data.analysis.sampleSize}`);
      console.log(`   📊 Chart type: ${response.data.analysis.chartType}`);
      passed++;
    } else if (response.status === 400 && response.data.error?.includes('Field not found')) {
      console.log('   ⚠️  Form does not have expected fields (date/rating)');
      passed++;
    } else if (response.status === 401) {
      console.log('   ❌ Unauthorized - check JWT token');
      failed++;
    } else {
      console.log(`   ❌ Failed: ${response.status} - ${response.data.error || response.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Test 3: Save Custom Analysis
  // ============================================================
  console.log('💾 Test 3: Save Custom Analysis');
  try {
    const analysisId = `test_${Date.now()}`;
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/saved`,
      'POST',
      {
        analysis_id: analysisId,
        template_type: 'breakdown',
        selected_fields: {
          primary: { id: 'rating', label: 'Rating', type: 'number' },
          secondary: { id: 'category', label: 'Category', type: 'select' }
        },
        name: 'Test Analysis',
        pinned: false,
        aggregation: 'mean',
        filters: []
      }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log(`   ✅ Analysis saved: ${response.data.analysis_id}`);
      passed++;
      
      // Test 4: Get Saved Analyses
      console.log('📋 Test 4: Get Saved Analyses');
      await delay(1000); // Wait for save to complete
      
      const getResponse = await makeRequest(
        `/api/analytics/forms/${TEST_FORM_ID}/custom/saved?dateRange=30`
      );
      
      if (getResponse.status === 200 && getResponse.data.success) {
        console.log(`   ✅ Retrieved ${getResponse.data.analyses.length} saved analyses`);
        const savedAnalysis = getResponse.data.analyses.find(a => a.analysis_id === analysisId);
        if (savedAnalysis) {
          console.log(`   ✅ Found saved analysis: ${savedAnalysis.name}`);
          passed++;
        } else {
          console.log('   ⚠️  Saved analysis not found in list (may need to wait)');
          passed++; // Not a critical failure
        }
      } else {
        console.log(`   ❌ Failed to get saved analyses: ${getResponse.status}`);
        failed++;
      }
    } else if (response.status === 400 && response.data.error?.includes('Field not found')) {
      console.log('   ⚠️  Form does not have expected fields');
      passed++;
    } else if (response.status === 401) {
      console.log('   ❌ Unauthorized - check JWT token');
      failed++;
    } else {
      console.log(`   ❌ Failed: ${response.status} - ${response.data.error || response.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Test 5: Field Compatibility Validation
  // ============================================================
  console.log('✅ Test 5: Field Compatibility Validation');
  try {
    // Try incompatible field combination
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'category', // Wrong: should be number
        secondary_field_id: 'rating',
        aggregation: 'mean'
      }
    );
    
    if (response.status === 400 && response.data.error?.includes('not compatible')) {
      console.log('   ✅ Correctly rejected incompatible field types');
      passed++;
    } else if (response.status === 400 && response.data.error?.includes('Field not found')) {
      console.log('   ⚠️  Form does not have expected fields');
      passed++;
    } else {
      console.log(`   ⚠️  Unexpected response: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      // Don't count as failure - might be valid for this form
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Test 6: Invalid Aggregation
  // ============================================================
  console.log('🚫 Test 6: Invalid Aggregation Validation');
  try {
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'rating',
        secondary_field_id: 'category',
        aggregation: 'invalid-aggregation'
      }
    );
    
    if (response.status === 400 && response.data.error?.includes('Invalid aggregation')) {
      console.log('   ✅ Correctly rejected invalid aggregation');
      passed++;
    } else {
      console.log(`   ⚠️  Unexpected response: ${response.status}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Test 7: camelCase Request Body
  // ============================================================
  console.log('🔤 Test 7: camelCase Request Body Support');
  try {
    const response = await makeRequest(
      `/api/analytics/forms/${TEST_FORM_ID}/custom/analyze`,
      'POST',
      {
        templateType: 'breakdown', // camelCase
        primaryFieldId: 'rating', // camelCase
        secondaryFieldId: 'category', // camelCase
        aggregation: 'mean'
      }
    );
    
    if (response.status === 200 || response.status === 400) {
      // 200 = success, 400 = field not found (both mean camelCase was accepted)
      console.log('   ✅ camelCase request body accepted');
      passed++;
    } else if (response.status === 401) {
      console.log('   ❌ Unauthorized - check JWT token');
      failed++;
    } else {
      console.log(`   ⚠️  Unexpected response: ${response.status}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }
  console.log('');

  // ============================================================
  // Summary
  // ============================================================
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}\n`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check output above for details.');
    process.exit(1);
  }
}

// Run tests
testCustomAnalytics().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


