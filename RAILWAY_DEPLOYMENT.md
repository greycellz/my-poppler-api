# Railway Deployment Guide

## Overview
This guide covers deploying the ChatterForms Railway backend with GCP integration to Railway.

## 🚀 Deployment Process

### **Automatic Deployment (Recommended)**
1. **GitHub Integration**: Railway automatically deploys when you push to your connected GitHub repository
2. **Docker Build**: Railway uses the `Dockerfile` to build and deploy your application
3. **Environment Variables**: Set required environment variables in Railway dashboard

### **Manual Deployment**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your Railway project
railway link

# Deploy
railway up
```

## 🔧 Required Environment Variables

Set these in your Railway project dashboard:

### **Core Environment Variables**

#### **GCP Configuration**
```env
GOOGLE_CLOUD_PROJECT=chatterforms
GOOGLE_APPLICATION_CREDENTIALS=/app/chatterforms-app-key.json
GOOGLE_APPLICATION_CREDENTIALS_JSON=<service-account-key-json-content>
```

#### **Railway Configuration**
```env
RAILWAY_PUBLIC_DOMAIN=my-poppler-api-dev.up.railway.app
# Note: Do NOT include https:// prefix, it will be added automatically
```

#### **OpenAI API (for Vision API fallback)**
```env
OPENAI_API_KEY=sk-...
# Required for Vision API-based URL analysis (fallback method)
```

### **URL Analysis & HTML Scraping Environment Variables**

#### **Feature Flags (Vercel Frontend)**
These should be set in **Vercel** (not Railway):
```env
USE_HTML_SCRAPING=TRUE
# Set to 'TRUE' or 'true' to enable HTML scraping as primary method
# If disabled or not set, falls back to Vision API

USE_RAILWAY_VISION=TRUE
# Set to 'TRUE' or 'true' to enable Railway backend Vision API processing
# If disabled, uses Vercel-based processing (legacy)

RAILWAY_BACKEND_URL=https://my-poppler-api-dev.up.railway.app
# Railway backend URL for API calls
# Used by Vercel to call Railway endpoints
```

#### **Image Splitting Configuration (Railway Backend)**
For Vision API fallback when processing very tall screenshots:
```env
IMAGE_SPLIT_MAX_HEIGHT=4000
# Maximum height (in pixels) before splitting images
# Default: 4000px
# Images taller than this will be split into sections

IMAGE_SPLIT_OVERLAP=20
# Overlap pixels between image sections (for deduplication)
# Default: 20px
# Lower values = less overlap, faster processing, but may miss fields at boundaries
```

#### **HTML Scraper Configuration (Railway Backend)**
```env
HTML_SCRAPER_WAIT_TIME=4000
# Wait time (in milliseconds) for dynamic content to load
# Default: 4000ms (4 seconds)
# Increase if forms have slow-loading dynamic content

PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# Path to Chrome/Chromium executable (usually auto-detected)
# Only set if using custom Chrome installation
```

#### **Puppeteer Service URL (Railway Backend)**
```env
PUPPETEER_SERVICE_URL=https://my-poppler-api-dev.up.railway.app
# Internal URL for Puppeteer screenshot service
# Falls back to RAILWAY_PUBLIC_DOMAIN if not set
# Used for internal screenshot generation
```

### **Environment Variable Summary by Environment**

#### **Development (Railway Dev)**
```env
# Railway Backend
RAILWAY_PUBLIC_DOMAIN=my-poppler-api-dev.up.railway.app
OPENAI_API_KEY=sk-...
IMAGE_SPLIT_MAX_HEIGHT=4000
IMAGE_SPLIT_OVERLAP=20
HTML_SCRAPER_WAIT_TIME=4000
GOOGLE_CLOUD_PROJECT=chatterforms
GOOGLE_APPLICATION_CREDENTIALS_JSON=<dev-service-account-key>

# Vercel Frontend
USE_HTML_SCRAPING=TRUE
USE_RAILWAY_VISION=TRUE
RAILWAY_BACKEND_URL=https://my-poppler-api-dev.up.railway.app
```

#### **Production (Railway Production)**
```env
# Railway Backend
RAILWAY_PUBLIC_DOMAIN=my-poppler-api-production.up.railway.app
OPENAI_API_KEY=sk-...
IMAGE_SPLIT_MAX_HEIGHT=4000
IMAGE_SPLIT_OVERLAP=20
HTML_SCRAPER_WAIT_TIME=4000
GOOGLE_CLOUD_PROJECT=chatterforms
GOOGLE_APPLICATION_CREDENTIALS_JSON=<prod-service-account-key>

