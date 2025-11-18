#!/usr/bin/env node

/**
 * Migration Script: Rename all Firestore collections to dev_ prefix
 * 
 * This script:
 * 1. Reads all documents from each existing collection
 * 2. Writes them to dev_${collectionName} collection
 * 3. Verifies document counts match
 * 4. Deletes original collection (after verification)
 * 
 * Collections to migrate (16 total):
 * - users, forms, submissions, anonymousSessions
 * - baa-agreements, emailVerificationTokens, passwordResetTokens
 * - user_logos, form_images, payment_fields, user_stripe_accounts
 * - onboarding_analytics, help_articles, calendar_fields, calendar_bookings
 * - user_calendly_accounts
 * 
 * Usage: node scripts/migrate-collections-to-dev-prefix.js [--dry-run] [--rollback]
 */

const path = require('path');
const fs = require('fs');

// Set up credentials for local execution if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');

// All collections to migrate (16 total, verified against Firestore)
// Note: submissions can be skipped if causing issues - user is okay with losing test data
const COLLECTIONS_TO_MIGRATE = [
  'users',
  'forms',
  'submissions', // May fail on deletion due to large documents - can be skipped
  'anonymousSessions',
  'baa-agreements',
  'emailVerificationTokens',
  'passwordResetTokens',
  'user_logos',
  'form_images',
  'payment_fields',
  'user_stripe_accounts',
  'onboarding_analytics',
  'help_articles',
  'calendar_fields',
  'calendar_bookings',
  'user_calendly_accounts'
];

async function migrateCollection(gcpClient, collectionName, dryRun = false) {
  const sourceCollection = collectionName;
  const targetCollection = `dev_${collectionName}`;
  
  console.log(`\n📦 Migrating collection: ${sourceCollection} → ${targetCollection}`);
  
  try {
    // Step 1: Read all documents from source collection
    console.log(`   📥 Reading documents from ${sourceCollection}...`);
    const sourceSnapshot = await gcpClient.firestore.collection(sourceCollection).get();
    const sourceCount = sourceSnapshot.size;
    
    if (sourceCount === 0) {
      console.log(`   ℹ️  Collection ${sourceCollection} is empty, skipping...`);
      return { success: true, migrated: 0, skipped: true };
    }
    
    console.log(`   ✅ Found ${sourceCount} document(s) in ${sourceCollection}`);
    
    if (dryRun) {
      console.log(`   🔍 DRY RUN: Would migrate ${sourceCount} documents to ${targetCollection}`);
      return { success: true, migrated: sourceCount, dryRun: true };
    }
    
    // Step 2: Check if target collection already exists
    const targetSnapshot = await gcpClient.firestore.collection(targetCollection).get();
    if (!targetSnapshot.empty) {
      console.log(`   ⚠️  WARNING: Target collection ${targetCollection} already exists with ${targetSnapshot.size} documents`);
      console.log(`   ⚠️  Skipping migration to avoid overwriting existing data`);
      return { success: false, error: 'Target collection already exists', skipped: true };
    }
    
    // Step 3: Write all documents to target collection using batch operations
    // Use smaller batch size for collections that might have large documents (like submissions)
    const isLargeCollection = collectionName === 'submissions' || collectionName === 'forms';
    const batchSize = isLargeCollection ? 100 : 500; // Smaller batches for large documents
    console.log(`   📤 Writing documents to ${targetCollection} (batch size: ${batchSize})...`);
    let migratedCount = 0;
    let batchCount = 0;
    
    for (let i = 0; i < sourceSnapshot.docs.length; i += batchSize) {
      const batch = gcpClient.firestore.batch();
      const batchDocs = sourceSnapshot.docs.slice(i, i + batchSize);
      
      // For very large documents, write individually to avoid transaction size limits
      if (isLargeCollection && batchDocs.length > 50) {
        // Write documents individually for large collections
        for (const doc of batchDocs) {
          try {
            const targetRef = gcpClient.firestore.collection(targetCollection).doc(doc.id);
            await targetRef.set(doc.data());
            migratedCount++;
          } catch (error) {
            console.error(`   ⚠️  Error migrating document ${doc.id}:`, error.message);
            // Continue with next document
          }
        }
        batchCount++;
        console.log(`   ✅ Migrated batch ${batchCount}: ${batchDocs.length} documents (${migratedCount}/${sourceCount} total)`);
      } else {
        // Use batch writes for smaller collections or smaller batches
        batchDocs.forEach(doc => {
          const targetRef = gcpClient.firestore.collection(targetCollection).doc(doc.id);
          batch.set(targetRef, doc.data());
        });
        
        await batch.commit();
        migratedCount += batchDocs.length;
        batchCount++;
        console.log(`   ✅ Migrated batch ${batchCount}: ${batchDocs.length} documents (${migratedCount}/${sourceCount} total)`);
      }
    }
    
    // Step 4: Verify document counts match
    console.log(`   🔍 Verifying migration...`);
    const verifySnapshot = await gcpClient.firestore.collection(targetCollection).get();
    const verifyCount = verifySnapshot.size;
    
    if (verifyCount !== sourceCount) {
      console.log(`   ❌ VERIFICATION FAILED: Source has ${sourceCount} documents, target has ${verifyCount} documents`);
      return { success: false, error: 'Document count mismatch', sourceCount, targetCount: verifyCount };
    }
    
    console.log(`   ✅ Verification passed: ${verifyCount} documents in both collections`);
    
    // Step 5: Delete original collection (after verification)
    console.log(`   🗑️  Deleting original collection ${sourceCollection}...`);
    
    // Use smaller batches for deletion to avoid transaction size limits
    // For submissions, use even smaller batches or individual deletes
    const deleteBatchSize = collectionName === 'submissions' ? 10 : (isLargeCollection ? 50 : 500);
    let deletedCount = 0;
    
    try {
      for (let i = 0; i < sourceSnapshot.docs.length; i += deleteBatchSize) {
        const deleteBatch = gcpClient.firestore.batch();
        const batchDocs = sourceSnapshot.docs.slice(i, i + deleteBatchSize);
        
        batchDocs.forEach(doc => {
          deleteBatch.delete(doc.ref);
        });
        
        await deleteBatch.commit();
        deletedCount += batchDocs.length;
        console.log(`   ✅ Deleted batch: ${batchDocs.length} documents (${deletedCount}/${sourceCount} total)`);
      }
      
      console.log(`   ✅ Successfully deleted ${sourceCount} documents from ${sourceCollection}`);
    } catch (deleteError) {
      console.log(`   ⚠️  WARNING: Failed to delete all documents from ${sourceCollection}: ${deleteError.message}`);
      console.log(`   ⚠️  ${deletedCount}/${sourceCount} documents deleted. Original collection may still contain some documents.`);
      console.log(`   ⚠️  You can manually clean up the remaining documents or leave them (data is safely in ${targetCollection})`);
      // Don't fail the entire migration if deletion fails - data is already safely migrated
    }
    console.log(`   ✅ Migration complete: ${sourceCollection} → ${targetCollection}`);
    
    return { success: true, migrated: migratedCount, sourceCount, targetCount: verifyCount };
    
  } catch (error) {
    console.error(`   ❌ Error migrating ${sourceCollection}:`, error.message);
    return { success: false, error: error.message, collection: sourceCollection };
  }
}

