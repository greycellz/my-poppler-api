const featureFlags = require('../config/feature-flags');

/**
 * Verify user has access to a form
 * @param {string} userId - User ID from JWT token
 * @param {string} formId - Form ID to check
 * @returns {Promise<{hasAccess: boolean, form: object|null, reason?: string}>}
 */
async function verifyFormAccess(userId, formId) {
  const GCPClient = require('../gcp-client');
  const gcpClient = new GCPClient();
  
  try {
    // Get form structure
    const form = await gcpClient.getFormStructure(formId, true);
    
    if (!form) {
      console.log(`⚠️ Form not found: ${formId}`);
      return { hasAccess: false, form: null, reason: 'form_not_found' };
    }
    
    // 🔍 INSPECT ACTUAL FORM STRUCTURE (follow repo rules)
    console.log('🔍 FORM DOC KEYS:', Object.keys(form));
    
    // Handle field name variations (user_id vs userId vs createdBy)
    const formOwnerId = form.user_id || form.userId || form.createdBy || form.owner_id;
    
    console.log(`🔍 DEBUG VERIFY_FORM_ACCESS:`, {
      formId,
      formOwnerId: formOwnerId || 'none',
      requestingUserId: userId || 'none',
      isAnonymous: form.isAnonymous || false,
      isPublished: form.is_published || form.isPublished || false,
      isTempOwner: formOwnerId && formOwnerId.startsWith('temp_'),
      isTempRequesting: userId && userId.startsWith('temp_'),
      ownerMatch: formOwnerId === userId
    });
    
    if (!formOwnerId) {
      console.warn(`⚠️ Form ${formId} has no owner field`);
      // For backward compatibility with old forms, allow access
      // TODO: Run migration to add user_id to all forms
      return { hasAccess: true, form, reason: 'legacy_form' };
    }
    
    console.log(`🔍 Form owner: ${formOwnerId}, Requesting user: ${userId}`);
    
    // Check ownership
    if (formOwnerId === userId) {
      console.log(`✅ User ${userId} owns form ${formId}`);
      return { hasAccess: true, form, reason: 'owner' };
    }
    
    // ✅ SPECIAL CASE: Allow authenticated users to update anonymous forms (for conversion)
    // This enables users to publish anonymous forms after signing up
    const isFormAnonymous = form.isAnonymous === true;
    const isOwnerAnonymous = formOwnerId && formOwnerId.startsWith('temp_');
    if (isFormAnonymous || isOwnerAnonymous) {
      // Form is anonymous - allow authenticated users to take ownership (conversion)
      if (userId && userId !== 'anonymous' && !userId.startsWith('temp_')) {
        console.log(`✅ Allowing authenticated user ${userId} to access anonymous form ${formId} (conversion)`);
        return { hasAccess: true, form, reason: 'anonymous_form_conversion' };
      }
    }
    
    // TODO: Check collaborators if feature exists
    // const isCollaborator = await checkCollaboratorAccess(formId, userId);
    // if (isCollaborator) {
    //   return { hasAccess: true, form, reason: 'collaborator' };
    // }
    
    console.log(`❌ User ${userId} does NOT have access to form ${formId}`);
    return { hasAccess: false, form: null, reason: 'not_owner' };
    
  } catch (error) {
    console.error('❌ Error verifying form access:', error);
    return { hasAccess: false, form: null, reason: 'error' };
  }
}

/**
 * Verify submission belongs to a form the user owns
 */
async function verifySubmissionAccess(userId, submissionId) {
  const GCPClient = require('../gcp-client');
  const gcpClient = new GCPClient();
  
  try {
    // Get submission to find formId
    const submission = await gcpClient.getSubmissionById(submissionId);
    
    if (!submission) {
      return { hasAccess: false, submission: null, reason: 'submission_not_found' };
    }
    
    // Get form_id from submission
    const formId = submission.form_id || submission.formId;
    
    if (!formId) {
      console.warn(`⚠️ Submission ${submissionId} has no form_id`);
      return { hasAccess: false, submission: null, reason: 'no_form_id' };
    }
    
    // Check form ownership
    const { hasAccess, reason } = await verifyFormAccess(userId, formId);
    
    return { 
      hasAccess, 
      submission: hasAccess ? submission : null,
      formId,
      reason 
    };
    
  } catch (error) {
    console.error('❌ Error verifying submission access:', error);
    return { hasAccess: false, submission: null, reason: 'error' };
  }
}

/**
 * Middleware: Require form ownership
 * Usage: app.get('/api/forms/:formId/submissions', authenticateToken, requireFormOwnership, handler)
 */
