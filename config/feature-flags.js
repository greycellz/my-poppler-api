/**
 * Feature flags for security fixes
 * Allows gradual rollout and instant rollback without code changes
 */
module.exports = {
  // File upload authentication
  ENABLE_FILE_UPLOAD_AUTH: process.env.ENABLE_FILE_UPLOAD_AUTH === 'true',
  
  // Form ownership verification
  ENABLE_FORM_OWNERSHIP_CHECK: process.env.ENABLE_FORM_OWNERSHIP_CHECK === 'true',
  
  // Submission authentication
  ENABLE_SUBMISSION_AUTH: process.env.ENABLE_SUBMISSION_AUTH === 'true',
  
  // CORS strict mode (whitelist only)
  ENABLE_STRICT_CORS: process.env.ENABLE_STRICT_CORS === 'true',
  
  // Rate limiting
  ENABLE_RATE_LIMITING: process.env.ENABLE_RATE_LIMITING === 'true',
  
  // Logging
  LOG_AUTH_ATTEMPTS: process.env.LOG_AUTH_ATTEMPTS === 'true',
  LOG_AUTHZ_FAILURES: process.env.LOG_AUTHZ_FAILURES === 'true',
  
  // Debug endpoints (disable in production)
  DISABLE_DEBUG_ENDPOINTS: process.env.DISABLE_DEBUG_ENDPOINTS === 'true',
};

