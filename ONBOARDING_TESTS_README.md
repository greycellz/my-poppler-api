# Onboarding System Test Suite

This directory contains comprehensive test suites for the onboarding system database functions and API endpoints.

## 📁 Test Files

### 1. `test-onboarding-database.js`
Tests all database functions directly using the GCP client:
- Initialize onboarding progress
- Get/update user progress
- Task completion tracking
- Level progression logic
- Help article management
- Analytics logging
- Error handling

### 2. `test-onboarding-api.js`
Tests all API endpoints:
- POST `/api/onboarding/initialize`
- GET `/api/onboarding/progress/:userId`
- POST `/api/onboarding/complete-task`
- GET `/api/onboarding/help/:taskId`
- POST `/api/onboarding/help`
- GET `/api/onboarding/analytics/:userId`
- POST `/api/onboarding/log-event`

### 3. `test-onboarding-railway-api.js`
Tests the deployed Railway API endpoints:
- Quick validation of live API functionality
- End-to-end testing of the complete system
- Error handling verification

### 4. `run-onboarding-tests.js`
Master test runner that executes both database and API tests.

## 🚀 Running Tests

### Prerequisites
1. **Local Development**: Requires GCP credentials and local server running
2. **Railway Testing**: Requires deployed API on Railway

### Test Execution

#### Option 1: Test Railway API (Recommended)
```bash
# Test the deployed Railway API endpoints
node test-onboarding-railway-api.js
```

#### Option 2: Test Local Database Functions
```bash
# Test database functions directly (requires GCP credentials)
node test-onboarding-database.js
```

#### Option 3: Test Local API Endpoints
```bash
# Start local server first
npm start

# Then run API tests
node test-onboarding-api.js
```

#### Option 4: Run All Tests
```bash
# Run both database and API tests
node run-onboarding-tests.js
```

## 🧪 Test Coverage

### Database Tests
- ✅ User onboarding initialization
- ✅ Progress tracking and retrieval
- ✅ Task completion and level progression
- ✅ Achievement system
- ✅ Help article CRUD operations
- ✅ Analytics event logging
- ✅ Error handling and edge cases
- ✅ Progress calculation accuracy

### API Tests
- ✅ All endpoint functionality
- ✅ Request/response validation
- ✅ Error handling (400, 500 status codes)
- ✅ Concurrent request handling
- ✅ Invalid endpoint handling
- ✅ Data persistence verification

### Railway Tests
- ✅ Live API endpoint validation
- ✅ End-to-end functionality
- ✅ Production environment testing
- ✅ Error handling verification

## 📊 Expected Results

### Successful Test Run
```
🧪 Starting Railway Onboarding API Tests

🧪 Test 1: Initialize Onboarding...
✅ Initialize onboarding: PASSED

🧪 Test 2: Get Onboarding Progress...
✅ Get progress: PASSED

🧪 Test 3: Complete Task...
✅ Complete task: PASSED

🧪 Test 4: Create Help Article...
✅ Create help article: PASSED

🧪 Test 5: Get Help Article...
✅ Get help article: PASSED

🧪 Test 6: Log Event...
✅ Log event: PASSED

🧪 Test 7: Get Analytics...
✅ Get analytics: PASSED

🧪 Test 8: Error Handling...
✅ Error handling: PASSED

==================================================
📊 RAILWAY API TEST RESULTS
==================================================
✅ Tests Passed: 8
❌ Tests Failed: 0
📈 Success Rate: 100%

🎉 All Railway API tests passed! Onboarding system is ready.
```

## 🔧 Troubleshooting

### Common Issues

#### 1. GCP Credentials Error
```
Error: The incoming JSON object does not contain a client_email field
```
**Solution**: Ensure `GOOGLE_APPLICATION_CREDENTIALS_JSON` environment variable is set on Railway.

#### 2. API Connection Error
```
Error: connect ECONNREFUSED
```
**Solution**: Verify Railway deployment is running and API URL is correct.

#### 3. Database Collection Not Found
```
Error: Collection not found
```
**Solution**: Collections are created automatically on first write. Ensure GCP client is properly initialized.

#### 4. Test User Cleanup
Test users are created with timestamps to avoid conflicts. For manual cleanup:
```javascript
// Test user IDs follow pattern: test_*_timestamp
// Help task IDs follow pattern: test-*-task
```

## 📋 Test Data

### Test User Pattern
- Format: `test_[type]_user_[timestamp]`
- Example: `test_railway_user_1704067200000`

### Test Task Pattern
- Format: `test-[type]-task`
- Example: `railway-test-task`

### Test Help Article Pattern
- Format: `test-[type]-help`
- Example: `railway-test-help`

## 🎯 Next Steps After Testing

1. **If All Tests Pass**:
   - Run help articles population: `node populate-help-articles.js`
   - Begin frontend component development
   - Test with real user data

2. **If Tests Fail**:
   - Check Railway deployment logs
   - Verify GCP credentials configuration
   - Ensure database collections exist
   - Review error messages for specific issues

## 📝 Notes

- Tests use unique timestamps to avoid conflicts
- Database tests require GCP credentials
- API tests require running server
- Railway tests validate production deployment
- All tests include cleanup recommendations
- Test data is designed to be non-destructive
