/**
 * Script to delete views with future dates from BigQuery
 * 
 * Usage: node scripts/delete-future-views.js <formId>
 */

const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

function getCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      console.log('✅ GCP credentials loaded from environment variable');
      return credentials;
    } catch (error) {
      console.error('❌ Error parsing credentials from environment:', error.message);
      throw error;
    }
  } else {
    const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
    if (fs.existsSync(keyPath)) {
      console.log('✅ GCP credentials loaded from key file');
      return keyPath;
    } else {
      throw new Error('GCP credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or place chatterforms-app-key.json in project root.');
    }
  }
}

async function deleteFutureViews(formId) {
  const credentials = getCredentials();
  const bigquery = new BigQuery({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  
  console.log(`\n🗑️  Deleting future date views for form: ${formId}\n`);
  
  // Get current date/time
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  
  console.log(`📅 Current date/time: ${now.toISOString()}`);
  console.log(`📅 End of today: ${endOfToday.toISOString()}\n`);
  
  // First, check how many future views exist
  const checkQuery = `
    SELECT 
      COUNT(*) as future_count,
      MIN(timestamp) as earliest_future,
      MAX(timestamp) as latest_future
    FROM \`chatterforms.form_submissions.form_views\`
    WHERE form_id = @formId
      AND timestamp > @endOfToday
  `;
  
  const [checkRows] = await bigquery.query({
    query: checkQuery,
    params: {
      formId,
      endOfToday: endOfToday.toISOString()
    }
  });
  
  const futureCount = checkRows[0]?.future_count || 0;
  
  if (futureCount === 0) {
    console.log('✅ No future views to delete');
    return;
  }
  
  console.log(`📊 Found ${futureCount} future views`);
  if (checkRows[0]?.earliest_future) {
    console.log(`   Earliest future: ${checkRows[0].earliest_future}`);
  }
  if (checkRows[0]?.latest_future) {
    console.log(`   Latest future: ${checkRows[0].latest_future}`);
  }
  
  console.log(`\n⚠️  About to delete ${futureCount} future views...`);
  
  // Delete future views
  const deleteQuery = `
    DELETE FROM \`chatterforms.form_submissions.form_views\`
    WHERE form_id = @formId
      AND timestamp > @endOfToday
  `;
  
  const [deleteResult] = await bigquery.query({
    query: deleteQuery,
    params: {
      formId,
      endOfToday: endOfToday.toISOString()
    }
  });
  
  console.log(`\n✅ Deleted ${futureCount} future views`);
  console.log(`✅ Cleanup completed`);
  
  return { deleted: futureCount };
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/delete-future-views.js <formId>');
  console.error('   Example: node scripts/delete-future-views.js form_1766105374712_sep5miemq');
  process.exit(1);
}

deleteFutureViews(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
