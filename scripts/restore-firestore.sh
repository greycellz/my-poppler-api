#!/bin/bash

# Firestore Restore Script
# Restores Firestore from Cloud Storage backup
# Usage: ./restore-firestore.sh [backup-uri] [collection-ids]

set -e  # Exit on error

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-chatterforms}"

# Check arguments
if [ -z "$1" ]; then
    echo "❌ Error: Backup URI required"
    echo "Usage: ./restore-firestore.sh gs://bucket/path/to/backup [collection-ids]"
    echo ""
    echo "Available backups:"
    gsutil ls "gs://chatterforms-backups-us-central1/firestore-backups/" 2>/dev/null | tail -10
    exit 1
fi

BACKUP_URI="$1"
# Default collections to restore (with dev_ prefix after migration)
# For production, use non-prefixed names; for staging, use staging_ prefix
COLLECTIONS="${2:-dev_users,dev_forms,dev_submissions,dev_anonymousSessions,dev_baa-agreements,dev_emailVerificationTokens,dev_passwordResetTokens,dev_user_logos,dev_form_images,dev_payment_fields,dev_user_stripe_accounts,dev_onboarding_analytics,dev_help_articles,dev_calendar_fields,dev_calendar_bookings,dev_user_calendly_accounts}"

echo "⚠️  WARNING: This will restore Firestore data!"
echo "📋 Project: ${PROJECT_ID}"
echo "📍 Backup: ${BACKUP_URI}"
echo "📁 Collections: ${COLLECTIONS}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Restore cancelled"
    exit 1
fi

# Check if backup exists
if ! gsutil ls "${BACKUP_URI}" &> /dev/null; then
    echo "❌ Error: Backup not found at ${BACKUP_URI}"
    exit 1
fi

# Restore Firestore
echo "🔄 Restoring Firestore from backup..."
if [ -n "$2" ]; then
    # Restore specific collections
    echo "📁 Restoring collections: ${COLLECTIONS}"
    gcloud firestore import "${BACKUP_URI}" \
      --project="${PROJECT_ID}" \
      --collection-ids="${COLLECTIONS}"
else
    # Restore all collections
    echo "📁 Restoring all collections from backup"
    gcloud firestore import "${BACKUP_URI}" \
      --project="${PROJECT_ID}"
fi

if [ $? -eq 0 ]; then
    echo "✅ Restore completed successfully!"
    echo "⚠️  Note: Restore may take a few minutes to propagate"
else
    echo "❌ Restore failed!"
    exit 1
fi

