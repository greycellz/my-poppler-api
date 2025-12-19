/**
 * Field Semantic Type Detection
 * Maps form field types to semantic categories for automatic analytics selection
 */

/**
 * Detect semantic type for a form field
 * @param {Object} field - Form field object with type, label, options, etc.
 * @returns {string|null} - Semantic type or null if field should be skipped
 */
function detectSemanticType(field) {
  const { type, label, options } = field;
  const labelLower = (label || '').toLowerCase();
  
  // Skip fields that don't need analytics
  const SKIP_FIELD_TYPES = ['payment', 'calendly', 'image', 'signature', 'file', 'richtext'];
  if (SKIP_FIELD_TYPES.includes(type)) {
    return null; // Signal to skip this field
  }
  
  // Rating fields
  if (type === 'rating') {
    return 'opinion_score';
  }
  
  // Demographic indicators (improved keyword matching)
  if (type === 'select' || type === 'radio' || type === 'radio-with-other') {
    const demographicKeywords = [
      'gender', 'age', 'country', 'role', 'location', 'ethnicity', 
      'race', 'nationality', 'education', 'occupation', 'marital',
      'status', 'income', 'zip', 'postal', 'state', 'province',
      'city', 'region', 'language', 'religion'
    ];
    if (demographicKeywords.some(kw => labelLower.includes(kw))) {
      return 'demographic';
    }
    return 'preference';
  }
  
  // Consent/agreement (improved keyword matching)
  if (type === 'checkbox') {
    const consentKeywords = [
      'agree', 'consent', 'accept', 'terms', 'policy', 'acknowledge',
      'confirm', 'certify', 'authorize', 'permission'
    ];
    if (consentKeywords.some(kw => labelLower.includes(kw))) {
      return 'consent';
    }
    // Will be handled by analyzeCheckboxField to detect single vs multi-select
    return 'preference'; // Default for checkbox, actual handling in analyzer
  }
  
  // Text fields (improved keyword matching)
  if (type === 'text' || type === 'textarea' || type === 'email' || type === 'tel') {
    const feedbackKeywords = [
      'feedback', 'comment', 'suggestion', 'review', 'opinion', 
      'thought', 'note', 'remark', 'additional', 'other', 'anything',
      'else', 'message', 'description', 'details'
    ];
    if (feedbackKeywords.some(kw => labelLower.includes(kw))) {
      return 'free_feedback';
    }
    return 'identity';
  }
  
  // Number fields - could be demographic (age, income) or behavior (quantity)
  if (type === 'number') {
    const demographicNumberKeywords = ['age', 'income', 'salary', 'wage', 'price'];
    if (demographicNumberKeywords.some(kw => labelLower.includes(kw))) {
      return 'demographic';
    }
    return 'behavior';
  }
  
  // Date fields - typically behavior (appointment, event) or demographic (birthdate)
  if (type === 'date' || type === 'datetime') {
    const demographicDateKeywords = ['birth', 'born', 'dob', 'date of birth'];
    if (demographicDateKeywords.some(kw => labelLower.includes(kw))) {
      return 'demographic';
    }
    return 'behavior';
  }
  
  // Default
  return 'behavior';
}

/**
 * Check if a field should be skipped in analytics
 * @param {Object} field - Form field object
 * @returns {boolean} - True if field should be skipped
 */
function shouldSkipField(field) {
  const { type } = field;
  const SKIP_FIELD_TYPES = ['payment', 'calendly', 'image', 'signature', 'file', 'richtext'];
  return SKIP_FIELD_TYPES.includes(type);
}

module.exports = {
  detectSemanticType,
  shouldSkipField
};
