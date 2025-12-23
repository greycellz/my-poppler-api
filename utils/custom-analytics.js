/**
 * Custom Analytics Computation
 * Handles user-selected field combinations with predefined templates
 * NO statistical jargon - plain language only
 */

/**
 * Get simplified field type for custom analytics
 * (Copied from cross-field-analytics.js since it's not exported)
 */
function getFieldType(field) {
  if (!field || !field.type) {
    console.warn(`⚠️ getFieldType: Field missing type`, field);
    return 'category'; // Default fallback
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
  
  // Default to category for text fields (can't do numeric analysis)
  return 'category';
}

/**
 * Main function to compute custom analysis
 * @param {Array} submissions - Array of submission objects
 * @param {string} templateType - Template type: 'breakdown' | 'over-time'
 * @param {Object} primaryField - Primary field object
 * @param {Object} secondaryField - Secondary field object
 * @param {Object} options - Analysis options
 * @param {Array} options.filters - Array of filter objects
 * @param {string} options.aggregation - 'mean' | 'median' | 'p90'
 * @param {string} options.timeGranularity - 'day' | 'week' | 'month' (for over-time template)
 * @returns {Object} Analysis results with plain language summary
 */
function computeCustomAnalysis(submissions, templateType, primaryField, secondaryField, options = {}) {
  console.log(`🔍 COMPUTE CUSTOM ANALYSIS - Starting`);
  console.log(`   Template: ${templateType}`);
  console.log(`   Input submissions: ${submissions.length}`);
  console.log(`   Primary field: ${primaryField.id} (${primaryField.label || 'unknown'})`);
  console.log(`   Secondary field: ${secondaryField.id} (${secondaryField.label || 'unknown'})`);
  console.log(`   Options: ${JSON.stringify(options)}`);
  
  const { filters = [], aggregation = 'mean', timeGranularity = null } = options;
  
  console.log(`   Filters: ${filters.length} filter(s)`);
  if (filters.length > 0) {
    filters.forEach((f, idx) => {
      console.log(`     Filter ${idx + 1}: ${f.field_id} ${f.operator} ${f.value}`);
    });
  }
  
  // Apply filters
  let filteredSubmissions = applyFilters(submissions, filters);
  console.log(`   After filters: ${filteredSubmissions.length} submissions`);
  
  // Route to template-specific analyzer
  switch (templateType) {
    case 'breakdown':
      return analyzeBreakdown(filteredSubmissions, primaryField, secondaryField, aggregation);
    case 'over-time':
      return analyzeOverTime(filteredSubmissions, primaryField, secondaryField, timeGranularity || 'day', aggregation);
    case 'relationship':
      // Phase 1.5
      throw new Error('Relationship template not yet implemented (Phase 1.5)');
    case 'composition':
      // Phase 1.5
      throw new Error('Composition template not yet implemented (Phase 1.5)');
    case 'distribution':
      // Phase 2
      throw new Error('Distribution Split template not yet implemented (Phase 2)');
    case 'text-insights':
      // Phase 2
      throw new Error('Text Insights template not yet implemented (Phase 2)');
    default:
      throw new Error(`Unknown template type: ${templateType}`);
  }
}

/**
 * Apply filters to submissions
 * @param {Array} submissions - Array of submission objects
 * @param {Array} filters - Array of filter objects { field_id, operator, value }
 * @returns {Array} Filtered submissions
 */
function applyFilters(submissions, filters) {
  if (!filters || filters.length === 0) {
    return submissions;
  }
  
  // 🔍 INSPECT ACTUAL SUBMISSION STRUCTURE FOR FILTERS
  if (submissions.length > 0 && filters.length > 0) {
    console.log('🔍 FILTERS - ACTUAL SUBMISSION STRUCTURE:', JSON.stringify(submissions[0], null, 2));
  }
  
  return submissions.filter(submission => {
    // Handle both possible field names (submission_data, submissionData, data)
    const data = submission.submission_data || submission.submissionData || submission.data || {};
    
    return filters.every(filter => {
      const fieldValue = data[filter.field_id];
      
      // Skip if field value is null/undefined/empty
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        return false;
      }
      
      switch (filter.operator) {
        case 'equals':
          return String(fieldValue) === String(filter.value);
        case 'not_equals':
          return String(fieldValue) !== String(filter.value);
        case 'greater_than':
          return parseFloat(fieldValue) > parseFloat(filter.value);
        case 'less_than':
          return parseFloat(fieldValue) < parseFloat(filter.value);
        case 'contains':
          return String(fieldValue).toLowerCase().includes(String(filter.value).toLowerCase());
        case 'before':
          return new Date(fieldValue) < new Date(filter.value);
        case 'after':
          return new Date(fieldValue) > new Date(filter.value);
        default:
          console.warn(`Unknown filter operator: ${filter.operator}`);
          return true;
      }
    });
  });
}

