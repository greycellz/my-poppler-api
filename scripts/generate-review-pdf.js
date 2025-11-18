/**
 * Script to generate static BAA review PDF
 * This PDF will be shown to users before they sign
 * 
 * Usage: node scripts/generate-review-pdf.js
 * 
 * After running, you'll need to:
 * 1. Manually add the Chatterforms / Neo HealthTech LLC signature to the PDF
 * 2. Upload the final PDF to GCS
 * 3. Set NEXT_PUBLIC_BAA_REVIEW_PDF_URL environment variable
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function generateReviewPDF() {
  try {
    console.log('📄 Generating static BAA review PDF...');
    
    // Load the review template
    const templatePath = path.join(__dirname, '..', 'templates', 'baa-template-review.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found at: ${templatePath}`);
    }
    
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    
    // Launch browser
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
    
    // Generate PDF
    const outputPath = path.join(__dirname, '..', 'static', 'baa-review-template.pdf');
    
    // Ensure static directory exists
    const staticDir = path.dirname(outputPath);
    if (!fs.existsSync(staticDir)) {
      fs.mkdirSync(staticDir, { recursive: true });
    }
    
    await page.pdf({
      path: outputPath,
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
    
    console.log('✅ Static BAA review PDF generated successfully!');
    console.log(`📁 Output location: ${outputPath}`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('1. Open the PDF and add the Chatterforms / Neo HealthTech LLC signature in the Business Associate signature box');
    console.log('2. Save the signed PDF');
    console.log('3. Upload to GCS public bucket or generate long-lived signed URL');
    console.log('4. Set NEXT_PUBLIC_BAA_REVIEW_PDF_URL environment variable');
    
    return outputPath;
  } catch (error) {
    console.error('❌ Error generating review PDF:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  generateReviewPDF()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = generateReviewPDF;

