/**
 * Test Suite for Onboarding System Database Functions
 * Tests all onboarding-related database operations
 */

const GCPClient = require('./gcp-client');

// Test configuration
const TEST_USER_ID = 'test_user_onboarding_' + Date.now();
const TEST_TASK_ID = 'test-task-completion';
const TEST_HELP_TASK_ID = 'test-help-task';

// Initialize GCP client
const gcpClient = new GCPClient();

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

// ============== TEST CASES ==============

async function testInitializeOnboardingProgress() {
  const progress = await gcpClient.initializeOnboardingProgress(TEST_USER_ID);
  
  // Verify initial state
  if (progress.currentLevel !== 1) {
    throw new Error(`Expected currentLevel to be 1, got ${progress.currentLevel}`);
  }
  
  if (progress.completedTasks.length !== 0) {
    throw new Error(`Expected completedTasks to be empty, got ${progress.completedTasks.length} tasks`);
  }
  
  if (progress.totalProgress !== 0) {
    throw new Error(`Expected totalProgress to be 0, got ${progress.totalProgress}`);
  }
  
  if (progress.achievements.length !== 0) {
    throw new Error(`Expected achievements to be empty, got ${progress.achievements.length} achievements`);
  }
  
  if (!progress.startedAt || !progress.lastUpdated) {
    throw new Error('Expected startedAt and lastUpdated to be set');
  }
}

async function testGetOnboardingProgress() {
  const progress = await gcpClient.getOnboardingProgress(TEST_USER_ID);
  
  if (!progress) {
    throw new Error('Expected to retrieve onboarding progress');
  }
  
  if (progress.currentLevel !== 1) {
    throw new Error(`Expected currentLevel to be 1, got ${progress.currentLevel}`);
  }
}

async function testUpdateOnboardingProgress() {
  const progress = await gcpClient.updateOnboardingProgress(
    TEST_USER_ID,
    TEST_TASK_ID,
    'Test Task Completion',
    1,
    'Test Achievement!'
  );
  
  // Verify task was added
  if (!progress.completedTasks.includes(TEST_TASK_ID)) {
    throw new Error('Expected completed task to be in completedTasks array');
  }
  
  // Verify achievement was added
  const achievement = progress.achievements.find(a => a.id === TEST_TASK_ID);
  if (!achievement) {
    throw new Error('Expected achievement to be added');
  }
  
  if (achievement.task !== 'Test Task Completion') {
    throw new Error(`Expected achievement task to be 'Test Task Completion', got '${achievement.task}'`);
  }
  
  if (achievement.reward !== 'Test Achievement!') {
    throw new Error(`Expected achievement reward to be 'Test Achievement!', got '${achievement.reward}'`);
  }
  
  // Verify progress calculation
  if (progress.totalProgress <= 0) {
    throw new Error(`Expected totalProgress to be > 0, got ${progress.totalProgress}`);
  }
}

async function testDuplicateTaskCompletion() {
  // Try to complete the same task again
  const progress = await gcpClient.updateOnboardingProgress(
    TEST_USER_ID,
    TEST_TASK_ID,
    'Test Task Completion (Duplicate)',
    1,
    'Duplicate Achievement!'
  );
  
  // Should not add duplicate task
  const taskCount = progress.completedTasks.filter(task => task === TEST_TASK_ID).length;
  if (taskCount !== 1) {
    throw new Error(`Expected task to appear only once, found ${taskCount} times`);
  }
  
  // Should not add duplicate achievement
  const achievementCount = progress.achievements.filter(a => a.id === TEST_TASK_ID).length;
  if (achievementCount !== 1) {
    throw new Error(`Expected achievement to appear only once, found ${achievementCount} times`);
  }
}

async function testLevelProgression() {
  // Complete tasks from Level 1 to trigger level up
  const level1Tasks = ['chat-with-ai', 'publish-form', 'submit-form'];
  
  for (const taskId of level1Tasks) {
    await gcpClient.updateOnboardingProgress(
      TEST_USER_ID,
      taskId,
      `Level 1 Task: ${taskId}`,
      1,
      `Level 1 Achievement: ${taskId}`
    );
  }
  
  // Get updated progress
  const progress = await gcpClient.getOnboardingProgress(TEST_USER_ID);
  
  // Should have leveled up to Level 2
  if (progress.currentLevel !== 2) {
    throw new Error(`Expected to level up to 2, got ${progress.currentLevel}`);
  }
  
  // Should have 4 completed tasks (1 test + 3 level 1 tasks)
  if (progress.completedTasks.length !== 4) {
    throw new Error(`Expected 4 completed tasks, got ${progress.completedTasks.length}`);
  }
}

