const express = require('express')
const router = express.Router()
const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { validateUrl } = require('../utils/utils')

// Get base URL for screenshot URLs
const getBaseUrl = () => {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }
  // In production, this should error, not default to localhost
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RAILWAY_PUBLIC_DOMAIN must be set in production environment')
  }
  return `http://localhost:${process.env.PORT || 3000}`
}

const BASE_URL = getBaseUrl()

// Generate URL hash for caching
function generateUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex')
}

// Check if cached screenshot exists for a specific page
function getCachedScreenshotPage(urlHash, pageNumber) {
  const screenshotDir = path.join(__dirname, '..', 'screenshots', urlHash)
  const screenshotPath = path.join(screenshotDir, `page-${pageNumber}.png`)
  
  if (fs.existsSync(screenshotPath)) {
    const stats = fs.statSync(screenshotPath)
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000)
    
    if (stats.mtime.getTime() > thirtyMinutesAgo) {
      return {
        url: `${BASE_URL}/screenshots/${urlHash}/page-${pageNumber}.png`,
        size: stats.size,
        cached: true
      }
    }
  }
  
  return null
}

/**
 * POST /screenshot-pages
 * Capture multiple viewport-sized screenshots by scrolling through page
 * 
 * Body:
 * - url: URL to capture
 * - options: {
 *     viewport: { width: 1280, height: 800 },
 *     waitTime: 4000,
 *     scrollDelay: 500,
 *     overlap: 50
 *   }
 */
