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

// Test with a specific user ID
async function testCorrectLevel() {
  try {
    // Replace with actual user ID from your system
    const userId = 'YOUR_USER_ID_HERE';
    
    if (userId === 'YOUR_USER_ID_HERE') {
      console.log('❌ Please replace YOUR_USER_ID_HERE with an actual user ID');
      return;
    }
    
    const result = await correctUserLevel(userId);
    console.log('🎯 Correction result:', result);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testCorrectLevel();