/**
 * Analyze Breakdown template: Metric (number) by Dimension (category/date/boolean)
 * @param {Array} submissions - Filtered submissions
 * @param {Object} primaryField - Number field (metric)
 * @param {Object} secondaryField - Category/date/boolean field (dimension)
 * @param {string} aggregation - 'mean' | 'median' | 'p90'
 * @returns {Object} Analysis results
 */
function analyzeBreakdown(submissions, primaryField, secondaryField, aggregation = 'mean') {
  console.log(`🔍 BREAKDOWN - Starting analysis with ${submissions.length} submissions`);
  console.log(`🔍 BREAKDOWN - Primary field: ${primaryField.id} (${primaryField.label || 'unknown'})`);
  console.log(`🔍 BREAKDOWN - Secondary field: ${secondaryField.id} (${secondaryField.label || 'unknown'})`);
  
  // 🔍 INSPECT ACTUAL SUBMISSION STRUCTURE (following repo rule: never assume field names)
  if (submissions.length > 0) {
    console.log('🔍 BREAKDOWN - ACTUAL SUBMISSION STRUCTURE:', JSON.stringify(submissions[0], null, 2));
    console.log('🔍 BREAKDOWN - SUBMISSION KEYS:', Object.keys(submissions[0]));
    
    // Check data field
    const dataFieldName = submissions[0].submission_data ? 'submission_data' : 
                         submissions[0].submissionData ? 'submissionData' : 
                         submissions[0].data ? 'data' : null;
    console.log(`🔍 BREAKDOWN - Using data field: "${dataFieldName}"`);
    
    if (dataFieldName) {
      const data = submissions[0][dataFieldName] || {};
      console.log(`🔍 BREAKDOWN - Data keys: ${Object.keys(data).join(', ')}`);
      console.log(`🔍 BREAKDOWN - Primary value (${primaryField.id}): ${JSON.stringify(data[primaryField.id])}`);
      console.log(`🔍 BREAKDOWN - Secondary value (${secondaryField.id}): ${JSON.stringify(data[secondaryField.id])}`);
    }
  }
  
  // Extract pairs
  const pairs = [];
  let missingPrimary = 0;
  let missingSecondary = 0;
  let missingBoth = 0;
  
  for (const submission of submissions) {
    // Handle both possible field names (submission_data, submissionData, data)
    const data = submission.submission_data || submission.submissionData || submission.data || {};
    const primaryValue = data[primaryField.id];
    const secondaryValue = data[secondaryField.id];
    
    const hasPrimary = primaryValue !== undefined && primaryValue !== null && primaryValue !== '';
    const hasSecondary = secondaryValue !== undefined && secondaryValue !== null && secondaryValue !== '';
    
    if (hasPrimary && hasSecondary) {
      pairs.push({ 
        primary: parseFloat(primaryValue), 
        secondary: String(secondaryValue) 
      });
    } else {
      if (!hasPrimary && !hasSecondary) missingBoth++;
      else if (!hasPrimary) missingPrimary++;
      else if (!hasSecondary) missingSecondary++;
    }
  }
  
  console.log(`🔍 BREAKDOWN - Found ${pairs.length} complete pairs`);
  console.log(`🔍 BREAKDOWN - Missing primary only: ${missingPrimary}`);
  console.log(`🔍 BREAKDOWN - Missing secondary only: ${missingSecondary}`);
  console.log(`🔍 BREAKDOWN - Missing both: ${missingBoth}`);
  
  if (pairs.length < 2) {
    console.error(`❌ BREAKDOWN - NOT ENOUGH PAIRS: ${pairs.length} < 2`);
    return {
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      sampleSize: pairs.length,
      strength: 'no clear pattern',
      error: 'Not enough data to analyze. Need at least 2 responses with both fields filled.'
    };
  }
  
  console.log(`✅ BREAKDOWN - SUFFICIENT PAIRS: ${pairs.length} >= 2, proceeding with analysis`);
  
  // Group by secondary field and aggregate primary field
  const groups = {};
  pairs.forEach(pair => {
    if (!groups[pair.secondary]) {
      groups[pair.secondary] = [];
    }
    if (!isNaN(pair.primary)) {
      groups[pair.secondary].push(pair.primary);
    }
  });
  
  // Calculate aggregation per group
  const chartData = [];
  let highestValue = -Infinity;
  let highestCategory = null;
  
  Object.keys(groups).forEach(category => {
    const values = groups[category];
    if (values.length === 0) return;
    
    let aggregatedValue;
    switch (aggregation) {
      case 'mean':
        aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
        break;
      case 'median':
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        aggregatedValue = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        break;
      case 'p90':
        const sortedP90 = [...values].sort((a, b) => a - b);
        const index = Math.floor(sortedP90.length * 0.9);
        aggregatedValue = sortedP90[index] || sortedP90[sortedP90.length - 1];
        break;
      default:
        aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
    }
    
    chartData.push({
      x: category,
      y: Math.round(aggregatedValue * 10) / 10,
      count: values.length,
      label: category
    });
    
    if (aggregatedValue > highestValue) {
      highestValue = aggregatedValue;
      highestCategory = category;
    }
  });
  
  // Sort by value (descending)
  chartData.sort((a, b) => b.y - a.y);
  
  // Calculate overall average
  const allValues = pairs.map(p => p.primary).filter(v => !isNaN(v));
  const overallAvg = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;
  
  // Generate BigNumber
  const aggregationLabel = {
    'mean': 'Avg',
    'median': 'Median',
    'p90': 'Top 10% Avg'
  }[aggregation] || 'Avg';
  
  const bigNumber = {
    value: `Highest ${aggregationLabel} ${primaryField.label}: ${highestCategory} (${highestValue.toFixed(1)})`,
    comparison: `Overall average: ${overallAvg.toFixed(1)}`,
    trend: highestValue > overallAvg ? 'up' : highestValue < overallAvg ? 'down' : 'neutral'
  };
  
  // Determine strength
  const variance = Math.max(...chartData.map(d => d.y)) - Math.min(...chartData.map(d => d.y));
  const strength = variance > overallAvg * 0.3 ? 'strong pattern' : variance > overallAvg * 0.1 ? 'some pattern' : 'no clear pattern';
  
  console.log(`✅ BREAKDOWN - Analysis complete: ${chartData.length} categories, sampleSize=${pairs.length}`);
  
  return {
    bigNumber,
    chartData,
    chartType: 'bars',
    sampleSize: pairs.length,
    strength
  };
}

