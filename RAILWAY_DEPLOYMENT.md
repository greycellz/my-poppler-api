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
- [ ] BigQuery tables created
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
