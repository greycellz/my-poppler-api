/**
 * Test Railway API Endpoints for Onboarding System
 * Run this script to test the deployed API endpoints
 */

const axios = require('axios');

// Railway API URL
const RAILWAY_API_URL = 'https://my-poppler-api-dev.up.railway.app';

// Test configuration
const TEST_USER_ID = 'railway_test_user_' + Date.now();

async function testRailwayEndpoints() {
  console.log('🚄 Testing Railway Onboarding API Endpoints\n');
  console.log(`🌐 API URL: ${RAILWAY_API_URL}\n`);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Initialize Onboarding
  try {
    console.log('🧪 Test 1: Initialize Onboarding...');
    const response = await axios.post(`${RAILWAY_API_URL}/api/onboarding/initialize`, {
      userId: TEST_USER_ID
    });
    
    if (response.data.success && response.data.progress) {
      console.log('✅ Initialize onboarding: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Initialize onboarding: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 2: Get Progress
  try {
    console.log('🧪 Test 2: Get Onboarding Progress...');
    const response = await axios.get(`${RAILWAY_API_URL}/api/onboarding/progress/${TEST_USER_ID}`);
    
    if (response.data.success && response.data.progress) {
      console.log('✅ Get progress: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Get progress: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 3: Complete Task
  try {
    console.log('🧪 Test 3: Complete Task...');
    const response = await axios.post(`${RAILWAY_API_URL}/api/onboarding/complete-task`, {
      userId: TEST_USER_ID,
      taskId: 'railway-test-task',
      taskName: 'Railway Test Task',
      level: 1,
      reward: 'Railway Test Achievement!'
    });
    
    if (response.data.success && response.data.progress) {
      console.log('✅ Complete task: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Complete task: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 4: Create Help Article
  try {
    console.log('🧪 Test 4: Create Help Article...');
    const response = await axios.post(`${RAILWAY_API_URL}/api/onboarding/help`, {
      taskId: 'railway-test-help',
      title: 'Railway Test Help Article',
      content: 'This is a test help article created via Railway API.',
      steps: ['Railway Step 1', 'Railway Step 2'],
      tips: ['Railway Tip 1'],
      related: ['related-railway-task']
    });
    
    if (response.data.success) {
      console.log('✅ Create help article: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Create help article: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 5: Get Help Article
  try {
    console.log('🧪 Test 5: Get Help Article...');
    const response = await axios.get(`${RAILWAY_API_URL}/api/onboarding/help/railway-test-help`);
    
    if (response.data.success && response.data.helpArticle) {
      console.log('✅ Get help article: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Get help article: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 6: Log Event
  try {
    console.log('🧪 Test 6: Log Event...');
    const response = await axios.post(`${RAILWAY_API_URL}/api/onboarding/log-event`, {
      userId: TEST_USER_ID,
      event: 'railway_test_event',
      taskId: 'railway-test-task',
      level: 1,
      metadata: { railwayTest: true }
    });
    
    if (response.data.success) {
      console.log('✅ Log event: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Log event: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 7: Get Analytics
  try {
    console.log('🧪 Test 7: Get Analytics...');
    const response = await axios.get(`${RAILWAY_API_URL}/api/onboarding/analytics/${TEST_USER_ID}`);
    
    if (response.data.success && Array.isArray(response.data.analytics)) {
      console.log('✅ Get analytics: PASSED');
      testsPassed++;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    console.log('❌ Get analytics: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Test 8: Error Handling
  try {
    console.log('🧪 Test 8: Error Handling...');
    try {
      await axios.post(`${RAILWAY_API_URL}/api/onboarding/initialize`, {});
      throw new Error('Expected error for missing userId');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Error handling: PASSED');
        testsPassed++;
      } else {
        throw new Error(`Expected status 400, got ${error.response?.status}`);
      }
    }
  } catch (error) {
    console.log('❌ Error handling: FAILED');
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
  
  // Results Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 RAILWAY API TEST RESULTS');
  console.log('=' .repeat(50));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
  
  if (testsFailed === 0) {
    console.log('\n🎉 All Railway API tests passed! Onboarding system is ready.');
    console.log('\n📋 Next Steps:');
    console.log('1. Run help articles population: node populate-help-articles.js');
    console.log('2. Begin frontend component development');
    console.log('3. Test with real user data');
  } else {
    console.log('\n⚠️ Some tests failed. Check the errors above.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Verify Railway deployment is successful');
    console.log('2. Check Railway logs for errors');
    console.log('3. Ensure GCP credentials are properly configured');
    console.log('4. Verify database collections exist');
  }
  
  console.log(`\n📝 Test User ID for cleanup: ${TEST_USER_ID}`);
}

// Run tests if this file is executed directly
if (require.main === module) {
  testRailwayEndpoints().catch(error => {
    console.error('❌ Railway API test failed:', error);
    process.exit(1);
  });
}

module.exports = { testRailwayEndpoints };
