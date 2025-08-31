const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { validationResult } = require('express-validator')

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
const JWT_EXPIRES_IN = '7d'
const SALT_ROUNDS = 12

// Debug JWT_SECRET on startup
console.log('🔧 JWT_SECRET environment variable check:')
console.log('🔧 JWT_SECRET exists:', !!process.env.JWT_SECRET)
console.log('🔧 JWT_SECRET length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 'undefined')
console.log('🔧 Using fallback:', !process.env.JWT_SECRET)

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
    console.log('🔑 Generating token for user:', userId, email)
    console.log('🔑 JWT_SECRET length:', JWT_SECRET ? JWT_SECRET.length : 'undefined')
    
    const token = jwt.sign(
      { 
        userId, 
        email
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    
    console.log('✅ Token generated successfully, length:', token.length)
    return token
  } catch (error) {
    console.error('❌ Token generation error:', error)
    throw new Error('Failed to generate token')
  }
}

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    console.error('Token verification error:', error)
    throw new Error('Invalid token')
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
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password)

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
