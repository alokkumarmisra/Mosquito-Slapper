import { useState } from 'react';
import { Download, Share, PlusSquare, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  className?: string;
}

export function PWAInstallButton({ compact = false, className = '' }: PWAInstallButtonProps) {
  const { canInstall, isIOS, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (!canInstall && !isIOS) {
    return null;
  }

  const handleClick = async () => {
    if (canInstall) {
      await promptInstall();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1D2A1F] font-semibold text-[#C8F542] transition-colors hover:bg-[#27382A] whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'h-9 px-2.5 text-xs xl:px-3' : 'min-h-[44px] px-3 text-xs sm:px-4 sm:text-sm'
        } ${className}`}
        title="Install AI Mosquito Slapper as a mobile or desktop app"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        Install App
      </button>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-3 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install on iPhone or iPad"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowIOSGuide(false);
          }}
        >
          <div className="safe-bottom max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/12 bg-[#121814] p-5 text-[#F4F7F2] shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-extrabold text-[#F4F7F2]">
                  Install on iPhone & iPad
                </h2>
                <p className="mt-1 text-xs text-slate-300">
                  Add BugSlapper to your home screen for full-screen mobile camera play.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-slate-300 hover:text-white shrink-0 cursor-pointer"
                aria-label="Close install guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm text-slate-200">
              <li className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1D2921] text-[#C8F542]">
                  <Share className="h-4 w-4" />
                </span>
                <span>
                  Tap the <strong className="text-white">Share</strong> button in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1D2921] text-[#C8F542]">
                  <PlusSquare className="h-4 w-4" />
                </span>
                <span>
                  Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 h-11 w-full rounded-lg bg-[#C8F542] text-sm font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineNotice() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-4 sm:top-16"
    >
      <div className="inline-flex items-center gap-2 rounded-lg border border-amber-400/35 bg-[#1C1A12]/92 px-3 py-1.5 text-xs font-medium text-amber-200 backdrop-blur-md">
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-300" />
        Offline mode — local camera gameplay stays available
      </div>
    </div>
  );
}
