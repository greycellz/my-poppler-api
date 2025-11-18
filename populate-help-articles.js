/**
 * Script to populate initial help articles for the onboarding system
 * Run this script to set up help content for all onboarding tasks
 */

const GCPClient = require('./gcp-client');

const gcpClient = new GCPClient();

const helpArticles = {
  'chat-with-ai': {
    title: 'Creating Forms with AI',
    content: 'Learn how to use our AI chat interface to create forms quickly and easily.',
    steps: [
      'Type your form description in the chat input at the bottom',
      'Be specific about what fields you need (name, email, phone, etc.)',
      'Mention any special requirements (HIPAA compliance, file uploads, etc.)',
      'AI will generate form fields automatically',
      'Review and modify the generated form if needed'
    ],
    tips: [
      'Be specific about field types (text, email, phone, etc.)',
      'Mention if you need HIPAA compliance',
      'Include any special requirements upfront',
      'You can ask for modifications after the form is generated'
    ],
    related: ['publish-form', 'add-delete-fields']
  },

  'publish-form': {
    title: 'Publishing Your Form',
    content: 'Make your form live and accessible to others by publishing it.',
    steps: [
      'Click the "Publish" button in the top-right corner',
      'Your form will be made live and accessible',
      'Copy the form URL to share with others',
      'The form is now ready to receive submissions'
    ],
    tips: [
      'Test your form before publishing',
      'Keep the form URL for sharing',
      'You can republish anytime to update changes'
    ],
    related: ['submit-and-check-submissions', 'republish']
  },

  'submit-and-check-submissions': {
    title: 'Submit Form and Check Submissions',
    content: 'Test your published form and view the submission data in your workspace.',
    steps: [
      'Open your published form in a new tab',
      'Fill out all the required fields and submit',
      'Go to your workspace dashboard',
      'Click on your form to view submissions',
      'Review the submitted data and analytics'
    ],
    tips: [
      'Test with different types of data',
      'Check submission timestamps and user info',
      'Use the analytics to understand form performance',
      'Export submission data if needed'
    ],
    related: ['publish-form', 'go-to-workspace']
  },

  'add-delete-fields': {
    title: 'Modifying Form Fields with AI',
    content: 'Use AI to add or remove fields from your existing form.',
    steps: [
      'Type your request in the chat (e.g., "add a phone number field")',
      'AI will modify the form structure',
      'Review the changes in the preview',
      'Republish if you want to make changes live'
    ],
    tips: [
      'Be specific about field placement',
      'You can ask to remove fields you don\'t need',
      'AI can help with field validation and requirements'
    ],
    related: ['chat-with-ai', 'republish']
  },

  'global-settings': {
    title: 'Customizing Form Appearance',
    content: 'Change the look and feel of your form using global settings.',
    steps: [
      'Click the settings (gear) icon in the top-right',
      'Choose from preset color themes or customize',
      'Adjust font family and sizes',
      'Preview changes in real-time',
      'Click outside to close the settings panel'
    ],
    tips: [
      'Try different color themes for your brand',
      'Keep fonts readable and professional',
      'Test how it looks on mobile devices'
    ],
    related: ['upload-logo', 'customize-fields']
  },

  'change-field-names': {
    title: 'Editing Field Labels',
    content: 'Customize field names and labels to match your needs.',
    steps: [
      'Click on any field in the preview',
      'Edit the field label directly',
      'Press Enter or click outside to save',
      'Changes are saved automatically'
    ],
    tips: [
      'Use clear, descriptive labels',
      'Keep labels concise but informative',
      'Consider your audience when naming fields'
    ],
    related: ['customize-fields', 'global-settings']
  },

  'upload-logo': {
    title: 'Adding Your Logo',
    content: 'Upload and customize your logo to brand your forms.',
    steps: [
      'Click the "Logo" button in the form header',
      'Click "Add New Logo" to upload an image',
      'Choose your logo file (PNG, JPG, or SVG)',
      'Set the position (left, center, or right)',
      'Adjust the height (20px - 400px)',
      'Click "Update Logo" to apply changes'
    ],
    tips: [
      'Use high-quality images for best results',
      'PNG with transparent background works best',
      'Keep logo size reasonable for mobile viewing'
    ],
    related: ['global-settings', 'republish']
  },

  'republish': {
    title: 'Updating Your Published Form',
    content: 'Republish your form to make recent changes live.',
    steps: [
      'Make your desired changes to the form',
      'Click "Republish" in the top-right corner',
      'Your changes will be applied to the live form',
      'The form URL remains the same'
    ],
    tips: [
      'Test changes before republishing',
      'Republishing doesn\'t affect existing submissions',
      'Changes are applied immediately'
    ],
    related: ['publish-form', 'global-settings']
  },

  'customize-fields': {
    title: 'Advanced Field Customization',
    content: 'Fine-tune individual field settings and properties.',
    steps: [
      'Click on any field in the preview',
      'Use the field settings panel that appears',
      'Adjust field-specific options',
      'Set validation rules and requirements',
      'Save changes to apply them'
    ],
    tips: [
      'Each field type has different customization options',
      'Set appropriate validation rules',
      'Consider user experience when customizing'
    ],
    related: ['change-field-names', 'move-fields']
  },

  'move-fields': {
    title: 'Reordering Form Fields',
    content: 'Change the order of fields in your form.',
    steps: [
      'Hover over any field in the preview',
      'Use the up/down arrow buttons to reorder',
      'Fields will move to the new position',
      'Changes are saved automatically'
    ],
    tips: [
      'Put most important fields first',
      'Group related fields together',
      'Consider the logical flow of information'
    ],
    related: ['customize-fields', 'add-fields-preview']
  },

  'add-fields-preview': {
    title: 'Adding Fields in Preview',
    content: 'Add new fields directly in the form preview.',
    steps: [
      'Click the "+" button next to any field',
      'Choose the field type from the modal',
      'Enter the field label and options',
      'Set whether the field is required',
      'Click "Add Field" to insert it'
    ],
    tips: [
      'Choose the right field type for your data',
      'Use clear, descriptive labels',
      'Set required fields appropriately'
    ],
    related: ['move-fields', 'delete-fields-preview']
  },

  'delete-fields-preview': {
    title: 'Removing Fields',
    content: 'Remove unwanted fields from your form.',
    steps: [
      'Hover over the field you want to remove',
      'Click the delete (trash) button',
      'Confirm the deletion in the popup',
      'The field will be removed from the form'
    ],
    tips: [
      'Be careful when deleting fields',
      'Consider if you might need the data later',
      'Test your form after removing fields'
    ],
    related: ['add-fields-preview', 'customize-fields']
  },

  'go-to-workspace': {
    title: 'Managing Your Forms',
    content: 'Access your workspace to manage all your forms.',
    steps: [
      'Click on your form name in the top-left',
      'Select "Go to Workspace" from the dropdown',
      'View all your forms in one place',
      'Access form management tools'
    ],
    tips: [
      'Use workspace to organize multiple forms',
      'Quick access to all your form data',
      'Manage forms from a central location'
    ],
    related: ['check-submissions', 'clone-form']
  },

  'check-submissions': {
    title: 'Viewing Form Submissions',
    content: 'Check and manage submissions from your forms.',
    steps: [
      'Go to your workspace',
      'Click on any form to view its submissions',
      'See all submitted data in a table format',
      'Export data as CSV if needed'
    ],
    tips: [
      'Check submissions regularly',
      'Export important data for backup',
      'Use filters to find specific submissions'
    ],
    related: ['go-to-workspace', 'clone-form']
  },

  'clone-form': {
    title: 'Duplicating Forms',
    content: 'Create copies of existing forms for efficiency.',
    steps: [
      'Go to your workspace',
      'Hover over the form you want to clone',
      'Click the clone button in the form menu',
      'A new form will be created with the same structure',
      'Edit the cloned form as needed'
    ],
    tips: [
      'Great for creating similar forms',
      'Saves time on repetitive form creation',
      'Modify the cloned form for different purposes'
    ],
    related: ['go-to-workspace', 'delete-form']
  },

  'delete-form': {
    title: 'Removing Forms',
    content: 'Delete forms you no longer need.',
    steps: [
      'Go to your workspace',
      'Hover over the form you want to delete',
      'Click the delete button in the form menu',
      'Confirm the deletion in the popup',
      'The form and all its data will be removed'
    ],
    tips: [
      'Be careful when deleting forms',
      'Consider backing up important data first',
      'Deletion cannot be undone'
    ],
    related: ['go-to-workspace', 'clone-form']
  },

  'setup-calendly': {
    title: 'Calendar Integration',
    content: 'Connect Calendly to enable appointment scheduling in your forms.',
    steps: [
      'Add a calendar field to your form',
      'Click "Connect Calendly Account"',
      'Sign in to your Calendly account',
      'Authorize the connection',
      'Select your event types',
      'Configure the calendar field settings'
    ],
    tips: [
      'Make sure you have a Calendly account',
      'Choose appropriate event types',
      'Test the booking flow before publishing'
    ],
    related: ['setup-esignature', 'setup-stripe']
  },

  'setup-esignature': {
    title: 'E-Signature Fields',
    content: 'Add signature capture to your forms for legal documents.',
    steps: [
      'Add a signature field to your form',
      'Configure signature requirements',
      'Set up consent text for legal validity',
      'Test signature capture on different devices',
      'Published forms will include signature functionality'
    ],
    tips: [
      'Ensure compliance with local laws',
      'Test on both desktop and mobile',
      'Include clear consent statements'
    ],
    related: ['setup-calendly', 'setup-hipaa']
  },

  'setup-stripe': {
    title: 'Payment Processing',
    content: 'Enable payment collection in your forms with Stripe.',
    steps: [
      'Add a payment field to your form',
      'Click "Connect Stripe Account"',
      'Sign in to your Stripe account',
      'Authorize the connection',
      'Set payment amount and currency',
      'Configure payment field settings'
    ],
    tips: [
      'Make sure you have a Stripe account',
      'Set appropriate payment amounts',
      'Test with Stripe test mode first'
    ],
    related: ['setup-calendly', 'setup-hipaa']
  },

  'setup-hipaa': {
    title: 'HIPAA Compliance',
    content: 'Enable HIPAA compliance for healthcare and sensitive data.',
    steps: [
      'Click the "Standard Security" button in the form header',
      'Toggle to "HIPAA Compliant"',
      'Review HIPAA compliance requirements',
      'Ensure your plan supports HIPAA features',
      'HIPAA compliance will be applied to the form'
    ],
    tips: [
      'HIPAA requires Pro or Enterprise plan',
      'All data will be encrypted and secured',
      'Review compliance requirements carefully'
    ],
    related: ['setup-esignature', 'setup-stripe']
  }
};

async function populateHelpArticles() {
  try {
    console.log('📚 Starting to populate help articles...');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const [taskId, helpData] of Object.entries(helpArticles)) {
      try {
        await gcpClient.upsertHelpArticle(taskId, helpData);
        console.log(`✅ Created help article for: ${taskId}`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to create help article for: ${taskId}`, error);
        errorCount++;
      }
    }
    
    console.log(`\n📊 Help Articles Population Complete:`);
    console.log(`✅ Successfully created: ${successCount} articles`);
    console.log(`❌ Failed to create: ${errorCount} articles`);
    
    if (errorCount === 0) {
      console.log('🎉 All help articles created successfully!');
    } else {
      console.log('⚠️ Some help articles failed to create. Check the errors above.');
    }
    
  } catch (error) {
    console.error('❌ Error populating help articles:', error);
  }
}

// Run the script if called directly
if (require.main === module) {
  populateHelpArticles()
    .then(() => {
      console.log('📚 Help articles population script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { populateHelpArticles, helpArticles };
