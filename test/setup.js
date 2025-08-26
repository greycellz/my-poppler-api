/**
 * Jest Test Setup
 * Global test configuration and utilities
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLOUD_PROJECT = 'chatterforms-test';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  // Generate test data
  createTestFormData: () => ({
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'phone', label: 'Phone', type: 'tel', required: false }
    ],
    styling: {
      primaryColor: '#6366f1',
      fontFamily: 'Inter',
      borderRadius: '8px'
    }
  }),

  // Generate test submission data
  createTestSubmissionData: () => ({
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-0123'
  }),

  // Generate test metadata
  createTestMetadata: () => ({
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Test Browser)',
    timestamp: new Date().toISOString()
  }),

  // Mock GCP responses
  mockGCPResponses: {
    firestore: {
      success: { success: true },
      error: new Error('Firestore operation failed')
    },
    storage: {
      success: { success: true, url: 'gs://test-bucket/test-file' },
      error: new Error('Storage operation failed')
    },
    bigquery: {
      success: { success: true },
      error: new Error('BigQuery operation failed')
    },
    kms: {
      encrypt: { success: true, encryptedData: 'encrypted-test-data' },
      decrypt: { success: true, decryptedData: { test: 'data' } },
      error: new Error('KMS operation failed')
    }
  }
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
