const express = require('express')
const { body } = require('express-validator')
const { authenticateToken, authRateLimiter, signupRateLimiter, passwordResetRateLimiter, resendVerificationRateLimiter } = require('./middleware')
const { validateRequest } = require('./utils')
const userManager = require('./userManager')

const router = express.Router()

/**
 * POST /auth/signup
 * Create a new user account
 */
router.post('/signup', 
  signupRateLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('firstName')
      .trim()
      .isLength({ min: 1, max: 30 })
      .withMessage('First name must be between 1 and 30 characters'),
    body('lastName')
      .trim()
      .isLength({ min: 1, max: 30 })
      .withMessage('Last name must be between 1 and 30 characters')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body

      const result = await userManager.createUser(email, password, firstName, lastName)

      res.status(201).json({
        success: true,
        message: 'Account created successfully. Please check your email to verify your account.',
        data: {
          user: {
            id: result.userId,
            email: result.email,
            firstName: result.firstName,
            lastName: result.lastName,
            name: result.name,
            emailVerified: false,
            plan: 'free',
            status: 'pending'
          },
          token: result.token
        }
      })
    } catch (error) {
      console.error('Signup error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post('/login',
  authRateLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { email, password } = req.body

      const result = await userManager.authenticateUser(email, password)

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: result.user,
          token: result.token
        }
      })
    } catch (error) {
      console.error('Login error:', error)
      res.status(401).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/verify-email
 * Verify email with token
 */
router.post('/verify-email',
  [
    body('token')
      .notEmpty()
      .withMessage('Verification token is required')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { token } = req.body

      const result = await userManager.verifyEmail(token)

      res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
          userId: result.userId,
          email: result.email
        }
      })
    } catch (error) {
      console.error('Email verification error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/resend-verification
 * Resend verification email
 */
router.post('/resend-verification',
  resendVerificationRateLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { email } = req.body

      const result = await userManager.resendVerificationEmail(email)

      res.json({
        success: true,
        message: result.message
      })
    } catch (error) {
      console.error('Resend verification error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/request-reset
 * Request password reset
 */
router.post('/request-reset',
  passwordResetRateLimiter,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { email } = req.body

      const result = await userManager.requestPasswordReset(email)

      res.json({
        success: true,
        message: result.message
      })
    } catch (error) {
      console.error('Password reset request error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/reset-password
 * Reset password with token
 */
router.post('/reset-password',
  [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { token, password } = req.body

      const result = await userManager.resetPassword(token, password)

      res.json({
        success: true,
        message: 'Password reset successfully',
        data: {
          userId: result.userId
        }
      })
    } catch (error) {
      console.error('Password reset error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * POST /auth/migrate-forms
 * Migrate anonymous forms to user account
 */
router.post('/migrate-forms',
  [
    body('anonymousSessionId')
      .notEmpty()
      .withMessage('Anonymous session ID is required')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { anonymousSessionId } = req.body
      const userId = req.user?.userId

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        })
      }

      const result = await userManager.migrateAnonymousForms(userId, anonymousSessionId)

      res.json({
        success: true,
        message: 'Forms migrated successfully',
        data: {
          migratedForms: result.migratedForms,
          totalForms: result.totalForms
        }
      })
    } catch (error) {
      console.error('Form migration error:', error)
      res.status(400).json({
        success: false,
        error: error.message
      })
    }
  }
)

/**
 * GET /auth/session
 * Get current user session
 */
router.get('/session', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'No active session'
      })
    }

    const user = await userManager.getUserById(userId)
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      })
    }

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

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          plan: user.plan,
          status: user.status,
          createdAt: convertTimestamp(user.createdAt),
          lastLoginAt: convertTimestamp(user.lastLoginAt)
        }
      }
    })
  } catch (error) {
    console.error('Session check error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to check session'
    })
  }
})

module.exports = router
