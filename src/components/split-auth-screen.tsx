import type { ReactNode } from 'react'

interface SplitAuthScreenProps {
  contextPanel: ReactNode
  children: ReactNode
}

export function SplitAuthScreen({ contextPanel, children }: SplitAuthScreenProps) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-paper">
      <div className="md:w-1/2 bg-paper-2 border-r border-line flex items-center justify-center p-8 md:p-12">
        {contextPanel}
      </div>
      <div className="md:w-1/2 flex items-center justify-center p-8 md:p-12">
        {children}
      </div>
    </div>
  )
}
