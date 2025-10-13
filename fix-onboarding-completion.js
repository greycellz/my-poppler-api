const GCPClient = require('./gcp-client.js');

async function fixOnboardingCompletion() {
  const gcpClient = new GCPClient();
  const userId = 'uQ5INtzCwUqidMF9DLrm';
  
  try {
    console.log('🔧 Fixing onboarding completion status for user:', userId);
    
    // Get current progress
    const progress = await gcpClient.getOnboardingProgress(userId);
    if (!progress) {
      console.log('❌ No progress found');
      return;
    }
    
    console.log('📊 Current completed tasks:', progress.completedTasks);
    console.log('📊 Current completedAt:', progress.completedAt);
    
    // Check if all tasks are actually completed
    const allTasks = [
      // Level 1
      'create-form', 'publish-form',
      // Level 2
      'ai-modify-fields', 'global-settings', 'change-field-names', 'upload-logo', 'republish',
      // Level 3
      'customize-fields', 'move-fields', 'add-fields-preview', 'delete-fields-preview',
      // Level 4
      'go-to-workspace', 'submit-and-check-submissions', 'clone-form', 'delete-form',
      // Level 5
      'setup-calendly', 'setup-esignature', 'setup-stripe', 'setup-hipaa'
    ];
    
    const missingTasks = allTasks.filter(taskId => !progress.completedTasks.includes(taskId));
    console.log('❌ Missing tasks:', missingTasks);
    
    if (missingTasks.length > 0 && progress.completedAt) {
      console.log('🔧 Removing incorrect completedAt flag...');
      
      // Remove completedAt flag
      delete progress.completedAt;
      progress.lastUpdated = new Date();
      
      // Recalculate total progress
      progress.totalProgress = Math.round((progress.completedTasks.length / allTasks.length) * 100);
      
      // Update in database
      const userRef = gcpClient.firestore.collection('users').doc(userId);
      await userRef.update({
        onboardingProgress: progress
      });
      
      console.log('✅ Fixed! Removed completedAt flag. New progress:', progress.totalProgress + '%');
    } else if (missingTasks.length === 0) {
      console.log('✅ All tasks completed, onboarding should be marked as completed');
    } else {
      console.log('ℹ️ No completedAt flag to remove');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixOnboardingCompletion();
