/**
 * Test Complete Onboarding Integration Flow
 * Tests the end-to-end user journey from form creation to onboarding updates
 */

const axios = require('axios');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

// Test utilities
function generateTestEmail() {
  return `test_flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@example.com`;
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

async function createAnonymousForm() {
  // Create anonymous session
  const sessionResponse = await axios.post(`${RAILWAY_URL}/api/auth/anonymous-session`);
  if (!sessionResponse.data.success) {
    throw new Error('Failed to create anonymous session');
  }
  
  const anonymousSessionId = sessionResponse.data.sessionId;
  console.log(`✅ Anonymous session created: ${anonymousSessionId}`);
  
  // Create anonymous form
  const formData = {
    title: 'Test Form',
    fields: [
      {
        id: 'name',
        type: 'text',
        label: 'Name',
        required: true,
        placeholder: 'Enter your name'
      }
    ]
  };
  
  const formResponse = await axios.post(`${RAILWAY_URL}/store-anonymous-form`, {
    formData,
    userId: null,
    metadata: {
      source: 'test-integration',
      timestamp: new Date().toISOString()
    }
  });
  
  if (!formResponse.data.success) {
    throw new Error('Failed to create anonymous form');
  }
  
  return {
    formId: formResponse.data.formId,
    anonymousSessionId,
    formData
  };
}

async function migrateAnonymousForm(anonymousSessionId, userId) {
  const response = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, {
    tempUserId: anonymousSessionId,
    realUserId: userId
  });
  
  if (!response.data.success) {
    throw new Error('Failed to migrate anonymous form');
  }
  
  return response.data;
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

async function updateUserFlags(userId, token, flags) {
  const response = await axios.post(`${RAILWAY_URL}/api/user/update-onboarding-flags`, {
    userId,
    flags
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

// Test cases
async function testAnonymousFormMigrationFlow() {
  console.log('\n🧪 Testing Anonymous Form Migration Flow...');
  
  // Step 1: Create anonymous form
  const anonymousForm = await createAnonymousForm();
  console.log(`✅ Anonymous form created: ${anonymousForm.formId}`);
  
  // Step 2: Create user
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Step 3: Migrate form
  const migrationResult = await migrateAnonymousForm(anonymousForm.anonymousSessionId, user.userId);
  console.log(`✅ Form migrated: ${migrationResult.migratedForms} forms`);
  
  // Step 4: Check onboarding progress (should auto-complete create-form task)
  await new Promise(resolve => setTimeout(resolve, 2000));
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  if (!progress.success) {
    throw new Error('Failed to get onboarding progress');
  }
  
  console.log('📊 Onboarding progress after migration:', {
    currentLevel: progress.progress.currentLevel,
    completedTasks: progress.progress.completedTasks,
    totalProgress: progress.progress.totalProgress
  });
  
  // Should have create-form task completed due to existing forms
  if (!progress.progress.completedTasks.includes('create-form')) {
    throw new Error('create-form task not auto-completed after migration');
  }
  
  console.log('✅ Anonymous form migration flow test passed');
  return { user, anonymousForm, migrationResult, progress };
}

async function testFirstFormPublishedFlow() {
  console.log('\n🧪 Testing First Form Published Flow...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Wait for onboarding initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check initial progress
  const initialProgress = await getOnboardingProgress(user.userId, user.token);
  console.log('📊 Initial progress:', {
    currentLevel: initialProgress.progress.currentLevel,
    completedTasks: initialProgress.progress.completedTasks
  });
  
  // Simulate first form published
  const publishResult = await updateOnboardingProgress(
    user.userId,
    user.token,
    'publish-form',
    'Publish the form',
    1,
    '🚀 First form published!'
  );
  
  if (!publishResult.success) {
    throw new Error('Failed to complete publish-form task');
  }
  
  console.log('📊 Publish task result:', {
    success: publishResult.success,
    levelUp: publishResult.levelUp,
    newLevel: publishResult.newLevel
  });
  
  // Update user flags
  const flagsResult = await updateUserFlags(user.userId, user.token, {
    isFirstFormPublished: true
  });
  
  if (!flagsResult.success) {
    throw new Error('Failed to update user flags');
  }
  
  console.log('📊 User flags updated:', flagsResult.flags);
  
  // Verify final progress
  const finalProgress = await getOnboardingProgress(user.userId, user.token);
  console.log('📊 Final progress:', {
    currentLevel: finalProgress.progress.currentLevel,
    completedTasks: finalProgress.progress.completedTasks,
    totalProgress: finalProgress.progress.totalProgress
  });
  
  // Should have publish-form task completed
  if (!finalProgress.progress.completedTasks.includes('publish-form')) {
    throw new Error('publish-form task not found in completed tasks');
  }
  
  // Should have leveled up to Level 2
  if (finalProgress.progress.currentLevel !== 2) {
    throw new Error(`Expected level 2, got ${finalProgress.progress.currentLevel}`);
  }
  
  console.log('✅ First form published flow test passed');
  return { user, publishResult, flagsResult, finalProgress };
}

async function testFirstSubmissionFoundFlow() {
  console.log('\n🧪 Testing First Submission Found Flow...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Wait for onboarding initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Simulate first submission found
  const submissionResult = await updateOnboardingProgress(
    user.userId,
    user.token,
    'submit-form',
    'Submit the published form',
    1,
    '📝 First submission received!'
  );
  
  if (!submissionResult.success) {
    throw new Error('Failed to complete submit-form task');
  }
  
  console.log('📊 Submission task result:', {
    success: submissionResult.success,
    levelUp: submissionResult.levelUp,
    newLevel: submissionResult.newLevel
  });
  
  // Update user flags
  const flagsResult = await updateUserFlags(user.userId, user.token, {
    isFirstSubmissionFound: true
  });
  
  if (!flagsResult.success) {
    throw new Error('Failed to update user flags');
  }
  
  console.log('📊 User flags updated:', flagsResult.flags);
  
  // Verify progress
  const progress = await getOnboardingProgress(user.userId, user.token);
  console.log('📊 Progress after submission:', {
    currentLevel: progress.progress.currentLevel,
    completedTasks: progress.progress.completedTasks
  });
  
  // Should have submit-form task completed
  if (!progress.progress.completedTasks.includes('submit-form')) {
    throw new Error('submit-form task not found in completed tasks');
  }
  
  console.log('✅ First submission found flow test passed');
  return { user, submissionResult, flagsResult, progress };
}

async function testCompleteLevel1Flow() {
  console.log('\n🧪 Testing Complete Level 1 Flow...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Wait for onboarding initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Complete all Level 1 tasks
  const tasks = [
    { taskId: 'create-form', taskName: 'Chat with AI to create a form', reward: '🎉 First form created!' },
    { taskId: 'publish-form', taskName: 'Publish the form', reward: '🚀 First form published!' },
    { taskId: 'submit-form', taskName: 'Submit the published form', reward: '📝 First submission received!' }
  ];
  
  const results = [];
  for (const task of tasks) {
    const result = await updateOnboardingProgress(
      user.userId,
      user.token,
      task.taskId,
      task.taskName,
      1,
      task.reward
    );
    
    if (!result.success) {
      throw new Error(`Failed to complete ${task.taskId} task`);
    }
    
    results.push(result);
    console.log(`✅ Completed ${task.taskId}:`, {
      levelUp: result.levelUp,
      newLevel: result.newLevel
    });
    
    // Add delay between tasks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Update all user flags
  const flagsResult = await updateUserFlags(user.userId, user.token, {
    isFirstFormPublished: true,
    isFirstSubmissionFound: true
  });
  
  console.log('📊 All user flags updated:', flagsResult.flags);
  
  // Verify final progress
  const finalProgress = await getOnboardingProgress(user.userId, user.token);
  console.log('📊 Final Level 1 progress:', {
    currentLevel: finalProgress.progress.currentLevel,
    completedTasks: finalProgress.progress.completedTasks,
    totalProgress: finalProgress.progress.totalProgress
  });
  
  // Should have all Level 1 tasks completed
  const expectedTasks = ['create-form', 'publish-form', 'submit-form'];
  for (const task of expectedTasks) {
    if (!finalProgress.progress.completedTasks.includes(task)) {
      throw new Error(`${task} task not found in completed tasks`);
    }
  }
  
  // Should be at Level 2 (since completing any 1 task levels up)
  if (finalProgress.progress.currentLevel !== 2) {
    throw new Error(`Expected level 2, got ${finalProgress.progress.currentLevel}`);
  }
  
  console.log('✅ Complete Level 1 flow test passed');
  return { user, results, flagsResult, finalProgress };
}

// Main test runner
async function runCompleteOnboardingTests() {
  console.log('🚀 Starting Complete Onboarding Integration Tests');
  console.log('=' .repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  const tests = [
    { name: 'Anonymous Form Migration Flow', fn: testAnonymousFormMigrationFlow },
    { name: 'First Form Published Flow', fn: testFirstFormPublishedFlow },
    { name: 'First Submission Found Flow', fn: testFirstSubmissionFoundFlow },
    { name: 'Complete Level 1 Flow', fn: testCompleteLevel1Flow }
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
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 Complete Onboarding Integration Test Results:');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.tests.filter(t => t.status === 'FAILED').forEach(test => {
      console.log(`  - ${test.name}: ${test.error}`);
    });
  }
  
  console.log('\n🏁 Complete Onboarding Integration Tests Complete');
  
  return results;
}

// Run tests if called directly
if (require.main === module) {
  runCompleteOnboardingTests().catch(console.error);
}

module.exports = { runCompleteOnboardingTests };
