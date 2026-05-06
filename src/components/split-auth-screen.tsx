import type { ReactNode } from 'react'

interface SplitAuthScreenProps {
  contextPanel: ReactNode
  children: ReactNode
}

export function SplitAuthScreen({ contextPanel, children }: SplitAuthScreenProps) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-paper">
      <div className="bg-paper-2 lg:border-r border-b lg:border-b-0 border-line p-8 md:p-12 lg:p-16 flex items-center justify-center">
        <div style={{ width: '100%', maxWidth: '28rem' }}>
          {contextPanel}
        </div>
      </div>
      <div className="p-8 md:p-12 lg:p-16 flex items-center justify-center">
        <div style={{ width: '100%', maxWidth: '28rem' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
