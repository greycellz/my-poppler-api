#!/usr/bin/env node

/**
 * Test Migration Fix
 * 
 * Tests that the migration endpoint now works correctly with the fixed function
 */

const axios = require('axios');

// Configuration
const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';

async function testMigrationFix() {
  console.log('🧪 Testing Migration Fix...\n');
  
  try {
    // Step 1: Create anonymous form
    console.log('1️⃣ Creating anonymous form...');
    const formData = {
      formData: {
        title: 'Migration Test Form',
        fields: [
          {
            id: 'test_field',
            type: 'text',
            label: 'Test Field',
            required: true
          }
        ]
      },
      userId: 'anonymous',
      metadata: { source: 'migration-test' }
    };
    
    const formResponse = await axios.post(`${RAILWAY_URL}/store-anonymous-form`, formData);
    
    if (!formResponse.data.success) {
      throw new Error('Failed to create anonymous form');
    }
    
    const { formId, anonymousSessionId } = formResponse.data;
    console.log(`✅ Anonymous form created: ${formId}`);
    console.log(`   - anonymousSessionId: ${anonymousSessionId}\n`);
    
    // Step 2: Create user
    console.log('2️⃣ Creating test user...');
    const signupData = {
      email: `migration_test_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User'
    };
    
    const signupResponse = await axios.post(`${RAILWAY_URL}/auth/signup`, signupData);
    
    if (!signupResponse.data.success) {
      throw new Error('Failed to create user');
    }
    
    console.log('🔍 Signup response data:', signupResponse.data);
    
    const userId = signupResponse.data.data?.user?.id || signupResponse.data.data?.userId || signupResponse.data.userId;
    console.log(`✅ User created: ${userId}\n`);
    
    if (!userId) {
      throw new Error('No userId found in signup response');
    }
    
    // Step 3: Test migration with correct parameters
    console.log('3️⃣ Testing migration...');
    const migrationData = {
      tempUserId: anonymousSessionId,
      realUserId: userId
    };
    
    const migrationResponse = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, migrationData);
    
    if (!migrationResponse.data.success) {
      throw new Error('Migration failed');
    }
    
    const { migratedForms, migratedFormIds } = migrationResponse.data;
    console.log(`✅ Migration successful!`);
    console.log(`   - Migrated forms: ${migratedForms}`);
    console.log(`   - Form IDs: ${JSON.stringify(migratedFormIds)}\n`);
    
    // Step 4: Verify form was migrated
    console.log('4️⃣ Verifying form migration...');
    const getFormResponse = await axios.get(`${RAILWAY_URL}/api/forms/${formId}`);
    
    if (!getFormResponse.data.success) {
      throw new Error('Failed to retrieve migrated form');
    }
    
    const form = getFormResponse.data.form;
    if (form.userId !== userId) {
      throw new Error(`Expected userId ${userId}, got ${form.userId}`);
    }
    
    if (form.isAnonymous !== false) {
      throw new Error(`Expected isAnonymous false, got ${form.isAnonymous}`);
    }
    
    console.log(`✅ Form successfully migrated to user ${userId}\n`);
    
    console.log('🎉 Migration fix test PASSED!');
    console.log('\n📋 Summary:');
    console.log(`   - Form ID: ${formId}`);
    console.log(`   - Anonymous Session: ${anonymousSessionId}`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Migration: ${migratedForms} forms migrated`);
    
    return {
      success: true,
      formId,
      anonymousSessionId,
      userId,
      migratedForms
    };
    
  } catch (error) {
    console.error('❌ Migration fix test FAILED:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
if (require.main === module) {
  testMigrationFix().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { testMigrationFix };
