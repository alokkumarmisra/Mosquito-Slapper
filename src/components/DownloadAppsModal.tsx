import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Link2,
  PlusSquare,
  QrCode,
  Share,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DownloadLinksConfig, DownloadPlatform } from '../types/game';

interface DownloadAppsModalProps {
  open: boolean;
  initialPlatform?: DownloadPlatform | null;
  downloads: DownloadLinksConfig;
  onChangeDownloads: (next: DownloadLinksConfig) => void;
  onClose: () => void;
}

function sanitizeExternalUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function DownloadAppsModal({
  open,
  initialPlatform = null,
  downloads,
  onChangeDownloads,
  onClose,
}: DownloadAppsModalProps) {
  const { canInstall, isInstalled, detectedPlatform, promptInstall } = usePWAInstall();
  const defaultTab: DownloadPlatform =
    initialPlatform ??
    (detectedPlatform === 'android' ||
    detectedPlatform === 'apple' ||
    detectedPlatform === 'windows'
      ? detectedPlatform
      : 'android');

  const [activeTab, setActiveTab] = useState<DownloadPlatform>(defaultTab);
  const [qrTarget, setQrTarget] = useState<'android' | 'apple' | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const [showCustomLinks, setShowCustomLinks] = useState(false);

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const originQuery = origin ? `?origin=${encodeURIComponent(origin)}` : '';

  const links = useMemo(() => {
    const customAndroid = sanitizeExternalUrl(downloads.androidUrl);
    const customApple = sanitizeExternalUrl(downloads.appleUrl);
    const customWindows = sanitizeExternalUrl(downloads.windowsUrl);

    return {
      customAndroid,
      customApple,
      customWindows,
      androidInstallUrl: `${origin}/?install=android`,
      androidTwaUrl: `/api/downloads/android-twa${originQuery}`,
      appleInstallUrl: `${origin}/?install=apple`,
      appleIosProfileUrl: `/api/downloads/apple-ios${originQuery}`,
      appleMacLauncherUrl: `/api/downloads/apple-macos${originQuery}`,
      appleMacShortcutUrl: `/api/downloads/apple-webloc${originQuery}`,
      windowsInstallUrl: `${origin}/?install=windows`,
      windowsInstallerUrl: `/api/downloads/windows${originQuery}`,
      windowsShortcutUrl: `/api/downloads/windows-shortcut${originQuery}`,
    };
  }, [downloads, origin, originQuery]);

  useEffect(() => {
    if (!open) return;
    if (initialPlatform) {
      setActiveTab(initialPlatform);
    } else if (
      detectedPlatform === 'android' ||
      detectedPlatform === 'apple' ||
      detectedPlatform === 'windows'
    ) {
      setActiveTab(detectedPlatform);
    }
    setInstallNotice(null);
  }, [open, initialPlatform, detectedPlatform]);

  const activeQrUrl =
    qrTarget === 'android'
      ? links.customAndroid || links.androidInstallUrl
      : qrTarget === 'apple'
        ? links.customApple || links.appleInstallUrl
        : '';

  useEffect(() => {
    if (!open || !activeQrUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(activeQrUrl, {
      width: 210,
      margin: 2,
      color: {
        dark: '#0E1310',
        light: '#F4F7F2',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeQrUrl]);

  if (!open) return null;

  const handleCopy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPlatform(key);
      window.setTimeout(() => {
        setCopiedPlatform((cur) => (cur === key ? null : cur));
      }, 1800);
    } catch {
      setInstallNotice('Copy failed — copy the link directly from your browser address bar.');
    }
  };

  const handleNativeInstall = async (platformLabel: string) => {
    const accepted = await promptInstall();
    if (accepted) {
      setInstallNotice(`AI Mosquito Slapper installed on ${platformLabel}.`);
    } else {
      setInstallNotice(`Installation prompt dismissed. You can install anytime from this menu.`);
    }
  };

  const patchDownload = (key: keyof DownloadLinksConfig, value: string) => {
    onChangeDownloads({
      ...downloads,
      [key]: value,
    });
  };

  const isDetected = (platform: DownloadPlatform) => detectedPlatform === platform;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Download AI Mosquito Slapper for Android, Apple, and Windows"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="safe-bottom max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border border-white/12 bg-[#121814] p-4 text-[#F4F7F2] shadow-2xl min-[380px]:p-5 sm:rounded-2xl sm:p-6">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-[clamp(1.15rem,3.6vw,1.5rem)] leading-tight font-extrabold tracking-tight text-[#F4F7F2]">
              Download for Android, Apple &amp; Windows
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              Install AI Mosquito Slapper as a standalone fullscreen app on phones, tablets, Mac, or
              Windows PC — with live camera tracking, 3D spatial sound, and Phone-to-TV cast.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-300 transition-colors hover:bg-[#253029] hover:text-white cursor-pointer"
            aria-label="Close download options"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile / Tablet Segmented Platform Selector (< lg) */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#18201B] p-1 min-[380px]:gap-1.5 lg:hidden">
          {(['android', 'apple', 'windows'] as DownloadPlatform[]).map((platform) => {
            const active = activeTab === platform;
            const label =
              platform === 'android' ? 'Android' : platform === 'apple' ? 'Apple' : 'Windows';
            return (
              <button
                key={platform}
                type="button"
                onClick={() => setActiveTab(platform)}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer min-[380px]:flex-row min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs ${
                  active
                    ? 'bg-[#C8F542] text-[#0E1310]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <PlatformIcon platform={platform} className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {installNotice && (
          <div className="mt-4 rounded-lg border border-[#C8F542]/35 bg-[#1B261E] px-3.5 py-2.5 text-xs text-[#C8F542]">
            {installNotice}
          </div>
        )}

        {/* 3-Column Desktop Platform Grid / Active Tab on Mobile */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          {/* 1. ANDROID */}
          <section
            className={`${
              activeTab === 'android' ? 'flex' : 'hidden lg:flex'
            } flex-col justify-between rounded-xl border p-5 ${
              isDetected('android')
                ? 'border-[#C8F542]/45 bg-[#17211B]'
                : 'border-white/10 bg-[#171F1A]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1F2D23] text-[#C8F542]">
                    <PlatformIcon platform="android" className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-extrabold text-[#F4F7F2]">
                      Android
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Android 10+ · Phones, Tablets &amp; TV
                    </p>
                  </div>
                </div>
              </div>

              {isDetected('android') && (
                <p className="mt-2.5 text-xs font-semibold text-[#C8F542]">
                  Detected on this device{isInstalled ? ' · Already Installed' : ''}
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                Installs directly to your Android App Drawer as a full-screen standalone WebAPK via
                Chrome or Edge with instant Front &amp; Rear camera tracking.
              </p>

              <div className="mt-4 space-y-2">
                {links.customAndroid ? (
                  <a
                    href={links.customAndroid}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Download Android Package
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : canInstall && isDetected('android') ? (
                  <button
                    type="button"
                    onClick={() => void handleNativeInstall('Android')}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Install Android App Now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setQrTarget((cur) => (cur === 'android' ? null : 'android'))}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
                  >
                    <QrCode className="h-4 w-4 shrink-0" />
                    {qrTarget === 'android' ? 'Hide Android QR Code' : 'Get on Android (QR)'}
                  </button>
                )}

                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy('android', links.customAndroid || links.androidInstallUrl)
                    }
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] transition-colors hover:bg-[#26322B] whitespace-nowrap cursor-pointer"
                  >
                    {copiedPlatform === 'android' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#C8F542]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Link
                      </>
                    )}
                  </button>

                  <a
                    href={links.androidTwaUrl}
                    download="AI-Mosquito-Slapper-Android-TWA-Config.json"
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#26322B] whitespace-nowrap"
                    title="Download Bubblewrap TWA manifest to compile a signed Google Play APK / AAB"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" />
                    APK Config
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-400">
              <strong className="text-slate-200">Quick install:</strong> Open in Android Chrome and
              tap <strong className="text-slate-200">Install App</strong> (or Chrome menu{' '}
              <span className="font-mono text-slate-300">⋮</span> → Install app).
            </div>
          </section>

          {/* 2. APPLE (iPhone, iPad & macOS) */}
          <section
            className={`${
              activeTab === 'apple' ? 'flex' : 'hidden lg:flex'
            } flex-col justify-between rounded-xl border p-5 ${
              isDetected('apple')
                ? 'border-[#C8F542]/45 bg-[#17211B]'
                : 'border-white/10 bg-[#171F1A]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1F2D23] text-[#F4F7F2]">
                    <PlatformIcon platform="apple" className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-extrabold text-[#F4F7F2]">Apple</h3>
                    <p className="text-[11px] text-slate-400">
                      iPhone, iPad (iOS 15+) &amp; macOS
                    </p>
                  </div>
                </div>
              </div>

              {isDetected('apple') && (
                <p className="mt-2.5 text-xs font-semibold text-[#C8F542]">
                  Detected on this device{isInstalled ? ' · Already Installed' : ''}
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                Download the signed-format iPhone/iPad fullscreen Web Clip profile or macOS
                standalone app launcher, or add straight from Safari.
              </p>

              <div className="mt-4 space-y-2">
                {links.customApple ? (
                  <a
                    href={links.customApple}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Download for Apple
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  <a
                    href={links.appleIosProfileUrl}
                    download="AI-Mosquito-Slapper-iOS.mobileconfig"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-3 text-[11px] font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap min-[360px]:px-4 min-[360px]:text-xs"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    iPhone / iPad App (.mobileconfig)
                  </a>
                )}

                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  <a
                    href={links.appleMacLauncherUrl}
                    download="AI-Mosquito-Slapper-macOS.command"
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] transition-colors hover:bg-[#26322B] whitespace-nowrap"
                    title="Download macOS standalone app launcher script"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" />
                    macOS App
                  </a>

                  <button
                    type="button"
                    onClick={() => setQrTarget((cur) => (cur === 'apple' ? null : 'apple'))}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#26322B] whitespace-nowrap cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5 shrink-0" />
                    {qrTarget === 'apple' ? 'Hide QR' : 'iPhone QR'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                  <a
                    href={links.appleMacShortcutUrl}
                    download="AI-Mosquito-Slapper.webloc"
                    className="font-medium text-slate-300 underline decoration-white/25 underline-offset-4 hover:text-[#C8F542]"
                  >
                    macOS Shortcut (.webloc)
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy('apple', links.customApple || links.appleInstallUrl)
                    }
                    className="inline-flex items-center gap-1 font-medium text-slate-300 hover:text-[#C8F542] cursor-pointer"
                  >
                    {copiedPlatform === 'apple' ? (
                      <>
                        <Check className="h-3 w-3 text-[#C8F542]" />
                        Link Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-400">
              <span className="inline-flex items-center gap-1 text-slate-200">
                <Share className="h-3 w-3 text-[#C8F542]" />
                <strong>Safari:</strong>
              </span>{' '}
              Tap <strong className="text-slate-200">Share</strong> →{' '}
              <span className="inline-flex items-center gap-0.5 text-slate-200">
                <PlusSquare className="h-3 w-3 text-[#C8F542]" />
                <strong>Add to Home Screen</strong>
              </span>{' '}
              (or <strong className="text-slate-200">File → Add to Dock</strong> on macOS).
            </div>
          </section>

          {/* 3. WINDOWS */}
          <section
            className={`${
              activeTab === 'windows' ? 'flex' : 'hidden lg:flex'
            } flex-col justify-between rounded-xl border p-5 ${
              isDetected('windows')
                ? 'border-[#C8F542]/45 bg-[#17211B]'
                : 'border-white/10 bg-[#171F1A]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1F2D23] text-[#38BDF8]">
                    <PlatformIcon platform="windows" className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-extrabold text-[#F4F7F2]">
                      Windows
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Windows 10 &amp; 11 · 64-bit / ARM64
                    </p>
                  </div>
                </div>
              </div>

              {isDetected('windows') && (
                <p className="mt-2.5 text-xs font-semibold text-[#C8F542]">
                  Detected on this device{isInstalled ? ' · Already Installed' : ''}
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-slate-300">
                Creates Desktop &amp; Start Menu shortcuts launching AI Mosquito Slapper in
                frameless standalone App Mode via Edge or Chrome.
              </p>

              <div className="mt-4 space-y-2">
                {links.customWindows ? (
                  <a
                    href={links.customWindows}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Download Windows Installer
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : canInstall && isDetected('windows') ? (
                  <button
                    type="button"
                    onClick={() => void handleNativeInstall('Windows')}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Install Windows App Now
                  </button>
                ) : (
                  <a
                    href={links.windowsInstallerUrl}
                    download="Install-AI-Mosquito-Slapper-Windows.cmd"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] transition-colors hover:bg-[#d7fb6a] whitespace-nowrap"
                  >
                    <Download className="h-4 w-4 shrink-0" />
                    Windows App Installer (.cmd)
                  </a>
                )}

                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  {canInstall && isDetected('windows') && !links.customWindows ? (
                    <a
                      href={links.windowsInstallerUrl}
                      download="Install-AI-Mosquito-Slapper-Windows.cmd"
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] transition-colors hover:bg-[#26322B] whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      .cmd Installer
                    </a>
                  ) : (
                    <a
                      href={links.windowsShortcutUrl}
                      download="AI-Mosquito-Slapper.url"
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] transition-colors hover:bg-[#26322B] whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      Shortcut (.url)
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(
                        'windows',
                        links.customWindows || `${origin}${links.windowsInstallerUrl}`,
                      )
                    }
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#26322B] whitespace-nowrap cursor-pointer"
                  >
                    {copiedPlatform === 'windows' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#C8F542]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-400">
              <strong className="text-slate-200">No admin rights needed:</strong> Double-click the{' '}
              <span className="font-mono text-slate-300">.cmd</span> file or click the install icon
              in the Edge / Chrome address bar.
            </div>
          </section>
        </div>

        {/* Live Scannable QR Code Panel for Mobile Transfer */}
        {qrTarget && qrDataUrl && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-xl border border-[#C8F542]/30 bg-[#17211B] p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="shrink-0 overflow-hidden rounded-xl bg-[#F4F7F2] p-2 shadow-md">
              <img
                src={qrDataUrl}
                alt={`QR code to open AI Mosquito Slapper on ${
                  qrTarget === 'android' ? 'Android' : 'iPhone or iPad'
                }`}
                referrerPolicy="no-referrer"
                className="h-36 w-36 object-contain sm:h-40 sm:w-40"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
              <h3 className="font-display text-base font-bold text-[#F4F7F2]">
                Scan with your {qrTarget === 'android' ? 'Android Phone' : 'iPhone or iPad'}
              </h3>
              <p className="text-xs leading-relaxed text-slate-300">
                {qrTarget === 'android'
                  ? 'Point your Android camera at this QR code to open the game in Chrome and install the full-screen app directly to your home screen.'
                  : 'Point your iPhone or iPad camera at this QR code to open in Safari, then tap Share → Add to Home Screen (or install the .mobileconfig profile).'}
              </p>
              <p className="truncate font-mono text-[11px] text-[#C8F542]">{activeQrUrl}</p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
                <button
                  type="button"
                  onClick={() => void handleCopy('qr', activeQrUrl)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] hover:bg-[#26322B] cursor-pointer"
                >
                  {copiedPlatform === 'qr' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#C8F542]" />
                      Link Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy Mobile URL
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setQrTarget(null)}
                  className="inline-flex h-9 items-center rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                >
                  Hide QR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Custom Binary / App Store URL Overrides */}
        <div className="mt-5 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => setShowCustomLinks((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-slate-300 hover:text-[#F4F7F2] cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5 text-[#C8F542]" />
              Configure Custom Store or Binary Links (APK, App Store, EXE)
            </span>
            {showCustomLinks ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {showCustomLinks && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="dl-android" className="block text-[11px] font-medium text-slate-400">
                  Android APK / Google Play URL
                </label>
                <input
                  id="dl-android"
                  type="url"
                  value={downloads.androidUrl}
                  onChange={(e) => patchDownload('androidUrl', e.target.value)}
                  placeholder="https://example.com/bugslapper.apk"
                  className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="dl-apple" className="block text-[11px] font-medium text-slate-400">
                  Apple App Store / TestFlight / DMG URL
                </label>
                <input
                  id="dl-apple"
                  type="url"
                  value={downloads.appleUrl}
                  onChange={(e) => patchDownload('appleUrl', e.target.value)}
                  placeholder="https://apps.apple.com/app/..."
                  className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="dl-windows" className="block text-[11px] font-medium text-slate-400">
                  Windows EXE / MSIX / Store URL
                </label>
                <input
                  id="dl-windows"
                  type="url"
                  value={downloads.windowsUrl}
                  onChange={(e) => patchDownload('windowsUrl', e.target.value)}
                  placeholder="https://example.com/bugslapper-setup.exe"
                  className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformIcon({
  platform,
  className = 'h-5 w-5',
}: {
  platform: DownloadPlatform;
  className?: string;
}) {
  if (platform === 'android') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d="M17.6 9.48l1.84-3.18a.49.49 0 00-.18-.67.49.49 0 00-.67.18l-1.87 3.24a11.43 11.43 0 00-9.44 0L5.41 5.81a.49.49 0 00-.67-.18.49.49 0 00-.18.67L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0a1.25 1.25 0 111.25-1.25A1.25 1.25 0 0117 15.25z" />
      </svg>
    );
  }
  if (platform === 'apple') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.33c.64-.78 1.08-1.86.96-2.94-.93.04-2.06.62-2.72 1.4-.58.68-1.1 1.79-.96 2.84 1.04.08 2.09-.52 2.72-1.3z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3 5.55L10.35 4.5v7.05H3V5.55zm8.2-1.17L21 3v8.55h-9.8V4.38zM3 12.45h7.35v7.05L3 18.45v-6zm8.2 0H21V21l-9.8-1.38v-7.17z" />
    </svg>
  );
}
