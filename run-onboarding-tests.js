/**
 * Test Runner for Onboarding System
 * Runs both database and API tests
 */

const { runAllTests: runDatabaseTests } = require('./test-onboarding-database');
const { runAllTests: runApiTests } = require('./test-onboarding-api');
const { testRailwayEndpoints } = require('./test-onboarding-railway-api');

async function runAllOnboardingTests() {
  console.log('🚀 Starting Complete Onboarding System Test Suite\n');
  console.log('=' .repeat(60));
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  try {
    // Run database tests
    console.log('\n📊 PHASE 1: Database Function Tests');
    console.log('-' .repeat(40));
    
    try {
      await runDatabaseTests();
      console.log('✅ Database tests completed successfully');
    } catch (error) {
      console.log('❌ Database tests failed:', error.message);
      totalFailed++;
    }
    
    // Run API tests
    console.log('\n🌐 PHASE 2: API Endpoint Tests');
    console.log('-' .repeat(40));
    
    try {
      await runApiTests();
      console.log('✅ API tests completed successfully');
    } catch (error) {
      console.log('❌ API tests failed:', error.message);
      totalFailed++;
    }
    
    // Run Railway API tests
    console.log('\n🚄 PHASE 3: Railway API Tests');
    console.log('-' .repeat(40));
    
    try {
      await testRailwayEndpoints();
      console.log('✅ Railway API tests completed successfully');
    } catch (error) {
      console.log('❌ Railway API tests failed:', error.message);
      totalFailed++;
    }
    
  } catch (error) {
    console.error('❌ Test suite runner error:', error);
    totalFailed++;
  }
  
  // Final summary
  console.log('\n' + '=' .repeat(60));
  console.log('🏁 ONBOARDING SYSTEM TEST SUITE COMPLETE');
  console.log('=' .repeat(60));
  
  if (totalFailed === 0) {
    console.log('🎉 All test phases passed! Onboarding system is ready.');
  } else {
    console.log(`⚠️ ${totalFailed} test phase(s) failed. Check the logs above.`);
  }
  
  console.log('\n📋 Next Steps:');
  console.log('1. If all tests pass, the onboarding system is ready for frontend integration');
  console.log('2. If tests fail, fix the issues before proceeding');
  console.log('3. Run help articles population script: node populate-help-articles.js');
  console.log('4. Begin frontend component development');
}

// Run all tests if this file is executed directly
if (require.main === module) {
  runAllOnboardingTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { runAllOnboardingTests };
