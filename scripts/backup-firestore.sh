#!/bin/bash

# Firestore Backup Script
# Exports Firestore collections to Cloud Storage
# Usage: ./backup-firestore.sh [collection-ids] [output-bucket]

set -e  # Exit on error

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-chatterforms}"
BUCKET_NAME="${BACKUP_BUCKET:-chatterforms-backups-us-central1}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_URI="gs://${BUCKET_NAME}/firestore-backups/${TIMESTAMP}"

# Default collections to backup (can be overridden)
# Includes all 16 collections with dev_ prefix (after migration)
# For production, use non-prefixed names; for staging, use staging_ prefix
COLLECTIONS="${1:-dev_users,dev_forms,dev_submissions,dev_anonymousSessions,dev_baa-agreements,dev_emailVerificationTokens,dev_passwordResetTokens,dev_user_logos,dev_form_images,dev_payment_fields,dev_user_stripe_accounts,dev_onboarding_analytics,dev_help_articles,dev_calendar_fields,dev_calendar_bookings,dev_user_calendly_accounts}"

echo "🔄 Starting Firestore backup..."
echo "📋 Project: ${PROJECT_ID}"
echo "📦 Bucket: ${BUCKET_NAME}"
echo "📁 Collections: ${COLLECTIONS}"
echo "📍 Output: ${OUTPUT_URI}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI not found. Please install Google Cloud SDK."
    exit 1
fi

# Check if bucket exists
if ! gsutil ls -b "gs://${BUCKET_NAME}" &> /dev/null; then
    echo "⚠️  Bucket ${BUCKET_NAME} does not exist. Creating..."
    gsutil mb -l us-central1 "gs://${BUCKET_NAME}"
    echo "✅ Bucket created"
fi

# Export Firestore collections
echo "📤 Exporting Firestore collections..."
gcloud firestore export "${OUTPUT_URI}" \
  --project="${PROJECT_ID}" \
  --collection-ids="${COLLECTIONS}"

if [ $? -eq 0 ]; then
    echo "✅ Backup completed successfully!"
    echo "📍 Backup location: ${OUTPUT_URI}"
    echo "📊 Backup size:"
    gsutil du -sh "${OUTPUT_URI}"
    
    # List recent backups
    echo ""
    echo "📋 Recent backups:"
    gsutil ls -l "gs://${BUCKET_NAME}/firestore-backups/" | tail -5
else
    echo "❌ Backup failed!"
    exit 1
fi

