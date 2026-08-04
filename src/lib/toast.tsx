import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Kind = 'info' | 'ok' | 'err'

interface Toast {
  id: number
  kind: Kind
  message: string
}

const ToastCtx = createContext<(message: string, kind?: Kind) => void>(() => {})

export function useToast(): (message: string, kind?: Kind) => void {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<Toast[]>([])

  const push = useCallback((message: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'err' ? 8000 : 3500)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
