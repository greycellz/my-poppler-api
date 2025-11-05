const { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  generateRandomToken,
  isValidEmail,
  validatePasswordStrength 
} = require('./utils')
const validator = require('validator')

// Import GCP client (we'll use the existing one)
const GCPClient = require('../gcp-client')
const gcpClient = new GCPClient()

/**
 * Normalize email for duplicate checking and lookups
 * Uses standard validator library (same as express-validator uses internally)
 * For Gmail: removes dots, removes +aliases, handles @googlemail.com
 * For other providers: applies provider-specific normalization
 * This prevents abuse by creating multiple accounts with the same underlying email
 */
const normalizeEmailForLookup = (email) => {
  const trimmedEmail = email.toLowerCase().trim()
  
  // Use validator.normalizeEmail() - standard library normalization
  // This handles Gmail, Outlook, Yahoo, iCloud, and other providers
  const normalized = validator.normalizeEmail(trimmedEmail, {
    gmail_lowercase: true,
    gmail_remove_dots: true,
    gmail_remove_subaddress: true,
    outlookdotcom_lowercase: true,
    yahoo_lowercase: true,
    icloud_lowercase: true
  })
  
  // validator.normalizeEmail() returns false for invalid emails, so fallback to lowercase
  return normalized || trimmedEmail
}

/**
 * Create a new user
 */
const createUser = async (email, password, firstName, lastName) => {
  try {
    // Validate input
    if (!isValidEmail(email)) {
      throw new Error('Invalid email format')
    }

    const passwordValidation = validatePasswordStrength(password)
    if (!passwordValidation.isValid) {
      throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`)
    }

    // Check if user already exists using normalized email (prevents Gmail abuse)
    const normalizedEmail = normalizeEmailForLookup(email)
    const existingUser = await getUserByEmail(normalizedEmail, true) // true = use normalized lookup
    if (existingUser) {
      throw new Error('User with this email already exists')
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user document
    // Store exact email (for display) and normalized email (for duplicate checking)
    const userData = {
      email: email.toLowerCase().trim(), // Store exact email (lowercased) for display
      normalizedEmail: normalizeEmailForLookup(email), // Store normalized for duplicate checking
      passwordHash,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`, // Keep name for backward compatibility
      emailVerified: false,
      createdAt: new Date(),
      lastLoginAt: null,
      status: 'pending',
      plan: 'free',
      anonymousFormsMigrated: false
    }

    // Store in Firestore
    const userId = await gcpClient.createUser(userData)

    // Generate verification token
    const verificationToken = generateRandomToken(32)
    await gcpClient.storeEmailVerificationToken(userId, email, verificationToken)

    // Send verification email (fail-soft - don't block signup if email fails)
    const emailService = require('../email-service')
    try {
      const emailResult = await emailService.sendVerificationEmail(email, verificationToken)
      if (!emailResult.success && !emailResult.skipped) {
        console.error('Failed to send verification email:', emailResult.error)
        // Don't fail the request if email fails - token is still stored
        // User can still use the verification token if they request a resend
      }
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError)
      // Don't fail the request if email fails - token is still stored
      // User can still use the verification token if they request a resend
    }

    // Generate JWT token for immediate login (needed for form migration)
    const token = generateToken(userId, email)

    return {
      success: true,
      userId,
      email,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      verificationToken,
      token
    }
  } catch (error) {
    console.error('User creation error:', error)
    throw error
  }
}

/**
 * Authenticate user login
 */
const authenticateUser = async (email, password) => {
  try {
    // Get user by email
    const user = await getUserByEmail(email)
    if (!user) {
      throw new Error('Invalid email or password')
    }

    // Check if user is active
    if (user.status !== 'active' && user.status !== 'pending') {
      throw new Error('Account is suspended')
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Invalid email or password')
    }

    // Update last login
    await gcpClient.updateUserLastLogin(user.id)

    // Generate JWT token
    const token = generateToken(user.id, user.email)

    // Helper to convert Firestore Timestamp to ISO string
    const convertTimestamp = (timestamp) => {
      if (!timestamp) return null
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toISOString()
      }
      if (timestamp instanceof Date) {
        return timestamp.toISOString()
      }
      if (typeof timestamp === 'string') {
        return timestamp
      }
      return null
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        emailVerified: user.emailVerified,
        plan: user.plan,
        status: user.status,
        createdAt: convertTimestamp(user.createdAt),
        lastLoginAt: convertTimestamp(user.lastLoginAt)
      },
      token
    }
  } catch (error) {
    console.error('Authentication error:', error)
    throw error
  }
}

/**
 * Get user by email
 * @param {string} email - Email address
 * @param {boolean} useNormalized - If true, query by normalizedEmail field (for duplicate checks)
 */
