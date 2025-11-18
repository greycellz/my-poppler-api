#!/usr/bin/env node

/**
 * Robust Migration Test
 * 
 * This test follows the comprehensive testing framework guidelines
 * to ensure we catch real issues, not just API success flags
 */

const axios = require('axios');

// Configuration
const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';

// Test data cleanup tracking
const testData = {
  forms: [],
  users: [],
  sessions: []
};

// Helper functions
async function createAnonymousForm() {
  const formData = {
    formData: {
      title: `Robust Test Form ${Date.now()}`,
      fields: [
        {
          id: 'test_field',
          type: 'text',
          label: 'Test Field',
          required: true,
          placeholder: 'Enter test data'
        }
      ]
    },
    userId: 'anonymous',
    metadata: { source: 'robust-test' }
  };
  
  const response = await axios.post(`${RAILWAY_URL}/store-anonymous-form`, formData);
  
  if (!response.data.success) {
    throw new Error('Failed to create anonymous form');
  }
  
  const { formId, anonymousSessionId } = response.data;
  testData.forms.push(formId);
  testData.sessions.push(anonymousSessionId);
  
  return { formId, anonymousSessionId };
}

async function createTestUser() {
  const signupData = {
    email: `robust_test_${Date.now()}@example.com`,
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'User'
  };
  
  const response = await axios.post(`${RAILWAY_URL}/auth/signup`, signupData);
  
  if (!response.data.success) {
    throw new Error('Failed to create test user');
  }
  
  const userId = response.data.data?.user?.id;
  if (!userId) {
    throw new Error('No userId found in signup response');
  }
  
  testData.users.push(userId);
  
  return { userId, email: signupData.email };
}

async function getUserForms(userId) {
  const response = await axios.get(`${RAILWAY_URL}/api/forms/user/${userId}`);
  
  if (!response.data.success) {
    throw new Error(`Failed to get forms for user ${userId}`);
  }
  
  return response.data.forms || [];
}

async function getFormDetails(formId) {
  const response = await axios.get(`${RAILWAY_URL}/api/forms/${formId}`);
  
  if (!response.data.success) {
    throw new Error(`Failed to get form details for ${formId}`);
  }
  
  return response.data.form;
}

async function migrateForm(anonymousSessionId, userId) {
  const migrationData = {
    tempUserId: anonymousSessionId,
    realUserId: userId
  };
  
  const response = await axios.post(`${RAILWAY_URL}/api/forms/migrate-anonymous`, migrationData);
  
  if (!response.data.success) {
    throw new Error(`Migration failed: ${response.data.error}`);
  }
  
  return response.data;
}

async function verifyFormMigration(formId, anonymousSessionId, userId) {
  console.log(`🔍 Verifying migration for form ${formId}...`);
  
  // 1. Verify form details show correct ownership
  const formDetails = await getFormDetails(formId);
  
  if (formDetails.user_id !== userId) {
    throw new Error(`Form user_id mismatch: expected ${userId}, got ${formDetails.user_id}`);
  }
  
  if (formDetails.isAnonymous !== false) {
    throw new Error(`Form isAnonymous should be false, got ${formDetails.isAnonymous}`);
  }
  
  if (formDetails.anonymousSessionId !== null) {
    throw new Error(`Form anonymousSessionId should be null, got ${formDetails.anonymousSessionId}`);
  }
  
  if (!formDetails.migratedAt) {
    throw new Error('Form should have migratedAt timestamp');
  }
  
  console.log(`✅ Form details verified: user_id=${formDetails.user_id}, isAnonymous=${formDetails.isAnonymous}`);
  
  // 2. Verify form appears in user's form list
  const userForms = await getUserForms(userId);
  const migratedForm = userForms.find(f => f.id === formId);
  
  if (!migratedForm) {
    throw new Error(`Form ${formId} not found in user ${userId} form list`);
  }
  
  console.log(`✅ Form found in user's form list`);
  
  // 3. Verify form is no longer accessible via anonymous session
  // (This would require checking if anonymous session still has access)
  
  return {
    formDetails,
    userForms,
    migratedForm
  };
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...');
  
  // Note: In a real implementation, you'd want to delete the test data
  // For now, we'll just log what would be cleaned up
  console.log(`   - Forms to clean: ${testData.forms.join(', ')}`);
  console.log(`   - Users to clean: ${testData.users.join(', ')}`);
  console.log(`   - Sessions to clean: ${testData.sessions.join(', ')}`);
}

