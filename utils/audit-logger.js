/**
 * Audit Logger for Security Events
 * Logs unauthorized access attempts and security-relevant events
 */

/**
 * Log unauthorized access attempt
 * @param {string|null} userId - User ID (null for anonymous)
 * @param {string} resourceType - Type of resource (form, submission, forms_list, etc.)
 * @param {string|null} resourceId - Resource ID
 * @param {string} reason - Reason for denial
 * @param {string} ipAddress - IP address of requester
 */
async function logUnauthorizedAccess(userId, resourceType, resourceId, reason, ipAddress) {
  try {
    const timestamp = new Date().toISOString();
    
    // Log to console (in production, this would go to a logging service)
    console.log(`📝 AUDIT: Unauthorized access attempt`, {
      timestamp,
      userId: userId || 'anonymous',
      resourceType,
      resourceId: resourceId || 'unknown',
      reason,
      ipAddress: ipAddress || 'unknown'
    });
    
    // TODO: In production, send to:
    // - Cloud Logging (GCP)
    // - Security monitoring service
    // - Database for audit trail
    
    // For now, just console logging is sufficient
    // In Phase 2, we can add database persistence if needed
    
  } catch (error) {
    // Don't throw - audit logging should never break the main flow
    console.error('❌ Error in audit logging:', error);
  }
}

/**
 * Log security event (successful authorization, etc.)
 * @param {string} userId - User ID
 * @param {string} eventType - Type of event
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - Resource ID
 * @param {string} details - Additional details
 */
async function logSecurityEvent(userId, eventType, resourceType, resourceId, details) {
  try {
    const timestamp = new Date().toISOString();
    
    console.log(`📝 AUDIT: Security event`, {
      timestamp,
      userId,
      eventType,
      resourceType,
      resourceId,
      details
    });
    
  } catch (error) {
    console.error('❌ Error in security event logging:', error);
  }
}

module.exports = {
  logUnauthorizedAccess,
  logSecurityEvent
};


