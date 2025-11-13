#!/usr/bin/env node

/**
 * Script to update a user's onboarding level to a specific level
 * This marks all tasks up to that level as completed
 * 
 * Usage:
 *   node scripts/update-onboarding-level.js <email> <level>
 *   node scripts/update-onboarding-level.js jha.abhishek@gmail.com 4
 *   node scripts/update-onboarding-level.js user@example.com 0  (resets all tasks)
 */

const path = require('path');
const fs = require('fs');

// Set up credentials for local execution if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const keyPath = path.join(__dirname, '..', 'chatterforms-app-key.json');
  if (fs.existsSync(keyPath)) {
    // Read the credentials file and set it as JSON string
    const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(creds);
  }
}

const GCPClient = require('../gcp-client');
const validator = require('validator');

// Define tasks per level
const tasksPerLevel = {
  1: [
    { id: 'create-form', name: 'Chat with AI to create a form', reward: 'Form Creator Badge' },
    { id: 'publish-form', name: 'Publish the form', reward: 'Publisher Badge' }
  ],
  2: [
    { id: 'ai-modify-fields', name: 'Use AI to Add/Delete fields', reward: 'AI Customizer Badge' },
    { id: 'global-settings', name: 'Update global settings', reward: 'Settings Master Badge' },
    { id: 'change-field-names', name: 'Change field names', reward: 'Field Editor Badge' },
    { id: 'upload-logo', name: 'Enable and upload logo', reward: 'Branding Badge' },
    { id: 'republish', name: 'Republish', reward: 'Republisher Badge' }
  ],
  3: [
    { id: 'customize-fields', name: 'Customize Individual fields', reward: 'Field Customizer Badge' },
    { id: 'move-fields', name: 'Move fields up/down', reward: 'Field Organizer Badge' },
    { id: 'add-fields-preview', name: 'Add new fields in Preview', reward: 'Preview Editor Badge' },
    { id: 'delete-fields-preview', name: 'Delete fields in Preview', reward: 'Preview Cleaner Badge' }
  ],
  4: [
    { id: 'go-to-workspace', name: 'Go to workspace', reward: 'Workspace Explorer Badge' },
    { id: 'submit-and-check-submissions', name: 'Submit the published form and check submissions', reward: 'Submissions Viewer Badge' },
    { id: 'clone-form', name: 'Clone an existing form', reward: 'Form Cloner Badge' },
    { id: 'delete-form', name: 'Delete a form', reward: 'Form Cleaner Badge' }
  ],
  5: [
    { id: 'setup-calendly', name: 'Set up Calendly', reward: 'Calendly Integrator Badge' },
    { id: 'setup-esignature', name: 'Set up e-signature fields', reward: 'E-Signature Badge' },
    { id: 'setup-stripe', name: 'Set up Stripe', reward: 'Stripe Integrator Badge' },
    { id: 'setup-hipaa', name: 'Set up HIPAA', reward: 'HIPAA Compliance Badge' }
  ]
};

const levelNames = {
  1: 'Form Creator',
  2: 'Customizer',
  3: 'Form Master',
  4: 'Workspace Pro',
  5: 'Expert'
};

