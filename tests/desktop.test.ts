import { describe, it } from 'node:test';
import assert from 'node:assert';
import { captureMediaStreamFrame, captureDesktop } from '../src/utils/capture';
import { CaptureSettings } from '../src/types';

describe('Desktop / Full-Screen Capture (P1-5)', () => {
  it('captureMediaStreamFrame draws video to canvas and stops stream tracks', async () => {
    let stoppedTracks = 0;
    const mockTrack = {
      stop: () => {
        stoppedTracks++;
      },
    };

    const mockStream = {
      getTracks: () => [mockTrack, mockTrack],
    } as unknown as MediaStream;

    const originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === 'video') {
          return {
            set srcObject(_: any) {},
            set muted(_: boolean) {},
            videoWidth: 1920,
            videoHeight: 1080,
            set onloadedmetadata(fn: any) {
              if (fn) setTimeout(fn, 5);
            },
            play: async () => {},
          };
        }
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: () => {},
            }),
            toDataURL: (mime: string) => `data:${mime};base64,mockDesktopFrame`,
          };
        }
        return {};
      },
    };

    try {
      const result = await captureMediaStreamFrame(mockStream, 'png', 0.9);

      assert.strictEqual(result.width, 1920);
      assert.strictEqual(result.height, 1080);
      assert.ok(result.dataUrl.startsWith('data:image/png'));
      assert.strictEqual(stoppedTracks, 2, 'All tracks must be stopped after capturing frame');
    } finally {
      (globalThis as any).document = originalDocument;
    }
  });

  it('captureDesktop handles user cancelling picker cleanly', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getDisplayMedia: async () => {
            const err = new Error('Permission denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      },
      configurable: true,
      writable: true,
    });

    const settings: CaptureSettings = {
      format: 'png',
      quality: 0.9,
      scrollDelayMs: 250,
      hideStickyElements: false,
      autoDownload: false,
      copyToClipboard: false,
      filenameTemplate: '{title}',
      captureDelaySec: 0,
    };

    try {
      await assert.rejects(
        async () => {
          await captureDesktop(settings);
        },
        {
          message: 'Screen capture cancelled.',
        }
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalDescriptor);
      } else {
        delete (globalThis as any).navigator;
      }
    }
  });

  it('captureDesktop returns simulated fallback in node environment without getDisplayMedia', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: undefined,
      },
      configurable: true,
      writable: true,
    });

    const settings: CaptureSettings = {
      format: 'jpeg',
      quality: 0.85,
      scrollDelayMs: 250,
      hideStickyElements: false,
      autoDownload: false,
      copyToClipboard: false,
      filenameTemplate: '{title}',
      captureDelaySec: 0,
    };

    try {
      const item = await captureDesktop(settings);
      assert.strictEqual(item.mode, 'desktop');
      assert.strictEqual(item.format, 'jpeg');
      assert.strictEqual(item.width, 1920);
      assert.strictEqual(item.height, 1080);
      assert.ok(item.title.includes('Desktop Screen Capture'));
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalDescriptor);
      } else {
        delete (globalThis as any).navigator;
      }
    }
  });
});
