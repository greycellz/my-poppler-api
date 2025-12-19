/**
 * IP Geolocation Utility
 * 
 * Uses MaxMind GeoIP2 for IP-to-location mapping
 * Returns city, region (state), and country
 */

const geoip = require('@maxmind/geoip2-node');
const path = require('path');
const fs = require('fs');

let reader = null;

/**
 * Initialize the GeoIP2 reader
 * @returns {Promise<void>}
 */
async function initializeGeoIP() {
  if (reader) {
    return; // Already initialized
  }

  try {
    // Look for GeoLite2-City.mmdb file
    // In production, this should be downloaded from MaxMind or stored in GCS
    const dbPath = process.env.MAXMIND_DB_PATH || path.join(__dirname, '..', 'GeoLite2-City.mmdb');
    
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      reader = await geoip.Reader.openBuffer(buffer);
      console.log('✅ GeoIP2 database loaded');
    } else {
      // Note: Runtime download would require tar extraction which adds complexity
      // Better to download during Docker build or provide via MAXMIND_DB_PATH
      
      console.warn('⚠️  GeoLite2-City.mmdb not found. Geolocation will be disabled.');
      console.warn(`   Expected path: ${dbPath}`);
      console.warn('   Options:');
      console.warn('   1. Set MAXMIND_DB_PATH environment variable');
      console.warn('   2. Place GeoLite2-City.mmdb in project root');
      console.warn('   3. Set MAXMIND_LICENSE_KEY for automatic download');
      reader = null;
    }
  } catch (error) {
    console.error('❌ Error initializing GeoIP2:', error.message);
    reader = null;
  }
}

/**
 * Get location from IP address
 * @param {string} ipAddress - IP address to lookup
 * @returns {Promise<{city: string|null, region: string|null, country: string|null}>}
 */
async function getLocationFromIP(ipAddress) {
  // Initialize if needed
  await initializeGeoIP();

  if (!reader) {
    return { city: null, region: null, country: null };
  }

  // Skip localhost/private IPs
  if (!ipAddress || 
      ipAddress === '127.0.0.1' || 
      ipAddress === '::1' ||
      ipAddress.startsWith('192.168.') ||
      ipAddress.startsWith('10.') ||
      ipAddress.startsWith('172.16.') ||
      ipAddress.startsWith('172.17.') ||
      ipAddress.startsWith('172.18.') ||
      ipAddress.startsWith('172.19.') ||
      ipAddress.startsWith('172.20.') ||
      ipAddress.startsWith('172.21.') ||
      ipAddress.startsWith('172.22.') ||
      ipAddress.startsWith('172.23.') ||
      ipAddress.startsWith('172.24.') ||
      ipAddress.startsWith('172.25.') ||
      ipAddress.startsWith('172.26.') ||
      ipAddress.startsWith('172.27.') ||
      ipAddress.startsWith('172.28.') ||
      ipAddress.startsWith('172.29.') ||
      ipAddress.startsWith('172.30.') ||
      ipAddress.startsWith('172.31.')) {
    return { city: null, region: null, country: null };
  }

  try {
    const response = reader.city(ipAddress);
    
    return {
      city: response.city?.names?.en || null,
      region: response.subdivisions?.[0]?.names?.en || response.subdivisions?.[0]?.isoCode || null,
      country: response.country?.isoCode || null
    };
  } catch (error) {
    // Silently fail - geolocation is non-critical
    console.warn(`⚠️  Geolocation lookup failed for IP ${ipAddress}:`, error.message);
    return { city: null, region: null, country: null };
  }
}

module.exports = {
  initializeGeoIP,
  getLocationFromIP
};
