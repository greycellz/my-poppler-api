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
COLLECTIONS="${2:-users,forms,submissions,sessions,email_verification_tokens,user_calendly_accounts,calendar_fields}"

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