router.post('/screenshot-pages', async (req, res) => {
  const { url, options = {} } = req.body
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required',
      details: 'Please provide a valid URL to capture'
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
  const urlHash = generateUrlHash(normalizedUrl)
  const viewportWidth = options.viewport?.width || 1280
  const viewportHeight = options.viewport?.height || 800
  const waitTime = options.waitTime || 4000
  const scrollDelay = options.scrollDelay || 500
  const overlap = options.overlap || 50

  let browser = null
  const startTime = Date.now()

  try {
    const endpointStartTime = Date.now()
    console.log('📸 [DEBUG] ========== SCREENSHOT-PAGES ENDPOINT START ==========')
    console.log('📸 [DEBUG] Request URL:', normalizedUrl)
    console.log('📸 [DEBUG] URL Hash:', urlHash)
    console.log('📸 [DEBUG] Options:', JSON.stringify({ viewportWidth, viewportHeight, waitTime, scrollDelay, overlap }, null, 2))
    
    // Detect environment and set browser options
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

    // Use system Chrome on Railway
    if (isRailway && process.env.PUPPETEER_EXECUTABLE_PATH) {
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      console.log(`🐳 [DEBUG] Using system Chrome: ${process.env.PUPPETEER_EXECUTABLE_PATH}`)
    } else {
      console.log('💻 [DEBUG] Using bundled Chromium')
    }

    // Launch browser
    browser = await puppeteer.launch(browserOptions)
    const page = await browser.newPage()
    
    // Set viewport
    await page.setViewport({ 
      width: viewportWidth, 
      height: viewportHeight 
    })
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })

    console.log(`📄 [DEBUG] Navigating to URL: ${normalizedUrl}`)
    const navigationStartTime = Date.now()
    
    // Navigate with timeout
    await page.goto(normalizedUrl, { 
      waitUntil: 'networkidle0',
      timeout: 45000
    })
    const navigationTime = Date.now() - navigationStartTime
    console.log(`⏱️ [DEBUG] Navigation completed in ${navigationTime}ms`)

    // Wait for dynamic content (React hydration)
    console.log(`⏳ [DEBUG] Waiting ${waitTime}ms for dynamic content...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))

    // Scroll to load lazy content - improved for Google Forms
    console.log('📜 [DEBUG] Scrolling page to load lazy content...')
    const scrollStartTime = Date.now()
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        let lastHeight = 0
        let attempts = 0
        const maxAttempts = 100 // Prevent infinite loop
        
        const scrollAndCheck = () => {
          // Scroll to bottom
          window.scrollTo(0, document.body.scrollHeight)
          
          setTimeout(() => {
            const newHeight = document.body.scrollHeight
            const currentScroll = window.scrollY
            
            // If height hasn't changed and we're at the bottom, we're done
            if ((newHeight === lastHeight && currentScroll + window.innerHeight >= newHeight - 10) || attempts >= maxAttempts) {
              // Scroll back to top
              window.scrollTo(0, 0)
              setTimeout(() => resolve(), 1500) // Wait longer for content to settle
            } else {
              lastHeight = newHeight
              attempts++
              scrollAndCheck()
            }
          }, 1000) // Wait 1 second for content to load
        }
        
        scrollAndCheck()
      })
    })
    const scrollTime = Date.now() - scrollStartTime
    console.log(`⏱️ [DEBUG] Scrolling completed in ${scrollTime}ms`)

    // Get page dimensions
    const pageDimensions = await page.evaluate(() => {
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    })

    console.log('📐 [DEBUG] Page dimensions:', JSON.stringify(pageDimensions, null, 2))

    // Calculate number of pages needed
    const totalHeight = pageDimensions.height
    const numPages = Math.ceil(totalHeight / viewportHeight)
    
    console.log(`📐 [DEBUG] Total height: ${totalHeight}px, Viewport height: ${viewportHeight}px`)
    console.log(`📐 [DEBUG] Number of pages to capture: ${numPages}`)

    // Create screenshot directory
    const screenshotDir = path.join(__dirname, '..', 'screenshots', urlHash)
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true })
    }

    // Capture per-page screenshots
    const screenshots = []
    const captureStartTime = Date.now()

    for (let i = 0; i < numPages; i++) {
      const pageNumber = i + 1
      const pageStartTime = Date.now()

      // Check cache first
      const cached = getCachedScreenshotPage(urlHash, pageNumber)
      if (cached) {
        console.log(`🎯 [DEBUG] Cache hit for page ${pageNumber}`)
        screenshots.push({
          url: cached.url,
          pageNumber,
          scrollPosition: i * viewportHeight,
          cached: true,
          size: cached.size
        })
        continue
      }

      // Calculate scroll position with overlap
      // For Google Forms, we need to scroll to where content actually is
      // Instead of subtracting overlap, we scroll to show new content
      let scrollY
      if (i === 0) {
        // First page: start at top
        scrollY = 0
      } else {
        // Subsequent pages: scroll to show new content
        // Each page should show viewportHeight pixels of new content
        // With overlap, we go back by overlap pixels to ensure we don't miss content
        scrollY = i * (viewportHeight - overlap)
        if (scrollY < 0) scrollY = 0
      }

      console.log(`📸 [DEBUG] Capturing page ${pageNumber}/${numPages} at scroll position ${scrollY}px`)

      // Scroll to position - Google Forms specific handling
      // Google Forms often has a fixed header, so we need to account for that
      const scrollInfo = await page.evaluate((y) => {
        // Find the actual form container (Google Forms uses specific classes)
        const formContainer = document.querySelector('.freebirdFormviewerViewFormContentWrapper') ||
                             document.querySelector('.freebirdFormviewerViewFormContent') ||
                             document.querySelector('[role="main"]') ||
                             document.querySelector('main') ||
                             document.body
        
        // Get header height if there's a fixed header
        const header = document.querySelector('header') || 
                      document.querySelector('.freebirdFormviewerViewHeaderHeader') ||
                      document.querySelector('[role="banner"]')
        const headerHeight = header ? header.offsetHeight : 0
        
        // Scroll the container (not just window) - this is key for Google Forms
        if (formContainer.scrollTo) {
          formContainer.scrollTo(0, y)
        } else {
          formContainer.scrollTop = y
        }
        
        // Also scroll window as fallback
        window.scrollTo(0, y + headerHeight)
        
        // Force a reflow to ensure content loads
        void formContainer.offsetHeight
        
        // Get debug info about what's visible
        const form = document.querySelector('form')
        const inputs = form ? Array.from(form.querySelectorAll('input, textarea, select')) : []
        const visibleInputs = inputs.filter(input => {
          const rect = input.getBoundingClientRect()
          const viewportTop = headerHeight
          const viewportBottom = window.innerHeight
          return rect.top >= viewportTop && rect.top <= viewportBottom && 
                 rect.left >= 0 && rect.left <= window.innerWidth
        })
        
        // Get visible labels
        const visibleLabels = visibleInputs.map(input => {
          const item = input.closest('.freebirdFormviewerViewItemsItemItem')
          const label = item?.querySelector('.freebirdFormviewerViewItemsItemItemTitle')?.textContent ||
                       input.closest('label')?.textContent ||
                       input.getAttribute('aria-label')
          return label ? label.trim().substring(0, 50) : 'no label'
        })
        
        return {
          windowScrollY: window.scrollY,
          containerScrollTop: formContainer.scrollTop,
          headerHeight: headerHeight,
          totalInputs: inputs.length,
          visibleInputs: visibleInputs.length,
          visibleLabels: visibleLabels,
          bodyHeight: document.body.scrollHeight,
          containerHeight: formContainer.scrollHeight,
          containerClientHeight: formContainer.clientHeight
        }
      }, scrollY)
      
      console.log(`📊 [DEBUG] Scroll info at ${scrollY}px:`, JSON.stringify(scrollInfo, null, 2))

      // Wait for scroll to settle - longer wait for Google Forms
      await new Promise(resolve => setTimeout(resolve, scrollDelay * 2)) // Double the wait time
      
      // For Google Forms, we need to trigger content loading by slowly scrolling
      // Google Forms uses virtual scrolling - content only loads when scrolled into view
      // We also need to wait for the browser to actually render the content
      await page.evaluate(async (targetY) => {
        return new Promise((resolve) => {
          const formContainer = document.querySelector('.freebirdFormviewerViewFormContentWrapper') ||
                               document.querySelector('.freebirdFormviewerViewFormContent') ||
                               document.body
          
          let currentScroll = formContainer.scrollTop || window.scrollY
          const scrollStep = 100 // Larger steps but still gradual
          const scrollInterval = 100 // ms between steps
          
          const scrollToTarget = () => {
            if (Math.abs(currentScroll - targetY) < scrollStep) {
              // Close enough, set final position
              if (formContainer.scrollTo) {
                formContainer.scrollTo({ top: targetY, behavior: 'smooth' })
              } else {
                formContainer.scrollTop = targetY
              }
              window.scrollTo({ top: targetY, behavior: 'smooth' })
              
              // Wait longer for Google Forms to render content
              // Google Forms needs time to actually paint the content to the screen
              setTimeout(() => {
                // Force a reflow to ensure rendering
                void formContainer.offsetHeight
                // Wait additional time for paint
                setTimeout(resolve, 2000)
              }, 1000)
            } else {
              // Scroll towards target
              const direction = targetY > currentScroll ? 1 : -1
              currentScroll += direction * scrollStep
              
              if (formContainer.scrollTo) {
                formContainer.scrollTo({ top: currentScroll, behavior: 'smooth' })
              } else {
                formContainer.scrollTop = currentScroll
              }
              window.scrollTo({ top: currentScroll, behavior: 'smooth' })
              
              setTimeout(scrollToTarget, scrollInterval)
            }
          }
          
          scrollToTarget()
        })
      }, scrollY)
      
      // Additional wait to ensure browser has painted the content
      await page.waitForTimeout(1000)
      
      // Additional wait for Google Forms to render content at this position
      const contentInfo = await page.evaluate(async () => {
        return new Promise((resolve) => {
          let attempts = 0
          const maxAttempts = 15 // More attempts for Google Forms
          let lastVisibleCount = 0
          
          const checkContent = () => {
            attempts++
            const form = document.querySelector('form')
            if (form) {
              const inputs = Array.from(form.querySelectorAll('input, textarea, select'))
              const visibleInputs = inputs.filter(input => {
                const rect = input.getBoundingClientRect()
                return rect.top >= 0 && rect.top <= window.innerHeight && 
                       rect.left >= 0 && rect.left <= window.innerWidth
              })
              
              const visibleLabels = visibleInputs.map(input => {
                // Google Forms structure: input is inside .freebirdFormviewerViewItemsItemItem
                const item = input.closest('.freebirdFormviewerViewItemsItemItem') ||
                           input.closest('[role="listitem"]') ||
                           input.closest('.freebirdFormviewerViewItemsItemItemContainer')
                
                // Try multiple selectors for Google Forms labels
                const label = item?.querySelector('.freebirdFormviewerViewItemsItemItemTitle')?.textContent ||
                           item?.querySelector('.freebirdFormviewerViewItemsItemItemTitleContainer')?.textContent ||
                           item?.querySelector('[role="heading"]')?.textContent ||
                           input.closest('label')?.textContent ||
                           input.getAttribute('aria-label') ||
                           input.getAttribute('placeholder') ||
                           input.getAttribute('name')
                
                return label ? label.trim().substring(0, 50) : 'no label'
              })
              
              // If visible count is stable for 3 checks, we're ready
              if (visibleInputs.length === lastVisibleCount && attempts >= 5 && visibleInputs.length > 0) {
                resolve({
                  visibleCount: visibleInputs.length,
                  labels: visibleLabels,
                  ready: true
                })
              } else if (attempts >= maxAttempts) {
                resolve({
                  visibleCount: visibleInputs.length,
                  labels: visibleLabels,
                  ready: false
                })
              } else {
                lastVisibleCount = visibleInputs.length
                setTimeout(checkContent, 400)
              }
            } else {
              resolve({
                visibleCount: 0,
                labels: [],
                ready: false
              })
            }
          }
          
          setTimeout(checkContent, 800)
        })
      })
      
      console.log(`📋 [DEBUG] Content info:`, JSON.stringify(contentInfo, null, 2))

      // Capture viewport screenshot
      // IMPORTANT: Do NOT use clip.y = 0 here, because that always captures
      // the top of the page regardless of scroll position. We rely on the
      // current scroll position to determine which part of the page is visible.
      // Puppeteer will capture the current viewport after scrolling.
      const screenshotPath = path.join(screenshotDir, `page-${pageNumber}.png`)
      await page.screenshot({
        path: screenshotPath,
        type: 'png',
        fullPage: false
      })

      const pageTime = Date.now() - pageStartTime
      const stats = fs.statSync(screenshotPath)
      const fileSizeKB = (stats.size / 1024).toFixed(2)

      console.log(`✅ [DEBUG] Page ${pageNumber} captured in ${pageTime}ms (${fileSizeKB} KB)`)

      screenshots.push({
        url: `${BASE_URL}/screenshots/${urlHash}/page-${pageNumber}.png`,
        pageNumber,
        scrollPosition: scrollY,
        cached: false,
        size: stats.size
      })
    }

    const captureTime = Date.now() - captureStartTime
    const endpointTime = Date.now() - endpointStartTime
    const pageTitle = await page.title()
    const finalUrl = page.url()

    console.log(`✅ [DEBUG] All ${numPages} pages captured in ${captureTime}ms`)
    console.log(`⏱️ [DEBUG] Total endpoint processing time: ${endpointTime}ms`)
    console.log('📸 [DEBUG] ========== SCREENSHOT-PAGES ENDPOINT END ==========')

    res.json({
      success: true,
      urlHash,
      screenshots,
      metadata: {
        totalPages: numPages,
        totalHeight,
        viewportHeight,
        viewportWidth,
        pageTitle,
        finalUrl,
        processingTime: endpointTime
      },
      message: `Successfully captured ${numPages} page screenshots`
    })

  } catch (error) {
    const endpointTime = Date.now() - startTime
    console.error('❌ Screenshot-pages failed after', endpointTime, 'ms:', error)
    console.error('❌ Error details:', error instanceof Error ? {
      message: error.message,
      stack: error.stack
    } : error)
    
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
    })
  } finally {
    if (browser) {
      await browser.close()
      console.log('🔒 [DEBUG] Browser closed')
    }
  }
})

module.exports = router
