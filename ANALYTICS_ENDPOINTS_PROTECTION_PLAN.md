# Analytics Endpoints Protection Plan

**Date**: January 24, 2025  
**Branch**: `security/phase-1`  
**Priority**: 🔴 CRITICAL - Part of Phase 1

---

## Problem Statement

All backend analytics endpoints are currently **unprotected** or **partially protected** (auth but no ownership check). Anyone can call these endpoints directly with just a formId to access analytics data for any form.

**Security Impact**: 
- 🔴 **CRITICAL**: Unauthorized users can view analytics for any form
- 🔴 **HIPAA Violation**: Sensitive health data analytics exposed
- 🔴 **Privacy Violation**: User behavior data exposed
- 🔴 **Business Intelligence Leak**: Form performance data exposed

---

## Current Status of Analytics Endpoints

### Unprotected Endpoints (No Auth, No Ownership Check)

| Endpoint | Method | Current Protection | Issue |
|----------|--------|-------------------|-------|
| `/analytics/forms/:formId/overview` | GET | ❌ None | Anyone can view analytics overview |
| `/analytics/forms/:formId/fields` | GET | ❌ None | Anyone can view field analytics |
| `/analytics/forms/:formId/cross-field/defaults` | GET | ❌ None | Anyone can view default comparisons |
| `/analytics/forms/:formId/cross-field/analyze` | GET | ❌ None | Anyone can analyze cross-field data |

### Partially Protected (Auth but No Ownership Check)

| Endpoint | Method | Current Protection | Issue |
|----------|--------|-------------------|-------|
| `/analytics/forms/:formId/preferences` | GET | ✅ Auth only | Authenticated users can view any form's preferences |
| `/analytics/forms/:formId/preferences` | POST | ✅ Auth only | Authenticated users can modify any form's preferences |
| `/analytics/forms/:formId/cross-field/favorites` | GET | ✅ Auth only | Authenticated users can view any form's favorites |
| `/analytics/forms/:formId/cross-field/favorites` | POST | ✅ Auth only | Authenticated users can modify any form's favorites |
| `/api/analytics/forms/:formId/custom/analyze` | POST | ✅ Auth only | Authenticated users can analyze any form |
| `/api/analytics/forms/:formId/custom/saved` | POST | ✅ Auth only | Authenticated users can save analyses for any form |
| `/api/analytics/forms/:formId/custom/saved` | GET | ✅ Auth only | Authenticated users can view any form's saved analyses |
| `/api/analytics/forms/:formId/custom/saved/:analysisId` | PATCH | ✅ Auth only | Authenticated users can modify any form's analyses |
| `/api/analytics/forms/:formId/custom/saved/:analysisId` | DELETE | ✅ Auth only | Authenticated users can delete any form's analyses |
| `/api/analytics/forms/:formId/custom/saved/:analysisId/recompute` | POST | ✅ Auth only | Authenticated users can recompute any form's analyses |

---

## Solution Strategy

### Approach: Use Existing Middleware

We already have:
- ✅ `authenticateToken` - Verifies JWT token
- ✅ `requireAuth` - Ensures user exists
- ✅ `requireFormOwnership` - Verifies user owns the form

**Strategy**: Apply `authenticateToken`, `requireAuth`, and `requireFormOwnership` to all analytics endpoints.

---

## Implementation Plan

### Step 1: Protect Unprotected Endpoints

**Endpoints to Update**:
1. `GET /analytics/forms/:formId/overview`
2. `GET /analytics/forms/:formId/fields`
3. `GET /analytics/forms/:formId/cross-field/defaults`
4. `GET /analytics/forms/:formId/cross-field/analyze`

**Change**: Add middleware chain before handler:
```javascript
app.get('/analytics/forms/:formId/overview',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    // ... existing handler code
  }
);
```

### Step 2: Add Ownership Checks to Partially Protected Endpoints

**Endpoints to Update**:
1. `GET /analytics/forms/:formId/preferences`
2. `POST /analytics/forms/:formId/preferences`
3. `GET /analytics/forms/:formId/cross-field/favorites`
4. `POST /analytics/forms/:formId/cross-field/favorites`
5. `POST /api/analytics/forms/:formId/custom/analyze`
6. `POST /api/analytics/forms/:formId/custom/saved`
7. `GET /api/analytics/forms/:formId/custom/saved`
8. `PATCH /api/analytics/forms/:formId/custom/saved/:analysisId`
9. `DELETE /api/analytics/forms/:formId/custom/saved/:analysisId`
10. `POST /api/analytics/forms/:formId/custom/saved/:analysisId/recompute`

**Change**: Replace `getUserIdFromRequest` checks with middleware:
```javascript
// BEFORE
app.get('/analytics/forms/:formId/preferences', async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ... rest of handler
});

// AFTER
app.get('/analytics/forms/:formId/preferences',
  authenticateToken,      // ✅ Require authentication
  requireAuth,            // ✅ Ensure user exists
  requireFormOwnership,   // ✅ Verify ownership
  async (req, res) => {
    // ... rest of handler (userId available via req.user.userId)
  }
);
```

### Step 3: Update Handler Code

**Changes Needed**:
1. Replace `getUserIdFromRequest(req)` with `req.user.userId`
2. Remove manual auth checks (middleware handles it)
3. Ensure error handling is consistent

---

## Test Plan

### Test Case 1: Unprotected Endpoints (Before Fix)

**Objective**: Verify endpoints are accessible without authentication

**Test Script**: `test-analytics-endpoints-before.sh`

**Test Cases**:
1. **Overview Endpoint** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/overview?dateRange=30d"
   ```
   **Expected**: ✅ 200 OK (should be 401 after fix)

2. **Fields Endpoint** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/fields?dateRange=30d"
   ```
   **Expected**: ✅ 200 OK (should be 401 after fix)

3. **Cross-Field Defaults** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/cross-field/defaults?dateRange=30d"
   ```
   **Expected**: ✅ 200 OK (should be 401 after fix)

4. **Cross-Field Analyze** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/cross-field/analyze?fieldId1=field1&fieldId2=field2&dateRange=30d"
   ```
   **Expected**: ✅ 200 OK (should be 401 after fix)

### Test Case 2: Partially Protected Endpoints (Before Fix)

**Objective**: Verify endpoints accept any authenticated user (no ownership check)

**Test Script**: `test-analytics-endpoints-before.sh`

**Test Cases**:
1. **Preferences GET** (Wrong User)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/preferences" \
     -H "Authorization: Bearer <user_a_token>"
   ```
   **Expected**: ✅ 200 OK (should be 403 after fix if user doesn't own form)

2. **Preferences POST** (Wrong User)
   ```bash
   curl -X POST "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/preferences" \
     -H "Authorization: Bearer <user_a_token>" \
     -H "Content-Type: application/json" \
     -d '{"starredFields": ["field1"]}'
   ```
   **Expected**: ✅ 200 OK (should be 403 after fix if user doesn't own form)

3. **Custom Analyze** (Wrong User)
   ```bash
   curl -X POST "https://my-poppler-api-dev.up.railway.app/api/analytics/forms/form_123/custom/analyze" \
     -H "Authorization: Bearer <user_a_token>" \
     -H "Content-Type: application/json" \
     -d '{"template_type": "breakdown", "primary_field_id": "field1", "secondary_field_id": "field2"}'
   ```
   **Expected**: ✅ 200 OK (should be 403 after fix if user doesn't own form)

### Test Case 3: Protected Endpoints (After Fix)

**Objective**: Verify endpoints require authentication and ownership

**Test Script**: `test-analytics-endpoints-after.sh`

**Test Cases**:
1. **Overview Endpoint** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/overview?dateRange=30d"
   ```
   **Expected**: ❌ 401 Unauthorized

2. **Overview Endpoint** (Wrong User)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/overview?dateRange=30d" \
     -H "Authorization: Bearer <user_a_token>"
   ```
   **Expected**: ❌ 403 Forbidden (if user doesn't own form)

3. **Overview Endpoint** (Owner)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/overview?dateRange=30d" \
     -H "Authorization: Bearer <owner_token>"
   ```
   **Expected**: ✅ 200 OK

4. **Fields Endpoint** (No Auth)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/fields?dateRange=30d"
   ```
   **Expected**: ❌ 401 Unauthorized

5. **Fields Endpoint** (Wrong User)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/fields?dateRange=30d" \
     -H "Authorization: Bearer <user_a_token>"
   ```
   **Expected**: ❌ 403 Forbidden (if user doesn't own form)

6. **Fields Endpoint** (Owner)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/fields?dateRange=30d" \
     -H "Authorization: Bearer <owner_token>"
   ```
   **Expected**: ✅ 200 OK

7. **Preferences GET** (Wrong User)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/preferences" \
     -H "Authorization: Bearer <user_a_token>"
   ```
   **Expected**: ❌ 403 Forbidden (if user doesn't own form)

8. **Preferences GET** (Owner)
   ```bash
   curl -X GET "https://my-poppler-api-dev.up.railway.app/analytics/forms/form_123/preferences" \
     -H "Authorization: Bearer <owner_token>"
   ```
   **Expected**: ✅ 200 OK

9. **Custom Analyze** (Wrong User)
   ```bash
   curl -X POST "https://my-poppler-api-dev.up.railway.app/api/analytics/forms/form_123/custom/analyze" \
     -H "Authorization: Bearer <user_a_token>" \
     -H "Content-Type: application/json" \
     -d '{"template_type": "breakdown", "primary_field_id": "field1", "secondary_field_id": "field2"}'
   ```
   **Expected**: ❌ 403 Forbidden (if user doesn't own form)

10. **Custom Analyze** (Owner)
    ```bash
    curl -X POST "https://my-poppler-api-dev.up.railway.app/api/analytics/forms/form_123/custom/analyze" \
      -H "Authorization: Bearer <owner_token>" \
      -H "Content-Type: application/json" \
      -d '{"template_type": "breakdown", "primary_field_id": "field1", "secondary_field_id": "field2"}'
    ```
    **Expected**: ✅ 200 OK

---

## Implementation Steps

### Step 1: Create Test Scripts (Before Changes)

1. **Create `test-analytics-endpoints-before.sh`**
   - Test all endpoints without auth
   - Test all endpoints with wrong user token
   - Document current behavior (should pass unauthorized)

2. **Run tests and document results**
   - Verify endpoints are currently unprotected
   - Save results for comparison

### Step 2: Implement Protection

1. **Update unprotected endpoints** (4 endpoints)
   - Add middleware chain
   - Test each endpoint

2. **Update partially protected endpoints** (10 endpoints)
   - Replace `getUserIdFromRequest` with middleware
   - Update handler to use `req.user.userId`
   - Test each endpoint

### Step 3: Create Test Scripts (After Changes)

1. **Create `test-analytics-endpoints-after.sh`**
   - Test all endpoints without auth (should fail)
   - Test all endpoints with wrong user token (should fail)
   - Test all endpoints with owner token (should pass)

2. **Run tests and verify**
   - All unauthorized requests should fail
   - All wrong-user requests should fail
   - All owner requests should pass

### Step 4: Update Feature Flags

**Check**: Ensure `ENABLE_FORM_OWNERSHIP_CHECK` is enabled for these endpoints to work.

---

## Files to Modify

1. **`my-poppler-api/server.js`**
   - Update 4 unprotected endpoints (add middleware)
   - Update 10 partially protected endpoints (replace auth check with middleware)
   - Remove `getUserIdFromRequest` calls where replaced

2. **`my-poppler-api/test-analytics-endpoints-before.sh`** (NEW)
   - Test script for before changes

3. **`my-poppler-api/test-analytics-endpoints-after.sh`** (NEW)
   - Test script for after changes

---

## Testing Checklist

### Before Implementation
- [ ] Run `test-analytics-endpoints-before.sh`
- [ ] Document that endpoints are unprotected
- [ ] Verify unauthorized access works
- [ ] Verify wrong-user access works

### After Implementation
- [ ] Run `test-analytics-endpoints-after.sh`
- [ ] Verify unauthorized access fails (401)
- [ ] Verify wrong-user access fails (403)
- [ ] Verify owner access succeeds (200)
- [ ] Test with real JWT tokens
- [ ] Test with multiple user accounts
- [ ] Verify frontend still works (analytics tab)

---

## Success Criteria

### Security
- ✅ All analytics endpoints require authentication
- ✅ All analytics endpoints verify ownership
- ✅ Unauthorized requests return 401
- ✅ Wrong-user requests return 403
- ✅ Owner requests succeed

### Functionality
- ✅ Frontend analytics tab still works
- ✅ All analytics features functional
- ✅ No breaking changes to existing functionality

### Testing
- ✅ Before/after test scripts created
- ✅ All test cases pass
- ✅ Results documented

---

## Risk Assessment

### Low Risk
- Using existing, tested middleware
- Following same pattern as other protected endpoints
- Feature flags allow rollback

### Medium Risk
- Need to ensure frontend sends auth tokens (already fixed)
- Need to verify ownership checks work correctly

### Mitigation
- Test thoroughly before merge
- Use feature flags for gradual rollout
- Monitor error rates after deployment

---

## Timeline

1. **Create test scripts**: 30 min
2. **Run before tests**: 15 min
3. **Implement protection**: 2-3 hours
4. **Run after tests**: 30 min
5. **Frontend verification**: 30 min
6. **Documentation**: 15 min

**Total**: ~4-5 hours

---

## Next Steps

1. ✅ Create this plan
2. ⏳ Create before test script
3. ⏳ Run before tests
4. ⏳ Implement protection
5. ⏳ Create after test script
6. ⏳ Run after tests
7. ⏳ Verify frontend
8. ⏳ Commit and merge

