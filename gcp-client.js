/**
 * GCP Client for ChatterForms Railway Backend
 * Handles Firestore, BigQuery, Cloud Storage, and KMS operations
 */

const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');
const { KeyManagementServiceClient } = require('@google-cloud/kms');
const PDFGenerator = require('./pdf-generator');
const path = require('path');
const fs = require('fs');

class GCPClient {
  constructor() {
    this.projectId = 'chatterforms';
    this.region = 'us-central1';
    
    // Initialize GCP clients
    this.initializeClients();
    
    // Initialize PDF generator with this GCP client
    this.pdfGenerator = new PDFGenerator(this);
  }

  initializeClients() {
    try {
      // Set up authentication for Railway environment
      let credentials;
      
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        // Use environment variable (Railway)
        try {
          credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
          console.log('✅ GCP credentials loaded from environment variable');
          console.log('🔑 Service Account Email:', credentials.client_email);
        } catch (error) {
          console.error('❌ Error parsing GCP credentials JSON:', error.message);
          throw new Error('Invalid GCP credentials JSON format');
        }
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
      // Validate formId
      if (!formId || typeof formId !== 'string' || formId.trim() === '') {
        throw new Error(`Invalid formId: ${formId} (type: ${typeof formId})`);
      }
      // Handle anonymous users by generating temporary user ID
      let finalUserId = userId;
      let isAnonymous = false;
      let anonymousSessionId = null;

      if (!userId || userId === 'anonymous') {
        // Generate a new temporary user ID for anonymous users
        finalUserId = this.generateTemporaryUserId();
        isAnonymous = true;
        anonymousSessionId = finalUserId.replace('temp_', '');
        
        // Create or update anonymous session
        await this.createAnonymousSession(
          anonymousSessionId,
          metadata.userAgent || 'unknown',
          metadata.ipAddress || 'unknown'
        );
      }

      // Check if this is an update (form already exists)
      const existingDoc = await this.firestore
        .collection('forms')
        .doc(formId)
        .get();

      const isUpdate = existingDoc.exists;
      const existingData = existingDoc.data();

      // Decide where to write: auto-save writes to draft_structure only
      const isAutoSave = (metadata?.source === 'auto-save');
      
      console.log(`🔍 storeFormStructure debug:`, {
        formId,
        source: metadata?.source,
        isAutoSave,
        isUpdate,
        formDataTitle: formData?.title
      });

      const formDoc = {
        form_id: formId,
        user_id: finalUserId,
        // Keep published structure intact on auto-save; otherwise update it
        structure: isAutoSave ? (existingData?.structure || formData) : formData,
        // Maintain a separate draft copy that auto-save updates
        draft_structure: formData,
        metadata: {
          ...existingData?.metadata,
          ...metadata,
          created_at: isUpdate && existingData?.metadata?.created_at 
            ? existingData.metadata.created_at 
            : new Date(),
          updated_at: new Date(),
        },
        is_hipaa: metadata.isHipaa || existingData?.is_hipaa || false,
        is_published: metadata.isPublished ?? existingData?.is_published ?? false,
        isAnonymous: existingData?.isAnonymous || isAnonymous,
        anonymousSessionId: existingData?.anonymousSessionId || anonymousSessionId
      };

      console.log(`🔍 About to store formDoc:`, {
        structureTitle: formDoc.structure?.title,
        draftStructureTitle: formDoc.draft_structure?.title,
        isAutoSave
      });

      await this.firestore
        .collection('forms')
        .doc(formId)
        .set(formDoc);

      // If this is an anonymous form, add it to the session
      if (isAnonymous && anonymousSessionId) {
        await this.addFormToAnonymousSession(anonymousSessionId, formId);
      }

      console.log(`✅ Form structure ${isUpdate ? 'updated' : 'stored'}: ${formId} for user: ${finalUserId} (anonymous: ${isAnonymous})`);
      return { 
        success: true, 
        formId,
        userId: finalUserId,
        isAnonymous,
        anonymousSessionId,
        isUpdate
      };
    } catch (error) {
      console.error('❌ Error storing form structure:', error);
      throw error;
    }
  }

  /**
   * Get form structure from Firestore
   */
  async getFormStructure(formId, forceFresh = false) {
    try {
      console.log(`📋 Retrieving form structure: ${formId}${forceFresh ? ' (force fresh)' : ''}`);
      
      const docRef = this.firestore.collection('forms').doc(formId);
      
      // Force fresh read from server if requested (to avoid cache issues after updates)
      const doc = forceFresh 
        ? await docRef.get({ source: 'server' })
        : await docRef.get();
      
      if (!doc.exists) {
        console.log(`❌ Form not found: ${formId}`);
        return null;
      }
      
      const data = doc.data();
      console.log(`✅ Form structure retrieved: ${formId}`);
      return data;
    } catch (error) {
      console.error(`❌ Failed to retrieve form structure: ${formId}`, error);
      throw error;
    }
  }

