import type { ReactNode } from 'react'

interface SplitAuthScreenProps {
  contextPanel: ReactNode
  children: ReactNode
}

export function SplitAuthScreen({ contextPanel, children }: SplitAuthScreenProps) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-paper">
      <div className="md:flex-[1_1_420px] md:min-w-[320px] bg-paper-2 border-r border-line flex items-center justify-center p-8 md:p-12">
        {contextPanel}
      </div>
      <div className="md:flex-[1_1_420px] md:min-w-[320px] flex items-center justify-center p-8 md:p-12">
        {children}
      </div>
    </div>
  )
}
