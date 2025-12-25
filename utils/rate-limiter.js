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
    return !!req.user && (req.user.userId || req.user.id);
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

