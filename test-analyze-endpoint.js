/**
 * Test the actual analyze endpoint to see what's happening
 */

const https = require('https');

const FORM_ID = 'form_1766453391865_9cf7dc6f';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyZXRqT253bzU2ZWJCckJMUURsMyIsImVtYWlsIjoiYWtqX3dvcmsrMTA2QHlhaG9vLmNvbSIsImlhdCI6MTc2NjQ2MDM1NywiZXhwIjoxNzY3MDY1MTU3fQ.T5veXxOlOas_vs1TCqZVhg9i7RVVVV84GQ6Yi1Vi0UU';
const API_BASE = 'https://my-poppler-api-dev.up.railway.app';

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    const options = {
      method,
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
            reject(new Error(`API Error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse: ${data}`));
        }
      });
    });
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testAnalyze() {
  console.log('\n========================================');
  console.log('TESTING ANALYZE ENDPOINT');
  console.log('========================================\n');

  // Test 1: Rating by Movie Genre (Breakdown) - NO date range
  console.log('🧪 TEST 1: Rating by Movie Genre (no date range)');
  console.log('========================================\n');

  try {
    const response1 = await apiRequest(
      `/api/analytics/forms/${FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'field_1766453391865_2', // Rating
        secondary_field_id: 'field_1766453391865_5', // Movie Genre
        aggregation: 'mean'
      }
    );

    console.log('✅ SUCCESS (no date range):');
    console.log(JSON.stringify(response1, null, 2));
    console.log('');

  } catch (error) {
    console.log('❌ FAILED (no date range):');
    console.log(error.message);
    console.log('');
  }

  // Test 2: Rating by Movie Genre (Breakdown) - WITH date range (last 30 days)
  console.log('🧪 TEST 2: Rating by Movie Genre (with 30-day date range)');
  console.log('========================================\n');

  const endDate = new Date();
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 30);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);

  try {
    const response2 = await apiRequest(
      `/api/analytics/forms/${FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'field_1766453391865_2', // Rating
        secondary_field_id: 'field_1766453391865_5', // Movie Genre
        aggregation: 'mean',
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      }
    );

    console.log('✅ SUCCESS (with date range):');
    console.log(JSON.stringify(response2, null, 2));
    console.log('');

  } catch (error) {
    console.log('❌ FAILED (with date range):');
    console.log(error.message);
    console.log('');
  }

  // Test 3: Rating by Movie Genre (Breakdown) - WITH filter
  console.log('🧪 TEST 3: Rating by Movie Genre (with filter: Age > 50)');
  console.log('========================================\n');

  try {
    const response3 = await apiRequest(
      `/api/analytics/forms/${FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: 'field_1766453391865_2', // Rating
        secondary_field_id: 'field_1766453391865_5', // Movie Genre
        aggregation: 'mean',
        filters: [
          {
            field_id: 'field_1766453391865_1', // Age
            field_label: 'Age',
            operator: 'greater_than',
            value: 50
          }
        ]
      }
    );

    console.log('✅ SUCCESS (with filter):');
    console.log(JSON.stringify(response3, null, 2));
    console.log('');

  } catch (error) {
    console.log('❌ FAILED (with filter):');
    console.log(error.message);
    console.log('');
  }

  // Test 4: Check submission timestamps
  console.log('🧪 TEST 4: Checking submission timestamps');
  console.log('========================================\n');

  try {
    const submissionsResponse = await apiRequest(`/form/${FORM_ID}/submissions`);
    const submissions = submissionsResponse.submissions || [];
    
    if (submissions.length > 0) {
      const firstSub = submissions[0];
      const lastSub = submissions[submissions.length - 1];
      
      console.log(`Total submissions: ${submissions.length}`);
      console.log(`First submission timestamp: ${JSON.stringify(firstSub.timestamp || firstSub.created_at)}`);
      console.log(`Last submission timestamp: ${JSON.stringify(lastSub.timestamp || lastSub.created_at)}`);
      
      // Check how many are within last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
      
      let inRange = 0;
      submissions.forEach(sub => {
        const ts = sub.timestamp || sub.created_at;
        let date;
        if (ts && ts._seconds) {
          date = new Date(ts._seconds * 1000);
        } else if (typeof ts === 'string') {
          date = new Date(ts);
        } else {
          return;
        }
        
        if (date >= thirtyDaysAgo) {
          inRange++;
        }
      });
      
      console.log(`Submissions in last 30 days: ${inRange}/${submissions.length}`);
      console.log('');
    }
  } catch (error) {
    console.log('❌ Error checking timestamps:', error.message);
    console.log('');
  }
}

testAnalyze()
  .then(() => {
    console.log('✅ All tests complete\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });

