import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'

export function FileRequestPage() {
  return (
    <DriveLayout>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="rounded-xl border border-line bg-paper p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber/25 bg-amber-bg">
                <Icon name="link" size={18} className="text-amber-deep" />
              </div>
              <div>
                <h1 className="text-[22px] font-semibold text-ink mb-2">File requests are coming soon</h1>
                <p className="text-[13px] leading-relaxed text-ink-2">
                  This page is temporarily disabled while encrypted request uploads are completed.
                  Received files are not available here yet.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DriveLayout>
  )
}
