/**
 * Test Onboarding Integration - Phase 1
 * Tests the integration between user actions and onboarding progress updates
 */

const axios = require('axios');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

// Test utilities
function generateTestEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@example.com`;
}

async function createTestUser() {
  const email = generateTestEmail();
  const response = await axios.post(`${RAILWAY_URL}/auth/signup`, {
    email,
    password: 'Test$123',
    firstName: 'Test',
    lastName: 'User'
  });
  
  if (response.status !== 201) {
    throw new Error(`User creation failed: ${response.status}`);
  }
  
  return {
    userId: response.data.data.user.id,
    token: response.data.data.token,
    email
  };
}

async function getOnboardingProgress(userId, token) {
  const response = await axios.get(`${RAILWAY_URL}/api/onboarding/progress/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

async function updateOnboardingProgress(userId, token, taskId, taskName, level, reward) {
  const response = await axios.post(`${RAILWAY_URL}/api/onboarding/complete-task`, {
    userId,
    taskId,
    taskName,
    level,
    reward
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

// Test cases
async function testOnboardingInitialization() {
  console.log('\n🧪 Testing Onboarding Initialization...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Wait a moment for initialization
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  if (!progress.success) {
    throw new Error('Failed to get onboarding progress');
  }
  
  if (!progress.progress) {
    throw new Error('No progress data returned');
  }
  
  console.log('📊 Initial onboarding progress:', {
    currentLevel: progress.progress.currentLevel,
    completedTasks: progress.progress.completedTasks,
    totalProgress: progress.progress.totalProgress
  });
  
  // Should start at Level 1 with no completed tasks
  if (progress.progress.currentLevel !== 1) {
    throw new Error(`Expected level 1, got ${progress.progress.currentLevel}`);
  }
  
  if (progress.progress.completedTasks.length !== 0) {
    throw new Error(`Expected 0 completed tasks, got ${progress.progress.completedTasks.length}`);
  }
  
  console.log('✅ Onboarding initialization test passed');
  return { user, progress };
}

async function testFirstFormPublishedTask() {
  console.log('\n🧪 Testing First Form Published Task...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Simulate first form published
  const result = await updateOnboardingProgress(
    user.userId, 
    user.token, 
    'publish-form', 
    'Publish the form', 
    1, 
    '🎉 First form published!'
  );
  
  if (!result.success) {
    throw new Error('Failed to update onboarding progress');
  }
  
  console.log('📊 Task completion result:', {
    success: result.success,
    levelUp: result.levelUp,
    newLevel: result.newLevel,
    completedTasks: result.completedTasks
  });
  
  // Verify the task was completed
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  if (!progress.progress.completedTasks.includes('publish-form')) {
    throw new Error('publish-form task not found in completed tasks');
  }
  
  console.log('✅ First form published task test passed');
  return { user, result, progress };
}

async function testFirstSubmissionFoundTask() {
  console.log('\n🧪 Testing First Submission Found Task...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Simulate first submission found
  const result = await updateOnboardingProgress(
    user.userId, 
    user.token, 
    'submit-form', 
    'Submit the published form', 
    1, 
    '🎉 First submission received!'
  );
  
  if (!result.success) {
    throw new Error('Failed to update onboarding progress');
  }
  
  console.log('📊 Task completion result:', {
    success: result.success,
    levelUp: result.levelUp,
    newLevel: result.newLevel,
    completedTasks: result.completedTasks
  });
  
  // Verify the task was completed
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  if (!progress.progress.completedTasks.includes('submit-form')) {
    throw new Error('submit-form task not found in completed tasks');
  }
  
  console.log('✅ First submission found task test passed');
  return { user, result, progress };
}

async function testLevelProgression() {
  console.log('\n🧪 Testing Level Progression...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Complete first task (should level up to Level 2)
  const result1 = await updateOnboardingProgress(
    user.userId, 
    user.token, 
    'publish-form', 
    'Publish the form', 
    1, 
    '🎉 First form published!'
  );
  
  if (!result1.levelUp) {
    throw new Error('Expected level up after first task completion');
  }
  
  if (result1.newLevel !== 2) {
    throw new Error(`Expected level 2, got ${result1.newLevel}`);
  }
  
  console.log('✅ Level progression test passed');
  return { user, result1 };
}

async function testDuplicateTaskCompletion() {
  console.log('\n🧪 Testing Duplicate Task Completion Prevention...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Complete task first time
  const result1 = await updateOnboardingProgress(
    user.userId, 
    user.token, 
    'publish-form', 
    'Publish the form', 
    1, 
    '🎉 First form published!'
  );
  
  if (!result1.success) {
    throw new Error('First task completion failed');
  }
  
  // Try to complete same task again
  const result2 = await updateOnboardingProgress(
    user.userId, 
    user.token, 
    'publish-form', 
    'Publish the form', 
    1, 
    '🎉 First form published!'
  );
  
  // Should still succeed but not duplicate the task
  if (!result2.success) {
    throw new Error('Second task completion should succeed');
  }
  
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  // Should only have one instance of the task
  const publishFormCount = progress.progress.completedTasks.filter(task => task === 'publish-form').length;
  if (publishFormCount !== 1) {
    throw new Error(`Expected 1 publish-form task, got ${publishFormCount}`);
  }
  
  console.log('✅ Duplicate task completion prevention test passed');
  return { user, result1, result2, progress };
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Onboarding Integration Tests - Phase 1');
  console.log('=' .repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  const tests = [
    { name: 'Onboarding Initialization', fn: testOnboardingInitialization },
    { name: 'First Form Published Task', fn: testFirstFormPublishedTask },
    { name: 'First Submission Found Task', fn: testFirstSubmissionFoundTask },
    { name: 'Level Progression', fn: testLevelProgression },
    { name: 'Duplicate Task Completion Prevention', fn: testDuplicateTaskCompletion }
  ];
  
  for (const test of tests) {
    try {
      console.log(`\n🧪 Running: ${test.name}`);
      await test.fn();
      results.passed++;
      results.tests.push({ name: test.name, status: 'PASSED' });
      console.log(`✅ ${test.name} - PASSED`);
    } catch (error) {
      results.failed++;
      results.tests.push({ name: test.name, status: 'FAILED', error: error.message });
      console.log(`❌ ${test.name} - FAILED: ${error.message}`);
    }
    
    // Add delay between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 Test Results Summary:');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.tests.filter(t => t.status === 'FAILED').forEach(test => {
      console.log(`  - ${test.name}: ${test.error}`);
    });
  }
  
  console.log('\n🏁 Onboarding Integration Tests Complete');
  
  return results;
}

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
