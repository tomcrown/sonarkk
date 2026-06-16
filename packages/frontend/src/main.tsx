import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { EnokiFlowProvider } from '@mysten/enoki/react'
import { registerSlushWallet } from '@mysten/slush-wallet'
import '@mysten/dapp-kit/dist/index.css'
import './index.css'
import App from './App'

// Register Slush Wallet so it auto-appears in the wallet list
registerSlushWallet('Sonark')

// dapp-kit@1.x requires SuiJsonRpcClient for wallet signing/submission.
// All chain-state reads go through the Sonark backend API (port 3001),
// so this transport is only used for submitting signed PTBs to the node.
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

const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY ?? ''

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <EnokiFlowProvider apiKey={ENOKI_API_KEY}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </EnokiFlowProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)
