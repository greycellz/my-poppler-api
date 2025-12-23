/**
 * Cross-Field Analytics Test Data Generator
 * 
 * Creates a comprehensive test form with all field types and generates
 * 25-30 submissions with realistic data patterns for cross-field testing.
 * 
 * Usage: node scripts/cross-field-test-data.js [userId]
 */

const { Firestore } = require('@google-cloud/firestore');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

function getCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      console.log('✅ GCP credentials loaded from environment variable');
      return credentials;
    } catch (error) {
      console.error('❌ Error parsing credentials from environment:', error.message);
      throw error;
    }
  } else {
    const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
    if (fs.existsSync(keyPath)) {
      console.log('✅ GCP credentials loaded from key file');
      return keyPath;
    } else {
      throw new Error('GCP credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or place chatterforms-app-key.json in project root.');
    }
  }
}

function initializeFirestore() {
  const credentials = getCredentials();
  const firestore = new Firestore({
    projectId: 'chatterforms',
    credentials: typeof credentials === 'string' ? undefined : credentials,
    keyFilename: typeof credentials === 'string' ? credentials : undefined,
  });
  return firestore;
}

function getCollectionName(collectionName) {
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || 'dev';
  if (env === 'dev') {
    return `dev_${collectionName}`;
  } else if (env === 'staging') {
    return `staging_${collectionName}`;
  }
  return collectionName;
}

/**
 * Create test form with all field types
 */
async function createTestForm(firestore, userId) {
  const formId = `form_${Date.now()}_${uuidv4().substring(0, 8)}`;
  const baseTimestamp = Date.now(); // Use same timestamp for all field IDs
  
  const fields = [
    // Numeric Fields
    {
      id: `field_${baseTimestamp}_1`,
      type: 'number',
      label: 'Age',
      required: false,
      placeholder: 'Enter your age'
    },
    {
      id: `field_${baseTimestamp}_2`,
      type: 'rating',
      label: 'Rating',
      required: false,
      max: 5
    },
    {
      id: `field_${baseTimestamp}_3`,
      type: 'number',
      label: 'Price',
      required: false,
      placeholder: 'Enter price'
    },
    {
      id: `field_${baseTimestamp}_4`,
      type: 'number',
      label: 'Quantity',
      required: false,
      placeholder: 'Enter quantity'
    },
    // Categorical Fields
    {
      id: `field_${baseTimestamp}_5`,
      type: 'select',
      label: 'Movie Genre',
      required: false,
      options: ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi']
    },
    {
      id: `field_${baseTimestamp}_6`,
      type: 'radio',
      label: 'Preferred Platform',
      required: false,
      options: ['Netflix', 'Hulu', 'Disney+', 'Prime Video']
    },
    {
      id: `field_${baseTimestamp}_7`,
      type: 'select',
      label: 'Device Type',
      required: false,
      options: ['Mobile', 'Tablet', 'Desktop', 'TV']
    },
    {
      id: `field_${baseTimestamp}_8`,
      type: 'select',
      label: 'Subscription Tier',
      required: false,
      options: ['Basic', 'Standard', 'Premium']
    },
    // Date Fields
    {
      id: `field_${baseTimestamp}_9`,
      type: 'date',
      label: 'Watch Date',
      required: false
    },
    {
      id: `field_${baseTimestamp}_10`,
      type: 'date',
      label: 'Subscription Start',
      required: false
    },
    // Text Fields
    {
      id: `field_${baseTimestamp}_11`,
      type: 'text',
      label: 'Movie Title',
      required: false,
      placeholder: 'Enter movie title'
    },
    {
      id: `field_${baseTimestamp}_12`,
      type: 'textarea',
      label: 'Review',
      required: false,
      placeholder: 'Write your review'
    },
    // Boolean Field
    {
      id: `field_${baseTimestamp}_13`,
      type: 'checkbox',
      label: 'Would Recommend',
      required: false
    },
    // Email Field
    {
      id: `field_${baseTimestamp}_14`,
      type: 'email',
      label: 'Email Address',
      required: false,
      placeholder: 'Enter your email'
    }
  ];

  const formData = {
    form_id: formId,
    user_id: userId,
    title: 'Cross-Field Analytics Test Form',
    description: 'Comprehensive test form for cross-field analytics validation',
    fields: fields, // Direct fields for compatibility
    structure: {
      fields: fields // Also in structure for analytics endpoint
    },
    created_at: Firestore.Timestamp.now(),
    updated_at: Firestore.Timestamp.now(),
    is_anonymous: false,
    allow_multiple_submissions: true
  };

  await firestore
    .collection(getCollectionName('forms'))
    .doc(formId)
    .set(formData);

  console.log(`✅ Created test form: ${formId}`);
  console.log(`   Fields: ${fields.length}`);
  
  return { formId, fields };
}

/**
 * Generate realistic test submissions with patterns
 */
