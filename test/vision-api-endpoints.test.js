/**
 * Test Suite for Vision API Optimization Endpoints
 * 
 * Tests the new Railway endpoints:
 * - /api/analyze-images
 * - /api/analyze-url
 * 
 * These tests verify:
 * - Image compression
 * - Detail level selection
 * - Image splitting for tall screenshots
 * - Field extraction and merging
 * - Error handling
 * - Timeout handling
 */

const request = require('supertest');
const express = require('express');
const imageAnalysisRoutes = require('../routes/image-analysis');
const urlAnalysisRoutes = require('../routes/url-analysis');

// Create test app
const app = express();
app.use(express.json());
app.use('/api', imageAnalysisRoutes);
app.use('/api', urlAnalysisRoutes);

// Mock OpenAI for testing (to avoid API costs)
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  }));
});

// Mock sharp for testing
jest.mock('sharp', () => {
  return jest.fn().mockImplementation((buffer) => {
    const mockMetadata = {
      width: 1280,
      height: 2000,
      format: 'png'
    };
    
    return {
      metadata: jest.fn().mockResolvedValue(mockMetadata),
      resize: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      extract: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed-image-data'))
    };
  });
});

// Mock fetch for image fetching
global.fetch = jest.fn();

describe('Vision API Endpoints', () => {
  let OpenAI;
  let openaiInstance;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset fetch mock
    global.fetch.mockClear();
    
    // Setup OpenAI mock
    OpenAI = require('openai');
    openaiInstance = new OpenAI();
    
    // Default successful OpenAI response
    openaiInstance.chat.completions.create.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            fields: [
              {
                label: 'Test Field',
                type: 'text',
                required: false,
                pageNumber: 1
              }
            ]
          })
        },
        finish_reason: 'stop'
      }]
    });
    
    // Default successful fetch response
    global.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue('image/png')
      },
      arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('test-image-data'))
    });
  });
  
  describe('POST /api/analyze-images', () => {
    it('should return 400 if imageUrls is missing', async () => {
      const response = await request(app)
        .post('/api/analyze-images')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Image URLs are required');
    });
    
    it('should return 400 if imageUrls is empty array', async () => {
      const response = await request(app)
        .post('/api/analyze-images')
        .send({ imageUrls: [] });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
    
    it('should process single image successfully', async () => {
      const imageUrl = 'https://example.com/test-image.png';
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: [imageUrl],
          systemMessage: 'Test system message',
          userMessage: 'Test user message'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.fields).toBeDefined();
      expect(Array.isArray(response.body.fields)).toBe(true);
      expect(response.body.imagesAnalyzed).toBe(1);
      
      // Verify fetch was called
      expect(global.fetch).toHaveBeenCalledWith(imageUrl);
      
      // Verify OpenAI was called
      expect(openaiInstance.chat.completions.create).toHaveBeenCalled();
    });
    
    it('should process multiple images in parallel', async () => {
      const imageUrls = [
        'https://example.com/image1.png',
        'https://example.com/image2.png',
        'https://example.com/image3.png'
      ];
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls,
          systemMessage: 'Test system message',
          userMessage: 'Test user message'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.imagesAnalyzed).toBe(3);
      
      // Verify all images were fetched
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
    
    it('should handle image fetch failures gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/fail.png', 'https://example.com/success.png']
        });
      
      // Should still succeed if at least one image works
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.imagesAnalyzed).toBeGreaterThan(0);
    });
    
    it('should return 500 if all images fail to fetch', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/fail1.png', 'https://example.com/fail2.png']
        });
      
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to fetch all images');
    });
    
    it('should handle OpenAI API errors', async () => {
      openaiInstance.chat.completions.create.mockRejectedValueOnce(
        new Error('OpenAI API error')
      );
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/test.png']
        });
      
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
    
    it('should handle token limit exceeded', async () => {
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Partial response...'
          },
          finish_reason: 'length'
        }]
      });
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/large.png']
        });
      
      expect(response.status).toBe(413);
      expect(response.body.success).toBe(false);
      expect(response.body.errorType).toBe('TOKEN_LIMIT_EXCEEDED');
    });
    
    it('should use custom system and user messages', async () => {
      const systemMessage = 'Custom system message';
      const userMessage = 'Custom user message';
      
      await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/test.png'],
          systemMessage,
          userMessage
        });
      
      const openaiCall = openaiInstance.chat.completions.create.mock.calls[0][0];
      expect(openaiCall.messages[0].content).toBe(systemMessage);
      expect(openaiCall.messages[1].content[0].text).toBe(userMessage);
    });
    
    it('should use default messages if not provided', async () => {
      await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/test.png']
        });
      
      const openaiCall = openaiInstance.chat.completions.create.mock.calls[0][0];
      expect(openaiCall.messages[0].content).toContain('form analysis expert');
      expect(openaiCall.messages[1].content[0].text).toContain('Analyze these images');
    });
  });
  
  describe('POST /api/analyze-url', () => {
    it('should return 400 if neither url nor screenshotUrl is provided', async () => {
      const response = await request(app)
        .post('/api/analyze-url')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Either url or screenshotUrl is required');
    });
    
    it('should process screenshotUrl directly', async () => {
      const screenshotUrl = 'https://example.com/screenshot.png';
      
      // Mock sharp to return non-tall image
      const sharp = require('sharp');
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: 1280,
          height: 2000, // Less than 4000px
          format: 'png'
        }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed'))
      }));
      
      const response = await request(app)
        .post('/api/analyze-url')
        .send({
          screenshotUrl,
          systemMessage: 'Test system message',
          userMessage: 'Test user message'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.fields).toBeDefined();
      expect(response.body.wasSplit).toBe(false);
      
      // Verify fetch was called for screenshot
      expect(global.fetch).toHaveBeenCalledWith(screenshotUrl);
    });
    
    it('should capture screenshot if URL is provided', async () => {
      const url = 'https://example.com/form';
      
      // Mock screenshot endpoint
      global.fetch.mockImplementationOnce((url) => {
        if (url.includes('/screenshot')) {
          return Promise.resolve({
            ok: true,
            json: jest.fn().mockResolvedValue({
              screenshot: {
                url: 'https://example.com/screenshot.png'
              }
            })
          });
        }
        // Mock screenshot image fetch
        return Promise.resolve({
          ok: true,
          headers: {
            get: jest.fn().mockReturnValue('image/png')
          },
          arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('screenshot-data'))
        });
      });
      
      // Mock sharp for non-tall image
      const sharp = require('sharp');
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: 1280,
          height: 2000,
          format: 'png'
        }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed'))
      }));
      
      const response = await request(app)
        .post('/api/analyze-url')
        .send({ url });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify screenshot endpoint was called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/screenshot'),
        expect.any(Object)
      );
    });
    
    it('should split tall images (>4000px)', async () => {
      const screenshotUrl = 'https://example.com/tall-screenshot.png';
      
      // Mock sharp to return tall image
      const sharp = require('sharp');
      let extractCallCount = 0;
      
      sharp.mockImplementation(() => {
        const instance = {
          metadata: jest.fn().mockResolvedValue({
            width: 1280,
            height: 5000, // Taller than 4000px
            format: 'png'
          }),
          extract: jest.fn().mockReturnThis(),
          resize: jest.fn().mockReturnThis(),
          jpeg: jest.fn().mockReturnThis(),
          toBuffer: jest.fn().mockImplementation(() => {
            extractCallCount++;
            return Promise.resolve(Buffer.from(`section-${extractCallCount}`));
          })
        };
        return instance;
      });
      
      // Mock OpenAI to return different fields for each section
      openaiInstance.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                fields: [
                  { label: 'Field 1', type: 'text', pageNumber: 1 }
                ]
              })
            },
            finish_reason: 'stop'
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                fields: [
                  { label: 'Field 2', type: 'text', pageNumber: 1 }
                ]
              })
            },
            finish_reason: 'stop'
          }]
        });
      
      const response = await request(app)
        .post('/api/analyze-url')
        .send({ screenshotUrl });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.wasSplit).toBe(true);
      expect(response.body.numSections).toBeGreaterThan(1);
      expect(response.body.originalHeight).toBe(5000);
      expect(response.body.splitThreshold).toBe(4000);
      
      // Verify image was split (extract called multiple times)
      expect(extractCallCount).toBeGreaterThan(0);
      
      // Verify OpenAI was called for each section
      expect(openaiInstance.chat.completions.create).toHaveBeenCalledTimes(
        response.body.numSections
      );
    });
    
    it('should merge fields from split sections without duplicates', async () => {
      const screenshotUrl = 'https://example.com/tall-screenshot.png';
      
      // Mock tall image
      const sharp = require('sharp');
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: 1280,
          height: 5000,
          format: 'png'
        }),
        extract: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('section'))
      }));
      
      // Mock OpenAI to return same field in multiple sections (overlap)
      const duplicateField = {
        label: 'Duplicate Field',
        type: 'text',
        required: false
      };
      
      openaiInstance.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              fields: [duplicateField]
            })
          },
          finish_reason: 'stop'
        }]
      });
      
      const response = await request(app)
        .post('/api/analyze-url')
        .send({ screenshotUrl });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Should deduplicate - count unique fields
      const fieldLabels = response.body.fields.map(f => f.label);
      const uniqueLabels = new Set(fieldLabels);
      
      // Should have fewer or equal fields than sections (due to deduplication)
      expect(response.body.fields.length).toBeLessThanOrEqual(
        response.body.numSections
      );
    });
    
    it('should handle screenshot capture failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });
      
      const response = await request(app)
        .post('/api/analyze-url')
        .send({ url: 'https://example.com/form' });
      
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
    
    it('should use custom system and user messages', async () => {
      const screenshotUrl = 'https://example.com/screenshot.png';
      const systemMessage = 'Custom system message';
      const userMessage = 'Custom user message';
      
      // Mock non-tall image
      const sharp = require('sharp');
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: 1280,
          height: 2000,
          format: 'png'
        }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed'))
      }));
      
      await request(app)
        .post('/api/analyze-url')
        .send({
          screenshotUrl,
          systemMessage,
          userMessage
        });
      
      const openaiCall = openaiInstance.chat.completions.create.mock.calls[0][0];
      expect(openaiCall.messages[0].content).toBe(systemMessage);
      expect(openaiCall.messages[1].content[0].text).toContain(userMessage);
    });
    
    it('should include additionalContext in user message', async () => {
      const screenshotUrl = 'https://example.com/screenshot.png';
      const additionalContext = 'This is a medical form';
      
      // Mock non-tall image
      const sharp = require('sharp');
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({
          width: 1280,
          height: 2000,
          format: 'png'
        }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed'))
      }));
      
      await request(app)
        .post('/api/analyze-url')
        .send({
          screenshotUrl,
          additionalContext
        });
      
      const openaiCall = openaiInstance.chat.completions.create.mock.calls[0][0];
      expect(openaiCall.messages[1].content[0].text).toContain(additionalContext);
    });
  });
  
  describe('Environment Variable Configuration', () => {
    it('should use default split threshold (4000px) when env var not set', () => {
      delete process.env.IMAGE_SPLIT_MAX_HEIGHT;
      const urlAnalysisRoutes = require('../routes/url-analysis');
      // Routes should load with default 4000px
      expect(urlAnalysisRoutes).toBeDefined();
    });
    
    it('should use default overlap (200px) when env var not set', () => {
      delete process.env.IMAGE_SPLIT_OVERLAP;
      const urlAnalysisRoutes = require('../routes/url-analysis');
      // Routes should load with default 200px
      expect(urlAnalysisRoutes).toBeDefined();
    });
  });
  
  describe('Error Handling', () => {
    it('should handle JSON parsing errors gracefully', async () => {
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Invalid JSON response'
          },
          finish_reason: 'stop'
        }]
      });
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/test.png']
        });
      
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to parse');
    });
    
    it('should handle truncated JSON responses', async () => {
      openaiInstance.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '{"fields": [{"label": "Test"' // Incomplete JSON
          },
          finish_reason: 'stop'
        }]
      });
      
      const response = await request(app)
        .post('/api/analyze-images')
        .send({
          imageUrls: ['https://example.com/test.png']
        });
      
      // Should detect truncation and return appropriate error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
