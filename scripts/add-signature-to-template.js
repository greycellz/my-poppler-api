/**
 * Script to add signature image to BAA review template
 * 
 * Usage: node scripts/add-signature-to-template.js <path-to-signature-image>
 * 
 * Example: node scripts/add-signature-to-template.js ../signature.png
 */

const fs = require('fs');
const path = require('path');

function imageToBase64(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    
    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg';
    } else if (ext === '.gif') {
      mimeType = 'image/gif';
    }
    
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    throw new Error(`Failed to read image file: ${error.message}`);
  }
}

function updateTemplateWithSignature(signatureBase64, representativeName = 'Abhishek Jha') {
  const templatePath = path.join(__dirname, '..', 'templates', 'baa-template-review.html');
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at: ${templatePath}`);
  }
  
  let template = fs.readFileSync(templatePath, 'utf8');
  
  // Replace the placeholder signature div with actual signature image
  const signatureImageHtml = `
      <img src="${signatureBase64}" alt="Chatterforms Signature" class="signature-image" style="max-width: 300px; max-height: 100px; object-fit: contain;" />
  `;
  
  template = template.replace(
    /<div class="signature-placeholder">[\s\S]*?<\/div>/,
    signatureImageHtml
  );
  
  // Update authorized representative name
  template = template.replace(
    /<p><strong>Authorized Representative:<\/strong> \[Authorized Representative Name\]<\/p>/,
    `<p><strong>Authorized Representative:</strong> ${representativeName}</p>`
  );
  
  // Update date to current date
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  template = template.replace(
    /<p><strong>Date:<\/strong> \[Date of Business Associate Signature\]<\/p>/,
    `<p><strong>Date:</strong> ${currentDate}</p>`
  );
  
  // Save updated template
  fs.writeFileSync(templatePath, template, 'utf8');
  
  console.log('✅ Template updated with signature!');
  console.log(`📝 Representative: ${representativeName}`);
  console.log(`📅 Date: ${currentDate}`);
  console.log(`📁 Template location: ${templatePath}`);
  
  return templatePath;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Error: Please provide the path to your signature image file');
    console.log('');
    console.log('Usage: node scripts/add-signature-to-template.js <path-to-image> [representative-name]');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/add-signature-to-template.js ../signature.png');
    console.log('  node scripts/add-signature-to-template.js ../signature.png "Abhishek Jha"');
    process.exit(1);
  }
  
  const imagePath = path.resolve(args[0]);
  const representativeName = args[1] || 'Abhishek Jha';
  
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Error: Image file not found: ${imagePath}`);
    process.exit(1);
  }
  
  try {
    console.log('🖼️  Converting signature image to base64...');
    const signatureBase64 = imageToBase64(imagePath);
    console.log(`✅ Image converted (${signatureBase64.length} characters)`);
    
    console.log('📝 Updating template...');
    updateTemplateWithSignature(signatureBase64, representativeName);
    
    console.log('');
    console.log('✅ Success! Template has been updated with your signature.');
    console.log('');
    console.log('Next steps:');
    console.log('1. Review the updated template: templates/baa-template-review.html');
    console.log('2. Regenerate the PDF: node scripts/generate-review-pdf.js');
    console.log('3. Review the PDF to ensure signature placement is correct');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

module.exports = { imageToBase64, updateTemplateWithSignature };

