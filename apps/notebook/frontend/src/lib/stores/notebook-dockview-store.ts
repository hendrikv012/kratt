import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SerializedDockview } from 'dockview-react'

interface NotebookDockviewState {
  // Shared across all notebooks, same as the collapse state it replaces was
  // global rather than per-notebook — a user's panel arrangement preference
  // carries over when they switch notebooks.
  layout: SerializedDockview | null
  setLayout: (layout: SerializedDockview) => void
}

export const useNotebookDockviewStore = create<NotebookDockviewState>()(
  persist(
    (set) => ({
      layout: null,
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: 'notebook-dockview-layout',
    }
  )
)
