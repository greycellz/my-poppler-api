const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for anonymous form creation
 * Limits: 5 forms per hour per IP address
 * Purpose: Prevent DoS attacks via anonymous form creation
 */
const anonymousFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 forms per hour per IP
  message: {
    success: false,
    error: 'Too many anonymous form creation attempts. Please sign up to create unlimited forms.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 3600 // seconds
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting if user is authenticated (they have unlimited forms)
    // Check Authorization header (rate limiter runs before optionalAuth middleware sets req.user)
    // Use req.get() which handles header normalization correctly
    const authHeader = req.get('authorization') || req.get('Authorization');
    const hasAuthHeader = authHeader && typeof authHeader === 'string' && authHeader.trim().startsWith('Bearer ');
    
    // Also check req.user if it's already set (from previous middleware)
    const hasUser = !!req.user && (req.user.userId || req.user.id);
    
    const shouldSkip = hasUser || hasAuthHeader;
    
    // Debug logging to verify skip function behavior
    if (shouldSkip) {
      console.log(`✅ Rate limiter: Skipping for authenticated user (hasAuthHeader: ${hasAuthHeader}, hasUser: ${hasUser}, IP: ${req.ip || 'unknown'})`);
    } else {
      // Only log when NOT skipping to reduce noise
      console.log(`⚠️ Rate limiter: Applying limit (authHeader: ${authHeader ? 'present' : 'missing'}, hasUser: ${hasUser}, IP: ${req.ip || 'unknown'})`);
    }
    
    return shouldSkip; // Skip if authenticated via either method
  },
  keyGenerator: (req) => {
    // Use IP address for rate limiting
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for anonymous form creation - IP: ${req.ip || 'unknown'}`);
    res.status(429).json({
      success: false,
      error: 'Too many anonymous form creation attempts. Please sign up to create unlimited forms.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 3600
    });
  }
});

module.exports = {
  anonymousFormLimiter
};

