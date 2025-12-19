# Geolocation Setup Guide

## Overview
Geographic analytics uses MaxMind GeoLite2 database to map IP addresses to city/region/country locations.

## Step 1: Install Package
The `@maxmind/geoip2-node` package is already installed (or run `npm install @maxmind/geoip2-node`).

## Step 2: Get GeoLite2-City.mmdb Database File

### Option A: Download from MaxMind (Recommended)

1. **Create a free MaxMind account:**
   - Visit: https://www.maxmind.com/en/geolite2/signup
   - Register for a free account

2. **Generate a license key:**
   - After logging in, go to your account dashboard
   - Navigate to "GeoIP2 / GeoLite2" section
   - Generate a license key (required for downloads)

3. **Download the database:**
   - Go to: https://www.maxmind.com/en/accounts/current
   - Under "GeoIP2 / GeoLite2", click "Download Files"
   - Download "GeoLite2 City" database (binary format, .tar.gz)

4. **Extract and place the file:**
   ```bash
   # Extract the downloaded file
   tar -xzf GeoLite2-City.tar.gz
   
   # Copy GeoLite2-City.mmdb to project root
   cp GeoLite2-City_*/GeoLite2-City.mmdb /Users/namratajha/my-poppler-api/
   ```

### Option B: Use Environment Variable

If you want to store the database elsewhere:

```bash
export MAXMIND_DB_PATH=/path/to/GeoLite2-City.mmdb
```

## Step 3: Update BigQuery Schema

Run the script to add city/region columns to the form_views table:

```bash
node scripts/add-geo-columns-to-form-views.js
```

## Step 4: Test

The geolocation utility will automatically:
- Load the database on first use
- Perform IP lookups for new views
- Gracefully handle missing database (views stored without geo data)

## Railway Deployment

### Option 1: Download During Docker Build (Recommended)

The Dockerfile automatically downloads the database if `MAXMIND_LICENSE_KEY` is provided as a build argument:

1. **Set build argument in Railway:**
   - Go to Railway Dashboard → Your Project → Settings → Build
   - Add build argument: `MAXMIND_LICENSE_KEY=your_license_key_here`
   - Railway will use this during Docker build to download the database

2. **Alternative: Set as environment variable:**
   - Railway Dashboard → Variables
   - Add: `MAXMIND_LICENSE_KEY=your_license_key_here`
   - Note: Railway may not pass env vars as build args automatically, so build arg is preferred

### Option 2: Manual Upload (If build arg doesn't work)

If Railway doesn't support build args easily:

1. Download the database locally (see Step 2 above)
2. Upload `GeoLite2-City.mmdb` to Railway's file system via Railway CLI or dashboard
3. Set `MAXMIND_DB_PATH` environment variable to point to the file location

### Option 3: Store in GCS and Download at Startup

For production, consider storing the database in Google Cloud Storage and downloading it at application startup.

## Notes

- **Free tier**: MaxMind GeoLite2 is free but requires account registration
- **Database updates**: MaxMind updates databases regularly. Consider setting up automated downloads.
- **Non-blocking**: If the database is missing, view tracking still works (just without geo data)
- **File size**: The database is ~60MB, so it's not included in git
- **Railway**: The Dockerfile will download it during build if `MAXMIND_LICENSE_KEY` build arg is set

## Verification

After setup, check logs when tracking a view:
- ✅ Should see: "✅ GeoIP2 database loaded"
- ✅ Views should include city/region/country in BigQuery
