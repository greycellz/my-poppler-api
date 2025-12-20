/**
 * Field Analytics Computation
 * Computes analytics for different field types from submission data
 */

const { detectSemanticType, shouldSkipField } = require('./field-semantics');

/**
 * Main function to compute analytics for all fields
 * @param {Array} fields - Array of form field objects
 * @param {Array} submissions - Array of submission objects
 * @param {number} totalSubmissions - Total submissions in date range (for completion rate)
 * @returns {Object} { fields: FieldAnalytics[], errors: Array<{fieldId, error}> }
 */
function computeFieldAnalytics(fields, submissions, totalSubmissions) {
  const fieldAnalytics = [];
  const errors = [];
  
  if (!Array.isArray(fields) || fields.length === 0) {
    return { fields: [], errors: [] };
  }
  
  // Create a map of field IDs for quick lookup
  const fieldMap = new Map();
  fields.forEach(field => {
    if (field.id) {
      fieldMap.set(field.id, field);
    }
  });
  
  // Process each field
  for (const field of fields) {
    try {
      // Debug: Log field being processed
      console.log(`🔍 Processing field: ${field.label || 'unnamed'} (id: ${field.id}, type: ${field.type})`);
      
      // Skip non-analyzable fields
      if (shouldSkipField(field)) {
        console.log(`⏭️ Skipping field ${field.id} (shouldSkipField returned true)`);
        continue;
      }
      
      // Validate field has an ID
      if (!field.id) {
        console.warn(`⚠️ Field missing ID, skipping:`, field);
        continue;
      }
      
      // Get semantic type
      const semanticType = detectSemanticType(field);
      if (semanticType === null) {
        // Field should be skipped
        console.log(`⏭️ Skipping field ${field.id} (semanticType is null)`);
        continue;
      }
      
      console.log(`✅ Field ${field.id} passed checks, semanticType: ${semanticType}`);
      
      // Route to appropriate analyzer based on field type
      let analytics;
      
      // Check if select/radio field should be treated as rating (has numeric options or "rating" in label)
      const isRatingLikeSelect = (field.type === 'select' || field.type === 'radio' || field.type === 'radio-with-other' || field.type === 'dropdown') &&
        (semanticType === 'opinion_score' || 
         (field.label && field.label.toLowerCase().includes('rating')) ||
         (field.options && Array.isArray(field.options) && field.options.length > 0 && 
          field.options.every(opt => {
            const val = typeof opt === 'string' ? opt : (opt.value || opt.label || opt);
            return !isNaN(parseFloat(val)) && isFinite(val);
          })));
      
      switch (field.type) {
        case 'select':
        case 'radio':
        case 'radio-with-other':
        case 'dropdown':
          if (isRatingLikeSelect) {
            analytics = analyzeRatingField(field, submissions, totalSubmissions);
          } else {
            analytics = analyzeCategoricalField(field, submissions, totalSubmissions);
          }
          break;
          
        case 'rating':
          analytics = analyzeRatingField(field, submissions, totalSubmissions);
          break;
          
        case 'checkbox':
        case 'checkbox-with-other':
          analytics = analyzeCheckboxField(field, submissions, totalSubmissions);
          break;
          
        case 'text':
        case 'textarea':
        case 'email':
        case 'tel':
          analytics = analyzeTextField(field, submissions, totalSubmissions);
          break;
          
        case 'number':
          analytics = analyzeNumericField(field, submissions, totalSubmissions);
          break;
          
        case 'date':
        case 'datetime':
          analytics = analyzeDateField(field, submissions, totalSubmissions);
          break;
          
        default:
          // Unknown field type, skip
          console.warn(`⚠️ Unknown field type: ${field.type}, skipping field: ${field.id}`);
          continue;
      }
      
      // Only add if analytics were computed successfully
      if (analytics && analytics.totalResponses !== undefined) {
        fieldAnalytics.push({
          fieldId: field.id,
          label: field.label || 'Unnamed Field',
          type: field.type,
          semanticType: semanticType,
          analytics: analytics
        });
      }
    } catch (error) {
      console.error(`❌ Error computing analytics for field ${field.id}:`, error);
      errors.push({
        fieldId: field.id || 'unknown',
        error: error.message || 'Unknown error'
      });
    }
  }
  
  return { fields: fieldAnalytics, errors };
}

