#!/bin/bash
# Phase 2 Test Configuration Template
# Copy this file to test-phase2-config-local.sh and fill in real values
# Add test-phase2-config-local.sh to .gitignore

# Backend URL
export BACKEND_URL="https://my-poppler-api-dev.up.railway.app"

# User A (form owner)
export USER_A_TOKEN="REPLACE_WITH_TOKEN"  # eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
export USER_A_ID="REPLACE_WITH_USER_ID"   # 2etjOnwo56ebBrBLQDl3

# User B (different user)
export USER_B_TOKEN="REPLACE_WITH_TOKEN"  # eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
export USER_B_ID="REPLACE_WITH_USER_ID"   # Another user ID

# Test forms
export FORM_A_ID="REPLACE_WITH_FORM_ID"         # form_xxx - Owned by User A
export FORM_B_ID="REPLACE_WITH_FORM_ID"         # form_yyy - Owned by User B
export PUBLISHED_FORM_ID="REPLACE_WITH_FORM_ID" # form_zzz - Published form
export DRAFT_FORM_ID="REPLACE_WITH_FORM_ID"     # form_www - Draft form (User A)

# Test data
export FIELD_ID="REPLACE_WITH_FIELD_ID"   # field1
export IMAGE_ID="REPLACE_WITH_IMAGE_ID"   # img_xxx

# Instructions:
# 1. Copy: cp test-phase2-config.sh test-phase2-config-local.sh
# 2. Edit test-phase2-config-local.sh with real values
# 3. Run tests: ./test-phase2-endpoints-after.sh


