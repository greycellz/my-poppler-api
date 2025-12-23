# Custom Analytics Backend - Code Review

**Date**: December 23, 2024  
**Branch**: `feature/custom-analytics`  
**Reviewer**: AI Assistant  
**Files Reviewed**:
- `utils/custom-analytics.js` (475 lines)
- `server.js` (6 new endpoints, ~700 lines added)

---

## Executive Summary

The custom analytics backend implementation is **mostly solid** with some **critical issues** that need to be addressed before pushing to remote.

### ✅ Strengths
1. **Good authentication** on all endpoints
2. **Performance limits** implemented (5K warning, 10K hard limit)
3. **Timeout protection** (30 seconds)
4. **Orphaned analysis detection** in GET endpoint
5. **Field compatibility validation** before analysis
6. **Error handling** throughout

### ❌ Critical Issues
1. **🚨 MISSING: Authorization check** - No verification that user owns/has access to the form
2. **🚨 Data field assumptions** - No inspection of actual submission_data structure
3. **⚠️ Inconsistent field naming** - Uses snake_case (field_id) without validation
4. **⚠️ Missing Firestore orderBy composite index** requirement
5. **⚠️ generateBigNumber() function is unused** - Dead code

### 🔧 Medium Issues
1. **Incomplete date range handling** in save endpoint
2. **No aggregation option for Over Time** template (always uses mean)
3. **P90 calculation may be incorrect** (should be index, not value at 90%)

---

## Detailed Review

### 1. **CRITICAL: Missing Form Access Authorization** 🚨

**Location**: All 6 endpoints in `server.js`

**Issue**: While authentication (`getUserIdFromRequest`) is implemented, there's **NO authorization check** to verify the user has access to the form.

**Current Code**:
```javascript
const userId = getUserIdFromRequest(req);
if (!userId) {
  return res.status(401).json({ error: 'Unauthorized' });
}
// ❌ MISSING: Check if userId has access to formId
```

**Expected Behavior**:
- User must be the form owner OR a collaborator
- Similar to how other analytics endpoints handle authorization

**Fix Required**:
```javascript
const userId = getUserIdFromRequest(req);
if (!userId) {
  return res.status(401).json({ error: 'Unauthorized' });
}

// ✅ ADD: Verify form access
const formDoc = await gcpClient.getFormStructure(formId, true);
if (!formDoc) {
  return res.status(404).json({ error: 'Form not found' });
}

// 🔍 INSPECT ACTUAL FORM STRUCTURE
console.log('🔍 FORM DOC KEYS:', Object.keys(formDoc));
console.log('🔍 FORM USER ID FIELD:', formDoc.user_id || formDoc.userId || formDoc.createdBy);

// Check if user owns the form (verify actual field name)
const formOwnerId = formDoc.user_id || formDoc.userId || formDoc.createdBy;
if (formOwnerId !== userId) {
  // TODO: Check collaborators if that feature exists
  return res.status(403).json({ 
    error: 'Forbidden: You do not have access to this form' 
  });
}
```

**Recommendation**: Add authorization helper function similar to existing endpoints.

---

### 2. **CRITICAL: Data Field Name Assumptions** 🚨

**Location**: `utils/custom-analytics.js` - `applyFilters()`, `analyzeBreakdown()`, `analyzeOverTime()`

**Issue**: Code assumes `submission.submission_data` exists without inspecting actual structure.

**Violates Repo Rule**:
> "NEVER ASSUME FIELD NAMES OR DATA STRUCTURES. INSPECT FIRST."

**Current Code**:
```javascript
const data = submission.submission_data || {};  // ❌ Assumption
const primaryValue = data[primaryField.id];
```

**Required Fix**:
```javascript
// ✅ INSPECT ACTUAL SUBMISSION STRUCTURE
if (submissions.length > 0) {
  console.log('🔍 ACTUAL SUBMISSION STRUCTURE:', JSON.stringify(submissions[0], null, 2));
  console.log('🔍 SUBMISSION KEYS:', Object.keys(submissions[0]));
}

// Handle both possible field names
const data = submission.submission_data || submission.submissionData || submission.data || {};
```

