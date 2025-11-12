const FormData = require('form-data');
const Mailgun = require('mailgun.js');

class EmailService {
  constructor() {
    this.mailgun = new Mailgun(FormData);
    this.mg = this.mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
    });
    this.domain = process.env.MAILGUN_DOMAIN;
    this.fromEmail = process.env.MAILGUN_FROM_EMAIL;
  }

  async sendFormPublishedEmail(userEmail, formTitle, publicUrl) {
    try {
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping form published email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }

      console.log(`📧 Sending form published email to: ${userEmail}`);
      
      const dashboardUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
      
      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject: `🎉 Your form "${formTitle}" is now live!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">🎉 Your form is published!</h2>
            <p><strong>Form:</strong> ${formTitle}</p>
            <p><strong>Public URL:</strong> <a href="${publicUrl}" style="color: #2563eb;">${publicUrl}</a></p>
            <p>You can view submissions and manage your form from your dashboard.</p>
            <p style="margin: 20px 0;">
              <a href="${dashboardUrl}" style="color: #4F46E5; text-decoration: underline;">Access your dashboard</a>
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">This email was sent from ChatterForms</p>
          </div>
        `,
        text: `
          Your form "${formTitle}" is now live!
          
          Public URL: ${publicUrl}
          
          You can view submissions and manage your form from your dashboard.
          Dashboard: ${dashboardUrl}
        `
      });
      
      console.log('✅ Form published email sent successfully:', data.id);
      return { success: true, messageId: data.id, data };
    } catch (error) {
      console.error('❌ Error sending form published email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendFormSubmissionEmail(userEmail, formTitle, submissionData, isHipaa = false, formId = null) {
    try {
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping form submission email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }

      console.log(`📧 Sending form submission email to: ${userEmail} (HIPAA: ${isHipaa})`);
      
      const subject = isHipaa 
        ? `🔒 New HIPAA submission for "${formTitle}"`
        : `📝 New submission for "${formTitle}"`;
      
      const dashboardUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
      const submissionsUrl = formId ? `${dashboardUrl}/dashboard?formId=${formId}&tab=submissions` : `${dashboardUrl}/dashboard`;
      
      const content = isHipaa
        ? `<p>You received a new HIPAA-compliant submission. View details in your dashboard.</p>`
        : `<pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto;">${JSON.stringify(submissionData, null, 2)}</pre>`;

      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">${subject}</h2>
            <p><strong>Form:</strong> ${formTitle}</p>
            <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
            ${content}
            <p style="margin: 20px 0;">
              <a href="${submissionsUrl}" style="color: #4F46E5; text-decoration: underline;">View submissions in your dashboard</a>
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">This email was sent from ChatterForms</p>
          </div>
        `,
        text: `
          ${subject}
          
          Form: ${formTitle}
          Timestamp: ${new Date().toLocaleString()}
          
          ${isHipaa ? 'View details in your dashboard.' : JSON.stringify(submissionData, null, 2)}
          
          View Submissions: ${submissionsUrl}
          Dashboard: ${dashboardUrl}
        `
      });
      
      console.log('✅ Form submission email sent successfully:', data.id);
      return { success: true, messageId: data.id, data };
    } catch (error) {
      console.error('❌ Error sending form submission email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendFormDeletedEmail(userEmail, formTitle) {
    try {
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping form deleted email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }

      console.log(`📧 Sending form deleted email to: ${userEmail}`);
      
      const dashboardUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
      
      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject: `🗑️ Form "${formTitle}" has been deleted`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc2626;">🗑️ Form Deleted</h2>
            <p><strong>Form:</strong> ${formTitle}</p>
            <p><strong>Deleted at:</strong> ${new Date().toLocaleString()}</p>
            <p>This form and all its submissions have been permanently removed.</p>
            <p style="margin: 20px 0;">
              <a href="${dashboardUrl}" style="color: #4F46E5; text-decoration: underline;">Access your dashboard</a>
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">This email was sent from ChatterForms</p>
          </div>
        `,
        text: `
          Form "${formTitle}" has been deleted
          
          Deleted at: ${new Date().toLocaleString()}
          
          This form and all its submissions have been permanently removed.
          
          Dashboard: ${dashboardUrl}
        `
      });
      
      console.log('✅ Form deleted email sent successfully:', data.id);
      return { success: true, messageId: data.id, data };
    } catch (error) {
      console.error('❌ Error sending form deleted email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPasswordResetEmail(userEmail, resetToken) {
    try {
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping password reset email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }

      console.log(`📧 Sending password reset email to: ${userEmail}`);
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
      
      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject: 'Reset Your ChatterForms Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #6366f1;">Reset Your Password</h2>
            <p>You requested to reset your password for your ChatterForms account.</p>
            <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
            <p style="margin: 20px 0;">
              <a href="${resetUrl}" 
                 style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
                Reset Password
              </a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 5px;">${resetUrl}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">This email was sent from ChatterForms</p>
          </div>
        `,
        text: `
          Reset Your ChatterForms Password
          
          You requested to reset your password for your ChatterForms account.
          
          Click the link below to reset your password. This link will expire in 1 hour.
          
          ${resetUrl}
          
          If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
        `
      });
      
      console.log('✅ Password reset email sent successfully:', data.id);
      return { success: true, messageId: data.id, data };
    } catch (error) {
      console.error('❌ Error sending password reset email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendVerificationEmail(userEmail, verificationToken) {
    try {
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping verification email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }

      console.log(`📧 Sending verification email to: ${userEmail}`);
      
      const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
      const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
      
      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject: 'Verify Your ChatterForms Email Address',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #6366f1;">Welcome to ChatterForms!</h2>
            <p>Thank you for creating an account. Please verify your email address to complete your registration.</p>
            <p>Click the button below to verify your email. This link will expire in 24 hours.</p>
            <p style="margin: 20px 0;">
              <a href="${verifyUrl}" 
                 style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
                Verify Email Address
              </a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 5px;">${verifyUrl}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              If you didn't create an account with ChatterForms, please ignore this email.
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">This email was sent from ChatterForms</p>
          </div>
        `,
        text: `
          Welcome to ChatterForms!
          
          Thank you for creating an account. Please verify your email address to complete your registration.
          
          Click the link below to verify your email. This link will expire in 24 hours.
          
          ${verifyUrl}
          
          If you didn't create an account with ChatterForms, please ignore this email.
        `
      });
      
      console.log('✅ Verification email sent successfully:', data.id);
      return { success: true, messageId: data.id, data };
    } catch (error) {
      console.error('❌ Error sending verification email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendBAAConfirmationEmail(userEmail, userName, pdfFilename) {
    try {
      console.log(`📧 Sending BAA confirmation email to: ${userEmail}`);
      
      // Skip if no email provided
      if (!userEmail || userEmail.trim() === '') {
        console.log('📧 Skipping BAA confirmation email - no user email provided');
        return { success: true, skipped: true, reason: 'No user email provided' };
      }
      
      // Generate signed URL for PDF download (valid for 7 days)
      const GCPClient = require('./gcp-client');
      const gcpClient = new GCPClient();
      const bucketName = process.env.GCS_HIPAA_BUCKET || 'chatterforms-submissions-us-central1';
      const bucket = gcpClient.storage.bucket(bucketName);
      const file = bucket.file(pdfFilename);
      
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      });
      
      const data = await this.mg.messages.create(this.domain, {
        from: this.fromEmail,
        to: [userEmail],
        subject: 'Your Business Associate Agreement - ChatterForms',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #6366f1;">Business Associate Agreement Signed</h2>
            <p>Hi ${userName || 'there'},</p>
            <p>Thank you for upgrading to a HIPAA-compliant plan. Your Business Associate Agreement has been signed and is ready for download.</p>
            <p>You can download your signed BAA using the link below (valid for 7 days):</p>
            <p style="margin: 20px 0;">
              <a href="${signedUrl}" 
                 style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px;">
                Download Signed BAA
              </a>
            </p>
            <p>You can also access your BAA anytime from your ChatterForms dashboard.</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              This agreement is required for HIPAA compliance and outlines how ChatterForms handles Protected Health Information (PHI) on your behalf.
            </p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">
              ChatterForms / Neo HealthTech LLC<br>
              admin@chatterforms.com
            </p>
          </div>
        `,
        text: `
          Business Associate Agreement Signed
        
          Hi ${userName || 'there'},
        
          Thank you for upgrading to a HIPAA-compliant plan. Your Business Associate Agreement has been signed.
        
          Download your signed BAA: ${signedUrl}
        
          You can also access your BAA anytime from your ChatterForms dashboard.
        
          This agreement is required for HIPAA compliance and outlines how ChatterForms handles Protected Health Information (PHI) on your behalf.
        
          ChatterForms / Neo HealthTech LLC
          admin@chatterforms.com
        `
      });
      
      console.log('✅ BAA confirmation email sent successfully:', data.id);
      return { success: true, messageId: data.id };
    } catch (error) {
      console.error('❌ Error sending BAA confirmation email:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
