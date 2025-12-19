/**
 * Test script to validate device breakdown in analytics overview endpoint
 *
 * Usage:
 *   node scripts/test-device-analytics.js <formId> [days]
 *
 * - <formId> is required
 * - [days] is optional (default: tests 7 and 30)
 */

const fetch = require('node-fetch');

async function testDeviceAnalytics(formId, daysArray) {
  const railwayURL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';

  console.log(`\n🧪 Testing device analytics for form: ${formId}`);
  console.log(`   Base URL: ${railwayURL}`);

  for (const days of daysArray) {
    const url = `${railwayURL}/analytics/forms/${formId}/overview?dateRange=${days}d`;
    console.log(`\n📊 Date range: last ${days} days`);
    console.log(`   GET ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`   ❌ Error: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();

      console.log('   🔍 Top-level keys:', Object.keys(data));
      console.log(`   Total Views: ${data.totalViews}`);
      console.log(`   Total Submissions: ${data.totalSubmissions}`);
      console.log(`   Completion Rate: ${data.completionRate}%`);
      console.log(`   Last Submission: ${data.lastSubmission}`);

      const deviceBreakdown = data.deviceBreakdown || null;

      if (!deviceBreakdown) {
        console.log('   ⚠️ No deviceBreakdown field present in response');
        continue;
      }

      console.log('   🔍 deviceBreakdown keys:', Object.keys(deviceBreakdown));
      console.log('   Raw deviceBreakdown:', JSON.stringify(deviceBreakdown, null, 2));

      // Extract view counts by device
      const desktopViews = (deviceBreakdown.desktop && deviceBreakdown.desktop.views) || 0;
      const mobileViews = (deviceBreakdown.mobile && deviceBreakdown.mobile.views) || 0;
      const tabletViews = (deviceBreakdown.tablet && deviceBreakdown.tablet.views) || 0;
      const otherViews = (deviceBreakdown.other && deviceBreakdown.other.views) || 0;

      const sumDeviceViews = desktopViews + mobileViews + tabletViews + otherViews;

      console.log('   📱 Device views:');
      console.log(`     Desktop: ${desktopViews}`);
      console.log(`     Mobile : ${mobileViews}`);
      console.log(`     Tablet : ${tabletViews}`);
      console.log(`     Other  : ${otherViews}`);
      console.log(`   ➕ Sum of device views: ${sumDeviceViews}`);

      if (typeof data.totalViews === 'number') {
        if (sumDeviceViews !== data.totalViews) {
          console.log(
            `   ⚠️ MISMATCH: sum(device views) (${sumDeviceViews}) != totalViews (${data.totalViews})`
          );
        } else {
          console.log('   ✅ Sum of device views matches totalViews');
        }
      } else {
        console.log('   ⚠️ totalViews is not a number – cannot compare');
      }
    } catch (error) {
      console.error('   ❌ Error calling analytics endpoint:', error.message);
    }
  }

  console.log('\n✅ Device analytics test completed\n');
}

const formId = process.argv[2];
const singleDays = process.argv[3] ? parseInt(process.argv[3], 10) : null;

if (!formId) {
  console.error('❌ Usage: node scripts/test-device-analytics.js <formId> [days]');
  console.error('   Example (7 & 30 days): node scripts/test-device-analytics.js form_123');
  console.error('   Example (single 7-day window): node scripts/test-device-analytics.js form_123 7');
  process.exit(1);
}

const daysArray = singleDays && !isNaN(singleDays) ? [singleDays] : [7, 30];

console.log('🔍 INSPECTING REQUEST PARAMETERS');
console.log('   formId:', formId);
console.log('   daysArray:', daysArray);

 testDeviceAnalytics(formId, daysArray)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
