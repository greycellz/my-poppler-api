#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const FormData = require('form-data');

async function uploadPDF() {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('pdf', fs.createReadStream('/Users/namratajha/chatterforms/tests/sample-forms/pdf/patient-forms.pdf'));
    
    const req = https.request({
      hostname: 'my-poppler-api-dev.up.railway.app',
      path: '/upload',
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    form.pipe(req);
  });
}

async function analyzeImages(imageUrl) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      imageUrls: [imageUrl],
      useRailwayVision: true
    });
    
    const req = https.request({
      hostname: 'my-poppler-api-dev.up.railway.app',
      path: '/api/analyze-images',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Failed to parse: ${responseData.substring(0, 200)}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🧪 Testing Label Field End-to-End Flow\n');
  
  try {
    // Step 1: Upload PDF
    console.log('📤 Step 1: Uploading PDF...');
    const uploadResult = await uploadPDF();
    const page1Url = uploadResult.images[0].url;
    console.log(`✅ Uploaded: ${uploadResult.uuid}`);
    console.log(`📄 Page 1 URL: ${page1Url}\n`);
    
    // Step 2: Analyze
    console.log('🤖 Step 2: Analyzing with Groq API...');
    const analysisResult = await analyzeImages(page1Url);
    
    if (!analysisResult.success) {
      console.error('❌ Analysis failed!');
      console.error(analysisResult);
      return;
    }
    
    console.log('✅ Analysis successful\n');
    
    // Step 3: Check label fields
    const labelFields = analysisResult.fields.filter(f => f.type === 'label');
    const richtextFields = analysisResult.fields.filter(f => f.type === 'richtext');
    const inputFields = analysisResult.fields.filter(f => f.type !== 'label' && f.type !== 'richtext');
    
    console.log('📊 Field Summary:');
    console.log(`  - Total fields: ${analysisResult.fields.length}`);
    console.log(`  - Label fields: ${labelFields.length}`);
    console.log(`  - Richtext fields: ${richtextFields.length} ⚠️`);
    console.log(`  - Input fields: ${inputFields.length}\n`);
    
    // Step 4: Verify label field structure
    if (labelFields.length > 0) {
      console.log('🔍 Step 3: Verifying label field structure (first 3)...\n');
      labelFields.slice(0, 3).forEach((field, i) => {
        console.log(`Label Field ${i + 1}:`);
        console.log(`  - type: "${field.type}"`);
        console.log(`  - label: "${field.label}" ${field.label === '' ? '✅' : '❌ (should be empty!)'}`);
        console.log(`  - has richTextContent: ${field.richTextContent ? '✅' : '❌'}`);
        if (field.richTextContent) {
          const preview = field.richTextContent.substring(0, 100);
          console.log(`  - richTextContent preview: "${preview}${field.richTextContent.length > 100 ? '...' : ''}"`);
        }
        console.log(`  - richTextMaxHeight: ${field.richTextMaxHeight}`);
        console.log(`  - confidence: ${field.confidence}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No label fields found!\n');
    }
    
    // Step 5: Check for issues
    console.log('🔍 Step 4: Checking for issues...\n');
    
    const nonEmptyLabels = labelFields.filter(f => f.label !== '');
    if (nonEmptyLabels.length > 0) {
      console.log(`⚠️  WARNING: ${nonEmptyLabels.length} label fields have non-empty label!`);
      nonEmptyLabels.forEach(f => {
        console.log(`  - label: "${f.label}", richTextContent: "${f.richTextContent?.substring(0, 50)}"`);
      });
      console.log('');
    } else {
      console.log('✅ All label fields have empty label field\n');
    }
    
    const missingContent = labelFields.filter(f => !f.richTextContent || f.richTextContent === '');
    if (missingContent.length > 0) {
      console.log(`⚠️  WARNING: ${missingContent.length} label fields are missing richTextContent!`);
      console.log('');
    } else {
      console.log('✅ All label fields have richTextContent\n');
    }
    
    if (richtextFields.length > 0) {
      console.log(`⚠️  WARNING: Found ${richtextFields.length} richtext fields (should be label)!`);
      console.log('First richtext field:');
      const rf = richtextFields[0];
      console.log(`  - type: "${rf.type}"`);
      console.log(`  - label: "${rf.label}"`);
      console.log(`  - richTextContent: "${rf.richTextContent?.substring(0, 50)}"`);
      console.log('');
    } else {
      console.log('✅ No richtext fields found (all converted to label)\n');
    }
    
    // Save full response
    const outputFile = `label-fields-test-${Date.now()}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(analysisResult, null, 2));
    console.log(`💾 Full response saved to: ${outputFile}\n`);
    
    console.log('✅ Test complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();

