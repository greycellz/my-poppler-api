/**
 * Script to delete submissions with future dates
 * 
 * Usage: node scripts/delete-future-submissions.js <formId>
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

async function deleteFutureSubmissions(formId) {
  const credentials = getCredentials();
  const firestore = new Firestore({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  
  console.log(`\n🗑️  Deleting future date submissions for form: ${formId}`);
  console.log(`📁 Collection: ${getCollectionName('submissions')}\n`);
  
  // Get current date (end of today) - use UTC to avoid timezone issues
  const now = new Date();
  const endOfToday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23, 59, 59, 999
  ));
  
  const { Firestore: FirestoreClass } = require('@google-cloud/firestore');
  const endOfTodayTimestamp = FirestoreClass.Timestamp.fromDate(endOfToday);
  
  console.log(`📅 Current date/time: ${now.toISOString()}`);
  console.log(`📅 End of today (UTC): ${endOfToday.toISOString()}`);
  console.log(`📅 Today's date string: ${endOfToday.toISOString().split('T')[0]}\n`);
  
  // Get all submissions for this form
  const submissionsSnapshot = await firestore
    .collection(getCollectionName('submissions'))
    .where('form_id', '==', formId)
    .get();
  
  console.log(`📊 Found ${submissionsSnapshot.docs.length} total submissions\n`);
  
  const futureSubmissions = [];
  const pastSubmissions = [];
  
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
      
      const submission = {
        id: data.submission_id || doc.id,
        docId: doc.id,
        timestamp: data.timestamp,
        date: date,
        dateStr: date.toISOString().split('T')[0],
      };
      
      // Compare dates (not times) - extract date string and compare
      const submissionDateStr = date.toISOString().split('T')[0];
      const todayDateStr = endOfToday.toISOString().split('T')[0];
      
      if (submissionDateStr > todayDateStr) {
        futureSubmissions.push(submission);
      } else {
        pastSubmissions.push(submission);
      }
    }
  });
  
  console.log(`📊 Past submissions (≤ today): ${pastSubmissions.length}`);
  console.log(`📊 Future submissions (> today): ${futureSubmissions.length}\n`);
  
  if (futureSubmissions.length === 0) {
    console.log('✅ No future submissions to delete');
    return;
  }
  
  console.log('🗑️  Future submissions to delete:\n');
  futureSubmissions.forEach((sub, index) => {
    console.log(`${index + 1}. ${sub.id}`);
    console.log(`   Date: ${sub.dateStr}`);
    console.log(`   Doc ID: ${sub.docId}`);
  });
  
  console.log(`\n⚠️  About to delete ${futureSubmissions.length} future submissions...`);
  
  // Delete future submissions
  const batch = firestore.batch();
  let deleteCount = 0;
  
  futureSubmissions.forEach(sub => {
    const docRef = firestore.collection(getCollectionName('submissions')).doc(sub.docId);
    batch.delete(docRef);
    deleteCount++;
  });
  
  await batch.commit();
  
  console.log(`\n✅ Deleted ${deleteCount} future submissions`);
  
  // Update form submission count
  try {
    const formRef = firestore.collection(getCollectionName('forms')).doc(formId);
    const formDoc = await formRef.get();
    if (formDoc.exists) {
      const formData = formDoc.data();
      const currentCount = formData.submission_count || 0;
      const newCount = Math.max(0, currentCount - deleteCount);
      
      await formRef.update({
        submission_count: newCount,
        updated_at: FirestoreClass.Timestamp.fromDate(new Date())
      });
      console.log(`📊 Updated form submission count: ${currentCount} → ${newCount}`);
    }
  } catch (error) {
    console.warn(`⚠️ Could not update form submission count:`, error.message);
  }
  
  console.log(`\n✅ Cleanup completed. Remaining submissions: ${pastSubmissions.length}`);
  
  return { deleted: deleteCount, remaining: pastSubmissions.length };
}

const formId = process.argv[2];

if (!formId) {
  console.error('❌ Usage: node scripts/delete-future-submissions.js <formId>');
  console.error('   Example: node scripts/delete-future-submissions.js form_1766105374712_sep5miemq');
  process.exit(1);
}

deleteFutureSubmissions(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
