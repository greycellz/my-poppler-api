const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Poppler } = require('node-poppler');

const app = express();
const poppler = new Poppler();
const PORT = process.env.PORT || 3003;

// Create folders if not exist
['uploads', 'output'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Configure file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, 'form.pdf')
});
const upload = multer({ storage });

// Static folders
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('pdf'), async (req, res) => {
  const pdfPath = path.join(__dirname, 'uploads/form.pdf');
  const outputBase = path.join(__dirname, 'output/page');

  // Clean old output
  fs.readdirSync('./output').forEach(file => fs.unlinkSync(path.join('./output', file)));

  const options = {
    pngFile: true,
    firstPageToConvert: 1,
    lastPageToConvert: 0
  };

  try {
    await poppler.pdfToCairo(pdfPath, outputBase, options);

    // Grab all generated PNG files
    const outputFiles = fs.readdirSync('./output').filter(f => f.endsWith('.png'));
    const fullUrls = outputFiles.map(file => `/output/${file}`);
    
    console.log("\n✅ PDF converted. View output images:");
    fullUrls.forEach(url => console.log(`http://localhost:${PORT}${url}`));

    res.send(`
      <h2>Converted Images</h2>
      <ul>
        ${fullUrls.map(url => `<li><a href="${url}" target="_blank">${url}</a></li>`).join('')}
      </ul>
      <a href="/">Upload another</a>
    `);
  } catch (err) {
    console.error("❌ Conversion failed:", err);
    res.status(500).send('Conversion failed: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
