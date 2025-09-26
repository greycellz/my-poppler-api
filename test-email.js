// Test script for email service
require('dotenv').config();
const emailService = require('./email-service');

async function testEmailService() {
  console.log('🧪 Testing Email Service...');
  console.log('📧 Mailgun Domain:', process.env.MAILGUN_DOMAIN);
  console.log('📧 From Email:', process.env.MAILGUN_FROM_EMAIL);
  
  try {
    // Test form published email
    console.log('\n📧 Testing form published email...');
    const publishedResult = await emailService.sendFormPublishedEmail(
      'admin@chatterforms.com',
      'Test Form',
      'https://chatterforms.com/forms/test123'
    );
    console.log('✅ Form published result:', publishedResult);
    
    // Test form submission email (regular)
    console.log('\n📧 Testing form submission email (regular)...');
    const submissionResult = await emailService.sendFormSubmissionEmail(
      'admin@chatterforms.com',
      'Test Form',
      { name: 'John Doe', email: 'john@example.com', message: 'Test message' },
      false
    );
    console.log('✅ Form submission result:', submissionResult);
    
    // Test form submission email (HIPAA)
    console.log('\n📧 Testing form submission email (HIPAA)...');
    const hipaaResult = await emailService.sendFormSubmissionEmail(
      'admin@chatterforms.com',
      'HIPAA Test Form',
      { patientName: 'Jane Smith', condition: 'Checkup' },
      true
    );
    console.log('✅ HIPAA submission result:', hipaaResult);
    
    // Test form deleted email
    console.log('\n📧 Testing form deleted email...');
    const deletedResult = await emailService.sendFormDeletedEmail(
      'admin@chatterforms.com',
      'Deleted Test Form'
    );
    console.log('✅ Form deleted result:', deletedResult);
    
    console.log('\n🎉 All email tests completed!');
    
  } catch (error) {
    console.error('❌ Email test failed:', error);
  }
}

// Run the test
testEmailService();