# Vercel Frontend
USE_HTML_SCRAPING=TRUE
USE_RAILWAY_VISION=TRUE
RAILWAY_BACKEND_URL=https://my-poppler-api-production.up.railway.app
```

### **Feature Flag Behavior**

#### **HTML Scraping (Primary Method)**
- **Enabled**: `USE_HTML_SCRAPING=TRUE` on Vercel
- **Behavior**: Attempts HTML scraping first via Railway `/api/analyze-url-html`
- **Fallback**: If HTML scraping fails, falls back to Vision API
- **Benefits**: Faster, more accurate, lower cost than Vision API

#### **Vision API (Fallback Method)**
- **Enabled**: `USE_RAILWAY_VISION=TRUE` on Vercel (or when HTML scraping disabled)
- **Behavior**: Uses Railway `/api/analyze-url` endpoint with Vision API
- **Fallback**: If Railway unavailable, uses Vercel-based processing (legacy)
- **Use Case**: When HTML scraping fails or for non-web-form images

## 📊 BigQuery Setup for Analytics

### **1. Create BigQuery Dataset**
```bash
# Create the dataset
bq mk --dataset chatterforms:form_submissions
```

### **2. Create Analytics Table**
```sql
-- Run this in BigQuery Console or bq CLI
CREATE TABLE `chatterforms.form_submissions.form_analytics` (
  form_id STRING NOT NULL,
  form_name STRING,
  created_at TIMESTAMP,
  submissions_count INT64 DEFAULT 0,
  last_submission TIMESTAMP,
  is_hipaa BOOL DEFAULT FALSE,
  is_published BOOL DEFAULT TRUE,
  user_id STRING
);
```

### **3. Set Up Service Account Permissions**
```bash
# Replace SERVICE_ACCOUNT_EMAIL with your actual service account email
gcloud projects add-iam-policy-binding chatterforms \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding chatterforms \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/bigquery.dataEditor"
```

### **4. Verify BigQuery Access**
```bash
# Test BigQuery access
curl https://your-railway-domain.railway.app/test-gcp
```

Expected response should include `"bigquery": true`

### **GCP Configuration**
```env
GOOGLE_CLOUD_PROJECT=chatterforms
GOOGLE_APPLICATION_CREDENTIALS=/app/chatterforms-app-key.json
```

### **Service Account Keys**
You need to add the service account key files to your Railway project:

1. **Go to Railway Dashboard** → Your Project → Variables
2. **Add the service account key content** as a variable:
   - Name: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - Value: Copy the entire content of `chatterforms-app-key.json`

### **Optional Environment Variables**
```env
NODE_ENV=production
ENABLE_GCP_TEST=true  # Only if you want to test GCP integration
```

## 📝 URL Analysis & HTML Scraping Feature Documentation

### **Overview**
The system supports two methods for analyzing form URLs:
1. **HTML Scraping** (Primary): Directly extracts fields from DOM structure
2. **Vision API** (Fallback): Uses GPT-4o Vision to analyze screenshots

### **HTML Scraping Architecture**
- **Frontend (Vercel)**: `/api/analyze-url` route with feature flag logic
- **Backend (Railway)**: `/api/analyze-url-html` endpoint using Puppeteer
- **Flow**: Vercel → Railway HTML scraper → Returns extracted fields

### **Vision API Architecture (Fallback)**
- **Frontend (Vercel)**: `/api/analyze-url` route with fallback logic
- **Backend (Railway)**: `/api/analyze-url` endpoint with image splitting
- **Flow**: Vercel → Railway screenshot → Split if needed → Vision API → Returns fields

### **Field Types Supported**
- Standard HTML inputs: `text`, `email`, `tel`, `date`, `textarea`, `select`
- Radio groups: `radio-with-other` (with "Other" option detection)
- Checkbox groups: `checkbox`, `checkbox-with-other`
- Special fields: `signature`, `file`, `rating`
- All fields preserve question numbers and maintain DOM order

### **Known Limitations & Future Enhancements**
1. **Rating Field Detection**: Currently works for standard star-based rating fields. Future enhancement: Support for custom rating implementations (emoji-based, numeric scales, etc.)
2. **Dynamic Content**: Forms with very slow-loading content may need increased `HTML_SCRAPER_WAIT_TIME`
3. **Complex Nested Structures**: Some deeply nested form structures may require additional detection logic
4. **Custom Field Types**: Non-standard field implementations may be captured as `text` fields (fallback behavior)

## 📋 Pre-Deployment Checklist

### **✅ Code Ready**
- [ ] GCP client module (`gcp-client.js`) implemented
- [ ] Service account keys available
- [ ] Dockerfile configured
- [ ] Health check endpoint working
- [ ] GCP test endpoint added

### **✅ GCP Setup Complete**
- [ ] Service accounts created with proper permissions
- [ ] Firestore database created
- [ ] BigQuery dataset and tables created
- [ ] Cloud Storage buckets created
- [ ] KMS keys created

### **✅ Railway Configuration**
- [ ] Environment variables set
- [ ] Service account keys added
- [ ] Domain configured (if needed)

## 🧪 Testing After Deployment

### **1. Health Check**
```bash
curl https://your-railway-domain.railway.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "services": {
    "pdf": "enabled",
    "screenshot": "enabled",
    "gcp": "enabled"
  },
  "environment": {
    "isRailway": true,
    "gcpProject": "chatterforms"
  }
}
```

### **2. GCP Integration Test**
```bash
curl https://your-railway-domain.railway.app/test-gcp
```

Expected response:
```json
{
  "success": true,
  "testResults": {
    "firestore": true,
    "storage": true,
    "kms": true,
    "bigquery": true
  },
  "environment": {
    "isRailway": true,
    "gcpProject": "chatterforms"
  }
}
```

### **3. Existing Endpoints**
- **PDF Upload**: `POST /upload`
- **Screenshot**: `POST /screenshot`
- **Cleanup**: `GET /cleanup`

## 🔍 Troubleshooting

### **Common Issues**

#### **1. GCP Authentication Errors**
```bash
# Check if service account key is accessible
curl https://your-railway-domain.railway.app/test-gcp
```

**Solution**: Verify `GOOGLE_APPLICATION_CREDENTIALS_JSON` environment variable is set correctly.

#### **2. Permission Errors**
```
Error: chatterforms-app@chatterforms.iam.gserviceaccount.com does not have permission
```

**Solution**: Check IAM permissions in GCP Console or run:
```bash
gcloud projects get-iam-policy chatterforms
```

#### **3. BigQuery Analytics Errors**
```
Error: Access Denied: Project chatterforms: User does not have bigquery.jobs.create permission
```

**Solution**: Add BigQuery roles to your service account:
```bash
# Replace SERVICE_ACCOUNT_EMAIL with your actual service account email
gcloud projects add-iam-policy-binding chatterforms \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding chatterforms \
    --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
    --role="roles/bigquery.dataEditor"
```

**Required BigQuery Roles:**
- `bigquery.jobUser` - Required for running queries
- `bigquery.dataEditor` - Required for inserting/updating data
- `bigquery.user` - Required for reading data

#### **3. Service Not Starting**
```bash
# Check Railway logs
railway logs
```

**Solution**: Verify all environment variables are set and service account keys are valid.

### **Debug Commands**

#### **Check Railway Status**
```bash
railway status
railway logs
```

#### **Check Environment Variables**
```bash
railway variables
```

#### **Test Locally with Railway Environment**
```bash
railway run npm start
```

## 📊 Monitoring

### **Railway Dashboard**
- **Deployments**: Track deployment history
- **Logs**: Real-time application logs
- **Metrics**: CPU, memory, network usage
- **Variables**: Environment variable management

### **GCP Console**
- **Firestore**: Database usage and queries
- **BigQuery**: Analytics data and queries
- **Cloud Storage**: File uploads and storage
- **KMS**: Encryption key usage
- **Logging**: Application logs and audit trails

## 🔄 Continuous Deployment

### **GitHub Integration**
1. **Connect Repository**: Link your GitHub repo to Railway
2. **Auto-Deploy**: Every push to main branch triggers deployment
3. **Preview Deployments**: Pull requests get preview deployments

### **Deployment Triggers**
- **Push to main**: Production deployment
- **Pull request**: Preview deployment
- **Manual**: Trigger deployment from Railway dashboard

## 🚨 Security Considerations

### **Service Account Keys**
- ✅ **Never commit keys to Git**: Keys are in `.gitignore`
- ✅ **Use Railway variables**: Store keys as environment variables
- ✅ **Rotate keys regularly**: Update keys periodically
- ✅ **Minimal permissions**: Use least privilege principle

### **Environment Variables**
- ✅ **Production secrets**: Use Railway's secure variable storage
- ✅ **No hardcoding**: All secrets in environment variables
- ✅ **Access control**: Limit who can view/edit variables

## 📈 Performance Optimization

### **Railway Resources**
- **CPU**: Monitor usage and scale if needed
- **Memory**: Watch for memory leaks
- **Network**: Optimize file uploads and API calls

### **GCP Optimization**
- **Firestore**: Use indexes for complex queries
- **BigQuery**: Batch insertions for better performance
- **Cloud Storage**: Use appropriate storage classes
- **KMS**: Cache encryption keys when possible

## 🎯 Next Steps After Deployment

1. **✅ Test all endpoints**: Verify everything works
2. **✅ Monitor logs**: Watch for errors or issues
3. **✅ Set up alerts**: Configure monitoring alerts
4. **✅ Update Vercel**: Integrate with frontend
5. **✅ Test end-to-end**: Full workflow testing

## 📞 Support

### **Railway Support**
- **Documentation**: https://docs.railway.app/
- **Discord**: https://discord.gg/railway
- **GitHub**: https://github.com/railwayapp/railway

### **GCP Support**
- **Documentation**: https://cloud.google.com/docs
- **Support**: https://cloud.google.com/support
- **Console**: https://console.cloud.google.com/

### **Debugging Resources**
- **Railway Logs**: Real-time application logs
- **GCP Logging**: Detailed service logs
- **Health Checks**: Application status monitoring
