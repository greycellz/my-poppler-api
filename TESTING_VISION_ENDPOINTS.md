# Testing Vision API Endpoints

This document describes how to test the new Vision API optimization endpoints.

## Overview

Two new Railway endpoints have been added:
- `/api/analyze-images` - Analyzes multiple images (PDF pages)
- `/api/analyze-url` - Analyzes form URLs with screenshot splitting

## Test Types

### 1. Unit Tests (Jest)

Run automated unit tests with mocked dependencies:

```bash
npm run test:vision-endpoints
```

**What it tests:**
- Request validation
- Error handling
- Response parsing
- Image splitting logic
- Field merging/deduplication
- Timeout handling

**Note:** These tests use mocks and don't call actual OpenAI API.

---

### 2. Manual Integration Tests

Run integration tests against actual Railway backend:

```bash
npm run test:vision-manual
```

**Prerequisites:**
- Railway backend running (or set `RAILWAY_URL` env var)
- `OPENAI_API_KEY` set in environment
- Test images/URLs available

**What it tests:**
- Actual API calls to Railway endpoints
- Image compression
- Image splitting for tall screenshots
- Field extraction
- Error handling

**Configuration:**
```bash
export RAILWAY_URL=https://my-poppler-api-production.up.railway.app
export OPENAI_API_KEY=sk-...
export IMAGE_SPLIT_MAX_HEIGHT=4000  # Optional
export IMAGE_SPLIT_OVERLAP=200      # Optional
```

---

## Test Scenarios

### Test 1: Single Image Analysis
- Tests `/api/analyze-images` with one image
- Verifies compression, detail selection, field extraction

### Test 2: Multiple Images (Parallel)
- Tests `/api/analyze-images` with multiple images
- Verifies parallel processing
- Measures performance

### Test 3: URL Analysis (Normal)
- Tests `/api/analyze-url` with a form URL
- Verifies screenshot capture
- Tests normal (non-split) processing

### Test 4: Screenshot URL (Direct)
- Tests `/api/analyze-url` with direct screenshot URL
- Verifies processing without screenshot capture

### Test 5: Tall Screenshot (Splitting)
- Tests `/api/analyze-url` with tall screenshot (>4000px)
- Verifies image splitting
- Verifies field merging/deduplication

### Test 6: Error Handling
- Tests invalid requests
- Verifies proper error responses

---

## Running Tests Locally

### Prerequisites

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   export OPENAI_API_KEY=sk-...
   export RAILWAY_URL=http://localhost:3000  # For local testing
   ```

3. **Start Railway backend locally:**
   ```bash
   npm start
   ```

### Run Unit Tests

```bash
# Run all vision endpoint tests
npm run test:vision-endpoints

# Run with coverage
npm run test:coverage
```

### Run Integration Tests

```bash
# Run manual integration tests
npm run test:vision-manual
```

---

## Testing on Railway (Staging/Production)

### Setup

1. **Deploy to Railway:**
   - Push to `develop` branch
   - Railway auto-deploys from `develop`

2. **Set environment variables on Railway:**
   - `OPENAI_API_KEY` (required)
   - `IMAGE_SPLIT_MAX_HEIGHT` (optional, default: 4000)
   - `IMAGE_SPLIT_OVERLAP` (optional, default: 200)

3. **Get Railway URL:**
   - Check Railway dashboard for public URL
   - Usually: `https://my-poppler-api-production.up.railway.app`

### Run Tests

```bash
export RAILWAY_URL=https://my-poppler-api-production.up.railway.app
export OPENAI_API_KEY=sk-...
npm run test:vision-manual
```

---

## Testing with Feature Flag

### Vercel Configuration

1. **Set feature flag OFF (initial testing):**
   ```bash
   USE_RAILWAY_VISION=FALSE
   ```

2. **Test current implementation:**
   - Verify existing functionality still works
   - Test PDF upload flow
   - Test URL analysis flow

3. **Set feature flag ON:**
   ```bash
   USE_RAILWAY_VISION=TRUE
   RAILWAY_BACKEND_URL=https://my-poppler-api-production.up.railway.app
   ```

4. **Test new implementation:**
   - Test PDF upload flow (should use Railway)
   - Test URL analysis flow (should use Railway)
   - Verify fallback works if Railway fails

---

## Expected Results

### Successful Response (analyze-images)

```json
{
  "success": true,
  "fields": [
    {
      "label": "Field Name",
      "type": "text",
      "required": false,
      "pageNumber": 1
    }
  ],
  "imagesAnalyzed": 1
}
```

### Successful Response (analyze-url, split)

```json
{
  "success": true,
  "fields": [...],
  "wasSplit": true,
  "numSections": 3,
  "originalHeight": 5000,
  "splitThreshold": 4000
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "errorType": "TIMEOUT" | "TOKEN_LIMIT_EXCEEDED"
}
```

---

## Troubleshooting

### Test Failures

1. **"OPENAI_API_KEY not set"**
   - Set `OPENAI_API_KEY` environment variable

2. **"Failed to fetch image"**
   - Check image URL is accessible
   - Check network connectivity

3. **"Railway backend error"**
   - Verify Railway backend is running
   - Check Railway logs for errors
   - Verify `RAILWAY_URL` is correct

4. **"Timeout"**
   - Increase timeout values in `utils/timeout.js`
   - Check OpenAI API status
   - Verify image sizes aren't too large

### Common Issues

1. **Images not compressing:**
   - Check `sharp` is installed: `npm list sharp`
   - Check Railway logs for compression errors

2. **Splitting not working:**
   - Verify `IMAGE_SPLIT_MAX_HEIGHT` is set correctly
   - Check image height is actually > threshold
   - Review Railway logs for splitting errors

3. **Field deduplication issues:**
   - Check overlap is sufficient (default 200px)
   - Review deduplication logic in `utils/image-splitter.js`
   - Check Railway logs for merge operations

---

## Next Steps

After successful testing:

1. ✅ Verify all unit tests pass
2. ✅ Verify integration tests pass
3. ✅ Test with feature flag OFF (current implementation)
4. ✅ Test with feature flag ON (Railway backend)
5. ✅ Test fallback scenarios
6. ✅ Monitor Railway logs for errors
7. ✅ Enable feature flag in production

---

## Additional Resources

- [Implementation Plan](../chatterforms/IMPLEMENTATION_PLAN_FINAL.md)
- [Code Review](../chatterforms/CODE_REVIEW_FINAL.md)
- [Git Strategy](../chatterforms/GIT_STRATEGY.md)