/**
 * Analyze categorical fields (select, radio, dropdown)
 */
function analyzeCategoricalField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  const optionCounts = {};
  let totalResponses = 0;
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      totalResponses++;
      
      // Handle array values (shouldn't happen for select/radio, but be defensive)
      const values = Array.isArray(value) ? value : [value];
      
      values.forEach(v => {
        // Extract actual value from object if needed
        let actualValue = v;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          // Try common object properties: value, label, id, text
          actualValue = v.value !== undefined ? v.value :
                       v.label !== undefined ? v.label :
                       v.id !== undefined ? v.id :
                       v.text !== undefined ? v.text :
                       JSON.stringify(v); // Fallback to JSON string if no standard property
        }
        
        const key = String(actualValue);
        optionCounts[key] = (optionCounts[key] || 0) + 1;
      });
    }
  });
  
  // Calculate percentages
  const percentages = {};
  Object.keys(optionCounts).forEach(option => {
    percentages[option] = totalResponses > 0 
      ? (optionCounts[option] / totalResponses) * 100 
      : 0;
  });
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    optionCounts,
    percentages,
    completionRate: Math.round(completionRate * 100) / 100 // Round to 2 decimals
  };
}

/**
 * Analyze rating fields (with emoji/half-rating normalization)
 */
function analyzeRatingField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  const ratings = [];
  const distribution = {};
  let totalResponses = 0;
  
  // Debug: Log field info
  console.log(`🔍 Analyzing rating field: ${field.label || 'unnamed'} (id: ${fieldId}, type: ${field.type})`);
  console.log(`🔍 Total submissions to process: ${submissions.length}`);
  
  // Debug: Check if field ID exists in any submission
  const sampleSubmission = submissions[0];
  if (sampleSubmission && sampleSubmission.submission_data) {
    const submissionKeys = Object.keys(sampleSubmission.submission_data);
    console.log(`🔍 Sample submission has ${submissionKeys.length} fields:`, submissionKeys);
    console.log(`🔍 Looking for fieldId: ${fieldId}`);
    console.log(`🔍 Field exists in sample? ${submissionKeys.includes(fieldId)}`);
  }
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      // Extract value from object if needed (similar to categorical field fix)
      let actualValue = value;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        actualValue = value.value !== undefined ? value.value :
                     value.label !== undefined ? value.label :
                     value.id !== undefined ? value.id :
                     value.text !== undefined ? value.text :
                     null;
        
        if (actualValue === null) {
          console.log(`⚠️ Could not extract value from rating object:`, JSON.stringify(value));
          return; // Skip this submission
        }
        console.log(`✅ Extracted rating value from object: ${actualValue} (from: ${JSON.stringify(value)})`);
      }
      
      const normalized = normalizeRatingValue(actualValue, field);
      
      if (normalized !== null && !isNaN(normalized)) {
        totalResponses++;
        ratings.push(normalized);
        
        // Update distribution
        const key = Math.round(normalized * 2) / 2; // Round to nearest 0.5
        distribution[key] = (distribution[key] || 0) + 1;
      } else {
        console.log(`⚠️ Rating value could not be normalized: ${actualValue} (original: ${JSON.stringify(value)}, type: ${typeof actualValue})`);
      }
    }
  });
  
  console.log(`🔍 Rating field analysis result: ${totalResponses} responses, distribution:`, distribution);
  
  // Calculate statistics
  let mean = 0;
  let median = 0;
  let mode = 0;
  let standardDeviation = 0;
  
  if (ratings.length > 0) {
    // Mean
    mean = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
    
    // Median
    const sorted = [...ratings].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    
    // Mode (most frequent rating)
    const frequencyMap = {};
    ratings.forEach(r => {
      const key = Math.round(r * 2) / 2;
      frequencyMap[key] = (frequencyMap[key] || 0) + 1;
    });
    mode = Object.keys(frequencyMap).reduce((a, b) => 
      frequencyMap[a] > frequencyMap[b] ? a : b
    );
    mode = parseFloat(mode);
    
    // Standard deviation
    const variance = ratings.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / ratings.length;
    standardDeviation = Math.sqrt(variance);
  }
  
  // Percentage above threshold (≥4 stars or equivalent)
  const threshold = field.ratingMax ? field.ratingMax * 0.8 : 4; // 80% of max or 4
  const aboveThreshold = ratings.filter(r => r >= threshold).length;
  const percentageAboveThreshold = totalResponses > 0 
    ? (aboveThreshold / totalResponses) * 100 
    : 0;
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    mode: Math.round(mode * 100) / 100,
    distribution,
    percentageAboveThreshold: Math.round(percentageAboveThreshold * 100) / 100,
    standardDeviation: Math.round(standardDeviation * 100) / 100,
    completionRate: Math.round(completionRate * 100) / 100
  };
}

