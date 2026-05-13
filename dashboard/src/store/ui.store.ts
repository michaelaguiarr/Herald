import { create } from 'zustand'

interface UIStore {
  failedCount: number
  setFailedCount: (count: number) => void
}

export const useUIStore = create<UIStore>((set) => ({
  failedCount: 0,
  setFailedCount: (count) => set({ failedCount: count }),
}))