**Action Required**: Add data structure inspection at the start of each analyzer function.

---

### 3. **CRITICAL: Inconsistent Field Naming (snake_case vs camelCase)** ⚠️

**Location**: All API endpoints

**Issue**: Request body uses snake_case (`primary_field_id`, `secondary_field_id`, `template_type`) but doesn't validate or handle camelCase alternatives.

**Current Code**:
```javascript
const {
  template_type,
  primary_field_id,
  secondary_field_id,
  // ...
} = req.body;
```

**Potential Problem**: Frontend may send `templateType`, `primaryFieldId`, etc. (camelCase).

**Recommended Fix**:
```javascript
// 🔍 INSPECT ACTUAL REQUEST BODY
console.log('🔍 REQUEST BODY:', JSON.stringify(req.body, null, 2));
console.log('🔍 AVAILABLE KEYS:', Object.keys(req.body));

// Handle both snake_case and camelCase
const template_type = req.body.template_type || req.body.templateType;
const primary_field_id = req.body.primary_field_id || req.body.primaryFieldId;
const secondary_field_id = req.body.secondary_field_id || req.body.secondaryFieldId;
const filters = req.body.filters || [];
const aggregation = req.body.aggregation || 'mean';
const time_granularity = req.body.time_granularity || req.body.timeGranularity || null;
const date_range = req.body.date_range || req.body.dateRange;
```

---

### 4. **CRITICAL: Missing Composite Index for Firestore Query** ⚠️

**Location**: `GET /api/analytics/forms/:formId/custom/saved` (line ~3050)

**Issue**: Firestore query uses `.orderBy('pinned', 'desc').orderBy('created_at', 'desc')` which requires a composite index.

**Current Code**:
```javascript
const snapshot = await gcpClient.collection('custom_analyses')
  .where('form_id', '==', formId)
  .orderBy('pinned', 'desc')
  .orderBy('created_at', 'desc')  // ❌ Requires composite index
  .limit(10)
  .get();
```

**Problem**: This will fail with Firestore error: "Requires an index"

**Recommended Fixes**:

**Option A (Simplest)**: Remove one orderBy and sort in memory
```javascript
const snapshot = await gcpClient.collection('custom_analyses')
  .where('form_id', '==', formId)
  .limit(10)
  .get();

// Sort in memory
const analyses = snapshot.docs
  .map(doc => doc.data())
  .sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;  // Pinned first
    return b.created_at - a.created_at;  // Then by created_at
  });
```

**Option B**: Create composite index in `firestore.indexes.json`
```json
{
  "indexes": [
    {
      "collectionGroup": "custom_analyses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "form_id", "order": "ASCENDING" },
        { "fieldPath": "pinned", "order": "DESCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Recommendation**: Use Option A (in-memory sort) for now, defer Option B to deployment phase.

---

### 5. **Dead Code: generateBigNumber() Function** 🧹

**Location**: `utils/custom-analytics.js` (lines 454-466)

**Issue**: Function is exported but never used. BigNumber is generated inside each template analyzer.

**Current Code**:
```javascript
function generateBigNumber(templateType, result, primaryField, secondaryField, aggregation = 'mean') {
  // BigNumber is already generated in template-specific analyzers
  return result.bigNumber;  // ❌ Just returns what was passed in
}
```

**Recommendation**: Remove this function and its export, or document why it exists.

---

### 6. **P90 Calculation May Be Incorrect** 🔢

**Location**: `utils/custom-analytics.js` - `analyzeBreakdown()` (lines 212-216)

**Issue**: P90 should return the **90th percentile value**, not the value at the 90% index.

**Current Code**:
```javascript
case 'p90':
  const sortedP90 = [...values].sort((a, b) => a - b);
  const index = Math.floor(sortedP90.length * 0.9);
  aggregatedValue = sortedP90[index] || sortedP90[sortedP90.length - 1];
  break;
