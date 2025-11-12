const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

class BAAService {
  constructor(gcpClient) {
    this.gcpClient = gcpClient;
  }
  
  async generateBAAPDF(userData, signatureData) {
    try {
      console.log('📄 Generating BAA PDF for user:', userData.email);
      
      // Load BAA HTML template
      const templatePath = path.join(__dirname, 'templates', 'baa-template.html');
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`BAA template not found at: ${templatePath}`);
      }
      
      let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
      
      // Replace placeholders
      // Use the date from signatureData.completedAt (when user signed) as the effective date
      // This ensures both signatures have the same date
      const effectiveDate = new Date(signatureData.completedAt || new Date()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      // Load Business Associate signature (pre-signed)
      // This should be a base64 image stored in environment variable or file
      let baSignature = '';
      try {
        // Try to load from environment variable first
        if (process.env.BA_SIGNATURE_BASE64) {
          baSignature = process.env.BA_SIGNATURE_BASE64;
        } else {
          // Fallback: try to load from file
          const baSignaturePath = path.join(__dirname, 'static', 'ba-signature-base64.txt');
          if (fs.existsSync(baSignaturePath)) {
            baSignature = fs.readFileSync(baSignaturePath, 'utf8').trim();
          } else {
            console.warn('⚠️  Business Associate signature not found. Using placeholder.');
            // Use a placeholder - this should be replaced with actual signature
            baSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          }
        }
      } catch (error) {
        console.warn('⚠️  Error loading BA signature:', error.message);
        baSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      }
      
      // Get company name from signature data or user data
      const companyName = signatureData.companyName || userData.company || null;
      
      // Covered Entity name: Company name if provided, else user name
      const coveredEntityName = companyName && companyName !== 'N/A' ? companyName : (userData.name || 'N/A');
      
      // Get authorized signatory name for Business Associate
      const baAuthorizedSignatory = process.env.BA_AUTHORIZED_SIGNATORY_NAME || 'Abhishek Jha';
      
      // Compute SHA-256 hash of BAA agreement data for verification
      // Hash includes: user info, company, signatures, dates, and agreement content
      // Similar to form submission hashing for consistency
      
      // Hash the signature images for integrity verification
      const userSignatureHash = signatureData.imageBase64 
        ? crypto.createHash('sha256').update(signatureData.imageBase64).digest('hex').substring(0, 16)
        : null;
      const baSignatureHash = baSignature && baSignature.startsWith('data:image')
        ? crypto.createHash('sha256').update(baSignature).digest('hex').substring(0, 16)
        : null;
      
      const baaDataForHash = {
        userId: userData.userId,
        userName: userData.name,
        userEmail: userData.email,
        companyName: companyName || null,
        coveredEntityName: coveredEntityName,
        effectiveDate: effectiveDate,
        baAuthorizedSignatory: baAuthorizedSignatory,
        signatureMethod: signatureData.method || 'click',
        signatureCompletedAt: signatureData.completedAt,
        userSignatureHash: userSignatureHash,
        baSignatureHash: baSignatureHash,
        agreementType: 'BAA',
        businessAssociate: 'Chatterforms / Neo HealthTech LLC',
        agreementVersion: '1.0'
      };
      
      // Create deterministic hash (sorted keys for consistency)
      const sortedHashData = JSON.stringify(baaDataForHash, Object.keys(baaDataForHash).sort());
      const baaHash = crypto.createHash('sha256')
        .update(sortedHashData)
        .digest('hex');
      
      const hashDisplay = `<div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; background: #f9fafb; padding: 15px; border-radius: 6px;">
        <p style="margin: 0 0 8px 0;"><strong>Agreement Verification Hash (SHA-256):</strong></p>
        <p style="margin: 0 0 8px 0; font-family: monospace; font-size: 10px; word-break: break-all; color: #1f2937;">${baaHash}</p>
        <p style="margin: 8px 0 0 0; font-size: 10px; color: #6b7280;">This hash verifies the integrity and authenticity of this agreement. It includes all parties, signatures, dates, and agreement terms.</p>
      </div>`;
      
      htmlTemplate = htmlTemplate
        .replace(/{{userName}}/g, (userData.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{userEmail}}/g, (userData.email || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{company}}/g, (companyName || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{coveredEntityName}}/g, coveredEntityName.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{baAuthorizedSignatory}}/g, baAuthorizedSignatory.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{effectiveDate}}/g, effectiveDate)
        .replace(/{{signature}}/g, signatureData.imageBase64 || '')
        .replace(/{{baSignature}}/g, baSignature)
        .replace(/{{baaHash}}/g, hashDisplay);
      
      // Generate PDF using puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      
      const page = await browser.newPage();
      await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
      
      // Add a delay to ensure everything is rendered
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { 
          top: '20mm', 
          right: '20mm', 
          bottom: '20mm', 
          left: '20mm' 
        }
      });
      
      await browser.close();
      
      // Upload to GCS (HIPAA bucket - use existing HIPAA submissions bucket)
      const bucketName = process.env.GCS_HIPAA_BUCKET || 'chatterforms-submissions-us-central1';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `baa-agreements/${userData.userId}_${timestamp}.pdf`;
      
      const bucket = this.gcpClient.storage.bucket(bucketName);
      const file = bucket.file(filename);
      
      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            userId: userData.userId,
            userEmail: userData.email,
            generatedAt: new Date().toISOString()
          }
        },
        private: true
      });
      
      console.log('✅ BAA PDF generated and uploaded:', filename);
      
      return {
        success: true,
        filename,
        url: `gs://${bucketName}/${filename}`,
        size: pdfBuffer.length
      };
    } catch (error) {
      console.error('❌ BAA PDF generation failed:', error);
      throw error;
    }
  }
}

module.exports = BAAService;

