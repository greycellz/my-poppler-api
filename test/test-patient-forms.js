const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

const RAILWAY_URL = 'https://my-poppler-api-dev.up.railway.app';

async function testPatientForms() {
  console.log('🧪 Testing patient-forms.pdf (8 pages, ~200 fields expected)\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Upload PDF
  console.log('📤 Step 1: Uploading patient-forms.pdf...');
  const pdfPath = '/Users/namratajha/chatterforms/tests/sample-forms/pdf/patient-forms.pdf';
  
  const formData = new FormData();
  formData.append('file', fs.createReadStream(pdfPath));

  const uploadResponse = await fetch(`${RAILWAY_URL}/upload`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders()
  });

  const uploadData = await uploadResponse.json();
  
  if (!uploadData.success) {
    console.error('❌ Upload failed:', uploadData.error);
    return;
  }

  console.log(`✅ Upload successful: ${uploadData.totalPages} pages converted`);
  console.log(`📸 Image URLs generated: ${uploadData.images.length} images\n`);

  // Step 2: Analyze with Google Vision + Groq
  console.log('🔍 Step 2: Analyzing with Google Vision + Groq...');
  const startTime = Date.now();

  const analyzeResponse = await fetch(`${RAILWAY_URL}/api/analyze-images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imageUrls: uploadData.images.map(img => img.url)
    })
  });

  const analyzeData = await analyzeResponse.json();
  const totalTime = Date.now() - startTime;

  if (!analyzeData.success) {
    console.error('❌ Analysis failed:', analyzeData.error);
    console.error('Full response:', JSON.stringify(analyzeData, null, 2));
    return;
  }

  console.log(`✅ Analysis completed in ${(totalTime / 1000).toFixed(1)}s\n`);

  // Step 3: Display results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 RESULTS\n');
  console.log(`⏱️  Total Time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`📄 Pages Analyzed: ${analyzeData.imagesAnalyzed || uploadData.totalPages}`);
  console.log(`📝 Total Fields Extracted: ${analyzeData.fields?.length || 0}`);
  
  // Count field types
  const fieldTypes = {};
  let richtextCount = 0;
  let inputCount = 0;
  
  (analyzeData.fields || []).forEach(field => {
    const type = field.type || 'unknown';
    fieldTypes[type] = (fieldTypes[type] || 0) + 1;
    
    if (type === 'richtext') {
      richtextCount++;
    } else {
      inputCount++;
    }
  });

  console.log(`   - Richtext fields: ${richtextCount}`);
  console.log(`   - Input fields: ${inputCount}\n`);
  
  console.log('📋 Field Type Breakdown:');
  Object.entries(fieldTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`   - ${type}: ${count}`);
  });

  console.log('\n📍 Sample Fields (first 10):\n');
  (analyzeData.fields || []).slice(0, 10).forEach((field, idx) => {
    const label = field.label?.substring(0, 50) || 'No label';
    const type = field.type || 'unknown';
    const content = field.richTextContent ? 
      field.richTextContent.substring(0, 40).replace(/<[^>]+>/g, '') : '';
    console.log(`${idx + 1}. [${type}] ${label}${content ? ` - "${content}..."` : ''}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  
  // Check for success criteria
  const hasFields = analyzeData.fields && analyzeData.fields.length > 0;
  const hasRichtext = richtextCount > 0;
  const hasInputs = inputCount > 0;
  const reasonableFieldCount = inputCount > 50 && inputCount < 250;
  
  console.log('\n✅ SUCCESS CRITERIA:\n');
  console.log(`${hasFields ? '✅' : '❌'} Fields extracted: ${hasFields}`);
  console.log(`${hasRichtext ? '✅' : '❌'} Richtext fields detected: ${richtextCount > 0}`);
  console.log(`${hasInputs ? '✅' : '❌'} Input fields detected: ${inputCount > 0}`);
  console.log(`${reasonableFieldCount ? '✅' : '⚠️'} Reasonable field count (50-250): ${inputCount} ${reasonableFieldCount ? '' : '(may be over/under-extracting)'}`);
  console.log(`${totalTime < 60000 ? '✅' : '⚠️'} Processing time < 60s: ${(totalTime / 1000).toFixed(1)}s`);
  
  const allPass = hasFields && hasRichtext && hasInputs && reasonableFieldCount && totalTime < 60000;
  
  console.log(`\n${allPass ? '🎉 ALL TESTS PASSED!' : '⚠️ SOME TESTS FAILED - REVIEW NEEDED'}\n`);
}

testPatientForms().catch(err => {
  console.error('💥 Fatal error:', err.message);
  console.error(err.stack);
});
