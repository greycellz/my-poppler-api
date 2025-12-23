const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyZXRqT253bzU2ZWJCckJMUURsMyIsImVtYWlsIjoiYWtqX3dvcmsrMTA2QHlhaG9vLmNvbSIsImlhdCI6MTc2NjQ2MDM1NywiZXhwIjoxNzY3MDY1MTU3fQ.T5veXxOlOas_vs1TCqZVhg9i7RVVVV84GQ6Yi1Vi0UU';
const USER_ID = '2etjOnwo56ebBrBLQDl3';
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
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${parsed.error || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function listForms() {
  console.log('\n========================================');
  console.log('USER FORMS LIST');
  console.log('========================================\n');
  console.log(`User ID: ${USER_ID}\n`);

  try {
    const response = await apiRequest(`/api/forms/user/${USER_ID}`);
    
    console.log(`✅ Found ${response.forms?.length || 0} forms\n`);
    
    if (!response.forms || response.forms.length === 0) {
      console.log('❌ No forms found for this user');
      return;
    }

    console.log('FORMS:');
    console.log('=====================================\n');
    
    response.forms.forEach((form, idx) => {
      console.log(`${idx + 1}. ${form.name || 'Untitled'}`);
      console.log(`   Form ID: ${form.id}`);
      console.log(`   Created: ${form.created_at || 'Unknown'}`);
      console.log(`   Fields: ${form.structure?.fields?.length || form.fields?.length || 0}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listForms()
  .then(() => {
    console.log('✅ Complete\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });

