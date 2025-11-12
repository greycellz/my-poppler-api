# BAA Setup Instructions

## Static BAA Review PDF Setup

### Step 1: Generate the Review PDF Template

1. Run the PDF generation script:
   ```bash
   cd my-poppler-api
   node scripts/generate-review-pdf.js
   ```

2. This will create: `my-poppler-api/static/baa-review-template.pdf`

### Step 2: Add Business Associate Signature

1. Open `static/baa-review-template.pdf` in a PDF editor
2. Locate the "Business Associate Signature" box
3. Add the authorized representative's signature for "Chatterforms / Neo HealthTech LLC"
4. Save the signed PDF

### Step 3: Convert BA Signature to Base64

After signing the PDF, you need to extract the signature image and convert it to base64:

**Option A: Extract signature from PDF**
1. Open the signed PDF
2. Extract the signature image (screenshot or export)
3. Convert to base64:
   ```bash
   # Using base64 command (macOS/Linux)
   base64 -i signature-image.png > static/ba-signature-base64.txt
   
   # Or using Node.js
   node -e "const fs = require('fs'); const img = fs.readFileSync('signature-image.png'); console.log('data:image/png;base64,' + img.toString('base64'))" > static/ba-signature-base64.txt
   ```

**Option B: Use environment variable**
1. Convert signature image to base64
2. Set environment variable:
   ```bash
   export BA_SIGNATURE_BASE64="data:image/png;base64,iVBORw0KGgo..."
   ```

### Step 4: Upload Review PDF to GCS

1. Upload the signed review PDF to a GCS bucket (public or with long-lived signed URL)
2. Get the public URL or generate a signed URL (valid for 1+ years)

**Note:** The review PDF can be uploaded to any public bucket. The actual signed BAA PDFs (generated after payment) are stored in the HIPAA bucket (`chatterforms-submissions-us-central1` by default, or override with `GCS_HIPAA_BUCKET`).

### Step 5: Set Environment Variables

Add to your `.env` file:

```bash
# Static BAA PDF for users to review before signing
NEXT_PUBLIC_BAA_REVIEW_PDF_URL=https://storage.googleapis.com/your-bucket/baa-review-signed.pdf

# Business Associate signature (base64 image)
# Alternative: Store in static/ba-signature-base64.txt file
BA_SIGNATURE_BASE64=data:image/png;base64,iVBORw0KGgo...

# Business Associate authorized signatory name (defaults to "Abhishek Jha" if not set)
BA_AUTHORIZED_SIGNATORY_NAME=Abhishek Jha

# GCS Bucket for BAA PDFs (optional - defaults to chatterforms-submissions-us-central1)
# Set this if you want to use a different bucket for storing signed BAA PDFs
GCS_HIPAA_BUCKET=chatterforms-submissions-us-central1
```

**GCS Bucket Configuration:**
- **Default**: `chatterforms-submissions-us-central1` (existing HIPAA bucket)
- **Purpose**: Stores signed BAA PDFs in `baa-agreements/` folder
- **Access**: Private files with signed URLs for email delivery (7-day expiry)
- **Override**: Set `GCS_HIPAA_BUCKET` environment variable to use a different bucket
- **Note**: Ensure the bucket exists and service account has write permissions

## Files Created

- `templates/baa-template-review.html` - Template for review PDF (no user data)
- `templates/baa-template.html` - Template for actual signed BAA (with user data)
- `scripts/generate-review-pdf.js` - Script to generate review PDF
- `static/baa-review-template.pdf` - Generated review PDF (needs signature)
- `static/ba-signature-base64.txt` - BA signature in base64 format (optional)

## Notes

- The review PDF is shown to users BEFORE they sign
- The actual signed BAA PDFs are generated dynamically with user signatures
- Both PDFs include the pre-signed Business Associate signature
- The BA signature is embedded in all generated BAA PDFs automatically

