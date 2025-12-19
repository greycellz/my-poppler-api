/**
 * Script to add test submissions with specific dates for analytics testing
 * 
 * Usage: node scripts/add-test-submissions.js <formId>
 * 
 * Creates submissions with dates:
 * - 5 days ago
 * - 3 days ago  
 * - 1 day ago
 * - Today
 * - 2 days from now
 * - 5 days from now
 */

const { Firestore } = require('@google-cloud/firestore');
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

function initializeFirestore() {
  const credentials = getCredentials();
  const firestore = new Firestore({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  return firestore;
}

function initializeBigQuery() {
  const credentials = getCredentials();
  const bigquery = new BigQuery({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  return bigquery;
}

function getCollectionName(collectionName) {
  // Default to 'dev' if not set, since we're testing on dev server
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || 'dev';
  if (env === 'dev') {
    return `dev_${collectionName}`;
  } else if (env === 'staging') {
    return `staging_${collectionName}`;
  }
  return collectionName;
}

async function updateFormAnalyticsSubmissions(formId, firestore, bigquery) {
  try {
    // Count submissions from Firestore
    const submissionsSnapshot = await firestore
      .collection(getCollectionName('submissions'))
      .where('form_id', '==', formId)
      .get();
    
    const submissionCount = submissionsSnapshot.size;
    
    // Get last submission date
    let lastSubmission = null;
    if (submissionCount > 0) {
      const submissions = [];
      submissionsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.timestamp) {
          submissions.push(data.timestamp.toDate());
        }
      });
      if (submissions.length > 0) {
        lastSubmission = new Date(Math.max(...submissions.map(d => d.getTime())));
      }
    }
    
    // Update form_analytics table
    const params = {
      formId,
      submissionCount: submissionCount
    };
    
    let mergeQuery;
    if (lastSubmission) {
      params.lastSubmission = lastSubmission.toISOString();
      mergeQuery = `
        MERGE \`chatterforms.form_submissions.form_analytics\` AS target
        USING (
          SELECT 
            @formId as form_id,
            @submissionCount as submissions_count,
            TIMESTAMP(@lastSubmission) as last_submission
        ) AS source
        ON target.form_id = source.form_id
        WHEN MATCHED THEN
          UPDATE SET
            submissions_count = source.submissions_count,
            last_submission = source.last_submission
        WHEN NOT MATCHED THEN
          INSERT (form_id, submissions_count, last_submission, total_views, unique_views, is_hipaa, is_published)
          VALUES (source.form_id, source.submissions_count, source.last_submission, 0, 0, false, true)
      `;
    } else {
      mergeQuery = `
        MERGE \`chatterforms.form_submissions.form_analytics\` AS target
        USING (
          SELECT 
            @formId as form_id,
            @submissionCount as submissions_count
        ) AS source
        ON target.form_id = source.form_id
        WHEN MATCHED THEN
          UPDATE SET
            submissions_count = source.submissions_count
        WHEN NOT MATCHED THEN
          INSERT (form_id, submissions_count, total_views, unique_views, is_hipaa, is_published)
          VALUES (source.form_id, source.submissions_count, 0, 0, false, true)
      `;
    }
    
    await bigquery.query({
      query: mergeQuery,
      params
    });
    
    console.log(`✅ Updated form_analytics: ${submissionCount} submissions`);
    
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
    console.error('❌ Error updating form_analytics submissions:', error.message);
  }
}

async function addTestSubmissions(formId) {
  const firestore = initializeFirestore();
  const bigquery = initializeBigQuery();
  
  console.log(`📝 Adding test submissions for form: ${formId}`);
  
  // Get form structure to create realistic submission data
  let formStructure = null;
  try {
    const formRef = firestore.collection(getCollectionName('forms')).doc(formId);
    const formDoc = await formRef.get();
    if (formDoc.exists) {
      formStructure = formDoc.data().structure;
      console.log(`✅ Found form structure with ${formStructure?.fields?.length || 0} fields`);
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch form structure, using minimal test data:', error.message);
  }
  
  // Create test submission data based on form structure
  function createTestSubmissionData() {
    if (!formStructure || !formStructure.fields) {
      // Minimal test data if form structure not available
      return {
        test_field: {
          type: 'text',
          value: `Test submission ${Date.now()}`
        }
      };
    }
    
    const submissionData = {};
    formStructure.fields.forEach(field => {
      switch (field.type) {
        case 'text':
        case 'email':
        case 'textarea':
          submissionData[field.id] = {
            type: field.type,
            value: `Test ${field.label || field.id} ${Date.now()}`
          };
          break;
        case 'select':
        case 'dropdown':
          if (field.options && field.options.length > 0) {
            submissionData[field.id] = {
              type: field.type,
              value: field.options[0]
            };
          }
          break;
        case 'checkbox':
        case 'radio':
          submissionData[field.id] = {
            type: field.type,
            value: true
          };
          break;
        case 'number':
          submissionData[field.id] = {
            type: field.type,
            value: Math.floor(Math.random() * 100)
          };
          break;
        default:
          // Skip complex fields for test data
          break;
      }
    });
    return submissionData;
  }
  
  // Define test dates (relative to now) - ONLY PAST DATES
  const now = new Date();
  const testDates = [
    { name: '7 days ago', date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    { name: '5 days ago', date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    { name: '3 days ago', date: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
    { name: '1 day ago', date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
    { name: 'Today', date: new Date(now) },
  ];
  
  const submissions = [];
  
  for (const testDate of testDates) {
    const submissionId = `test_sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const submissionData = createTestSubmissionData();
    
    // Create Firestore Timestamp from Date
    const timestamp = Firestore.Timestamp.fromDate(testDate.date);
    
    const submissionDoc = {
      submission_id: submissionId,
      form_id: formId,
      user_id: 'test_user',
      submission_data: submissionData,
      timestamp: timestamp, // Firestore Timestamp
      ip_address: '127.0.0.1',
      user_agent: 'Test Script',
      is_hipaa: false,
      encrypted: false,
      // Analytics metadata
      view_timestamp: null,
      start_timestamp: null,
      completion_time: null,
      session_id: `test_session_${Date.now()}`,
      file_associations: [],
      signature_fields: [],
    };
    
    try {
      await firestore.collection(getCollectionName('submissions')).doc(submissionId).set(submissionDoc);
      console.log(`✅ Created submission: ${submissionId} for ${testDate.name} (${testDate.date.toISOString().split('T')[0]})`);
      submissions.push({ id: submissionId, date: testDate.date, name: testDate.name });
    } catch (error) {
      console.error(`❌ Failed to create submission for ${testDate.name}:`, error.message);
    }
  }
  
  // Update form document with submission count
  try {
    const formRef = firestore.collection(getCollectionName('forms')).doc(formId);
    const formDoc = await formRef.get();
    if (formDoc.exists) {
      const formData = formDoc.data();
      const currentCount = formData.submission_count || 0;
      const newCount = currentCount + submissions.length;
      
      await formRef.update({
        submission_count: newCount,
        last_submission_date: Firestore.Timestamp.fromDate(new Date()),
        updated_at: Firestore.Timestamp.fromDate(new Date())
      });
      console.log(`\n📊 Updated form submission count: ${currentCount} → ${newCount}`);
    }
  } catch (error) {
    console.warn(`⚠️ Could not update form submission count:`, error.message);
  }
  
  // Update form_analytics table with actual submission counts
  console.log(`\n🔄 Updating form_analytics aggregates...`);
  await updateFormAnalyticsSubmissions(formId, firestore, bigquery);
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created ${submissions.length} test submissions`);
  console.log(`   Form ID: ${formId}`);
  console.log(`   Collection: ${getCollectionName('submissions')}`);
  console.log(`\n📅 Submission dates:`);
  submissions.forEach(sub => {
    console.log(`   - ${sub.name}: ${sub.date.toISOString().split('T')[0]} (${sub.id})`);
  });
  
  console.log(`\n✅ Test submissions added. Refresh submissions and analytics pages to see updated data.`);
  
  return submissions;
}

// Run script
const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/add-test-submissions.js <formId>');
  console.error('   Example: node scripts/add-test-submissions.js form_1766105374712_sep5miemq');
  process.exit(1);
}

addTestSubmissions(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
