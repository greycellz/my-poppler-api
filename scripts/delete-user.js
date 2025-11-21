#!/usr/bin/env node

/**
 * Script to delete a user from Firestore
 * Handles both exact and normalized email lookups
 * Supports environment-specific collections via --env flag
 * 
 * Usage:
 *   node scripts/delete-user.js <email> [--env=dev|staging|production]
 * 
 * Examples:
 *   node scripts/delete-user.js user@example.com                    # Defaults to dev
 *   node scripts/delete-user.js user@example.com --env=dev         # Dev environment (dev_users)
 *   node scripts/delete-user.js user@example.com --env=staging      # Staging environment (staging_users)
 *   node scripts/delete-user.js user@example.com --env=production  # Production environment (users, no prefix)
 */

const path = require('path');
const fs = require('fs');

// Set up credentials for local execution if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    // Read the credentials file and set it as JSON string
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');
const validator = require('validator');

async function deleteUser(email) {
  const gcpClient = new GCPClient();
  
  // Show which environment/collection we're targeting
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || 'dev';
  const usersCollection = gcpClient.getCollectionName('users');
  const tokensCollection = gcpClient.getCollectionName('emailVerificationTokens');
  const resetTokensCollection = gcpClient.getCollectionName('passwordResetTokens');
  
  console.log(`\n⚠️  ENVIRONMENT CHECK:`);
  console.log(`   Environment: ${env}`);
  console.log(`   Target Collections:`);
  console.log(`   - Users: ${usersCollection}`);
  console.log(`   - Email Verification Tokens: ${tokensCollection}`);
  console.log(`   - Password Reset Tokens: ${resetTokensCollection}`);
  console.log(`\n🔍 Searching for user with email: ${email}`);
  
  // Try to find user by exact email first
  let user = await gcpClient.getUserByEmail(email, false);
  
  // If not found, try normalized lookup
  if (!user) {
    console.log(`   ⚠️  Not found by exact email, trying normalized lookup...`);
    const normalizedEmail = validator.normalizeEmail(email.toLowerCase().trim(), {
      gmail_lowercase: true,
      gmail_remove_dots: true,
      gmail_remove_subaddress: true,
      outlookdotcom_lowercase: true,
      yahoo_lowercase: true,
      icloud_lowercase: true
    }) || email.toLowerCase().trim();
    
    user = await gcpClient.getUserByEmail(normalizedEmail, true);
  }
  
  if (!user) {
    console.log(`❌ User not found with email: ${email}`);
    console.log(`   Tried exact match and normalized lookup`);
    process.exit(1);
  }
  
  console.log(`✅ Found user:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Normalized Email: ${user.normalizedEmail || 'N/A'}`);
  console.log(`   Name: ${user.name || 'N/A'}`);
  console.log(`   Plan: ${user.plan || 'N/A'}`);
  
  const userId = user.id;
  
  // Safety check for production
  if (env === 'production') {
    console.log(`\n🚨 WARNING: You are about to delete from PRODUCTION collections!`);
    console.log(`   This will permanently delete the user and cannot be undone.`);
    console.log(`   Collections: ${usersCollection}, ${tokensCollection}, ${resetTokensCollection}`);
  }
  
  // Delete related data
  console.log(`\n🗑️  Deleting related data from collection: ${usersCollection}...`);
  
  try {
    // 1. Delete email verification tokens
    const verificationTokensSnapshot = await gcpClient
      .collection('emailVerificationTokens')
      .where('userId', '==', userId)
      .get();
    
    if (!verificationTokensSnapshot.empty) {
      const batch = gcpClient.firestore.batch();
      verificationTokensSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`   ✅ Deleted ${verificationTokensSnapshot.size} email verification token(s)`);
    }
    
    // 2. Delete password reset tokens
    const resetTokensSnapshot = await gcpClient
      .collection('passwordResetTokens')
      .where('userId', '==', userId)
      .get();
    
    if (!resetTokensSnapshot.empty) {
      const batch = gcpClient.firestore.batch();
      resetTokensSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`   ✅ Deleted ${resetTokensSnapshot.size} password reset token(s)`);
    }
    
    // 3. Delete user document
    await gcpClient.collection('users').doc(userId).delete();
    console.log(`   ✅ Deleted user document`);
    
    console.log(`\n✅ Successfully deleted user: ${email}`);
    console.log(`   User ID: ${userId}`);
    
  } catch (error) {
    console.error(`❌ Error deleting user:`, error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let email = null;
let envFlag = null;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--env=')) {
    envFlag = args[i].split('=')[1];
  } else if (!email && !args[i].startsWith('--')) {
    email = args[i];
  }
}

// Validate email
if (!email) {
  console.error('❌ Error: Email address is required');
  console.log('\nUsage:');
  console.log('  node scripts/delete-user.js <email> [--env=dev|staging|production]');
  console.log('\nExamples:');
  console.log('  node scripts/delete-user.js user@example.com                    # Defaults to dev');
  console.log('  node scripts/delete-user.js user@example.com --env=dev         # Dev environment');
  console.log('  node scripts/delete-user.js user@example.com --env=staging      # Staging environment');
  console.log('  node scripts/delete-user.js user@example.com --env=production  # Production environment');
  process.exit(1);
}

// Validate email format
if (!validator.isEmail(email)) {
  console.error(`❌ Error: Invalid email format: ${email}`);
  process.exit(1);
}

// Validate and set environment
if (envFlag && !['dev', 'staging', 'production'].includes(envFlag)) {
  console.error(`❌ Error: Invalid environment flag: ${envFlag}`);
  console.log('   Valid values: dev, staging, production');
  process.exit(1);
}

// Set environment (default to dev if not specified)
const targetEnv = envFlag || 'dev';
process.env.RAILWAY_ENVIRONMENT_NAME = targetEnv;

deleteUser(email)
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

