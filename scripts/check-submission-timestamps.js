/**
 * Script to check actual timestamps stored in Firestore submissions
 * 
 * Usage: node scripts/check-submission-timestamps.js <formId>
 */

const { Firestore } = require('@google-cloud/firestore');
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

async function checkTimestamps(formId) {
  const credentials = getCredentials();
  const firestore = new Firestore({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  
  console.log(`\n🔍 Checking timestamps for form: ${formId}`);
  console.log(`📁 Collection: ${getCollectionName('submissions')}\n`);
  
  // Get all submissions for this form
  const submissionsSnapshot = await firestore
    .collection(getCollectionName('submissions'))
    .where('form_id', '==', formId)
    .get();
  
  console.log(`📊 Found ${submissionsSnapshot.docs.length} total submissions\n`);
  
  const submissions = [];
  submissionsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.timestamp) {
      let date;
      if (data.timestamp.toDate) {
        date = data.timestamp.toDate();
      } else if (data.timestamp instanceof Date) {
        date = data.timestamp;
      } else {
        date = new Date(data.timestamp);
      }
      
      submissions.push({
        id: data.submission_id || doc.id,
        timestamp: data.timestamp,
        date: date,
        dateStr: date.toISOString().split('T')[0],
        dateTimeStr: date.toISOString(),
      });
    }
  });
  
  // Sort by date
  submissions.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  console.log('📅 Submission Timestamps:\n');
  submissions.forEach((sub, index) => {
    console.log(`${index + 1}. ${sub.id}`);
    console.log(`   Date: ${sub.dateStr}`);
    console.log(`   Full: ${sub.dateTimeStr}`);
    console.log(`   Timestamp type: ${sub.timestamp.constructor?.name || typeof sub.timestamp}`);
    if (sub.timestamp.seconds !== undefined) {
      console.log(`   Firestore seconds: ${sub.timestamp.seconds}`);
      console.log(`   Firestore nanoseconds: ${sub.timestamp.nanoseconds}`);
    }
    console.log('');
  });
  
  // Group by date
  const byDate = {};
  submissions.forEach(sub => {
    if (!byDate[sub.dateStr]) {
      byDate[sub.dateStr] = [];
    }
    byDate[sub.dateStr].push(sub);
  });
  
  console.log('📊 Grouped by Date:\n');
  Object.keys(byDate).sort().forEach(dateStr => {
    console.log(`  ${dateStr}: ${byDate[dateStr].length} submission(s)`);
  });
  
  // Test date range filtering
  console.log('\n🔍 Testing Date Range Filters:\n');
  const { Firestore: FirestoreClass } = require('@google-cloud/firestore');
  
  [7, 30, 90].forEach(days => {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    dateFrom.setHours(0, 0, 0, 0);
    
    const dateFromTimestamp = FirestoreClass.Timestamp.fromDate(dateFrom);
    
    const filtered = submissions.filter(sub => {
      if (sub.timestamp.toDate) {
        return sub.timestamp.toDate() >= dateFrom;
      }
      return sub.date >= dateFrom;
    });
    
    console.log(`  Last ${days} days (from ${dateFrom.toISOString().split('T')[0]}):`);
    console.log(`    Found ${filtered.length} submissions`);
    if (filtered.length > 0) {
      const dates = [...new Set(filtered.map(s => s.dateStr))].sort();
      console.log(`    Dates: ${dates.join(', ')}`);
    }
    console.log('');
  });
  
  return submissions;
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/check-submission-timestamps.js <formId>');
  console.error('   Example: node scripts/check-submission-timestamps.js form_1766105374712_sep5miemq');
  process.exit(1);
}

checkTimestamps(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