function requireFormOwnership(req, res, next) {
  // Check feature flag
  if (!featureFlags.ENABLE_FORM_OWNERSHIP_CHECK) {
    console.log('⚠️ Form ownership check disabled (feature flag)');
    return next();
  }
  
  const userId = req.user?.userId || req.user?.id;
  const formId = req.params.formId;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED'
    });
  }
  
  if (!formId) {
    return res.status(400).json({
      success: false,
      error: 'Form ID required',
      code: 'FORM_ID_MISSING'
    });
  }
  
  // Log authorization attempt
  if (featureFlags.LOG_AUTH_ATTEMPTS) {
    console.log(`🔐 Authorization check: user=${userId}, form=${formId}, endpoint=${req.path}`);
  }
  
  verifyFormAccess(userId, formId)
    .then(({ hasAccess, form, reason }) => {
      if (!hasAccess) {
        // Log authorization failure
        if (featureFlags.LOG_AUTHZ_FAILURES) {
          console.warn(`❌ Authorization denied: user=${userId}, form=${formId}, reason=${reason}`);
        }
        
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not have access to this form',
          code: 'ACCESS_DENIED',
          reason
        });
      }
      
      // Attach form to request for use in route handler
      req.form = form;
      req.accessReason = reason;
      
      console.log(`✅ Authorization granted: user=${userId}, form=${formId}, reason=${reason}`);
      next();
    })
    .catch(error => {
      console.error('❌ Authorization middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        code: 'AUTHORIZATION_ERROR'
      });
    });
}

/**
 * Middleware: Require submission ownership (via form ownership)
 */
function requireSubmissionOwnership(req, res, next) {
  const userId = req.user?.userId || req.user?.id;
  const submissionId = req.params.submissionId;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED'
    });
  }
  
  if (!submissionId) {
    return res.status(400).json({
      success: false,
      error: 'Submission ID required',
      code: 'SUBMISSION_ID_MISSING'
    });
  }
  
  verifySubmissionAccess(userId, submissionId)
    .then(({ hasAccess, submission, formId, reason }) => {
      if (!hasAccess) {
        if (featureFlags.LOG_AUTHZ_FAILURES) {
          console.warn(`❌ Submission access denied: user=${userId}, submission=${submissionId}, reason=${reason}`);
        }
        
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not have access to this submission',
          code: 'ACCESS_DENIED',
          reason
        });
      }
      
      // Attach to request
      req.submission = submission;
      req.formId = formId;
      
      next();
    })
    .catch(error => {
      console.error('❌ Submission authorization error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        code: 'AUTHORIZATION_ERROR'
      });
    });
}

/**
 * Middleware: Require form ownership (formId from request body)
 * Similar to requireFormOwnership but gets formId from req.body instead of req.params.
 * Used for endpoints like auto-save and upload-form-image.
 */
async function requireFormOwnershipFromBody(req, res, next) {
  // Check feature flag
  if (!featureFlags.ENABLE_FORM_OWNERSHIP_CHECK) {
    console.log('⚠️ Form ownership check disabled (feature flag)');
    return next();
  }

  const userId = req.user?.userId || req.user?.id;
  const { formId } = req.body; // ✅ Get from body instead of params

  if (!userId) {
    const auditLogger = require('../utils/audit-logger');
    await auditLogger.logUnauthorizedAccess(null, 'form', formId, 'Missing userId in token', req.ip);
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED'
    });
  }

  if (!formId) {
    const auditLogger = require('../utils/audit-logger');
    await auditLogger.logUnauthorizedAccess(userId, 'form', null, 'Missing formId in request body', req.ip);
    return res.status(400).json({
      success: false,
      error: 'Form ID is required in request body',
      code: 'FORM_ID_MISSING'
    });
  }

  // Log authorization attempt
  if (featureFlags.LOG_AUTH_ATTEMPTS) {
    console.log(`🔐 Authorization check (from body): user=${userId}, form=${formId}, endpoint=${req.path}`);
  }

  try {
    const { hasAccess, form, reason } = await verifyFormAccess(userId, formId);
    
    if (!hasAccess) {
      // Log authorization failure
      if (featureFlags.LOG_AUTHZ_FAILURES) {
        console.warn(`❌ Authorization denied (from body): user=${userId}, form=${formId}, reason=${reason}`);
      }
      
      const auditLogger = require('../utils/audit-logger');
      await auditLogger.logUnauthorizedAccess(userId, 'form', formId, `User does not own form: ${reason}`, req.ip);
      
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not have access to this form',
        code: 'ACCESS_DENIED',
        reason
      });
    }

    // Attach form to request for use in route handler
    req.form = form;
    req.accessReason = reason;

    console.log(`✅ Authorization granted (from body): user=${userId}, form=${formId}, reason=${reason}`);
    next();
  } catch (error) {
    console.error('❌ Authorization middleware error (from body):', error);
    const auditLogger = require('../utils/audit-logger');
    await auditLogger.logUnauthorizedAccess(userId, 'form', formId, `Internal server error: ${error.message}`, req.ip);
    res.status(500).json({
      success: false,
      error: 'Authorization check failed',
      code: 'AUTHORIZATION_ERROR'
    });
  }
}

module.exports = {
  verifyFormAccess,
  verifySubmissionAccess,
  requireFormOwnership,
  requireSubmissionOwnership,
  requireFormOwnershipFromBody // ✅ NEW
};

