/**
 * Quick script to check BigQuery data for a specific form
 * Usage: node test/check-form-analytics.js <formId>
 */

const GCPClient = require('../gcp-client');

async function checkFormAnalytics(formId) {
  console.log(`\n🔍 Checking BigQuery data for form: ${formId}\n`);
  console.log('═'.repeat(60));

  const gcpClient = new GCPClient();

  try {
    // 1. Check form_analytics table
    console.log('\n📊 1. Form Analytics (form_analytics table):');
    console.log('-'.repeat(60));
    
    const analyticsQuery = `
      SELECT 
        form_id,
        total_views,
        unique_views,
        submissions_count,
        completion_rate,
        avg_completion_time,
        device_mobile_count,
        device_desktop_count,
        device_tablet_count,
        last_view,
        last_submission
      FROM \`${gcpClient.projectId}.form_submissions.form_analytics\`
      WHERE form_id = @formId
    `;

    const [analyticsRows] = await gcpClient.bigquery.query({
      query: analyticsQuery,
      params: { formId }
    });

    if (analyticsRows.length === 0) {
      console.log('❌ No analytics data found in form_analytics table');
    } else {
      const analytics = analyticsRows[0];
      console.log('✅ Analytics data found:');
      console.log(`   - Total Views: ${analytics.total_views || 0}`);
      console.log(`   - Unique Views: ${analytics.unique_views || 0}`);
      console.log(`   - Submissions Count: ${analytics.submissions_count || 0}`);
      console.log(`   - Completion Rate: ${analytics.completion_rate ? analytics.completion_rate.toFixed(2) + '%' : '0%'}`);
      console.log(`   - Avg Completion Time: ${analytics.avg_completion_time || 'N/A'} seconds`);
      console.log(`   - Device Mobile: ${analytics.device_mobile_count || 0}`);
      console.log(`   - Device Desktop: ${analytics.device_desktop_count || 0}`);
      console.log(`   - Device Tablet: ${analytics.device_tablet_count || 0}`);
      console.log(`   - Last View: ${analytics.last_view ? analytics.last_view.value : 'N/A'}`);
      console.log(`   - Last Submission: ${analytics.last_submission ? analytics.last_submission.value : 'N/A'}`);
    }

    // 2. Check form_views table
    console.log('\n👁️  2. Form Views (form_views table):');
    console.log('-'.repeat(60));
    
    const viewsQuery = `
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT session_id) as unique_views,
        MIN(timestamp) as first_view,
        MAX(timestamp) as last_view
      FROM \`${gcpClient.projectId}.form_submissions.form_views\`
      WHERE form_id = @formId
    `;

    const [viewsRows] = await gcpClient.bigquery.query({
      query: viewsQuery,
      params: { formId }
    });

    if (viewsRows.length > 0) {
      const views = viewsRows[0];
      console.log('✅ View data found:');
      console.log(`   - Total Views in table: ${views.total_views || 0}`);
      console.log(`   - Unique Views (by session): ${views.unique_views || 0}`);
      console.log(`   - First View: ${views.first_view ? views.first_view.value : 'N/A'}`);
      console.log(`   - Last View: ${views.last_view ? views.last_view.value : 'N/A'}`);
    } else {
      console.log('❌ No views found in form_views table');
    }

    // 3. Get recent view events
    console.log('\n📋 3. Recent View Events (last 10):');
    console.log('-'.repeat(60));
    
    const recentViewsQuery = `
      SELECT 
        view_id,
        session_id,
        timestamp,
        device_type,
        browser,
        os
      FROM \`${gcpClient.projectId}.form_submissions.form_views\`
      WHERE form_id = @formId
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const [recentViewsRows] = await gcpClient.bigquery.query({
      query: recentViewsQuery,
      params: { formId }
    });

    if (recentViewsRows.length === 0) {
      console.log('❌ No recent view events found');
    } else {
      console.log(`✅ Found ${recentViewsRows.length} recent view events:`);
      recentViewsRows.forEach((view, idx) => {
        console.log(`   ${idx + 1}. ${view.view_id}`);
        console.log(`      Session: ${view.session_id}`);
        console.log(`      Time: ${view.timestamp.value}`);
        console.log(`      Device: ${view.device_type || 'N/A'}`);
        console.log(`      Browser: ${view.browser || 'N/A'}`);
        console.log('');
      });
    }

    // 4. Check Firestore submissions
    console.log('\n📝 4. Firestore Submissions:');
    console.log('-'.repeat(60));
    
    const submissions = await gcpClient.getFormSubmissions(formId);
    console.log(`✅ Found ${submissions.length} submissions in Firestore`);
    
    if (submissions.length > 0) {
      const withSessionId = submissions.filter(s => s.session_id).length;
      const withCompletionTime = submissions.filter(s => s.completion_time).length;
      console.log(`   - Submissions with session_id: ${withSessionId}`);
      console.log(`   - Submissions with completion_time: ${withCompletionTime}`);
      
      // Show first 3 submissions
      console.log('\n   First 3 submissions:');
      submissions.slice(0, 3).forEach((sub, idx) => {
        console.log(`   ${idx + 1}. ${sub.submission_id}`);
        console.log(`      Session ID: ${sub.session_id || 'N/A'}`);
        console.log(`      Completion Time: ${sub.completion_time || 'N/A'}s`);
        console.log(`      Timestamp: ${sub.timestamp?.toDate ? sub.timestamp.toDate() : sub.timestamp}`);
        console.log('');
      });
    }

    // 5. Comparison Summary
    console.log('\n📊 5. Comparison Summary:');
    console.log('═'.repeat(60));
    
    const analytics = analyticsRows[0] || {};
    const views = viewsRows[0] || {};
    
    console.log('\nFrontend shows:');
    console.log('   - Total Views: 0');
    console.log('   - Total Submissions: 3');
    console.log('   - Completion Rate: 0.0%');
    
    console.log('\nBigQuery shows:');
    console.log(`   - Total Views (form_analytics): ${analytics.total_views || 0}`);
    console.log(`   - Total Views (form_views table): ${views.total_views || 0}`);
    console.log(`   - Total Submissions: ${analytics.submissions_count || 0}`);
    console.log(`   - Completion Rate: ${analytics.completion_rate ? analytics.completion_rate.toFixed(2) + '%' : '0%'}`);
    
    console.log('\n🔍 Analysis:');
    if ((analytics.total_views || 0) === 0 && (views.total_views || 0) > 0) {
      console.log('   ⚠️  Views exist in form_views but not aggregated in form_analytics');
      console.log('   → MERGE may not be running or there\'s a sync issue');
    } else if ((analytics.total_views || 0) > 0 && (views.total_views || 0) === 0) {
      console.log('   ⚠️  Views in form_analytics but not in form_views (unexpected)');
    } else if ((analytics.total_views || 0) === 0 && (views.total_views || 0) === 0) {
      console.log('   ℹ️  No views tracked yet for this form');
    } else {
      console.log('   ✅ Views are properly aggregated');
    }

    console.log('\n');

  } catch (error) {
    console.error('❌ Error querying BigQuery:', error);
    throw error;
  }
}

// Get form ID from command line
const formId = process.argv[2];

if (!formId) {
  console.error('❌ Please provide a form ID');
  console.error('Usage: node test/check-form-analytics.js <formId>');
  process.exit(1);
}

checkFormAnalytics(formId)
  .then(() => {
    console.log('✅ Check complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Check failed:', error);
    process.exit(1);
  });
