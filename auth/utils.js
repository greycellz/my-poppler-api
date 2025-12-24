const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { validationResult } = require('express-validator')

// Configuration
// ✅ CRITICAL: No fallback - fail fast if JWT_SECRET not set
const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = '7d'
const SALT_ROUNDS = 12

// ✅ Validate JWT_SECRET on startup
if (!JWT_SECRET) {
  console.error('');
  console.error('=====================================');
  console.error('❌ CRITICAL CONFIGURATION ERROR');
  console.error('=====================================');
  console.error('JWT_SECRET environment variable is not set!');
  console.error('');
  console.error('This is a critical security configuration.');
  console.error('The application cannot start without it.');
  console.error('');
  console.error('TO FIX:');
  console.error('1. Generate a secure secret:');
  console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('');
  console.error('2. Set in Railway:');
  console.error('   Dashboard → Settings → Variables → Add Variable');
  console.error('   Key: JWT_SECRET');
  console.error('   Value: <your_generated_secret>');
  console.error('');
  console.error('3. Redeploy the application');
  console.error('=====================================');
  console.error('');
  
  // Fail fast - don't start the application
  process.exit(1);
}

// Validate JWT_SECRET strength
if (JWT_SECRET.length < 32) {
  console.error('');
  console.error('=====================================');
  console.error('⚠️ WARNING: JWT_SECRET TOO SHORT');
  console.error('=====================================');
  console.error(`Current length: ${JWT_SECRET.length} characters`);
  console.error('Recommended: At least 32 characters (256 bits)');
  console.error('');
  console.error('Your JWT_SECRET is too weak and could be vulnerable to brute force attacks.');
  console.error('Please generate a stronger secret:');
  console.error('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('=====================================');
  console.error('');
  
  // Still start but log warning
  console.warn('⚠️ Application starting with weak JWT_SECRET - SECURITY RISK!');
}

// Log successful configuration (without revealing the secret)
console.log('✅ JWT_SECRET configured');
console.log(`✅ JWT_SECRET length: ${JWT_SECRET.length} characters`);
console.log(`✅ JWT token expiration: ${JWT_EXPIRES_IN}`);

/**
 * Hash a password using bcrypt
 */
const hashPassword = async (password) => {
  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS)
    return await bcrypt.hash(password, salt)
  } catch (error) {
    console.error('Password hashing error:', error)
    throw new Error('Failed to hash password')
  }
}

/**
 * Compare a password with its hash
 */
const comparePassword = async (password, hash) => {
  try {
    return await bcrypt.compare(password, hash)
  } catch (error) {
    console.error('Password comparison error:', error)
    throw new Error('Failed to compare password')
  }
}

/**
 * Generate JWT token for user
 */
const generateToken = (userId, email) => {
  try {
    // Additional runtime check
    if (!JWT_SECRET) {
      console.error('❌ CRITICAL: JWT_SECRET not available at runtime!');
      throw new Error('JWT_SECRET not configured - cannot generate token');
    }
    
    console.log('🔑 Generating token for user:', userId);
    
    const token = jwt.sign(
      { 
        userId, 
        email,
        iat: Math.floor(Date.now() / 1000)  // Issued at
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    
    console.log('✅ Token generated successfully');
    return token
  } catch (error) {
    console.error('❌ Token generation error:', error);
    
    // Provide helpful error message
    if (error.message.includes('secretOrPrivateKey')) {
      throw new Error('JWT_SECRET configuration error - cannot generate authentication token');
    }
    
    throw new Error('Failed to generate authentication token');
  }
}

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  try {
    // Additional runtime check
    if (!JWT_SECRET) {
      console.error('❌ CRITICAL: JWT_SECRET not available at runtime!');
      throw new Error('JWT_SECRET not configured - cannot verify token');
    }
    
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    console.error('Token verification error:', error.message);
    
    // Provide specific error messages
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired - please sign in again');
    }
    
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token - authentication failed');
    }
    
    if (error.message.includes('secretOrPublicKey')) {
      throw new Error('JWT_SECRET configuration error - cannot verify token');
    }
    
    throw new Error('Token verification failed');
  }
}

/**
 * Validate request using express-validator
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    })
  }
  next()
}

/**
 * Generate a random token for email verification/password reset
 */
const generateRandomToken = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate password strength
 */
const validatePasswordStrength = (password) => {
  const minLength = 8
  const hasUpperCase = /[A-Z]/.test(password)
  const hasLowerCase = /[a-z]/.test(password)
  const hasNumbers = /\d/.test(password)
  const hasSpecialChar = /[@$!%*?&#]/.test(password)

  const errors = []
  
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`)
  }
  if (!hasUpperCase) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (!hasLowerCase) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (!hasNumbers) {
    errors.push('Password must contain at least one number')
  }
  if (!hasSpecialChar) {
    errors.push('Password must contain at least one special character')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  validateRequest,
  generateRandomToken,
  isValidEmail,
  validatePasswordStrength,
  JWT_SECRET,
  JWT_EXPIRES_IN
}
