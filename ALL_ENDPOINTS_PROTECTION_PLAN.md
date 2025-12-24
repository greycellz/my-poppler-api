# All Endpoints Protection Plan - Phase 1 Extension

**Date**: January 24, 2025  
**Branch**: `security/phase-1`  
**Priority**: 🔴 CRITICAL - Complete Phase 1 Security

---

## Overview

This plan covers **all remaining endpoints** that need authentication/authorization protection beyond the analytics endpoints already planned.

---

## Endpoint Analysis

### ✅ Already Protected

| Endpoint | Method | Protection | Status |
|----------|--------|-----------|--------|
| `/api/forms/:formId` | DELETE | ✅ Auth + Ownership | Protected |
| `/api/forms/:formId/submissions` | GET | ✅ Auth + Ownership | Protected |
| `/api/forms/:formId/submissions/paginated` | GET | ✅ Auth + Ownership | Protected |
| `/api/submissions/:submissionId/data` | GET | ✅ Auth + Ownership | Protected |
| `/api/submissions/:submissionId/signatures` | GET | ✅ Auth + Ownership | Protected |
| `/api/submissions/:submissionId/signature/:fieldId` | GET | ✅ Auth + Ownership | Protected |
| `/api/submissions/:submissionId/pdf/:fieldId` | GET | ✅ Auth + Ownership | Protected |
| `/api/submissions/:submissionId/pdf/:fieldId/generate-or-return` | POST | ✅ Auth + Ownership | Protected |
| `/api/files/:formId/:fieldId/:filename` | GET | ✅ Optional Auth + Ownership | Protected |
| `/upload-file` | POST | ✅ Auth + Ownership | Protected |

---

## 🔴 Critical Issues Found

### 1. Form Storage/Update Endpoints

#### `/store-form` (POST)
**Issue**: 
- Takes `userId` from request body (insecure - can be spoofed)
- No ownership check for updates (when `formId` exists)
- Anyone can update any form by providing formId in formData

**Current Code**:
```javascript
app.post('/store-form', async (req, res) => {
  const { formData, userId, metadata } = req.body;
  // userId from body - INSECURE!
  // No check if formId exists and user owns it
  const formId = formData.id || formData.formId || generateNewId();
  // ...
});
```

**Fix Required**:
- Extract `userId` from JWT token (not body)
- If `formId` exists in `formData`, verify ownership before update
- For new forms, use authenticated user's ID

#### `/api/auto-save-form` (POST)
**Issue**:
- No authentication check
- No ownership verification
- Anyone can auto-save any form if they know the formId

**Current Code**:
```javascript
app.post('/api/auto-save-form', async (req, res) => {
  const { formId, formSchema } = req.body;
  // No auth check!
  // Gets userId from existing form in DB, but doesn't verify requester owns it
  const currentForm = await gcpClient.getFormById(formId);
  // Uses currentForm?.user_id but doesn't verify requester is that user
});
```

**Fix Required**:
- Require authentication
- Verify ownership before auto-saving

---

### 2. Form Submission Endpoint

#### `/submit-form` (POST)
**Issue**:
- Allows submissions to any formId (including draft forms)
- No verification that form exists or is published
- Could allow submissions to non-existent or draft forms

**Current Code**:
```javascript
app.post('/submit-form', async (req, res) => {
  const { formId, formData, userId, isHipaa, metadata } = req.body;
  // No check if form exists
  // No check if form is published
  // Allows submissions to any formId
});
```

**Fix Required**:
- Verify form exists
- Verify form is published (draft forms should not accept submissions)
- Allow anonymous submissions for published forms (this is correct)

---

### 3. Form Images Endpoints

#### `/upload-form-image` (POST)
**Issue**:
- Takes `userId` from request body (insecure)
- No ownership verification

**Current Code**:
```javascript
app.post('/upload-form-image', upload.single('file'), async (req, res) => {
  const { formId, fieldId, userId, sequence } = req.body
  // userId from body - INSECURE!
  // No ownership check
});
```

**Fix Required**:
- Extract `userId` from JWT token
- Verify form ownership

