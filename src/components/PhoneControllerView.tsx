import { RefObject } from 'react';
import {
  Crosshair,
  FlipHorizontal2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SwitchCamera,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CameraFacingMode,
  CompanionConnectionState,
  GamePhase,
  GestureState,
  RemoteCommand,
  TvHudSyncPayload,
  VideoTransportMode,
} from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';

interface PhoneControllerViewProps {
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  roomCode: string | null;
  connectionState: CompanionConnectionState;
  transportMode: VideoTransportMode;
  companionError: string | null;
  webcamActive: boolean;
  webcamError: string | null;
  cameraFacing: CameraFacingMode;
  mirrorCamera: boolean;
  handsCount: number;
  gestureState: GestureState;
  tvHud: TvHudSyncPayload | null;
  onFlipCamera: () => void;
  onToggleMirror: () => void;
  onRetryCamera: () => void;
  onSendCommand: (cmd: RemoteCommand) => void;
  onExitPhoneMode: () => void;
  onChangeRoom: () => void;
}

export function PhoneControllerView({
  previewCanvasRef,
  roomCode,
  connectionState,
  transportMode,
  companionError,
  webcamActive,
  webcamError,
  cameraFacing,
  mirrorCamera,
  handsCount,
  gestureState,
  tvHud,
  onFlipCamera,
  onToggleMirror,
  onRetryCamera,
  onSendCommand,
  onExitPhoneMode,
  onChangeRoom,
}: PhoneControllerViewProps) {
  const isConnected = connectionState === 'CONNECTED';
  const tvPhase = tvHud?.phase ?? GamePhase.CALIBRATION;
  const tvMuted = tvHud?.muted ?? false;
  const tvPointer = tvHud?.showHandPointer ?? false;

  const linkText = isConnected
    ? transportMode === 'WEBRTC'
      ? 'TV Connected · WebRTC HD'
      : transportMode === 'WS_RELAY'
        ? 'TV Connected · Live Relay'
        : 'TV Connected · Syncing Video'
    : connectionState === 'CONNECTING'
      ? 'Connecting to TV...'
      : 'Waiting for TV...';

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0E1310] text-[#F4F7F2] select-none">
      {/* Compact Top Companion Header */}
      <header className="safe-top safe-x flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#111613] py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tv className="h-4 w-4 shrink-0 text-[#C8F542]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#F4F7F2] min-[380px]:gap-2">
              <span className="font-mono text-[#C8F542] tabular-nums whitespace-nowrap shrink-0">
                Room {roomCode ?? '----'}
              </span>
              <span className="text-white/25 shrink-0" aria-hidden="true">·</span>
              <span className={`min-w-0 truncate font-medium ${isConnected ? 'text-slate-200' : 'text-amber-300'}`}>
                {linkText}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <PWAInstallButton compact className="hidden min-[440px]:inline-flex" />
          <button
            type="button"
            onClick={onChangeRoom}
            className="inline-flex h-11 items-center rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-semibold text-slate-200 hover:bg-[#253029] whitespace-nowrap cursor-pointer min-[380px]:px-3"
          >
            Pair
          </button>
          <button
            type="button"
            onClick={onExitPhoneMode}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-300 hover:bg-[#2A1D20] hover:text-[#FDA4AF] cursor-pointer"
            aria-label="Exit Phone Camera Mode"
            title="Exit Phone Camera Mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Responsive Workspace: Portrait Stack OR Landscape Side-by-Side Split */}
      <div className="flex min-h-0 flex-1 flex-col [@media(orientation:landscape)_and_(max-height:540px)]:flex-row">
        {/* Live Phone Camera Viewfinder (lets user align phone in front of TV) */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0A0E0C]">
          <canvas
            ref={previewCanvasRef}
            className="h-full w-full object-cover"
          />

          {/* Minimal inline framing telemetry */}
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex flex-wrap items-center justify-between gap-1.5 min-[380px]:inset-x-3 min-[380px]:top-3">
            <div className="rounded-lg border border-white/10 bg-[#111613]/82 px-2.5 py-1 text-[11px] font-mono text-slate-200 backdrop-blur-sm">
              {cameraFacing === 'environment' ? 'Rear Camera' : 'Front Camera'} ·{' '}
              <span className={handsCount > 0 ? 'text-[#C8F542]' : 'text-slate-400'}>
                {handsCount} Hand{handsCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#111613]/82 px-2.5 py-1 text-[11px] font-mono text-[#C8F542] backdrop-blur-sm">
              {gestureState === GestureState.ATTACK_CONFIRMED
                ? 'STRIKE SENT'
                : gestureState === GestureState.ATTACK_IN_PROGRESS
                  ? 'SWINGING'
                  : 'LIVE TRACKER'}
            </div>
          </div>

          {/* Camera Error / Companion Error Overlay */}
          {(webcamError || companionError) && (
            <div className="absolute inset-x-3 bottom-3 max-h-[70%] overflow-y-auto rounded-xl border border-[#FB7185]/40 bg-[#231417]/95 p-3.5 backdrop-blur-md sm:inset-x-4 sm:bottom-4 sm:p-4">
              <p className="text-xs font-semibold text-[#FDA4AF]">
                {webcamError ?? companionError}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {webcamError && (
                  <button
                    type="button"
                    onClick={onRetryCamera}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#C8F542] px-4 text-xs font-extrabold text-[#0E1310] cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry Camera
                  </button>
                )}
                {companionError && (
                  <button
                    type="button"
                    onClick={onChangeRoom}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-white/15 bg-[#1B231E] px-4 text-xs font-semibold text-white cursor-pointer"
                  >
                    Enter TV Code Again
                  </button>
                )}
              </div>
            </div>
          )}

          {!webcamActive && !webcamError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-4 text-center">
              <span className="rounded-lg border border-white/12 bg-[#111613]/90 px-4 py-2 text-xs font-medium text-slate-200">
                Starting mobile camera &amp; hand tracker...
              </span>
            </div>
          )}
        </div>

        {/* TV Scoreboard + Ergonomic Remote Controls (bottom dock in portrait, compact right sidebar in landscape) */}
        <div className="flex shrink-0 flex-col border-t border-white/10 bg-[#111613] [@media(orientation:landscape)_and_(max-height:540px)]:w-64 [@media(orientation:landscape)_and_(max-height:540px)]:overflow-y-auto [@media(orientation:landscape)_and_(max-height:540px)]:border-t-0 [@media(orientation:landscape)_and_(max-height:540px)]:border-l sm:[@media(orientation:landscape)_and_(max-height:540px)]:w-72">
          {/* Live Synced TV Scoreboard Strip */}
          <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-white/10 bg-[#141B17] px-2.5 py-2 text-xs min-[380px]:px-3 [@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:540px)]:gap-x-3 [@media(orientation:landscape)_and_(max-height:540px)]:gap-y-1.5">
            <div className="flex flex-col items-center min-[400px]:flex-row min-[400px]:items-baseline min-[400px]:justify-center min-[400px]:gap-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:flex-row [@media(orientation:landscape)_and_(max-height:540px)]:justify-between">
              <span className="text-[10px] text-slate-400 min-[380px]:text-[11px]">Score</span>
              <span className="font-mono text-xs font-extrabold text-[#C8F542] tabular-nums min-[380px]:text-sm">
                {(tvHud?.score ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col items-center min-[400px]:flex-row min-[400px]:items-baseline min-[400px]:justify-center min-[400px]:gap-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:flex-row [@media(orientation:landscape)_and_(max-height:540px)]:justify-between">
              <span className="text-[10px] text-slate-400 min-[380px]:text-[11px]">Killed</span>
              <span className="font-mono text-xs font-bold text-[#F4F7F2] tabular-nums min-[380px]:text-sm">
                {tvHud?.mosquitoesKilled ?? 0}
              </span>
            </div>
            <div className="flex flex-col items-center min-[400px]:flex-row min-[400px]:items-baseline min-[400px]:justify-center min-[400px]:gap-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:flex-row [@media(orientation:landscape)_and_(max-height:540px)]:justify-between">
              <span className="text-[10px] text-slate-400 min-[380px]:text-[11px]">Left</span>
              <span className="font-mono text-xs font-bold text-[#F4F7F2] tabular-nums min-[380px]:text-sm">
                {tvHud?.mosquitoesRemaining ?? 10}
              </span>
            </div>
            <div className="flex flex-col items-center min-[400px]:flex-row min-[400px]:items-baseline min-[400px]:justify-center min-[400px]:gap-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:flex-row [@media(orientation:landscape)_and_(max-height:540px)]:justify-between">
              <span className="text-[10px] text-slate-400 min-[380px]:text-[11px]">Combo</span>
              <span className="font-mono text-xs font-bold text-[#FF6B35] tabular-nums min-[380px]:text-sm">
                {tvHud?.currentCombo ?? 0}x
              </span>
            </div>
          </div>

          {/* Ergonomic Thumb-Zone TV Remote Controls (all targets >= 44px) */}
          <footer className="safe-bottom safe-right shrink-0 px-2.5 pt-2.5 pb-2.5 min-[380px]:px-3">
            <div className="grid grid-cols-4 gap-1.5 min-[380px]:gap-2 [@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2">
              {tvPhase === GamePhase.CALIBRATION || tvPhase === GamePhase.GAME_OVER ? (
                <button
                  type="button"
                  onClick={() => onSendCommand({ action: 'START' })}
                  disabled={!isConnected}
                  className="col-span-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#C8F542] px-3 text-xs font-extrabold text-[#0E1310] active:scale-[0.98] disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:gap-2 min-[380px]:text-sm"
                >
                  <Play className="h-4 w-4 shrink-0 fill-current" />
                  Start on TV
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSendCommand({ action: 'PAUSE_TOGGLE' })}
                  disabled={!isConnected}
                  className="col-span-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#C8F542] px-3 text-xs font-extrabold text-[#0E1310] active:scale-[0.98] disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:gap-2 min-[380px]:text-sm"
                >
                  {tvPhase === GamePhase.PAUSED ? (
                    <>
                      <Play className="h-4 w-4 shrink-0 fill-current" />
                      Resume TV
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 shrink-0" />
                      Pause TV
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={onFlipCamera}
                className="inline-flex h-12 items-center justify-center gap-1 rounded-xl border border-white/12 bg-[#1B231E] px-1.5 text-[11px] font-semibold text-[#F4F7F2] active:scale-[0.98] whitespace-nowrap cursor-pointer min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs"
                title="Switch between Front and Rear phone camera"
              >
                <SwitchCamera className="h-4 w-4 shrink-0 text-[#C8F542]" />
                <span>{cameraFacing === 'user' ? 'Rear' : 'Front'}</span>
              </button>

              <button
                type="button"
                onClick={() => onSendCommand({ action: 'ADD_MOSQUITOES', count: 5 })}
                disabled={!isConnected}
                className="inline-flex h-12 items-center justify-center gap-0.5 rounded-xl border border-white/12 bg-[#1B231E] px-1.5 font-mono text-[11px] font-bold text-[#C8F542] active:scale-[0.98] disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:gap-1 min-[380px]:px-2 min-[380px]:text-xs"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                5 Bugs
              </button>
            </div>

            <div className="mt-1.5 grid grid-cols-4 gap-1.5 min-[380px]:mt-2 min-[380px]:gap-2 [@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2">
              <button
                type="button"
                onClick={() => onSendCommand({ action: 'RESTART' })}
                disabled={!isConnected}
                className="inline-flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 bg-[#18201B] px-1.5 text-[10px] font-medium text-slate-200 disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:flex-row min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                <span>Restart</span>
              </button>

              <button
                type="button"
                onClick={() => onSendCommand({ action: 'TOGGLE_POINTER' })}
                disabled={!isConnected}
                className={`inline-flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 text-[10px] font-medium disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:flex-row min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs ${
                  tvPointer
                    ? 'border-[#C8F542]/40 bg-[#1F2B21] text-[#C8F542]'
                    : 'border-white/10 bg-[#18201B] text-slate-400'
                }`}
              >
                <Crosshair className="h-3.5 w-3.5 shrink-0" />
                <span>Pointer</span>
              </button>

              <button
                type="button"
                onClick={onToggleMirror}
                className={`inline-flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 text-[10px] font-medium whitespace-nowrap cursor-pointer min-[380px]:flex-row min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs ${
                  mirrorCamera
                    ? 'border-[#C8F542]/35 bg-[#1F2B21] text-[#C8F542]'
                    : 'border-white/10 bg-[#18201B] text-slate-300'
                }`}
              >
                <FlipHorizontal2 className="h-3.5 w-3.5 shrink-0" />
                <span>Mirror</span>
              </button>

              <button
                type="button"
                onClick={() => onSendCommand({ action: 'TOGGLE_MUTE' })}
                disabled={!isConnected}
                className="inline-flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 bg-[#18201B] px-1.5 text-[10px] font-medium text-slate-200 disabled:opacity-45 whitespace-nowrap cursor-pointer min-[380px]:flex-row min-[380px]:gap-1.5 min-[380px]:px-2 min-[380px]:text-xs"
              >
                {tvMuted ? (
                  <VolumeX className="h-3.5 w-3.5 shrink-0 text-[#FB7185]" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#C8F542]" />
                )}
                <span>{tvMuted ? 'Muted' : 'Sound'}</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
