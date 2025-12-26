/**
 * Test to check if field IDs in form structure match submission data keys
 */

const https = require('https');

const FORM_ID = 'form_1766453391865_9cf7dc6f';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyZXRqT253bzU2ZWJCckJMUURsMyIsImVtYWlsIjoiYWtqX3dvcmsrMTA2QHlhaG9vLmNvbSIsImlhdCI6MTc2NjQ2MDM1NywiZXhwIjoxNzY3MDY1MTU3fQ.T5veXxOlOas_vs1TCqZVhg9i7RVVVV84GQ6Yi1Vi0UU';
const API_BASE = 'https://my-poppler-api-dev.up.railway.app';

function apiRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${parsed.error || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function testFieldIds() {
  console.log('\n========================================');
  console.log('FIELD ID MISMATCH TEST');
  console.log('========================================\n');

  try {
    // Get form structure
    const formResponse = await apiRequest(`/api/forms/${FORM_ID}`);
    const form = formResponse.form;
    const fields = form.structure?.fields || form.fields || [];
    
    console.log('📋 FORM STRUCTURE FIELDS:');
    fields.forEach(f => {
      console.log(`   ${f.label}: id="${f.id}", type="${f.type}"`);
    });
    console.log('');

    // Get submissions
    const submissionsResponse = await apiRequest(`/form/${FORM_ID}/submissions`);
    const submissions = submissionsResponse.submissions || [];
    
    if (submissions.length === 0) {
      console.log('❌ No submissions found');
      return;
    }

    const firstSubmission = submissions[0];
    const dataFieldName = firstSubmission.submission_data ? 'submission_data' : 
                         firstSubmission.submissionData ? 'submissionData' : 
                         firstSubmission.data ? 'data' : null;

    if (!dataFieldName) {
      console.log('❌ Could not find submission data field');
      return;
    }

    const submissionData = firstSubmission[dataFieldName];
    const submissionKeys = Object.keys(submissionData);

    console.log('📊 SUBMISSION DATA KEYS:');
    submissionKeys.forEach(key => {
      console.log(`   ${key}: ${JSON.stringify(submissionData[key])}`);
    });
    console.log('');

    // Check for mismatches
    console.log('🔍 FIELD ID COMPARISON:');
    console.log('========================================\n');

    const formFieldIds = fields.map(f => f.id);
    const missingInForm = submissionKeys.filter(k => !formFieldIds.includes(k));
    const missingInSubmissions = formFieldIds.filter(id => !submissionKeys.includes(id));

    if (missingInForm.length > 0) {
      console.log('⚠️  Keys in submission_data but NOT in form structure:');
      missingInForm.forEach(k => console.log(`   - ${k}`));
      console.log('');
    }

    if (missingInSubmissions.length > 0) {
      console.log('⚠️  Field IDs in form structure but NOT in submission_data:');
      missingInSubmissions.forEach(id => {
        const field = fields.find(f => f.id === id);
        console.log(`   - ${id} (${field?.label || 'unknown'})`);
      });
      console.log('');
    }

    if (missingInForm.length === 0 && missingInSubmissions.length === 0) {
      console.log('✅ All field IDs match!\n');
    }

    // Test specific combination: Rating by Movie Genre
    console.log('🧪 TESTING: Rating by Movie Genre');
    console.log('========================================\n');

    const ratingField = fields.find(f => f.label === 'Rating' || f.id === 'field_1766453391865_2');
    const genreField = fields.find(f => f.label === 'Movie Genre' || f.id === 'field_1766453391865_5');

    if (!ratingField || !genreField) {
      console.log('❌ Could not find Rating or Movie Genre fields');
      return;
    }

    console.log(`Primary Field: ${ratingField.label} (id: ${ratingField.id})`);
    console.log(`Secondary Field: ${genreField.label} (id: ${genreField.id})\n`);

    // Count pairs
    let pairs = 0;
    for (const submission of submissions) {
      const data = submission[dataFieldName] || {};
      const primaryValue = data[ratingField.id];
      const secondaryValue = data[genreField.id];
      
      if (primaryValue !== undefined && primaryValue !== null && primaryValue !== '' &&
          secondaryValue !== undefined && secondaryValue !== null && secondaryValue !== '') {
        pairs++;
      }
    }

    console.log(`Found ${pairs} complete pairs out of ${submissions.length} submissions`);
    
    if (pairs < 2) {
      console.log('❌ NOT ENOUGH PAIRS - This is why you\'re seeing the error!\n');
      
      // Debug why pairs are missing
      console.log('🔍 DEBUGGING MISSING PAIRS:');
      let missingPrimary = 0;
      let missingSecondary = 0;
      let missingBoth = 0;
      
      for (const submission of submissions) {
        const data = submission[dataFieldName] || {};
        const primaryValue = data[ratingField.id];
        const secondaryValue = data[genreField.id];
        
        const hasPrimary = primaryValue !== undefined && primaryValue !== null && primaryValue !== '';
        const hasSecondary = secondaryValue !== undefined && secondaryValue !== null && secondaryValue !== '';
        
        if (!hasPrimary && !hasSecondary) missingBoth++;
        else if (!hasPrimary) missingPrimary++;
        else if (!hasSecondary) missingSecondary++;
      }
      
      console.log(`   Missing primary only: ${missingPrimary}`);
      console.log(`   Missing secondary only: ${missingSecondary}`);
      console.log(`   Missing both: ${missingBoth}`);
    } else {
      console.log('✅ ENOUGH PAIRS - Should work!\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testFieldIds()
  .then(() => {
    console.log('✅ Test complete\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });


