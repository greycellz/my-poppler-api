const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth/middleware');

router.post('/store-signature', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { signatureData, planId } = req.body;
    
    console.log('📝 BAA signature storage request:', { userId, planId });
    
    // Validate input
    if (!signatureData || !planId) {
      return res.status(400).json({ error: 'Missing required fields: signatureData and planId are required' });
    }

    if (!signatureData.imageBase64 || !signatureData.userName) {
      return res.status(400).json({ error: 'Invalid signature data: imageBase64 and userName are required' });
    }

    if (planId !== 'pro' && planId !== 'enterprise') {
      return res.status(400).json({ error: 'BAA is only required for Pro or Enterprise plans' });
    }
    
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    
    // Create BAA agreement record
    const baaRecord = {
      userId,
      userEmail: req.user.email || '',
      userName: req.user.name || signatureData.userName,
      companyName: signatureData.companyName || req.user.company || null,
      planId,
      signatureData: {
        imageBase64: signatureData.imageBase64,
        method: 'click',
        completedAt: signatureData.completedAt || new Date().toISOString(),
        userName: signatureData.userName,
        companyName: signatureData.companyName || null
      },
      status: 'pending_payment',
      signedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    console.log('📝 Creating BAA record in Firestore...');
    
    // Store in Firestore
    const docRef = await gcpClient.firestore.collection('baa-agreements').add(baaRecord);
    
    console.log('✅ BAA record created:', docRef.id);
    
    // Update user document
    await gcpClient.firestore.collection('users').doc(userId).update({
      baaSigned: true,
      baaSignedAt: new Date().toISOString(),
      baaAgreementId: docRef.id
    });
    
    console.log('✅ User document updated with BAA info');
    
    res.json({ 
      success: true, 
      baaRecordId: docRef.id,
      message: 'BAA signature stored successfully'
    });
  } catch (error) {
    console.error('❌ BAA signature storage error:', error);
    res.status(500).json({ 
      error: 'Failed to store signature',
      message: error.message 
    });
  }
});

// Get user's BAA agreement
router.get('/agreement', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const GCPClient = require('../gcp-client');
    const gcpClient = new GCPClient();
    
    // Get the most recent completed BAA agreement
    const baaSnapshot = await gcpClient.firestore
      .collection('baa-agreements')
      .where('userId', '==', userId)
      .where('status', '==', 'completed')
      .orderBy('completedAt', 'desc')
      .limit(1)
      .get();
    
    if (baaSnapshot.empty) {
      return res.status(404).json({ error: 'No BAA agreement found' });
    }
    
    const baaDoc = baaSnapshot.docs[0];
    const baaData = baaDoc.data();
    
    // Generate signed URL for PDF download (valid for 1 year)
    if (baaData.pdfFilename) {
      const bucketName = process.env.GCS_HIPAA_BUCKET || 'chatterforms-submissions-us-central1';
      const bucket = gcpClient.storage.bucket(bucketName);
      const file = bucket.file(baaData.pdfFilename);
      
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
      });
      
      return res.json({
        success: true,
        agreement: {
          id: baaDoc.id,
          signedAt: baaData.signedAt,
          completedAt: baaData.completedAt,
          pdfUrl: signedUrl,
          companyName: baaData.companyName || null
        }
      });
    }
    
    return res.json({
      success: true,
      agreement: {
        id: baaDoc.id,
        signedAt: baaData.signedAt,
        completedAt: baaData.completedAt,
        companyName: baaData.companyName || null
      }
    });
  } catch (error) {
    console.error('❌ Error fetching BAA agreement:', error);
    res.status(500).json({ error: 'Failed to fetch BAA agreement' });
  }
});

module.exports = router;

