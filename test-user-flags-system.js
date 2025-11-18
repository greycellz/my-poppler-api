/**
 * Test User Onboarding Flags System
 * Tests the user flags tracking system for one-time task completion
 */

const axios = require('axios');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

// Test utilities
function generateTestEmail() {
  return `test_flags_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@example.com`;
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

async function updateUserFlags(userId, token, flags) {
  const response = await axios.post(`${RAILWAY_URL}/api/user/update-onboarding-flags`, {
    userId,
    flags
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

async function getOnboardingProgress(userId, token) {
  const response = await axios.get(`${RAILWAY_URL}/api/onboarding/progress/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

// Test cases
async function testUserFlagsInitialization() {
  console.log('\n🧪 Testing User Flags Initialization...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Wait for onboarding initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const progress = await getOnboardingProgress(user.userId, user.token);
  
  if (!progress.success) {
    throw new Error('Failed to get onboarding progress');
  }
  
  console.log('📊 Initial progress:', {
    currentLevel: progress.progress.currentLevel,
    completedTasks: progress.progress.completedTasks
  });
  
  // User should start with no completed tasks
  if (progress.progress.completedTasks.length !== 0) {
    throw new Error(`Expected 0 completed tasks, got ${progress.progress.completedTasks.length}`);
  }
  
  console.log('✅ User flags initialization test passed');
  return { user, progress };
}

async function testFirstFormPublishedFlag() {
  console.log('\n🧪 Testing First Form Published Flag...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Set first form published flag
  const flagsResult = await updateUserFlags(user.userId, user.token, {
    isFirstFormPublished: true
  });
  
  if (!flagsResult.success) {
    throw new Error('Failed to update user flags');
  }
  
  console.log('📊 Flags updated:', flagsResult.flags);
  
  // Verify flag was set
  if (!flagsResult.flags.isFirstFormPublished) {
    throw new Error('isFirstFormPublished flag not set correctly');
  }
  
  console.log('✅ First form published flag test passed');
  return { user, flagsResult };
}

async function testMultipleFlagsUpdate() {
  console.log('\n🧪 Testing Multiple Flags Update...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Set multiple flags
  const flagsResult = await updateUserFlags(user.userId, user.token, {
    isFirstFormPublished: true,
    isFirstSubmissionFound: true,
    isFirstAIModification: true
  });
  
  if (!flagsResult.success) {
    throw new Error('Failed to update user flags');
  }
  
  console.log('📊 Multiple flags updated:', flagsResult.flags);
  
  // Verify all flags were set
  if (!flagsResult.flags.isFirstFormPublished) {
    throw new Error('isFirstFormPublished flag not set');
  }
  if (!flagsResult.flags.isFirstSubmissionFound) {
    throw new Error('isFirstSubmissionFound flag not set');
  }
  if (!flagsResult.flags.isFirstAIModification) {
    throw new Error('isFirstAIModification flag not set');
  }
  
  console.log('✅ Multiple flags update test passed');
  return { user, flagsResult };
}

async function testFlagsPersistence() {
  console.log('\n🧪 Testing Flags Persistence...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  // Set initial flags
  const initialFlags = await updateUserFlags(user.userId, user.token, {
    isFirstFormPublished: true,
    isFirstSubmissionFound: false
  });
  
  console.log('📊 Initial flags set:', initialFlags.flags);
  
  // Update with additional flags
  const updatedFlags = await updateUserFlags(user.userId, user.token, {
    isFirstSubmissionFound: true,
    isFirstAIModification: true
  });
  
  console.log('📊 Updated flags:', updatedFlags.flags);
  
  // Verify persistence - first flag should still be true
  if (!updatedFlags.flags.isFirstFormPublished) {
    throw new Error('isFirstFormPublished flag was lost during update');
  }
  
  // Verify new flags were added
  if (!updatedFlags.flags.isFirstSubmissionFound) {
    throw new Error('isFirstSubmissionFound flag not set');
  }
  if (!updatedFlags.flags.isFirstAIModification) {
    throw new Error('isFirstAIModification flag not set');
  }
  
  console.log('✅ Flags persistence test passed');
  return { user, initialFlags, updatedFlags };
}

async function testInvalidUserFlags() {
  console.log('\n🧪 Testing Invalid User Flags...');
  
  const user = await createTestUser();
  console.log(`✅ Test user created: ${user.userId}`);
  
  try {
    // Try to update flags for non-existent user
    await updateUserFlags('invalid-user-id', user.token, {
      isFirstFormPublished: true
    });
    throw new Error('Expected error for invalid user ID');
  } catch (error) {
    if (error.response && error.response.status === 500) {
      console.log('✅ Invalid user ID correctly rejected');
    } else {
      throw error;
    }
  }
  
  try {
    // Try to update flags without required fields
    await axios.post(`${RAILWAY_URL}/api/user/update-onboarding-flags`, {
      userId: user.userId
      // Missing flags field
    }, {
      headers: { Authorization: `Bearer ${user.token}` }
    });
    throw new Error('Expected error for missing flags');
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log('✅ Missing flags correctly rejected');
    } else {
      throw error;
    }
  }
  
  console.log('✅ Invalid user flags test passed');
  return { user };
}

// Main test runner
async function runUserFlagsTests() {
  console.log('🚀 Starting User Flags System Tests');
  console.log('=' .repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  const tests = [
    { name: 'User Flags Initialization', fn: testUserFlagsInitialization },
    { name: 'First Form Published Flag', fn: testFirstFormPublishedFlag },
    { name: 'Multiple Flags Update', fn: testMultipleFlagsUpdate },
    { name: 'Flags Persistence', fn: testFlagsPersistence },
    { name: 'Invalid User Flags', fn: testInvalidUserFlags }
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
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 User Flags System Test Results:');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.tests.filter(t => t.status === 'FAILED').forEach(test => {
      console.log(`  - ${test.name}: ${test.error}`);
    });
  }
  
  console.log('\n🏁 User Flags System Tests Complete');
  
  return results;
}

// Run tests if called directly
if (require.main === module) {
  runUserFlagsTests().catch(console.error);
}

module.exports = { runUserFlagsTests };
