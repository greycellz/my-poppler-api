const express = require('express')
const router = express.Router()
const puppeteer = require('puppeteer')
const { extractFormFieldsFromDOM } = require('../utils/html-form-scraper')
const { validateUrl } = require('../utils/utils')
const { withTimeout, TIMEOUTS } = require('../utils/timeout')

/**
 * POST /analyze-url-html
 * Analyze a form URL by extracting fields directly from the HTML DOM
 * This is more accurate than Vision API for web forms
 */
router.post('/analyze-url-html', async (req, res) => {
  const startTime = Date.now()
  let browser = null
  
  try {
    const { url, additionalContext } = req.body

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      })
    }

    // Validate URL
    const validation = validateUrl(url)
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL',
        details: validation.error
      })
    }

    const normalizedUrl = validation.normalizedUrl
    console.log(`🔍 [HTML Scraper] Analyzing URL: ${normalizedUrl}`)

    // Launch browser
    const isRailway = !!process.env.RAILWAY_PUBLIC_DOMAIN
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
    }

    if (isRailway && process.env.PUPPETEER_EXECUTABLE_PATH) {
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      console.log(`🐳 [HTML Scraper] Using system Chrome: ${process.env.PUPPETEER_EXECUTABLE_PATH}`)
    } else {
      console.log('💻 [HTML Scraper] Using bundled Chromium')
    }

    browser = await puppeteer.launch(browserOptions)
    const page = await browser.newPage()

    // Set viewport
    await page.setViewport({ 
      width: 1280, 
      height: 800 
    })
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })

    console.log(`📄 [HTML Scraper] Navigating to URL: ${normalizedUrl}`)
    
    // Navigate with timeout
    await page.goto(normalizedUrl, { 
      waitUntil: 'networkidle0',
      timeout: 45000
    })

    // Wait for dynamic content (React hydration)
    const waitTime = parseInt(process.env.HTML_SCRAPER_WAIT_TIME || '4000', 10)
    console.log(`⏳ [HTML Scraper] Waiting ${waitTime}ms for dynamic content...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))

    // Scroll to load lazy content
    console.log('📜 [HTML Scraper] Scrolling page to load lazy content...')
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0
        const distance = 100
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance

          if (totalHeight >= scrollHeight) {
            clearInterval(timer)
            window.scrollTo(0, 0)
            setTimeout(() => resolve(), 1000)
          }
        }, 100)
      })
    })

    // Extract form fields from DOM (with timeout)
    const fields = await withTimeout(
      extractFormFieldsFromDOM(page),
      TIMEOUTS.DOM_EXTRACTION,
      `DOM extraction timed out after ${TIMEOUTS.DOM_EXTRACTION}ms`
    )

    const processingTime = Date.now() - startTime
    console.log(`✅ [HTML Scraper] Extracted ${fields.length} fields in ${processingTime}ms`)
    
    // Validate fields were extracted
    if (fields.length === 0) {
      console.warn('⚠️ [HTML Scraper] No fields extracted - form may not be loaded or accessible')
    }

    // Transform to match expected format
    const extractedFields = fields.map(field => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required || false,
      placeholder: field.placeholder,
      options: field.options,
      allowOther: field.allowOther,
      otherLabel: field.otherLabel,
      otherPlaceholder: field.otherPlaceholder
    }))

    res.json({
      success: true,
      fields: extractedFields,
      method: 'html-scraping',
      processingTimeMs: processingTime,
      metadata: {
        url: normalizedUrl,
        fieldCount: extractedFields.length,
        fieldTypes: extractedFields.reduce((acc, f) => {
          acc[f.type] = (acc[f.type] || 0) + 1
          return acc
        }, {}),
        warning: fields.length === 0 ? 'No fields extracted - form may not be loaded or accessible' : undefined
      }
    })

  } catch (error) {
    const processingTime = Date.now() - startTime
    console.error('❌ [HTML Scraper] Error:', {
      message: error.message,
      stack: error.stack,
      url: req.body?.url || 'unknown',
      processingTime: processingTime
    })
    res.status(500).json({
      success: false,
      error: 'HTML scraping failed',
      details: error.message,
      processingTimeMs: processingTime
    })
  } finally {
    if (browser) {
      await browser.close()
      console.log('🔒 [HTML Scraper] Browser closed')
    }
  }
})

module.exports = router

