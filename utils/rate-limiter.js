const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Rate limit window constant (1 hour)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Rate limiter for anonymous form creation
 * Limits: 2 forms per hour per IP address (configurable via env)
 * Purpose: Prevent DoS attacks via anonymous form creation
 */
const anonymousFormLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_ANONYMOUS_FORMS) || 2, // Default: 2 forms per hour per IP
  message: {
    success: false,
    error: 'Too many anonymous form creation attempts. Please sign up to create unlimited forms.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 3600 // seconds
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for OPTIONS preflight requests (CORS)
    if (req.method === 'OPTIONS') {
      return true;
    }
    
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
    // Use IP address for rate limiting with IPv6-safe key generation
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ipKeyGenerator(ip);
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

/**
 * Rate limiter for anonymous auto-save
 * Limits: 50 updates per hour per IP address (configurable via env)
 * Purpose: Prevent abuse of auto-save functionality
 */
const anonymousAutoSaveLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_ANONYMOUS_AUTO_SAVE) || 50, // Default: 50 updates per hour per IP
  message: {
    success: false,
    error: 'Too many auto-save attempts. Please sign up for unlimited auto-save.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for OPTIONS preflight requests (CORS)
    if (req.method === 'OPTIONS') {
      return true;
    }
    
    // Skip rate limiting if user is authenticated (they have unlimited auto-save)
    const authHeader = req.get('authorization') || req.get('Authorization');
    const hasAuthHeader = authHeader && typeof authHeader === 'string' && authHeader.trim().startsWith('Bearer ');
    const hasUser = !!req.user && (req.user.userId || req.user.id);
    
    const shouldSkip = hasUser || hasAuthHeader;
    
    if (shouldSkip) {
      console.log(`✅ Auto-save rate limiter: Skipping for authenticated user (IP: ${req.ip || 'unknown'})`);
    }
    
    return shouldSkip;
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ipKeyGenerator(ip);
  },
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for anonymous auto-save - IP: ${req.ip || 'unknown'}`);
    res.status(429).json({
      success: false,
      error: 'Too many auto-save attempts. Please sign up for unlimited auto-save.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 3600
    });
  }
});

/**
 * Rate limiter for form submissions
 * Limits: 50 submissions per hour per IP address (configurable via env)
 * Purpose: Prevent spam and abuse of form submission endpoints
 * Note: Applies to all users (authenticated and anonymous)
 */
const formSubmissionLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_FORM_SUBMISSIONS) || 50, // Default: 50 submissions per hour per IP
  message: {
    success: false,
    error: 'Too many form submissions. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for OPTIONS preflight requests (CORS)
    if (req.method === 'OPTIONS') {
      return true;
    }
    // Note: This limiter applies to all users, so we don't skip authenticated users
    return false;
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ipKeyGenerator(ip);
  },
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for form submissions - IP: ${req.ip || 'unknown'}`);
    res.status(429).json({
      success: false,
      error: 'Too many form submissions. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 3600
    });
  }
});

module.exports = {
  anonymousFormLimiter,
  anonymousAutoSaveLimiter,
  formSubmissionLimiter,
  RATE_LIMIT_WINDOW_MS
};

