const puppeteer = require('puppeteer');

class PDFGenerator {
  constructor(gcpClient) {
    this.gcpClient = gcpClient;
  }

  /**
   * Generate PDF with embedded signature and form data
   * @param {Object} options - PDF generation options
   * @param {Object} options.formData - Form submission data
   * @param {Object} options.formSchema - Form structure
   * @param {string} options.signatureData - Base64 signature image
   * @param {string} options.bucketName - GCS bucket name
   * @param {boolean} options.isHipaa - Whether this is HIPAA data
   * @returns {Promise<Object>} - PDF generation result
   */
  async generateSignedPDF({ formData, formSchema, signatureData, bucketName, isHipaa = false }) {
    let browser;
    
    try {
      console.log('📄 Starting PDF generation with signature...');
      console.log(`📄 Signature data method: ${signatureData.method}`);
      console.log(`📄 Signature data completedAt: ${signatureData.completedAt}`);
      console.log(`📄 Signature image size: ${signatureData.imageBase64?.length || 0} characters`);
      
      // Launch browser
      browser = await puppeteer.launch({
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
      
      // Generate HTML content
      const htmlContent = this.generateHTMLContent({
        formData,
        formSchema,
        signatureData,
        isHipaa
      });

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Add a delay to ensure everything is rendered
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('📄 HTML content set, generating PDF...');
      
      // Debug: Check if the image element exists
      const imageExists = await page.evaluate(() => {
        const img = document.querySelector('.signature-image');
        return img ? { exists: true, src: img.src.substring(0, 50) + '...' } : { exists: false };
      });
      console.log('📄 Image element check:', imageExists);

      // Generate PDF
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

      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `signed-forms/${formSchema.id || 'form'}_${timestamp}.pdf`;

      // Upload to GCS using existing GCP client
      const bucket = this.gcpClient.storage.bucket(bucketName);
      const file = bucket.file(filename);

      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            formId: formSchema.id,
            isHipaa: isHipaa.toString(),
            generatedAt: new Date().toISOString()
          }
        },
        // Ensure file is private and not publicly accessible
        public: false,
        private: true
      });

      console.log(`✅ PDF generated and uploaded: ${filename}`);

      return {
        success: true,
        filename,
        url: `gs://${bucketName}/${filename}`,
        size: pdfBuffer.length
      };

    } catch (error) {
      console.error('❌ PDF generation failed:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Generate HTML content for PDF
   */
  generateHTMLContent({ formData, formSchema, signatureData, isHipaa }) {
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const currentTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Filter out signature fields for display
    const displayData = Object.entries(formData).filter(([key, value]) => {
      return !(value && typeof value === 'object' && 'imageBase64' in value);
    });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Signed Form - ${formSchema.title || 'Untitled Form'}</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            text-align: center;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .form-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .form-data {
            margin-bottom: 30px;
        }
        .field-group {
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            background-color: #f9fafb;
        }
        .field-label {
            font-weight: bold;
            color: #374151;
            margin-bottom: 5px;
        }
        .field-value {
            color: #6b7280;
            word-wrap: break-word;
        }
        .signature-section {
            margin-top: 40px;
            padding: 20px;
            border: 2px solid #d1d5db;
            border-radius: 8px;
            background-color: #fef3c7;
        }
        .signature-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: #92400e;
        }
        .signature-image {
            max-width: 300px;
            max-height: 150px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            margin-bottom: 15px;
        }
        .signature-details {
            font-size: 14px;
            color: #6b7280;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 12px;
            color: #9ca3af;
            text-align: center;
        }
        .hipaa-badge {
            display: inline-block;
            background-color: #dcfce7;
            color: #166534;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            margin-left: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="form-title">${formSchema.title || 'Untitled Form'}</div>
        <div>Submitted on ${currentDate} at ${currentTime}</div>
        ${isHipaa ? '<span class="hipaa-badge">HIPAA COMPLIANT</span>' : ''}
    </div>

    <div class="form-data">
        ${displayData.map(([fieldId, value]) => {
          const field = formSchema.fields?.find(f => f.id === fieldId);
          const label = field?.label || fieldId;
          const displayValue = Array.isArray(value) ? value.join(', ') : value;
          
          return `
            <div class="field-group">
                <div class="field-label">${label}</div>
                <div class="field-value">${displayValue}</div>
            </div>
          `;
        }).join('')}
    </div>

    <div class="signature-section">
        <div class="signature-title">Digital Signature</div>
        <img src="data:image/png;base64,${signatureData.imageBase64}" alt="Digital Signature" class="signature-image" />
        <div class="signature-details">
            <div><strong>Signed:</strong> ${new Date(signatureData.completedAt).toLocaleString()}</div>
            <div><strong>Method:</strong> ${signatureData.method === 'draw' ? 'Hand-drawn' : 'Typed'}</div>
            <div><strong>Timezone:</strong> ${signatureData.timezone}</div>
        </div>
    </div>

    <div class="footer">
        <div>Generated by ChatterForms</div>
        <div>This document contains a legally binding digital signature</div>
    </div>
</body>
</html>
    `;
  }

  /**
   * Get PDF download URL
   */
  async getPDFDownloadURL(bucketName, filename, expirationMinutes = 60) {
    try {
      const bucket = this.gcpClient.storage.bucket(bucketName);
      const file = bucket.file(filename);

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + (expirationMinutes * 60 * 1000)
      });

      return signedUrl;
    } catch (error) {
      console.error('❌ Failed to generate PDF download URL:', error);
      throw error;
    }
  }
}

module.exports = PDFGenerator;
