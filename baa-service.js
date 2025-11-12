const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

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
      
      htmlTemplate = htmlTemplate
        .replace(/{{userName}}/g, (userData.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{userEmail}}/g, (userData.email || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{company}}/g, (userData.company || 'N/A').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .replace(/{{effectiveDate}}/g, effectiveDate)
        .replace(/{{signature}}/g, signatureData.imageBase64 || '')
        .replace(/{{baSignature}}/g, baSignature);
      
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
      
      // Upload to GCS (HIPAA bucket)
      const bucketName = process.env.GCS_HIPAA_BUCKET || 'chatterforms-hipaa-data';
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

