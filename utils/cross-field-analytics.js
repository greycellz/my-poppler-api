/**
 * Cross-Field Analytics Computation
 * Computes simple, easy-to-understand cross-field comparisons
 * NO statistical jargon - plain language only
 */

/**
 * Main function to compute cross-field analysis between two fields
 * @param {Array} submissions - Array of submission objects
 * @param {Object} field1 - First field object
 * @param {Object} field2 - Second field object
 * @returns {Object} Analysis results with plain language summary
 */
function calculateCrossFieldAnalysis(submissions, field1, field2) {
  if (!submissions || submissions.length === 0) {
    return {
      question: `How do ${field1.label || 'Field 1'} and ${field2.label || 'Field 2'} relate?`,
      answer: 'Not enough data to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      strength: 'no clear pattern'
    };
  }

  // Extract values for both fields from submissions
  const pairs = [];
  for (const submission of submissions) {
    const data = submission.submission_data || {};
    const val1 = data[field1.id];
    const val2 = data[field2.id];
    
    // Only include pairs where both fields have values
    if (val1 !== undefined && val1 !== null && val1 !== '' &&
        val2 !== undefined && val2 !== null && val2 !== '') {
      pairs.push({ x: val1, y: val2 });
    }
  }

  if (pairs.length < 2) {
    return {
      question: `How do ${field1.label || 'Field 1'} and ${field2.label || 'Field 2'} relate?`,
      answer: 'Not enough data to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      strength: 'no clear pattern'
    };
  }

  // Determine field types
  const type1 = getFieldType(field1);
  const type2 = getFieldType(field2);

  // Route to appropriate analyzer
  if (type1 === 'number' && type2 === 'number') {
    return analyzeNumberNumber(pairs, field1, field2);
  } else if (type1 === 'category' && type2 === 'number') {
    return analyzeCategoryNumber(pairs, field1, field2);
  } else if (type1 === 'number' && type2 === 'category') {
    // Swap fields
    const result = analyzeCategoryNumber(
      pairs.map(p => ({ x: p.y, y: p.x })),
      field2,
      field1
    );
    // Swap back the question/answer context
    return {
      ...result,
      question: result.question.replace(field2.label, field1.label).replace(field1.label, field2.label)
    };
  } else if (type1 === 'category' && type2 === 'category') {
    return analyzeCategoryCategory(pairs, field1, field2);
  } else if (type1 === 'date' || type2 === 'date') {
    return analyzeDateField(pairs, field1, field2, type1 === 'date' ? field1 : field2);
  } else {
    // Fallback for other combinations
    return {
      question: `How do ${field1.label || 'Field 1'} and ${field2.label || 'Field 2'} relate?`,
      answer: 'This comparison type is not yet supported',
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      strength: 'no clear pattern'
    };
  }
}

/**
 * Get simplified field type for cross-field analysis
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
  
  // Default to category for text fields (can't do numeric analysis)
  return 'category';
}

/**
 * Analyze number vs number (e.g., Age vs Rating)
 * Returns simple comparison: "Do higher X values have higher Y values?"
 */
function analyzeNumberNumber(pairs, field1, field2) {
  // Convert to numbers
  const numericPairs = pairs
    .map(p => ({
      x: parseFloat(p.x),
      y: parseFloat(p.y)
    }))
    .filter(p => !isNaN(p.x) && !isNaN(p.y));

  if (numericPairs.length < 2) {
    return {
      question: `Do different ${field1.label || 'values'} give different ${field2.label || 'ratings'}?`,
      answer: 'Not enough numeric data to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'dots',
      strength: 'no clear pattern',
      metadata: {
        aggregationLevel: 'none',
        binRanges: [],
        numBins: 0
      }
    };
  }

  // Calculate overall average for bigNumber
  const overallAvgY = numericPairs.reduce((sum, p) => sum + p.y, 0) / numericPairs.length;

  // Determine aggregation strategy based on data size (soft thresholds)
  const dataSize = numericPairs.length;
  let aggregationLevel;
  let numBins;
  let chartData;
  let binRanges = [];

  const xValues = numericPairs.map(p => p.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const range = maxX - minX;

  if (dataSize <= 75) {
    // No aggregation - return individual points
    aggregationLevel = 'none';
    numBins = 0;
    chartData = numericPairs.map(p => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      label: `${Math.round(p.x)}`
    }));
  } else if (dataSize <= 300) {
    // Light aggregation: 5-8 bins
    aggregationLevel = 'light';
    numBins = Math.min(8, Math.max(5, Math.floor(Math.sqrt(dataSize))));
  } else {
    // Strong aggregation: 8-10 bins
    aggregationLevel = 'strong';
    numBins = Math.min(10, Math.max(8, Math.floor(Math.sqrt(dataSize))));
  }

  // Apply binning if aggregation is needed
  if (aggregationLevel !== 'none') {
    const binSize = range / numBins;

    const bins = {};
    numericPairs.forEach(pair => {
      const binIndex = Math.min(
        Math.floor((pair.x - minX) / binSize),
        numBins - 1
      );
      const binKey = `${binIndex}`;
      if (!bins[binKey]) {
        bins[binKey] = { sum: 0, count: 0, xValues: [] };
      }
      bins[binKey].sum += pair.y;
      bins[binKey].count += 1;
      bins[binKey].xValues.push(pair.x);
    });

    // Build binRanges for tooltip display
    binRanges = Object.keys(bins)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(binKey => {
        const bin = bins[binKey];
        const minXInBin = Math.min(...bin.xValues);
        const maxXInBin = Math.max(...bin.xValues);
        return {
          min: Math.round(minXInBin * 10) / 10,
          max: Math.round(maxXInBin * 10) / 10
        };
      });

    chartData = Object.keys(bins)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(binKey => {
        const bin = bins[binKey];
        const avgX = bin.xValues.reduce((a, b) => a + b, 0) / bin.xValues.length;
        const avgY = bin.sum / bin.count;
        return {
          x: Math.round(avgX * 10) / 10,
          y: Math.round(avgY * 10) / 10,
          label: `${Math.round(avgX)}`
        };
      });
  }

  // Simple trend detection: compare first half vs second half
  const sorted = [...numericPairs].sort((a, b) => a.x - b.x);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const avgYFirst = firstHalf.reduce((sum, p) => sum + p.y, 0) / firstHalf.length;
  const avgYSecond = secondHalf.reduce((sum, p) => sum + p.y, 0) / secondHalf.length;

  const difference = Math.abs(avgYSecond - avgYFirst);
  const percentDiff = (difference / Math.max(avgYFirst, avgYSecond)) * 100;

  let answer;
  let strength;
  if (percentDiff < 5) {
    answer = `No clear pattern - ${field2.label || 'ratings'} are similar across different ${field1.label || 'values'}`;
    strength = 'no clear pattern';
  } else if (avgYSecond > avgYFirst) {
    answer = `Yes! Higher ${field1.label || 'values'} tend to give higher ${field2.label || 'ratings'} (${avgYSecond.toFixed(1)} vs ${avgYFirst.toFixed(1)})`;
    strength = percentDiff > 20 ? 'strong pattern' : 'some pattern';
  } else {
    answer = `Yes! Lower ${field1.label || 'values'} tend to give higher ${field2.label || 'ratings'} (${avgYFirst.toFixed(1)} vs ${avgYSecond.toFixed(1)})`;
    strength = percentDiff > 20 ? 'strong pattern' : 'some pattern';
  }

  return {
    question: `Do different ${field1.label || 'values'} give different ${field2.label || 'ratings'}?`,
    answer,
    bigNumber: {
      value: `Avg ${field2.label}: ${overallAvgY.toFixed(1)}`,
      comparison: null
    },
    chartData,
    chartType: 'dots',
    strength,
    metadata: {
      aggregationLevel,
      binRanges,
      numBins
    }
  };
}

/**
 * Analyze category vs number (e.g., Gender vs Rating)
 * Returns: "Which group has higher numbers?"
 */
