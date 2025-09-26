# 📧 Email Service Setup

## Environment Variables Required

Add these to your `.env` file:

```bash
# Mailgun Configuration (Sandbox for testing)
MAILGUN_API_KEY=your_mailgun_api_key_here
MAILGUN_DOMAIN=sandbox35c5e4619c3f4087afae04388356ae66.mailgun.org
MAILGUN_FROM_EMAIL=postmaster@sandbox35c5e4619c3f4087afae04388356ae66.mailgun.org
```

## API Endpoints

### 1. Form Published Email
```bash
POST /api/emails/send-form-published
Content-Type: application/json

{
  "userEmail": "admin@chatterforms.com",
  "formTitle": "Patient Intake Form",
  "publicUrl": "https://chatterforms.com/forms/abc123"
}
```

### 2. Form Submission Email
```bash
POST /api/emails/send-form-submission
Content-Type: application/json

{
  "userEmail": "admin@chatterforms.com",
  "formTitle": "Patient Intake Form",
  "submissionData": { "name": "John Doe", "email": "john@example.com" },
  "isHipaa": false
}
```

### 3. Form Deleted Email
```bash
POST /api/emails/send-form-deleted
Content-Type: application/json

{
  "userEmail": "admin@chatterforms.com",
  "formTitle": "Patient Intake Form"
}
```

## Testing

Run the test script:
```bash
node test-email.js
```

## Production Setup

1. Set up DNS records for your domain
2. Update environment variables:
   ```bash
   MAILGUN_DOMAIN=mail.chatterforms.com
   MAILGUN_FROM_EMAIL=noreply@chatterforms.com
   ```
3. Test with real domain
4. Deploy to Railway

## Response Format

All endpoints return:
```json
{
  "success": true,
  "messageId": "mailgun-message-id",
  "timestamp": "2025-01-25T20:00:00Z"
}
```

Or on error:
```json
{
  "success": false,
  "error": "Error message"
}
```
