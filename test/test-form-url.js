/**
 * Quick test for form URL analysis
 * Tests the /api/analyze-url endpoint with the actual form URL
 */

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://my-poppler-api-dev.up.railway.app';
const FORM_URL = process.env.FORM_URL || 'https://www.chatterforms.com/forms/form_1765518416011_bszeswqcu';

async function testFormUrl() {
  console.log('\n🚀 Testing Form URL Analysis\n');
  console.log(`Railway URL: ${RAILWAY_URL}`);
  console.log(`Form URL: ${FORM_URL}\n`);
  
  const startTime = Date.now();
  
  try {
    console.log('📤 Sending request to Railway /api/analyze-url...');
    
    const response = await fetch(`${RAILWAY_URL}/api/analyze-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: FORM_URL,
        systemMessage: 'You are a form analysis expert. Extract all form fields from the provided screenshot.',
        userMessage: 'Analyze this screenshot and extract all visible form fields.',
        additionalContext: 'This is a comprehensive form with approximately 120 fields. Extract all visible fields carefully.'
      })
    });
    
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      console.error(`❌ Request failed (${response.status}):`, errorData);
      return;
    }
    
    const data = await response.json();
    
    console.log(`\n✅ Analysis completed in ${duration}ms\n`);
    console.log('Results:');
    console.log(`  Success: ${data.success}`);
    console.log(`  Fields extracted: ${data.fields?.length || 0}`);
    console.log(`  Was split: ${data.wasSplit || false}`);
    
    if (data.wasSplit) {
      console.log(`  Number of sections: ${data.numSections}`);
      console.log(`  Original height: ${data.originalHeight}px`);
      console.log(`  Split threshold: ${data.splitThreshold}px`);
    }
    
    // Debug: Show response structure if no fields
    if (!data.fields || data.fields.length === 0) {
      console.log('\n⚠️ No fields extracted. Response keys:', Object.keys(data));
      if (data.rawResponse) {
        console.log(`  Raw response length: ${data.rawResponse.length} chars`);
        console.log(`  Raw response preview: ${data.rawResponse.substring(0, 300)}...`);
      }
    }
    
    if (data.fields && data.fields.length > 0) {
      console.log(`\n📋 Sample fields (first 5):`);
      data.fields.slice(0, 5).forEach((field, i) => {
        console.log(`  ${i + 1}. ${field.label} (${field.type})`);
      });
      
      if (data.fields.length > 5) {
        console.log(`  ... and ${data.fields.length - 5} more fields`);
      }
      
      console.log(`\n📊 Field type breakdown:`);
      const typeCounts = {};
      data.fields.forEach(f => {
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
      });
      Object.entries(typeCounts).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    }
    
    console.log(`\n⏱️ Total time: ${(duration / 1000).toFixed(2)}s`);
    
    // Expected ~120 fields
    const expectedFields = 120;
    const actualFields = data.fields?.length || 0;
    if (actualFields >= expectedFields * 0.8) {
      console.log(`\n✅ Field count looks good (expected ~${expectedFields}, got ${actualFields})`);
    } else {
      console.log(`\n⚠️ Field count lower than expected (expected ~${expectedFields}, got ${actualFields})`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Run test
testFormUrl().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

