/**
 * Real Railway Endpoint Test
 * Tests the actual deployed Railway backend (not mocked)
 */

const https = require('https');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

async function testEndpoint(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RAILWAY_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`\n🧪 Testing: ${method} ${url.href}`);

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`   Status: ${res.statusCode}`);
        try {
          const json = JSON.parse(data);
          console.log(`   Response:`, JSON.stringify(json, null, 2).split('\n').slice(0, 5).join('\n'));
        } catch {
          console.log(`   Response:`, data.slice(0, 200));
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ Error:`, error.message);
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🚀 Testing Railway Backend Deployment');
  console.log(`   URL: ${RAILWAY_URL}\n`);

  // Test 1: Health check
  try {
    await testEndpoint('/health');
  } catch (error) {
    console.log('❌ Health check failed - server may not be running');
  }

  // Test 2: Custom analytics saved endpoint (without auth) - WITH /api prefix
  try {
    await testEndpoint('/api/analytics/forms/test/custom/saved?dateRange=30d');
  } catch (error) {
    console.log('❌ Custom analytics endpoint unreachable');
  }

  // Test 3: Custom analytics analyze endpoint (without auth) - WITH /api prefix
  try {
    await testEndpoint('/api/analytics/forms/test/custom/analyze', 'POST', {
      template_type: 'breakdown',
      primary_field_id: 'test1',
      secondary_field_id: 'test2'
    });
  } catch (error) {
    console.log('❌ Custom analytics analyze endpoint unreachable');
  }

  console.log('\n✅ Test suite complete');
}

runTests().catch(console.error);

