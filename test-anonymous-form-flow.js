#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Anonymous Form Creation and Migration Flow
 * 
 * This test suite covers:
 * 1. Anonymous session creation
 * 2. Anonymous form creation with proper title
 * 3. Form migration during user signup
 * 4. Error handling and edge cases
 * 5. Race condition scenarios
 */

const axios = require('axios');

// Configuration
const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';
const TEST_USER_EMAIL = `test_${Date.now()}@example.com`;
const TEST_USER_PASSWORD = 'TestPassword123!';

// Test data
const TEST_FORM_DATA = {
  title: 'Test Football Team Registration',
  fields: [
    {
      id: 'team_name',
      type: 'text',
      label: 'Team Name',
      required: true,
      placeholder: 'Enter your team name'
    },
    {
      id: 'captain_email',
      type: 'email',
      label: 'Captain Email',
      required: true,
      placeholder: 'Enter captain email'
    }
  ]
};

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Utility functions
function logTest(testName, passed, error = null) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName}: ${error?.message || error}`);
  }
  testResults.details.push({ testName, passed, error: error?.message || error });
}

async function runTest(testName, testFunction) {
  try {
    await testFunction();
    logTest(testName, true);
  } catch (error) {
    logTest(testName, false, error);
  }
}

// ============== TEST CASES ==============

/**
 * Test 1: Anonymous Session Creation
 */
async function testAnonymousSessionCreation() {
  const response = await axios.post(`${RAILWAY_URL}/api/auth/anonymous-session`, {});
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.sessionId) {
    throw new Error('Expected sessionId in response');
  }
  
  if (!response.data.sessionId.startsWith('anon_')) {
    throw new Error('Expected sessionId to start with "anon_"');
  }
  
  return response.data.sessionId;
}

/**
 * Test 2: Anonymous Form Creation with Proper Title
 */
async function testAnonymousFormCreation() {
  const sessionId = await testAnonymousSessionCreation();
  
  const formData = {
    formData: TEST_FORM_DATA,
    userId: 'anonymous',
    metadata: {
      source: 'test-anonymous-form-creation',
      isPublished: false
    }
  };
  
  const response = await axios.post(`${RAILWAY_URL}/store-anonymous-form`, formData);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.formId) {
    throw new Error('Expected formId in response');
  }
  
  if (!response.data.anonymousSessionId) {
    throw new Error('Expected anonymousSessionId in response');
  }
  
  if (!response.data.isAnonymous) {
    throw new Error('Expected isAnonymous: true');
  }
  
  if (!response.data.userId || !response.data.userId.startsWith('temp_')) {
    throw new Error('Expected userId to start with "temp_"');
  }
  
  return {
    formId: response.data.formId,
    anonymousSessionId: response.data.anonymousSessionId,
    userId: response.data.userId
  };
}

/**
 * Test 3: User Signup
 */
async function testUserSignup() {
  const signupData = {
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
    firstName: 'Test',
    lastName: 'User'
  };
  
  const response = await axios.post(`${RAILWAY_URL}/auth/signup`, signupData);
  
  if (response.status !== 201) {
    throw new Error(`Expected status 201, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.data || !response.data.data.userId) {
    throw new Error('Expected userId in response data');
  }
  
  return {
    userId: response.data.data.userId,
    token: response.data.data.token
  };
}

/**
 * Test 4: Form Migration
 */
async function testFormMigration() {
  // First create an anonymous form
  const formResult = await testAnonymousFormCreation();
  
  // Then sign up a user
  const userResult = await testUserSignup();
  
  // Test migration
  const migrationData = {
    realUserId: userResult.userId,
    anonymousUserId: formResult.anonymousSessionId
  };
  
  const response = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, migrationData);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (!response.data.migratedFormIds || response.data.migratedFormIds.length === 0) {
    throw new Error('Expected migratedFormIds array with at least one form');
  }
  
  if (!response.data.migratedFormIds.includes(formResult.formId)) {
    throw new Error(`Expected form ${formResult.formId} to be in migrated forms`);
  }
  
  return {
    migratedFormIds: response.data.migratedFormIds,
    originalFormId: formResult.formId
  };
}

/**
 * Test 5: Multiple Anonymous Forms Migration
 */
async function testMultipleFormsMigration() {
  // Create multiple anonymous forms
  const form1 = await testAnonymousFormCreation();
  const form2 = await testAnonymousFormCreation();
  
  // Sign up user
  const user = await testUserSignup();
  
  // Migrate all forms
  const migrationData = {
    realUserId: user.userId,
    anonymousUserId: form1.anonymousSessionId // Should migrate all forms from this session
  };
  
  const response = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, migrationData);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true');
  }
  
  if (response.data.migratedFormIds.length < 2) {
    throw new Error(`Expected at least 2 migrated forms, got ${response.data.migratedFormIds.length}`);
  }
  
  return response.data.migratedFormIds;
}

/**
 * Test 6: Error Handling - Invalid Anonymous Session
 */
async function testInvalidAnonymousSessionMigration() {
  const user = await testUserSignup();
  
  const migrationData = {
    realUserId: user.userId,
    anonymousUserId: 'invalid_session_id'
  };
  
  const response = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, migrationData);
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (!response.data.success) {
    throw new Error('Expected success: true even for invalid session');
  }
  
  if (response.data.migratedFormIds.length !== 0) {
    throw new Error('Expected no migrated forms for invalid session');
  }
}

/**
 * Test 7: Form Title Preservation
 */
async function testFormTitlePreservation() {
  const formResult = await testAnonymousFormCreation();
  
  // Verify the form was created with the correct title
  const formResponse = await axios.get(`${RAILWAY_URL}/api/forms/${formResult.formId}`);
  
  if (formResponse.status !== 200) {
    throw new Error(`Expected status 200, got ${formResponse.status}`);
  }
  
  if (!formResponse.data.success) {
    throw new Error('Expected success: true');
  }
  
  const form = formResponse.data.form;
  if (!form.structure || form.structure.title !== TEST_FORM_DATA.title) {
    throw new Error(`Expected form title "${TEST_FORM_DATA.title}", got "${form.structure?.title}"`);
  }
  
  return form;
}

/**
 * Test 8: Race Condition - Form Creation During Migration
 */
async function testRaceConditionHandling() {
  const formResult = await testAnonymousFormCreation();
  const user = await testUserSignup();
  
  // Start migration
  const migrationPromise = axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, {
    realUserId: user.userId,
    anonymousUserId: formResult.anonymousSessionId
  });
  
  // Try to create another form with the same session (should not interfere)
  const anotherFormPromise = testAnonymousFormCreation();
  
  // Wait for both to complete
  const [migrationResult, anotherFormResult] = await Promise.all([migrationPromise, anotherFormPromise]);
  
  if (!migrationResult.data.success) {
    throw new Error('Migration should succeed even with concurrent form creation');
  }
  
  if (!anotherFormResult.formId) {
    throw new Error('Concurrent form creation should succeed');
  }
  
  return {
    migrationResult: migrationResult.data,
    anotherFormResult
  };
}

// ============== MAIN TEST RUNNER ==============

async function runAllTests() {
  console.log('🧪 Starting Anonymous Form Creation and Migration Tests...\n');
  console.log(`🔗 Testing against: ${RAILWAY_URL}\n`);
  
  // Run all tests
  await runTest('Anonymous Session Creation', testAnonymousSessionCreation);
  await runTest('Anonymous Form Creation with Proper Title', testAnonymousFormCreation);
  await runTest('User Signup', testUserSignup);
  await runTest('Form Migration', testFormMigration);
  await runTest('Multiple Forms Migration', testMultipleFormsMigration);
  await runTest('Error Handling - Invalid Anonymous Session', testInvalidAnonymousSessionMigration);
  await runTest('Form Title Preservation', testFormTitlePreservation);
  await runTest('Race Condition Handling', testRaceConditionHandling);
  
  // Print results
  console.log('\n📊 Test Results Summary:');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.total}`);
  console.log(`🎯 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.details
      .filter(test => !test.passed)
      .forEach(test => console.log(`  - ${test.testName}: ${test.error}`));
  }
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testAnonymousSessionCreation,
  testAnonymousFormCreation,
  testFormMigration,
  testMultipleFormsMigration,
  testFormTitlePreservation,
  testRaceConditionHandling
};
