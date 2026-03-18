window.APP_CONFIG = window.APP_CONFIG || {};

window.APP_CONFIG.apiBaseUrl = 'https://healthtranscript-staging-func-t6fmsx.azurewebsites.net/api';

window.APP_CONFIG.voiceLive = window.APP_CONFIG.voiceLive || {
    gatewayBaseUrl: 'https://ca-web-zf52hos5pogn4.calmcoast-f5c04f8a.swedencentral.azurecontainerapps.io',
    wsUrl: '',
    wsPath: '/ws',
    mode: 'model',
    model: 'gpt-realtime',
    voiceType: 'azure-standard',
    voice: 'en-US-Ava:DragonHDLatestNeural',
    transcribeModel: 'gpt-4o-transcribe',
    inputLanguage: 'en',
    instructions: 'You are an ambient clinical scribe. Do not greet, answer, or speak unless explicitly instructed. Focus on transcribing the live clinician and patient conversation accurately.'
};
