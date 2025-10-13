const axios = require('axios');

const BASE_URL = 'https://my-poppler-api-dev.up.railway.app';

async function correctUserLevel(userId) {
  try {
    console.log(`🔧 Correcting onboarding level for user: ${userId}`);
    
    const response = await axios.post(`${BASE_URL}/api/onboarding/correct-level`, {
      userId: userId
    });
    
    console.log('✅ Level correction response:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error correcting level:', error.response?.data || error.message);
    throw error;
  }
}

async function getOnboardingProgress(userId) {
  try {
    console.log(`📊 Getting current onboarding progress for user: ${userId}`);
    
    const response = await axios.get(`${BASE_URL}/api/onboarding/progress/${userId}`);
    
    console.log('📊 Current progress:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Error getting progress:', error.response?.data || error.message);
    throw error;
  }
}

async function fixUserLevel(userId) {
  try {
    console.log('🔍 Step 1: Getting current progress...');
    const currentProgress = await getOnboardingProgress(userId);
    
    if (currentProgress.success && currentProgress.progress) {
      console.log(`📊 Current Level: ${currentProgress.progress.currentLevel}`);
      console.log(`📊 Completed Tasks: ${currentProgress.progress.completedTasks.join(', ')}`);
    }
    
    console.log('\n🔧 Step 2: Correcting level...');
    const correctionResult = await correctUserLevel(userId);
    
    console.log('\n🔍 Step 3: Getting updated progress...');
    const updatedProgress = await getOnboardingProgress(userId);
    
    if (updatedProgress.success && updatedProgress.progress) {
      console.log(`📊 New Level: ${updatedProgress.progress.currentLevel}`);
      console.log(`📊 Completed Tasks: ${updatedProgress.progress.completedTasks.join(', ')}`);
    }
    
    console.log('\n✅ Level correction completed!');
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  }
}

// Instructions for the user
console.log('🔧 Onboarding Level Correction Tool');
console.log('=====================================');
console.log('');
console.log('To fix your onboarding level, you need to:');
console.log('1. Get your user ID from the browser console (localStorage.getItem("user"))');
console.log('2. Replace "YOUR_USER_ID_HERE" below with your actual user ID');
console.log('3. Run this script');
console.log('');
console.log('Example:');
console.log('node fix-user-level.js YOUR_ACTUAL_USER_ID');
console.log('');

// Get user ID from command line argument
const userId = process.argv[2];

if (!userId || userId === 'YOUR_USER_ID_HERE') {
  console.log('❌ Please provide your user ID as a command line argument');
  console.log('Usage: node fix-user-level.js YOUR_USER_ID');
  process.exit(1);
}

// Run the fix
fixUserLevel(userId);
