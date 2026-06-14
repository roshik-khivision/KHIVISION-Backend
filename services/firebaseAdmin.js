const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

let _initialized = false;

function getAdmin() {
  if (_initialized || admin.apps.length > 0) return admin;

  try {
    let credential;

    // Option 1: Base64-encoded service account in env var (production-safe)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const json = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
      );
      credential = admin.credential.cert(json);
      console.log('🔥 Firebase Admin: using FIREBASE_SERVICE_ACCOUNT_BASE64 env var');

    // Option 2: JSON file on disk (local dev)
    } else {
      const keyPath = path.join(__dirname, 'firebase-service-account.json');
      if (!fs.existsSync(keyPath)) {
        console.warn(
          '⚠️  Firebase Admin: no service account found.\n' +
          '   FCM push notifications are DISABLED.\n' +
          '   Add services/firebase-service-account.json or set FIREBASE_SERVICE_ACCOUNT_BASE64.'
        );
        return null;
      }
      credential = admin.credential.cert(require(keyPath));
      console.log('🔥 Firebase Admin: using firebase-service-account.json');
    }

    admin.initializeApp({ credential });
    _initialized = true;
    return admin;

  } catch (err) {
    console.error('❌ Firebase Admin initialization failed:', err.message);
    return null;
  }
}

module.exports = { getAdmin };
