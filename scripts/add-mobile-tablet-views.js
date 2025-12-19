/**
 * Script to add a few mobile/tablet views for a form
 * so we can test device breakdown in analytics.
 *
 * Usage:
 *   node scripts/add-mobile-tablet-views.js <formId>
 */

const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

function initializeBigQuery() {
  let bigquery;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      bigquery = new BigQuery({
        projectId: 'chatterforms',
        credentials,
      });
      console.log('✅ GCP credentials loaded from environment variable');
    } catch (error) {
      console.error('❌ Error parsing credentials from environment:', error.message);
      throw error;
    }
  } else {
    const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
    if (fs.existsSync(keyPath)) {
      bigquery = new BigQuery({
        projectId: 'chatterforms',
        keyFilename: keyPath,
      });
      console.log('✅ GCP credentials loaded from key file');
    } else {
      throw new Error('GCP credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or place chatterforms-app-key.json in project root.');
    }
  }

  return bigquery;
}

async function addMobileTabletViews(formId) {
  const bigquery = initializeBigQuery();

  console.log(`\n👁️  Adding mobile/tablet test views for form: ${formId}`);

  const now = new Date();
  const testDates = [
    { name: 'Mobile - 2 days ago', date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), deviceType: 'mobile' },
    { name: 'Tablet - 4 days ago', date: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), deviceType: 'tablet' },
  ];

  const views = [];
  const datasetId = 'form_submissions';
  const tableId = 'form_views';

  for (const td of testDates) {
    const viewId = `test_view_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = td.date.toISOString();
    const sessionId = `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const query = `
      INSERT INTO ` +
      `\`chatterforms.${datasetId}.${tableId}\`` +
      ` (view_id, form_id, timestamp, session_id, ip_address, user_agent, device_type, browser, os)
      VALUES
      (@viewId, @formId, @timestamp, @sessionId, @ipAddress, @userAgent, @deviceType, @browser, @os)
    `;

    const options = {
      query,
      params: {
        viewId,
        formId,
        timestamp,
        sessionId,
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script - Mobile/Tablet',
        deviceType: td.deviceType,
        browser: 'Chrome',
        os: 'MacOS',
      },
    };

    try {
      await bigquery.query(options);
      console.log(`✅ Created ${td.deviceType} view: ${viewId} for ${td.name} (${td.date.toISOString().split('T')[0]})`);
      views.push({ id: viewId, date: td.date, name: td.name, deviceType: td.deviceType });
    } catch (error) {
      console.error(`❌ Failed to create view for ${td.name}:`, error.message);
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Created ${views.length} mobile/tablet views`);
  views.forEach(v => {
    console.log(`   - ${v.name} [${v.deviceType}]: ${v.date.toISOString().split('T')[0]} (${v.id})`);
  });

  console.log('\n✅ Mobile/tablet views added. Re-run analytics overview to see updated device breakdown.');

  return views;
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/add-mobile-tablet-views.js <formId>');
  console.error('   Example: node scripts/add-mobile-tablet-views.js form_1766105374712_sep5miemq');
  process.exit(1);
}

addMobileTabletViews(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
