# GCP Integration Testing Guide

## Overview
This guide covers how to test the GCP integration in the Railway backend, including unit tests, integration tests, and end-to-end workflows.

## 🧪 Test Types

### 1. Unit Tests (Mocked)
- **Purpose**: Test individual functions without real GCP services
- **Speed**: Fast execution
- **Cost**: No GCP charges
- **Coverage**: Function logic, error handling, edge cases

### 2. Integration Tests (Real GCP)
- **Purpose**: Test with actual GCP services
- **Speed**: Slower (network calls)
- **Cost**: Minimal GCP charges
- **Coverage**: Real service interactions, authentication, permissions

### 3. End-to-End Tests
- **Purpose**: Test complete workflows
- **Speed**: Slowest
- **Cost**: Some GCP charges
- **Coverage**: Full user journeys, HIPAA compliance

## 🚀 Running Tests

### Prerequisites
1. **Service Account Keys**: Ensure `chatterforms-*-key.json` files are in the project root
2. **Environment Variables**: Set `GOOGLE_CLOUD_PROJECT=chatterforms`
3. **Dependencies**: Run `npm install` to install test dependencies

### Test Commands

```bash
# Run all tests (unit + integration)
npm test

# Run only unit tests (mocked)
npm run test:gcp

# Run only integration tests (real GCP)
npm run test:integration

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## 📋 Test Coverage

### Unit Tests (`test/gcp-client.test.js`)
- ✅ **GCP Client Initialization**
- ✅ **Firestore Operations**
  - Store form structure
  - Store form submission
- ✅ **Cloud Storage Operations**
  - File uploads
  - Submission data upload
- ✅ **BigQuery Operations**
  - Analytics data insertion
  - Form analytics updates
- ✅ **KMS Operations**
  - Data encryption
  - Data decryption
- ✅ **HIPAA Compliance**
  - End-to-end HIPAA workflow

### Integration Tests (`test/gcp-integration.test.js`)
- ✅ **Real Firestore Connection**
- ✅ **Real Cloud Storage Upload**
- ✅ **Real BigQuery Insertion**
- ✅ **Real KMS Encryption/Decryption**
- ✅ **End-to-End HIPAA Workflow**

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/test/**',
    '!**/coverage/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  testTimeout: 30000, // 30 seconds for GCP operations
};
```

### Test Setup (`test/setup.js`)
- Environment variables for testing
- Console mocking to reduce noise
- Global test utilities
- Mock GCP responses

## 🧪 Test Utilities

### Global Test Utilities
```javascript
// Generate test form data
const formData = testUtils.createTestFormData();

// Generate test submission data
const submissionData = testUtils.createTestSubmissionData();

// Generate test metadata
const metadata = testUtils.createTestMetadata();

// Access mock GCP responses
const mockResponses = testUtils.mockGCPResponses;
```

## 🔍 Debugging Tests

### Common Issues

1. **Authentication Errors**
   ```bash
   # Check if service account keys exist
   ls -la chatterforms-*-key.json
   
   # Verify project ID
   echo $GOOGLE_CLOUD_PROJECT
   ```

2. **Permission Errors**
   ```bash
   # Check service account permissions
   gcloud projects get-iam-policy chatterforms
   ```

3. **Network Timeouts**
   ```bash
   # Increase timeout in jest.config.js
   testTimeout: 60000
   ```

### Debug Mode
```bash
# Run specific test with verbose output
npm test -- --verbose test/gcp-client.test.js

# Run with debug logging
DEBUG=* npm test
```

## 📊 Test Results

### Coverage Report
After running `npm run test:coverage`, check:
- `coverage/lcov-report/index.html` - HTML coverage report
- `coverage/lcov.info` - Coverage data for CI/CD

### Test Output
```
✅ GCP clients initialized successfully
✅ Form structure stored: test-form-123
✅ File uploaded: test-uploads/test-file.txt
✅ Analytics data inserted: test-sub-123
✅ Data encrypted with key: form-data-key
✅ HIPAA submission processed: hipaa-test-123
```

## 🚨 Important Notes

### Security
- Service account keys are in `.gitignore`
- Never commit real credentials to version control
- Use environment variables in production

### Costs
- Integration tests use real GCP services
- Costs are minimal but not zero
- Monitor usage in GCP Console

### Data Cleanup
- Integration tests create real data in GCP
- Consider implementing cleanup scripts
- Test data is marked with timestamps for identification

## 🔄 Continuous Integration

### GitHub Actions Example
```yaml
name: GCP Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:gcp  # Unit tests only
      # Integration tests require GCP credentials
```

## 📈 Performance Testing

### Load Testing
```bash
# Test with multiple concurrent requests
npm run test:load

# Monitor GCP resource usage
gcloud monitoring dashboards list
```

### Benchmarking
```bash
# Measure operation performance
npm run test:benchmark
```

## 🎯 Next Steps

1. **Run Unit Tests**: `npm run test:gcp`
2. **Run Integration Tests**: `npm run test:integration`
3. **Check Coverage**: `npm run test:coverage`
4. **Fix Any Issues**: Address failing tests
5. **Deploy**: Once all tests pass

## 📞 Support

If you encounter issues:
1. Check the test output for specific error messages
2. Verify GCP credentials and permissions
3. Check network connectivity
4. Review GCP Console for service status