/**
 * Normalize rating value (handle emojis, half-ratings)
 * Note: Object extraction is done in analyzeRatingField before calling this
 */
function normalizeRatingValue(value, field) {
  // Handle emoji ratings
  if (field.ratingType === 'emojis') {
    const emojiMap = {
      '😞': 1, '😟': 1, '😢': 1, '😭': 1, '😰': 1, '😨': 1,
      '😕': 2, '😒': 2, '🙁': 2, '😟': 2,
      '😐': 3, '😑': 3, '😶': 3, '😏': 3,
      '🙂': 4, '😊': 4, '😌': 4,
      '😀': 5, '😃': 5, '😄': 5, '😁': 5, '😍': 5, '🤩': 5
    };
    if (emojiMap[value] !== undefined) {
      return emojiMap[value];
    }
  }
  
  // For stars/scale, ensure numeric
  const num = parseFloat(value);
  if (isNaN(num)) {
    console.log(`⚠️ Rating value is not numeric: ${value} (type: ${typeof value})`);
    return null;
  }
  
  // Handle half-ratings if allowed
  if (field.ratingAllowHalf) {
    // Round to nearest 0.5
    return Math.round(num * 2) / 2;
  }
  
  // Round to integer
  return Math.round(num);
}

/**
 * Analyze checkbox fields (detects single vs multi-select)
 */
function analyzeCheckboxField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  
  // Sample first 10 non-null values to determine type
  const sampleValues = submissions
    .map(s => s.submission_data?.[fieldId])
    .filter(v => v !== undefined && v !== null && v !== '')
    .slice(0, 10);
  
  if (sampleValues.length === 0) {
    // No data, default to boolean
    return analyzeBooleanField(field, submissions, totalSubmissions);
  }
  
  const isMultiSelect = sampleValues.some(v => Array.isArray(v));
  
  if (isMultiSelect) {
    return analyzeMultiSelectField(field, submissions, totalSubmissions);
  } else {
    return analyzeBooleanField(field, submissions, totalSubmissions);
  }
}

/**
 * Analyze multi-select checkbox fields
 */
function analyzeMultiSelectField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  const optionCounts = {};
  let totalResponses = 0;
  let totalSelections = 0;
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      totalResponses++;
      
      // Handle both array and single value (defensive)
      const values = Array.isArray(value) ? value : [value];
      
      values.forEach(v => {
        if (v !== null && v !== '') {
          totalSelections++;
          const key = String(v);
          optionCounts[key] = (optionCounts[key] || 0) + 1;
        }
      });
    }
  });
  
  // Calculate percentages (can exceed 100% since multiple selections per submission)
  const percentages = {};
  Object.keys(optionCounts).forEach(option => {
    percentages[option] = totalResponses > 0 
      ? (optionCounts[option] / totalResponses) * 100 
      : 0;
  });
  
  // Average selections per submission
  const averageSelections = totalResponses > 0 
    ? totalSelections / totalResponses 
    : 0;
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    optionCounts,
    percentages,
    averageSelections: Math.round(averageSelections * 100) / 100,
    completionRate: Math.round(completionRate * 100) / 100
  };
}

/**
 * Analyze boolean/yes-no checkbox fields
 */
function analyzeBooleanField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  let yesCount = 0;
  let noCount = 0;
  let totalResponses = 0;
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      totalResponses++;
      
      // Handle boolean, string, and number values
      const isTrue = value === true || 
                     value === 'true' || 
                     value === 'yes' || 
                     value === 'Yes' ||
                     value === 1 ||
                     String(value).toLowerCase() === 'true' ||
                     String(value).toLowerCase() === 'yes';
      
      if (isTrue) {
        yesCount++;
      } else {
        noCount++;
      }
    }
  });
  
  // Calculate percentages
  const yesPercentage = totalResponses > 0 
    ? (yesCount / totalResponses) * 100 
    : 0;
  const noPercentage = totalResponses > 0 
    ? (noCount / totalResponses) * 100 
    : 0;
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    yesCount,
    noCount,
    yesPercentage: Math.round(yesPercentage * 100) / 100,
    noPercentage: Math.round(noPercentage * 100) / 100,
    completionRate: Math.round(completionRate * 100) / 100
  };
}

