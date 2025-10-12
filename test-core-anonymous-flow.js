#!/usr/bin/env node

/**
 * Core Anonymous Form Flow Test
 * 
 * Tests the essential functionality:
 * 1. Anonymous session creation
 * 2. Anonymous form creation with proper title
 * 3. Verify response includes anonymousSessionId
 */

const axios = require('axios');

// Configuration
const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';

// Test data
const TEST_FORM_DATA = {
  title: 'Core Test Football Team Registration',
  fields: [
    {
      id: 'team_name',
      type: 'text',
      label: 'Team Name',
      required: true,
      placeholder: 'Enter your team name'
    }
  ]
};

async function testCoreFlow() {
  console.log('🧪 Testing Core Anonymous Form Flow...\n');
  
  try {
    // Step 1: Create anonymous session
    console.log('1️⃣ Creating anonymous session...');
    const sessionResponse = await axios.post(`${RAILWAY_URL}/api/auth/anonymous-session`, {});
    
    if (!sessionResponse.data.success || !sessionResponse.data.sessionId) {
      throw new Error('Failed to create anonymous session');
    }
    
    const sessionId = sessionResponse.data.sessionId;
    console.log(`✅ Anonymous session created: ${sessionId}\n`);
    
    // Step 2: Create anonymous form
    console.log('2️⃣ Creating anonymous form...');
    const formData = {
      formData: TEST_FORM_DATA,
      userId: 'anonymous',
      metadata: {
        source: 'core-test',
        isPublished: false
      }
    };
    
    const formResponse = await axios.post(`${RAILWAY_URL}/store-anonymous-form`, formData);
    
    if (!formResponse.data.success) {
      throw new Error('Failed to create anonymous form');
    }
    
    const { formId, anonymousSessionId, isAnonymous, userId } = formResponse.data;
    console.log(`✅ Anonymous form created: ${formId}`);
    console.log(`   - anonymousSessionId: ${anonymousSessionId}`);
    console.log(`   - isAnonymous: ${isAnonymous}`);
    console.log(`   - userId: ${userId}\n`);
    
    // Step 3: Verify form was created with correct title
    console.log('3️⃣ Verifying form title...');
    const getFormResponse = await axios.get(`${RAILWAY_URL}/api/forms/${formId}`);
    
    if (!getFormResponse.data.success) {
      throw new Error('Failed to retrieve form');
    }
    
    const form = getFormResponse.data.form;
    if (form.structure.title !== TEST_FORM_DATA.title) {
      throw new Error(`Expected title "${TEST_FORM_DATA.title}", got "${form.structure.title}"`);
    }
    
    console.log(`✅ Form title verified: "${form.structure.title}"\n`);
    
    // Step 4: Verify anonymousSessionId is available for migration
    console.log('4️⃣ Verifying migration readiness...');
    if (!anonymousSessionId) {
      throw new Error('anonymousSessionId is missing - migration will fail');
    }
    
    console.log(`✅ Migration ready - anonymousSessionId: ${anonymousSessionId}\n`);
    
    console.log('🎉 Core anonymous form flow test PASSED!');
    console.log('\n📋 Summary:');
    console.log(`   - Anonymous session: ${sessionId}`);
    console.log(`   - Form ID: ${formId}`);
    console.log(`   - Form title: "${form.structure.title}"`);
    console.log(`   - Migration ID: ${anonymousSessionId}`);
    
    return {
      success: true,
      sessionId,
      formId,
      anonymousSessionId,
      formTitle: form.structure.title
    };
    
  } catch (error) {
    console.error('❌ Core anonymous form flow test FAILED:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
if (require.main === module) {
  testCoreFlow().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { testCoreFlow };