async function updateOnboardingLevel(email, targetLevel) {
  const gcpClient = new GCPClient();
  
  // Validate level (0 is allowed to reset all tasks)
  if (targetLevel < 0 || targetLevel > 5) {
    console.error(`❌ Invalid level: ${targetLevel}. Level must be between 0 and 5.`);
    process.exit(1);
  }
  
  console.log(`🔍 Searching for user with email: ${email}`);
  
  // Try to find user by exact email first
  let user = await gcpClient.getUserByEmail(email, false);
  
  // If not found, try normalized lookup
  if (!user) {
    console.log(`   ⚠️  Not found by exact email, trying normalized lookup...`);
    const normalizedEmail = validator.normalizeEmail(email.toLowerCase().trim(), {
      gmail_lowercase: true,
      gmail_remove_dots: true,
      gmail_remove_subaddress: true,
      outlookdotcom_lowercase: true,
      yahoo_lowercase: true,
      icloud_lowercase: true
    }) || email.toLowerCase().trim();
    
    user = await gcpClient.getUserByEmail(normalizedEmail, true);
  }
  
  if (!user) {
    console.error(`❌ User not found with email: ${email}`);
    console.error(`   Tried exact match and normalized lookup`);
    process.exit(1);
  }
  
  console.log(`✅ Found user:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Name: ${user.name || 'N/A'}`);
  console.log(`   Current Level: ${user.onboardingProgress?.currentLevel || 'Not initialized'}`);
  console.log(`   Completed Tasks: ${user.onboardingProgress?.completedTasks?.length || 0}`);
  
  const userId = user.id;
  
  // Get current progress or initialize
  let progress = user.onboardingProgress;
  
  if (!progress) {
    console.log(`\n📝 Initializing onboarding progress...`);
    progress = {
      currentLevel: 1,
      completedTasks: [],
      totalProgress: 0,
      achievements: [],
      lastUpdated: new Date(),
      startedAt: new Date()
    };
  }
  
  const oldLevel = progress.currentLevel;
  const oldCompletedTasks = [...progress.completedTasks];
  const oldAchievements = [...(progress.achievements || [])];
  
  // Handle level 0: reset all tasks
  if (targetLevel === 0) {
    console.log(`\n🔄 Resetting all onboarding tasks...`);
    
    progress.completedTasks = [];
    progress.achievements = [];
    progress.currentLevel = 1;
    progress.totalProgress = 0;
    delete progress.completedAt;
    progress.lastUpdated = new Date();
    
    // Update user document
    await gcpClient.firestore
      .collection('users')
      .doc(userId)
      .set({
        onboardingProgress: progress
      }, { merge: true });
    
    console.log(`\n✅ All onboarding tasks have been reset!`);
    console.log(`   Old Level: ${oldLevel}`);
    console.log(`   New Level: 1 (Form Creator) - Reset`);
    console.log(`   Previously Completed Tasks: ${oldCompletedTasks.length}`);
    console.log(`   Tasks Removed: ${oldCompletedTasks.length}`);
    console.log(`   Total Completed Tasks: 0`);
    console.log(`   Total Progress: 0%`);
    
    if (oldCompletedTasks.length > 0) {
      console.log(`\n🗑️  All tasks removed:`);
      oldCompletedTasks.forEach(taskId => {
        const task = findTaskById(taskId);
        if (task) {
          console.log(`   - ${task.name} (Level ${levelForTask(taskId)})`);
        } else {
          console.log(`   - ${taskId} (Level ${levelForTask(taskId)})`);
        }
      });
    }
    
    console.log(`\n🎉 User ${user.email} onboarding has been reset to Level 1!`);
    return;
  }
  
  console.log(`\n🎯 Updating onboarding level from ${oldLevel} to ${targetLevel}...`);
  
  // Collect all tasks up to the target level (these should be kept/completed)
  const tasksToKeep = [];
  for (let level = 1; level <= targetLevel; level++) {
    const levelTasks = tasksPerLevel[level] || [];
    tasksToKeep.push(...levelTasks.map(t => t.id));
  }
  
  // Collect tasks that belong to levels higher than target level (these should be removed)
  const tasksToRemove = [];
  for (let level = targetLevel + 1; level <= 5; level++) {
    const levelTasks = tasksPerLevel[level] || [];
    tasksToRemove.push(...levelTasks.map(t => t.id));
  }
  
  // Remove tasks that belong to levels higher than target level
  const removedTasks = [];
  progress.completedTasks = progress.completedTasks.filter(taskId => {
    if (tasksToRemove.includes(taskId)) {
      removedTasks.push(taskId);
      return false; // Remove this task
    }
    return true; // Keep this task
  });
  
  // Remove achievements for removed tasks
  if (removedTasks.length > 0) {
    progress.achievements = progress.achievements.filter(achievement => {
      return !removedTasks.includes(achievement.id);
    });
  }
  
  // Add tasks up to target level that aren't already completed
  const newTasks = [];
  for (let level = 1; level <= targetLevel; level++) {
    const levelTasks = tasksPerLevel[level] || [];
    for (const task of levelTasks) {
      if (!progress.completedTasks.includes(task.id)) {
        progress.completedTasks.push(task.id);
        newTasks.push(task);
        
        // Add achievement
        progress.achievements.push({
          id: task.id,
          level: levelForTask(task.id),
          task: task.name,
          completedAt: new Date(),
          reward: task.reward
        });
      }
    }
  }
  
  // Update level
  progress.currentLevel = targetLevel;
  
  // Calculate total progress (0-100)
  const allTasks = Object.values(tasksPerLevel).flat();
  const totalTasks = allTasks.length;
  progress.totalProgress = Math.round((progress.completedTasks.length / totalTasks) * 100);
  
  // Check if all tasks are completed
  const allTasksCompleted = allTasks.every(task => progress.completedTasks.includes(task.id));
  if (allTasksCompleted) {
    progress.completedAt = new Date();
    console.log(`🏆 All onboarding tasks completed!`);
  } else {
    // Remove completedAt if not all tasks are done
    delete progress.completedAt;
  }
  
  progress.lastUpdated = new Date();
  
  // Update user document
  await gcpClient.firestore
    .collection('users')
    .doc(userId)
    .set({
      onboardingProgress: progress
    }, { merge: true });
  
  console.log(`\n✅ Onboarding level updated successfully!`);
  console.log(`   Old Level: ${oldLevel}`);
  console.log(`   New Level: ${targetLevel} (${levelNames[targetLevel]})`);
  console.log(`   Previously Completed Tasks: ${oldCompletedTasks.length}`);
  console.log(`   Tasks Added: ${newTasks.length}`);
  console.log(`   Tasks Removed: ${removedTasks.length}`);
  console.log(`   Total Completed Tasks: ${progress.completedTasks.length}`);
  console.log(`   Total Progress: ${progress.totalProgress}%`);
  
  if (removedTasks.length > 0) {
    console.log(`\n🗑️  Tasks removed (levels > ${targetLevel}):`);
    removedTasks.forEach(taskId => {
      const task = findTaskById(taskId);
      if (task) {
        console.log(`   - ${task.name} (Level ${levelForTask(taskId)})`);
      } else {
        console.log(`   - ${taskId} (Level ${levelForTask(taskId)})`);
      }
    });
  }
  
  if (newTasks.length > 0) {
    console.log(`\n📋 New tasks marked as completed:`);
    newTasks.forEach(task => {
      console.log(`   - ${task.name} (Level ${levelForTask(task.id)})`);
    });
  }
  
  console.log(`\n🎉 User ${user.email} is now at Level ${targetLevel}: ${levelNames[targetLevel]}!`);
}

function levelForTask(taskId) {
  for (const [level, tasks] of Object.entries(tasksPerLevel)) {
    if (tasks.some(t => t.id === taskId)) {
      return parseInt(level);
    }
  }
  return 1;
}

function findTaskById(taskId) {
  for (const tasks of Object.values(tasksPerLevel)) {
    const task = tasks.find(t => t.id === taskId);
    if (task) return task;
  }
  return null;
}

// Main execution
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ Usage: node scripts/update-onboarding-level.js <email> <level>');
  console.error('   Example: node scripts/update-onboarding-level.js jha.abhishek@gmail.com 4');
  console.error('   Use level 0 to reset all onboarding tasks');
  process.exit(1);
}

const email = args[0];
const level = parseInt(args[1], 10);

if (isNaN(level)) {
  console.error(`❌ Invalid level: ${args[1]}. Level must be a number between 0 and 5.`);
  console.error(`   Use level 0 to reset all onboarding tasks.`);
  process.exit(1);
}

updateOnboardingLevel(email, level)
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error updating onboarding level:', error);
    process.exit(1);
  });