function generateSubmissions(formId, fields, count = 28) {
  const submissions = [];
  const now = new Date();
  
  // Field IDs for easy access
  const fieldIds = {
    age: fields.find(f => f.label === 'Age')?.id,
    rating: fields.find(f => f.label === 'Rating')?.id,
    price: fields.find(f => f.label === 'Price')?.id,
    quantity: fields.find(f => f.label === 'Quantity')?.id,
    genre: fields.find(f => f.label === 'Movie Genre')?.id,
    platform: fields.find(f => f.label === 'Preferred Platform')?.id,
    device: fields.find(f => f.label === 'Device Type')?.id,
    tier: fields.find(f => f.label === 'Subscription Tier')?.id,
    watchDate: fields.find(f => f.label === 'Watch Date')?.id,
    subStart: fields.find(f => f.label === 'Subscription Start')?.id,
    title: fields.find(f => f.label === 'Movie Title')?.id,
    review: fields.find(f => f.label === 'Review')?.id,
    recommend: fields.find(f => f.label === 'Would Recommend')?.id,
    email: fields.find(f => f.label === 'Email Address')?.id
  };

  const genres = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi'];
  const platforms = ['Netflix', 'Hulu', 'Disney+', 'Prime Video'];
  const devices = ['Mobile', 'Tablet', 'Desktop', 'TV'];
  const tiers = ['Basic', 'Standard', 'Premium'];
  const movieTitles = ['Inception', 'The Matrix', 'Interstellar', 'Blade Runner', 'Mad Max', 'The Dark Knight', 'Pulp Fiction', 'Fight Club', 'The Shawshank Redemption', 'Forrest Gump'];
  
  // Generate submissions with patterns
  for (let i = 0; i < count; i++) {
    const submissionData = {};
    
    // Age: 18-80, slightly weighted toward younger
    const age = Math.floor(Math.random() * 62) + 18;
    if (fieldIds.age) submissionData[fieldIds.age] = age;
    
    // Rating: 1-5, with patterns
    let rating;
    if (i < 6) {
      // First 6: High ratings (4-5)
      rating = Math.random() < 0.7 ? 5 : 4;
    } else if (i < 12) {
      // Next 6: Medium ratings (3-4)
      rating = Math.random() < 0.5 ? 4 : 3;
    } else if (i < 18) {
      // Next 6: Lower ratings (2-3)
      rating = Math.random() < 0.5 ? 3 : 2;
    } else {
      // Rest: Mixed
      rating = Math.floor(Math.random() * 5) + 1;
    }
    if (fieldIds.rating) submissionData[fieldIds.rating] = rating;
    
    // Price: $10-$1000, correlated with rating (higher rating = higher price)
    const basePrice = 10 + (rating - 1) * 50;
    const price = basePrice + Math.random() * 200;
    if (fieldIds.price) submissionData[fieldIds.price] = Math.round(price);
    
    // Quantity: 1-100, some correlation with price
    const quantity = Math.floor(Math.random() * 100) + 1;
    if (fieldIds.quantity) submissionData[fieldIds.quantity] = quantity;
    
    // Genre: Action gets higher ratings
    let genre;
    if (rating >= 4) {
      genre = Math.random() < 0.4 ? 'Action' : genres[Math.floor(Math.random() * genres.length)];
    } else {
      genre = genres[Math.floor(Math.random() * genres.length)];
    }
    if (fieldIds.genre) submissionData[fieldIds.genre] = genre;
    
    // Platform: Distributed
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    if (fieldIds.platform) submissionData[fieldIds.platform] = platform;
    
    // Device: Desktop/TV for higher ratings
    let device;
    if (rating >= 4) {
      device = Math.random() < 0.6 ? (Math.random() < 0.5 ? 'Desktop' : 'TV') : devices[Math.floor(Math.random() * devices.length)];
    } else {
      device = devices[Math.floor(Math.random() * devices.length)];
    }
    if (fieldIds.device) submissionData[fieldIds.device] = device;
    
    // Tier: Premium for higher ratings
    let tier;
    if (rating >= 4) {
      tier = Math.random() < 0.5 ? 'Premium' : tiers[Math.floor(Math.random() * tiers.length)];
    } else {
      tier = tiers[Math.floor(Math.random() * tiers.length)];
    }
    if (fieldIds.tier) submissionData[fieldIds.tier] = tier;
    
    // Watch Date: Last 6 months, more recent for higher ratings
    const daysAgo = rating >= 4 
      ? Math.floor(Math.random() * 90) // Last 3 months
      : Math.floor(Math.random() * 180); // Last 6 months
    const watchDate = new Date(now);
    watchDate.setDate(watchDate.getDate() - daysAgo);
    if (fieldIds.watchDate) submissionData[fieldIds.watchDate] = watchDate.toISOString().split('T')[0];
    
    // Subscription Start: Last 2 years
    const subDaysAgo = Math.floor(Math.random() * 730);
    const subStart = new Date(now);
    subStart.setDate(subStart.getDate() - subDaysAgo);
    if (fieldIds.subStart) submissionData[fieldIds.subStart] = subStart.toISOString().split('T')[0];
    
    // Movie Title: Random
    const title = movieTitles[Math.floor(Math.random() * movieTitles.length)];
    if (fieldIds.title) submissionData[fieldIds.title] = title;
    
    // Review: Short text
    const reviews = ['Great movie!', 'Loved it', 'Not bad', 'Could be better', 'Amazing!', 'Meh', 'Excellent'];
    if (fieldIds.review) submissionData[fieldIds.review] = reviews[Math.floor(Math.random() * reviews.length)];
    
    // Would Recommend: Correlated with rating
    const recommend = rating >= 4 ? 'Yes' : (rating <= 2 ? 'No' : (Math.random() < 0.5 ? 'Yes' : 'No'));
    if (fieldIds.recommend) submissionData[fieldIds.recommend] = recommend;
    
    // Email: Random
    if (fieldIds.email) submissionData[fieldIds.email] = `test${i}@example.com`;
    
    // Create submission timestamp (spread over last 30 days)
    const submissionDaysAgo = Math.floor(Math.random() * 30);
    const timestamp = new Date(now);
    timestamp.setDate(timestamp.getDate() - submissionDaysAgo);
    
    submissions.push({
      submission_id: `sub_${Date.now()}_${i}_${uuidv4().substring(0, 8)}`,
      form_id: formId,
      submission_data: submissionData,
      timestamp: Firestore.Timestamp.fromDate(timestamp),
      ip_address: `192.168.1.${i % 255}`,
      user_agent: 'Mozilla/5.0 (Test Browser)',
      created_at: Firestore.Timestamp.fromDate(timestamp)
    });
  }
  
  return submissions;
}

