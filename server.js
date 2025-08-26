const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');
const puppeteer = require('puppeteer');

const app = express();
const poppler = new Poppler();
const PORT = process.env.PORT || 3000; // Keep 3000 to match existing Dockerfile

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

// Enable JSON parsing for screenshot requests
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
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

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
      gcp: 'enabled'
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

// ============== SERVER STARTUP ==============

app.listen(PORT, () => {
  console.log(`🚀 PDF & Screenshot Service running at ${BASE_URL}`);
  console.log(`📁 PDF Upload: POST ${BASE_URL}/upload`);
  console.log(`📸 Screenshot: POST ${BASE_URL}/screenshot`);
  console.log(`🗑️ Cleanup: GET ${BASE_URL}/cleanup`);
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