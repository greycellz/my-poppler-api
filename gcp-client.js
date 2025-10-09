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

      // Store payment field configurations if the form contains payment fields
      if (formData.fields && Array.isArray(formData.fields)) {
        const paymentFields = formData.fields.filter(field => field.type === 'payment');
        if (paymentFields.length > 0) {
          console.log(`💳 Found ${paymentFields.length} payment field(s) in form ${formId}`);
          
          try {
            // Get user's Stripe account for payment fields
            const stripeAccount = await this.getStripeAccount(finalUserId);
            if (!stripeAccount) {
              console.log(`⚠️ No Stripe account found for user ${finalUserId}, payment fields will not be configured`);
            } else {
              // Store or update each payment field configuration
              for (const field of paymentFields) {
                // Check if payment field already exists
                const existingFields = await this.getPaymentFields(formId);
                const existingField = existingFields.find(f => f.field_id === field.id);
                
                if (existingField) {
                  // Update existing payment field - preserve the existing stripe_account_id if field has one
                  const stripeAccountId = field.stripeAccountId || existingField.stripe_account_id || stripeAccount.stripe_account_id;
                  console.log(`🔄 Updating existing payment field: ${field.id} with account: ${stripeAccountId}`);
                  await this.updatePaymentField(formId, field.id, {
                    amount: Math.round((field.amount || 0) * 100), // Convert to cents
                    currency: field.currency || 'usd',
                    description: field.description || '',
                    product_name: field.productName || '',
                    stripe_account_id: stripeAccountId
                  });
                } else {
                  // Create new payment field
                  const stripeAccountId = field.stripeAccountId || stripeAccount.stripe_account_id;
                  console.log(`➕ Creating new payment field: ${field.id} with account: ${stripeAccountId}`);
                  await this.storePaymentField(formId, field.id, {
                    amount: Math.round((field.amount || 0) * 100), // Convert to cents
                    currency: field.currency || 'usd',
                    description: field.description || '',
                    product_name: field.productName || '',
                    stripe_account_id: stripeAccountId,
                    isRequired: field.required || false
                  });
                }
              }
            }
          } catch (paymentError) {
            console.error('❌ Error storing payment fields (non-blocking):', paymentError);
            // Don't throw the error - let the form save continue
          }
        }

        // Store calendly field configurations if the form contains calendly fields
        const calendlyFields = formData.fields.filter(field => field.type === 'calendly');
        if (calendlyFields.length > 0) {
          console.log(`📅 Found ${calendlyFields.length} calendly field(s) in form ${formId}`);
          
          try {
            // Store each calendly field configuration
            for (const field of calendlyFields) {
              await this.storeCalendarField(formId, field.id, {
                calendlyUrl: field.calendlyUrl || '',
                eventTypeUri: field.eventTypeUri || '',
                eventName: field.eventName || '',
                duration: field.duration || 15,
                requirePaymentFirst: field.requirePaymentFirst || false,
                isRequired: field.required || false,
                timezone: 'UTC',
                metadata: {}
              });
            }
            console.log(`✅ Calendly field configurations stored for form ${formId}`);
          } catch (calendlyError) {
            console.error('❌ Error storing calendly fields (non-blocking):', calendlyError);
            // Don't throw the error - let the form save continue
          }
        }
      }

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
        
        // Resolve submission data depending on storage mode
        let submissionData = data.submission_data;
        
        // Check if this looks like encrypted data (numeric array pattern)
        const isEncryptedData = typeof data.submission_data === 'object' && 
                               !Array.isArray(data.submission_data) && 
                               Object.keys(data.submission_data).every(key => !isNaN(key));
        
        // New HIPAA path: trimmed Firestore doc with pointer to GCS JSON
        if (data.is_hipaa && data.data_gcs_path) {
          try {
            const bucketName = 'chatterforms-submissions-us-central1';
            console.log(`📥 Loading HIPAA submission from GCS: gs://${bucketName}/${data.data_gcs_path}`);
            const [buf] = await this.storage.bucket(bucketName).file(data.data_gcs_path).download();
            submissionData = JSON.parse(buf.toString('utf8'));
            console.log(`✅ Loaded HIPAA submission from GCS: ${data.submission_id}`);
          } catch (e) {
            console.error(`❌ Failed loading HIPAA submission from GCS for ${data.submission_id}:`, e.message);
            submissionData = null;
          }
        } else if (data.is_hipaa && (data.encrypted || isEncryptedData)) {
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
      
      // Filter out signature data to avoid Firestore index limits
      const signatureFields = [];
      Object.keys(formData).forEach(fieldId => {
        const fieldData = formData[fieldId];
        if (fieldData && typeof fieldData === 'object' && 'imageBase64' in fieldData) {
          // This is a signature field - don't store in Firestore
          signatureFields.push(fieldId);
          delete processedFormData[fieldId];
          console.log(`📝 Excluded signature field ${fieldId} from Firestore storage`);
        } else if (fieldData && typeof fieldData === 'object' && fieldData.gcpUrl) {
          // This is a file field with GCP URL
          fileAssociations.push({
            fieldId,
            fileName: fieldData.fileName,
            fileSize: fieldData.fileSize,
            fileType: fieldData.fileType,
            gcpUrl: fieldData.gcpUrl,
            uploadedAt: fieldData.uploadedAt
          });
        }
      });

      // Diagnostics: measure Firestore payload size/shape before write
      let diagnostics = { keysCount: 0, bytes: 0 };
      try {
        const keysCount = Object.keys(processedFormData || {}).length;
        const jsonStr = JSON.stringify(processedFormData || {});
        const bytes = Buffer.byteLength(jsonStr, 'utf8');
        diagnostics = { keysCount, bytes };
        console.log(
          `📏 Firestore submission_data diagnostics → keys: ${keysCount}, bytes: ${bytes}, isHipaa: ${!!metadata.isHipaa}, encrypted: ${!!metadata.encrypted}`
        );
      } catch (e) {
        console.log('⚠️ Failed to compute diagnostics for submission_data', e);
      }

      const isHipaa = metadata.isHipaa || false;
      const baseDoc = {
        submission_id: submissionId,
        form_id: formId,
        user_id: userId,
        file_associations: fileAssociations, // Dedicated field for file associations
        signature_fields: signatureFields, // Track which fields were signatures (stored in GCS)
        timestamp: new Date(),
        ip_address: metadata.ipAddress,
        user_agent: metadata.userAgent,
        is_hipaa: isHipaa,
        encrypted: metadata.encrypted || false, // Set based on metadata
      };

      // HIPAA-only trim: store data pointer instead of full submission_data to avoid index explosion
      const submissionDoc = isHipaa
        ? {
            ...baseDoc,
            data_gcs_path: `submissions/${submissionId}/data.json`,
            data_size_bytes: diagnostics.bytes,
          }
        : {
            ...baseDoc,
            submission_data: processedFormData,
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
        
        // If HIPAA doc is trimmed and points to GCS, load JSON directly
        if (data.is_hipaa && data.data_gcs_path) {
          try {
            const bucketName = 'chatterforms-submissions-us-central1';
            console.log(`📥 Loading HIPAA submission from GCS: gs://${bucketName}/${data.data_gcs_path}`);
            const [buf] = await this.storage.bucket(bucketName).file(data.data_gcs_path).download();
            submissionData = JSON.parse(buf.toString('utf8'));
            console.log(`✅ Loaded HIPAA submission from GCS: ${data.submission_id}`);
          } catch (e) {
            console.error(`❌ Failed loading HIPAA submission from GCS for ${data.submission_id}:`, e.message);
            submissionData = null;
          }
        } else if (data.is_hipaa && (data.encrypted || isEncryptedData)) {
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
              submissionData = typeof data.submission_data !== 'undefined' ? data.submission_data : null;
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
        
        // Debug: Log sample of submission data (guard null/undefined)
        const sample = submissionData === undefined ? 'undefined' :
                       submissionData === null ? 'null' :
                       JSON.stringify(submissionData).substring(0, 200);
        console.log(`📊 Submission ${data.submission_id} data sample:`, sample + '...');
        
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
   * Get paginated form submissions with lazy loading
   */
  async getFormSubmissionsPaginated(formId, limit = 20, offset = 0, sort = 'desc', search = '', dateFrom = '', dateTo = '') {
    try {
      console.log(`📋 Getting paginated submissions for form: ${formId}, limit: ${limit}, offset: ${offset}`);
      
      // Build Firestore query with pagination
      let query = this.firestore
        .collection('submissions')
        .where('form_id', '==', formId);
      
      // Add date filters if provided
      if (dateFrom) {
        query = query.where('timestamp', '>=', new Date(dateFrom));
      }
      if (dateTo) {
        query = query.where('timestamp', '<=', new Date(dateTo));
      }
      
      // Add sorting
      query = query.orderBy('timestamp', sort === 'desc' ? 'desc' : 'asc');
      
      // Get total count (for pagination metadata) - we need to do this separately
      // because Firestore doesn't support count() with complex queries efficiently
      const totalSnapshot = await this.firestore
        .collection('submissions')
        .where('form_id', '==', formId)
        .get();
      
      const total = totalSnapshot.size;
      
      // Apply pagination
      query = query.limit(limit).offset(offset);
      
      const submissionsSnapshot = await query.get();
      
      if (submissionsSnapshot.empty) {
        console.log(`📝 No submissions found for form: ${formId} (page ${Math.floor(offset/limit) + 1})`);
        return {
          submissions: [],
          total: 0,
          hasNext: false,
          hasPrev: offset > 0
        };
      }
      
      // Process submissions with lightweight data (no decryption yet)
      const submissions = submissionsSnapshot.docs.map(doc => {
        const data = doc.data();
        
        // Return lightweight version first
        const lightweightSubmission = {
          submission_id: data.submission_id,
          form_id: data.form_id,
          user_id: data.user_id,
          timestamp: data.timestamp?.toDate?.() || data.timestamp,
          ip_address: data.ip_address,
          user_agent: data.user_agent,
          is_hipaa: data.is_hipaa,
          encrypted: data.encrypted,
          file_associations: data.file_associations || [],
          // Don't include submission_data yet - load on demand
          submission_data: null,
          _needsDecryption: data.is_hipaa && (data.encrypted || data.data_gcs_path),
          _hasGcsData: data.is_hipaa && data.data_gcs_path
        };
        
        return lightweightSubmission;
      });
      
      const hasNext = offset + limit < total;
      const hasPrev = offset > 0;
      
      console.log(`✅ Retrieved ${submissions.length} submissions (page ${Math.floor(offset/limit) + 1}) for form: ${formId}`);
      console.log(`📊 Total: ${total}, HasNext: ${hasNext}, HasPrev: ${hasPrev}`);
      
      return {
        submissions,
        total,
        hasNext,
        hasPrev
      };
    } catch (error) {
      console.error(`❌ Error getting paginated submissions for ${formId}:`, error);
      return { submissions: [], total: 0, hasNext: false, hasPrev: false };
    }
  }

  /**
   * Get submission data on demand (lazy loading)
   */
  async getSubmissionData(submissionId) {
    try {
      console.log(`📋 Loading submission data for: ${submissionId}`);
      
      const submissionRef = this.firestore.collection('submissions').doc(submissionId);
      const submissionDoc = await submissionRef.get();
      
      if (!submissionDoc.exists) {
        console.log(`❌ Submission not found: ${submissionId}`);
        return null;
      }
      
      const data = submissionDoc.data();
      
      // Handle different data storage scenarios
      if (data.is_hipaa && data.data_gcs_path) {
        // HIPAA data stored in GCS (trimmed Firestore document)
        try {
          const bucketName = 'chatterforms-submissions-us-central1';
          console.log(`📥 Loading HIPAA submission from GCS: gs://${bucketName}/${data.data_gcs_path}`);
          const [buf] = await this.storage.bucket(bucketName).file(data.data_gcs_path).download();
          const submissionData = JSON.parse(buf.toString('utf8'));
          console.log(`✅ Loaded HIPAA submission from GCS: ${submissionId}`);
          return submissionData;
        } catch (error) {
          console.error(`❌ Failed loading HIPAA submission from GCS for ${submissionId}:`, error.message);
          return null;
        }
      } else if (data.is_hipaa && data.encrypted) {
        // HIPAA data encrypted in Firestore
        try {
          console.log(`🔓 Decrypting HIPAA submission: ${submissionId}`);
          const decryptedResult = await this.decryptData(data.submission_data, 'hipaa-data-key');
          console.log(`✅ HIPAA submission decrypted: ${submissionId}`);
          return decryptedResult.decryptedData;
        } catch (error) {
          console.error(`❌ Failed to decrypt HIPAA submission ${submissionId}:`, error.message);
          // Try fallback key
          try {
            console.log(`🔑 Attempting decryption with fallback key: form-data-key`);
            const decryptedResult = await this.decryptData(data.submission_data, 'form-data-key');
            console.log(`✅ HIPAA submission decrypted with fallback key: ${submissionId}`);
            return decryptedResult.decryptedData;
          } catch (fallbackError) {
            console.error(`❌ Failed to decrypt HIPAA submission ${submissionId} with fallback key:`, fallbackError.message);
            return null;
          }
        }
      } else {
        // Regular submission data
        console.log(`📝 Loading regular submission data: ${submissionId}`);
        return data.submission_data;
      }
    } catch (error) {
      console.error(`❌ Error loading submission data for ${submissionId}:`, error);
      return null;
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
      const debugDecrypt = process.env.DEBUG_DECRYPT === '1';
      if (debugDecrypt) {
        console.log(`🔍 Decryption debug - encryptedData type: ${typeof encryptedData}`);
        console.log(`🔍 Decryption debug - encryptedData isArray: ${Array.isArray(encryptedData)}`);
        console.log(`🔍 Decryption debug - encryptedData isBuffer: ${Buffer.isBuffer(encryptedData)}`);
      }
      
      if (Buffer.isBuffer(encryptedData)) {
        // New format: Buffer (stored directly)
        if (debugDecrypt) console.log(`🔍 Decryption debug - treating as Buffer, length: ${encryptedData.length}`);
        ciphertextBuffer = encryptedData;
      } else if (typeof encryptedData === 'string') {
        // Fallback: base64 string
        if (debugDecrypt) console.log(`🔍 Decryption debug - treating as base64 string, length: ${encryptedData.length}`);
        ciphertextBuffer = Buffer.from(encryptedData, 'base64');
      } else if (typeof encryptedData === 'object' && !Array.isArray(encryptedData)) {
        // Old corrupted format: numeric object (character-by-character)
        if (debugDecrypt) console.log(`🔍 Decryption debug - treating as corrupted numeric object, keys count: ${Object.keys(encryptedData).length}`);
        const numericArray = Object.values(encryptedData);
        if (debugDecrypt) console.log(`🔍 Decryption debug - numeric array length: ${numericArray.length}, first 10 values: ${numericArray.slice(0, 10).join(', ')}`);
        ciphertextBuffer = Buffer.from(numericArray);
      } else {
        throw new Error('Invalid encrypted data format');
      }
      
      if (debugDecrypt) console.log(`🔍 Decryption debug - final ciphertextBuffer length: ${ciphertextBuffer.length}`);

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

  /**
   * Get signed URLs for all signature images for a submission
   */
  async getSignatureSignedUrls(submissionId) {
    try {
      const submissionRef = this.firestore.collection('submissions').doc(submissionId);
      const doc = await submissionRef.get();
      if (!doc.exists) {
        return {};
      }
      const data = doc.data();
      const signatures = data.signatures || {};
      const result = {};

      for (const [fieldId, sig] of Object.entries(signatures)) {
        try {
          const bucketName = sig.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
          const file = this.storage.bucket(bucketName).file(sig.filename);
          const [exists] = await file.exists();
          if (!exists) {
            continue;
          }
          const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 });
          result[fieldId] = signedUrl;
        } catch (e) {
          console.warn(`⚠️ Could not create signed URL for signature field ${fieldId}: ${e.message}`);
        }
      }
      return result;
    } catch (error) {
      console.error('❌ Error generating signature signed URLs:', error);
      return {};
    }
  }

  /**
   * Get or create a signed PDF for a specific submission and signature field
   */
  async getOrCreateSignedPDF(submissionId, fieldId) {
    try {
      const submissionRef = this.firestore.collection('submissions').doc(submissionId);
      const doc = await submissionRef.get();
      if (!doc.exists) {
        throw new Error('Submission not found');
      }
      const data = doc.data();
      const formId = data.form_id;
      const isHipaa = !!data.is_hipaa;

      // If PDF already referenced, return its signed URL
      const existing = data.pdfs?.[fieldId];
      if (existing) {
        const bucketName = existing.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
        const url = await this.pdfGenerator.getPDFDownloadURL(bucketName, existing.filename, 60);
        return { success: true, downloadUrl: url, filename: existing.filename, size: existing.size };
      }

      // Need form data to generate. Load from Firestore field for non-HIPAA; for HIPAA from GCS JSON.
      let formData;
      if (isHipaa) {
        if (!data.data_gcs_path) throw new Error('HIPAA submission missing data_gcs_path');
        const [buf] = await this.storage.bucket('chatterforms-submissions-us-central1').file(data.data_gcs_path).download();
        formData = JSON.parse(buf.toString('utf8'));
      } else {
        formData = data.submission_data;
      }

      // Generate PDFs for signatures in this submission
      await this.generateSignedPDFIfNeeded(submissionId, formId, formData, isHipaa);

      // Reload and return
      const refreshed = await submissionRef.get();
      const refreshedPdf = refreshed.data().pdfs?.[fieldId];
      if (!refreshedPdf) {
        throw new Error('PDF not generated');
      }
      const bucketName = refreshedPdf.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
      const url = await this.pdfGenerator.getPDFDownloadURL(bucketName, refreshedPdf.filename, 60);
      return { success: true, downloadUrl: url, filename: refreshedPdf.filename, size: refreshedPdf.size };
    } catch (error) {
      console.error('❌ Error getOrCreateSignedPDF:', error);
      return { success: false, error: error.message };
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

      // Store signature images in GCS (skip PDF generation for now)
      await this.storeSignatureImages(submissionId, formId, formData, true);

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
   * Store signature images directly in GCS (simplified approach)
   */
  async storeSignatureImages(submissionId, formId, formData, isHipaa = false) {
    try {
      // Check for signature data in form submission
      const signatureFields = Object.entries(formData).filter(([key, value]) => 
        value && typeof value === 'object' && 'imageBase64' in value
      );

      if (signatureFields.length === 0) {
        console.log('📝 No signature data found, skipping signature storage');
        return;
      }

      console.log(`📝 Found ${signatureFields.length} signature field(s), storing in GCS...`);

      const bucketName = isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';

      // Store each signature image
      for (const [fieldId, signatureData] of signatureFields) {
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          // Determine file extension based on data URL prefix
          const isJpeg = signatureData.imageBase64.startsWith('data:image/jpeg;base64,');
          const fileExtension = isJpeg ? 'jpg' : 'png';
          const filename = `signatures/${submissionId}/${fieldId}_${timestamp}.${fileExtension}`;
          
          // Debug base64 data
          console.log(`📝 Base64 data length: ${signatureData.imageBase64.length}`);
          console.log(`📝 Base64 starts with: ${signatureData.imageBase64.substring(0, 50)}...`);
          console.log(`📝 Base64 ends with: ...${signatureData.imageBase64.substring(signatureData.imageBase64.length - 50)}`);
          
          // Clean base64 data - remove data URL prefix if present
          let cleanBase64 = signatureData.imageBase64;
          if (cleanBase64.startsWith('data:image/jpeg;base64,')) {
            cleanBase64 = cleanBase64.replace('data:image/jpeg;base64,', '');
            console.log(`📝 Removed JPEG data URL prefix, clean length: ${cleanBase64.length}`);
          } else if (cleanBase64.startsWith('data:image/png;base64,')) {
            cleanBase64 = cleanBase64.replace('data:image/png;base64,', '');
            console.log(`📝 Removed PNG data URL prefix, clean length: ${cleanBase64.length}`);
          }
          
          // Convert base64 to buffer
          const imageBuffer = Buffer.from(cleanBase64, 'base64');
          
          console.log(`📝 Buffer length: ${imageBuffer.length}`);
          console.log(`📝 Buffer first 20 bytes: ${imageBuffer.subarray(0, 20).toString('hex')}`);
          
          // Validate image header based on format
          if (isJpeg) {
            // Validate JPEG header (starts with FF D8)
            const jpegHeader = imageBuffer.subarray(0, 2);
            const expectedJpegHeader = Buffer.from([0xFF, 0xD8]);
            const isJpegValid = jpegHeader.equals(expectedJpegHeader);
            console.log(`📝 JPEG header valid: ${isJpegValid}`);
            console.log(`📝 JPEG header bytes: ${jpegHeader.toString('hex')}`);
            console.log(`📝 Expected JPEG header: ${expectedJpegHeader.toString('hex')}`);
            
            if (!isJpegValid) {
              console.error(`❌ Invalid JPEG header! This might be the issue.`);
            }
          } else {
            // Validate PNG header
            const pngHeader = imageBuffer.subarray(0, 8);
            const expectedPngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
            const isPng = pngHeader.equals(expectedPngHeader);
            console.log(`📝 PNG header valid: ${isPng}`);
            console.log(`📝 PNG header bytes: ${pngHeader.toString('hex')}`);
            console.log(`📝 Expected PNG header: ${expectedPngHeader.toString('hex')}`);
            
            if (!isPng) {
              console.error(`❌ Invalid PNG header! This might be the issue.`);
            }
          }
          
          // Upload to GCS
          const bucket = this.storage.bucket(bucketName);
          const file = bucket.file(filename);
          
          await file.save(imageBuffer, {
            metadata: {
              contentType: isJpeg ? 'image/jpeg' : 'image/png',
              metadata: {
                submissionId,
                fieldId,
                method: signatureData.method,
                completedAt: signatureData.completedAt,
                timezone: signatureData.timezone,
                isHipaa: isHipaa.toString(),
                format: isJpeg ? 'jpeg' : 'png'
              }
            }
          });

          console.log(`✅ Signature stored: ${filename}`);
          console.log(`📝 Signature file size: ${imageBuffer.length} bytes`);
          console.log(`📝 Signature bucket: ${bucketName}`);
          console.log(`📝 Signature GCS URL: gs://${bucketName}/${filename}`);
          
          // Store reference in Firestore (just metadata, not the image)
          await this.storeSignatureReference(submissionId, fieldId, {
            filename,
            url: `gs://${bucketName}/${filename}`,
            size: imageBuffer.length,
            method: signatureData.method,
            completedAt: signatureData.completedAt,
            timezone: signatureData.timezone,
            isHipaa
          });
          
        } catch (error) {
          console.error(`❌ Failed to store signature for field ${fieldId}:`, error);
          // Don't fail the entire submission if signature storage fails
        }
      }
    } catch (error) {
      console.error('❌ Error in signature storage:', error);
      // Don't fail the entire submission if signature storage fails
    }
  }

  /**
   * Store signature reference in Firestore (metadata only)
   */
  async storeSignatureReference(submissionId, fieldId, signatureInfo) {
    try {
      const submissionRef = this.firestore.collection('submissions').doc(submissionId);
      
      await submissionRef.update({
        [`signatures.${fieldId}`]: {
          filename: signatureInfo.filename,
          url: signatureInfo.url,
          size: signatureInfo.size,
          method: signatureInfo.method,
          completedAt: signatureInfo.completedAt,
          timezone: signatureInfo.timezone,
          isHipaa: signatureInfo.isHipaa,
          storedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Signature reference stored for submission ${submissionId}, field ${fieldId}`);
    } catch (error) {
      console.error('❌ Failed to store signature reference:', error);
    }
  }

  /**
   * Generate signed PDF if signature data exists in form submission
   */
  async generateSignedPDFIfNeeded(submissionId, formId, formData, isHipaa = false) {
    try {
      const crypto = require('crypto');
      // Check for signature data in form submission
      let signatureFields = Object.entries(formData).filter(([key, value]) => 
        value && typeof value === 'object' && 'imageBase64' in value
      );

      // Fallback: if base64 was excluded from submission_data, reconstruct from stored GCS signatures
      if (signatureFields.length === 0) {
        try {
          console.log('📄 No inline signature data found; attempting fallback via stored GCS signatures...');
          const subDoc = await this.firestore.collection('submissions').doc(submissionId).get();
          const sigMap = subDoc.exists ? (subDoc.data().signatures || {}) : {};
          const reconstructed = [];
          for (const [fieldId, sig] of Object.entries(sigMap)) {
            try {
              const bucketNameForSig = sig.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
              const [buf] = await this.storage.bucket(bucketNameForSig).file(sig.filename).download();
              reconstructed.push([fieldId, { imageBase64: buf.toString('base64') }]);
            } catch (e) {
              console.warn(`⚠️ Failed to reconstruct signature for ${fieldId}: ${e.message}`);
            }
          }
          if (reconstructed.length > 0) {
            signatureFields = reconstructed;
            console.log(`📄 Reconstructed ${reconstructed.length} signature(s) from GCS for PDF generation.`);
          }
        } catch (e) {
          console.warn('⚠️ Fallback GCS signature reconstruction failed:', e.message);
        }
      }

      if (signatureFields.length === 0) {
        console.log('📄 No signature data found (after fallback), skipping PDF generation');
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
      const bucketName = isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';

      // Compute immutable submission hash for audit trail (does not reveal PHI)
      const submissionHash = crypto.createHash('sha256').update(JSON.stringify(formData)).digest('hex');

      // Fetch submission metadata for audit (IP/UA)
      let ipAddress = undefined;
      let userAgent = undefined;
      try {
        const subDoc = await this.firestore.collection('submissions').doc(submissionId).get();
        if (subDoc.exists) {
          const sdata = subDoc.data();
          ipAddress = sdata?.ip_address;
          userAgent = sdata?.user_agent;
        }
      } catch {}

      // Generate PDF for each signature field
      for (const [fieldId, signatureData] of signatureFields) {
        try {
          const pdfResult = await this.pdfGenerator.generateSignedPDF({
            formData,
            formSchema,
            signatureData,
            bucketName,
            isHipaa,
            submissionId,
            submissionHash,
            ipAddress,
            userAgent
          });

          console.log(`✅ PDF generated: ${pdfResult.filename}`);
          console.log(`📄 PDF URL: ${pdfResult.url}`);
          console.log(`📄 PDF size: ${Math.round(pdfResult.size/1024)}KB`);
          
          // Store PDF reference in submission metadata
          await this.storePDFReference(submissionId, fieldId, { ...pdfResult, submissionHash }, isHipaa);
          
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

  // ============== PAYMENT INTEGRATION METHODS ==============

  /**
   * Store Stripe account information for a user
   */
  async storeStripeAccount(userId, stripeAccountId, accountType, accountData, nickname = null) {
    try {
      console.log(`💳 Storing Stripe account for user: ${userId}`);
      
      const accountRef = this.firestore.collection('user_stripe_accounts').doc();
      
      const accountDoc = {
        user_id: userId,
        stripe_account_id: stripeAccountId,
        account_type: accountType,
        nickname: nickname || null,
        is_verified: accountData.charges_enabled && accountData.details_submitted,
        capabilities: accountData.capabilities || {},
        charges_enabled: accountData.charges_enabled || false,
        payouts_enabled: accountData.payouts_enabled || false,
        details_submitted: accountData.details_submitted || false,
        country: accountData.country || 'US',
        default_currency: accountData.default_currency || 'usd',
        email: accountData.email || '',
        created_at: new Date(),
        updated_at: new Date(),
        last_sync_at: new Date()
      };

      await accountRef.set(accountDoc);
      console.log(`✅ Stripe account stored: ${accountRef.id}${nickname ? ` (nickname: ${nickname})` : ''}`);
      return accountRef.id;
    } catch (error) {
      console.error('❌ Error storing Stripe account:', error);
      throw error;
    }
  }

  /**
   * Get user's Stripe account information
   */
  async getStripeAccount(userId) {
    try {
      console.log(`💳 Getting Stripe account for user: ${userId}`);
      
      const accountQuery = await this.firestore
        .collection('user_stripe_accounts')
        .where('user_id', '==', userId)
        .get();

      if (accountQuery.empty) {
        console.log(`❌ No Stripe account found for user: ${userId}`);
        return null;
      }

      // Log all accounts found for debugging
      console.log(`🔍 Found ${accountQuery.docs.length} Stripe account(s) for user: ${userId}`);
      accountQuery.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`  Account ${index + 1}: ${data.stripe_account_id} (created: ${data.created_at})`);
      });

      // Return the most recent account (by created_at)
      const accounts = accountQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sortedAccounts = accounts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const accountData = sortedAccounts[0];
      
      console.log(`✅ Using most recent Stripe account: ${accountData.stripe_account_id}`);
      return accountData;
    } catch (error) {
      console.error('❌ Error getting Stripe account:', error);
      return null;
    }
  }

  /**
   * Store payment field configuration for a form
   */
  async storePaymentField(formId, fieldId, paymentConfig) {
    try {
      console.log(`💰 Storing payment field for form: ${formId}, field: ${fieldId}`);
      
      const fieldRef = this.firestore.collection('payment_fields').doc();
      
      const fieldDoc = {
        form_id: formId,
        field_id: fieldId,
        amount: paymentConfig.amount,
        currency: paymentConfig.currency || 'usd',
        description: paymentConfig.description || '',
        product_name: paymentConfig.product_name || '',
        stripe_account_id: paymentConfig.stripe_account_id,
        is_required: paymentConfig.isRequired !== false,
        metadata: paymentConfig.metadata || {},
        created_at: new Date(),
        updated_at: new Date()
      };

      await fieldRef.set(fieldDoc);
      console.log(`✅ Payment field stored: ${fieldRef.id}`);
      return fieldRef.id;
    } catch (error) {
      console.error('❌ Error storing payment field:', error);
      throw error;
    }
  }

  /**
   * Get payment fields for a form
   */
  async getPaymentFields(formId) {
    try {
      console.log(`💰 Getting payment fields for form: ${formId}`);
      
      const fieldsQuery = await this.firestore
        .collection('payment_fields')
        .where('form_id', '==', formId)
        .get();

      const fields = fieldsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`✅ Found ${fields.length} payment fields for form: ${formId}`);
      
      // DEBUG: Log all payment fields found
      console.log('🔍 PAYMENT FIELDS DEBUG - All fields found:');
      fields.forEach((field, index) => {
        console.log(`🔍 Field ${index + 1}:`, {
          id: field.id,
          field_id: field.field_id,
          form_id: field.form_id,
          stripe_account_id: field.stripe_account_id,
          amount: field.amount,
          currency: field.currency,
          created_at: field.created_at,
          updated_at: field.updated_at
        });
      });
      
      return fields;
    } catch (error) {
      console.error('❌ Error getting payment fields:', error);
      return [];
    }
  }

  /**
   * Store payment transaction record
   */
  async storePaymentTransaction(submissionId, formId, fieldId, paymentData) {
    try {
      console.log(`💳 Storing payment transaction for submission: ${submissionId}`);
      
      const transactionRef = this.firestore.collection('payment_transactions').doc();
      
      const transactionDoc = {
        submission_id: submissionId,
        form_id: formId,
        field_id: fieldId,
        stripe_payment_intent_id: paymentData.paymentIntentId,
        stripe_account_id: paymentData.stripeAccountId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: paymentData.status || 'pending',
        customer_email: paymentData.customerEmail || '',
        customer_name: paymentData.customerName,
        billing_address: paymentData.billingAddress,
        payment_method: paymentData.paymentMethod,
        receipt_url: paymentData.receiptUrl,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: paymentData.completedAt,
        failure_reason: paymentData.failureReason
      };

      await transactionRef.set(transactionDoc);
      console.log(`✅ Payment transaction stored: ${transactionRef.id}`);
      return transactionRef.id;
    } catch (error) {
      console.error('❌ Error storing payment transaction:', error);
      throw error;
    }
  }

  /**
   * Update Stripe account data
   */
  async updateStripeAccount(accountId, updates) {
    try {
      console.log(`💳 Updating Stripe account: ${accountId}`);
      
      const accountRef = this.firestore.collection('user_stripe_accounts').doc(accountId);
      await accountRef.update({
        ...updates,
        updated_at: new Date()
      });
      
      console.log(`✅ Stripe account updated: ${accountId}`);
      return true;
    } catch (error) {
      console.error('❌ Error updating Stripe account:', error);
      return false;
    }
  }

  /**
   * Update payment field configuration
   */
  async updatePaymentField(formId, fieldId, updates) {
    try {
      console.log(`💳 Updating payment field for form: ${formId}, field: ${fieldId}`);
      
      const fieldsQuery = await this.firestore
        .collection('payment_fields')
        .where('form_id', '==', formId)
        .where('field_id', '==', fieldId)
        .get();

      if (fieldsQuery.empty) {
        throw new Error('Payment field not found');
      }

      // If multiple records exist, delete duplicates and keep the most recent one
      if (fieldsQuery.docs.length > 1) {
        console.log(`⚠️ Found ${fieldsQuery.docs.length} duplicate payment fields for ${formId}/${fieldId}`);
        console.log('🧹 Cleaning up duplicates...');
        
        // Sort by created_at to get the most recent
        const sortedDocs = fieldsQuery.docs.sort((a, b) => {
          const aTime = a.data().created_at?._seconds || 0;
          const bTime = b.data().created_at?._seconds || 0;
          return bTime - aTime; // Most recent first
        });
        
        // Keep the most recent, delete the rest
        const keepDoc = sortedDocs[0];
        const deleteDocs = sortedDocs.slice(1);
        
        console.log(`🧹 Keeping document: ${keepDoc.id}`);
        console.log(`🧹 Deleting ${deleteDocs.length} duplicate documents`);
        
        // Delete duplicates
        const batch = this.firestore.batch();
        deleteDocs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        
        console.log(`✅ Cleaned up ${deleteDocs.length} duplicate payment fields`);
        
        // Update the remaining document
        await keepDoc.ref.update({
          ...updates,
          updated_at: new Date()
        });
        
        console.log(`✅ Payment field updated: ${keepDoc.id}`);
        return keepDoc.id;
      } else {
        // Single record - update normally
        const fieldDoc = fieldsQuery.docs[0];
        await fieldDoc.ref.update({
          ...updates,
          updated_at: new Date()
        });

        console.log(`✅ Payment field updated: ${fieldDoc.id}`);
        return fieldDoc.id;
      }
    } catch (error) {
      console.error('❌ Error updating payment field:', error);
      throw error;
    }
  }

  /**
   * Get all Stripe accounts for a user
   */
  async getStripeAccounts(userId) {
    try {
      console.log(`💳 Getting all Stripe accounts for user: ${userId}`);
      
      const accountQuery = await this.firestore
        .collection('user_stripe_accounts')
        .where('user_id', '==', userId)
        .get();

      if (accountQuery.empty) {
        console.log(`❌ No Stripe accounts found for user: ${userId}`);
        return [];
      }

      const accounts = accountQuery.docs.map(doc => ({
        id: doc.id,
        stripe_account_id: doc.data().stripe_account_id,
        account_type: doc.data().account_type,
        nickname: doc.data().nickname || null,
        charges_enabled: doc.data().charges_enabled,
        payouts_enabled: doc.data().payouts_enabled,
        details_submitted: doc.data().details_submitted,
        country: doc.data().country,
        default_currency: doc.data().default_currency,
        email: doc.data().email,
        created_at: doc.data().created_at,
        last_sync_at: doc.data().last_sync_at
      }));

      console.log(`✅ Found ${accounts.length} Stripe account(s) for user: ${userId}`);
      return accounts;
    } catch (error) {
      console.error('❌ Error getting Stripe accounts:', error);
      return [];
    }
  }

  /**
   * Delete Stripe account and related data
   */
  async deleteStripeAccount(userId, accountId) {
    try {
      console.log(`🗑️ Deleting Stripe account ${accountId} for user: ${userId}`);
      
      // Get the specific account to verify ownership
      const accountRef = this.firestore.collection('user_stripe_accounts').doc(accountId);
      const accountDoc = await accountRef.get();
      
      if (!accountDoc.exists) {
        console.log(`❌ Stripe account ${accountId} not found`);
        return false;
      }

      const accountData = accountDoc.data();
      if (accountData.user_id !== userId) {
        console.warn(`⚠️ User ${userId} attempted to delete Stripe account ${accountId} owned by another user`);
        return false; // Not authorized
      }

      // Delete the account record
      await accountRef.delete();
      console.log(`✅ Deleted Stripe account record: ${accountId}`);
      
      // Clean up related payment fields for this specific account
      const paymentFieldsQuery = await this.firestore
        .collection('payment_fields')
        .where('stripe_account_id', '==', accountData.stripe_account_id)
        .get();
      
      if (paymentFieldsQuery.docs.length > 0) {
        const batch = this.firestore.batch();
        paymentFieldsQuery.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`✅ Deleted ${paymentFieldsQuery.docs.length} payment fields for account: ${accountData.stripe_account_id}`);
      }
      
      // Note: We don't delete payment transactions for audit/compliance reasons
      console.log(`✅ Stripe account deleted: ${accountId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting Stripe account:', error);
      return false;
    }
  }

  /**
   * Update payment transaction status
   */
  async updatePaymentTransaction(transactionId, updates) {
    try {
      console.log(`💳 Updating payment transaction: ${transactionId}`);
      
      const transactionRef = this.firestore.collection('payment_transactions').doc(transactionId);
      
      const updateData = {
        ...updates,
        updated_at: new Date()
      };

      await transactionRef.update(updateData);
      console.log(`✅ Payment transaction updated: ${transactionId}`);
    } catch (error) {
      console.error('❌ Error updating payment transaction:', error);
      throw error;
    }
  }

  /**
   * Get payment transactions for a submission
   */
  async getPaymentTransactions(submissionId) {
    try {
      console.log(`💳 Getting payment transactions for submission: ${submissionId}`);
      
      const transactionsQuery = await this.firestore
        .collection('payment_transactions')
        .where('submission_id', '==', submissionId)
        .get();

      const transactions = transactionsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`✅ Found ${transactions.length} payment transactions for submission: ${submissionId}`);
      return transactions;
    } catch (error) {
      console.error('❌ Error getting payment transactions:', error);
      return [];
    }
  }

  /**
   * Get payment transaction by Stripe payment intent ID
   */
  async getPaymentTransactionByIntentId(paymentIntentId) {
    try {
      console.log(`💳 Getting payment transaction by intent ID: ${paymentIntentId}`);
      
      const transactionQuery = await this.firestore
        .collection('payment_transactions')
        .where('stripe_payment_intent_id', '==', paymentIntentId)
        .limit(1)
        .get();

      if (transactionQuery.empty) {
        console.log(`❌ No payment transaction found for intent: ${paymentIntentId}`);
        return null;
      }

      const transactionDoc = transactionQuery.docs[0];
      const transactionData = { id: transactionDoc.id, ...transactionDoc.data() };
      console.log(`✅ Found payment transaction: ${transactionData.id}`);
      return transactionData;
    } catch (error) {
      console.error('❌ Error getting payment transaction by intent ID:', error);
      return null;
    }
  }

  // ========================================
  // CALENDLY INTEGRATION METHODS
  // ========================================

  /**
   * Store Calendly account information
   */
  async storeCalendlyAccount(userId, calendlyUsername, calendlyUrl, eventTypes) {
    try {
      console.log(`📅 Storing Calendly account for user: ${userId}`);
      
      const accountRef = this.firestore.collection('user_calendly_accounts').doc();
      
      const accountDoc = {
        user_id: userId,
        calendly_username: calendlyUsername,
        calendly_url: calendlyUrl,
        is_connected: true,
        event_types: eventTypes || [],
        created_at: new Date(),
        updated_at: new Date(),
        last_sync_at: new Date()
      };

      await accountRef.set(accountDoc);
      console.log(`✅ Calendly account stored: ${accountRef.id}`);
      return accountRef.id;
    } catch (error) {
      console.error('❌ Error storing Calendly account:', error);
      throw error;
    }
  }

  /**
   * Get user's Calendly account
   */
  async getCalendlyAccount(userId) {
    try {
      console.log(`📅 Getting Calendly account for user: ${userId}`);
      
      const accountQuery = await this.firestore
        .collection('user_calendly_accounts')
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (accountQuery.empty) {
        console.log(`❌ No Calendly account found for user: ${userId}`);
        return null;
      }

      const accountDoc = accountQuery.docs[0];
      const accountData = { id: accountDoc.id, ...accountDoc.data() };
      console.log(`✅ Found Calendly account: ${accountData.id}`);
      return accountData;
    } catch (error) {
      console.error('❌ Error getting Calendly account:', error);
      return null;
    }
  }

  async getCalendlyAccounts(userId) {
    try {
      console.log(`📅 Getting all Calendly accounts for user: ${userId}`);
      
      const accountsQuery = await this.firestore
        .collection('user_calendly_accounts')
        .where('user_id', '==', userId)
        .get();

      if (accountsQuery.empty) {
        console.log(`❌ No Calendly accounts found for user: ${userId}`);
        return [];
      }

      const accounts = accountsQuery.docs.map(doc => ({
        id: doc.id,
        calendly_url: doc.data().calendly_url,
        event_types: doc.data().event_types || [],
        is_connected: doc.data().is_connected || true,
        created_at: doc.data().created_at
      }));

      console.log(`✅ Found ${accounts.length} Calendly accounts for user: ${userId}`);
      return accounts;
    } catch (error) {
      console.error('❌ Error getting Calendly accounts:', error);
      return [];
    }
  }

  /**
   * Delete a Calendly account URL for a user
   */
  async deleteCalendlyAccount(userId, accountId) {
    try {
      console.log(`🗑️ Deleting Calendly account ${accountId} for user: ${userId}`);
      const ref = this.firestore.collection('user_calendly_accounts').doc(accountId);
      const doc = await ref.get();
      if (!doc.exists) {
        console.log(`❌ Calendly account not found: ${accountId}`);
        return { success: false, reason: 'not_found' };
      }
      const data = doc.data() || {};
      if (data.user_id !== userId) {
        console.log(`❌ Forbidden delete attempt for account ${accountId}`);
        return { success: false, reason: 'forbidden' };
      }
      await ref.delete();
      console.log(`✅ Calendly account deleted: ${accountId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error deleting Calendly account:', error);
      return { success: false, reason: 'error' };
    }
  }

  /**
   * Store calendar field configuration
   */
  async storeCalendarField(formId, fieldId, calendarConfig) {
    try {
      console.log(`📅 Storing calendar field for form: ${formId}, field: ${fieldId}`);
      
      // Validate required fields
      if (!formId || !fieldId) {
        throw new Error('Form ID and field ID are required');
      }
      
      if (!calendarConfig.calendlyUrl || !calendarConfig.eventName) {
        throw new Error('Calendly URL and event name are required');
      }
      
      // Validate duration is a positive number
      if (calendarConfig.duration && (typeof calendarConfig.duration !== 'number' || calendarConfig.duration <= 0)) {
        throw new Error('Duration must be a positive number');
      }
      
      const fieldRef = this.firestore.collection('calendar_fields').doc();
      
      const fieldDoc = {
        form_id: formId,
        field_id: fieldId,
        calendly_url: calendarConfig.calendlyUrl,
        event_type_uri: calendarConfig.eventTypeUri || `${calendarConfig.calendlyUrl}/${calendarConfig.duration || 15}min`,
        event_name: calendarConfig.eventName,
        duration: calendarConfig.duration || 15,
        require_payment_first: calendarConfig.requirePaymentFirst || false,
        is_required: calendarConfig.isRequired !== false,
        timezone: calendarConfig.timezone || 'UTC',
        metadata: calendarConfig.metadata || {},
        created_at: new Date(),
        updated_at: new Date()
      };

      await fieldRef.set(fieldDoc);
      console.log(`✅ Calendar field stored: ${fieldRef.id}`);
      return fieldRef.id;
    } catch (error) {
      console.error('❌ Error storing calendar field:', error);
      throw error;
    }
  }

  /**
   * Get calendar fields for a form
   */
  async getCalendarFields(formId) {
    try {
      console.log(`📅 Getting calendar fields for form: ${formId}`);
      
      const fieldsQuery = await this.firestore
        .collection('calendar_fields')
        .where('form_id', '==', formId)
        .get();

      const fields = fieldsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`✅ Found ${fields.length} calendar fields for form: ${formId}`);
      return fields;
    } catch (error) {
      console.error('❌ Error getting calendar fields:', error);
      return [];
    }
  }

  /**
   * Store calendar booking
   */
  async storeCalendarBooking(submissionId, formId, fieldId, bookingData) {
    try {
      console.log(`📅 Storing calendar booking for submission: ${submissionId}`);
      
      const bookingRef = this.firestore.collection('calendar_bookings').doc();
      
      const bookingDoc = {
        submission_id: submissionId,
        form_id: formId,
        field_id: fieldId,
        calendly_event_uri: bookingData.eventUri,
        event_name: bookingData.eventName,
        start_time: bookingData.startTime,
        end_time: bookingData.endTime,
        duration: bookingData.duration,
        timezone: bookingData.timezone,
        attendee_email: bookingData.attendeeEmail,
        attendee_name: bookingData.attendeeName,
        attendee_phone: bookingData.attendeePhone,
        status: 'scheduled',
        calendly_booking_url: bookingData.bookingUrl,
        created_at: new Date(),
        updated_at: new Date()
      };

      await bookingRef.set(bookingDoc);
      console.log(`✅ Calendar booking stored: ${bookingRef.id}`);
      return bookingRef.id;
    } catch (error) {
      console.error('❌ Error storing calendar booking:', error);
      throw error;
    }
  }

  /**
   * Update calendar booking status
   */
  async updateCalendarBooking(bookingId, updates) {
    try {
      console.log(`📅 Updating calendar booking: ${bookingId}`);
      
      const bookingRef = this.firestore.collection('calendar_bookings').doc(bookingId);
      
      const updateData = {
        ...updates,
        updated_at: new Date()
      };

      await bookingRef.update(updateData);
      console.log(`✅ Calendar booking updated: ${bookingId}`);
    } catch (error) {
      console.error('❌ Error updating calendar booking:', error);
      throw error;
    }
  }

  /**
   * Get calendar bookings for a submission
   */
  async getCalendarBookings(submissionId) {
    try {
      console.log(`📅 Getting calendar bookings for submission: ${submissionId}`);
      
      const bookingsQuery = await this.firestore
        .collection('calendar_bookings')
        .where('submission_id', '==', submissionId)
        .get();

      const bookings = bookingsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`✅ Found ${bookings.length} calendar bookings for submission: ${submissionId}`);
      return bookings;
    } catch (error) {
      console.error('❌ Error getting calendar bookings:', error);
      return [];
    }
  }

  // ============== LOGO MANAGEMENT METHODS ==============

  /**
   * Store logo metadata in Firestore
   */
  async storeLogoMetadata(logoData) {
    try {
      console.log(`🖼️ Storing logo metadata: ${logoData.id}`);
      
      const logoRef = this.firestore.collection('user_logos').doc(logoData.id);
      await logoRef.set(logoData);
      
      console.log(`✅ Logo metadata stored: ${logoData.id}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error storing logo metadata:', error);
      throw error;
    }
  }

  /**
   * Get user's logos from Firestore
   */
  async getUserLogos(userId) {
    try {
      console.log(`🖼️ Getting logos for user: ${userId}`);
      
      // Use a simpler query to avoid index requirements
      const logosSnapshot = await this.firestore
        .collection('user_logos')
        .where('userId', '==', userId)
        .get();
      
      const logos = [];
      logosSnapshot.forEach(doc => {
        const data = doc.data();
        // Filter active logos in memory instead of in query
        if (data.isActive !== false) {
          // Use backend proxy URL to avoid CORS issues
          const backendUrl = `${process.env.RAILWAY_PUBLIC_DOMAIN || 'https://my-poppler-api-dev.up.railway.app'}/api/files/logo/${userId}/${data.id}`;
          logos.push({
            id: data.id,
            url: backendUrl,
            displayName: data.displayName,
            position: 'center', // Default position
            height: 150, // Default height
            uploadedAt: data.uploadedAt
          });
        }
      });
      
      // Sort by uploadedAt in memory
      logos.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      
      console.log(`✅ Found ${logos.length} logos for user: ${userId}`);
      return logos;
    } catch (error) {
      console.error('❌ Error getting user logos:', error);
      throw error;
    }
  }

  /**
   * Delete logo from GCP and Firestore
   */
  async deleteLogo(logoId, userId) {
    try {
      console.log(`🗑️ Deleting logo: ${logoId} for user: ${userId}`);
      
      // First, get the logo metadata to find the GCP file path
      const logoRef = this.firestore.collection('user_logos').doc(logoId);
      const logoDoc = await logoRef.get();
      
      if (!logoDoc.exists) {
        return { success: false, error: 'Logo not found' };
      }
      
      const logoData = logoDoc.data();
      
      // Verify the logo belongs to the user
      if (logoData.userId !== userId) {
        return { success: false, error: 'Unauthorized: Logo does not belong to user' };
      }
      
      // Delete from GCP Cloud Storage
      try {
        const gcpUrl = logoData.gcpUrl;
        if (gcpUrl && gcpUrl.startsWith('gs://')) {
          const bucketName = gcpUrl.split('/')[2];
          const fileName = gcpUrl.split('/').slice(3).join('/');
          
          const bucket = this.storage.bucket(bucketName);
          const file = bucket.file(fileName);
          
          await file.delete();
          console.log(`✅ Deleted logo file from GCP: ${fileName}`);
        }
      } catch (gcpError) {
        console.error('❌ Error deleting logo from GCP (non-blocking):', gcpError);
        // Continue with Firestore deletion even if GCP deletion fails
      }
      
      // Mark as inactive in Firestore (soft delete)
      await logoRef.update({
        isActive: false,
        deletedAt: new Date().toISOString()
      });
      
      console.log(`✅ Logo marked as deleted: ${logoId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error deleting logo:', error);
      throw error;
    }
  }
}

module.exports = GCPClient;
