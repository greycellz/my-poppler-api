/**
 * GCP Client for ChatterForms Railway Backend
 * Handles Firestore, BigQuery, Cloud Storage, and KMS operations
 */

const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');
const { KeyManagementServiceClient } = require('@google-cloud/kms');
const path = require('path');

class GCPClient {
  constructor() {
    this.projectId = 'chatterforms';
    this.region = 'us-central1';
    
    // Initialize GCP clients
    this.initializeClients();
  }

  initializeClients() {
    try {
      // Set up authentication for Railway environment
      let credentials;
      
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        // Use environment variable (Railway)
        credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      } else {
        // Use key file (local development)
        const keyPath = path.join(__dirname, 'chatterforms-app-key.json');
        if (!fs.existsSync(keyPath)) {
          throw new Error('GCP credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable or place chatterforms-app-key.json in project root.');
        }
        credentials = keyPath;
      }
      
      // Initialize Firestore
      this.firestore = new Firestore({
        projectId: this.projectId,
        credentials: credentials,
      });

      // Initialize Cloud Storage
      this.storage = new Storage({
        projectId: this.projectId,
        credentials: credentials,
      });

      // Initialize BigQuery
      this.bigquery = new BigQuery({
        projectId: this.projectId,
        credentials: credentials,
      });

      // Initialize KMS
      this.kmsClient = new KeyManagementServiceClient({
        credentials: credentials,
      });

      console.log('✅ GCP clients initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing GCP clients:', error);
      throw error;
    }
  }

  // ============== FIRESTORE OPERATIONS ==============

  /**
   * Store form structure in Firestore
   */
  async storeFormStructure(formId, formData, userId, metadata = {}) {
    try {
      const formDoc = {
        form_id: formId,
        user_id: userId,
        structure: formData,
        metadata: {
          ...metadata,
          created_at: new Date(),
          updated_at: new Date(),
        },
        is_hipaa: metadata.isHipaa || false,
        is_published: metadata.isPublished || false,
      };

      await this.firestore
        .collection('forms')
        .doc(formId)
        .set(formDoc);

      console.log(`✅ Form structure stored: ${formId}`);
      return { success: true, formId };
    } catch (error) {
      console.error('❌ Error storing form structure:', error);
      throw error;
    }
  }

  /**
   * Store form submission in Firestore
   */
  async storeFormSubmission(submissionId, formId, formData, userId, metadata = {}) {
    try {
      const submissionDoc = {
        submission_id: submissionId,
        form_id: formId,
        user_id: userId,
        submission_data: formData,
        timestamp: new Date(),
        ip_address: metadata.ipAddress,
        user_agent: metadata.userAgent,
        is_hipaa: metadata.isHipaa || false,
        encrypted: false, // Will be encrypted by KMS
      };

      await this.firestore
        .collection('submissions')
        .doc(submissionId)
        .set(submissionDoc);

      console.log(`✅ Form submission stored: ${submissionId}`);
      return { success: true, submissionId };
    } catch (error) {
      console.error('❌ Error storing form submission:', error);
      throw error;
    }
  }

  // ============== CLOUD STORAGE OPERATIONS ==============

  /**
   * Upload file to Cloud Storage
   */
  async uploadFile(filePath, destination, bucketName = 'chatterforms-uploads-us-central1') {
    try {
      const bucket = this.storage.bucket(bucketName);
      const [file] = await bucket.upload(filePath, {
        destination,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      console.log(`✅ File uploaded: ${destination}`);
      return {
        success: true,
        url: `gs://${bucketName}/${destination}`,
        publicUrl: `https://storage.googleapis.com/${bucketName}/${destination}`,
      };
    } catch (error) {
      console.error('❌ Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Upload form submission data to Cloud Storage
   */
  async uploadSubmissionData(submissionId, data, isHipaa = false) {
    try {
      const bucketName = isHipaa 
        ? 'chatterforms-submissions-us-central1' 
        : 'chatterforms-uploads-us-central1';
      
      const bucket = this.storage.bucket(bucketName);
      const destination = `submissions/${submissionId}/data.json`;
      
      const file = bucket.file(destination);
      await file.save(JSON.stringify(data), {
        metadata: {
          contentType: 'application/json',
          metadata: {
            submissionId,
            isHipaa: isHipaa.toString(),
            timestamp: new Date().toISOString(),
          },
        },
      });

      console.log(`✅ Submission data uploaded: ${destination}`);
      return {
        success: true,
        url: `gs://${bucketName}/${destination}`,
      };
    } catch (error) {
      console.error('❌ Error uploading submission data:', error);
      throw error;
    }
  }

  // ============== BIGQUERY OPERATIONS ==============

  /**
   * Insert form submission into BigQuery
   */
  async insertSubmissionAnalytics(submissionData) {
    try {
      const dataset = this.bigquery.dataset('form_submissions');
      const table = dataset.table('submissions');

      const rows = [{
        submission_id: submissionData.submission_id,
        form_id: submissionData.form_id,
        user_id: submissionData.user_id,
        submission_data: JSON.stringify(submissionData.submission_data),
        timestamp: submissionData.timestamp,
        ip_address: submissionData.ip_address,
        user_agent: submissionData.user_agent,
        is_hipaa: submissionData.is_hipaa,
        encrypted: submissionData.encrypted,
      }];

      await table.insert(rows);
      console.log(`✅ Analytics data inserted: ${submissionData.submission_id}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error inserting analytics data:', error);
      throw error;
    }
  }

  /**
   * Update form analytics
   */
  async updateFormAnalytics(formId, userId, submissionCount = 1) {
    try {
      const dataset = this.bigquery.dataset('form_submissions');
      const table = dataset.table('form_analytics');

      const query = `
        INSERT INTO \`${this.projectId}.form_submissions.form_analytics\`
        (form_id, form_name, created_at, submissions_count, last_submission, is_hipaa, is_published, user_id)
        VALUES (@formId, @formName, @createdAt, @submissionsCount, @lastSubmission, @isHipaa, @isPublished, @userId)
        ON DUPLICATE KEY UPDATE
        submissions_count = submissions_count + @submissionsCount,
        last_submission = @lastSubmission
      `;

      const options = {
        query,
        params: {
          formId,
          formName: `Form ${formId}`,
          createdAt: new Date(),
          submissionsCount: submissionCount,
          lastSubmission: new Date(),
          isHipaa: false,
          isPublished: true,
          userId,
        },
      };

      await this.bigquery.query(options);
      console.log(`✅ Form analytics updated: ${formId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating form analytics:', error);
      throw error;
    }
  }

  // ============== KMS OPERATIONS ==============

  /**
   * Encrypt data using KMS
   */
  async encryptData(data, keyName = 'form-data-key') {
    try {
      const keyPath = this.kmsClient.cryptoKeyPath(
        this.projectId,
        this.region,
        'chatterforms-keys',
        keyName
      );

      const [result] = await this.kmsClient.encrypt({
        name: keyPath,
        plaintext: Buffer.from(JSON.stringify(data)).toString('base64'),
      });

      console.log(`✅ Data encrypted with key: ${keyName}`);
      return {
        success: true,
        encryptedData: result.ciphertext,
      };
    } catch (error) {
      console.error('❌ Error encrypting data:', error);
      throw error;
    }
  }

  /**
   * Decrypt data using KMS
   */
  async decryptData(encryptedData, keyName = 'form-data-key') {
    try {
      const keyPath = this.kmsClient.cryptoKeyPath(
        this.projectId,
        this.region,
        'chatterforms-keys',
        keyName
      );

      const [result] = await this.kmsClient.decrypt({
        name: keyPath,
        ciphertext: encryptedData,
      });

      const decryptedData = JSON.parse(
        Buffer.from(result.plaintext, 'base64').toString()
      );

      console.log(`✅ Data decrypted with key: ${keyName}`);
      return {
        success: true,
        decryptedData,
      };
    } catch (error) {
      console.error('❌ Error decrypting data:', error);
      throw error;
    }
  }

  // ============== HIPAA COMPLIANCE ==============

  /**
   * Process HIPAA-compliant form submission
   */
  async processHipaaSubmission(submissionId, formId, formData, userId, metadata) {
    try {
      // Encrypt sensitive data
      const encryptedData = await this.encryptData(formData, 'hipaa-data-key');

      // Store encrypted submission
      await this.storeFormSubmission(
        submissionId,
        formId,
        encryptedData.encryptedData,
        userId,
        { ...metadata, isHipaa: true, encrypted: true }
      );

      // Upload to HIPAA-compliant storage
      await this.uploadSubmissionData(submissionId, formData, true);

      // Update analytics (without sensitive data)
      await this.updateFormAnalytics(formId, userId);

      console.log(`✅ HIPAA submission processed: ${submissionId}`);
      return { success: true, submissionId };
    } catch (error) {
      console.error('❌ Error processing HIPAA submission:', error);
      throw error;
    }
  }
}

module.exports = GCPClient;