  /**
   * Get submission with file associations from Firestore
   */
  async getSubmissionWithFiles(submissionId) {
    try {
      console.log(`📋 Retrieving submission with files: ${submissionId}`);
      
      const docRef = this.firestore.collection('submissions').doc(submissionId);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        console.log(`❌ Submission not found: ${submissionId}`);
        return null;
      }
      
      const data = doc.data();
      console.log(`✅ Submission retrieved: ${submissionId}`);
      return {
        ...data,
        fileAssociations: data.file_associations || []
      };
    } catch (error) {
      console.error(`❌ Failed to retrieve submission: ${submissionId}`, error);
      throw error;
    }
  }

  /**
   * Get all submissions for a form with file associations
   */
  async getFormSubmissionsWithFiles(formId) {
    try {
      console.log(`📋 Retrieving submissions for form: ${formId}`);
      
      const snapshot = await this.firestore
        .collection('submissions')
        .where('form_id', '==', formId)
        .orderBy('timestamp', 'desc')
        .get();

      const submissions = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Decrypt HIPAA data if needed
        let submissionData = data.submission_data;
        
        // Check if this looks like encrypted data (numeric array pattern)
        const isEncryptedData = typeof data.submission_data === 'object' && 
                               !Array.isArray(data.submission_data) && 
                               Object.keys(data.submission_data).every(key => !isNaN(key));
        
        if (data.is_hipaa && (data.encrypted || isEncryptedData)) {
          try {
            console.log(`🔓 Decrypting HIPAA submission: ${data.submission_id} (encrypted: ${data.encrypted}, looks encrypted: ${isEncryptedData})`);
            console.log(`🔑 Attempting decryption with key: hipaa-data-key`);
            const decryptedResult = await this.decryptData(data.submission_data, 'hipaa-data-key');
            submissionData = decryptedResult.decryptedData;
            console.log(`✅ HIPAA submission decrypted: ${data.submission_id}`);
          } catch (error) {
            console.error(`❌ Failed to decrypt HIPAA submission ${data.submission_id} with hipaa-data-key:`, error.message);
            // Try with the default key as fallback
            try {
              console.log(`🔑 Attempting decryption with fallback key: form-data-key`);
              const decryptedResult = await this.decryptData(data.submission_data, 'form-data-key');
              submissionData = decryptedResult.decryptedData;
              console.log(`✅ HIPAA submission decrypted with fallback key: ${data.submission_id}`);
            } catch (fallbackError) {
              console.error(`❌ Failed to decrypt HIPAA submission ${data.submission_id} with fallback key:`, fallbackError.message);
              // Keep encrypted data if decryption fails
              submissionData = data.submission_data;
            }
          }
        }
        
        submissions.push({
          ...data,
          submission_data: submissionData,
          fileAssociations: data.file_associations || []
        });
      }

      console.log(`✅ Retrieved ${submissions.length} submissions for form: ${formId}`);
      return submissions;
    } catch (error) {
      console.error(`❌ Failed to retrieve form submissions: ${formId}`, error);
      throw error;
    }
  }

  /**
   * Store form submission in Firestore
   */
  async storeFormSubmission(submissionId, formId, formData, userId, metadata = {}) {
    try {
      // Extract file information from form data for easier retrieval
      const fileAssociations = [];
      const processedFormData = { ...formData };
      
      // Look for file fields in the form data
      Object.keys(formData).forEach(fieldId => {
        const fieldData = formData[fieldId];
        if (fieldData && typeof fieldData === 'object' && fieldData.gcpUrl) {
          // This is a file field with GCP URL
          fileAssociations.push({
            fieldId,
            fileName: fieldData.fileName,
            fileSize: fieldData.fileSize,
            fileType: fieldData.fileType,
            gcpUrl: fieldData.gcpUrl,
            uploadedAt: fieldData.uploadedAt
          });
          
          // Keep the file data in submission_data for backward compatibility
          // but also store it in a dedicated field for easy access
        }
      });

      const submissionDoc = {
        submission_id: submissionId,
        form_id: formId,
        user_id: userId,
        submission_data: processedFormData,
        file_associations: fileAssociations, // Dedicated field for file associations
        timestamp: new Date(),
        ip_address: metadata.ipAddress,
        user_agent: metadata.userAgent,
        is_hipaa: metadata.isHipaa || false,
        encrypted: metadata.encrypted || false, // Set based on metadata
      };

      await this.firestore
        .collection('submissions')
        .doc(submissionId)
        .set(submissionDoc);

      // Update the form document with submission count and last submission date
      try {
        const formRef = this.firestore.collection('forms').doc(formId);
        const formDoc = await formRef.get();
        
        if (formDoc.exists) {
          const formData = formDoc.data();
          const currentSubmissionCount = formData.submission_count || 0;
          const newSubmissionCount = currentSubmissionCount + 1;
          
          await formRef.update({
            submission_count: newSubmissionCount,
            last_submission_date: new Date(),
            updated_at: new Date()
          });
          
          console.log(`📊 Form submission count updated: ${formId} (${newSubmissionCount} total)`);
        }
      } catch (error) {
        console.warn(`⚠️ Could not update form submission count for ${formId}:`, error.message);
      }

      console.log(`✅ Form submission stored: ${submissionId}`);
      if (fileAssociations.length > 0) {
        console.log(`📎 File associations: ${fileAssociations.length} files linked to submission`);
      }
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
   * Update form analytics using BigQuery MERGE statement
   */
  async updateFormAnalytics(formId, userId, submissionCount = 1) {
    try {
      const currentTime = new Date();
      const formName = `Form ${formId}`;

      // Use BigQuery MERGE statement (equivalent to INSERT ... ON DUPLICATE KEY UPDATE)
      const query = `
        MERGE \`${this.projectId}.form_submissions.form_analytics\` AS target
        USING (
          SELECT 
            @formId as form_id,
            @formName as form_name,
            @createdAt as created_at,
            @submissionsCount as submissions_count,
            @lastSubmission as last_submission,
            @isHipaa as is_hipaa,
            @isPublished as is_published,
            @userId as user_id
        ) AS source
        ON target.form_id = source.form_id
        WHEN MATCHED THEN
          UPDATE SET
            submissions_count = target.submissions_count + source.submissions_count,
            last_submission = source.last_submission
        WHEN NOT MATCHED THEN
          INSERT (
            form_id, form_name, created_at, submissions_count, 
            last_submission, is_hipaa, is_published, user_id
          )
          VALUES (
            source.form_id, source.form_name, source.created_at, source.submissions_count,
            source.last_submission, source.is_hipaa, source.is_published, source.user_id
          )
      `;

      const options = {
        query,
        params: {
          formId,
          formName,
          createdAt: currentTime,
          submissionsCount: submissionCount,
          lastSubmission: currentTime,
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
      // Don't throw error - analytics failure shouldn't break form submission
      console.warn(`⚠️ Analytics update failed for form ${formId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get form analytics from BigQuery
   */
  async getFormAnalytics(formId) {
    try {
      const query = `
        SELECT 
          form_id,
          form_name,
          created_at,
          submissions_count,
          last_submission,
          is_hipaa,
          is_published,
          user_id
        FROM \`${this.projectId}.form_submissions.form_analytics\`
        WHERE form_id = @formId
        ORDER BY last_submission DESC
        LIMIT 1
      `;

      const options = {
        query,
        params: { formId },
      };

      const [rows] = await this.bigquery.query(options);
      
      if (rows.length === 0) {
        return null;
      }

      console.log(`✅ Form analytics retrieved: ${formId}`);
      return rows[0];
    } catch (error) {
      console.error('❌ Error getting form analytics:', error);
      throw error;
    }
  }

  /**
   * Get all analytics for a specific user
   */
  async getUserAnalytics(userId) {
    try {
      const query = `
        SELECT 
          form_id,
          form_name,
          created_at,
          submissions_count,
          last_submission,
          is_hipaa,
          is_published,
          user_id
        FROM \`${this.projectId}.form_submissions.form_analytics\`
        WHERE user_id = @userId
        ORDER BY last_submission DESC
      `;

      const options = {
        query,
        params: { userId },
      };

      const [rows] = await this.bigquery.query(options);
      
      console.log(`✅ User analytics retrieved for: ${userId} (${rows.length} forms)`);
      return rows;
    } catch (error) {
      console.error('❌ Error getting user analytics:', error);
      throw error;
    }
  }

  /**
   * Get form submissions from Firestore
   */
  async getFormSubmissions(formId) {
    try {
      const submissionsSnapshot = await this.firestore
        .collection('submissions')
        .where('form_id', '==', formId)
        .orderBy('timestamp', 'desc')
        .get();

      if (submissionsSnapshot.empty) {
        console.log(`📝 No submissions found for form: ${formId}`);
        return [];
      }

      const submissions = await Promise.all(submissionsSnapshot.docs.map(async (doc) => {
        const data = doc.data();
        
        // Debug logging for each submission
        console.log(`🔍 Processing submission: ${data.submission_id}, is_hipaa: ${data.is_hipaa}, encrypted: ${data.encrypted}`);
        
        // Decrypt HIPAA data if needed
        let submissionData = data.submission_data;
        
        // Check if this looks like encrypted data (numeric array pattern)
        const isEncryptedData = typeof data.submission_data === 'object' && 
                               !Array.isArray(data.submission_data) && 
                               Object.keys(data.submission_data).every(key => !isNaN(key));
        
        if (data.is_hipaa && (data.encrypted || isEncryptedData)) {
          try {
            console.log(`🔓 Decrypting HIPAA submission: ${data.submission_id} (encrypted: ${data.encrypted}, looks encrypted: ${isEncryptedData})`);
            console.log(`🔑 Attempting decryption with key: hipaa-data-key`);
            const decryptedResult = await this.decryptData(data.submission_data, 'hipaa-data-key');
            submissionData = decryptedResult.decryptedData;
            console.log(`✅ HIPAA submission decrypted: ${data.submission_id}`);
          } catch (error) {
            console.error(`❌ Failed to decrypt HIPAA submission ${data.submission_id} with hipaa-data-key:`, error.message);
            // Try with the default key as fallback
            try {
              console.log(`🔑 Attempting decryption with fallback key: form-data-key`);
              const decryptedResult = await this.decryptData(data.submission_data, 'form-data-key');
              submissionData = decryptedResult.decryptedData;
              console.log(`✅ HIPAA submission decrypted with fallback key: ${data.submission_id}`);
            } catch (fallbackError) {
              console.error(`❌ Failed to decrypt HIPAA submission ${data.submission_id} with fallback key:`, fallbackError.message);
              // Keep encrypted data if decryption fails
              submissionData = data.submission_data;
            }
          }
        } else {
          console.log(`📝 Non-HIPAA submission, using data as-is: ${data.submission_id}`);
        }
        
        const result = {
          submission_id: data.submission_id,
          form_id: data.form_id,
          user_id: data.user_id,
          submission_data: submissionData,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          ip_address: data.ip_address,
          user_agent: data.user_agent,
          is_hipaa: data.is_hipaa,
          encrypted: data.encrypted,
          file_associations: data.file_associations || []
        };
        
        // Debug: Log sample of submission data
        console.log(`📊 Submission ${data.submission_id} data sample:`, JSON.stringify(submissionData).substring(0, 200) + '...');
        
        return result;
      }));

      console.log(`✅ Retrieved ${submissions.length} submissions for form: ${formId}`);
      return submissions;
    } catch (error) {
      console.error(`❌ Error getting form submissions for ${formId}:`, error);
      return [];
    }
  }

  /**
   * Get all analytics data (for admin purposes)
   */
  async getAllAnalytics(limit = 100) {
    try {
      const query = `
        SELECT 
          form_id,
          form_name,
          created_at,
          submissions_count,
          last_submission,
          is_hipaa,
          is_published,
          user_id
        FROM \`${this.projectId}.form_submissions.form_analytics\`
        ORDER BY last_submission DESC
        LIMIT @limit
      `;

      const options = {
        query,
        params: { limit },
      };

      const [rows] = await this.bigquery.query(options);
      
      console.log(`✅ All analytics retrieved (${rows.length} forms)`);
      return rows;
    } catch (error) {
      console.error('❌ Error getting all analytics:', error);
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
      console.log(`🔍 Encryption debug - ciphertext type: ${typeof result.ciphertext}, isBuffer: ${Buffer.isBuffer(result.ciphertext)}`);
      console.log(`🔍 Encryption debug - ciphertext length: ${result.ciphertext.length}`);
      console.log(`🔍 Encryption debug - first 50 chars of base64: ${result.ciphertext.toString('base64').substring(0, 50)}`);
      
      // Store as Buffer directly - Firestore handles Buffers correctly
      return {
        success: true,
        encryptedData: result.ciphertext, // Store Buffer directly instead of base64 string
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

      // Handle different formats: Buffer (new), base64 string, or numeric object (old corrupted)
      let ciphertextBuffer;
      console.log(`🔍 Decryption debug - encryptedData type: ${typeof encryptedData}`);
      console.log(`🔍 Decryption debug - encryptedData isArray: ${Array.isArray(encryptedData)}`);
      console.log(`🔍 Decryption debug - encryptedData isBuffer: ${Buffer.isBuffer(encryptedData)}`);
      
      if (Buffer.isBuffer(encryptedData)) {
        // New format: Buffer (stored directly)
        console.log(`🔍 Decryption debug - treating as Buffer, length: ${encryptedData.length}`);
        ciphertextBuffer = encryptedData;
      } else if (typeof encryptedData === 'string') {
        // Fallback: base64 string
        console.log(`🔍 Decryption debug - treating as base64 string, length: ${encryptedData.length}`);
        ciphertextBuffer = Buffer.from(encryptedData, 'base64');
      } else if (typeof encryptedData === 'object' && !Array.isArray(encryptedData)) {
        // Old corrupted format: numeric object (character-by-character)
        console.log(`🔍 Decryption debug - treating as corrupted numeric object, keys count: ${Object.keys(encryptedData).length}`);
        const numericArray = Object.values(encryptedData);
        console.log(`🔍 Decryption debug - numeric array length: ${numericArray.length}, first 10 values: ${numericArray.slice(0, 10).join(', ')}`);
        ciphertextBuffer = Buffer.from(numericArray);
      } else {
        throw new Error('Invalid encrypted data format');
      }
      
      console.log(`🔍 Decryption debug - final ciphertextBuffer length: ${ciphertextBuffer.length}`);

      const [result] = await this.kmsClient.decrypt({
        name: keyPath,
        ciphertext: ciphertextBuffer,
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

      // Generate PDF if signature data exists
      await this.generateSignedPDFIfNeeded(submissionId, formId, formData, true);

      // Update analytics (without sensitive data)
      await this.updateFormAnalytics(formId, userId);

      console.log(`✅ HIPAA submission processed: ${submissionId}`);
      return { success: true, submissionId };
    } catch (error) {
      console.error('❌ Error processing HIPAA submission:', error);
      throw error;
    }
  }

  /**
   * Generate signed PDF if signature data exists in form submission
   */
  async generateSignedPDFIfNeeded(submissionId, formId, formData, isHipaa = false) {
    try {
      // Check for signature data in form submission
      const signatureFields = Object.entries(formData).filter(([key, value]) => 
        value && typeof value === 'object' && 'imageBase64' in value
      );

      if (signatureFields.length === 0) {
        console.log('📄 No signature data found, skipping PDF generation');
        return;
      }

      console.log(`📄 Found ${signatureFields.length} signature field(s), generating PDF...`);

      // Get form schema for PDF generation
      const formRef = this.firestore.collection('forms').doc(formId);
      const formDoc = await formRef.get();
      
      if (!formDoc.exists) {
        throw new Error(`Form ${formId} not found`);
      }

      const formSchema = formDoc.data();
      const bucketName = isHipaa ? 'chatterforms-hipaa-data' : 'chatterforms-data';

      // Generate PDF for each signature field
      for (const [fieldId, signatureData] of signatureFields) {
        try {
          const pdfResult = await this.pdfGenerator.generateSignedPDF({
            formData,
            formSchema,
            signatureData,
            bucketName,
            isHipaa
          });

          console.log(`✅ PDF generated: ${pdfResult.filename}`);
          console.log(`📄 PDF URL: ${pdfResult.url}`);
          console.log(`📄 PDF size: ${Math.round(pdfResult.size/1024)}KB`);
          
          // Store PDF reference in submission metadata
          await this.storePDFReference(submissionId, fieldId, pdfResult, isHipaa);
          
        } catch (error) {
          console.error(`❌ Failed to generate PDF for signature field ${fieldId}:`, error);
          // Don't fail the entire submission if PDF generation fails
        }
      }
    } catch (error) {
      console.error('❌ Error in PDF generation:', error);
      // Don't fail the entire submission if PDF generation fails
    }
  }

  /**
   * Store PDF reference in submission metadata
   */
  async storePDFReference(submissionId, fieldId, pdfResult, isHipaa = false) {
    try {
      const submissionRef = this.firestore.collection('submissions').doc(submissionId);
      
      await submissionRef.update({
        [`pdfs.${fieldId}`]: {
          filename: pdfResult.filename,
          url: pdfResult.url,
          size: pdfResult.size,
          generatedAt: new Date().toISOString(),
          isHipaa
        }
      });

      console.log(`✅ PDF reference stored for submission ${submissionId}, field ${fieldId}`);
    } catch (error) {
      console.error('❌ Failed to store PDF reference:', error);
    }
  }

  // ============== USER MANAGEMENT ==============

  /**
   * Create a new user
   */
  async createUser(userData) {
    try {
      const userRef = this.firestore.collection('users').doc();
      const userId = userRef.id;
      
      await userRef.set({
        id: userId,
        ...userData,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`✅ User created: ${userId}`);
      return userId;
    } catch (error) {
      console.error('❌ Error creating user:', error);
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    try {
      const snapshot = await this.firestore
        .collection('users')
        .where('email', '==', email.toLowerCase())
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('❌ Error getting user by email:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    try {
      const doc = await this.firestore
        .collection('users')
        .doc(userId)
        .get();

      if (!doc.exists) {
        return null;
      }

      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('❌ Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Update user last login
   */
  async updateUserLastLogin(userId) {
    try {
      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          lastLoginAt: new Date(),
          updatedAt: new Date()
        });

      console.log(`✅ User last login updated: ${userId}`);
    } catch (error) {
      console.error('❌ Error updating user last login:', error);
      throw error;
    }
  }

  /**
   * Update user email verification status
   */
  async updateUserEmailVerification(userId, isVerified) {
    try {
      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          emailVerified: isVerified,
          status: isVerified ? 'active' : 'pending',
          updatedAt: new Date()
        });

      console.log(`✅ User email verification updated: ${userId}`);
    } catch (error) {
      console.error('❌ Error updating user email verification:', error);
      throw error;
    }
  }

  /**
   * Update user password
   */
  async updateUserPassword(userId, passwordHash) {
    try {
      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          passwordHash,
          updatedAt: new Date()
        });

      console.log(`✅ User password updated: ${userId}`);
    } catch (error) {
      console.error('❌ Error updating user password:', error);
      throw error;
    }
  }

  /**
   * Store email verification token
   */
  async storeEmailVerificationToken(userId, email, token) {
    try {
      await this.firestore
        .collection('emailVerificationTokens')
        .doc(token)
        .set({
          userId,
          email,
          token,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

      console.log(`✅ Email verification token stored: ${token}`);
    } catch (error) {
      console.error('❌ Error storing email verification token:', error);
      throw error;
    }
  }

  /**
   * Get email verification by token
   */
  async getEmailVerificationByToken(token) {
    try {
      const doc = await this.firestore
        .collection('emailVerificationTokens')
        .doc(token)
        .get();

      if (!doc.exists) {
        return null;
      }

      return doc.data();
    } catch (error) {
      console.error('❌ Error getting email verification token:', error);
      throw error;
    }
  }

  /**
   * Delete email verification token
   */
  async deleteEmailVerificationToken(token) {
    try {
      await this.firestore
        .collection('emailVerificationTokens')
        .doc(token)
        .delete();

      console.log(`✅ Email verification token deleted: ${token}`);
    } catch (error) {
      console.error('❌ Error deleting email verification token:', error);
      throw error;
    }
  }

  /**
   * Store password reset token
   */
  async storePasswordResetToken(userId, email, token) {
    try {
      await this.firestore
        .collection('passwordResetTokens')
        .doc(token)
        .set({
          userId,
          email,
          token,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
        });

      console.log(`✅ Password reset token stored: ${token}`);
    } catch (error) {
      console.error('❌ Error storing password reset token:', error);
      throw error;
    }
  }

  /**
   * Get password reset by token
   */
  async getPasswordResetByToken(token) {
    try {
      const doc = await this.firestore
        .collection('passwordResetTokens')
        .doc(token)
        .get();

      if (!doc.exists) {
        return null;
      }

      return doc.data();
    } catch (error) {
      console.error('❌ Error getting password reset token:', error);
      throw error;
    }
  }

  /**
   * Delete password reset token
   */
  async deletePasswordResetToken(token) {
    try {
      await this.firestore
        .collection('passwordResetTokens')
        .doc(token)
        .delete();

      console.log(`✅ Password reset token deleted: ${token}`);
    } catch (error) {
      console.error('❌ Error deleting password reset token:', error);
      throw error;
    }
  }

  /**
   * Generate a temporary user ID for anonymous users
   */
  generateTemporaryUserId() {
    const { v4: uuidv4 } = require('uuid');
    return `temp_${uuidv4()}`;
  }

  /**
   * Create or update anonymous session
   */
  async createAnonymousSession(sessionId, userAgent, ipAddress) {
    try {
      const sessionDoc = {
        id: sessionId,
        forms: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        userAgent,
        ipAddress
      };

      await this.firestore
        .collection('anonymousSessions')
        .doc(sessionId)
        .set(sessionDoc);

      console.log(`✅ Anonymous session created: ${sessionId}`);
      return { success: true, sessionId };
    } catch (error) {
      console.error(`❌ Error creating anonymous session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Add form to anonymous session
   */
  async addFormToAnonymousSession(sessionId, formId) {
    try {
      const { FieldValue } = require('@google-cloud/firestore');
      
      await this.firestore
        .collection('anonymousSessions')
        .doc(sessionId)
        .update({
          forms: FieldValue.arrayUnion(formId),
          lastActivity: new Date()
        });

      console.log(`✅ Form ${formId} added to anonymous session: ${sessionId}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Error adding form to anonymous session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Migrate anonymous forms to real user account
   */
  async migrateAnonymousFormsToUser(tempUserId, realUserId) {
    try {
      console.log(`🔄 Migrating forms from ${tempUserId} to ${realUserId}`);
      
      // Get all forms with the temporary user ID
      const snapshot = await this.firestore
        .collection('forms')
        .where('user_id', '==', tempUserId)
        .get();

      if (snapshot.empty) {
        console.log(`ℹ️ No forms found for temporary user: ${tempUserId}`);
        return { success: true, migratedForms: 0, migratedFormIds: [] };
      }

      const batch = this.firestore.batch();
      let migratedForms = 0;
      const migratedFormIds = [];

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          user_id: realUserId,
          isAnonymous: false,
          migratedAt: new Date(),
          updated_at: new Date()
        });
        migratedForms++;
        migratedFormIds.push(doc.id); // Collect the form IDs
      });

      await batch.commit();

      // Update the anonymous session to mark as migrated
      await this.firestore
        .collection('anonymousSessions')
        .doc(tempUserId.replace('temp_', ''))
        .update({
          migratedTo: realUserId,
          migratedAt: new Date()
        });

      console.log(`✅ Successfully migrated ${migratedForms} forms from ${tempUserId} to ${realUserId}`);
      console.log(`📋 Migrated form IDs: ${migratedFormIds.join(', ')}`);
      return { success: true, migratedForms, migratedFormIds };
    } catch (error) {
      console.error(`❌ Error migrating forms from ${tempUserId} to ${realUserId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up expired anonymous sessions and their forms
   */
  async cleanupExpiredAnonymousSessions() {
    try {
      console.log('🧹 Cleaning up expired anonymous sessions...');
      
      const now = new Date();
      const snapshot = await this.firestore
        .collection('anonymousSessions')
        .where('expiresAt', '<', now)
        .get();

      if (snapshot.empty) {
        console.log('ℹ️ No expired sessions found');
        return { success: true, cleanedSessions: 0, cleanedForms: 0 };
      }

      let cleanedSessions = 0;
      let cleanedForms = 0;
      const batch = this.firestore.batch();

      for (const doc of snapshot.docs) {
        const sessionData = doc.data();
        
        // Delete all forms associated with this session
        if (sessionData.forms && sessionData.forms.length > 0) {
          for (const formId of sessionData.forms) {
            try {
              const formDoc = await this.firestore.collection('forms').doc(formId).get();
              if (formDoc.exists) {
                batch.delete(formDoc.ref);
                cleanedForms++;
              }
            } catch (error) {
              console.warn(`⚠️ Could not delete form ${formId}:`, error.message);
            }
          }
        }

        // Delete the session
        batch.delete(doc.ref);
        cleanedSessions++;
      }

      await batch.commit();

      console.log(`✅ Cleaned up ${cleanedSessions} expired sessions and ${cleanedForms} forms`);
      return { success: true, cleanedSessions, cleanedForms };
    } catch (error) {
      console.error('❌ Error cleaning up expired sessions:', error);
      throw error;
    }
  }

  /**
   * Get forms by user ID (handles both real and temporary user IDs)
   */
  async getFormsByUserId(userId) {
    try {
      console.log(`📋 Retrieving forms for user: ${userId}`);
      
      const snapshot = await this.firestore
        .collection('forms')
        .where('user_id', '==', userId)
        .get();

      const forms = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.metadata?.title || 'Untitled Form',
          status: data.is_published ? 'published' : 'draft',
          lastEdited: data.metadata?.updated_at || data.metadata?.created_at,
          submissionCount: data.submission_count || 0,
          lastSubmissionDate: data.last_submission_date,
          isHIPAA: data.is_hipaa || false,
          thumbnail: data.metadata?.thumbnail,
          isAnonymous: data.isAnonymous || false,
          migratedAt: data.migratedAt,
          ...data
        };
      });

      console.log(`✅ Retrieved ${forms.length} forms for user: ${userId}`);
      return forms;
    } catch (error) {
      console.error(`❌ Failed to retrieve forms for user: ${userId}`, error);
      throw error;
    }
  }

  /**
   * Update form metadata
   */
  async updateFormMetadata(formId, metadata) {
    try {
      console.log(`📝 Updating form metadata: ${formId}`);
      
      await this.firestore
        .collection('forms')
        .doc(formId)
        .update({
          metadata: {
            ...metadata,
            updated_at: new Date()
          }
        });

      console.log(`✅ Form metadata updated: ${formId}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to update form metadata: ${formId}`, error);
      throw error;
    }
  }

  /**
   * Migrate anonymous forms to user account
   */
  async migrateAnonymousForms(userId, anonymousSessionId) {
    try {
      // Get anonymous forms
      const snapshot = await this.firestore
        .collection('forms')
        .where('anonymousSessionId', '==', anonymousSessionId)
        .get();

      let migratedForms = 0;
      const batch = this.firestore.batch();

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          userId,
          isAnonymous: false,
          anonymousSessionId: null,
          migratedAt: new Date(),
          updatedAt: new Date()
        });
        migratedForms++;
      });

      await batch.commit();

      // Update user record
      await this.firestore
        .collection('users')
        .doc(userId)
        .update({
          anonymousFormsMigrated: true,
          updatedAt: new Date()
        });

      console.log(`✅ Migrated ${migratedForms} forms for user: ${userId}`);
      return {
        migratedForms,
        totalForms: snapshot.size
      };
    } catch (error) {
      console.error('❌ Error migrating anonymous forms:', error);
      throw error;
    }
  }

  /**
   * Delete form and all associated data (submissions, analytics)
   */
  async deleteForm(formId) {
    try {
      console.log(`🗑️ Deleting form and all associated data: ${formId}`);
      
      // Get form data to check what needs to be deleted
      const formDoc = await this.firestore.collection('forms').doc(formId).get();
      if (!formDoc.exists) {
        return { success: false, error: 'Form not found' };
      }

      const formData = formDoc.data();
      const batch = this.firestore.batch();

      // 1. Delete form structure
      batch.delete(formDoc.ref);
      console.log(`🗑️ Form structure deleted: ${formId}`);

      // 2. Delete form submissions (if any exist)
      try {
        const submissionsSnapshot = await this.firestore
          .collection('submissions')
          .where('form_id', '==', formId)
          .get();
        
        submissionsSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        console.log(`🗑️ Deleted ${submissionsSnapshot.size} form submissions`);
      } catch (error) {
        console.warn(`⚠️ Could not delete submissions for form ${formId}:`, error.message);
      }

      // 3. Delete form analytics from BigQuery (if any exist)
      try {
        // Delete analytics data from BigQuery
        const deleteAnalyticsQuery = `
          DELETE FROM \`${this.projectId}.form_submissions.form_analytics\`
          WHERE form_id = @formId
        `;
        
        const deleteSubmissionsQuery = `
          DELETE FROM \`${this.projectId}.form_submissions.submissions\`
          WHERE form_id = @formId
        `;
        
        const analyticsOptions = {
          query: deleteAnalyticsQuery,
          params: { formId },
        };
        
        const submissionsOptions = {
          query: deleteSubmissionsQuery,
          params: { formId },
        };
        
        // Execute both deletions
        const [analyticsResult] = await this.bigquery.query(analyticsOptions);
        const [submissionsResult] = await this.bigquery.query(submissionsOptions);
        
        console.log(`🗑️ Deleted analytics records from BigQuery for form: ${formId}`);
        console.log(`🗑️ Deleted submission records from BigQuery for form: ${formId}`);
      } catch (error) {
        console.warn(`⚠️ Could not delete analytics from BigQuery for form ${formId}:`, error.message);
      }

      // 4. Remove form from user's forms list (if user exists)
      if (formData.user_id) {
        try {
          const userDoc = await this.firestore.collection('users').doc(formData.user_id).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.forms && userData.forms.includes(formId)) {
              const updatedForms = userData.forms.filter(id => id !== formId);
              batch.update(userDoc.ref, { forms: updatedForms });
              console.log(`🗑️ Removed form from user's forms list`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not update user forms list:`, error.message);
        }
      }

      // 5. Remove form from anonymous session (if it was anonymous)
      if (formData.anonymousSessionId) {
        try {
          const sessionDoc = await this.firestore.collection('anonymousSessions').doc(formData.anonymousSessionId).get();
          if (sessionDoc.exists) {
            const sessionData = sessionDoc.data();
            if (sessionData.forms && sessionData.forms.includes(formId)) {
              const updatedForms = sessionData.forms.filter(id => id !== formId);
              batch.update(sessionDoc.ref, { forms: updatedForms });
              console.log(`🗑️ Removed form from anonymous session`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not update anonymous session:`, error.message);
        }
      }

      // Commit all deletions
      await batch.commit();
      
      console.log(`✅ Form ${formId} and all associated data deleted successfully`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Error deleting form ${formId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async getFormById(formId) {
    try {
      console.log(`🔍 Fetching form by ID: ${formId}`);
      
      const doc = await this.firestore
        .collection('forms')
        .doc(formId)
        .get();

      if (!doc.exists) {
        console.log(`❌ Form not found: ${formId}`);
        return null;
      }

      const data = doc.data();
      console.log(`✅ Found form: ${formId}`);
      return {
        id: doc.id,
        ...data
      };
    } catch (error) {
      console.error('❌ Error fetching form by ID:', error);
      return null;
    }
  }
}

module.exports = GCPClient;
