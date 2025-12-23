#!/usr/bin/env node

/**
 * Environment validation script
 * Run this before starting the server to validate critical configuration
 */

const crypto = require('crypto');

console.log('');
console.log('🔍 Validating Environment Configuration...');
console.log('==========================================');
console.log('');

let hasErrors = false;
let hasWarnings = false;

// Check JWT_SECRET
console.log('Checking JWT_SECRET...');
if (!process.env.JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET is not set!');
  console.error('');
  console.error('TO FIX:');
  console.error('1. Generate a secure secret:');
  console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('');
  console.error('2. Set in Railway:');
  console.error('   Dashboard → Settings → Variables → Add Variable');
  console.error('   Key: JWT_SECRET');
  console.error('   Value: <your_generated_secret>');
  console.error('');
  console.error('3. Redeploy the application');
  console.error('');
  hasErrors = true;
} else if (process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️  WARNING: JWT_SECRET is too short');
  console.warn(`   Current: ${process.env.JWT_SECRET.length} characters`);
  console.warn('   Recommended: At least 32 characters (256 bits)');
  console.warn('');
  console.warn('   Generate a stronger secret:');
  console.warn('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.warn('');
  hasWarnings = true;
} else {
  console.log(`✅ JWT_SECRET is configured (${process.env.JWT_SECRET.length} characters)`);
}

// Check other critical env vars
console.log('');
console.log('Checking other environment variables...');

const criticalVars = [
  { 
    name: 'GOOGLE_CLOUD_PROJECT_ID', 
    required: true,
    hint: 'GCP project ID (e.g., chatterforms)'
  },
  { 
    name: 'GOOGLE_CLOUD_KEYFILE', 
    required: true,
    hint: 'Path to GCP service account key file'
  },
  { 
    name: 'MAILGUN_API_KEY', 
    required: false,
    hint: 'Mailgun API key for email notifications'
  },
  { 
    name: 'STRIPE_SECRET_KEY', 
    required: false,
    hint: 'Stripe secret key for payments'
  },
  {
    name: 'RAILWAY_PUBLIC_DOMAIN',
    required: false,
    hint: 'Railway public domain for URL generation'
  },
  {
    name: 'FRONTEND_URL',
    required: false,
    hint: 'Frontend URL for CORS configuration'
  }
];

criticalVars.forEach(({ name, required, hint }) => {
  if (!process.env[name]) {
    if (required) {
      console.error(`❌ CRITICAL: ${name} is not set!`);
      console.error(`   Hint: ${hint}`);
      hasErrors = true;
    } else {
      console.warn(`⚠️  WARNING: ${name} is not set (optional)`);
      console.warn(`   Hint: ${hint}`);
      hasWarnings = true;
    }
  } else {
    console.log(`✅ ${name} is configured`);
  }
});

console.log('');
console.log('==========================================');

if (hasErrors) {
  console.error('');
  console.error('❌ VALIDATION FAILED - Cannot start application');
  console.error('   Fix the critical errors above and try again');
  console.error('');
  process.exit(1);
}

if (hasWarnings) {
  console.warn('');
  console.warn('⚠️  VALIDATION PASSED WITH WARNINGS');
  console.warn('   Application will start but some features may not work correctly');
  console.warn('');
}

if (!hasErrors && !hasWarnings) {
  console.log('');
  console.log('✅ VALIDATION PASSED - All configuration present');
  console.log('');
}

