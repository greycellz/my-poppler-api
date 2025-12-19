/**
 * Script to add test submissions and views for specific dates
 * - Dec 8 (or earlier) for testing 7-day filter
 * - ~60 days ago for testing 90-day filter
 * 
 * Usage: node scripts/add-specific-date-test-data.js <formId>
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

function getCollectionName(collectionName) {
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || 'dev';
  if (env === 'dev') {
    return `dev_${collectionName}`;
  } else if (env === 'staging') {
    return `staging_${collectionName}`;
  }
  return collectionName;
}

function initializeFirestore() {
  const credentials = getCredentials();
  return new Firestore({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
}

function initializeBigQuery() {
  const credentials = getCredentials();
  return new BigQuery({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
}

async function addSpecificDateData(formId) {
  const firestore = initializeFirestore();
  const bigquery = initializeBigQuery();
  
  console.log(`\n📝 Adding test data for specific dates for form: ${formId}\n`);
  
  // Get form structure
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
  
  // Create test submission data
  function createTestSubmissionData() {
    if (!formStructure || !formStructure.fields) {
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
          break;
      }
    });
    return submissionData;
  }
  
  // Define specific test dates
  const now = new Date();
  const testDates = [
    { name: 'Dec 8 (11 days ago)', date: new Date(2025, 11, 8, 12, 0, 0) }, // Dec 8, 2025
    { name: 'Dec 7 (12 days ago)', date: new Date(2025, 11, 7, 14, 30, 0) }, // Dec 7, 2025
    { name: '~60 days ago', date: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
    { name: '~65 days ago', date: new Date(now.getTime() - 65 * 24 * 60 * 60 * 1000) },
  ];
  
  console.log('📅 Test dates to add:\n');
  testDates.forEach(td => {
    console.log(`   ${td.name}: ${td.date.toISOString().split('T')[0]}`);
  });
  console.log('');
  
  const submissions = [];
  const views = [];
  
  // Add submissions
  console.log('📝 Adding submissions...\n');
  for (const testDate of testDates) {
    const submissionId = `test_sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const submissionData = createTestSubmissionData();
    const timestamp = Firestore.Timestamp.fromDate(testDate.date);
    
    const submissionDoc = {
      submission_id: submissionId,
      form_id: formId,
      user_id: 'test_user',
      submission_data: submissionData,
      timestamp: timestamp,
      ip_address: '127.0.0.1',
      user_agent: 'Test Script',
      is_hipaa: false,
      encrypted: false,
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
  
  // Add views
  console.log('\n👁️  Adding views...\n');
  for (const testDate of testDates) {
    const viewId = `test_view_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = testDate.date.toISOString();
    const sessionId = `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const query = `
      INSERT INTO \`chatterforms.form_submissions.form_views\`
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
  
  // Update form submission count
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
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created ${submissions.length} submissions`);
  console.log(`   Created ${views.length} views`);
  console.log(`   Form ID: ${formId}`);
  console.log(`\n📅 Added dates:`);
  [...submissions, ...views].forEach(item => {
    console.log(`   - ${item.name}: ${item.date.toISOString().split('T')[0]}`);
  });
  
  console.log(`\n✅ Test data added. Use date range filters to test:`);
  console.log(`   - Last 7 days: Should exclude Dec 8 and earlier`);
  console.log(`   - Last 90 days: Should include ~60 days ago data`);
  
  return { submissions, views };
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/add-specific-date-test-data.js <formId>');
  console.error('   Example: node scripts/add-specific-date-test-data.js form_1766105374712_sep5miemq');
  process.exit(1);
}

addSpecificDateData(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
