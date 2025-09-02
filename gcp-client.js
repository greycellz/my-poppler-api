/**
 * GCP Client for ChatterForms Railway Backend
 * Handles Firestore, BigQuery, Cloud Storage, and KMS operations
 */

const { Firestore } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');
const { KeyManagementServiceClient } = require('@google-cloud/kms');
const path = require('path');
const fs = require('fs');

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

      const formDoc = {
        form_id: formId,
        user_id: finalUserId,
        structure: formData,
        metadata: {
          ...metadata,
          created_at: new Date(),
          updated_at: new Date(),
        },
        is_hipaa: metadata.isHipaa || false,
        is_published: metadata.isPublished || false,
        isAnonymous,
        anonymousSessionId
      };

      await this.firestore
        .collection('forms')
        .doc(formId)
        .set(formDoc);

      // If this is an anonymous form, add it to the session
      if (isAnonymous && anonymousSessionId) {
        await this.addFormToAnonymousSession(anonymousSessionId, formId);
      }

      console.log(`✅ Form structure stored: ${formId} for user: ${finalUserId} (anonymous: ${isAnonymous})`);
      return { 
        success: true, 
        formId,
        userId: finalUserId,
        isAnonymous,
        anonymousSessionId
      };
    } catch (error) {
      console.error('❌ Error storing form structure:', error);
      throw error;
    }
  }

  /**
   * Get form structure from Firestore
   */
  async getFormStructure(formId) {
    try {
      console.log(`📋 Retrieving form structure: ${formId}`);
      
      const docRef = this.firestore.collection('forms').doc(formId);
      const doc = await docRef.get();
      
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
      snapshot.forEach(doc => {
        const data = doc.data();
        submissions.push({
          ...data,
          fileAssociations: data.file_associations || []
        });
      });

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
        encrypted: false, // Will be encrypted by KMS
      };

      await this.firestore
        .collection('submissions')
        .doc(submissionId)
        .set(submissionDoc);

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
        return { success: true, migratedForms: 0 };
      }

      const batch = this.firestore.batch();
      let migratedForms = 0;

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          user_id: realUserId,
          isAnonymous: false,
          migratedAt: new Date(),
          updated_at: new Date()
        });
        migratedForms++;
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
      return { success: true, migratedForms };
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
          .collection('formSubmissions')
          .where('formId', '==', formId)
          .get();
        
        submissionsSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        console.log(`🗑️ Deleted ${submissionsSnapshot.size} form submissions`);
      } catch (error) {
        console.warn(`⚠️ Could not delete submissions for form ${formId}:`, error.message);
      }

      // 3. Delete form analytics (if any exist)
      try {
        const analyticsSnapshot = await this.firestore
          .collection('formAnalytics')
          .where('formId', '==', formId)
          .get();
        
        analyticsSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        console.log(`🗑️ Deleted ${analyticsSnapshot.size} analytics records`);
      } catch (error) {
        console.warn(`⚠️ Could not delete analytics for form ${formId}:`, error.message);
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
}

module.exports = GCPClient;