async function rollbackCollection(gcpClient, collectionName) {
  const sourceCollection = `dev_${collectionName}`;
  const targetCollection = collectionName;
  
  console.log(`\n🔄 Rolling back: ${sourceCollection} → ${targetCollection}`);
  
  try {
    const sourceSnapshot = await gcpClient.firestore.collection(sourceCollection).get();
    if (sourceSnapshot.empty) {
      console.log(`   ℹ️  Source collection ${sourceCollection} is empty, nothing to rollback`);
      return { success: true, rolledBack: 0 };
    }
    
    const batch = gcpClient.firestore.batch();
    sourceSnapshot.docs.forEach(doc => {
      const targetRef = gcpClient.firestore.collection(targetCollection).doc(doc.id);
      batch.set(targetRef, doc.data());
    });
    
    await batch.commit();
    console.log(`   ✅ Rolled back ${sourceSnapshot.size} documents to ${targetCollection}`);
    
    return { success: true, rolledBack: sourceSnapshot.size };
  } catch (error) {
    console.error(`   ❌ Error rolling back ${sourceCollection}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rollback = args.includes('--rollback');
  
  console.log('🚀 Firestore Collection Migration Script');
  console.log('==========================================\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE: No changes will be made\n');
  }
  
  if (rollback) {
    console.log('🔄 ROLLBACK MODE: Restoring collections from dev_ prefix\n');
  }
  
  const gcpClient = new GCPClient();
  
  const results = [];
  
  if (rollback) {
    // Rollback: Copy from dev_* back to original names
    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      const result = await rollbackCollection(gcpClient, collectionName);
      results.push({ collection: collectionName, ...result });
    }
  } else {
    // Migration: Copy from original to dev_*
    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      const result = await migrateCollection(gcpClient, collectionName, dryRun);
      results.push({ collection: collectionName, ...result });
    }
  }
  
  // Summary
  console.log('\n\n📊 Migration Summary');
  console.log('===================\n');
  
  const successful = results.filter(r => r.success && !r.skipped);
  const failed = results.filter(r => !r.success);
  const skipped = results.filter(r => r.skipped);
  
  console.log(`✅ Successful: ${successful.length}`);
  successful.forEach(r => {
    console.log(`   - ${r.collection}: ${r.migrated || r.rolledBack || 0} documents`);
  });
  
  if (skipped.length > 0) {
    console.log(`\n⚠️  Skipped: ${skipped.length}`);
    skipped.forEach(r => {
      console.log(`   - ${r.collection}: ${r.error || 'Empty or already exists'}`);
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    failed.forEach(r => {
      console.log(`   - ${r.collection}: ${r.error}`);
    });
    process.exit(1);
  }
  
  if (!dryRun && !rollback) {
    console.log('\n✅ Migration completed successfully!');
    console.log('⚠️  Original collections have been deleted.');
    console.log('⚠️  Keep backups for 24-48 hours before permanent deletion.');
  } else if (dryRun) {
    console.log('\n🔍 Dry run completed. No changes were made.');
  } else {
    console.log('\n🔄 Rollback completed successfully!');
  }
}

// Run migration
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

