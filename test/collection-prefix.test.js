/**
 * Comprehensive Test Suite for Collection Prefix Implementation
 * 
 * Tests:
 * 1. Helper function behavior with different environment variables
 * 2. Collection access patterns for each environment
 * 3. Data isolation between environments
 * 4. Integration tests for CRUD operations
 * 5. Edge cases and error handling
 */

const GCPClient = require('../gcp-client');

describe('Collection Prefix Implementation', () => {
  let gcpClient;
  const originalEnv = process.env.RAILWAY_ENVIRONMENT_NAME;

  beforeEach(() => {
    gcpClient = new GCPClient();
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv) {
      process.env.RAILWAY_ENVIRONMENT_NAME = originalEnv;
    } else {
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
    }
  });

  describe('Helper Function Tests', () => {
    test('getCollectionName() returns dev_ prefix for dev environment', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      expect(gcpClient.getCollectionName('users')).toBe('dev_users');
      expect(gcpClient.getCollectionName('forms')).toBe('dev_forms');
      expect(gcpClient.getCollectionName('submissions')).toBe('dev_submissions');
    });

    test('getCollectionName() returns staging_ prefix for staging environment', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
      const gcpClient = new GCPClient();
      
      expect(gcpClient.getCollectionName('users')).toBe('staging_users');
      expect(gcpClient.getCollectionName('forms')).toBe('staging_forms');
      expect(gcpClient.getCollectionName('submissions')).toBe('staging_submissions');
    });

    test('getCollectionName() returns no prefix for production environment', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
      const gcpClient = new GCPClient();
      
      expect(gcpClient.getCollectionName('users')).toBe('users');
      expect(gcpClient.getCollectionName('forms')).toBe('forms');
      expect(gcpClient.getCollectionName('submissions')).toBe('submissions');
    });

    test('getCollectionName() returns no prefix when RAILWAY_ENVIRONMENT_NAME is not set', () => {
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
      const gcpClient = new GCPClient();
      
      expect(gcpClient.getCollectionName('users')).toBe('users');
      expect(gcpClient.getCollectionName('forms')).toBe('forms');
    });

    test('getCollectionName() handles all 16 collections correctly', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const collections = [
        'users', 'forms', 'submissions', 'anonymousSessions',
        'baa-agreements', 'emailVerificationTokens', 'passwordResetTokens',
        'user_logos', 'form_images', 'payment_fields', 'user_stripe_accounts',
        'onboarding_analytics', 'help_articles', 'calendar_fields',
        'calendar_bookings', 'user_calendly_accounts'
      ];
      
      collections.forEach(collection => {
        expect(gcpClient.getCollectionName(collection)).toBe(`dev_${collection}`);
      });
    });

    test('getCollectionName() handles invalid environment name gracefully', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'invalid';
      const gcpClient = new GCPClient();
      
      // Should default to no prefix for invalid environment
      expect(gcpClient.getCollectionName('users')).toBe('users');
    });
  });

  describe('Collection Access Tests', () => {
    test('collection() method returns Firestore collection reference with prefix', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockCollection = jest.fn();
      gcpClient.firestore.collection = mockCollection;
      
      gcpClient.collection('users');
      
      expect(mockCollection).toHaveBeenCalledWith('dev_users');
    });

    test('collection() method works for staging environment', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
      const gcpClient = new GCPClient();
      
      const mockCollection = jest.fn();
      gcpClient.firestore.collection = mockCollection;
      
      gcpClient.collection('forms');
      
      expect(mockCollection).toHaveBeenCalledWith('staging_forms');
    });

    test('collection() method works for production environment', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
      const gcpClient = new GCPClient();
      
      const mockCollection = jest.fn();
      gcpClient.firestore.collection = mockCollection;
      
      gcpClient.collection('submissions');
      
      expect(mockCollection).toHaveBeenCalledWith('submissions');
    });

    test('collection() method chains correctly with Firestore methods', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockDoc = jest.fn().mockReturnValue({ get: jest.fn() });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      gcpClient.collection('users').doc('user123').get();
      
      expect(mockCollection).toHaveBeenCalledWith('dev_users');
      expect(mockDoc).toHaveBeenCalledWith('user123');
    });
  });

  describe('Data Isolation Tests', () => {
    test('dev environment writes to dev_ prefixed collections', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ set: mockSet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.collection('users').doc('test123').set({ name: 'Test' });
      
      expect(mockCollection).toHaveBeenCalledWith('dev_users');
    });

    test('staging environment writes to staging_ prefixed collections', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ set: mockSet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.collection('forms').doc('form123').set({ title: 'Test Form' });
      
      expect(mockCollection).toHaveBeenCalledWith('staging_forms');
    });

    test('production environment writes to non-prefixed collections', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ set: mockSet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.collection('submissions').doc('sub123').set({ data: 'test' });
      
      expect(mockCollection).toHaveBeenCalledWith('submissions');
    });
  });

  describe('Integration Tests', () => {
    test('storeFormStructure uses correct collection name', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockGet = jest.fn().mockResolvedValue({ 
        exists: false,
        data: () => null
      });
      const mockDoc = jest.fn().mockReturnValue({ 
        set: mockSet,
        get: mockGet
      });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.storeFormStructure('form123', { title: 'Test' }, 'user123', {});
      
      // Should check dev_forms collection
      expect(mockCollection).toHaveBeenCalledWith('dev_forms');
    });

    test('storeFormSubmission uses correct collection name', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({}) });
      const mockDoc = jest.fn().mockReturnValue({ 
        set: mockSet,
        get: mockGet
      });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.storeFormSubmission('sub123', 'form123', { name: 'Test' }, 'user123', {});
      
      // Should write to dev_submissions collection
      expect(mockCollection).toHaveBeenCalledWith('dev_submissions');
    });

    test('createUser uses correct collection name', async () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockSet = jest.fn().mockResolvedValue();
      const mockDoc = jest.fn().mockReturnValue({ 
        id: 'user123',
        set: mockSet
      });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      gcpClient.firestore.collection = mockCollection;
      
      await gcpClient.createUser({ email: 'test@example.com' });
      
      // Should write to dev_users collection
      expect(mockCollection).toHaveBeenCalledWith('dev_users');
    });
  });

  describe('Edge Case Tests', () => {
    test('handles collection names with special characters', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      // Test with hyphenated collection name
      expect(gcpClient.getCollectionName('baa-agreements')).toBe('dev_baa-agreements');
      expect(gcpClient.getCollectionName('user_logos')).toBe('dev_user_logos');
    });

    test('handles empty collection name gracefully', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      expect(gcpClient.getCollectionName('')).toBe('dev_');
    });

    test('collection() method works with query chains', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const mockWhere = jest.fn().mockReturnValue({ get: jest.fn() });
      const mockCollection = jest.fn().mockReturnValue({ where: mockWhere });
      gcpClient.firestore.collection = mockCollection;
      
      gcpClient.collection('users').where('email', '==', 'test@example.com').get();
      
      expect(mockCollection).toHaveBeenCalledWith('dev_users');
      expect(mockWhere).toHaveBeenCalledWith('email', '==', 'test@example.com');
    });
  });

  describe('Migration Compatibility Tests', () => {
    test('all 16 collections are handled by helper method', () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = 'dev';
      const gcpClient = new GCPClient();
      
      const allCollections = [
        'users', 'forms', 'submissions', 'anonymousSessions',
        'baa-agreements', 'emailVerificationTokens', 'passwordResetTokens',
        'user_logos', 'form_images', 'payment_fields', 'user_stripe_accounts',
        'onboarding_analytics', 'help_articles', 'calendar_fields',
        'calendar_bookings', 'user_calendly_accounts'
      ];
      
      allCollections.forEach(collection => {
        const prefixed = gcpClient.getCollectionName(collection);
        expect(prefixed).toBe(`dev_${collection}`);
        expect(prefixed).toContain(collection); // Ensure original name is preserved
      });
    });
  });
});

