/**
 * Test Suite for Onboarding System API Endpoints
 * Tests all onboarding-related API endpoints
 */

const axios = require('axios');

// Test configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_USER_ID = 'test_api_user_' + Date.now();
const TEST_TASK_ID = 'test-api-task';

// Test results tracking
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function logTest(testName, passed, error = null) {
  const result = { testName, passed, error: error?.message || null };
  testResults.push(result);
  
  if (passed) {
    testsPassed++;
    console.log(`✅ ${testName}`);
  } else {
    testsFailed++;
    console.log(`❌ ${testName}: ${error?.message || 'Unknown error'}`);
  }
}

async function runTest(testName, testFunction) {
  try {
    await testFunction();
    logTest(testName, true);
  } catch (error) {
    logTest(testName, false, error);
  }
}

// ============== API TEST FUNCTIONS ==============

async function testInitializeOnboarding() {
  const response = await axios.post(`${API_BASE_URL}/api/onboarding/initialize`, {
    userId: TEST_USER_ID
  });
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.progress) {
    throw new Error('Expected progress object in response');
  }
  
  if (response.data.progress.currentLevel !== 1) {
    throw new Error(`Expected currentLevel to be 1, got ${response.data.progress.currentLevel}`);
  }
}

async function testGetOnboardingProgress() {
  const response = await axios.get(`${API_BASE_URL}/api/onboarding/progress/${TEST_USER_ID}`);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.progress) {
    throw new Error('Expected progress object in response');
  }
}

async function testCompleteTask() {
  const response = await axios.post(`${API_BASE_URL}/api/onboarding/complete-task`, {
    userId: TEST_USER_ID,
    taskId: TEST_TASK_ID,
    taskName: 'Test API Task',
    level: 1,
    reward: 'Test API Achievement!'
  });
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.progress) {
    throw new Error('Expected progress object in response');
  }
  
  if (!response.data.progress.completedTasks.includes(TEST_TASK_ID)) {
    throw new Error('Expected completed task to be in completedTasks array');
  }
}

async function testCreateHelpArticle() {
  const helpData = {
    taskId: TEST_TASK_ID,
    title: 'Test API Help Article',
    content: 'This is a test help article created via API.',
    steps: ['API Step 1', 'API Step 2'],
    tips: ['API Tip 1'],
    related: ['related-api-task']
  };
  
  const response = await axios.post(`${API_BASE_URL}/api/onboarding/help`, helpData);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
}

async function testGetHelpArticle() {
  const response = await axios.get(`${API_BASE_URL}/api/onboarding/help/${TEST_TASK_ID}`);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.helpArticle) {
    throw new Error('Expected helpArticle object in response');
  }
  
  if (response.data.helpArticle.title !== 'Test API Help Article') {
    throw new Error(`Expected title to be 'Test API Help Article', got '${response.data.helpArticle.title}'`);
  }
}

async function testLogEvent() {
  const response = await axios.post(`${API_BASE_URL}/api/onboarding/log-event`, {
    userId: TEST_USER_ID,
    event: 'test_api_event',
    taskId: TEST_TASK_ID,
    level: 1,
    metadata: { testApi: true }
  });
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
}

async function testGetAnalytics() {
  const response = await axios.get(`${API_BASE_URL}/api/onboarding/analytics/${TEST_USER_ID}`);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!Array.isArray(response.data.analytics)) {
    throw new Error('Expected analytics to be an array');
  }
  
  // Should have at least the event we logged
  const testEvent = response.data.analytics.find(event => event.event === 'test_api_event');
  if (!testEvent) {
    throw new Error('Expected to find logged test event in analytics');
  }
}

async function testErrorHandling() {
  // Test missing userId in initialize
  try {
    await axios.post(`${API_BASE_URL}/api/onboarding/initialize`, {});
    throw new Error('Expected error for missing userId');
  } catch (error) {
    if (error.response?.status !== 400) {
      throw new Error(`Expected status 400, got ${error.response?.status}`);
    }
  }
  
  // Test missing required fields in complete-task
  try {
    await axios.post(`${API_BASE_URL}/api/onboarding/complete-task`, {
      userId: TEST_USER_ID
      // Missing taskId, taskName, level
    });
    throw new Error('Expected error for missing required fields');
  } catch (error) {
    if (error.response?.status !== 400) {
      throw new Error(`Expected status 400, got ${error.response?.status}`);
    }
  }
  
  // Test non-existent user
  try {
    await axios.get(`${API_BASE_URL}/api/onboarding/progress/non_existent_user`);
    throw new Error('Expected error for non-existent user');
  } catch (error) {
    if (error.response?.status !== 500) {
      throw new Error(`Expected status 500, got ${error.response?.status}`);
    }
  }
}

async function testInvalidEndpoints() {
  // Test non-existent endpoint
  try {
    await axios.get(`${API_BASE_URL}/api/onboarding/non-existent`);
    throw new Error('Expected 404 for non-existent endpoint');
  } catch (error) {
    if (error.response?.status !== 404) {
      throw new Error(`Expected status 404, got ${error.response?.status}`);
    }
  }
}

async function testConcurrentRequests() {
  // Test multiple concurrent requests to the same endpoint
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      axios.get(`${API_BASE_URL}/api/onboarding/progress/${TEST_USER_ID}`)
    );
  }
  
  const responses = await Promise.all(promises);
  
  // All requests should succeed
  for (const response of responses) {
    if (response.status !== 200) {
      throw new Error(`Expected all concurrent requests to succeed, got status ${response.status}`);
    }
  }
}

// ============== MAIN TEST RUNNER ==============

async function runAllTests() {
  console.log('🧪 Starting Onboarding API Tests...\n');
  console.log(`🌐 Testing against: ${API_BASE_URL}\n`);
  
  try {
    // Core API tests
    await runTest('Initialize Onboarding API', testInitializeOnboarding);
    await runTest('Get Onboarding Progress API', testGetOnboardingProgress);
    await runTest('Complete Task API', testCompleteTask);
    await runTest('Create Help Article API', testCreateHelpArticle);
    await runTest('Get Help Article API', testGetHelpArticle);
    await runTest('Log Event API', testLogEvent);
    await runTest('Get Analytics API', testGetAnalytics);
    
    // Error handling tests
    await runTest('API Error Handling', testErrorHandling);
    await runTest('Invalid Endpoints', testInvalidEndpoints);
    
    // Performance tests
    await runTest('Concurrent Requests', testConcurrentRequests);
    
  } catch (error) {
    console.error('❌ Test runner error:', error);
  }
  
  // Print results
  console.log('\n📊 API Test Results Summary:');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
  
  if (testsFailed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults
      .filter(result => !result.passed)
      .forEach(result => {
        console.log(`  - ${result.testName}: ${result.error}`);
      });
  }
  
  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ API test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testInitializeOnboarding,
  testGetOnboardingProgress,
  testCompleteTask,
  testCreateHelpArticle,
  testGetHelpArticle,
  testLogEvent,
  testGetAnalytics
};
