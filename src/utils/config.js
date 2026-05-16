// Centralized configuration — single source of truth for all environment-dependent values
export const CONFIG = {
  API_BASE: 'https://webrtc-hzhad3hdhnffcbe5.centralindia-01.azurewebsites.net/api/meetings',
  WS_URL: 'https://webrtc-hzhad3hdhnffcbe5.centralindia-01.azurewebsites.net/webrtc-signaling',
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  APP_NAME: 'StreamSync',
};
