/**
 * Script to add test views with specific dates for analytics testing
 * 
 * Usage: node scripts/add-test-views.js <formId>
 * 
 * Creates views with dates:
 * - 5 days ago
 * - 3 days ago  
 * - 1 day ago
 * - Today
 * - 2 days from now
 * - 5 days from now
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
        credentials: credentials,
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

async function addTestViews(formId) {
  const bigquery = initializeBigQuery();
  
  console.log(`👁️  Adding test views for form: ${formId}`);
  
  // Define test dates (relative to now) - ONLY PAST DATES
  const now = new Date();
  const testDates = [
    { name: '7 days ago', date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    { name: '5 days ago', date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    { name: '3 days ago', date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { name: '1 day ago', date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
    { name: 'Today', date: new Date(now) },
  ];
  
  const views = [];
  const datasetId = 'form_submissions';
  const tableId = 'form_views';
  
  for (const testDate of testDates) {
    const viewId = `test_view_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = testDate.date.toISOString();
    
    // Insert into BigQuery form_views table
    // Include required fields: view_id, form_id, timestamp, session_id
    const sessionId = `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const query = `
      INSERT INTO \`chatterforms.${datasetId}.${tableId}\`
      (view_id, form_id, timestamp, session_id, ip_address, user_agent, device_type, browser, os)
      VALUES
      (@viewId, @formId, @timestamp, @sessionId, @ipAddress, @userAgent, @deviceType, @browser, @os)
    `;
    
    const options = {
      query: query,
      params: {
        viewId: viewId,
        formId: formId,
        timestamp: timestamp,
        sessionId: sessionId,
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'MacOS',
      },
    };
    
    try {
      await bigquery.query(options);
      console.log(`✅ Created view: ${viewId} for ${testDate.name} (${testDate.date.toISOString().split('T')[0]})`);
      views.push({ id: viewId, date: testDate.date, name: testDate.name });
    } catch (error) {
      console.error(`❌ Failed to create view for ${testDate.name}:`, error.message);
    }
  }
  
  // Update form_analytics table with view counts
  console.log(`\n🔄 Updating form_analytics aggregates...`);
  try {
    const countQuery = `
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT session_id) as unique_views,
        MAX(timestamp) as last_view
      FROM \`chatterforms.form_submissions.form_views\`
      WHERE form_id = @formId
    `;

    const [countRows] = await bigquery.query({
      query: countQuery,
      params: { formId }
    });

    const { total_views, unique_views, last_view } = countRows[0] || {};

    const params = {
      formId,
      totalViews: total_views || 0,
      uniqueViews: unique_views || 0
    };

    let mergeQuery;
    if (last_view) {
      params.lastView = last_view;
      mergeQuery = `
        MERGE \`chatterforms.form_submissions.form_analytics\` AS target
        USING (
          SELECT 
            @formId as form_id,
            @totalViews as total_views,
            @uniqueViews as unique_views,
            TIMESTAMP(@lastView) as last_view
        ) AS source
        ON target.form_id = source.form_id
        WHEN MATCHED THEN
          UPDATE SET
            total_views = source.total_views,
            unique_views = source.unique_views,
            last_view = source.last_view
        WHEN NOT MATCHED THEN
          INSERT (form_id, total_views, unique_views, last_view, submissions_count, is_hipaa, is_published)
          VALUES (source.form_id, source.total_views, source.unique_views, source.last_view, 0, false, true)
      `;
    } else {
      mergeQuery = `
        MERGE \`chatterforms.form_submissions.form_analytics\` AS target
        USING (
          SELECT 
            @formId as form_id,
            @totalViews as total_views,
            @uniqueViews as unique_views
        ) AS source
        ON target.form_id = source.form_id
        WHEN MATCHED THEN
          UPDATE SET
            total_views = source.total_views,
            unique_views = source.unique_views
        WHEN NOT MATCHED THEN
          INSERT (form_id, total_views, unique_views, submissions_count, is_hipaa, is_published)
          VALUES (source.form_id, source.total_views, source.unique_views, 0, false, true)
      `;
    }

    await bigquery.query({
      query: mergeQuery,
      params
    });

    console.log(`✅ Updated form_analytics: ${total_views} total views, ${unique_views} unique views`);
    
    // Recalculate completion rate
    const statsQuery = `
      SELECT 
        submissions_count,
        total_views
      FROM \`chatterforms.form_submissions.form_analytics\`
      WHERE form_id = @formId
    `;
    
    const [statsRows] = await bigquery.query({
      query: statsQuery,
      params: { formId }
    });
    
    if (statsRows.length > 0) {
      const { submissions_count, total_views } = statsRows[0];
      const completionRate = total_views > 0 
        ? Math.min((submissions_count / total_views) * 100, 100)
        : 0;
      
      await bigquery.query({
        query: `
          UPDATE \`chatterforms.form_submissions.form_analytics\`
          SET completion_rate = @completionRate
          WHERE form_id = @formId
        `,
        params: { formId, completionRate }
      });
      
      console.log(`✅ Updated completion rate: ${completionRate.toFixed(1)}%`);
    }
  } catch (error) {
    console.error('❌ Error updating form_analytics views:', error.message);
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created ${views.length} test views`);
  console.log(`   Form ID: ${formId}`);
  console.log(`   Table: form_submissions.form_views`);
  console.log(`\n📅 View dates:`);
  views.forEach(view => {
    console.log(`   - ${view.name}: ${view.date.toISOString().split('T')[0]} (${view.id})`);
  });
  
  console.log(`\n✅ Test views added. Refresh analytics page to see updated trends.`);
  
  return views;
}

// Run script
const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/add-test-views.js <formId>');
  console.error('   Example: node scripts/add-test-views.js form_1766105374712_sep5miemq');
  process.exit(1);
}

addTestViews(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
