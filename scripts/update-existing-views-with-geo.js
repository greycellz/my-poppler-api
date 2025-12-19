/**
 * Script to update existing form_views records with geolocation data
 * 
 * Fetches views that have IP addresses but no city/region/country,
 * performs geolocation lookup, and updates the records.
 * 
 * Usage: node scripts/update-existing-views-with-geo.js [formId]
 *   - If formId is provided, only updates views for that form
 *   - If omitted, updates all views without geo data
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { getLocationFromIP } = require('../utils/geolocation');
const path = require('path');
const fs = require('fs');

function initializeBigQuery() {
  let bigquery;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      bigquery = new BigQuery({
        projectId: 'chatterforms',
        credentials,
      });
      console.log('✅ GCP credentials loaded from environment variable');
    } catch (error) {
      console.error('❌ Error parsing credentials from environment:', error.message);
      throw error;
    }
  } else {
    const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
    if (fs.existsSync(keyPath)) {
      bigquery = new BigQuery({
        projectId: 'chatterforms',
        keyFilename: keyPath,
      });
      console.log('✅ GCP credentials loaded from key file');
    } else {
      throw new Error('GCP credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or place chatterforms-app-key.json in project root.');
    }
  }

  return bigquery;
}

async function updateViewsWithGeo(formId = null) {
  const bigquery = initializeBigQuery();
  const projectId = 'chatterforms';
  const datasetId = 'form_submissions';
  const tableId = 'form_views';

  console.log('\n🔍 Finding views without geolocation data...\n');

  // Build query to find views with IP but no geo data
  let query = `
    SELECT 
      view_id,
      form_id,
      ip_address,
      city,
      region,
      country
    FROM \`${projectId}.${datasetId}.${tableId}\`
    WHERE ip_address IS NOT NULL
      AND (city IS NULL AND region IS NULL AND country IS NULL)
  `;

  const params = {};

  if (formId) {
    query += ` AND form_id = @formId`;
    params.formId = formId;
    console.log(`📋 Filtering for form: ${formId}\n`);
  }

  query += ` LIMIT 1000`; // Process in batches

  try {
    const [rows] = await bigquery.query({ query, params });
    console.log(`📊 Found ${rows.length} views to update\n`);

    if (rows.length === 0) {
      console.log('✅ No views need updating');
      return;
    }

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const ipAddress = row.ip_address;
        if (!ipAddress || ipAddress === '127.0.0.1' || ipAddress === '::1') {
          skipped++;
          continue;
        }

        // Get geolocation
        const geoData = await getLocationFromIP(ipAddress);

        // Only update if we got some geo data
        if (!geoData.city && !geoData.region && !geoData.country) {
          skipped++;
          continue;
        }

        // Build UPDATE query
        const updateParams = {
          viewId: row.view_id
        };
        const updates = [];

        if (geoData.city) {
          updates.push('city = @city');
          updateParams.city = geoData.city;
        }
        if (geoData.region) {
          updates.push('region = @region');
          updateParams.region = geoData.region;
        }
        if (geoData.country) {
          updates.push('country = @country');
          updateParams.country = geoData.country;
        }

        if (updates.length === 0) {
          skipped++;
          continue;
        }

        const updateQuery = `
          UPDATE \`${projectId}.${datasetId}.${tableId}\`
          SET ${updates.join(', ')}
          WHERE view_id = @viewId
        `;

        await bigquery.query({
          query: updateQuery,
          params: updateParams
        });

        updated++;
        console.log(`✅ Updated view ${row.view_id}: ${geoData.city || ''}, ${geoData.region || ''}, ${geoData.country || ''}`);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errors++;
        console.error(`❌ Error updating view ${row.view_id}:`, error.message);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped} (no IP or no geo data)`);
    console.log(`   Errors: ${errors}`);
    console.log(`\n✅ Update complete`);

  } catch (error) {
    console.error('❌ Error querying/updating views:', error);
    throw error;
  }
}

const formId = process.argv[2] || null;

if (formId) {
  console.log(`🎯 Updating views for form: ${formId}`);
} else {
  console.log('🌍 Updating all views without geolocation data');
}

updateViewsWithGeo(formId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
