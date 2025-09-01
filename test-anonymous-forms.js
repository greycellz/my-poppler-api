#!/usr/bin/env node

/**
 * Test script for anonymous form creation and migration
 * Run with: node test-anonymous-forms.js
 */

const GCPClient = require('./gcp-client');

async function testAnonymousForms() {
  console.log('🧪 Testing anonymous form functionality...\n');
  
  const gcpClient = new GCPClient();
  
  try {
    // Test 1: Generate temporary user ID
    console.log('1️⃣ Testing temporary user ID generation...');
    const tempUserId1 = gcpClient.generateTemporaryUserId();
    const tempUserId2 = gcpClient.generateTemporaryUserId();
    
    console.log(`   Generated temp user ID 1: ${tempUserId1}`);
    console.log(`   Generated temp user ID 2: ${tempUserId2}`);
    console.log(`   IDs are different: ${tempUserId1 !== tempUserId2}\n`);
    
    // Test 2: Create anonymous session
    console.log('2️⃣ Testing anonymous session creation...');
    const sessionResult = await gcpClient.createAnonymousSession(
      tempUserId1.replace('temp_', ''),
      'Test User Agent',
      '127.0.0.1'
    );
    console.log(`   Session creation result:`, sessionResult, '\n');
    
    // Test 3: Store anonymous form
    console.log('3️⃣ Testing anonymous form storage...');
    const testFormData = {
      id: 'test-form-1',
      schema: {
        title: 'Test Anonymous Form',
        fields: [
          { id: 'name', type: 'text', label: 'Name' }
        ]
      }
    };
    
    const formResult = await gcpClient.storeFormStructure(
      'test-form-1',
      testFormData,
      'anonymous', // This should trigger temp user ID generation
      {
        title: 'Test Anonymous Form',
        userAgent: 'Test User Agent',
        ipAddress: '127.0.0.1'
      }
    );
    
    console.log(`   Form storage result:`, formResult, '\n');
    
    // Test 4: Verify form was stored with temp user ID
    console.log('4️⃣ Testing form retrieval...');
    const storedForm = await gcpClient.getFormStructure('test-form-1');
    console.log(`   Stored form user_id: ${storedForm?.user_id}`);
    console.log(`   Is anonymous: ${storedForm?.isAnonymous}`);
    console.log(`   Has anonymous session: ${!!storedForm?.anonymousSessionId}\n`);
    
    // Test 5: Test form migration
    console.log('5️⃣ Testing form migration...');
    const realUserId = 'real-user-123';
    const migrationResult = await gcpClient.migrateAnonymousFormsToUser(
      formResult.userId, // The temp user ID
      realUserId
    );
    
    console.log(`   Migration result:`, migrationResult, '\n');
    
    // Test 6: Verify migration
    console.log('6️⃣ Verifying migration...');
    const migratedForm = await gcpClient.getFormStructure('test-form-1');
    console.log(`   Migrated form user_id: ${migratedForm?.user_id}`);
    console.log(`   Is anonymous: ${migratedForm?.isAnonymous}`);
    console.log(`   Migration timestamp: ${migratedForm?.migratedAt}\n`);
    
    // Test 7: Test forms retrieval for real user
    console.log('7️⃣ Testing forms retrieval for real user...');
    const userForms = await gcpClient.getFormsByUserId(realUserId);
    console.log(`   Forms for real user: ${userForms.length}`);
    console.log(`   Form titles: ${userForms.map(f => f.title).join(', ')}\n`);
    
    console.log('✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testAnonymousForms();