/**
 * Analyze text fields (basic stats)
 */
function analyzeTextField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  let totalResponses = 0;
  let totalWords = 0;
  let totalCharacters = 0;
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      totalResponses++;
      const text = String(value);
      totalCharacters += text.length;
      
      // Count words (split by whitespace)
      const words = text.trim().split(/\s+/).filter(w => w.length > 0);
      totalWords += words.length;
    }
  });
  
  // Calculate averages
  const averageWordCount = totalResponses > 0 
    ? totalWords / totalResponses 
    : 0;
  const averageCharacterCount = totalResponses > 0 
    ? totalCharacters / totalResponses 
    : 0;
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    averageWordCount: Math.round(averageWordCount * 100) / 100,
    averageCharacterCount: Math.round(averageCharacterCount * 100) / 100,
    completionRate: Math.round(completionRate * 100) / 100
  };
}

/**
 * Analyze numeric fields
 */
function analyzeNumericField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  const values = [];
  let totalResponses = 0;
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        totalResponses++;
        values.push(num);
      }
    }
  });
  
  // Calculate statistics
  let min = 0;
  let max = 0;
  let mean = 0;
  let median = 0;
  const percentiles = { p25: 0, p50: 0, p75: 0 };
  
  if (values.length > 0) {
    const sorted = [...values].sort((a, b) => a - b);
    min = sorted[0];
    max = sorted[sorted.length - 1];
    
    // Mean
    mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    
    // Median (P50)
    const mid = Math.floor(sorted.length / 2);
    median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    
    // Percentiles
    percentiles.p25 = sorted[Math.floor(sorted.length * 0.25)];
    percentiles.p50 = median;
    percentiles.p75 = sorted[Math.floor(sorted.length * 0.75)];
  }
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    percentiles: {
      p25: Math.round(percentiles.p25 * 100) / 100,
      p50: Math.round(percentiles.p50 * 100) / 100,
      p75: Math.round(percentiles.p75 * 100) / 100
    },
    completionRate: Math.round(completionRate * 100) / 100
  };
}

/**
 * Analyze date fields (with timezone normalization)
 */
function analyzeDateField(field, submissions, totalSubmissions) {
  const fieldId = field.id;
  const distribution = {}; // Date -> count
  const dayOfWeek = {}; // Day name -> count
  let totalResponses = 0;
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  submissions.forEach(submission => {
    const value = submission.submission_data?.[fieldId];
    
    if (value !== undefined && value !== null && value !== '') {
      try {
        // Parse date (handle ISO strings, timestamps, etc.)
        const date = new Date(value);
        
        if (!isNaN(date.getTime())) {
          totalResponses++;
          
          // Distribution by date (YYYY-MM-DD)
          const dateKey = date.toISOString().split('T')[0];
          distribution[dateKey] = (distribution[dateKey] || 0) + 1;
          
          // Day of week
          const dayName = dayNames[date.getDay()];
          dayOfWeek[dayName] = (dayOfWeek[dayName] || 0) + 1;
        }
      } catch (error) {
        // Invalid date, skip
        console.warn(`⚠️ Invalid date value for field ${fieldId}:`, value);
      }
    }
  });
  
  // Calculate completion rate
  const completionRate = totalSubmissions > 0 
    ? (totalResponses / totalSubmissions) * 100 
    : 0;
  
  return {
    totalResponses,
    distribution,
    dayOfWeek,
    completionRate: Math.round(completionRate * 100) / 100
  };
}

module.exports = {
  computeFieldAnalytics,
  analyzeCategoricalField,
  analyzeRatingField,
  analyzeCheckboxField,
  analyzeMultiSelectField,
  analyzeBooleanField,
  analyzeTextField,
  analyzeNumericField,
  analyzeDateField,
  normalizeRatingValue
};
