#!/usr/bin/env node

/**
 * Cleanup script to delete remaining documents from original submissions collection
 * Since submissions data is already safely migrated to dev_submissions, we can delete the original
 */

const path = require('path');
const fs = require('fs');

// Set up credentials
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');

async function cleanupSubmissions() {
  const gcpClient = new GCPClient();
  
  console.log('🧹 Cleaning up original submissions collection...\n');
  
  try {
    // Read all remaining documents
    const snapshot = await gcpClient.firestore.collection('submissions').get();
    const count = snapshot.size;
    
    if (count === 0) {
      console.log('✅ Original submissions collection is already empty');
      return;
    }
    
    console.log(`📥 Found ${count} document(s) in original submissions collection`);
    console.log('🗑️  Deleting in small batches (10 documents per batch)...\n');
    
    // Delete in very small batches to avoid transaction size limits
    const batchSize = 10;
    let deletedCount = 0;
    
    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = gcpClient.firestore.batch();
      const batchDocs = snapshot.docs.slice(i, i + batchSize);
      
      batchDocs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      try {
        await batch.commit();
        deletedCount += batchDocs.length;
        console.log(`   ✅ Deleted batch: ${batchDocs.length} documents (${deletedCount}/${count} total)`);
      } catch (error) {
        console.error(`   ⚠️  Error deleting batch: ${error.message}`);
        // Try individual deletes as fallback
        for (const doc of batchDocs) {
          try {
            await doc.ref.delete();
            deletedCount++;
            console.log(`   ✅ Deleted individual document: ${doc.id} (${deletedCount}/${count} total)`);
          } catch (individualError) {
            console.error(`   ❌ Failed to delete ${doc.id}: ${individualError.message}`);
          }
        }
      }
    }
    
    console.log(`\n✅ Cleanup complete: Deleted ${deletedCount}/${count} documents`);
    
    // Verify
    const verifySnapshot = await gcpClient.firestore.collection('submissions').get();
    if (verifySnapshot.empty) {
      console.log('✅ Original submissions collection is now empty');
    } else {
      console.log(`⚠️  Warning: ${verifySnapshot.size} documents still remain in original collection`);
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

cleanupSubmissions();

