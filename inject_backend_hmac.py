import os

filepath = r'd:\KHIVISION\backend\controllers\incidents.js'
with open(filepath, 'r', encoding='utf8') as f:
    content = f.read()

target = 'exports.createIncident = async (req, res, next) => {\n  try {\n    // Step 1: Set user'

hmac_logic = '''exports.createIncident = async (req, res, next) => {
  try {
    // SECURITY: Validate location payload HMAC to prevent spoofing
    const crypto = require('crypto');
    const signature = req.headers['x-location-signature'];
    
    if (req.body.location) {
      let loc = req.body.location;
      if (typeof loc === 'string') {
        try { loc = JSON.parse(loc); } catch(e) {}
      }
      
      if (loc && loc.coordinates) {
        if (!signature) {
          console.warn('🚨 SECURITY ALERT: Missing location signature');
          return res.status(403).json({
            success: false,
            message: 'Security validation failed: Missing location signature'
          });
        }
        
        let coordsStr = '';
        if (typeof loc.coordinates === 'string') {
          coordsStr = loc.coordinates.replace(/[\\[\\]\\s]/g, '');
        } else if (Array.isArray(loc.coordinates)) {
          coordsStr = loc.coordinates.join(',');
        }
        
        const secret = process.env.LOCATION_SECRET || 'khivision_secure_location_key_2026';
        const expectedSignature = crypto.createHmac('sha256', secret).update(coordsStr).digest('hex');
          
        if (signature !== expectedSignature) {
          console.warn(`🚨 SECURITY ALERT: Location spoofing detected! Expected: ${expectedSignature}, Got: ${signature}`);
          return res.status(403).json({
            success: false,
            message: 'Security validation failed: Location integrity compromised'
          });
        }
        console.log('✅ Location integrity verified successfully');
      }
    }

    // Step 1: Set user'''

if target in content:
    content = content.replace(target, hmac_logic)
    with open(filepath, 'w', encoding='utf8') as f:
        f.write(content)
    print('Updated incidents.js with HMAC validation.')
else:
    print('Target not found in incidents.js')
