/**
 * Script to upload BAA review PDF to GCS and generate public URL
 * 
 * Usage: node scripts/upload-baa-review-pdf.js
 */

const fs = require('fs');
const path = require('path');

// Set up credentials for local execution if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    // Read the credentials file and set it as JSON string
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');

async function uploadBAAReviewPDF() {
  try {
    console.log('📤 Uploading BAA review PDF to GCS...');
    
    // Load PDF file
    const pdfPath = path.join(__dirname, '..', 'static', 'baa-review-template.pdf');
    
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found at: ${pdfPath}`);
    }
    
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log(`📄 PDF file size: ${pdfBuffer.length} bytes`);
    
    // Initialize GCP client
    const gcpClient = new GCPClient();
    
    // Use the uploads bucket - we'll make the file publicly readable
    // This bucket exists and is used for other public files
    const bucketName = process.env.GCS_PUBLIC_BUCKET || 'chatterforms-uploads-us-central1';
    
    console.log(`📦 Using bucket: ${bucketName}`);
    
    // Upload to GCS
    const filename = 'baa-review-template.pdf';
    const bucket = gcpClient.storage.bucket(bucketName);
    const file = bucket.file(filename);
    
    console.log('⬆️  Uploading to GCS...');
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
        metadata: {
          uploadedAt: new Date().toISOString(),
          purpose: 'BAA review template'
        }
      }
    });
    
    // Make file publicly readable
    console.log('🔓 Making file publicly readable...');
    await file.makePublic();
    
    // Generate public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;
    
    console.log('');
    console.log('✅ BAA review PDF uploaded successfully!');
    console.log('');
    console.log('📋 Environment Variable for Railway:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`NEXT_PUBLIC_BAA_REVIEW_PDF_URL=${publicUrl}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`🔗 Public URL: ${publicUrl}`);
    console.log(`📁 GCS Path: gs://${bucketName}/${filename}`);
    console.log('');
    console.log('💡 Copy the environment variable above and add it to Railway.');
    
    return {
      success: true,
      publicUrl,
      gcsPath: `gs://${bucketName}/${filename}`,
      bucketName,
      filename
    };
  } catch (error) {
    console.error('❌ Error uploading BAA review PDF:', error);
    
    // If public bucket doesn't exist, try with signed URL instead
    if (error.code === 404 || error.message.includes('bucket')) {
      console.log('');
      console.log('⚠️  Public bucket not found. Trying with signed URL instead...');
      
      try {
        const gcpClient = new GCPClient();
        const bucketName = process.env.GCS_HIPAA_BUCKET || 'chatterforms-hipaa-data';
        const pdfPath = path.join(__dirname, '..', 'static', 'baa-review-template.pdf');
        const pdfBuffer = fs.readFileSync(pdfPath);
        const filename = 'baa-review-template.pdf';
        
        const bucket = gcpClient.storage.bucket(bucketName);
        const file = bucket.file(filename);
        
        await file.save(pdfBuffer, {
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000',
            metadata: {
              uploadedAt: new Date().toISOString(),
              purpose: 'BAA review template'
            }
          }
        });
        
        // Generate signed URL (valid for 1 year)
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
        });
        
        console.log('');
        console.log('✅ BAA review PDF uploaded with signed URL!');
        console.log('');
        console.log('📋 Environment Variable for Railway:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`NEXT_PUBLIC_BAA_REVIEW_PDF_URL=${signedUrl}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log(`🔗 Signed URL (valid for 1 year): ${signedUrl}`);
        console.log(`📁 GCS Path: gs://${bucketName}/${filename}`);
        console.log('');
        console.log('💡 Copy the environment variable above and add it to Railway.');
        
        return {
          success: true,
          publicUrl: signedUrl,
          gcsPath: `gs://${bucketName}/${filename}`,
          bucketName,
          filename,
          isSignedUrl: true
        };
      } catch (signedError) {
        throw new Error(`Failed to upload with signed URL: ${signedError.message}`);
      }
    }
    
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  uploadBAAReviewPDF()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = uploadBAAReviewPDF;