function analyzeCategoryNumber(pairs, categoryField, numberField) {
  // Group by category
  const groups = {};
  pairs.forEach(pair => {
    const category = String(pair.x);
    const value = parseFloat(pair.y);
    if (isNaN(value)) return;

    if (!groups[category]) {
      groups[category] = { sum: 0, count: 0, values: [] };
    }
    groups[category].sum += value;
    groups[category].count += 1;
    groups[category].values.push(value);
  });

  // Calculate averages
  const groupAverages = Object.keys(groups).map(category => ({
    category,
    average: groups[category].sum / groups[category].count,
    count: groups[category].count
  }));

  if (groupAverages.length === 0) {
    return {
      question: `Which ${categoryField.label || 'groups'} have higher ${numberField.label || 'ratings'}?`,
      answer: 'Not enough data to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      strength: 'no clear pattern'
    };
  }

  // Sort by average
  groupAverages.sort((a, b) => b.average - a.average);
  const highest = groupAverages[0];
  const lowest = groupAverages[groupAverages.length - 1];

  // Calculate overall average across all groups
  const totalSum = Object.values(groups).reduce((sum, g) => sum + g.sum, 0);
  const totalCount = Object.values(groups).reduce((sum, g) => sum + g.count, 0);
  const overallAvg = totalSum / totalCount;

  const difference = highest.average - lowest.average;
  const percentDiff = (difference / highest.average) * 100;

  let answer;
  let strength;
  if (percentDiff < 5) {
    answer = `All groups are similar (around ${highest.average.toFixed(1)})`;
    strength = 'no clear pattern';
  } else {
    answer = `${highest.category} has the highest ${numberField.label || 'ratings'} (${highest.average.toFixed(1)} vs ${lowest.average.toFixed(1)})`;
    strength = percentDiff > 20 ? 'strong pattern' : 'some pattern';
  }

  const chartData = groupAverages.map(g => ({
    x: g.category,
    y: g.average,
    label: `${g.average.toFixed(1)}`
  }));

  return {
    question: `Which ${categoryField.label || 'groups'} have higher ${numberField.label || 'ratings'}?`,
    answer,
    bigNumber: {
      value: `Highest Avg: ${highest.category} (${highest.average.toFixed(1)})`,
      comparison: `Overall Avg: ${overallAvg.toFixed(1)}`
    },
    chartData,
    chartType: 'bars',
    strength
  };
}

/**
 * Analyze category vs category (e.g., Gender vs Preference)
 * Returns: "How do preferences differ by group?"
 */
function analyzeCategoryCategory(pairs, field1, field2) {
  // Count combinations
  const combinations = {};
  pairs.forEach(pair => {
    const key = `${String(pair.x)}|${String(pair.y)}`;
    combinations[key] = (combinations[key] || 0) + 1;
  });

  // Group by field1, count field2 options
  const groups = {};
  pairs.forEach(pair => {
    const category1 = String(pair.x);
    const category2 = String(pair.y);

    if (!groups[category1]) {
      groups[category1] = {};
    }
    groups[category1][category2] = (groups[category1][category2] || 0) + 1;
  });

  // Calculate percentages
  const chartData = [];
  Object.keys(groups).forEach(category1 => {
    const total = Object.values(groups[category1]).reduce((a, b) => a + b, 0);
    Object.keys(groups[category1]).forEach(category2 => {
      const count = groups[category1][category2];
      chartData.push({
        x: category1,
        y: category2,
        count,
        percentage: Math.round((count / total) * 100)
      });
    });
  });

  // Find most common pattern
  const category1Values = Object.keys(groups);
  if (category1Values.length === 0) {
    return {
      question: `How do ${field1.label || 'groups'} differ in ${field2.label || 'preferences'}?`,
      answer: 'Not enough data to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'bars',
      strength: 'no clear pattern'
    };
  }

  // Find which category1 has the highest percentage for each category2
  const preferences = {};
  category1Values.forEach(cat1 => {
    const total = Object.values(groups[cat1]).reduce((a, b) => a + b, 0);
    let maxPercent = 0;
    let maxCat2 = null;
    Object.keys(groups[cat1]).forEach(cat2 => {
      const percent = (groups[cat1][cat2] / total) * 100;
      if (percent > maxPercent) {
        maxPercent = percent;
        maxCat2 = cat2;
      }
    });
    preferences[cat1] = { option: maxCat2, percent: maxPercent };
  });

  // Build answer with precise language
  const answerParts = Object.keys(preferences).map(cat1 => {
    const pref = preferences[cat1];
    return `Among ${cat1}, ${Math.round(pref.percent)}% prefer ${pref.option}`;
  });

  // Find most common preference overall
  const allPreferences = {};
  category1Values.forEach(cat1 => {
    const prefOption = preferences[cat1].option;
    allPreferences[prefOption] = (allPreferences[prefOption] || 0) + 1;
  });
  const mostCommonPref = Object.keys(allPreferences).reduce((a, b) => 
    allPreferences[a] > allPreferences[b] ? a : b
  );

  return {
    question: `How do ${field1.label || 'groups'} differ in ${field2.label || 'preferences'}?`,
    answer: answerParts.join(', '),
    bigNumber: {
      value: `Most prefer ${mostCommonPref}`,
      comparison: `Among ${category1Values[0]}: ${Math.round(preferences[category1Values[0]].percent)}%`
    },
    chartData,
    chartType: 'bars',
    strength: 'some pattern'
  };
}