```

**Analysis**:
- For 100 values, `index = 90`, so it returns the 91st value (90% are below it) ✅
- For 10 values, `index = 9`, so it returns the 10th value (top value) ❌
- For 5 values, `index = 4`, so it returns the 5th value (top value) ❌

**Better Implementation**:
```javascript
case 'p90':
  const sortedP90 = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sortedP90.length * 0.9) - 1;  // -1 for 0-indexing
  aggregatedValue = sortedP90[Math.max(0, index)];
  break;
```

**Question**: Is this intended behavior, or should P90 be the value at the 90th percentile?

---

### 7. **Missing Aggregation Option for Over Time Template** ⚠️

**Location**: `utils/custom-analytics.js` - `analyzeOverTime()` (line 357)

**Issue**: Over Time template always uses **mean** for aggregation, ignoring the `aggregation` parameter passed from the request.

**Current Code**:
```javascript
if (isNumeric) {
  // Calculate mean for numeric values
  aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;  // ❌ Always mean
}
```

**Expected**: Should respect `aggregation` parameter (mean/median/p90) like Breakdown does.

**Fix**:
```javascript
if (isNumeric) {
  // Use aggregation parameter (pass it from computeCustomAnalysis)
  switch (aggregation) {
    case 'mean':
      aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
      break;
    case 'median':
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      aggregatedValue = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
      break;
    case 'p90':
      const sortedP90 = [...values].sort((a, b) => a - b);
      const index = Math.ceil(sortedP90.length * 0.9) - 1;
      aggregatedValue = sortedP90[Math.max(0, index)];
      break;
    default:
      aggregatedValue = values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
```

**But First**: Update `computeCustomAnalysis()` to pass `aggregation` to `analyzeOverTime()`:
```javascript
case 'over-time':
  return analyzeOverTime(filteredSubmissions, primaryField, secondaryField, timeGranularity || 'day', aggregation);  // ✅ Add aggregation
```

---

### 8. **Incomplete Date Range Handling in Save Endpoint** ⚠️

**Location**: `POST /api/analytics/forms/:formId/custom/saved` (lines 3030-3040)

**Issue**: Save endpoint uses hardcoded 30-day date range instead of respecting the analysis's actual date range.

**Current Code**:
```javascript
// Get current submission count for cache freshness tracking
const endDate = new Date();
const startDate = new Date();
startDate.setUTCDate(startDate.getUTCDate() - 30);  // ❌ Always 30 days
const submissions = await gcpClient.getFormSubmissions(formId, {
  startDate: startDate.toISOString(),
  endDate: endDate.toISOString()
});
```

**Problem**: If user analyzed with 90-day range, but we save with 30-day count, cache freshness will be wrong.

**Fix Options**:

**Option A**: Accept `date_range` in request body and use it
```javascript
const {
  // ... other fields
  date_range
} = req.body;

let startDate, endDate;
if (date_range && date_range.start && date_range.end) {
  startDate = new Date(date_range.start);
  endDate = new Date(date_range.end);
} else {
  // Default to 30 days
  endDate = new Date();
  startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 30);
}
```

**Option B**: Store `computed_for_submission_count` from the analysis result (sent in request)
```javascript
const {
  computed_for_submission_count,  // Accept from request
  // ... other fields
} = req.body;

const analysisDoc = {
  // ...
  computed_for_submission_count: computed_for_submission_count || submissions.length,
};
```

**Recommendation**: Use Option A - accept date_range in save request.

---

## 🔍 Testing & Validation Issues

### 9. **No Validation of Filter Operators**

**Location**: `applyFilters()` (lines 105-142)

**Issue**: Filter operators are used without validation. Invalid operators default to `true` (include all).

**Current Code**:
```javascript
default:
  console.warn(`Unknown filter operator: ${filter.operator}`);
  return true;  // ❌ Silently includes everything
```

**Recommendation**: Return error response if invalid operator is provided.

---

### 10. **No Validation of Aggregation Parameter**

**Location**: `POST /api/analytics/forms/:formId/custom/analyze`

**Issue**: Accepts any string for `aggregation`, but only `mean`, `median`, `p90` are valid.

**Recommendation**: Add validation:
```javascript
const validAggregations = ['mean', 'median', 'p90'];
if (aggregation && !validAggregations.includes(aggregation)) {
  return res.status(400).json({
    success: false,
    error: `Invalid aggregation. Must be one of: ${validAggregations.join(', ')}`
  });
}
```

---

## ✅ What's Working Well

### 1. **Authentication on All Endpoints** ✅
All 6 endpoints properly check for `userId` before proceeding.

### 2. **Performance Limits** ✅
- 10K hard limit with clear error message
- 5K warning logged
- 30-second timeout with graceful error

### 3. **Orphaned Analysis Detection** ✅
GET endpoint checks if fields still exist in form.

### 4. **Field Compatibility Validation** ✅
`validateFieldCompatibility()` properly checks field types vs template requirements.

### 5. **Error Handling** ✅
Most endpoints have try-catch with proper error responses.

### 6. **10-Analysis Limit** ✅
Save endpoint properly checks and enforces limit.

---

## 📋 Action Items

### Must Fix Before Push (Critical)
1. ✅ **Add form access authorization** to all 6 endpoints
2. ✅ **Add submission_data structure inspection** following repo rules
3. ✅ **Handle both snake_case and camelCase** request body fields
4. ✅ **Fix Firestore orderBy** composite index issue (use in-memory sort)

### Should Fix Before Merge to Develop (High Priority)
5. ✅ **Remove or document** `generateBigNumber()` dead code
6. ✅ **Add aggregation parameter** to `analyzeOverTime()`
7. ✅ **Fix date range handling** in save endpoint
8. ✅ **Add validation** for aggregation parameter
9. ✅ **Review P90 calculation** and document intended behavior

### Nice to Have (Medium Priority)
10. ⏳ **Add filter operator validation**
11. ⏳ **Add request body logging** for debugging (follow repo pattern)
12. ⏳ **Add unit tests** for analyzer functions

---

## 🎯 Recommendations

### 1. **Follow Existing Patterns**
Look at how other analytics endpoints handle:
- Form authorization (check existing endpoints)
- Request body field naming (inspect actual data)
- Firestore queries (avoid composite index requirements)

### 2. **Add Data Structure Inspection**
Following the repo rule, add inspection logging:
```javascript
console.log('🔍 ACTUAL DATA STRUCTURE:', JSON.stringify(data, null, 2));
console.log('🔍 AVAILABLE KEYS:', Object.keys(data));
```

### 3. **Consider Frontend Contract**
Decide on API contract:
- **snake_case** (backend style): `template_type`, `primary_field_id`
- **camelCase** (frontend style): `templateType`, `primaryFieldId`
- **Or handle both** (safest for now)

### 4. **Test with Real Data**
Before merging to develop:
- Test with HIPAA form
- Test with large dataset (>5K submissions)
- Test with missing fields (orphaned analysis)
- Test with various filter combinations

---

## 🚀 Next Steps

1. **Fix critical issues** (authorization, data inspection, field naming)
2. **Test locally** with real form data
3. **Update commit message** to reflect fixes
4. **Push to feature branch**
5. **Test on Railway** (after merge to develop)
6. **Frontend integration** (next phase)

---

## Severity Legend
- 🚨 **CRITICAL**: Must fix before push
- ⚠️ **HIGH**: Should fix before merge to develop
- 🔧 **MEDIUM**: Fix before production
- 🧹 **LOW**: Code quality improvement

---

**Overall Assessment**: Implementation is **75% ready**. With the critical fixes above, it will be **production-ready** for backend testing.

