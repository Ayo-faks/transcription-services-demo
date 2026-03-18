import { createContext, useContext, useMemo, type ReactNode } from 'react'

declare global {
  interface Window {
    APP_CONFIG?: Partial<RuntimeConfig>
  }
}

export interface VoiceLiveRuntimeConfig {
  gatewayBaseUrl: string
  wsUrl: string
  wsPath: string
  mode: string
  model: string
  voiceType: string
  voice: string
  transcribeModel: string
  inputLanguage: string
  instructions: string
}

export interface RuntimeConfig {
  apiBaseUrl: string
  voiceLive: VoiceLiveRuntimeConfig
  platform: {
    appTitle: string
    assistantTitle: string
  }
}

const defaultConfig: RuntimeConfig = {
  apiBaseUrl: '/api',
  voiceLive: {
    gatewayBaseUrl: '',
    wsUrl: '',
    wsPath: '/ws',
    mode: 'model',
    model: 'gpt-realtime',
    voiceType: 'azure-standard',
    voice: 'en-US-Ava:DragonHDLatestNeural',
    transcribeModel: 'gpt-4o-transcribe',
    inputLanguage: 'en',
    instructions:
      'You are an ambient clinical scribe. Focus on capturing the conversation accurately so the automatic pipeline can prepare the final clinician review.',
  },
  platform: {
    appTitle: 'Wulo',
    assistantTitle: 'Visit Helper',
  },
}

const RuntimeConfigContext = createContext<RuntimeConfig>(defaultConfig)

function normalizeApiBaseUrl(configuredUrl?: string): string {
  if (!configuredUrl) {
    return '/api'
  }

  const isViteDevServer = Boolean(document.querySelector('script[src="/@vite/client"]'))

  if (isViteDevServer) {
    try {
      const parsedUrl = new URL(configuredUrl, window.location.origin)
      const isLocalFunctionsHost =
        (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost') &&
        parsedUrl.port === '7072' &&
        parsedUrl.pathname.startsWith('/api')

      if (isLocalFunctionsHost) {
        return '/api'
      }
    } catch {
      // Fall back to existing normalization below.
    }
  }

  if (configuredUrl === '/api') {
    const isLocalHost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'

    if (isLocalHost && !isViteDevServer && window.location.port !== '7072') {
      return 'http://127.0.0.1:7072/api'
    }
  }

  if (configuredUrl.endsWith('/')) {
    return configuredUrl.slice(0, -1)
  }

  return configuredUrl
}

export function RuntimeConfigProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RuntimeConfig>(() => {
    const appConfig = window.APP_CONFIG || {}

    return {
      apiBaseUrl: normalizeApiBaseUrl(appConfig.apiBaseUrl),
      voiceLive: {
        ...defaultConfig.voiceLive,
        ...appConfig.voiceLive,
      },
      platform: {
        ...defaultConfig.platform,
        ...appConfig.platform,
      },
    }
  }, [])

  return <RuntimeConfigContext.Provider value={value}>{children}</RuntimeConfigContext.Provider>
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext)
}