async function testRobustMigration() {
  console.log('🧪 Starting Robust Migration Test...\n');
  
  try {
    // Step 1: Create initial state
    console.log('1️⃣ Creating anonymous form...');
    const { formId, anonymousSessionId } = await createAnonymousForm();
    console.log(`✅ Anonymous form created: ${formId}`);
    console.log(`   - anonymousSessionId: ${anonymousSessionId}\n`);
    
    // Step 2: Create test user
    console.log('2️⃣ Creating test user...');
    const { userId, email } = await createTestUser();
    console.log(`✅ Test user created: ${userId} (${email})\n`);
    
    // Step 3: Verify initial state
    console.log('3️⃣ Verifying initial state...');
    const initialFormDetails = await getFormDetails(formId);
    
    console.log('🔍 Initial form details:', {
      userId: initialFormDetails.userId,
      user_id: initialFormDetails.user_id,
      isAnonymous: initialFormDetails.isAnonymous,
      anonymousSessionId: initialFormDetails.anonymousSessionId,
      expectedUserId: `temp_${anonymousSessionId}`
    });
    
    if (initialFormDetails.user_id !== `temp_${anonymousSessionId}`) {
      throw new Error(`Initial form user_id incorrect: expected temp_${anonymousSessionId}, got ${initialFormDetails.user_id}`);
    }
    
    if (initialFormDetails.isAnonymous !== true) {
      throw new Error(`Initial form isAnonymous should be true, got ${initialFormDetails.isAnonymous}`);
    }
    
    console.log(`✅ Initial state verified: userId=${initialFormDetails.userId}, isAnonymous=${initialFormDetails.isAnonymous}\n`);
    
    // Step 4: Perform migration
    console.log('4️⃣ Performing migration...');
    const migrationResult = await migrateForm(anonymousSessionId, userId);
    
    // Step 5: Verify API response
    console.log('5️⃣ Verifying API response...');
    if (!migrationResult.success) {
      throw new Error('Migration API returned success: false');
    }
    
    if (migrationResult.migratedForms !== 1) {
      throw new Error(`Expected 1 migrated form, got ${migrationResult.migratedForms}`);
    }
    
    console.log(`✅ API response verified: migratedForms=${migrationResult.migratedForms}\n`);
    
    // Step 6: Verify actual data state changes
    console.log('6️⃣ Verifying data state changes...');
    const verificationResult = await verifyFormMigration(formId, anonymousSessionId, userId);
    console.log(`✅ Data state changes verified\n`);
    
    // Step 7: Verify user can access the form
    console.log('7️⃣ Verifying user access...');
    const userForms = await getUserForms(userId);
    const userForm = userForms.find(f => f.id === formId);
    
    if (!userForm) {
      throw new Error('User cannot access migrated form');
    }
    
    console.log(`✅ User access verified: form found in user's account\n`);
    
    // Step 8: Final validation
    console.log('8️⃣ Final validation...');
    const finalFormDetails = await getFormDetails(formId);
    
    const validationChecks = [
      { name: 'Form belongs to user', check: finalFormDetails.user_id === userId },
      { name: 'Form is not anonymous', check: finalFormDetails.isAnonymous === false },
      { name: 'Anonymous session cleared', check: finalFormDetails.anonymousSessionId === null },
      { name: 'Migration timestamp set', check: !!finalFormDetails.migratedAt },
      { name: 'Form title preserved', check: finalFormDetails.structure?.title?.includes('Robust Test Form') }
    ];
    
    for (const check of validationChecks) {
      if (!check.check) {
        throw new Error(`Validation failed: ${check.name}`);
      }
    }
    
    console.log(`✅ All validation checks passed\n`);
    
    console.log('🎉 Robust Migration Test PASSED!');
    console.log('\n📋 Complete Test Summary:');
    console.log(`   - Form ID: ${formId}`);
    console.log(`   - Anonymous Session: ${anonymousSessionId}`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Migration Result: ${migrationResult.migratedForms} forms migrated`);
    console.log(`   - Final Form State: user_id=${finalFormDetails.user_id}, isAnonymous=${finalFormDetails.isAnonymous}`);
    console.log(`   - User Form Count: ${userForms.length}`);
    
    return {
      success: true,
      formId,
      anonymousSessionId,
      userId,
      migrationResult,
      verificationResult
    };
    
  } catch (error) {
    console.error('❌ Robust Migration Test FAILED:', error.message);
    console.error('   Stack trace:', error.stack);
    return {
      success: false,
      error: error.message
    };
  } finally {
    await cleanupTestData();
  }
}

// Run the test
if (require.main === module) {
  testRobustMigration().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { testRobustMigration };
