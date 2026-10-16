// Modular Biometric Authentication Bridge
// Supports native wrapper bridges (Android WebView / Capacitor / Tauri) and browser WebAuthn platform authenticators (Touch ID, Windows Hello, Face ID).
// Gracefully degrades to PIN when unavailable.

const BIO_KEY = 'hisaab.bio_enabled';

export function isBiometricEnabled() {
  return localStorage.getItem(BIO_KEY) === '1';
}

export function setBiometricEnabled(val) {
  if (val) localStorage.setItem(BIO_KEY, '1');
  else localStorage.removeItem(BIO_KEY);
}

export async function isBiometricAvailable() {
  if (typeof window === 'undefined') return false;

  // 1. Native wrapper bridge (Android / Desktop app wrapper)
  if (window.AndroidBridge?.isBiometricAvailable) {
    try { return !!window.AndroidBridge.isBiometricAvailable(); } catch { return false; }
  }
  if (window.Capacitor?.isPluginAvailable?.('BiometricAuth')) {
    return true;
  }

  // 2. WebAuthn Platform Authenticator (Windows Hello, Touch ID, Android Chrome fingerprint)
  if (window.PublicKeyCredential && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  return false;
}

export async function registerBiometric() {
  if (typeof window === 'undefined') return false;

  // Native Android wrapper bridge or Capacitor
  if (window.AndroidBridge?.isBiometricAvailable || window.Capacitor?.isPluginAvailable?.('BiometricAuth')) {
    setBiometricEnabled(true);
    return true;
  }

  // WebAuthn platform authenticator registration
  if (window.PublicKeyCredential && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return false;

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Hisaab', id: window.location.hostname },
          user: {
            id: userId,
            name: 'hisaab_user',
            displayName: 'Hisaab Owner'
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },  // ES256
            { type: 'public-key', alg: -257 } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000
        }
      });

      if (cred && cred.rawId) {
        const rawIdB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
        localStorage.setItem('hisaab.bio_cred_id', rawIdB64);
        setBiometricEnabled(true);
        return true;
      }
    } catch (e) {
      console.warn('Biometric setup cancelled or failed', e);
      return false;
    }
  }
  return false;
}

export async function authenticateBiometric(reason = 'Verify your identity to unlock Hisaab') {
  if (!isBiometricEnabled()) return false;

  // 1. Native Android wrapper bridge
  if (window.AndroidBridge?.authenticateBiometric) {
    return new Promise(resolve => {
      const cb = 'bio_' + Math.random().toString(36).slice(2);
      window[cb] = result => {
        delete window[cb];
        resolve(!!result);
      };
      window.AndroidBridge.authenticateBiometric(reason, cb);
    });
  }

  // 2. Capacitor native plugin
  if (window.Capacitor?.Plugins?.BiometricAuth) {
    try {
      const res = await window.Capacitor.Plugins.BiometricAuth.authenticate({ reason });
      return !!res?.success;
    } catch {
      return false;
    }
  }

  // 3. Browser WebAuthn check with registered local platform credential
  if (window.PublicKeyCredential) {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const credIdB64 = localStorage.getItem('hisaab.bio_cred_id');
      if (!credIdB64) return false;
      
      const pubKeyOpts = {
        challenge,
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: [{
          id: Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0)),
          type: 'public-key',
          transports: ['internal']
        }]
      };

      const cred = await navigator.credentials.get({ publicKey: pubKeyOpts });
      return !!cred;
    } catch {
      return false;
    }
  }

  return false;
}
