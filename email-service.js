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
}

module.exports = new EmailService();
