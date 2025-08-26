/**
 * GCP Integration Tests
 * Tests with real GCP services (requires valid credentials)
 * 
 * To run these tests:
 * 1. Ensure service account keys are in the project root
 * 2. Set GOOGLE_CLOUD_PROJECT environment variable
 * 3. Run: npm run test:integration
 */

const GCPClient = require('../gcp-client');
const fs = require('fs');
const path = require('path');

// Skip integration tests if no credentials
const hasCredentials = fs.existsSync(path.join(__dirname, '../chatterforms-app-key.json'));

describe('GCP Integration Tests', () => {
  let gcpClient;

  beforeAll(() => {
    if (!hasCredentials) {
      console.log('⚠️  Skipping integration tests - no GCP credentials found');
      return;
    }
    gcpClient = new GCPClient();
  });

  describe('Firestore Integration', () => {
    test('should connect to Firestore and perform basic operations', async () => {
      if (!hasCredentials) {
        console.log('⏭️  Skipping Firestore integration test');
        return;
      }

      const testFormId = `test-form-${Date.now()}`;
      const testFormData = {
        fields: [
          { id: 'name', label: 'Name', type: 'text' },
          { id: 'email', label: 'Email', type: 'email' }
        ]
      };
      const testUserId = 'test-user-123';

      // Test storing form structure
      const storeResult = await gcpClient.storeFormStructure(
        testFormId,
        testFormData,
        testUserId,
        { isHipaa: false, isPublished: true }
      );

      expect(storeResult.success).toBe(true);
      expect(storeResult.formId).toBe(testFormId);

      console.log(`✅ Firestore integration test passed - stored form: ${testFormId}`);
    }, 30000);
  });

  describe('Cloud Storage Integration', () => {
    test('should upload test file to Cloud Storage', async () => {
      if (!hasCredentials) {
        console.log('⏭️  Skipping Cloud Storage integration test');
        return;
      }

      // Create a test file
      const testFilePath = path.join(__dirname, 'test-file.txt');
      const testContent = 'This is a test file for GCP integration testing';
      fs.writeFileSync(testFilePath, testContent);

      try {
        const destination = `test-uploads/test-file-${Date.now()}.txt`;
        const result = await gcpClient.uploadFile(testFilePath, destination);

        expect(result.success).toBe(true);
        expect(result.url).toContain('gs://chatterforms-uploads-us-central1');
        expect(result.url).toContain(destination);

        console.log(`✅ Cloud Storage integration test passed - uploaded: ${destination}`);
      } finally {
        // Clean up test file
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    }, 30000);
  });

  describe('BigQuery Integration', () => {
    test('should insert test data into BigQuery', async () => {
      if (!hasCredentials) {
        console.log('⏭️  Skipping BigQuery integration test');
        return;
      }

      const testSubmissionData = {
        submission_id: `test-sub-${Date.now()}`,
        form_id: 'test-form-integration',
        user_id: 'test-user-integration',
        submission_data: { name: 'Test User', email: 'test@example.com' },
        timestamp: new Date(),
        ip_address: '127.0.0.1',
        user_agent: 'Integration Test Agent',
        is_hipaa: false,
        encrypted: false,
      };

      const result = await gcpClient.insertSubmissionAnalytics(testSubmissionData);

      expect(result.success).toBe(true);
      console.log(`✅ BigQuery integration test passed - inserted submission: ${testSubmissionData.submission_id}`);
    }, 30000);
  });

  describe('KMS Integration', () => {
    test('should encrypt and decrypt data using KMS', async () => {
      if (!hasCredentials) {
        console.log('⏭️  Skipping KMS integration test');
        return;
      }

      const testData = {
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '+1-555-0123',
        timestamp: new Date().toISOString()
      };

      // Test encryption
      const encryptResult = await gcpClient.encryptData(testData, 'form-data-key');
      expect(encryptResult.success).toBe(true);
      expect(encryptResult.encryptedData).toBeDefined();

      // Test decryption
      const decryptResult = await gcpClient.decryptData(encryptResult.encryptedData, 'form-data-key');
      expect(decryptResult.success).toBe(true);
      expect(decryptResult.decryptedData).toEqual(testData);

      console.log('✅ KMS integration test passed - encryption/decryption successful');
    }, 30000);
  });

  describe('End-to-End HIPAA Workflow', () => {
    test('should process HIPAA submission end-to-end', async () => {
      if (!hasCredentials) {
        console.log('⏭️  Skipping HIPAA workflow integration test');
        return;
      }

      const submissionId = `hipaa-test-${Date.now()}`;
      const formId = 'hipaa-test-form';
      const formData = {
        patientName: 'Jane Smith',
        dateOfBirth: '1990-01-01',
        medicalHistory: 'No known allergies',
        contactInfo: {
          phone: '+1-555-0124',
          email: 'jane.smith@example.com'
        }
      };
      const userId = 'hipaa-test-user';
      const metadata = {
        ipAddress: '127.0.0.1',
        userAgent: 'HIPAA Test Agent',
        isHipaa: true
      };

      const result = await gcpClient.processHipaaSubmission(
        submissionId,
        formId,
        formData,
        userId,
        metadata
      );

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe(submissionId);

      console.log(`✅ HIPAA workflow integration test passed - processed submission: ${submissionId}`);
    }, 60000); // Longer timeout for end-to-end test
  });
});
