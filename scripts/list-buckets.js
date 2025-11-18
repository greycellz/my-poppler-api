/**
 * List available GCS buckets
 */

const fs = require('fs');
const path = require('path');

// Set up credentials for local execution if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');

async function listBuckets() {
  try {
    const gcpClient = new GCPClient();
    const [buckets] = await gcpClient.storage.getBuckets();
    
    console.log('📦 Available GCS Buckets:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    buckets.forEach(bucket => {
      console.log(`  - ${bucket.name}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return buckets.map(b => b.name);
  } catch (error) {
    console.error('❌ Error listing buckets:', error.message);
    throw error;
  }
}

if (require.main === module) {
  listBuckets()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = listBuckets;

