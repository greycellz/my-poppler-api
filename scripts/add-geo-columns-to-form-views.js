/**
 * Script to add city and region columns to form_views table
 * 
 * Usage: node scripts/add-geo-columns-to-form-views.js
 */

const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

async function addGeoColumns() {
  console.log('🚀 Adding city and region columns to form_views table...\n');

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
      process.exit(1);
    }
    bigquery = new BigQuery({
      projectId: 'chatterforms',
      keyFilename: keyPath
    });
  }

  const table = bigquery.dataset('form_submissions').table('form_views');

  try {
    // Get current schema
    const [metadata] = await table.getMetadata();
    const existingFields = metadata.schema.fields.map(f => f.name);

    // Define new fields to add
    const newFields = [
      { name: 'city', type: 'STRING', mode: 'NULLABLE' },
      { name: 'region', type: 'STRING', mode: 'NULLABLE' }
    ];

    // Filter out fields that already exist
    const fieldsToAdd = newFields.filter(field => !existingFields.includes(field.name));

    if (fieldsToAdd.length === 0) {
      console.log('✅ All geo columns already exist in form_views table');
      return;
    }

    console.log(`📝 Adding ${fieldsToAdd.length} new columns to form_views:`);
    fieldsToAdd.forEach(field => {
      console.log(`   - ${field.name} (${field.type})`);
    });

    // Add new fields to schema
    metadata.schema.fields.push(...fieldsToAdd);

    // Update table metadata
    await table.setMetadata(metadata);
    console.log(`✅ Added ${fieldsToAdd.length} columns to form_views table`);
    console.log('\n🎉 Geo columns setup complete!');

  } catch (error) {
    console.error('❌ Failed to add geo columns:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  addGeoColumns()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addGeoColumns };