/**
 * Analyze date field (e.g., Rating over Time)
 */
function analyzeDateField(pairs, field1, field2, dateField) {
  // Parse dates and group by time period
  const dateGroups = {};
  const otherField = dateField.id === field1.id ? field2 : field1;

  pairs.forEach(pair => {
    const dateStr = dateField.id === field1.id ? pair.x : pair.y;
    const value = dateField.id === field1.id ? pair.y : pair.x;

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;

      // Group by week
      const weekKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
      if (!dateGroups[weekKey]) {
        dateGroups[weekKey] = { sum: 0, count: 0, values: [] };
      }

      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        dateGroups[weekKey].sum += numValue;
        dateGroups[weekKey].count += 1;
        dateGroups[weekKey].values.push(numValue);
      }
    } catch (e) {
      // Skip invalid dates
    }
  });

  const weeks = Object.keys(dateGroups).sort();
  if (weeks.length < 2) {
    return {
      question: `Are ${otherField.label || 'ratings'} improving over time?`,
      answer: 'Not enough time periods to analyze',
      bigNumber: null,
      chartData: [],
      chartType: 'line',
      strength: 'no clear pattern'
    };
  }

  const chartData = weeks.map(week => {
    const group = dateGroups[week];
    const avg = group.sum / group.count;
    return {
      x: week,
      y: avg,
      label: `${avg.toFixed(1)}`
    };
  });

  // Define "Recent" as last 7-14 data points (never exposed to user)
  // Use min 7 or max 14, depending on available data
  const recentCount = Math.min(14, Math.max(7, Math.floor(weeks.length / 2)));
  const recentWeeks = weeks.slice(-recentCount);
  const earlierWeeks = weeks.slice(0, -recentCount);

  // Calculate recent vs earlier averages
  const recentAvg = recentWeeks.reduce((sum, w) => sum + (dateGroups[w].sum / dateGroups[w].count), 0) / recentWeeks.length;
  const earlierAvg = earlierWeeks.reduce((sum, w) => sum + (dateGroups[w].sum / dateGroups[w].count), 0) / earlierWeeks.length;

  const change = ((recentAvg - earlierAvg) / earlierAvg) * 100;
  let answer;
  let strength;
  let direction;
  
  if (Math.abs(change) < 5) {
    answer = `Stable - ${otherField.label || 'ratings'} stayed around ${earlierAvg.toFixed(1)}`;
    strength = 'no clear pattern';
    direction = null;
  } else if (change > 0) {
    answer = `Yes! ${otherField.label || 'Ratings'} improved by ${Math.round(change)}% (${earlierAvg.toFixed(1)} to ${recentAvg.toFixed(1)})`;
    strength = Math.abs(change) > 20 ? 'strong pattern' : 'some pattern';
    direction = `up from ${earlierAvg.toFixed(1)}`;
  } else {
    answer = `${otherField.label || 'Ratings'} decreased by ${Math.round(Math.abs(change))}% (${earlierAvg.toFixed(1)} to ${recentAvg.toFixed(1)})`;
    strength = Math.abs(change) > 20 ? 'strong pattern' : 'some pattern';
    direction = `down from ${earlierAvg.toFixed(1)}`;
  }

  return {
    question: `Are ${otherField.label || 'ratings'} improving over time?`,
    answer,
    bigNumber: {
      value: `Recent Avg: ${recentAvg.toFixed(1)}`,
      comparison: direction
    },
    chartData,
    chartType: 'line',
    strength
  };
}

/**
 * Get ISO week number
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Check if data has meaningful variation (not flat)
 * @param {Array} pairs - Array of {x, y} pairs
 * @param {string} type1 - Type of field1
 * @param {string} type2 - Type of field2
 * @returns {boolean} True if data is flat (no variation)
 */