/**
 * Get userId from email
 */
async function getUserIdFromEmail(firestore, email) {
  const usersSnapshot = await firestore
    .collection(getCollectionName('users'))
    .where('email', '==', email)
    .limit(1)
    .get();
  
  if (usersSnapshot.empty) {
    throw new Error(`User with email ${email} not found`);
  }
  
  return usersSnapshot.docs[0].id;
}

/**
 * Main execution
 */
async function main() {
  const emailOrUserId = process.argv[2];
  let userId;
  
  console.log('🚀 Starting Cross-Field Analytics Test Data Generation');
  console.log(`   Environment: ${process.env.RAILWAY_ENVIRONMENT_NAME || 'dev'}`);
  
  const firestore = initializeFirestore();
  
  // If email provided, look up userId
  if (emailOrUserId && emailOrUserId.includes('@')) {
    console.log(`   Looking up user by email: ${emailOrUserId}`);
    userId = await getUserIdFromEmail(firestore, emailOrUserId);
    console.log(`   Found User ID: ${userId}`);
  } else {
    userId = emailOrUserId || 'test_user_cross_field';
    console.log(`   Using User ID: ${userId}`);
  }
  
  try {
    // Create form
    const { formId, fields } = await createTestForm(firestore, userId);
    
    // Generate submissions
    console.log('\n📊 Generating test submissions...');
    const submissions = generateSubmissions(formId, fields, 28);
    
    // Add submissions to Firestore
    const submissionsCollection = firestore.collection(getCollectionName('submissions'));
    const batch = firestore.batch();
    
    submissions.forEach((submission, index) => {
      const docRef = submissionsCollection.doc(submission.submission_id);
      batch.set(docRef, submission);
      
      if ((index + 1) % 10 === 0) {
        console.log(`   Added ${index + 1}/${submissions.length} submissions...`);
      }
    });
    
    await batch.commit();
    console.log(`✅ Added ${submissions.length} submissions`);
    
    // Update form analytics
    console.log('\n📈 Updating form analytics...');
    const formRef = firestore.collection(getCollectionName('forms')).doc(formId);
    await formRef.update({
      total_submissions: submissions.length,
      updated_at: Firestore.Timestamp.now()
    });
    
    console.log('\n✅ Test data generation complete!');
    console.log(`\n📋 Form ID: ${formId}`);
    console.log(`   View in frontend: /submissions/${formId}?tab=analytics`);
    console.log(`   Cross-Field tab: /submissions/${formId}?tab=analytics&subtab=cross-field`);
    console.log(`\n🔍 Test combinations to verify:`);
    console.log(`   - Number vs Number: Age / Rating, Price / Rating`);
    console.log(`   - Category vs Number: Movie Genre / Rating, Device Type / Price`);
    console.log(`   - Category vs Category: Movie Genre / Preferred Platform`);
    console.log(`   - Date vs Number: Watch Date / Rating`);
    console.log(`   - Date vs Category: Watch Date / Movie Genre`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createTestForm, generateSubmissions };