const getUserByEmail = async (email, useNormalized = false) => {
  try {
    const lookupEmail = useNormalized ? normalizeEmailForLookup(email) : email.toLowerCase().trim()
    return await gcpClient.getUserByEmail(lookupEmail, useNormalized)
  } catch (error) {
    console.error('Get user by email error:', error)
    return null
  }
}

/**
 * Get user by ID
 */
const getUserById = async (userId) => {
  try {
    return await gcpClient.getUserById(userId)
  } catch (error) {
    console.error('Get user by ID error:', error)
    return null
  }
}

/**
 * Verify email with token
 */
const verifyEmail = async (token) => {
  try {
    const verification = await gcpClient.getEmailVerificationByToken(token)
    if (!verification) {
      throw new Error('Invalid or expired verification token')
    }

    // Check if token is expired (24 hours)
    const tokenAge = Date.now() - verification.createdAt.toMillis()
    if (tokenAge > 24 * 60 * 60 * 1000) {
      throw new Error('Verification token has expired')
    }

    // Update user email verification status
    await gcpClient.updateUserEmailVerification(verification.userId, true)
    
    // Delete the verification token
    await gcpClient.deleteEmailVerificationToken(token)

    return {
      success: true,
      userId: verification.userId,
      email: verification.email
    }
  } catch (error) {
    console.error('Email verification error:', error)
    throw error
  }
}

/**
 * Request password reset
 */
const requestPasswordReset = async (email) => {
  try {
    const user = await getUserByEmail(email)
    if (!user) {
      // Don't reveal if user exists or not
      return { success: true, message: 'If the email exists, a reset link has been sent' }
    }

    // Generate reset token
    const resetToken = generateRandomToken(32)
    await gcpClient.storePasswordResetToken(user.id, email, resetToken)

    // Send password reset email
    const emailService = require('../email-service')
    try {
      await emailService.sendPasswordResetEmail(email, resetToken)
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError)
      // Don't fail the request if email fails - token is still stored
      // User can still use the reset token if they have it
    }

    return {
      success: true,
      message: 'If the email exists, a reset link has been sent'
    }
  } catch (error) {
    console.error('Password reset request error:', error)
    throw error
  }
}

/**
 * Resend verification email
 */
const resendVerificationEmail = async (email) => {
  try {
    const user = await getUserByEmail(email)
    if (!user) {
      // Don't reveal if user exists or not
      return { success: true, message: 'If the email exists and is unverified, a verification link has been sent' }
    }

    // Check if already verified
    if (user.emailVerified) {
      return { success: true, message: 'Email is already verified' }
    }

    // Generate new verification token
    const verificationToken = generateRandomToken(32)
    await gcpClient.storeEmailVerificationToken(user.id, email, verificationToken)

    // Send verification email
    const emailService = require('../email-service')
    try {
      const emailResult = await emailService.sendVerificationEmail(email, verificationToken)
      if (!emailResult.success && !emailResult.skipped) {
        console.error('Failed to send verification email:', emailResult.error)
        // Don't fail the request if email fails - token is still stored
      }
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError)
      // Don't fail the request if email fails - token is still stored
    }

    return {
      success: true,
      message: 'If the email exists and is unverified, a verification link has been sent'
    }
  } catch (error) {
    console.error('Resend verification email error:', error)
    throw error
  }
}

/**
 * Reset password with token
 */
const resetPassword = async (token, newPassword) => {
  try {
    const resetData = await gcpClient.getPasswordResetByToken(token)
    if (!resetData) {
      throw new Error('Invalid or expired reset token')
    }

    // Check if token is expired (1 hour)
    const tokenAge = Date.now() - resetData.createdAt.toMillis()
    if (tokenAge > 60 * 60 * 1000) {
      throw new Error('Reset token has expired')
    }

    // Validate new password
    const passwordValidation = validatePasswordStrength(newPassword)
    if (!passwordValidation.isValid) {
      throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`)
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword)

    // Update user password
    await gcpClient.updateUserPassword(resetData.userId, passwordHash)

    // Delete the reset token
    await gcpClient.deletePasswordResetToken(token)

    return {
      success: true,
      userId: resetData.userId
    }
  } catch (error) {
    console.error('Password reset error:', error)
    throw error
  }
}

/**
 * Migrate anonymous forms to user account
 */
const migrateAnonymousForms = async (userId, anonymousSessionId) => {
  try {
    const result = await gcpClient.migrateAnonymousForms(userId, anonymousSessionId)
    return {
      success: true,
      migratedForms: result.migratedForms,
      totalForms: result.totalForms
    }
  } catch (error) {
    console.error('Form migration error:', error)
    throw error
  }
}

module.exports = {
  createUser,
  authenticateUser,
  getUserByEmail,
  getUserById,
  verifyEmail,
  resendVerificationEmail,
  requestPasswordReset,
  resetPassword,
  migrateAnonymousForms
}