/**
 * Analyze Over Time template: Date vs Number or Date vs Category trend
 * @param {Array} submissions - Filtered submissions
 * @param {Object} primaryField - Date field
 * @param {Object} secondaryField - Number or category field
 * @param {string} timeGranularity - 'day' | 'week' | 'month'
 * @param {string} aggregation - 'mean' | 'median' | 'p90' (for numeric fields)
 * @returns {Object} Analysis results
 */
function analyzeOverTime(submissions, primaryField, secondaryField, timeGranularity = 'day', aggregation = 'mean') {
  // 🔍 INSPECT ACTUAL SUBMISSION STRUCTURE (following repo rule: never assume field names)
  if (submissions.length > 0) {
    console.log('🔍 OVER TIME - ACTUAL SUBMISSION STRUCTURE:', JSON.stringify(submissions[0], null, 2));
    console.log('🔍 OVER TIME - SUBMISSION KEYS:', Object.keys(submissions[0]));
  }
  
  // Extract pairs
  const pairs = [];
  for (const submission of submissions) {
    // Handle both possible field names (submission_data, submissionData, data)
    const data = submission.submission_data || submission.submissionData || submission.data || {};
    const dateValue = data[primaryField.id];
    const secondaryValue = data[secondaryField.id];
    
    if (dateValue && secondaryValue !== undefined && secondaryValue !== null && secondaryValue !== '') {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        pairs.push({ 
          date, 
          value: secondaryValue 
        });
      }
    }
  }
  
  if (pairs.length < 2) {
    return {
      bigNumber: null,
      chartData: [],
      chartType: 'line',
      sampleSize: pairs.length,
      strength: 'no clear pattern',
      error: 'Not enough data to analyze. Need at least 2 responses with both fields filled.'
    };
  }
  
  // Group by time granularity
  const groups = {};
  const secondaryType = getFieldType(secondaryField);
  const isNumeric = secondaryType === 'number';
  
  pairs.forEach(pair => {
    let timeKey;
    const date = pair.date;
    
    switch (timeGranularity) {
      case 'day':
        timeKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
        timeKey = weekStart.toISOString().split('T')[0];
        break;
      case 'month':
        timeKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        break;
      default:
        timeKey = date.toISOString().split('T')[0];
    }
    
    if (!groups[timeKey]) {
      groups[timeKey] = [];
    }
    
    if (isNumeric) {
      const numValue = parseFloat(pair.value);
      if (!isNaN(numValue)) {
        groups[timeKey].push(numValue);
      }
    } else {
      groups[timeKey].push(String(pair.value));
    }
  });
  
  // Aggregate per time period
  const chartData = [];
  const timeKeys = Object.keys(groups).sort();
  
  timeKeys.forEach(timeKey => {
    const values = groups[timeKey];
    if (values.length === 0) return;
    
    let aggregatedValue;
    let label = timeKey;
    
    if (isNumeric) {
      // Apply aggregation parameter (mean/median/p90)
      switch (aggregation) {
        case 'mean':
          aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
          break;
        case 'median':
          const sorted = [...values].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          aggregatedValue = sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
          break;
        case 'p90':
          const sortedP90 = [...values].sort((a, b) => a - b);
          const index = Math.ceil(sortedP90.length * 0.9) - 1;
          aggregatedValue = sortedP90[Math.max(0, index)];
          break;
        default:
          aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    } else {
      // For categories, count most common value
      const counts = {};
      values.forEach(v => {
        counts[v] = (counts[v] || 0) + 1;
      });
      const mostCommon = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
      aggregatedValue = counts[mostCommon];
      label = `${timeKey} (${mostCommon})`;
    }
    
    chartData.push({
      x: timeKey,
      y: Math.round(aggregatedValue * 10) / 10,
      count: values.length,
      label
    });
  });
  
  // Calculate recent vs previous period comparison
  if (chartData.length >= 2 && isNumeric) {
    const recent = chartData[chartData.length - 1].y;
    const previous = chartData[chartData.length - 2].y;
    const trend = recent > previous ? 'up' : recent < previous ? 'down' : 'neutral';
    const change = Math.abs(recent - previous);
    const percentChange = previous > 0 ? ((change / previous) * 100).toFixed(0) : '0';
    
    const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
    
    const bigNumber = {
      value: `Recent Avg ${secondaryField.label}: ${recent.toFixed(1)} (${trendSymbol} from ${previous.toFixed(1)})`,
      comparison: change > 0 ? `${percentChange}% ${trend === 'up' ? 'increase' : 'decrease'}` : 'No change',
      trend
    };
    
    // Determine strength
    const variance = Math.max(...chartData.map(d => d.y)) - Math.min(...chartData.map(d => d.y));
    const avg = chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length;
    const strength = variance > avg * 0.3 ? 'strong pattern' : variance > avg * 0.1 ? 'some pattern' : 'no clear pattern';
    
    return {
      bigNumber,
      chartData,
      chartType: 'line',
      sampleSize: pairs.length,
      strength
    };
  }
  
  // Fallback if not enough data points
  const avg = isNumeric 
    ? chartData.reduce((sum, d) => sum + d.y, 0) / chartData.length
    : chartData.reduce((sum, d) => sum + d.count, 0) / chartData.length;
  
  const bigNumber = {
    value: `Avg ${secondaryField.label}: ${avg.toFixed(1)}`,
    comparison: `Based on ${pairs.length} responses`,
    trend: 'neutral'
  };
  
  return {
    bigNumber,
    chartData,
    chartType: 'line',
    sampleSize: pairs.length,
    strength: 'some pattern'
  };
}

/**
 * Validate field compatibility with template
 * @param {string} templateType - Template type
 * @param {Object} primaryField - Primary field
 * @param {Object} secondaryField - Secondary field
 * @returns {boolean} True if compatible
 */
function validateFieldCompatibility(templateType, primaryField, secondaryField) {
  const primaryType = getFieldType(primaryField);
  const secondaryType = getFieldType(secondaryField);
  
  switch (templateType) {
    case 'breakdown':
      return primaryType === 'number' && 
             (secondaryType === 'category' || secondaryType === 'date' || secondaryType === 'boolean');
    case 'over-time':
      return primaryType === 'date' && 
             (secondaryType === 'number' || secondaryType === 'category');
    case 'relationship':
      return primaryType === 'number' && secondaryType === 'number';
    case 'composition':
      return primaryType === 'category' && secondaryType === 'category';
    default:
      return false;
  }
}

module.exports = {
  computeCustomAnalysis,
  applyFilters,
  analyzeBreakdown,
  analyzeOverTime,
  validateFieldCompatibility
};

