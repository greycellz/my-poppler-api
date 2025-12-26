/**
 * Utility functions
 */

/**
 * Validate URL format and accessibility
 * @param {string} url - URL to validate
 * @returns {Object} Validation result with isValid, normalizedUrl, and error
 */
function validateUrl(url) {
  try {
    // Add protocol if missing
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`
    const urlObj = new URL(normalizedUrl)
    
    // Basic validation
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP and HTTPS URLs are supported' }
    }
    
    return { isValid: true, normalizedUrl }
  } catch {
    return { isValid: false, error: 'Invalid URL format' }
  }
}

module.exports = {
  validateUrl
}

