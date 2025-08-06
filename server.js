const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Poppler } = require('node-poppler');

const app = express();
const poppler = new Poppler();
const PORT = process.env.PORT || 3003;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Create folders if not exist
['uploads', 'output'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Configure file uploads with UUID-based naming
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

app.post('/upload', upload.single('pdf'), async (req, res) => {
  const uuid = req.uuid || uuidv4();
  const pdfPath = path.join(__dirname, 'uploads', `${uuid}.pdf`);
  const outputDir = path.join(__dirname, 'output', uuid);
  const outputBase = path.join(outputDir, 'page');

  try {
    // Create unique output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const options = {
      pngFile: true,
      firstPageToConvert: 1,
      lastPageToConvert: 0, // 0 means all pages
      singleFile: false,
      resolutionXYAxis: 150 // Good quality for text recognition
    };

    await poppler.pdfToCairo(pdfPath, outputBase, options);

    // Get all generated PNG files
    const outputFiles = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        // Sort numerically (page-1.png, page-2.png, etc.)
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
      message: `Successfully converted ${outputFiles.length} page(s)`
    });

  } catch (err) {
    console.error("❌ Conversion failed:", err);
    
    // Cleanup on failure
    try {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error("⚠️ Cleanup failed:", cleanupErr);
    }

    res.status(500).json({
      success: false,
      error: 'PDF conversion failed',
      details: err.message
    });
  }
});

// Manual cleanup endpoint for specific UUID
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

    console.log(`🗑️ Cleaned up UUID: ${uuid}`);

    res.json({
      success: true,
      uuid: uuid,
      cleaned: cleaned,
      message: cleaned.length > 0 ? 'Files cleaned successfully' : 'No files found to clean'
    });

  } catch (err) {
    console.error(`❌ Cleanup failed for UUID ${uuid}:`, err);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      details: err.message
    });
  }
});

// Scheduled cleanup endpoint (files older than 1 hour)
app.get('/cleanup', (req, res) => {
  try {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let cleanedCount = 0;

    // Clean uploads folder
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

    // Clean output folders
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

    console.log(`🗑️ Scheduled cleanup completed. Cleaned ${cleanedCount} items.`);

    res.json({
      success: true,
      cleanedCount: cleanedCount,
      message: `Cleaned ${cleanedCount} old files/folders`
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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Home page served from static files (public/index.html)

app.listen(PORT, () => {
  console.log(`🚀 Poppler PDF Converter running at ${BASE_URL}`);
  console.log(`📁 Upload endpoint: POST ${BASE_URL}/upload`);
  console.log(`🗑️ Cleanup endpoint: GET ${BASE_URL}/cleanup`);
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