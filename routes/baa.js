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
      planId,
      signatureData: {
        imageBase64: signatureData.imageBase64,
        method: 'click',
        completedAt: signatureData.completedAt || new Date().toISOString(),
        userName: signatureData.userName
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

module.exports = router;

