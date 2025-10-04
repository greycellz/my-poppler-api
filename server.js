const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');
const puppeteer = require('puppeteer');
const Stripe = require('stripe');
const session = require('express-session');

const app = express();
const poppler = new Poppler();
const PORT = process.env.PORT || 3000; // Keep 3000 to match existing Dockerfile

// Initialize Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Trust proxy for Railway deployment (fixes rate limiter warnings)
app.set('trust proxy', 1);

// Initialize GCP Client
const GCPClient = require('./gcp-client');
const gcpClient = new GCPClient();

// Initialize Email Service
const emailService = require('./email-service');

// Environment-aware base URL construction
const getBaseUrl = () => {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `http://localhost:${PORT}`;
};

const BASE_URL = getBaseUrl();

console.log(`🌐 Base URL: ${BASE_URL}`);

// Create folders if not exist
['uploads', 'output', 'screenshots'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Stripe webhook endpoint needs raw body - must be before JSON parsing
app.post('/api/billing/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object);
        break;
      
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Webhook handler functions
async function handleSubscriptionCreated(subscription) {
  try {
    console.log(`✅ Processing subscription created: ${subscription.id}`);
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document with subscription info
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    const updateData = {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      updatedAt: new Date().toISOString()
    };

    // Only add currentPeriodEnd if it exists
    if (subscription.current_period_end) {
      updateData.currentPeriodEnd = subscription.current_period_end;
    }

    await gcpClient.firestore.collection('users').doc(userId).update(updateData);

    console.log(`✅ User ${userId} subscription created: ${planId} (${interval})`);
  } catch (error) {
    console.error('❌ Error handling subscription created:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    console.log(`🔄 Processing subscription updated: ${subscription.id}`);
    
    const customerId = subscription.customer;
    const planId = subscription.metadata.planId;
    const interval = subscription.metadata.interval;
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document with new subscription info
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    const updateData = {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planId: planId,
      interval: interval,
      updatedAt: new Date().toISOString()
    };

    // Only add currentPeriodEnd if it exists
    if (subscription.current_period_end) {
      updateData.currentPeriodEnd = subscription.current_period_end;
    }

    await gcpClient.firestore.collection('users').doc(userId).update(updateData);

    console.log(`✅ User ${userId} subscription updated: ${planId} (${interval}) - Status: ${subscription.status}`);
  } catch (error) {
    console.error('❌ Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(subscription) {
  try {
    console.log(`🗑️ Processing subscription deleted: ${subscription.id}`);
    
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('❌ No userId in subscription metadata');
      return;
    }

    // Update user document to remove subscription
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    await gcpClient.firestore.collection('users').doc(userId).update({
      subscriptionId: null,
      subscriptionStatus: 'canceled',
      planId: 'free',
      interval: null,
      currentPeriodEnd: null,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ User ${userId} subscription canceled - reverted to free plan`);
  } catch (error) {
    console.error('❌ Error handling subscription deleted:', error);
  }
}

async function handlePaymentSucceeded(invoice) {
  try {
    console.log(`💰 Processing payment succeeded: ${invoice.id}`);
    
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.userId;

      if (userId) {
        // Update user's last payment date
        const GCPClient = require('./gcp-client');
        const gcpClient = new GCPClient();
        
        await gcpClient.firestore.collection('users').doc(userId).update({
          lastPaymentDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        console.log(`✅ Payment recorded for user ${userId}`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment succeeded:', error);
  }
}

async function handlePaymentFailed(invoice) {
  try {
    console.log(`💳 Processing payment failed: ${invoice.id}`);
    
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.userId;

      if (userId) {
        // Update user's payment status
        const GCPClient = require('./gcp-client');
        const gcpClient = new GCPClient();
        
        await gcpClient.firestore.collection('users').doc(userId).update({
          paymentFailed: true,
          lastPaymentFailure: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        console.log(`⚠️ Payment failure recorded for user ${userId}`);
        
        // TODO: Send email notification about failed payment
        // This would integrate with your email service (SendGrid, etc.)
      }
    }
  } catch (error) {
    console.error('❌ Error handling payment failed:', error);
  }
}

async function handleTrialWillEnd(subscription) {
  try {
    console.log(`⏰ Processing trial will end: ${subscription.id}`);
    
    const userId = subscription.metadata.userId;

    if (userId) {
      // TODO: Send email notification about trial ending
      // This would integrate with your email service (SendGrid, etc.)
      console.log(`📧 Trial ending notification needed for user ${userId}`);
    }
  } catch (error) {
    console.error('❌ Error handling trial will end:', error);
  }
}

// Enable JSON parsing for other requests
app.use(express.json({ limit: '1mb' }));

// Configure file uploads with UUID-based naming (existing PDF logic)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uuid = req.uuid || uuidv4();
    req.uuid = uuid;
    cb(null, `${uuid}.pdf`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Static folders
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Session middleware for OAuth flow
app.use(session({
  secret: process.env.JWT_SECRET || 'fallback-secret-for-oauth',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000 // 10 minutes
  }
}));

// ============== UTILITY FUNCTIONS ==============

// Generate URL hash for caching
function generateUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

// Check if cached screenshot exists and is still valid (30 minutes)
function getCachedScreenshot(urlHash) {
  const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
  const screenshotPath = path.join(screenshotDir, 'screenshot.png');
  
  if (fs.existsSync(screenshotPath)) {
    const stats = fs.statSync(screenshotPath);
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    
    if (stats.mtime.getTime() > thirtyMinutesAgo) {
      return {
        url: `${BASE_URL}/screenshots/${urlHash}/screenshot.png`,
        size: stats.size,
        cached: true
      };
    }
  }
  
  return null;
}

// Validate URL format
function validateUrl(url) {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    const urlObj = new URL(normalizedUrl);
    
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP and HTTPS URLs are supported' };
    }
    
    return { isValid: true, normalizedUrl };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

// Capture screenshot with Puppeteer
async function captureFormScreenshot(url, urlHash, options = {}) {
  const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
  const screenshotPath = path.join(screenshotDir, 'screenshot.png');
  
  // Create directory
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let browser;
  const startTime = Date.now();

  try {
    // Detect environment and set browser options
    const isRailway = !!process.env.RAILWAY_PUBLIC_DOMAIN;
    const browserOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--memory-pressure-off',
        '--max_old_space_size=1024',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    };

    // Use system Chrome on Railway (via Dockerfile)
    if (isRailway && process.env.PUPPETEER_EXECUTABLE_PATH) {
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      console.log(`🐳 Using system Chrome: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    } else {
      console.log('💻 Using bundled Chromium');
    }

    // Launch browser with environment-specific settings
    browser = await puppeteer.launch(browserOptions);

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ 
      width: options.viewport?.width || 1280, 
      height: options.viewport?.height || 800 
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    console.log(`📄 Navigating to URL: ${url}`);
    
    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 45000
    });

    // Wait for dynamic content
    const waitTime = options.waitTime || 4000;
    console.log(`⏳ Waiting ${waitTime}ms for dynamic content...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Scroll to load content and find forms
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            // Scroll back to top
            window.scrollTo(0, 0);
            setTimeout(resolve, 1000);
          }
        }, 100);
      });
    });

    // Get page metadata
    const pageTitle = await page.title();
    const finalUrl = page.url();

    console.log('📸 Taking screenshot...');
    
    // Take screenshot
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: options.fullPage !== false,
      type: 'png'
    });

    const loadTime = Date.now() - startTime;
    const stats = fs.statSync(screenshotPath);

    console.log(`✅ Screenshot captured: ${urlHash} (${loadTime}ms)`);

    return {
      url: `${BASE_URL}/screenshots/${urlHash}/screenshot.png`,
      size: stats.size,
      pageTitle,
      finalUrl,
      loadTime,
      viewport: { width: options.viewport?.width || 1280, height: options.viewport?.height || 800 },
      cached: false
    };

  } catch (error) {
    console.error('Screenshot capture error:', error);
    
    // Cleanup on failure
    try {
      if (fs.existsSync(screenshotDir)) {
        fs.rmSync(screenshotDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('Screenshot cleanup failed:', cleanupErr);
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ============== EXISTING PDF ENDPOINTS ==============

app.post('/upload', upload.single('pdf'), async (req, res) => {
  const uuid = req.uuid || uuidv4();
  const pdfPath = path.join(__dirname, 'uploads', `${uuid}.pdf`);
  const outputDir = path.join(__dirname, 'output', uuid);
  const outputBase = path.join(outputDir, 'page');

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const options = {
      pngFile: true,
      firstPageToConvert: 1,
      lastPageToConvert: 0,
      singleFile: false,
      resolutionXYAxis: 150
    };

    await poppler.pdfToCairo(pdfPath, outputBase, options);

    const outputFiles = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page-(\d+)\.png/)?.[1] || '0');
        const numB = parseInt(b.match(/page-(\d+)\.png/)?.[1] || '0');
        return numA - numB;
      });

    const imageUrls = outputFiles.map((file, index) => ({
      page: index + 1,
      filename: file,
      url: `${BASE_URL}/output/${uuid}/${file}`,
      size: fs.statSync(path.join(outputDir, file)).size
    }));

    console.log(`✅ PDF converted. UUID: ${uuid}, Pages: ${outputFiles.length}`);

    res.json({
      success: true,
      uuid: uuid,
      totalPages: outputFiles.length,
      images: imageUrls,
      baseUrl: BASE_URL,
      message: `Successfully converted ${outputFiles.length} page(s)`
    });

  } catch (err) {
    console.error("❌ PDF conversion failed:", err);
    
    try {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error("⚠️ PDF cleanup failed:", cleanupErr);
    }

    res.status(500).json({
      success: false,
      error: 'PDF conversion failed',
      details: err.message
    });
  }
});

// ============== NEW SCREENSHOT ENDPOINT ==============

app.post('/screenshot', async (req, res) => {
  const { url, options = {} } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required',
      details: 'Please provide a valid URL to capture'
    });
  }

  // Validate URL
  const validation = validateUrl(url);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL',
      details: validation.error
    });
  }

  const normalizedUrl = validation.normalizedUrl;
  const urlHash = generateUrlHash(normalizedUrl);

  try {
    // Check for cached screenshot
    const cached = getCachedScreenshot(urlHash);
    if (cached) {
      console.log(`🎯 Cache hit for URL hash: ${urlHash}`);
      return res.json({
        success: true,
        urlHash: urlHash,
        screenshot: cached,
        metadata: {
          finalUrl: normalizedUrl,
          cached: true,
          cacheAge: '< 30 minutes'
        },
        message: 'Screenshot retrieved from cache'
      });
    }

    console.log(`📸 Capturing new screenshot for: ${normalizedUrl}`);
    
    // Capture new screenshot
    const screenshot = await captureFormScreenshot(normalizedUrl, urlHash, options);
    
    res.json({
      success: true,
      urlHash: urlHash,
      screenshot: {
        url: screenshot.url,
        size: screenshot.size,
        cached: false
      },
      metadata: {
        finalUrl: screenshot.finalUrl,
        pageTitle: screenshot.pageTitle,
        loadTime: screenshot.loadTime,
        viewport: screenshot.viewport
      },
      message: 'Screenshot captured successfully'
    });

  } catch (error) {
    console.error('❌ Screenshot failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Screenshot capture failed',
      details: error.message,
      suggestions: [
        'Check if the URL is accessible and not behind authentication',
        'Verify the URL contains an actual form',
        'Try again in a few moments',
        'Consider uploading a manual screenshot instead'
      ]
    });
  }
});

// ============== CLEANUP ENDPOINTS ==============

// Manual cleanup for specific UUID (PDF)
app.delete('/cleanup/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  try {
    const pdfPath = path.join(__dirname, 'uploads', `${uuid}.pdf`);
    const outputDir = path.join(__dirname, 'output', uuid);
    
    let cleaned = [];

    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
      cleaned.push('PDF file');
    }

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
      cleaned.push('Output directory');
    }

    console.log(`🗑️ Cleaned up PDF UUID: ${uuid}`);

    res.json({
      success: true,
      uuid: uuid,
      cleaned: cleaned,
      message: cleaned.length > 0 ? 'Files cleaned successfully' : 'No files found to clean'
    });

  } catch (err) {
    console.error(`❌ PDF cleanup failed for UUID ${uuid}:`, err);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: err.message
    });
  }
});

// Manual cleanup for specific URL hash (Screenshot)
app.delete('/cleanup/screenshot/:urlHash', (req, res) => {
  const { urlHash } = req.params;
  
  try {
    const screenshotDir = path.join(__dirname, 'screenshots', urlHash);
    
    let cleaned = [];

    if (fs.existsSync(screenshotDir)) {
      fs.rmSync(screenshotDir, { recursive: true, force: true });
      cleaned.push('Screenshot directory');
    }

    console.log(`🗑️ Cleaned up screenshot hash: ${urlHash}`);

    res.json({
      success: true,
      urlHash: urlHash,
      cleaned: cleaned,
      message: cleaned.length > 0 ? 'Screenshot cleaned successfully' : 'No screenshot found to clean'
    });

  } catch (err) {
    console.error(`❌ Screenshot cleanup failed for hash ${urlHash}:`, err);
    res.status(500).json({
      success: false,
      error: 'Screenshot cleanup failed',
      details: err.message
    });
  }
});

// Scheduled cleanup (files older than specified time)
app.get('/cleanup', (req, res) => {
  try {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    let cleanedCount = 0;

    // Clean PDF uploads folder (1 hour)
    if (fs.existsSync('./uploads')) {
      fs.readdirSync('./uploads').forEach(file => {
        const filePath = path.join('./uploads', file);
        const stats = fs.statSync(filePath);
        if (stats.mtime.getTime() < oneHourAgo) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      });
    }

    // Clean PDF output folders (1 hour)
    if (fs.existsSync('./output')) {
      fs.readdirSync('./output').forEach(folder => {
        const folderPath = path.join('./output', folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const stats = fs.statSync(folderPath);
          if (stats.mtime.getTime() < oneHourAgo) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            cleanedCount++;
          }
        }
      });
    }

    // Clean screenshot folders (30 minutes)
    if (fs.existsSync('./screenshots')) {
      fs.readdirSync('./screenshots').forEach(folder => {
        const folderPath = path.join('./screenshots', folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const stats = fs.statSync(folderPath);
          if (stats.mtime.getTime() < thirtyMinutesAgo) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            cleanedCount++;
          }
        }
      });
    }

    console.log(`🗑️ Scheduled cleanup completed. Cleaned ${cleanedCount} items.`);

    res.json({
      success: true,
      cleanedCount: cleanedCount,
      message: `Cleaned ${cleanedCount} old files/folders`,
      cleanupPolicy: {
        pdfFiles: '1 hour',
        screenshots: '30 minutes'
      }
    });

  } catch (err) {
    console.error("❌ Scheduled cleanup failed:", err);
    res.status(500).json({
      success: false,
      error: 'Scheduled cleanup failed',
      details: err.message
    });
  }
});

// ============== DEBUG ENDPOINT ==============

// Debug environment variables (remove in production)
app.get('/debug-env', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'SET' : 'NOT_SET',
      ENABLE_GCP_TEST: process.env.ENABLE_GCP_TEST,
      RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,
    },
    hasCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    credentialsLength: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON.length : 0
  });
});

// ============== FORM STORAGE ENDPOINT ==============

// Store form structure in GCP
app.post('/store-form', async (req, res) => {
  try {
    const { formData, userId, metadata } = req.body;

    if (!formData) {
      return res.status(400).json({
        success: false,
        error: 'Form data is required'
      });
    }

    console.log('📝 Storing form structure in GCP...');
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Use the form ID from the form data, or generate a new one
    const formId = formData.id || formData.formId || `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store form structure
    console.log(`📝 Attempting to store form in Firestore: ${formId}`);
    console.log(`📝 Form data:`, JSON.stringify(formData, null, 2));
    
    const result = await gcpClient.storeFormStructure(
      formId,
      formData,
      userId || 'anonymous',
      {
        ...metadata,
        source: 'railway-backend',
        isHipaa: metadata?.isHipaa || false,
        isPublished: metadata?.isPublished || false,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip || req.connection.remoteAddress
      }
    );

    console.log(`✅ Form structure stored: ${formId}`);
    console.log(`✅ Storage result:`, JSON.stringify(result, null, 2));

    res.json({
      success: true,
      formId,
      message: 'Form structure stored successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form storage error:', error);
    res.status(500).json({
      success: false,
      error: 'Form storage failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== FORM SUBMISSION ENDPOINT ==============

// Submit form data with GCP integration
app.post('/submit-form', async (req, res) => {
  try {
    const { formId, formData, userId, isHipaa, metadata } = req.body;

    if (!formId || !formData) {
      return res.status(400).json({
        success: false,
        error: 'Form ID and form data are required'
      });
    }

    console.log(`📤 Processing form submission: ${formId}`);
    console.log(`🛡️ HIPAA flag received: ${isHipaa} (type: ${typeof isHipaa})`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Generate submission ID
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Get client metadata
    const clientMetadata = {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      ...metadata
    };

    let result;

    console.log(`🛡️ HIPAA check: isHipaa=${isHipaa}, will use HIPAA pipeline: ${!!isHipaa}`);

    if (isHipaa) {
      // Process as HIPAA-compliant submission
      console.log(`🛡️ Routing to HIPAA submission pipeline`);
      result = await gcpClient.processHipaaSubmission(
        submissionId,
        formId,
        formData,
        userId || 'anonymous',
        clientMetadata
      );
    } else {
      // Process as regular submission
      console.log(`📝 Routing to regular submission pipeline`);
      result = await gcpClient.storeFormSubmission(
        submissionId,
        formId,
        formData,
        userId || 'anonymous',
        clientMetadata
      );

      // Store signature images in GCS (skip PDF generation for now)
      await gcpClient.storeSignatureImages(submissionId, formId, formData, false);

      // Update form analytics
      try {
        const analyticsResult = await gcpClient.updateFormAnalytics(formId, userId || 'anonymous');
        if (analyticsResult.success) {
          console.log(`✅ Analytics updated for form: ${formId}`);
        } else {
          console.warn(`⚠️ Analytics update failed for form ${formId}:`, analyticsResult.error);
        }
      } catch (analyticsError) {
        console.warn(`⚠️ Analytics update failed for form ${formId}:`, analyticsError.message);
        // Don't fail the form submission if analytics fails
      }
    }

    console.log(`✅ Form submission processed: ${submissionId}`);

    res.json({
      success: true,
      submissionId,
      formId,
      message: 'Form submitted successfully',
      isHipaa,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Form submission failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== FORM RETRIEVAL ENDPOINT ==============

// Get form structure from GCP
app.get('/form/:formId', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📋 Fetching form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Get form data from Firestore with fresh read to avoid cache issues after updates
    console.log(`📋 Attempting to retrieve form from Firestore: ${formId}`);
    
    // Add small delay to allow Firestore to propagate changes
    await new Promise(resolve => setTimeout(resolve, 1000));
    const formData = await gcpClient.getFormStructure(formId, true);

    console.log(`📋 Form retrieval result:`, formData ? 'Found' : 'Not found');
    if (formData) {
      console.log(`📋 Form data keys:`, Object.keys(formData));
    }

    if (!formData) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        timestamp: new Date().toISOString()
      });
    }

    // Prevent any intermediary/proxy/browser caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({
      success: true,
      form: formData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANALYTICS ENDPOINT ==============

// Get form analytics from GCP
app.get('/analytics/:formId', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📊 Fetching analytics for form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Get analytics data from BigQuery
    const analytics = await gcpClient.getFormAnalytics(formId);

    if (!analytics) {
      return res.status(404).json({
        success: false,
        error: 'Analytics not found for this form',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== USER ANALYTICS ENDPOINT ==============

// Get all analytics for a specific user
app.get('/analytics/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`📊 Fetching analytics for user: ${userId}`);
    
    const analytics = await gcpClient.getUserAnalytics(userId);

    res.json({
      success: true,
      userId,
      analytics,
      count: analytics.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ User analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ALL ANALYTICS ENDPOINT ==============

// Get all analytics data (admin endpoint)
app.get('/analytics', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    console.log(`📊 Fetching all analytics (limit: ${limit})`);
    
    const analytics = await gcpClient.getAllAnalytics(limit);

    res.json({
      success: true,
      analytics,
      count: analytics.length,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ All analytics fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch all analytics',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== GCP INTEGRATION TEST ==============

// Test GCP integration (only in development/testing)
app.get('/test-gcp', async (req, res) => {
  try {
    // Only allow in development or with specific environment variable
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_GCP_TEST) {
      return res.status(403).json({
        success: false,
        error: 'GCP test endpoint disabled in production'
      });
    }

    console.log('🧪 Testing GCP integration...');
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();

    // Test basic operations
    const testResults = {
      firestore: false,
      storage: false,
      kms: false,
      bigquery: false
    };

    // Test Firestore
    try {
      const testFormId = `test-form-${Date.now()}`;
      const testFormData = { fields: [{ id: 'test', label: 'Test', type: 'text' }] };
      const result = await gcpClient.storeFormStructure(testFormId, testFormData, 'test-user', { isHipaa: false });
      testResults.firestore = result.success;
      console.log('✅ Firestore test passed');
    } catch (error) {
      console.error('❌ Firestore test failed:', error.message);
    }

    // Test KMS
    try {
      const testData = { test: 'data' };
      const encryptResult = await gcpClient.encryptData(testData, 'form-data-key');
      const decryptResult = await gcpClient.decryptData(encryptResult.encryptedData, 'form-data-key');
      testResults.kms = encryptResult.success && decryptResult.success;
      console.log('✅ KMS test passed');
    } catch (error) {
      console.error('❌ KMS test failed:', error.message);
    }

    // Test Cloud Storage
    try {
      const testFilePath = path.join(__dirname, 'test-gcp-file.txt');
      fs.writeFileSync(testFilePath, 'GCP integration test file');
      const result = await gcpClient.uploadFile(testFilePath, `test-uploads/test-${Date.now()}.txt`);
      testResults.storage = result.success;
      fs.unlinkSync(testFilePath); // Clean up
      console.log('✅ Cloud Storage test passed');
    } catch (error) {
      console.error('❌ Cloud Storage test failed:', error.message);
    }

    // Test BigQuery (skip if Jest environment)
    if (!process.env.JEST_WORKER_ID) {
      try {
        const testSubmissionData = {
          submission_id: `test-sub-${Date.now()}`,
          form_id: 'test-form',
          user_id: 'test-user',
          submission_data: { test: 'data' },
          timestamp: new Date(),
          ip_address: '127.0.0.1',
          user_agent: 'GCP Test',
          is_hipaa: false,
          encrypted: false,
        };
        const result = await gcpClient.insertSubmissionAnalytics(testSubmissionData);
        testResults.bigquery = result.success;
        console.log('✅ BigQuery test passed');
      } catch (error) {
        console.error('❌ BigQuery test failed:', error.message);
      }
    } else {
      testResults.bigquery = 'skipped (Jest environment)';
    }

    const allPassed = Object.values(testResults).every(result => result === true || result === 'skipped (Jest environment)');

    res.json({
      success: allPassed,
      timestamp: new Date().toISOString(),
      gcpProject: 'chatterforms',
      testResults,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        isRailway: !!process.env.RAILWAY_PUBLIC_DOMAIN,
        railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null
      }
    });

  } catch (error) {
    console.error('❌ GCP integration test failed:', error);
    res.status(500).json({
      success: false,
      error: 'GCP integration test failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SUBMISSION RETRIEVAL ENDPOINTS ==============

// Get submission with file associations
app.get('/submission/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;

    console.log(`📋 Fetching submission: ${submissionId}`);
    
    const submission = await gcpClient.getSubmissionWithFiles(submissionId);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      submission,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Submission retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve submission',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get all submissions for a form with file associations
app.get('/form/:formId/submissions', async (req, res) => {
  try {
    const { formId } = req.params;

    console.log(`📋 Fetching submissions for form: ${formId}`);
    
    const submissions = await gcpClient.getFormSubmissionsWithFiles(formId);

    res.json({
      success: true,
      formId,
      submissions,
      count: submissions.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form submissions retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve form submissions',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== FILE UPLOAD ENDPOINT ==============

app.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    const { formId, fieldId } = req.body
    const file = req.file
    
    if (!file || !formId || !fieldId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: file, formId, or fieldId'
      })
    }

    console.log(`📁 File upload request: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB) for form: ${formId}, field: ${fieldId}`)

    // Generate unique filename with form and field context
    const timestamp = Date.now()
    const fileExtension = path.extname(file.originalname)
    const fileName = `${formId}/${fieldId}/${timestamp}${fileExtension}`
    
    // Upload to GCP Cloud Storage
    const uploadResult = await gcpClient.uploadFile(
      file.path, 
      `form-uploads/${fileName}`,
      'chatterforms-uploads-us-central1'
    )

    // Clean up local file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
      console.log(`🧹 Cleaned up local file: ${file.path}`)
    }

    console.log(`✅ File uploaded successfully: ${fileName}`)
    console.log(`🔗 GCP URL: ${uploadResult.publicUrl}`)

    res.json({
      success: true,
      fileUrl: uploadResult.publicUrl,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype
    })

  } catch (error) {
    console.error('❌ File upload error:', error)
    
    // Clean up local file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
      console.log(`🧹 Cleaned up local file after error: ${req.file.path}`)
    }
    
    res.status(500).json({
      success: false,
      error: 'File upload failed',
      details: error.message
    })
  }
})

// ============== USER FORMS ENDPOINT ==============

app.get('/api/forms/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log(`📋 Fetching forms for user: ${userId}`);
    
    const forms = await gcpClient.getFormsByUserId(userId);

    res.json({
      success: true,
      userId,
      forms,
      count: forms.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ User forms retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user forms',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SINGLE FORM ENDPOINT ==============

app.get('/api/forms/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    if (!formId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID is required'
      });
    }

    console.log(`📋 Fetching form: ${formId}`);
    
    // Get the form data from GCP with fresh read to avoid cache issues after updates
    const form = await gcpClient.getFormStructure(formId, true);

    if (!form) {
      return res.status(404).json({
        success: false,
        error: 'Form not found',
        formId,
        timestamp: new Date().toISOString()
      });
    }

    // Prevent any intermediary/proxy/browser caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({
      success: true,
      form,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve form',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SIGNATURE DOWNLOAD ENDPOINT ==============
app.get('/api/submissions/:submissionId/signature/:fieldId', async (req, res) => {
  try {
    const { submissionId, fieldId } = req.params;

    console.log(`📝 Requesting signature for submission ${submissionId}, field ${fieldId}`);

    // Get submission data
    const submissionRef = gcpClient.firestore.collection('submissions').doc(submissionId);
    const submissionDoc = await submissionRef.get();

    if (!submissionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const submissionData = submissionDoc.data();
    const signatureData = submissionData.signatures?.[fieldId];

    if (!signatureData) {
      return res.status(404).json({
        success: false,
        error: 'Signature not found for this field'
      });
    }

    // Generate signed URL for signature download
    const bucketName = signatureData.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1';
    
    console.log(`📝 Attempting to generate signed URL for: ${signatureData.filename}`);
    console.log(`📝 Using bucket: ${bucketName}`);
    
    // Check if file exists first
    const file = gcpClient.storage.bucket(bucketName).file(signatureData.filename);
    const [exists] = await file.exists();
    
    if (!exists) {
      console.error(`❌ File does not exist: ${signatureData.filename}`);
      return res.status(404).json({
        success: false,
        error: 'Signature file not found in storage'
      });
    }
    
    console.log(`✅ File exists, generating signed URL...`);
    
    const downloadUrl = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + (60 * 60 * 1000) // 1 hour expiration
    });

    console.log(`📝 Generated signed URL for signature: ${signatureData.filename}`);
    console.log(`📝 Download URL: ${downloadUrl[0]}`);

    res.json({
      success: true,
      downloadUrl: downloadUrl[0],
      filename: signatureData.filename,
      size: signatureData.size,
      method: signatureData.method,
      completedAt: signatureData.completedAt,
      timezone: signatureData.timezone
    });

  } catch (error) {
    console.error('❌ Error retrieving signature:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve signature'
    });
  }
});

// ============== PDF DOWNLOAD ENDPOINT ==============
app.get('/api/submissions/:submissionId/pdf/:fieldId', async (req, res) => {
  try {
    const { submissionId, fieldId } = req.params;

    console.log(`📄 Requesting PDF for submission ${submissionId}, field ${fieldId}`);
    
    // TODO: Add authentication middleware here
    // For now, we'll rely on the signed URL security (60-minute expiration)
    // In production, add proper user authentication

    // Get submission data
    const submissionRef = gcpClient.firestore.collection('submissions').doc(submissionId);
    const submissionDoc = await submissionRef.get();

    if (!submissionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const submissionData = submissionDoc.data();
    const pdfData = submissionData.pdfs?.[fieldId];

    if (!pdfData) {
      return res.status(404).json({
        success: false,
        error: 'PDF not found for this field'
      });
    }

    // Generate signed URL for PDF download
    const downloadUrl = await gcpClient.pdfGenerator.getPDFDownloadURL(
      pdfData.isHipaa ? 'chatterforms-submissions-us-central1' : 'chatterforms-uploads-us-central1',
      pdfData.filename,
      60 // 60 minutes expiration
    );

    console.log(`📄 Generated signed URL for PDF: ${pdfData.filename}`);
    console.log(`📄 Download URL: ${downloadUrl}`);
    console.log(`📄 PDF size: ${Math.round(pdfData.size/1024)}KB`);
    console.log(`📄 HIPAA: ${pdfData.isHipaa}`);

    res.json({
      success: true,
      downloadUrl,
      filename: pdfData.filename,
      size: pdfData.size,
      generatedAt: pdfData.generatedAt
    });

  } catch (error) {
    console.error('❌ Error retrieving PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve PDF'
    });
  }
});

// ============== GET FORM SUBMISSIONS ENDPOINT ==============
app.get('/api/forms/:formId/submissions', async (req, res) => {
  try {
    const { formId } = req.params;
    if (!formId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID is required'
      });
    }
    
    console.log(`📋 BACKEND: /api/forms/${formId}/submissions endpoint called`);
    console.log(`📋 BACKEND: Request timestamp: ${new Date().toISOString()}`);
    console.log(`📋 BACKEND: Request headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`📋 Fetching submissions for form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Get submissions from BigQuery
    const submissions = await gcpClient.getFormSubmissions(formId);
    
    if (submissions) {
      console.log(`✅ Retrieved ${submissions.length} submissions for form: ${formId}`);
      console.log(`📤 BACKEND: Sending response for form: ${formId} with ${submissions.length} submissions`);
      res.json({
        success: true,
        formId,
        submissions,
        count: submissions.length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`📤 BACKEND: Sending empty response for form: ${formId}`);
      res.json({
        success: true,
        formId,
        submissions: [],
        count: 0,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Error fetching form submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form submissions',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== PAGINATED FORM SUBMISSIONS ENDPOINT ==============
app.get('/api/forms/:formId/submissions/paginated', async (req, res) => {
  try {
    const { formId } = req.params;
    const { 
      page = 1, 
      limit = 20, 
      sort = 'desc',
      search = '',
      dateFrom = '',
      dateTo = ''
    } = req.query;
    
    if (!formId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID is required'
      });
    }
    
    console.log(`📋 BACKEND: /api/forms/${formId}/submissions/paginated endpoint called`);
    console.log(`📋 BACKEND: Page: ${page}, Limit: ${limit}, Sort: ${sort}`);
    console.log(`📋 BACKEND: Search: "${search}", DateFrom: ${dateFrom}, DateTo: ${dateTo}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Get paginated submissions
    const result = await gcpClient.getFormSubmissionsPaginated(
      formId, 
      parseInt(limit), 
      (parseInt(page) - 1) * parseInt(limit), 
      sort,
      search,
      dateFrom,
      dateTo
    );
    
    console.log(`✅ Retrieved ${result.submissions.length} submissions (page ${page}) for form: ${formId}`);
    console.log(`📊 Total submissions: ${result.total}, HasNext: ${result.hasNext}, HasPrev: ${result.hasPrev}`);
    
    res.json({
      success: true,
      formId,
      submissions: result.submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.total,
        totalPages: Math.ceil(result.total / parseInt(limit)),
        hasNext: result.hasNext,
        hasPrev: result.hasPrev
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error fetching paginated form submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch paginated form submissions',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== LAZY SUBMISSION DATA LOADING ==============
app.get('/api/submissions/:submissionId/data', async (req, res) => {
  try {
    const { submissionId } = req.params;
    
    console.log(`📋 BACKEND: /api/submissions/${submissionId}/data endpoint called`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Get submission data on demand
    const submissionData = await gcpClient.getSubmissionData(submissionId);
    
    if (submissionData !== null) {
      console.log(`✅ Loaded submission data for: ${submissionId}`);
      res.json({
        success: true,
        submissionId,
        submission_data: submissionData,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`❌ No submission data found for: ${submissionId}`);
      res.status(404).json({
        success: false,
        error: 'Submission data not found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error loading submission data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load submission data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== SIGNATURE SIGNED URLS (BATCH) ==============

app.get('/api/submissions/:submissionId/signatures', async (req, res) => {
  try {
    const { submissionId } = req.params;
    console.log(`🖊️ Fetching signature URLs for submission: ${submissionId}`);
    const urls = await gcpClient.getSignatureSignedUrls(submissionId);
    res.json({ success: true, submissionId, urls, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Error fetching signature URLs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch signature URLs' });
  }
});

// ============== PDF GENERATE-OR-RETURN ==============

app.post('/api/submissions/:submissionId/pdf/:fieldId/generate-or-return', async (req, res) => {
  try {
    const { submissionId, fieldId } = req.params;
    console.log(`📄 Generate-or-return PDF for submission ${submissionId}, field ${fieldId}`);
    const result = await gcpClient.getOrCreateSignedPDF(submissionId, fieldId);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }
    res.json({ success: true, downloadUrl: result.downloadUrl, filename: result.filename, size: result.size });
  } catch (error) {
    console.error('❌ Error generate-or-return PDF:', error);
    res.status(500).json({ success: false, error: 'Failed to generate or retrieve PDF' });
  }
});

// ============== DELETE FORM ENDPOINT ==============
app.delete('/api/forms/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    if (!formId) {
      return res.status(400).json({
        success: false,
        error: 'Form ID is required'
      });
    }
    
    console.log(`🗑️ Deleting form: ${formId}`);
    
    // Initialize GCP client
    const GCPClient = require('./gcp-client');
    const gcpClient = new GCPClient();
    
    // Delete form and all associated data (submissions, analytics)
    const result = await gcpClient.deleteForm(formId);
    
    if (result.success) {
      console.log(`✅ Form deleted successfully: ${formId}`);
      res.json({ 
        success: true, 
        message: 'Form and all associated data deleted successfully',
        formId,
        timestamp: new Date().toISOString()
      });
    } else {
      console.error(`❌ Failed to delete form: ${formId}`, result.error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete form', 
        details: result.error,
        timestamp: new Date().toISOString() 
      });
    }
  } catch (error) {
    console.error('❌ Form deletion error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete form', 
      details: error.message, 
      timestamp: new Date().toISOString() 
    });
  }
});

// ============== FORM MIGRATION ENDPOINT ==============

app.post('/api/forms/migrate-anonymous', async (req, res) => {
  try {
    const { tempUserId, realUserId } = req.body;
    
    if (!tempUserId || !realUserId) {
      return res.status(400).json({
        success: false,
        error: 'Both temporary user ID and real user ID are required'
      });
    }

    console.log(`🔄 Migrating forms from ${tempUserId} to ${realUserId}`);
    
    const gcpClient = new GCPClient();
    const result = await gcpClient.migrateAnonymousFormsToUser(tempUserId, realUserId);

    res.json({
      success: true,
      message: 'Forms migrated successfully',
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Form migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Form migration failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== ANONYMOUS SESSION CLEANUP ENDPOINT ==============

app.get('/api/cleanup/expired-sessions', async (req, res) => {
  try {
    console.log('🧹 Starting cleanup of expired anonymous sessions...');
    
    const gcpClient = new GCPClient();
    const result = await gcpClient.cleanupExpiredAnonymousSessions();

    res.json({
      success: true,
      message: 'Cleanup completed successfully',
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============== AUTHENTICATION ROUTES ==============

// Import authentication routes
const authRoutes = require('./auth/routes');

// Import billing routes
const billingRoutes = require('./routes/billing');

// Mount authentication routes
app.use('/auth', authRoutes);

// Mount billing routes
app.use('/api/billing', billingRoutes);

// ============== AUTO-SAVE ENDPOINT ==============

app.post('/api/auto-save-form', async (req, res) => {
  try {
    const { formId, formSchema } = req.body;
    
    console.log('🔄 Auto-save API received:', {
      formId,
      hasFormSchema: !!formSchema
    });

    if (!formId || !formSchema) {
      return res.status(400).json({
        error: 'Form ID and schema are required'
      });
    }

    // Get the current form to preserve its published status
    const currentForm = await gcpClient.getFormById(formId);
    const currentPublishedStatus = currentForm?.is_published || false;

    // Use HIPAA setting from the form schema being sent (not from database)
    const hipaaStatus = formSchema?.isHipaa || false;

    // Store the form structure with auto-save metadata
    const result = await gcpClient.storeFormStructure(
      formId,
      formSchema,
      currentForm?.user_id || 'anonymous',
      {
        source: 'auto-save',
        isUpdate: true,
        isPublished: currentPublishedStatus, // Preserve existing published status
        isHipaa: hipaaStatus, // Use HIPAA status from the form schema being sent
        updatedAt: new Date().toISOString()
      }
    );

    if (result.success) {
      console.log('✅ Auto-save successful for form:', formId);
      return res.json({ 
        success: true, 
        formId,
        message: 'Form auto-saved successfully' 
      });
    } else {
      throw new Error('Failed to auto-save form');
    }

  } catch (error) {
    console.error('❌ Auto-save error:', error);
    return res.status(500).json({
      error: 'Failed to auto-save form'
    });
  }
});

// ============== HEALTH CHECK ==============

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    baseUrl: BASE_URL,
    services: {
      pdf: 'enabled',
      screenshot: 'enabled',
      gcp: 'enabled',
      fileUpload: 'enabled'
    },
    environment: {
      isRailway: !!process.env.RAILWAY_PUBLIC_DOMAIN,
      railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || null,
      port: PORT,
      nodeVersion: process.version,
      gcpProject: 'chatterforms'
    }
  });
});

// ============== EMAIL API ENDPOINTS ==============

// Send form published email
app.post('/api/emails/send-form-published', async (req, res) => {
  try {
    const { userEmail, formTitle, publicUrl } = req.body;
    
    if (!formTitle || !publicUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle, publicUrl'
      });
    }
    
    console.log(`📧 Form published email request for: ${formTitle}`);
    const result = await emailService.sendFormPublishedEmail(userEmail, formTitle, publicUrl);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form published email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Send form submission email
app.post('/api/emails/send-form-submission', async (req, res) => {
  try {
    const { userEmail, formTitle, submissionData, isHipaa = false, formId = null } = req.body;
    
    if (!formTitle || !submissionData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle, submissionData'
      });
    }
    
    console.log(`📧 Form submission email request for: ${formTitle} (HIPAA: ${isHipaa})`);
    const result = await emailService.sendFormSubmissionEmail(userEmail, formTitle, submissionData, isHipaa, formId);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form submission email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Send form deleted email
app.post('/api/emails/send-form-deleted', async (req, res) => {
  try {
    const { userEmail, formTitle } = req.body;
    
    if (!formTitle) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: formTitle'
      });
    }
    
    console.log(`📧 Form deleted email request for: ${formTitle}`);
    const result = await emailService.sendFormDeletedEmail(userEmail, formTitle);
    
    if (result.success) {
      if (result.skipped) {
        res.json({
          success: true,
          skipped: true,
          reason: result.reason,
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error in form deleted email endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============== PAYMENT INTEGRATION ENDPOINTS ==============

// Connect Stripe account (Express account creation)
app.post('/api/stripe/connect', async (req, res) => {
  try {
    console.log('💳 Stripe Connect request received');
    
    const { userId, email, country = 'US', nickname } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({
        success: false,
        error: 'User ID and email are required'
      });
    }

    // Create Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: country,
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      }
    });

    // Store account information
    const accountId = await gcpClient.storeStripeAccount(
      userId, 
      account.id, 
      'express', 
      {
        charges_enabled: false,
        details_submitted: false,
        capabilities: account.capabilities,
        country: account.country,
        default_currency: account.default_currency,
        email: account.email
      },
      nickname
    );

    console.log(`✅ Stripe Express account created: ${account.id}`);

    // Create account link for onboarding
    const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com'
    console.log(`🔗 Using frontend URL for redirects: ${frontendUrl}`);
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${frontendUrl}/settings?stripe_refresh=true`,
      return_url: `${frontendUrl}/settings?stripe_success=true`,
      type: 'account_onboarding'
    });

    console.log(`🔗 Account link created: ${accountLink.url}`);

    res.json({
      success: true,
      accountId: account.id,
      accountType: 'express',
      onboardingUrl: accountLink.url
    });

  } catch (error) {
    console.error('❌ Error creating Stripe account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create Stripe account'
    });
  }
});

// OAuth flow for existing Stripe accounts
app.get('/api/stripe/connect-oauth', async (req, res) => {
  try {
    console.log('🔗 OAuth authorization request received');
    
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
    const redirectUri = process.env.STRIPE_CONNECT_REDIRECT_URI;
    
    if (!clientId || !redirectUri) {
      return res.status(500).json({
        success: false,
        error: 'OAuth configuration missing'
      });
    }

    // Store userId in session for callback
    req.session.oauthUserId = userId;

    const authUrl = `https://connect.stripe.com/oauth/authorize?` +
      `response_type=code&` +
      `client_id=${clientId}&` +
      `scope=read_write&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${userId}`;

    console.log(`🔗 Redirecting to OAuth: ${authUrl}`);
    res.redirect(authUrl);

  } catch (error) {
    console.error('❌ Error initiating OAuth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth flow'
    });
  }
});

// OAuth callback handler
app.get('/api/stripe/connect-callback', async (req, res) => {
  try {
    console.log('🔗 OAuth callback received');
    
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code missing'
      });
    }

    const userId = state || req.session.oauthUserId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID missing from OAuth flow'
      });
    }

    console.log(`🔗 Exchanging code for access token for user: ${userId}`);

    // Exchange authorization code for access token
    const response = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_secret: process.env.STRIPE_SECRET_KEY,
        code: code,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await response.json();

    if (!response.ok) {
      console.error('❌ OAuth token exchange failed:', tokenData);
      return res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code for access token',
        details: tokenData.error_description || tokenData.error
      });
    }

    console.log(`✅ OAuth token exchange successful for user: ${userId}`);

    // Store the connected account
    const accountId = await gcpClient.storeStripeAccount(
      userId,
      tokenData.stripe_user_id,
      'standard',
      {
        charges_enabled: true,
        details_submitted: true,
        capabilities: tokenData.stripe_publishable_key ? {} : {},
        country: tokenData.country || 'US',
        default_currency: tokenData.default_currency || 'usd',
        email: tokenData.email || ''
      },
      'Connected via OAuth'
    );

    console.log(`✅ Connected account stored: ${accountId}`);

    // Redirect back to settings page
    const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
    res.redirect(`${frontendUrl}/settings?stripe_oauth_success=true`);

  } catch (error) {
    console.error('❌ Error handling OAuth callback:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com';
    res.redirect(`${frontendUrl}/settings?stripe_oauth_error=true`);
  }
});

// Create account link with smart link type selection
app.post('/api/stripe/account-link', async (req, res) => {
  try {
    console.log('🔗 Creating Stripe account link');
    
    const { userId, refreshUrl, returnUrl, linkType } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
        code: 'MISSING_USER_ID'
      });
    }

    // Get user's Stripe account
    const stripeAccount = await gcpClient.getStripeAccount(userId);
    if (!stripeAccount) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    // Get current account status to determine link type
    const account = await stripe.accounts.retrieve(stripeAccount.stripe_account_id);
    
    // Determine the appropriate link type
    let finalLinkType = linkType;
    if (!finalLinkType) {
      // OAuth accounts (standard) can only use account_onboarding
      if (stripeAccount.account_type === 'standard') {
        finalLinkType = 'account_onboarding';
      } else if (!account.details_submitted) {
        finalLinkType = 'account_onboarding';
      } else if (!account.charges_enabled || !account.payouts_enabled) {
        finalLinkType = 'account_update';
      } else {
        return res.status(400).json({
          success: false,
          error: 'Account is already fully set up',
          code: 'ACCOUNT_COMPLETE'
        });
      }
    }

    // Create account link
    const frontendUrl = process.env.FRONTEND_URL || 'https://chatterforms.com'
    console.log(`🔗 Using frontend URL for redirects: ${frontendUrl}`);
    console.log(`🔗 Creating ${finalLinkType} link for account: ${stripeAccount.stripe_account_id}`);
    
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.stripe_account_id,
      refresh_url: refreshUrl || `${frontendUrl}/settings?stripe_refresh=true`,
      return_url: returnUrl || `${frontendUrl}/settings?stripe_success=true`,
      type: finalLinkType
    });

    console.log(`✅ Account link created for account: ${stripeAccount.stripe_account_id}`);

    res.json({
      success: true,
      url: accountLink.url,
      expires_at: accountLink.expires_at,
      link_type: finalLinkType
    });

  } catch (error) {
    console.error('❌ Error creating account link:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request to Stripe',
        code: 'INVALID_REQUEST'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create account link',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get all Stripe accounts for a user
app.get('/api/stripe/accounts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`💳 Getting all Stripe accounts for user: ${userId}`);

    const accounts = await gcpClient.getStripeAccounts(userId);
    
    // Sync each account with Stripe to get latest status
    const syncedAccounts = await Promise.all(accounts.map(async (account) => {
      try {
        const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);
        
        // Update local account data
        await gcpClient.updateStripeAccount(account.id, {
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          last_sync_at: new Date()
        });

        // Determine account status
        const isFullySetup = stripeAccount.charges_enabled && stripeAccount.payouts_enabled && stripeAccount.details_submitted;
        const needsOnboarding = !stripeAccount.details_submitted;
        const needsVerification = stripeAccount.details_submitted && !stripeAccount.charges_enabled;
        const needsPayouts = stripeAccount.charges_enabled && !stripeAccount.payouts_enabled;

        return {
          ...account,
          is_fully_setup: isFullySetup,
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          country: stripeAccount.country,
          default_currency: stripeAccount.default_currency,
          email: stripeAccount.email,
          needs_onboarding: needsOnboarding,
          needs_verification: needsVerification,
          needs_payouts: needsPayouts,
          can_receive_payments: stripeAccount.charges_enabled && stripeAccount.payouts_enabled
        };
      } catch (error) {
        console.error(`❌ Error syncing account ${account.stripe_account_id}:`, error);
        return account; // Return original account if sync fails
      }
    }));

    res.json({
      success: true,
      accounts: syncedAccounts
    });

  } catch (error) {
    console.error('❌ Error getting Stripe accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Stripe accounts',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get Stripe account status with comprehensive status checking (legacy - for backward compatibility)
app.get('/api/stripe/account/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`💳 Getting Stripe account status for user: ${userId}`);

    const stripeAccount = await gcpClient.getStripeAccount(userId);
    if (!stripeAccount) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    // Sync with Stripe to get latest status
    const account = await stripe.accounts.retrieve(stripeAccount.stripe_account_id);
    
    // Update local account data
    await gcpClient.updateStripeAccount(stripeAccount.id, {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      last_sync_at: new Date()
    });

    // Determine account status and required actions
    const isFullySetup = account.charges_enabled && account.payouts_enabled && account.details_submitted;
    const needsOnboarding = !account.details_submitted;
    const needsVerification = account.details_submitted && !account.charges_enabled;
    const needsPayouts = account.charges_enabled && !account.payouts_enabled;

    // Determine what link type to use
    let linkType = null;
    let actionText = null;
    
    if (needsOnboarding) {
      linkType = 'account_onboarding';
      actionText = 'Complete Business Profile';
    } else if (needsVerification) {
      linkType = 'account_update';
      actionText = 'Complete Verification';
    } else if (needsPayouts) {
      linkType = 'account_update';
      actionText = 'Add Bank Account';
    }

    res.json({
      success: true,
      account: {
        id: stripeAccount.id,
        stripe_account_id: stripeAccount.stripe_account_id,
        account_type: stripeAccount.account_type,
        is_fully_setup: isFullySetup,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        country: account.country,
        default_currency: account.default_currency,
        email: account.email,
        // Status indicators
        needs_onboarding: needsOnboarding,
        needs_verification: needsVerification,
        needs_payouts: needsPayouts,
        // Action details
        link_type: linkType,
        action_text: actionText,
        can_receive_payments: account.charges_enabled && account.payouts_enabled
      }
    });

  } catch (error) {
    console.error('❌ Error getting Stripe account:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stripe account',
        code: 'INVALID_ACCOUNT'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to get Stripe account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Delete specific Stripe account connection
app.delete('/api/stripe/account/:userId/:accountId', async (req, res) => {
  try {
    const { userId, accountId } = req.params;
    console.log(`🗑️ Deleting Stripe account ${accountId} for user: ${userId}`);

    if (!userId || !accountId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Account ID are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    // Get the specific account to verify ownership and get Stripe account ID
    const accountRef = gcpClient.firestore.collection('user_stripe_accounts').doc(accountId);
    const accountDoc = await accountRef.get();
    
    if (!accountDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Stripe account not found',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }

    const accountData = accountDoc.data();
    if (accountData.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to delete this Stripe account',
        code: 'UNAUTHORIZED'
      });
    }

    // Deactivate the Stripe account (don't delete completely for compliance)
    try {
      await stripe.accounts.del(accountData.stripe_account_id);
      console.log(`✅ Stripe account deactivated: ${accountData.stripe_account_id}`);
    } catch (stripeError) {
      console.warn(`⚠️ Could not deactivate Stripe account: ${stripeError.message}`);
      // Continue with local cleanup even if Stripe deactivation fails
    }

    // Delete local account data
    const deleted = await gcpClient.deleteStripeAccount(userId, accountId);
    if (!deleted) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete local account data',
        code: 'DELETE_FAILED'
      });
    }

    console.log(`✅ Stripe account deleted: ${accountId}`);
    res.json({
      success: true,
      message: 'Stripe account disconnected successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting Stripe account:', error);
    
    // Handle specific errors
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stripe account',
        code: 'INVALID_ACCOUNT'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete Stripe account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Create payment intent for form submission
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    console.log('💳 Creating payment intent');
    
    const { 
      formId, 
      fieldId, 
      amount, 
      currency = 'usd',
      customerEmail,
      customerName,
      billingAddress 
    } = req.body;

    if (!formId || !fieldId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Form ID, field ID, and amount are required'
      });
    }

    // Validate amount is a positive number
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Validate currency is a valid 3-letter code
    if (!currency || typeof currency !== 'string' || currency.length !== 3) {
      return res.status(400).json({
        success: false,
        error: 'Currency must be a valid 3-letter code (e.g., usd, eur)'
      });
    }

    // Get payment field configuration
    const paymentFields = await gcpClient.getPaymentFields(formId);
    const paymentField = paymentFields.find(field => field.field_id === fieldId);
    
    if (!paymentField) {
      return res.status(404).json({
        success: false,
        error: 'Payment field not found'
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: paymentField.amount,
      currency: paymentField.currency,
      application_fee_amount: 0, // No application fee for now
      transfer_data: {
        destination: paymentField.stripe_account_id
      },
      metadata: {
        form_id: formId,
        field_id: fieldId,
        customer_email: customerEmail || '',
        customer_name: customerName || ''
      },
      ...(customerEmail && { receipt_email: customerEmail }) // Only include if provided
    });

    console.log(`✅ Payment intent created: ${paymentIntent.id}`);

    res.json({
      success: true,
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });

  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    
    // Provide more specific error information
    let errorMessage = 'Failed to create payment intent';
    let statusCode = 500;
    
    if (error.type === 'StripeInvalidRequestError') {
      errorMessage = `Invalid request: ${error.message}`;
      statusCode = 400;
    } else if (error.type === 'StripeCardError') {
      errorMessage = `Card error: ${error.message}`;
      statusCode = 400;
    } else if (error.type === 'StripeRateLimitError') {
      errorMessage = 'Rate limit exceeded. Please try again later.';
      statusCode = 429;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: error.message
    });
  }
});

// Handle successful payment
app.post('/api/stripe/payment-success', async (req, res) => {
  try {
    console.log('✅ Payment success webhook received');
    
    const { 
      submissionId, 
      formId, 
      fieldId, 
      paymentIntentId,
      customerEmail,
      customerName,
      billingAddress 
    } = req.body;

    if (!submissionId || !formId || !fieldId || !paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Get payment intent details from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Get payment field to get Stripe account ID
    const paymentFields = await gcpClient.getPaymentFields(formId);
    const paymentField = paymentFields.find(field => field.field_id === fieldId);
    
    if (!paymentField) {
      return res.status(404).json({
        success: false,
        error: 'Payment field not found'
      });
    }

    // Store payment transaction
    const transactionId = await gcpClient.storePaymentTransaction(
      submissionId,
      formId,
      fieldId,
      {
        paymentIntentId: paymentIntent.id,
        stripeAccountId: paymentField.stripe_account_id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: 'succeeded',
        customerEmail: customerEmail || paymentIntent.receipt_email,
        customerName: customerName,
        billingAddress: billingAddress,
        paymentMethod: paymentIntent.payment_method ? {
          type: paymentIntent.payment_method.type,
          brand: paymentIntent.payment_method.card?.brand,
          last4: paymentIntent.payment_method.card?.last4,
          exp_month: paymentIntent.payment_method.card?.exp_month,
          exp_year: paymentIntent.payment_method.card?.exp_year
        } : null,
        receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url,
        completedAt: new Date()
      }
    );

    console.log(`✅ Payment transaction stored: ${transactionId}`);

    res.json({
      success: true,
      transactionId: transactionId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: 'succeeded'
    });

  } catch (error) {
    console.error('❌ Error processing payment success:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment success'
    });
  }
});

// Get payment transactions for a submission
app.get('/api/stripe/transactions/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;
    console.log(`💳 Getting payment transactions for submission: ${submissionId}`);

    const transactions = await gcpClient.getPaymentTransactions(submissionId);
    
    // Remove sensitive information before sending to frontend
    const safeTransactions = transactions.map(transaction => ({
      id: transaction.id,
      field_id: transaction.field_id,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      customer_email: transaction.customer_email,
      customer_name: transaction.customer_name,
      created_at: transaction.created_at,
      completed_at: transaction.completed_at,
      receipt_url: transaction.receipt_url
    }));

    res.json({
      success: true,
      transactions: safeTransactions
    });

  } catch (error) {
    console.error('❌ Error getting payment transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment transactions'
    });
  }
});

// Stripe webhook handler for payment events
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      console.error('❌ Stripe webhook secret not configured');
      return res.status(400).json({ error: 'Webhook secret not configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log(`🔔 Stripe webhook received: ${event.type}`);

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
      case 'account.updated':
        await handleAccountUpdate(event.data.object);
        break;
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Error processing Stripe webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper function to handle successful payments
async function handlePaymentSuccess(paymentIntent) {
  try {
    console.log(`✅ Payment succeeded: ${paymentIntent.id}`);
    
    // Find the transaction by payment intent ID
    const transaction = await gcpClient.getPaymentTransactionByIntentId(paymentIntent.id);
    
    if (transaction) {
      // Update transaction status
      await gcpClient.updatePaymentTransaction(transaction.id, {
        status: 'succeeded',
        completed_at: new Date(),
        receipt_url: paymentIntent.charges?.data?.[0]?.receipt_url
      });
      
      console.log(`✅ Transaction updated: ${transaction.id}`);
    } else {
      console.log(`⚠️ No transaction found for payment intent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment success:', error);
  }
}

// Helper function to handle failed payments
async function handlePaymentFailure(paymentIntent) {
  try {
    console.log(`❌ Payment failed: ${paymentIntent.id}`);
    
    // Find the transaction by payment intent ID
    const transaction = await gcpClient.getPaymentTransactionByIntentId(paymentIntent.id);
    
    if (transaction) {
      // Update transaction status
      await gcpClient.updatePaymentTransaction(transaction.id, {
        status: 'failed',
        failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed'
      });
      
      console.log(`❌ Transaction updated: ${transaction.id}`);
    } else {
      console.log(`⚠️ No transaction found for payment intent: ${paymentIntent.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling payment failure:', error);
  }
}

// Helper function to handle account updates
async function handleAccountUpdate(account) {
  try {
    console.log(`🔄 Account updated: ${account.id}`);
    
    // Find the local account record
    const localAccount = await gcpClient.getStripeAccount(account.id);
    
    if (localAccount) {
      // Update local account data
      await gcpClient.updateStripeAccount(localAccount.id, {
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        last_sync_at: new Date()
      });
      
      console.log(`🔄 Account data updated: ${localAccount.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling account update:', error);
  }
}

// ========================================
// CALENDLY INTEGRATION ENDPOINTS
// ========================================

/**
 * Connect Calendly account
 */
app.post('/api/calendly/connect', async (req, res) => {
  try {
    console.log('📅 Connecting Calendly account');
    
    const { userId, calendlyUrl } = req.body;

    if (!userId || !calendlyUrl) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Calendly URL are required'
      });
    }

    // Validate Calendly URL format
    if (!calendlyUrl.includes('calendly.com/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Calendly URL format'
      });
    }

    // Extract username from URL for storage
    const urlParts = calendlyUrl.split('/');
    const calendlyUsername = urlParts[urlParts.length - 1] || 'unknown';
    
    // Store Calendly account
    const accountId = await gcpClient.storeCalendlyAccount(
      userId,
      calendlyUsername,
      calendlyUrl,
      [] // Event types will be fetched separately
    );

    console.log(`✅ Calendly account connected: ${accountId}`);

    res.json({
      success: true,
      accountId,
      message: 'Calendly account connected successfully'
    });

  } catch (error) {
    console.error('❌ Error connecting Calendly account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect Calendly account'
    });
  }
});

/**
 * Get Calendly account status
 */
app.get('/api/calendly/account/:userId', async (req, res) => {
  try {
    console.log(`📅 Getting Calendly account status for user: ${req.params.userId}`);
    
    const accounts = await gcpClient.getCalendlyAccounts(req.params.userId);
    
    res.json({
      success: true,
      accounts: accounts || []
    });

  } catch (error) {
    console.error('❌ Error getting Calendly account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Calendly account'
    });
  }
});

// Delete Calendly URL for a user
app.delete('/api/calendly/account/:userId/:accountId', async (req, res) => {
  try {
    const { userId, accountId } = req.params;
    console.log(`🗑️ Request to delete Calendly account ${accountId} for user ${userId}`);
    const result = await gcpClient.deleteCalendlyAccount(userId, accountId);
    if (!result.success) {
      if (result.reason === 'not_found') return res.status(404).json({ success: false, error: 'Calendly URL not found' });
      if (result.reason === 'forbidden') return res.status(403).json({ success: false, error: 'Forbidden' });
      return res.status(500).json({ success: false, error: 'Failed to delete Calendly URL' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting Calendly URL:', error);
    res.status(500).json({ success: false, error: 'Failed to delete Calendly URL' });
  }
});

/**
 * Get Calendly event types
 */
app.get('/api/calendly/event-types/:userId', async (req, res) => {
  try {
    console.log(`📅 Getting Calendly event types for user: ${req.params.userId}`);
    
    const account = await gcpClient.getCalendlyAccount(req.params.userId);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Calendly account not found'
      });
    }

    // For now, return basic event types
    // In the future, we can integrate with Calendly API to fetch real event types
    const eventTypes = [
      {
        uri: `${account.calendly_url}/15min`,
        name: '15 Minute Meeting',
        duration: 15,
        description: 'Quick 15-minute call',
        color: '#0066cc',
        active: true
      },
      {
        uri: `${account.calendly_url}/30min`,
        name: '30 Minute Meeting',
        duration: 30,
        description: 'Standard 30-minute meeting',
        color: '#0066cc',
        active: true
      },
      {
        uri: `${account.calendly_url}/60min`,
        name: '1 Hour Meeting',
        duration: 60,
        description: '1-hour detailed discussion',
        color: '#0066cc',
        active: true
      }
    ];

    res.json({
      success: true,
      eventTypes
    });

  } catch (error) {
    console.error('❌ Error getting Calendly event types:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Calendly event types'
    });
  }
});

/**
 * Store calendar booking
 */
app.post('/api/calendly/booking', async (req, res) => {
  try {
    console.log('📅 Storing calendar booking');
    
    const { 
      submissionId, 
      formId, 
      fieldId, 
      eventUri, 
      eventName, 
      startTime, 
      endTime, 
      duration, 
      timezone, 
      attendeeEmail, 
      attendeeName, 
      attendeePhone, 
      bookingUrl 
    } = req.body;

    // Validate required fields
    if (!submissionId || !formId || !fieldId || !eventUri) {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking data: submissionId, formId, fieldId, and eventUri are required'
      });
    }

    // Validate optional but important fields - allow fallback values
    if (!eventName || eventName.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking details: eventName is required'
      });
    }

    // Validate duration is a positive number
    if (duration && (typeof duration !== 'number' || duration <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'Duration must be a positive number'
      });
    }

    // Validate email format if provided
    if (attendeeEmail && !attendeeEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid attendee email format'
      });
    }

    const bookingData = {
      eventUri,
      eventName,
      startTime,
      endTime,
      duration,
      timezone,
      attendeeEmail,
      attendeeName,
      attendeePhone,
      bookingUrl
    };

    const bookingId = await gcpClient.storeCalendarBooking(
      submissionId,
      formId,
      fieldId,
      bookingData
    );

    console.log(`✅ Calendar booking stored: ${bookingId}`);

    res.json({
      success: true,
      bookingId,
      message: 'Calendar booking stored successfully'
    });

  } catch (error) {
    console.error('❌ Error storing calendar booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store calendar booking'
    });
  }
});

/**
 * Get calendar bookings for a submission
 */
app.get('/api/calendly/bookings/:submissionId', async (req, res) => {
  try {
    console.log(`📅 Getting calendar bookings for submission: ${req.params.submissionId}`);
    
    const bookings = await gcpClient.getCalendarBookings(req.params.submissionId);

    res.json({
      success: true,
      bookings
    });

  } catch (error) {
    console.error('❌ Error getting calendar bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get calendar bookings'
    });
  }
});

// ============== SERVER STARTUP ==============

app.listen(PORT, () => {
  console.log(`🚀 ChatterForms API running at ${BASE_URL}`);
  console.log(`📁 PDF Upload: POST ${BASE_URL}/upload`);
  console.log(`📸 Screenshot: POST ${BASE_URL}/screenshot`);
  console.log(`📎 File Upload: POST ${BASE_URL}/upload-file`);
  console.log(`📋 Form Submissions: GET ${BASE_URL}/form/:formId/submissions`);
  console.log(`📄 Single Submission: GET ${BASE_URL}/submission/:submissionId`);
  console.log(`📊 Form Analytics: GET ${BASE_URL}/analytics/:formId`);
  console.log(`👤 User Analytics: GET ${BASE_URL}/analytics/user/:userId`);
  console.log(`📈 All Analytics: GET ${BASE_URL}/analytics?limit=100`);
  console.log(`🗑️ Cleanup: GET ${BASE_URL}/cleanup`);
  console.log(`🔄 Form Migration: POST ${BASE_URL}/api/forms/migrate-anonymous`);
  console.log(`🧹 Session Cleanup: GET ${BASE_URL}/api/cleanup/expired-sessions`);
  console.log(`🔐 Auth Signup: POST ${BASE_URL}/auth/signup`);
  console.log(`🔑 Auth Login: POST ${BASE_URL}/auth/login`);
  console.log(`✅ Email Verify: POST ${BASE_URL}/auth/verify-email`);
  console.log(`🔄 Password Reset: POST ${BASE_URL}/auth/request-reset`);
  console.log(`🔒 Reset Password: POST ${BASE_URL}/auth/reset-password`);
  console.log(`📦 Form Migration: POST ${BASE_URL}/auth/migrate-forms`);
  console.log(`👤 Session Check: GET ${BASE_URL}/auth/session`);
  console.log(`💳 Stripe Webhooks: POST ${BASE_URL}/api/billing/webhook`);
  console.log(`📧 Form Published Email: POST ${BASE_URL}/api/emails/send-form-published`);
  console.log(`📧 Form Submission Email: POST ${BASE_URL}/api/emails/send-form-submission`);
  console.log(`📧 Form Deleted Email: POST ${BASE_URL}/api/emails/send-form-deleted`);
  console.log(`🏥 Health: GET ${BASE_URL}/health`);
  
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`🚄 Running on Railway: ${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  } else {
    console.log(`💻 Running locally on port ${PORT}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});