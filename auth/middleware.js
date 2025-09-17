const { verifyToken } = require('./utils')

/**
 * Authentication middleware - verifies JWT token
 */
const authenticateToken = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

    console.log('🔍 Auth middleware - authHeader:', authHeader ? `${authHeader.substring(0, 30)}...` : 'null')
    console.log('🔍 Auth middleware - token:', token ? `${token.substring(0, 20)}...` : 'null')
    console.log('🔍 Auth middleware - endpoint:', req.path)

    if (!token) {
      console.log('❌ No token provided')
      return res.status(401).json({
        success: false,
        error: 'Access token required'
      })
    }

    // Verify token
    const decoded = verifyToken(token)
    console.log('✅ Token verified successfully for user:', decoded.userId)
    req.user = decoded
    next()
  } catch (error) {
    console.error('❌ Authentication error:', error)
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired token'
    })
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (token) {
      const decoded = verifyToken(token)
      req.user = decoded
    }
    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}

/**
 * Rate limiting middleware for authentication endpoints
 */
const createRateLimiter = (windowMs, max, message) => {
  const rateLimit = require('express-rate-limit')
  
  return rateLimit({
    windowMs: windowMs,
    max: max,
    message: {
      success: false,
      error: message || 'Too many requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
  })
}

/**
 * Rate limiters for different endpoints
 */
const authRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts, please try again in 15 minutes'
)

const signupRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  5, // 5 signup attempts
  'Too many signup attempts, please try again in 1 hour'
)

const passwordResetRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 password reset attempts
  'Too many password reset attempts, please try again in 1 hour'
)

/**
 * Check if user is authenticated
 */
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    })
  }
  next()
}

/**
 * Check if user is anonymous (for form creation limits)
 */
const checkAnonymousLimits = (req, res, next) => {
  // If user is authenticated, no limits
  if (req.user) {
    return next()
  }

  // For anonymous users, check session-based limits
  const sessionId = req.headers['x-session-id'] || req.ip
  const anonymousKey = `anonymous_forms:${sessionId}`
  
  // This will be implemented with Redis or similar
  // For now, we'll allow anonymous users to proceed
  // TODO: Implement proper anonymous user tracking
  next()
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAuth,
  authRateLimiter,
  signupRateLimiter,
  passwordResetRateLimiter,
  checkAnonymousLimits
}
