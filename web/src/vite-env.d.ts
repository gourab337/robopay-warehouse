/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_CHAIN?: 'anvil' | 'hsk'
  readonly VITE_WAREHOUSE_KEY: string
  readonly VITE_PICKER_KEYS: string
  readonly VITE_CARRIER_KEYS: string
}
