export interface AppUpdateResult {
  status: 'current' | 'available' | 'installing' | 'error'
  version?: string
  message?: string
}
