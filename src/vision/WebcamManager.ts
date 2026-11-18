import { RESOLUTION_MAP } from '../config/defaults';
import { CameraDeviceOption, CameraFacingMode, CameraResolutionPreset } from '../types/game';

export interface WebcamState {
  active: boolean;
  width: number;
  height: number;
  deviceId: string;
  facingMode: CameraFacingMode;
  error: string | null;
}

export class WebcamManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public async enumerateCameras(): Promise<CameraDeviceOption[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  public async start(
    video: HTMLVideoElement,
    resolution: CameraResolutionPreset,
    deviceId?: string,
    facingMode: CameraFacingMode = 'user',
  ): Promise<WebcamState> {
    this.stop();
    this.videoElement = video;

    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        active: false,
        width: 0,
        height: 0,
        deviceId: '',
        facingMode,
        error: 'Camera API is not supported in this browser context.',
      };
    }

    const preset = RESOLUTION_MAP[resolution];
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: 60, min: 20 },
    };

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = { ideal: facingMode };
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch {
        // Retry with relaxed constraints if exact resolution or facingMode fails on mobile
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { deviceId } : { facingMode },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      this.stream = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          video.removeEventListener('loadedmetadata', onReady);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('loadedmetadata', onReady);
          video.removeEventListener('error', onError);
          reject(new Error('Failed to decode video metadata'));
        };
        if (video.readyState >= 1) {
          resolve();
        } else {
          video.addEventListener('loadedmetadata', onReady);
          video.addEventListener('error', onError);
        }
      });

      await video.play();

      const track = stream.getVideoTracks()[0];
      const trackSettings = track?.getSettings?.() ?? {};
      const resolvedFacing: CameraFacingMode =
        trackSettings.facingMode === 'environment' ? 'environment' : facingMode;

      return {
        active: true,
        width: video.videoWidth || trackSettings.width || preset.width,
        height: video.videoHeight || trackSettings.height || preset.height,
        deviceId: trackSettings.deviceId || deviceId || '',
        facingMode: resolvedFacing,
        error: null,
      };
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera access was denied. Grant camera permission or switch to Practice Mode.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No camera was detected on this device. Connect a camera, pair your phone, or enable Practice Mode.'
            : err instanceof Error
              ? err.message
              : 'Unable to initialize camera stream.';
      return {
        active: false,
        width: 0,
        height: 0,
        deviceId: '',
        facingMode,
        error: msg,
      };
    }
  }

  public stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }
}
