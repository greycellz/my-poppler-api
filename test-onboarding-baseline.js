/**
 * Baseline Onboarding Test - Single Test
 * Tests core onboarding functionality with minimal API calls
 */

const axios = require('axios');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

async function testOnboardingBaseline() {
  console.log('🧪 Testing Onboarding Baseline...');
  
  try {
    // Create test user
    const email = `test_${Date.now()}@example.com`;
    console.log(`📧 Creating test user: ${email}`);
    
    const signupResponse = await axios.post(`${RAILWAY_URL}/auth/signup`, {
      email,
      password: 'Test$123',
      firstName: 'Test',
      lastName: 'User'
    });
    
    if (signupResponse.status !== 201) {
      throw new Error(`User creation failed: ${signupResponse.status}`);
    }
    
    const userId = signupResponse.data.data.user.id;
    const token = signupResponse.data.data.token;
    console.log(`✅ Test user created: ${userId}`);
    
    // Wait for initialization
    console.log('⏳ Waiting for onboarding initialization...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get onboarding progress
    console.log('📊 Getting onboarding progress...');
    const progressResponse = await axios.get(`${RAILWAY_URL}/api/onboarding/progress/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!progressResponse.data.success) {
      throw new Error('Failed to get onboarding progress');
    }
    
    const progress = progressResponse.data.progress;
    console.log('📊 Onboarding progress:', {
      currentLevel: progress.currentLevel,
      completedTasks: progress.completedTasks,
      totalProgress: progress.totalProgress
    });
    
    // Test task completion
    console.log('🎯 Testing task completion...');
    const taskResponse = await axios.post(`${RAILWAY_URL}/api/onboarding/complete-task`, {
      userId,
      taskId: 'publish-form',
      taskName: 'Publish the form',
      level: 1,
      reward: '🎉 First form published!'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!taskResponse.data.success) {
      throw new Error('Failed to complete task');
    }
    
    console.log('📊 Task completion result:', {
      success: taskResponse.data.success,
      levelUp: taskResponse.data.levelUp,
      newLevel: taskResponse.data.newLevel
    });
    
    // Verify updated progress
    console.log('📊 Getting updated progress...');
    const updatedProgressResponse = await axios.get(`${RAILWAY_URL}/api/onboarding/progress/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const updatedProgress = updatedProgressResponse.data.progress;
    console.log('📊 Updated progress:', {
      currentLevel: updatedProgress.currentLevel,
      completedTasks: updatedProgress.completedTasks,
      totalProgress: updatedProgress.totalProgress
    });
    
    // Verify task was completed
    if (!updatedProgress.completedTasks.includes('publish-form')) {
      throw new Error('publish-form task not found in completed tasks');
    }
    
    console.log('✅ Onboarding baseline test passed!');
    return {
      success: true,
      userId,
      initialProgress: progress,
      finalProgress: updatedProgress
    };
    
  } catch (error) {
    console.error('❌ Onboarding baseline test failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run test
testOnboardingBaseline().then(result => {
  if (result.success) {
    console.log('\n🎉 All tests passed! Onboarding system is working correctly.');
  } else {
    console.log('\n💥 Tests failed. Onboarding system needs fixes.');
  }
}).catch(console.error);
