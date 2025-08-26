/**
 * GCP Client Tests
 * Tests for Firestore, BigQuery, Cloud Storage, and KMS operations
 */

const GCPClient = require('../gcp-client');
const path = require('path');

// Mock GCP services for testing
jest.mock('@google-cloud/firestore');
jest.mock('@google-cloud/storage');
jest.mock('@google-cloud/bigquery');
jest.mock('@google-cloud/kms');

describe('GCPClient', () => {
  let gcpClient;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset mocks to default behavior
    const { Firestore } = require('@google-cloud/firestore');
    const { Storage } = require('@google-cloud/storage');
    const { BigQuery } = require('@google-cloud/bigquery');
    const { KeyManagementServiceClient } = require('@google-cloud/kms');
    
    // Mock successful initialization
    Firestore.mockImplementation(() => ({}));
    Storage.mockImplementation(() => ({}));
    BigQuery.mockImplementation(() => ({}));
    KeyManagementServiceClient.mockImplementation(() => ({}));
    
    gcpClient = new GCPClient();
  });

  describe('Initialization', () => {
    test('should initialize GCP clients successfully', () => {
      expect(gcpClient.projectId).toBe('chatterforms');
      expect(gcpClient.region).toBe('us-central1');
      expect(gcpClient.firestore).toBeDefined();
      expect(gcpClient.storage).toBeDefined();
      expect(gcpClient.bigquery).toBeDefined();
      expect(gcpClient.kmsClient).toBeDefined();
    });

    test('should handle initialization errors gracefully', () => {
      // Mock a failure scenario for this specific test
      const { Firestore } = require('@google-cloud/firestore');
      Firestore.mockImplementationOnce(() => {
        throw new Error('Firestore initialization failed');
      });

      expect(() => new GCPClient()).toThrow('Firestore initialization failed');
    });
  });

  describe('Firestore Operations', () => {
    test('should store form structure successfully', async () => {
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ set: mockSet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;

      const formId = 'test-form-123';
      const formData = { fields: ['name', 'email'] };
      const userId = 'user-123';
      const metadata = { isHipaa: false, isPublished: true };

      const result = await gcpClient.storeFormStructure(formId, formData, userId, metadata);

      expect(result.success).toBe(true);
      expect(result.formId).toBe(formId);
      expect(mockCollection).toHaveBeenCalledWith('forms');
      expect(mockDoc).toHaveBeenCalledWith(formId);
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
        form_id: formId,
        user_id: userId,
        structure: formData,
        is_hipaa: false,
        is_published: true,
      }));
    });

    test('should store form submission successfully', async () => {
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ set: mockSet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;

      const submissionId = 'sub-123';
      const formId = 'form-123';
      const formData = { name: 'John', email: 'john@example.com' };
      const userId = 'user-123';
      const metadata = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };

      const result = await gcpClient.storeFormSubmission(submissionId, formId, formData, userId, metadata);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe(submissionId);
      expect(mockCollection).toHaveBeenCalledWith('submissions');
      expect(mockDoc).toHaveBeenCalledWith(submissionId);
    });
  });

  describe('Cloud Storage Operations', () => {
    test('should upload file successfully', async () => {
      const mockUpload = jest.fn().mockResolvedValue([{ name: 'test-file.png' }]);
      const mockBucket = jest.fn().mockReturnValue({ upload: mockUpload });
      gcpClient.storage.bucket = mockBucket;

      const filePath = '/tmp/test-file.png';
      const destination = 'uploads/test-file.png';
      const bucketName = 'chatterforms-uploads-us-central1';

      const result = await gcpClient.uploadFile(filePath, destination, bucketName);

      expect(result.success).toBe(true);
      expect(result.url).toBe(`gs://${bucketName}/${destination}`);
      expect(mockBucket).toHaveBeenCalledWith(bucketName);
      expect(mockUpload).toHaveBeenCalledWith(filePath, {
        destination,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });
    });

    test('should upload submission data successfully', async () => {
      const mockSave = jest.fn().mockResolvedValue();
      const mockFile = jest.fn().mockReturnValue({ save: mockSave });
      const mockBucket = jest.fn().mockReturnValue({ file: mockFile });
      gcpClient.storage.bucket = mockBucket;

      const submissionId = 'sub-123';
      const data = { name: 'John', email: 'john@example.com' };
      const isHipaa = true;

      const result = await gcpClient.uploadSubmissionData(submissionId, data, isHipaa);

      expect(result.success).toBe(true);
      expect(mockBucket).toHaveBeenCalledWith('chatterforms-submissions-us-central1');
      expect(mockFile).toHaveBeenCalledWith('submissions/sub-123/data.json');
    });
  });

  describe('BigQuery Operations', () => {
    test('should insert submission analytics successfully', async () => {
      const mockInsert = jest.fn().mockResolvedValue();
      const mockTable = jest.fn().mockReturnValue({ insert: mockInsert });
      const mockDataset = jest.fn().mockReturnValue({ table: mockTable });
      gcpClient.bigquery.dataset = mockDataset;

      const submissionData = {
        submission_id: 'sub-123',
        form_id: 'form-123',
        user_id: 'user-123',
        submission_data: { name: 'John' },
        timestamp: new Date(),
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        is_hipaa: false,
        encrypted: false,
      };

      const result = await gcpClient.insertSubmissionAnalytics(submissionData);

      expect(result.success).toBe(true);
      expect(mockDataset).toHaveBeenCalledWith('form_submissions');
      expect(mockTable).toHaveBeenCalledWith('submissions');
      expect(mockInsert).toHaveBeenCalledWith([expect.objectContaining({
        submission_id: 'sub-123',
        form_id: 'form-123',
      })]);
    });
  });

  describe('KMS Operations', () => {
    test('should encrypt data successfully', async () => {
      const mockEncrypt = jest.fn().mockResolvedValue([{ ciphertext: 'encrypted-data' }]);
      const mockCryptoKeyPath = jest.fn().mockReturnValue('projects/chatterforms/locations/us-central1/keyRings/chatterforms-keys/cryptoKeys/form-data-key');
      gcpClient.kmsClient.encrypt = mockEncrypt;
      gcpClient.kmsClient.cryptoKeyPath = mockCryptoKeyPath;

      const data = { name: 'John', email: 'john@example.com' };
      const keyName = 'form-data-key';

      const result = await gcpClient.encryptData(data, keyName);

      expect(result.success).toBe(true);
      expect(result.encryptedData).toBe('encrypted-data');
      expect(mockCryptoKeyPath).toHaveBeenCalledWith(
        'chatterforms',
        'us-central1',
        'chatterforms-keys',
        'form-data-key'
      );
    });

    test('should decrypt data successfully', async () => {
      const mockDecrypt = jest.fn().mockResolvedValue([{ plaintext: Buffer.from(JSON.stringify({ name: 'John' })).toString('base64') }]);
      const mockCryptoKeyPath = jest.fn().mockReturnValue('projects/chatterforms/locations/us-central1/keyRings/chatterforms-keys/cryptoKeys/form-data-key');
      gcpClient.kmsClient.decrypt = mockDecrypt;
      gcpClient.kmsClient.cryptoKeyPath = mockCryptoKeyPath;

      const encryptedData = 'encrypted-data';
      const keyName = 'form-data-key';

      const result = await gcpClient.decryptData(encryptedData, keyName);

      expect(result.success).toBe(true);
      expect(result.decryptedData).toEqual({ name: 'John' });
    });
  });

  describe('HIPAA Compliance', () => {
    test('should process HIPAA submission successfully', async () => {
      // Mock all the required methods
      const mockEncrypt = jest.fn().mockResolvedValue({ success: true, encryptedData: 'encrypted-data' });
      const mockStoreSubmission = jest.fn().mockResolvedValue({ success: true, submissionId: 'sub-123' });
      const mockUploadSubmission = jest.fn().mockResolvedValue({ success: true });
      const mockUpdateAnalytics = jest.fn().mockResolvedValue({ success: true });

      gcpClient.encryptData = mockEncrypt;
      gcpClient.storeFormSubmission = mockStoreSubmission;
      gcpClient.uploadSubmissionData = mockUploadSubmission;
      gcpClient.updateFormAnalytics = mockUpdateAnalytics;

      const submissionId = 'sub-123';
      const formId = 'form-123';
      const formData = { name: 'John', email: 'john@example.com' };
      const userId = 'user-123';
      const metadata = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };

      const result = await gcpClient.processHipaaSubmission(submissionId, formId, formData, userId, metadata);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe('sub-123');
      expect(mockEncrypt).toHaveBeenCalledWith(formData, 'hipaa-data-key');
      expect(mockStoreSubmission).toHaveBeenCalledWith(
        submissionId,
        formId,
        'encrypted-data',
        userId,
        expect.objectContaining({ isHipaa: true, encrypted: true })
      );
      expect(mockUploadSubmission).toHaveBeenCalledWith(submissionId, formData, true);
      expect(mockUpdateAnalytics).toHaveBeenCalledWith(formId, userId);
    });
  });
});
