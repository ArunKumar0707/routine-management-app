// Run once:  node generate-vapid-keys.js
// Prints the VAPID key pair used to sign push messages.
const { webcrypto } = require('crypto');
(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  const j = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
  const priv = JSON.stringify({ kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d });
  console.log('\nPUBLIC KEY  (goes in push-config.js AND the worker variable VAPID_PUBLIC):\n' + pub);
  console.log('\nPRIVATE KEY (secret! worker secret VAPID_PRIVATE_JWK — never commit this to GitHub):\n' + priv + '\n');
})();
