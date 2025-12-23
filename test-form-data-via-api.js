/**
 * Test script to analyze form submission data via Railway API
 * Checks field completeness and identifies usable fields for custom analytics
 */

const https = require('https');

const FORM_ID = 'form_1766453391865_9cf7dc6f';
const API_BASE = 'https://my-poppler-api-dev.up.railway.app';

// Use provided token
let TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyZXRqT253bzU2ZWJCckJMUURsMyIsImVtYWlsIjoiYWtqX3dvcmsrMTA2QHlhaG9vLmNvbSIsImlhdCI6MTc2NjQ2MDM1NywiZXhwIjoxNzY3MDY1MTU3fQ.T5veXxOlOas_vs1TCqZVhg9i7RVVVV84GQ6Yi1Vi0UU';

function apiRequest(path, method = 'GET', body = null, skipAuth = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (!skipAuth && TOKEN) {
      headers['Authorization'] = `Bearer ${TOKEN}`;
    }
    
    const options = {
      method,
      headers
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
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function login() {
  console.log('🔐 Logging in...');
  try {
    const response = await apiRequest('/auth/login', 'POST', {
      email: EMAIL,
      password: PASSWORD
    }, true);
    
    if (response.token) {
      TOKEN = response.token;
      console.log('✅ Login successful\n');
      return true;
    } else {
      console.error('❌ Login failed: No token in response');
      return false;
    }
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    return false;
  }
}

async function analyzeFormData() {
  console.log('\n========================================');
  console.log('FORM DATA ANALYSIS (via Railway API)');
  console.log('========================================\n');
  console.log(`Form ID: ${FORM_ID}\n`);

  try {
    // Get form structure
    console.log('📋 Fetching form structure...');
    const formResponse = await apiRequest(`/api/forms/${FORM_ID}`);
    
    if (!formResponse || !formResponse.form) {
      console.error('❌ Form not found or invalid response');
      return;
    }

    const form = formResponse.form;
    const fields = form.structure?.fields || form.fields || [];
    console.log(`✅ Found ${fields.length} fields in form\n`);

    // Get submissions
    console.log('📊 Fetching submissions...');
    const submissionsResponse = await apiRequest(`/form/${FORM_ID}/submissions`);
    
    const submissions = submissionsResponse.submissions || [];
    console.log(`✅ Found ${submissions.length} total submissions\n`);

    if (submissions.length === 0) {
      console.log('⚠️  No submissions found. Cannot analyze data.');
      return;
    }

    // Inspect first submission structure
    console.log('🔍 INSPECTING FIRST SUBMISSION STRUCTURE:');
    console.log(JSON.stringify(submissions[0], null, 2));
    console.log('\n');

    // Determine the correct data field name
    const dataFieldName = submissions[0].submission_data ? 'submission_data' : 
                         submissions[0].submissionData ? 'submissionData' : 
                         submissions[0].data ? 'data' : null;

    if (!dataFieldName) {
      console.error('❌ Could not find submission data field');
      console.error('Available keys:', Object.keys(submissions[0]));
      return;
    }

    console.log(`✅ Using data field: "${dataFieldName}"\n`);

    // Analyze each field
    console.log('========================================');
    console.log('FIELD-BY-FIELD ANALYSIS');
    console.log('========================================\n');

    const fieldStats = [];

    for (const field of fields) {
      const stats = {
        id: field.id,
        label: field.label,
        type: field.type,
        totalResponses: 0,
        filledResponses: 0,
        emptyResponses: 0,
        uniqueValues: new Set(),
        sampleValues: [],
        isUsableForBreakdown: false,
        isUsableForOverTime: false,
        canBeMetric: false,
        canBeDimension: false
      };

      // Count responses for this field
      for (const submission of submissions) {
        const data = submission[dataFieldName] || {};
        const value = data[field.id];

        stats.totalResponses++;

        if (value !== undefined && value !== null && value !== '') {
          stats.filledResponses++;
          stats.uniqueValues.add(String(value));
          
          if (stats.sampleValues.length < 5) {
            stats.sampleValues.push(value);
          }
        } else {
          stats.emptyResponses++;
        }
      }

      // Determine field type for analytics
      const fieldType = getFieldType(field);
      
      // Determine usability
      stats.canBeMetric = fieldType === 'number' && stats.filledResponses >= 2;
      stats.canBeDimension = ['category', 'date', 'boolean'].includes(fieldType) && stats.filledResponses >= 2;
      
      stats.isUsableForBreakdown = stats.canBeMetric || stats.canBeDimension;
      stats.isUsableForOverTime = fieldType === 'date' || (fieldType === 'number' && stats.filledResponses >= 2);

      fieldStats.push(stats);

      // Print field details
      console.log(`📌 ${field.label} (${field.id})`);
      console.log(`   Type: ${field.type} → Analytics Type: ${fieldType}`);
      console.log(`   Filled: ${stats.filledResponses}/${stats.totalResponses} (${Math.round(stats.filledResponses/stats.totalResponses*100)}%)`);
      console.log(`   Unique values: ${stats.uniqueValues.size}`);
      console.log(`   Sample values: ${stats.sampleValues.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}${stats.sampleValues.length > 3 ? '...' : ''}`);
      console.log(`   Can be metric: ${stats.canBeMetric ? '✅' : '❌'}`);
      console.log(`   Can be dimension: ${stats.canBeDimension ? '✅' : '❌'}`);
      console.log('');
    }

    // Summary tables
    console.log('========================================');
    console.log('BREAKDOWN ANALYSIS COMPATIBILITY');
    console.log('========================================\n');

    const metrics = fieldStats.filter(f => f.canBeMetric);
    const dimensions = fieldStats.filter(f => f.canBeDimension);

    console.log('📊 METRIC FIELDS (Number):');
    if (metrics.length === 0) {
      console.log('   ❌ No usable metric fields found (need number/rating with ≥2 responses)\n');
    } else {
      metrics.forEach(f => {
        console.log(`   ✅ ${f.label} (${f.filledResponses} responses, ${f.uniqueValues.size} unique values)`);
      });
      console.log('');
    }

    console.log('📏 DIMENSION FIELDS (Category/Date/Boolean):');
    if (dimensions.length === 0) {
      console.log('   ❌ No usable dimension fields found (need category/date/boolean with ≥2 responses)\n');
    } else {
      dimensions.forEach(f => {
        console.log(`   ✅ ${f.label} (${f.filledResponses} responses, ${f.uniqueValues.size} unique values)`);
      });
      console.log('');
    }

    // Valid combinations
    console.log('========================================');
    console.log('VALID BREAKDOWN COMBINATIONS');
    console.log('========================================\n');

    if (metrics.length === 0 || dimensions.length === 0) {
      console.log('❌ No valid breakdown combinations available');
      console.log('   Need: At least 1 metric field AND 1 dimension field with ≥2 filled responses\n');
    } else {
      let validCombinations = 0;
      
      for (const metric of metrics) {
        for (const dimension of dimensions) {
          // Check if both fields have values in the same submissions
          let commonResponses = 0;
          
          for (const submission of submissions) {
            const data = submission[dataFieldName] || {};
            const metricValue = data[metric.id];
            const dimensionValue = data[dimension.id];
            
            if (metricValue !== undefined && metricValue !== null && metricValue !== '' &&
                dimensionValue !== undefined && dimensionValue !== null && dimensionValue !== '') {
              commonResponses++;
            }
          }
          
          if (commonResponses >= 2) {
            validCombinations++;
            console.log(`✅ ${metric.label} by ${dimension.label} (${commonResponses} complete pairs)`);
          } else {
            console.log(`❌ ${metric.label} by ${dimension.label} (only ${commonResponses} complete pairs, need ≥2)`);
          }
        }
      }
      
      console.log(`\nTotal valid combinations: ${validCombinations}\n`);
    }

    // Summary
    console.log('========================================');
    console.log('SUMMARY');
    console.log('========================================\n');
    console.log(`Total submissions: ${submissions.length}`);
    console.log(`Total fields: ${fields.length}`);
    console.log(`Fields with data: ${fieldStats.filter(f => f.filledResponses > 0).length}`);
    console.log(`Metric fields (usable): ${metrics.length}`);
    console.log(`Dimension fields (usable): ${dimensions.length}`);
    console.log('');

    // Diagnosis
    console.log('========================================');
    console.log('DIAGNOSIS');
    console.log('========================================\n');

    if (metrics.length === 0 && dimensions.length === 0) {
      console.log('🔴 CRITICAL ISSUE: No fields have enough data for analysis');
      console.log('   → Most fields are empty or have <2 filled responses');
      console.log('   → Recommendation: Check submission data generation - fields may not be populating correctly\n');
    } else if (metrics.length === 0) {
      console.log('⚠️  MISSING METRIC FIELDS: No number/rating fields with ≥2 responses');
      console.log('   → Cannot create Breakdown analyses');
      console.log('   → Add number or rating fields, or populate existing ones\n');
    } else if (dimensions.length === 0) {
      console.log('⚠️  MISSING DIMENSION FIELDS: No category/date/boolean fields with ≥2 responses');
      console.log('   → Cannot create Breakdown analyses');
      console.log('   → Add category, date, or boolean fields, or populate existing ones\n');
    } else {
      console.log('✅ Form has compatible fields for analysis');
      console.log('   → If still seeing errors, the issue is likely:');
      console.log('      1. Selected fields don\'t have overlapping responses (both filled in same submission)');
      console.log('      2. Data field name mismatch in frontend vs backend');
      console.log('      3. Filter reducing dataset below 2 responses\n');
    }

  } catch (error) {
    console.error('❌ Error analyzing form data:', error.message);
    if (error.message.includes('401')) {
      console.error('\n💡 Tip: Authentication failed. Check credentials.');
    }
  }
}

// Helper function to determine analytics field type
function getFieldType(field) {
  if (!field || !field.type) {
    return 'category';
  }
  
  const type = field.type;
  
  // Number types
  if (['number', 'rating'].includes(type)) {
    return 'number';
  }
  
  // Check if select/radio is numeric (rating-like)
  if (['select', 'radio', 'radio-with-other', 'dropdown'].includes(type)) {
    if (field.options && Array.isArray(field.options) && field.options.length > 0) {
      const allNumeric = field.options.every(opt => {
        const val = typeof opt === 'string' ? opt : (opt.value || opt.label || opt);
        const num = parseFloat(val);
        return !isNaN(num) && isFinite(num) && val !== '';
      });
      if (allNumeric) {
        return 'number';
      }
    }
    return 'category';
  }
  
  // Category types
  if (['checkbox', 'checkbox-with-other'].includes(type)) {
    return 'category';
  }
  
  // Date types
  if (['date', 'datetime-local'].includes(type)) {
    return 'date';
  }
  
  // Boolean types
  if (type === 'boolean') {
    return 'boolean';
  }
  
  // Default to category for text fields
  return 'category';
}

// Run analysis
analyzeFormData()
  .then(() => {
    console.log('✅ Analysis complete\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });

