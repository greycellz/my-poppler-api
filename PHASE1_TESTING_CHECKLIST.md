# Phase 1 Security Testing Checklist

**Date**: January 2025  
**Status**: 🟡 IN PROGRESS  
**Backend URL**: `https://my-poppler-api-dev.up.railway.app`

---

## ✅ Completed Tests

### 1. CORS Configuration
- [x] Allowed origins return CORS headers
- [x] Disallowed origins blocked (no CORS headers)
- [x] Strict mode working (`ENABLE_STRICT_CORS=true`)

### 2. JWT_SECRET Validation
- [x] Server fails fast if JWT_SECRET missing
- [x] Server starts successfully with JWT_SECRET set
- [x] Validation script runs on startup

### 3. Authentication Requirements
- [x] Form deletion requires auth (401 without token)
- [x] Submissions endpoint requires auth (401 without token)
- [x] Submission data endpoint requires auth (401 without token)

---

## ⚠️ Tests Needed (With Valid JWT Tokens)

### 4. Form Ownership Verification

**Test 4.1: Delete Own Form**
```bash
# Get JWT token from login
TOKEN="your-jwt-token-here"
FORM_ID="your-form-id"

# Should succeed (200)
curl -X DELETE "$BACKEND_URL/api/forms/$FORM_ID" \
  -H "Authorization: Bearer $TOKEN"
```

**Test 4.2: Delete Someone Else's Form**
```bash
# Use token from different user
TOKEN="other-user-token"
FORM_ID="someone-else-form-id"

# Should fail (403 Forbidden)
curl -X DELETE "$BACKEND_URL/api/forms/$FORM_ID" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: 403 with `"error": "Forbidden: You do not have access to this form"`

---

### 5. Submissions Access Control

**Test 5.1: Get Own Form's Submissions**
```bash
TOKEN="your-jwt-token"
FORM_ID="your-form-id"

# Should succeed (200)
curl "$BACKEND_URL/api/forms/$FORM_ID/submissions" \
  -H "Authorization: Bearer $TOKEN"
```

**Test 5.2: Get Someone Else's Form's Submissions**
```bash
TOKEN="your-jwt-token"
FORM_ID="someone-else-form-id"

# Should fail (403)
curl "$BACKEND_URL/api/forms/$FORM_ID/submissions" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: 403 Forbidden

---

### 6. Submission Data Access

**Test 6.1: Get Own Submission Data**
```bash
TOKEN="your-jwt-token"
SUBMISSION_ID="your-submission-id"

# Should succeed (200)
curl "$BACKEND_URL/api/submissions/$SUBMISSION_ID/data" \
  -H "Authorization: Bearer $TOKEN"
```

**Test 6.2: Get Someone Else's Submission Data**
```bash
TOKEN="your-jwt-token"
SUBMISSION_ID="someone-else-submission-id"

# Should fail (403)
curl "$BACKEND_URL/api/submissions/$SUBMISSION_ID/data" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 7. Form Retrieval (Draft vs Published)

**Test 7.1: Access Published Form (No Auth)**
```bash
FORM_ID="published-form-id"

# Should succeed (200) - public access
curl "$BACKEND_URL/api/forms/$FORM_ID"
```

**Test 7.2: Access Draft Form (No Auth)**
```bash
FORM_ID="draft-form-id"

# Should fail (401) - requires auth
curl "$BACKEND_URL/api/forms/$FORM_ID"
```

**Expected**: 401 with `"error": "Authentication required to access unpublished forms"`

**Test 7.3: Access Own Draft Form (With Auth)**
```bash
TOKEN="your-jwt-token"
FORM_ID="your-draft-form-id"

# Should succeed (200)
curl "$BACKEND_URL/api/forms/$FORM_ID" \
  -H "Authorization: Bearer $TOKEN"
```

**Test 7.4: Access Someone Else's Draft Form (With Auth)**
```bash
TOKEN="your-jwt-token"
FORM_ID="someone-else-draft-form-id"

# Should fail (403)
curl "$BACKEND_URL/api/forms/$FORM_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 8. File Upload (Feature Flag)

**Current**: `ENABLE_FILE_UPLOAD_AUTH=false`

**Test 8.1: Upload Without Auth (Flag = false)**
```bash
# Should succeed (200)
curl -X POST "$BACKEND_URL/upload-file" \
  -F "file=@test.pdf" \
  -F "formId=test" \
  -F "fieldId=test"
```

**Test 8.2: Upload Without Auth (Flag = true)**
```bash
# Set ENABLE_FILE_UPLOAD_AUTH=true in Railway
# Should fail (401)
curl -X POST "$BACKEND_URL/upload-file" \
  -F "file=@test.pdf" \
  -F "formId=test" \
  -F "fieldId=test"
```

**Test 8.3: Upload With Auth (Flag = true)**
```bash
TOKEN="your-jwt-token"

# Should succeed (200)
curl -X POST "$BACKEND_URL/upload-file" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.pdf" \
  -F "formId=test" \
  -F "fieldId=test"
```

---

### 9. File Download

**Test 9.1: Download from Published Form (No Auth)**
```bash
FORM_ID="published-form-id"
FIELD_ID="field-id"
FILENAME="file.pdf"

# Should succeed (200)
curl "$BACKEND_URL/api/files/$FORM_ID/$FIELD_ID/$FILENAME"
```

**Test 9.2: Download from Draft Form (No Auth)**
```bash
FORM_ID="draft-form-id"
FIELD_ID="field-id"
FILENAME="file.pdf"

# Should fail (401)
curl "$BACKEND_URL/api/files/$FORM_ID/$FIELD_ID/$FILENAME"
```

**Test 9.3: Download from Own Draft Form (With Auth)**
```bash
TOKEN="your-jwt-token"
FORM_ID="your-draft-form-id"
FIELD_ID="field-id"
FILENAME="file.pdf"

# Should succeed (200)
curl "$BACKEND_URL/api/files/$FORM_ID/$FIELD_ID/$FILENAME" \
  -H "Authorization: Bearer $TOKEN"
```

**Test 9.4: Download from Someone Else's Form (With Auth)**
```bash
TOKEN="your-jwt-token"
FORM_ID="someone-else-form-id"
FIELD_ID="field-id"
FILENAME="file.pdf"

# Should fail (403)
curl "$BACKEND_URL/api/files/$FORM_ID/$FIELD_ID/$FILENAME" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🎯 Testing Strategy

### Phase A: Basic Auth Tests (Current)
- ✅ Test endpoints require authentication
- ✅ Test unauthorized requests are blocked

### Phase B: Ownership Tests (Next)
- ⚠️ Test users can only access their own resources
- ⚠️ Test unauthorized access to others' resources is blocked

### Phase C: Feature Flag Tests
- ⚠️ Test file upload with flag enabled/disabled
- ⚠️ Test gradual rollout of features

### Phase D: Integration Tests
- ⚠️ Test from frontend (actual user flows)
- ⚠️ Test edge cases (legacy forms, missing fields, etc.)

---

## 📝 Notes

- All tests should be run against the deployed Railway backend
- Use real JWT tokens from actual user logins
- Test with both authenticated and unauthenticated requests
- Verify audit logs are being created
- Check Railway logs for authorization failures

---

## 🚀 Next Steps

1. **Get JWT tokens** from actual user logins
2. **Test ownership verification** with real form IDs
3. **Test unauthorized access** attempts
4. **Enable feature flags gradually** and test each one
5. **Test from frontend** to ensure user flows work


