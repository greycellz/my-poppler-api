/**
 * Test script to check what the analytics endpoint returns for different date ranges
 * 
 * Usage: node scripts/test-analytics-endpoint.js <formId>
 */

const fetch = require('node-fetch');

async function testAnalyticsEndpoint(formId) {
  const railwayURL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';
  
  console.log(`\n🧪 Testing analytics endpoint for form: ${formId}\n`);
  
  const dateRanges = [7, 30];
  
  for (const days of dateRanges) {
    console.log(`\n📊 Testing dateRange: ${days} days`);
    console.log(`   URL: ${railwayURL}/analytics/forms/${formId}/overview?dateRange=${days}d`);
    
    try {
      const response = await fetch(
        `${railwayURL}/analytics/forms/${formId}/overview?dateRange=${days}d`
      );
      
      if (!response.ok) {
        console.error(`   ❌ Error: ${response.status} ${response.statusText}`);
        continue;
      }
      
      const data = await response.json();
      
      console.log(`   ✅ Response received`);
      console.log(`   Total Views: ${data.totalViews}`);
      console.log(`   Total Submissions: ${data.totalSubmissions}`);
      console.log(`   Completion Rate: ${data.completionRate}%`);
      console.log(`   Last Submission: ${data.lastSubmission}`);
      
      const viewsDates = data.trends?.views?.map(v => v.date) || [];
      const submissionsDates = data.trends?.submissions?.map(s => s.date) || [];
      
      console.log(`   Views dates: ${viewsDates.join(', ')}`);
      console.log(`   Submissions dates: ${submissionsDates.join(', ')}`);
      
      const viewsSum = data.trends?.views?.reduce((sum, v) => sum + v.count, 0) || 0;
      const submissionsSum = data.trends?.submissions?.reduce((sum, s) => sum + s.count, 0) || 0;
      
      console.log(`   Views sum from trends: ${viewsSum}`);
      console.log(`   Submissions sum from trends: ${submissionsSum}`);
      
      if (viewsSum !== data.totalViews) {
        console.log(`   ⚠️  MISMATCH: Views sum (${viewsSum}) != totalViews (${data.totalViews})`);
      }
      if (submissionsSum !== data.totalSubmissions) {
        console.log(`   ⚠️  MISMATCH: Submissions sum (${submissionsSum}) != totalSubmissions (${data.totalSubmissions})`);
      }
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
    }
  }
  
  console.log(`\n✅ Test completed\n`);
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/test-analytics-endpoint.js <formId>');
  console.error('   Example: node scripts/test-analytics-endpoint.js form_1766105374712_sep5miemq');
  process.exit(1);
}

testAnalyticsEndpoint(formId)
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