async function testLogOnboardingEvent() {
  await gcpClient.logOnboardingEvent(
    TEST_USER_ID,
    'test_event',
    'test-task',
    1,
    { testMetadata: 'test_value' }
  );
  
  // Verify event was logged by retrieving analytics
  const analytics = await gcpClient.getOnboardingAnalytics(TEST_USER_ID);
  
  const testEvent = analytics.find(event => event.event === 'test_event');
  if (!testEvent) {
    throw new Error('Expected to find logged test event');
  }
  
  if (testEvent.taskId !== 'test-task') {
    throw new Error(`Expected taskId to be 'test-task', got '${testEvent.taskId}'`);
  }
  
  if (testEvent.metadata.testMetadata !== 'test_value') {
    throw new Error(`Expected metadata to contain test value, got '${testEvent.metadata.testMetadata}'`);
  }
}

async function testUpsertHelpArticle() {
  const helpData = {
    title: 'Test Help Article',
    content: 'This is a test help article for testing purposes.',
    steps: ['Step 1: Do something', 'Step 2: Do something else'],
    tips: ['Tip 1: Be careful', 'Tip 2: Take your time'],
    related: ['related-task-1', 'related-task-2']
  };
  
  await gcpClient.upsertHelpArticle(TEST_HELP_TASK_ID, helpData);
  
  // Verify help article was created
  const helpArticle = await gcpClient.getHelpArticle(TEST_HELP_TASK_ID);
  
  if (!helpArticle) {
    throw new Error('Expected to retrieve help article');
  }
  
  if (helpArticle.title !== helpData.title) {
    throw new Error(`Expected title to be '${helpData.title}', got '${helpArticle.title}'`);
  }
  
  if (helpArticle.content !== helpData.content) {
    throw new Error(`Expected content to match, got '${helpArticle.content}'`);
  }
  
  if (helpArticle.steps.length !== helpData.steps.length) {
    throw new Error(`Expected ${helpData.steps.length} steps, got ${helpArticle.steps.length}`);
  }
  
  if (helpArticle.tips.length !== helpData.tips.length) {
    throw new Error(`Expected ${helpData.tips.length} tips, got ${helpArticle.tips.length}`);
  }
  
  if (helpArticle.related.length !== helpData.related.length) {
    throw new Error(`Expected ${helpData.related.length} related tasks, got ${helpArticle.related.length}`);
  }
}

async function testUpdateHelpArticle() {
  const updatedHelpData = {
    title: 'Updated Test Help Article',
    content: 'This is an updated test help article.',
    steps: ['Updated Step 1', 'Updated Step 2', 'New Step 3'],
    tips: ['Updated Tip 1'],
    related: ['updated-related-task']
  };
  
  await gcpClient.upsertHelpArticle(TEST_HELP_TASK_ID, updatedHelpData);
  
  // Verify help article was updated
  const helpArticle = await gcpClient.getHelpArticle(TEST_HELP_TASK_ID);
  
  if (helpArticle.title !== updatedHelpData.title) {
    throw new Error(`Expected updated title, got '${helpArticle.title}'`);
  }
  
  if (helpArticle.steps.length !== 3) {
    throw new Error(`Expected 3 steps after update, got ${helpArticle.steps.length}`);
  }
  
  if (helpArticle.version !== 2) {
    throw new Error(`Expected version to be 2, got ${helpArticle.version}`);
  }
}

async function testGetOnboardingAnalytics() {
  const analytics = await gcpClient.getOnboardingAnalytics(TEST_USER_ID);
  
  if (!Array.isArray(analytics)) {
    throw new Error('Expected analytics to be an array');
  }
  
  // Should have at least the test event we logged
  if (analytics.length === 0) {
    throw new Error('Expected to find at least one analytics event');
  }
  
  // Verify events are sorted by timestamp (descending)
  for (let i = 1; i < analytics.length; i++) {
    const current = new Date(analytics[i].timestamp);
    const previous = new Date(analytics[i - 1].timestamp);
    
    if (current > previous) {
      throw new Error('Analytics events should be sorted by timestamp (descending)');
    }
  }
}

