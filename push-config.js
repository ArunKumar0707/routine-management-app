/* Background push settings — fill these in after deploying the push worker (see push/SETUP.md).
 * Leave both empty to keep DayFlow working without background alerts.
 * The public key is safe to commit; the PRIVATE key must never go in this file. */
window.DAYFLOW_PUSH = {
  server: 'https://dayflow-push.aka1422001.workers.dev',          // e.g. 'https://dayflow-push.your-name.workers.dev'  (no trailing slash)
  vapidPublicKey: 'BAIT6cGUGMDSPCL_HWSp7tcgQTCFZyWExhlGVKyipy8Mx5rhkrvFHSKPhHIC5i_WgNwzaXTZsozir1fwpCGzMxU'   // the PUBLIC key printed by push/generate-vapid-keys.js
};
