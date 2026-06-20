import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { registerEnokiWallets } from '@mysten/enoki'
import { registerSlushWallet } from '@mysten/slush-wallet'
import '@mysten/dapp-kit/dist/index.css'
import './index.css'
import App from './App'

// Register Slush Wallet so it auto-appears in the wallet list
registerSlushWallet('Sonark')

// Register Enoki Google wallet (zkLogin) if API key + client ID are configured.
// This makes the Google wallet appear automatically in useWallets() alongside Slush.
const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY ?? ''
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

if (
  ENOKI_API_KEY && !ENOKI_API_KEY.startsWith('REPLACE_') &&
  GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('REPLACE_')
) {
  // Create a dedicated Sui client for Enoki (separate from the dapp-kit one
  // so registerEnokiWallets' Object.assign mutation doesn't affect dapp-kit).
  const enokiSuiClient = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl('testnet'),
    network: 'testnet',
  })
  registerEnokiWallets({
    apiKey: ENOKI_API_KEY,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: enokiSuiClient as any,
    network: 'testnet',
    providers: {
      // redirectUrl must match an Authorized Redirect URI in Google Cloud Console.
      // The popup polls popup.location.hash, so the callback page must not redirect
      // away — it just needs to stay at that URL long enough for the wallet to read
      // the #id_token fragment (see /auth/callback route in App.tsx).
      google: {
        clientId: GOOGLE_CLIENT_ID,
        redirectUrl: `${window.location.origin}/auth/callback`,
      },
    },
  })
}

// dapp-kit@1.x requires SuiJsonRpcClient for wallet signing/submission.
const networks = {
  testnet: new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl('testnet'),
    network: 'testnet',
  }),
} as const

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)