async function testErrorHandling() {
  // Test with non-existent user
  try {
    await gcpClient.getOnboardingProgress('non_existent_user_12345');
    throw new Error('Expected error for non-existent user');
  } catch (error) {
    if (!error.message.includes('User not found')) {
      throw new Error(`Expected 'User not found' error, got: ${error.message}`);
    }
  }
  
  // Test with invalid task ID
  try {
    await gcpClient.getHelpArticle('non_existent_task');
    // This should return null, not throw an error
  } catch (error) {
    throw new Error(`Expected null for non-existent help article, got error: ${error.message}`);
  }
}

async function testProgressCalculation() {
  // Complete all Level 1 tasks to test progress calculation
  const allLevel1Tasks = ['chat-with-ai', 'publish-form', 'submit-form'];
  
  // Reset by creating a new test user
  const newTestUserId = 'test_progress_calc_' + Date.now();
  await gcpClient.initializeOnboardingProgress(newTestUserId);
  
  // Complete all Level 1 tasks
  for (const taskId of allLevel1Tasks) {
    await gcpClient.updateOnboardingProgress(
      newTestUserId,
      taskId,
      `Progress Test Task: ${taskId}`,
      1,
      `Progress Test Achievement: ${taskId}`
    );
  }
  
  const progress = await gcpClient.getOnboardingProgress(newTestUserId);
  
  // Should be at Level 2
  if (progress.currentLevel !== 2) {
    throw new Error(`Expected to be at Level 2, got ${progress.currentLevel}`);
  }
  
  // Should have 3 completed tasks
  if (progress.completedTasks.length !== 3) {
    throw new Error(`Expected 3 completed tasks, got ${progress.completedTasks.length}`);
  }
  
  // Progress should be calculated correctly (3 out of 20 total tasks = 15%)
  const expectedProgress = Math.round((3 / 20) * 100);
  if (progress.totalProgress !== expectedProgress) {
    throw new Error(`Expected progress to be ${expectedProgress}%, got ${progress.totalProgress}%`);
  }
}

// ============== CLEANUP FUNCTIONS ==============

async function cleanupTestData() {
  try {
    console.log('🧹 Cleaning up test data...');
    
    // Note: In a real test environment, you might want to delete the test user
    // and related data. For now, we'll just log the test user ID for manual cleanup
    console.log(`📝 Test user ID for manual cleanup: ${TEST_USER_ID}`);
    console.log(`📝 Test help task ID for manual cleanup: ${TEST_HELP_TASK_ID}`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

// ============== MAIN TEST RUNNER ==============

async function runAllTests() {
  console.log('🧪 Starting Onboarding Database Tests...\n');
  
  try {
    // Core functionality tests
    await runTest('Initialize Onboarding Progress', testInitializeOnboardingProgress);
    await runTest('Get Onboarding Progress', testGetOnboardingProgress);
    await runTest('Update Onboarding Progress', testUpdateOnboardingProgress);
    await runTest('Duplicate Task Completion Prevention', testDuplicateTaskCompletion);
    await runTest('Level Progression', testLevelProgression);
    
    // Analytics tests
    await runTest('Log Onboarding Event', testLogOnboardingEvent);
    await runTest('Get Onboarding Analytics', testGetOnboardingAnalytics);
    
    // Help system tests
    await runTest('Create Help Article', testUpsertHelpArticle);
    await runTest('Update Help Article', testUpdateHelpArticle);
    
    // Edge cases and error handling
    await runTest('Error Handling', testErrorHandling);
    await runTest('Progress Calculation', testProgressCalculation);
    
  } catch (error) {
    console.error('❌ Test runner error:', error);
  }
  
  // Print results
  console.log('\n📊 Test Results Summary:');
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
  
  // Cleanup
  await cleanupTestData();
  
  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testInitializeOnboardingProgress,
  testGetOnboardingProgress,
  testUpdateOnboardingProgress,
  testLogOnboardingEvent,
  testUpsertHelpArticle,
  testGetOnboardingAnalytics
};