#### `/form-images/:formId/:fieldId` (GET)
**Issue**:
- No authentication or ownership check
- Anyone can view form images for any form

**Fix Required**:
- Require authentication
- Verify ownership

#### `/form-image/:imageId` (DELETE)
**Issue**:
- Takes `userId` from request body (insecure)
- No ownership verification

**Fix Required**:
- Extract `userId` from JWT token
- Verify form ownership (via image's formId)

#### `/form-images/:formId/:fieldId/sequence` (PUT)
**Issue**:
- No authentication or ownership check
- Anyone can reorder images for any form

**Fix Required**:
- Require authentication
- Verify ownership

#### `/api/files/form-image/:formId/:fieldId/:imageId` (GET)
**Issue**:
- No authentication or ownership check
- Only checks if image belongs to form/field, but doesn't verify requester owns form

**Fix Required**:
- Require authentication
- Verify form ownership

---

### 4. User Forms List Endpoint

#### `/api/forms/user/:userId` (GET)
**Issue**:
- No authentication check
- No verification that authenticated user matches URL userId
- Anyone can view any user's forms by guessing userId

**Current Code**:
```javascript
app.get('/api/forms/user/:userId', async (req, res) => {
  const { userId } = req.params;
  // No auth check!
  // No verification that req.user.userId === userId
  const forms = await gcpClient.getFormsByUserId(userId);
});
```

**Fix Required**:
- Require authentication
- Verify `req.user.userId === req.params.userId` OR use authenticated user's ID from token

---

### 5. Form Cloning (Frontend + Backend)

**Issue**:
- Cloning happens on frontend by:
  1. Fetching original form (`/api/forms/:formId` - protected for drafts ✅)
  2. Storing as new form (`/store-form` - needs protection for source form)
- No verification that user has access to source form before cloning
- For published forms, cloning is allowed (this is OK)
- For draft forms, should verify ownership

**Fix Required**:
- When cloning, verify user has access to source form
- For published forms: Allow cloning (public)
- For draft forms: Require ownership

**Note**: Cloning is done via `/store-form` with `metadata.source = 'clone'` and `metadata.originalFormId`. We should add a check in `/store-form` to verify access to `originalFormId` if it's a draft form.

---

## Implementation Plan

### Phase 1A: Analytics Endpoints (Already Planned)
- 14 analytics endpoints
- See `ANALYTICS_ENDPOINTS_PROTECTION_PLAN.md`

### Phase 1B: Form Management Endpoints

#### Task 1B.1: Fix `/store-form` Endpoint
**File**: `my-poppler-api/server.js`

**Changes**:
1. Add authentication middleware
2. Extract `userId` from JWT token (not body)
3. If `formId` exists in `formData`, verify ownership
4. If `metadata.originalFormId` exists (cloning), verify access to source form

**Code**:
```javascript
app.post('/store-form',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  async (req, res) => {
    const { formData, metadata } = req.body;
    const userId = req.user.userId; // From JWT, not body!
    
    const formId = formData.id || formData.formId;
    
    // If updating existing form, verify ownership
    if (formId) {
      const { verifyFormAccess } = require('./auth/authorization');
      const { hasAccess } = await verifyFormAccess(userId, formId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not have access to this form'
        });
      }
    }
    
    // If cloning, verify access to source form
    if (metadata?.originalFormId) {
      const sourceForm = await gcpClient.getFormStructure(metadata.originalFormId, true);
      if (sourceForm) {
        const isPublished = sourceForm.is_published || sourceForm.isPublished;
        if (!isPublished) {
          // Draft form - require ownership
          const { verifyFormAccess } = require('./auth/authorization');
          const { hasAccess } = await verifyFormAccess(userId, metadata.originalFormId);
          if (!hasAccess) {
            return res.status(403).json({
              success: false,
              error: 'Forbidden: You do not have access to clone this form'
            });
          }
        }
        // Published forms can be cloned by anyone (OK)
      }
    }
    
    // ... rest of handler
  }
);
```

#### Task 1B.2: Fix `/api/auto-save-form` Endpoint
**File**: `my-poppler-api/server.js`

**Changes**:
1. Add authentication middleware
2. Verify ownership before auto-saving

**Code**:
```javascript
app.post('/api/auto-save-form',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    const { formId, formSchema } = req.body;
    const userId = req.user.userId; // From JWT
    
    // Ownership already verified by middleware
    // ... rest of handler
  }
);
```

#### Task 1B.3: Fix `/submit-form` Endpoint
**File**: `my-poppler-api/server.js`

**Changes**:
1. Verify form exists
2. Verify form is published (draft forms should not accept submissions)

**Code**:
```javascript
app.post('/submit-form', async (req, res) => {
  const { formId, formData, userId, isHipaa, metadata } = req.body;
  
  // Verify form exists and is published
  const form = await gcpClient.getFormStructure(formId, true);
  if (!form) {
    return res.status(404).json({
      success: false,
      error: 'Form not found'
    });
  }
  
  const isPublished = form.is_published || form.isPublished;
  if (!isPublished) {
    return res.status(403).json({
      success: false,
      error: 'Form is not published. Only published forms accept submissions.'
    });
  }
  
  // ... rest of handler (allow anonymous submissions for published forms)
});
```

#### Task 1B.4: Fix Form Image Endpoints
**File**: `my-poppler-api/server.js`

**Endpoints to Fix**:
1. `POST /upload-form-image` - Add auth + ownership
2. `GET /form-images/:formId/:fieldId` - Add auth + ownership
3. `DELETE /form-image/:imageId` - Add auth + ownership (verify via image's formId)
4. `PUT /form-images/:formId/:fieldId/sequence` - Add auth + ownership
5. `GET /api/files/form-image/:formId/:fieldId/:imageId` - Add auth + ownership

**Pattern**:
```javascript
// Upload
app.post('/upload-form-image',
  upload.single('file'),
  authenticateToken,
  requireAuth,
  requireFormOwnership, // Verify via formId in body
  async (req, res) => {
    const { formId, fieldId, sequence } = req.body;
    const userId = req.user.userId; // From JWT
    // ... rest
  }
);

// Get images
app.get('/form-images/:formId/:fieldId',
  authenticateToken,
  requireAuth,
  requireFormOwnership,
  async (req, res) => {
    // ... rest
  }
);

// Delete image (need to get formId from image doc first)
app.delete('/form-image/:imageId',
  authenticateToken,
  requireAuth,
  async (req, res) => {
    // Get image doc to find formId
    const imageDoc = await gcpClient.collection('form_images').doc(req.params.imageId).get();
    if (!imageDoc.exists) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const imageData = imageDoc.data();
    const formId = imageData.formId;
    
    // Verify ownership
    const { verifyFormAccess } = require('./auth/authorization');
    const { hasAccess } = await verifyFormAccess(req.user.userId, formId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // ... delete logic
  }
);

// Update sequence
app.put('/form-images/:formId/:fieldId/sequence',
  authenticateToken,
  requireAuth,
  requireFormOwnership,
  async (req, res) => {
    // ... rest
  }
);

// Serve image file
app.get('/api/files/form-image/:formId/:fieldId/:imageId',
  authenticateToken,
  requireAuth,
  requireFormOwnership,
  async (req, res) => {
    // ... rest (ownership already verified)
  }
);
```

#### Task 1B.5: Fix `/api/forms/user/:userId` Endpoint
**File**: `my-poppler-api/server.js`

**Changes**:
1. Require authentication
2. Verify authenticated user matches URL userId OR use authenticated user's ID

**Code**:
```javascript
app.get('/api/forms/user/:userId',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  async (req, res) => {
    const { userId } = req.params;
    const authenticatedUserId = req.user.userId;
    
    // Verify authenticated user matches URL userId
    if (userId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only view your own forms'
      });
    }
    
    // ... rest of handler
  }
);
```

---

## Test Plan

### Test Script: `test-all-endpoints-before.sh`
Test all endpoints to verify current unprotected state.

### Test Script: `test-all-endpoints-after.sh`
Test all endpoints to verify they're properly protected.

### Test Cases

#### Form Storage
1. **Store new form** (no auth) → Should fail after fix
2. **Store new form** (authenticated) → Should succeed
3. **Update existing form** (wrong user) → Should fail after fix
4. **Update existing form** (owner) → Should succeed
5. **Clone draft form** (wrong user) → Should fail after fix
6. **Clone draft form** (owner) → Should succeed
7. **Clone published form** (anyone) → Should succeed (public)

#### Auto-Save
1. **Auto-save** (no auth) → Should fail after fix
2. **Auto-save** (wrong user) → Should fail after fix
3. **Auto-save** (owner) → Should succeed

#### Form Submission
1. **Submit to non-existent form** → Should fail (404)
2. **Submit to draft form** → Should fail (403) after fix
3. **Submit to published form** (anonymous) → Should succeed
4. **Submit to published form** (authenticated) → Should succeed

#### Form Images
1. **Upload image** (no auth) → Should fail after fix
2. **Upload image** (wrong user) → Should fail after fix
3. **Upload image** (owner) → Should succeed
4. **Get images** (no auth) → Should fail after fix
5. **Get images** (wrong user) → Should fail after fix
6. **Get images** (owner) → Should succeed
7. **Delete image** (wrong user) → Should fail after fix
8. **Delete image** (owner) → Should succeed
9. **Update sequence** (wrong user) → Should fail after fix
10. **Update sequence** (owner) → Should succeed

#### User Forms List
1. **Get forms** (no auth) → Should fail after fix
2. **Get forms** (wrong userId in URL) → Should fail after fix
3. **Get forms** (correct userId) → Should succeed

---

## Summary of Endpoints to Protect

### Analytics (14 endpoints) - Already Planned
- See `ANALYTICS_ENDPOINTS_PROTECTION_PLAN.md`

### Form Management (6 endpoints)
1. `POST /store-form` - Auth + ownership for updates/clones
2. `POST /api/auto-save-form` - Auth + ownership
3. `POST /submit-form` - Verify form exists and is published
4. `POST /upload-form-image` - Auth + ownership
5. `GET /form-images/:formId/:fieldId` - Auth + ownership
6. `DELETE /form-image/:imageId` - Auth + ownership (via image's formId)
7. `PUT /form-images/:formId/:fieldId/sequence` - Auth + ownership
8. `GET /api/files/form-image/:formId/:fieldId/:imageId` - Auth + ownership
9. `GET /api/forms/user/:userId` - Auth + verify userId matches

**Total**: 9 additional endpoints + 14 analytics = **23 endpoints** to protect

---

## Implementation Order

1. ✅ Analytics endpoints (separate plan)
2. ⏳ Form storage/update (`/store-form`, `/api/auto-save-form`)
3. ⏳ Form submission (`/submit-form`)
4. ⏳ Form images (5 endpoints)
5. ⏳ User forms list (`/api/forms/user/:userId`)

---

## Testing Strategy

### Before Implementation
1. Run `test-all-endpoints-before.sh`
2. Document current unprotected state
3. Verify security vulnerabilities exist

### After Implementation
1. Run `test-all-endpoints-after.sh`
2. Verify all unauthorized access fails
3. Verify owner access succeeds
4. Test frontend still works

---

## Success Criteria

- ✅ All form management endpoints require authentication
- ✅ All form management endpoints verify ownership
- ✅ Form submissions only allowed for published forms
- ✅ Form cloning requires access to source form (if draft)
- ✅ User forms list only shows own forms
- ✅ All form image operations require ownership
- ✅ Frontend functionality preserved

---

## Risk Assessment

### Low Risk
- Using existing middleware patterns
- Following same approach as other protected endpoints

### Medium Risk
- Frontend may need updates to send auth tokens
- Need to verify cloning flow still works

### Mitigation
- Test thoroughly before merge
- Verify frontend sends tokens correctly
- Test cloning with both draft and published forms

---

## Timeline

- Analytics endpoints: 4-5 hours (already planned)
- Form management endpoints: 3-4 hours
- Form images: 2-3 hours
- User forms list: 30 min
- Testing: 2-3 hours

**Total**: ~12-15 hours for complete Phase 1