function isFlat(pairs, type1, type2) {
  if (pairs.length < 2) return true;

  // For numeric Y values
  if (type2 === 'number' || type1 === 'number') {
    const yValues = pairs.map(p => parseFloat(type2 === 'number' ? p.y : p.x)).filter(v => !isNaN(v));
    if (yValues.length < 2) return true;
    
    // Check if all values are the same or very close (within 5% range)
    const min = Math.min(...yValues);
    const max = Math.max(...yValues);
    const range = max - min;
    const avg = yValues.reduce((a, b) => a + b, 0) / yValues.length;
    
    return range / Math.max(Math.abs(avg), 1) < 0.05; // Less than 5% variation
  }

  // For categorical data
  if (type1 === 'category' && type2 === 'category') {
    // Check if >90% of responses are in one category combination
    const combinations = {};
    pairs.forEach(p => {
      const key = `${p.x}|${p.y}`;
      combinations[key] = (combinations[key] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(combinations));
    return maxCount / pairs.length > 0.9;
  }

  return false;
}

/**
 * Check if a comparison should be auto-surfaced
 * @param {Object} field1 - First field
 * @param {Object} field2 - Second field
 * @param {Array} submissions - Submission data
 * @param {Array} pairs - Extracted data pairs
 * @returns {boolean} True if comparison should be shown
 */
function shouldSurfaceComparison(field1, field2, submissions, pairs) {
  // Criterion 1: Minimum response count (≥10)
  if (pairs.length < 10) {
    return false;
  }

  // Criterion 2: Variation exists (not flat data)
  const type1 = getFieldType(field1);
  const type2 = getFieldType(field2);
  if (isFlat(pairs, type1, type2)) {
    return false;
  }

  // Criterion 3: Insight confidence threshold
  const analysis = calculateCrossFieldAnalysis(submissions, field1, field2);
  if (analysis.strength === 'no clear pattern') {
    return false;
  }

  return true;
}

/**
 * Auto-detect suitable field pairs for default comparisons
 * @param {Array} fields - Array of form field objects
 * @param {Array} submissions - Array of submission objects
 * @returns {Array} Array of { field1, field2, comparisonId, question } objects
 */
function detectDefaultComparisons(fields, submissions) {
  const comparisons = [];
  
  // Filter to analyzable fields
  const analyzableFields = fields.filter(field => {
    if (!field.id) return false;
    const type = getFieldType(field);
    return type !== null && type !== undefined;
  });

  console.log(`🔍 detectDefaultComparisons: ${fields.length} total fields, ${analyzableFields.length} analyzable fields`);
  if (analyzableFields.length > 0) {
    console.log(`🔍 Analyzable fields:`, analyzableFields.map(f => ({ id: f.id, label: f.label, type: f.type, detectedType: getFieldType(f) })));
  }

  if (analyzableFields.length < 2) {
    console.log(`⚠️ Not enough analyzable fields (need 2, have ${analyzableFields.length})`);
    return [];
  }

  // Sort fields by popularity (most answered first)
  const fieldsWithResponseCount = analyzableFields.map(field => {
    const responseCount = submissions.filter(s => {
      const data = s.submission_data || {};
      const val = data[field.id];
      return val !== undefined && val !== null && val !== '';
    }).length;
    return { ...field, responseCount };
  });

  fieldsWithResponseCount.sort((a, b) => b.responseCount - a.responseCount);
  
  // Use all fields sorted by popularity (no minimum threshold)
  const popularFields = fieldsWithResponseCount;

  // Priority 1: Number vs Number (e.g., Age vs Rating) - Use most popular fields
  const numberFields = popularFields.filter(f => getFieldType(f) === 'number');
  console.log(`🔍 Number fields found: ${numberFields.length}`, numberFields.map(f => f.label));
  if (numberFields.length >= 2) {
    // Extract pairs for quality check
    const pairs = [];
    for (const submission of submissions) {
      const data = submission.submission_data || {};
      const val1 = data[numberFields[0].id];
      const val2 = data[numberFields[1].id];
      if (val1 !== undefined && val1 !== null && val1 !== '' &&
          val2 !== undefined && val2 !== null && val2 !== '') {
        pairs.push({ x: val1, y: val2 });
      }
    }
    
    // Apply quality filter
    if (shouldSurfaceComparison(numberFields[0], numberFields[1], submissions, pairs)) {
      comparisons.push({
        field1: numberFields[0],
        field2: numberFields[1],
        comparisonId: `default_${numberFields[0].id}_${numberFields[1].id}`,
        question: `Do different ${numberFields[0].label || 'values'} give different ${numberFields[1].label || 'ratings'}?`
      });
    }
  }

  // Priority 2: Category vs Number (e.g., Gender vs Rating) - Create multiple comparisons
  const categoryFields = popularFields.filter(f => getFieldType(f) === 'category');
  console.log(`🔍 Category fields found: ${categoryFields.length}`, categoryFields.map(f => f.label));
  if (categoryFields.length > 0 && numberFields.length > 0) {
    // Create comparison for each category field with the most popular number field
    categoryFields.slice(0, 3).forEach(categoryField => {
      // Extract pairs for quality check
      const pairs = [];
      for (const submission of submissions) {
        const data = submission.submission_data || {};
        const val1 = data[categoryField.id];
        const val2 = data[numberFields[0].id];
        if (val1 !== undefined && val1 !== null && val1 !== '' &&
            val2 !== undefined && val2 !== null && val2 !== '') {
          pairs.push({ x: val1, y: val2 });
        }
      }
      
      // Apply quality filter
      if (shouldSurfaceComparison(categoryField, numberFields[0], submissions, pairs)) {
        comparisons.push({
          field1: categoryField,
          field2: numberFields[0],
          comparisonId: `default_${categoryField.id}_${numberFields[0].id}`,
          question: `Which ${categoryField.label || 'groups'} have higher ${numberFields[0].label || 'ratings'}?`
        });
      }
    });
  }

  // Priority 3: Date vs Number (e.g., Rating over Time) - Use most popular fields
  const dateFields = popularFields.filter(f => getFieldType(f) === 'date');
  console.log(`🔍 Date fields found: ${dateFields.length}`, dateFields.map(f => f.label));
  if (dateFields.length > 0 && numberFields.length > 0) {
    // Extract pairs for quality check
    const pairs = [];
    for (const submission of submissions) {
      const data = submission.submission_data || {};
      const val1 = data[dateFields[0].id];
      const val2 = data[numberFields[0].id];
      if (val1 !== undefined && val1 !== null && val1 !== '' &&
          val2 !== undefined && val2 !== null && val2 !== '') {
        pairs.push({ x: val1, y: val2 });
      }
    }
    
    // Apply quality filter
    if (shouldSurfaceComparison(dateFields[0], numberFields[0], submissions, pairs)) {
      comparisons.push({
        field1: dateFields[0],
        field2: numberFields[0],
        comparisonId: `default_${dateFields[0].id}_${numberFields[0].id}`,
        question: `Are ${numberFields[0].label || 'ratings'} improving over time?`
      });
    }
  }

  // Priority 4: Category vs Category (e.g., Movie Length vs Gender) - if we have multiple categories
  if (categoryFields.length >= 2) {
    // Extract pairs for quality check
    const pairs = [];
    for (const submission of submissions) {
      const data = submission.submission_data || {};
      const val1 = data[categoryFields[0].id];
      const val2 = data[categoryFields[1].id];
      if (val1 !== undefined && val1 !== null && val1 !== '' &&
          val2 !== undefined && val2 !== null && val2 !== '') {
        pairs.push({ x: val1, y: val2 });
      }
    }
    
    // Apply quality filter
    if (shouldSurfaceComparison(categoryFields[0], categoryFields[1], submissions, pairs)) {
      // Create comparison between top 2 category fields
      comparisons.push({
        field1: categoryFields[0],
        field2: categoryFields[1],
        comparisonId: `default_${categoryFields[0].id}_${categoryFields[1].id}`,
        question: `How do ${categoryFields[0].label || 'groups'} differ in ${categoryFields[1].label || 'preferences'}?`
      });
    }
  }

  // Remove duplicates (in case same comparison was added multiple ways)
  const uniqueComparisons = [];
  const seenIds = new Set();
  for (const comp of comparisons) {
    if (!seenIds.has(comp.comparisonId)) {
      seenIds.add(comp.comparisonId);
      uniqueComparisons.push(comp);
    }
  }

  console.log(`✅ detectDefaultComparisons: Found ${uniqueComparisons.length} unique comparisons`);
  // Limit to 5 total
  return uniqueComparisons.slice(0, 5);
}

module.exports = {
  calculateCrossFieldAnalysis,
  detectDefaultComparisons
};
