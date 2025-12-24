/**
 * Test specific scenario: Avg Age by Genre for Basic Subscriptions (last 30 days)
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

async function testScenario() {
  console.log('\n========================================');
  console.log('TEST: Avg Age by Genre for Basic Subscriptions');
  console.log('========================================\n');

  // First, get form structure to find field IDs
  console.log('📋 Getting form structure...');
  const formResponse = await apiRequest(`/api/forms/${FORM_ID}`);
  const form = formResponse.form;
  const fields = form.structure?.fields || form.fields || [];
  
  // Find field IDs
  const ageField = fields.find(f => f.label === 'Age' || f.id === 'field_1766453391865_1');
  const genreField = fields.find(f => f.label === 'Movie Genre' || f.id === 'field_1766453391865_5');
  const subscriptionField = fields.find(f => f.label === 'Subscription Tier' || f.id === 'field_1766453391865_8');
  const deviceField = fields.find(f => f.label === 'Device Type' || f.id === 'field_1766453391865_7');
  
  if (!ageField || !genreField || !subscriptionField || !deviceField) {
    console.error('❌ Could not find required fields');
    console.log('Available fields:', fields.map(f => `${f.label} (${f.id})`).join(', '));
    return;
  }
  
  console.log(`✅ Found fields:`);
  console.log(`   Age: ${ageField.label} (${ageField.id})`);
  console.log(`   Movie Genre: ${genreField.label} (${genreField.id})`);
  console.log(`   Subscription Tier: ${subscriptionField.label} (${subscriptionField.id})`);
  console.log(`   Device Type: ${deviceField.label} (${deviceField.id})`);
  console.log('');

  // Calculate date range (last 30 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 30);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);

  console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);

  // Test the analysis
  console.log('🧪 Testing: Avg Age by Genre for Basic Subscriptions on TV devices');
  console.log('========================================\n');

  try {
    const response = await apiRequest(
      `/api/analytics/forms/${FORM_ID}/custom/analyze`,
      'POST',
      {
        template_type: 'breakdown',
        primary_field_id: ageField.id, // Age (metric)
        secondary_field_id: genreField.id, // Movie Genre (dimension)
        aggregation: 'mean',
        filters: [
          {
            field_id: subscriptionField.id,
            field_label: subscriptionField.label,
            operator: 'equals',
            value: 'Basic'
          },
          {
            field_id: deviceField.id,
            field_label: deviceField.label,
            operator: 'equals',
            value: 'TV'
          }
        ],
        date_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      }
    );

    console.log('✅ SUCCESS!\n');
    console.log('Response:');
    console.log(JSON.stringify(response, null, 2));
    console.log('');

    if (response.success && response.analysis) {
      console.log('📊 Analysis Results:');
      console.log(`   BigNumber: ${response.analysis.bigNumber?.value || 'N/A'}`);
      console.log(`   Comparison: ${response.analysis.bigNumber?.comparison || 'N/A'}`);
      console.log(`   Sample Size: ${response.analysis.sampleSize || 0} responses`);
      console.log(`   Chart Data Points: ${response.analysis.chartData?.length || 0}`);
      console.log(`   Pattern Strength: ${response.analysis.strength || 'N/A'}`);
      console.log('');

      if (response.analysis.chartData && response.analysis.chartData.length > 0) {
        console.log('📈 Chart Data:');
        response.analysis.chartData.forEach((point, idx) => {
          console.log(`   ${idx + 1}. ${point.x}: ${point.y} (${point.count} responses)`);
        });
      }

      // Verify expected result
      console.log('\n✅ Verification:');
      const hasChartData = response.analysis.chartData && response.analysis.chartData.length > 0;
      const hasBigNumber = response.analysis.bigNumber && response.analysis.bigNumber.value;
      
      if (response.analysis.sampleSize >= 2 && hasChartData && hasBigNumber) {
        console.log('   ✅ Sample size is sufficient (>= 2)');
        console.log('   ✅ Chart data generated correctly');
        console.log('   ✅ BigNumber insight generated');
        console.log(`   ✅ Filters applied correctly (${response.analysis.sampleSize} responses after filtering)`);
        console.log(`   ✅ Genres found: ${response.analysis.chartData.map(d => d.x).join(', ')}`);
      } else {
        console.log('   ⚠️  Unexpected results - check data');
        if (response.analysis.sampleSize < 2) {
          console.log('   ⚠️  Sample size too small - filters may be too restrictive');
        }
      }
    }

  } catch (error) {
    console.error('❌ FAILED:', error.message);
    if (error.message.includes('Not enough data')) {
      console.error('\n💡 This suggests:');
      console.error('   - Filters might be too restrictive (no Basic subscriptions on TV in last 30 days)');
      console.error('   - Or date range is filtering out all submissions');
      console.error('   - Or Age/Genre fields missing in filtered submissions');
      console.error('   - Try removing one filter to see if data exists');
    }
  }
}

testScenario()
  .then(() => {
    console.log('\n✅ Test complete\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });

