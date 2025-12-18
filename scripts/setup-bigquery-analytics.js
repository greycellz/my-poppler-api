/**
 * BigQuery Analytics Setup Script
 * 
 * This script sets up the BigQuery tables needed for form analytics:
 * 1. Creates the form_views table
 * 2. Adds new columns to the form_analytics table
 * 
 * Run with: node scripts/setup-bigquery-analytics.js
 */

const GCPClient = require('../gcp-client');
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

async function setupBigQueryAnalytics() {
  console.log('🚀 Starting BigQuery Analytics Setup...\n');

  // Initialize BigQuery client directly (bypassing GCPClient for setup)
  let bigquery;
  
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    bigquery = new BigQuery({
      projectId: 'chatterforms',
      credentials: credentials
    });
  } else {
    const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
    if (!fs.existsSync(keyPath)) {
      console.error('❌ GCP credentials not found!');
      console.error('\nPlease either:');
      console.error('1. Set GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable, or');
      console.error('2. Place chatterforms-app-key.json in the project root');
      console.error('\nThis script needs GCP credentials to create BigQuery tables.');
      process.exit(1);
    }
    bigquery = new BigQuery({
      projectId: 'chatterforms',
      keyFilename: keyPath
    });
  }

  const gcpClient = new GCPClient();
  // Override bigquery client for this script
  gcpClient.bigquery = bigquery;

  try {
    // Step 1: Create form_views table
    console.log('📊 Step 1: Creating form_views table...');
    await createFormViewsTable(gcpClient);
    console.log('✅ form_views table created\n');

    // Step 2: Add columns to form_analytics table
    console.log('📊 Step 2: Adding columns to form_analytics table...');
    await updateFormAnalyticsTable(gcpClient);
    console.log('✅ form_analytics table updated\n');

    console.log('🎉 BigQuery Analytics Setup Complete!');
    console.log('\nNext steps:');
    console.log('1. Verify tables in BigQuery Console');
    console.log('2. Test view tracking endpoint');
    console.log('3. Test analytics overview endpoint');

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

async function createFormViewsTable(gcpClient) {
  const dataset = gcpClient.bigquery.dataset('form_submissions');
  
  // Check if dataset exists, create if not
  try {
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      console.log('📁 Creating form_submissions dataset...');
      await dataset.create();
      console.log('✅ Dataset created');
    }
  } catch (error) {
    console.log('⚠️  Could not check/create dataset (may already exist):', error.message);
  }

  const table = dataset.table('form_views');

  // Check if table already exists
  const [exists] = await table.exists();
  if (exists) {
    console.log('⚠️  form_views table already exists, skipping creation');
    return;
  }

  const schema = [
    { name: 'view_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'form_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'ip_address', type: 'STRING', mode: 'NULLABLE' },
    { name: 'user_agent', type: 'STRING', mode: 'NULLABLE' },
    { name: 'referrer', type: 'STRING', mode: 'NULLABLE' },
    { name: 'session_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'device_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'browser', type: 'STRING', mode: 'NULLABLE' },
    { name: 'os', type: 'STRING', mode: 'NULLABLE' },
    { name: 'country', type: 'STRING', mode: 'NULLABLE' }
  ];

  const options = {
    schema: { fields: schema },
    timePartitioning: {
      type: 'DAY',
      field: 'timestamp'
    },
    clustering: {
      fields: ['form_id']
    }
  };

  await table.create(options);
  console.log('✅ Created form_views table with partitioning and clustering');
}

async function updateFormAnalyticsTable(gcpClient) {
  const table = gcpClient.bigquery.dataset('form_submissions').table('form_analytics');

  // Get current schema
  const [metadata] = await table.getMetadata();
  const existingFields = metadata.schema.fields.map(f => f.name);

  // Define new fields to add
  const newFields = [
    { name: 'total_views', type: 'INT64', mode: 'NULLABLE' },
    { name: 'unique_views', type: 'INT64', mode: 'NULLABLE' },
    { name: 'completion_rate', type: 'FLOAT64', mode: 'NULLABLE' },
    { name: 'avg_completion_time', type: 'INT64', mode: 'NULLABLE' },
    { name: 'device_mobile_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'device_desktop_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'device_tablet_count', type: 'INT64', mode: 'NULLABLE' },
    { name: 'last_view', type: 'TIMESTAMP', mode: 'NULLABLE' }
  ];

  // Filter out fields that already exist
  const fieldsToAdd = newFields.filter(field => !existingFields.includes(field.name));

  if (fieldsToAdd.length === 0) {
    console.log('⚠️  All columns already exist in form_analytics table');
    return;
  }

  console.log(`📝 Adding ${fieldsToAdd.length} new columns to form_analytics:`);
  fieldsToAdd.forEach(field => {
    console.log(`   - ${field.name} (${field.type})`);
  });

  // Add new fields to schema
  metadata.schema.fields.push(...fieldsToAdd);

  // Update table metadata
  await table.setMetadata(metadata);
  console.log(`✅ Added ${fieldsToAdd.length} columns to form_analytics table`);
}

// Run the setup
if (require.main === module) {
  setupBigQueryAnalytics()
    .then(() => {
      console.log('\n✅ Setup completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupBigQueryAnalytics, createFormViewsTable, updateFormAnalyticsTable };
