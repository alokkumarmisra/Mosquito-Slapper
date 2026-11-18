import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  Monitor,
  RefreshCw,
  Smartphone,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import {
  BackendApiConfig,
  CompanionConnectionState,
  DeviceRole,
  VideoTransportMode,
} from '../types/game';
import { backendRequest, isCustomBackendActive, resolveCompanionWsUrl } from '../network/BackendApiClient';
import { PWAInstallButton } from './PWAInstallButton';

interface TvCastModalProps {
  open: boolean;
  deviceRole: DeviceRole;
  roomCode: string | null;
  connectionState: CompanionConnectionState;
  transportMode: VideoTransportMode;
  companionError: string | null;
  backendConfig?: BackendApiConfig;
  onClose: () => void;
  onSwitchStandalone: () => void;
  onStartTvMode: () => void;
  onRegenerateTvRoom: () => void;
  onJoinAsPhone: (code: string) => void;
  onOpenDownloads?: () => void;
}

export function TvCastModal({
  open,
  deviceRole,
  roomCode,
  connectionState,
  transportMode,
  companionError,
  backendConfig,
  onClose,
  onSwitchStandalone,
  onStartTvMode,
  onRegenerateTvRoom,
  onJoinAsPhone,
  onOpenDownloads,
}: TvCastModalProps) {
  const [selectedTab, setSelectedTab] = useState<DeviceRole>(
    deviceRole === 'STANDALONE' ? 'TV_DISPLAY' : deviceRole,
  );
  const [codeInput, setCodeInput] = useState(roomCode ?? '');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [selectedBaseOrigin, setSelectedBaseOrigin] = useState<string>('');

  // Sync tab when modal opens
  useEffect(() => {
    if (!open) return;
    setSelectedTab(deviceRole === 'STANDALONE' ? 'TV_DISPLAY' : deviceRole);
    setSelectedBaseOrigin(window.location.origin);

    backendRequest<{ port?: number; lanIps?: string[] }>(
      backendConfig?.enabled ? backendConfig : null,
      '/api/network-info',
      { method: 'GET', timeoutMs: 3000 },
    )
      .then((res) => {
        if (res.ok && res.data && Array.isArray(res.data.lanIps)) {
          setLanIps(res.data.lanIps);
        }
      })
      .catch(() => {});
  }, [open, deviceRole, backendConfig]);

  const effectiveOrigin = selectedBaseOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
  const pairingUrl = roomCode ? `${effectiveOrigin}/?mode=phone&room=${roomCode}` : '';

  // Render crisp QR code locally whenever pairingUrl updates
  useEffect(() => {
    if (!open || !pairingUrl) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(pairingUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#0E1310',
        light: '#F4F7F2',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [open, pairingUrl]);

  if (!open) return null;

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const handleCopyLink = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be blocked in insecure contexts
    }
  };

  const handlePhoneSubmit = () => {
    const clean = codeInput.replace(/\D/g, '').slice(0, 4);
    if (clean.length === 4) {
      onJoinAsPhone(clean);
    }
  };

  const transportLabel =
    transportMode === 'WEBRTC'
      ? 'WebRTC HD Live'
      : transportMode === 'WS_RELAY'
        ? 'Live Relay Active'
        : 'Video Standby';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/72 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile App and TV Cast Setup"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="safe-bottom max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/12 bg-[#121814] p-4 text-[#F4F7F2] shadow-2xl min-[380px]:p-5 sm:rounded-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[clamp(1.15rem,3.6vw,1.5rem)] leading-tight font-extrabold tracking-tight text-[#F4F7F2]">
              Play on TV with Your Phone Camera
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              Open this page on your Smart TV or laptop plugged into your TV, then scan the QR code
              with your phone to use your mobile camera as the wireless motion tracker.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-300 hover:bg-[#253029] hover:text-white shrink-0 cursor-pointer"
            aria-label="Close TV cast setup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 3-Role Mode Switcher — stacks icon over text below 420px so labels never clip */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#18201B] p-1 min-[380px]:mt-5 min-[380px]:gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedTab('TV_DISPLAY');
              if (deviceRole !== 'TV_DISPLAY') {
                onStartTvMode();
              }
            }}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2.5 min-[420px]:text-xs sm:gap-2 sm:px-3 sm:text-sm ${
              selectedTab === 'TV_DISPLAY'
                ? 'bg-[#C8F542] text-[#0E1310]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Tv className="h-4 w-4 shrink-0" />
            <span>TV Display</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('PHONE_CAMERA')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2.5 min-[420px]:text-xs sm:gap-2 sm:px-3 sm:text-sm ${
              selectedTab === 'PHONE_CAMERA'
                ? 'bg-[#C8F542] text-[#0E1310]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Smartphone className="h-4 w-4 shrink-0" />
            <span>Phone Camera</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedTab('STANDALONE');
              if (deviceRole !== 'STANDALONE') {
                onSwitchStandalone();
              }
            }}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2.5 min-[420px]:text-xs sm:gap-2 sm:px-3 sm:text-sm ${
              selectedTab === 'STANDALONE'
                ? 'bg-[#2B3931] text-[#C8F542]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Monitor className="h-4 w-4 shrink-0" />
            <span>Play Here</span>
          </button>
        </div>

        {/* TAB 1: TV DISPLAY MODE */}
        {selectedTab === 'TV_DISPLAY' && (
          <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
            {deviceRole !== 'TV_DISPLAY' ? (
              <div className="rounded-xl border border-white/10 bg-[#171F1A] p-4 text-center sm:p-5">
                <p className="text-xs text-slate-200 sm:text-sm">
                  Start TV Display Mode to generate a 4-digit pairing code and QR code for your
                  phone camera.
                </p>
                <button
                  type="button"
                  onClick={onStartTvMode}
                  className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#C8F542] px-5 text-sm font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] cursor-pointer"
                >
                  <Tv className="h-4 w-4" />
                  Start TV Display Room
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-white/10 bg-[#171F1A] p-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-5 sm:p-5">
                {/* QR Code */}
                <div className="mx-auto flex flex-col items-center">
                  <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl border-2 border-[#C8F542]/50 bg-[#F4F7F2] p-2 min-[380px]:h-44 min-[380px]:w-44 sm:h-48 sm:w-48">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`Scan to connect phone camera to TV room ${roomCode ?? ''}`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs font-medium text-[#0E1310]">
                        Generating QR...
                      </span>
                    )}
                  </div>
                  <span className="mt-2 text-[11px] font-medium text-slate-400">
                    Scan with phone camera
                  </span>
                </div>

                {/* Pairing Details */}
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-300">TV Room Code</span>
                    <span className="font-mono text-xs font-semibold text-[#C8F542]">
                      {connectionState === 'CONNECTED'
                        ? `Phone Connected · ${transportLabel}`
                        : connectionState === 'CONNECTING'
                          ? 'Connecting to relay...'
                          : 'Waiting for phone camera...'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="font-mono text-3xl font-extrabold tracking-[0.22em] text-[#C8F542] tabular-nums min-[380px]:text-4xl">
                      {roomCode ?? '----'}
                    </div>
                    <button
                      type="button"
                      onClick={onRegenerateTvRoom}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/12 bg-[#202B24] px-3 text-xs font-medium text-slate-200 hover:bg-[#2A382F] whitespace-nowrap cursor-pointer"
                      title="Generate a new 4-digit room code"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      New Code
                    </button>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-300">
                    Prop your phone facing you in front of the TV. Your phone tracks both hands and
                    streams live camera video straight to this TV screen.
                  </p>

                  {isCustomBackendActive(backendConfig) && backendConfig?.routeTvRelay && (
                    <p className="truncate font-mono text-[11px] text-[#C8F542]">
                      Relay: {resolveCompanionWsUrl(backendConfig)}
                    </p>
                  )}

                  {isLocalhost && lanIps.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-amber-400/30 bg-amber-950/25 p-3 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-200">
                        <Wifi className="h-3.5 w-3.5 shrink-0" />
                        Select your Wi-Fi IP for phone QR scan:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {lanIps.map((ip) => {
                          const candidate = `${window.location.protocol}//${ip}:${window.location.port || '3000'}`;
                          const active = selectedBaseOrigin === candidate;
                          return (
                            <button
                              key={ip}
                              type="button"
                              onClick={() => setSelectedBaseOrigin(candidate)}
                              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] cursor-pointer ${
                                active
                                  ? 'border-[#C8F542] bg-[#223225] text-[#C8F542]'
                                  : 'border-white/12 bg-[#1A231E] text-slate-300 hover:text-white'
                              }`}
                            >
                              {ip}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      disabled={!pairingUrl}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/15 bg-[#1E2722] px-3.5 text-xs font-semibold text-[#F4F7F2] hover:bg-[#27332C] disabled:opacity-50 cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#C8F542]" />
                          Link Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy Phone Link
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] cursor-pointer"
                    >
                      {connectionState === 'CONNECTED' ? 'Play on TV Now' : 'Show Full TV Arena'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PHONE CAMERA MODE */}
        {selectedTab === 'PHONE_CAMERA' && (
          <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-[#171F1A] p-5">
            <div>
              <h3 className="font-display text-base font-bold text-[#F4F7F2]">
                Pair This Phone to Your TV
              </h3>
              <p className="mt-1 text-xs text-slate-300">
                Enter the 4-digit room code displayed on your TV screen. Your phone&apos;s front or
                rear camera will become the live hand-tracking controller.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePhoneSubmit();
                }}
                placeholder="4829"
                aria-label="4-digit TV room code"
                className="h-14 w-full rounded-xl border border-white/15 bg-[#0E1310] px-4 text-center font-mono text-2xl font-extrabold tracking-[0.35em] text-[#C8F542] tabular-nums outline-none focus:border-[#C8F542] sm:w-48"
              />

              <button
                type="button"
                onClick={handlePhoneSubmit}
                disabled={codeInput.replace(/\D/g, '').length !== 4}
                className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-[#C8F542] px-6 text-sm font-extrabold text-[#0E1310] transition-transform hover:bg-[#d7fb6a] active:scale-[0.98] disabled:opacity-45 cursor-pointer"
              >
                <Smartphone className="h-4 w-4" />
                Connect Phone Camera to TV
              </button>
            </div>

            {companionError && (
              <p className="rounded-lg border border-[#FB7185]/35 bg-[#2A171B] px-3 py-2 text-xs text-[#FDA4AF]">
                {companionError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
              <span>Install on Android, iPhone, iPad, Mac, or Windows:</span>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenDownloads && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenDownloads();
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#1D2621] px-3 text-xs font-semibold text-[#F4F7F2] hover:border-[#C8F542]/40 hover:bg-[#26322B] whitespace-nowrap cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-[#C8F542]" />
                    All Downloads
                  </button>
                )}
                <PWAInstallButton compact />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PLAY HERE (STANDALONE MOBILE / SCREEN MIRRORING) */}
        {selectedTab === 'STANDALONE' && (
          <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-[#171F1A] p-5">
            <div>
              <h3 className="font-display text-base font-bold text-[#F4F7F2]">
                Direct Play & Screen Mirroring
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                You can also run the full game directly on your phone (with Front or Rear camera)
                and cast your phone screen to any TV via <strong className="text-white">AirPlay</strong>,{' '}
                <strong className="text-white">Chromecast / Smart View</strong>, or a{' '}
                <strong className="text-white">USB-C to HDMI</strong> cable.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {onOpenDownloads && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDownloads();
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/12 bg-[#1D2621] px-4 text-xs font-semibold text-[#F4F7F2] hover:border-[#C8F542]/40 hover:bg-[#26322B] whitespace-nowrap cursor-pointer sm:text-sm"
                >
                  <Download className="h-4 w-4 text-[#C8F542]" />
                  Android / Apple / Windows
                </button>
              )}
              <PWAInstallButton />
              <button
                type="button"
                onClick={() => {
                  onSwitchStandalone();
                  onClose();
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#C8F542] px-5 text-sm font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] cursor-pointer"
              >
                Continue Playing Here
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
