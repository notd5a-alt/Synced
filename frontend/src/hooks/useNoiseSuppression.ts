/**
 * useNoiseSuppression — RNNoise AI-powered noise suppression via Web Audio API.
 *
 * Inserts a real-time neural network denoiser between the microphone track and
 * the WebRTC peer connection. Uses @shiguredo/rnnoise-wasm (Apache-2.0) which
 * is a WebAssembly build of Xiph.org's RNNoise library.
 *
 * Pipeline when enabled:
 *   mic track → AudioContext(48kHz) → ScriptProcessor → RNNoise WASM → destination → PC sender
 *
 * When disabled, the original mic track is used directly.
 */

import { useRef, useCallback, useState } from "react";
import type { MutableRefObject } from "react";

// Lazy-loaded RNNoise singleton
let rnnoisePromise: Promise<RnnoiseInstance> | null = null;

interface RnnoiseInstance {
  frameSize: number;
  createDenoiseState: () => DenoiseState;
}

interface DenoiseState {
  processFrame: (frame: Float32Array) => number;
  destroy: () => void;
}

async function getRnnoise(): Promise<RnnoiseInstance> {
  if (!rnnoisePromise) {
    rnnoisePromise = import("@shiguredo/rnnoise-wasm").then((mod) =>
      mod.Rnnoise.load(),
    );
  }
  return rnnoisePromise;
}

/** Pre-load the WASM module (call early to avoid latency on first toggle). */
export function preloadRnnoise(): void {
  getRnnoise().catch(() => {
    // WASM load failed — AI NS won't be available
    rnnoisePromise = null;
  });
}

export interface NoiseSuppression {
  /** Whether AI noise suppression is currently active. */
  enabled: boolean;
  /** Toggle AI NS on/off. Returns the new track to use (processed or original). */
  toggle: (
    originalTrack: MediaStreamTrack,
    pcRef: MutableRefObject<RTCPeerConnection | null>,
    localStreamRef: MutableRefObject<MediaStream | null>,
  ) => Promise<MediaStreamTrack | null>;
  /** Tear down the processing pipeline (call on endCall / cleanup). */
  teardown: () => void;
}

export default function useNoiseSuppression(): NoiseSuppression {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const denoiseRef = useRef<DenoiseState | null>(null);
  const originalTrackRef = useRef<MediaStreamTrack | null>(null);
  const processedTrackRef = useRef<MediaStreamTrack | null>(null);

  const teardown = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* ok */ }
    try { sourceRef.current?.disconnect(); } catch { /* ok */ }
    try { destRef.current?.disconnect(); } catch { /* ok */ }
    denoiseRef.current?.destroy();
    // Close the dedicated AudioContext (not the global one used for UI sounds)
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    destRef.current = null;
    denoiseRef.current = null;
    originalTrackRef.current = null;
    processedTrackRef.current = null;
    setEnabled(false);
  }, []);

  const enablePipeline = useCallback(
    async (
      micTrack: MediaStreamTrack,
      pcRef: MutableRefObject<RTCPeerConnection | null>,
      localStreamRef: MutableRefObject<MediaStream | null>,
    ): Promise<MediaStreamTrack | null> => {
      try {
        const rnnoise = await getRnnoise();
        const FRAME_SIZE = rnnoise.frameSize; // 480 samples (10ms @ 48kHz)

        // Force 48kHz — RNNoise only supports this sample rate
        const ctx = new AudioContext({ sampleRate: 48000 });
        ctxRef.current = ctx;

        const state = rnnoise.createDenoiseState();
        denoiseRef.current = state;

        const source = ctx.createMediaStreamSource(new MediaStream([micTrack]));
        sourceRef.current = source;

        const dest = ctx.createMediaStreamDestination();
        destRef.current = dest;

        // Buffer size 4096 is a good balance: ~85ms latency at 48kHz.
        // Each callback processes multiple 480-sample RNNoise frames.
        const BUFFER_SIZE = 4096;
        const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        // Ring buffer for accumulating input into 480-sample RNNoise frames
        const frameBuf = new Float32Array(FRAME_SIZE);
        let frameBufOffset = 0;
        // Queue of denoised 480-sample frames ready to be read into output
        const outputQueue: Float32Array[] = [];

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer.getChannelData(0);
          const output = e.outputBuffer.getChannelData(0);

          // Feed input samples into RNNoise in 480-sample chunks
          let inIdx = 0;
          while (inIdx < input.length) {
            const need = FRAME_SIZE - frameBufOffset;
            const avail = input.length - inIdx;
            const n = Math.min(need, avail);

            for (let i = 0; i < n; i++) {
              // RNNoise expects 16-bit PCM range (-32768..32767) as float
              frameBuf[frameBufOffset + i] = input[inIdx + i] * 32768;
            }
            frameBufOffset += n;
            inIdx += n;

            if (frameBufOffset === FRAME_SIZE) {
              state.processFrame(frameBuf); // in-place denoising
              // Scale back to [-1, 1] and queue for output
              const denoised = new Float32Array(FRAME_SIZE);
              for (let i = 0; i < FRAME_SIZE; i++) {
                denoised[i] = frameBuf[i] / 32768;
              }
              outputQueue.push(denoised);
              frameBufOffset = 0;
            }
          }

          // Read denoised frames into output buffer
          let outIdx = 0;
          while (outputQueue.length > 0 && outIdx < output.length) {
            const frame = outputQueue[0];
            const copyLen = Math.min(frame.length, output.length - outIdx);
            output.set(frame.subarray(0, copyLen), outIdx);
            outIdx += copyLen;
            if (copyLen < frame.length) {
              // Partial frame consumed — shift remainder for next callback
              outputQueue[0] = frame.subarray(copyLen);
            } else {
              outputQueue.shift();
            }
          }
          // Fill remaining output with silence (pipeline startup latency)
          while (outIdx < output.length) {
            output[outIdx++] = 0;
          }
        };

        source.connect(processor);
        processor.connect(dest);

        const processedTrack = dest.stream.getAudioTracks()[0];
        originalTrackRef.current = micTrack;
        processedTrackRef.current = processedTrack;

        // Replace mic track on the PC sender with the denoised track
        const pc = pcRef.current;
        if (pc) {
          const sender = pc
            .getSenders()
            .find((s) => s.track?.kind === "audio" || s.track === micTrack);
          if (sender) {
            await sender.replaceTrack(processedTrack);
          }
        }

        // Swap track in local stream (so useMicLevel / useVAD see the right track)
        const ls = localStreamRef.current;
        if (ls) {
          ls.removeTrack(micTrack);
          ls.addTrack(processedTrack);
        }

        setEnabled(true);
        return processedTrack;
      } catch (err) {
        console.warn("RNNoise enable failed:", err);
        teardown();
        return null;
      }
    },
    [teardown],
  );

  const disablePipeline = useCallback(
    async (
      pcRef: MutableRefObject<RTCPeerConnection | null>,
      localStreamRef: MutableRefObject<MediaStream | null>,
    ): Promise<MediaStreamTrack | null> => {
      const original = originalTrackRef.current;
      const processed = processedTrackRef.current;
      if (!original) {
        teardown();
        return null;
      }

      // Restore original mic track on PC sender
      const pc = pcRef.current;
      if (pc) {
        const sender = pc
          .getSenders()
          .find((s) => s.track === processed || s.track?.kind === "audio");
        if (sender) {
          await sender.replaceTrack(original);
        }
      }

      // Swap back in local stream
      const ls = localStreamRef.current;
      if (ls && processed) {
        ls.removeTrack(processed);
        ls.addTrack(original);
      }

      teardown();
      return original;
    },
    [teardown],
  );

  const toggle = useCallback(
    async (
      currentTrack: MediaStreamTrack,
      pcRef: MutableRefObject<RTCPeerConnection | null>,
      localStreamRef: MutableRefObject<MediaStream | null>,
    ): Promise<MediaStreamTrack | null> => {
      if (enabled) {
        return disablePipeline(pcRef, localStreamRef);
      } else {
        // Use the original mic track (not the processed one) as input
        const micTrack = originalTrackRef.current || currentTrack;
        return enablePipeline(micTrack, pcRef, localStreamRef);
      }
    },
    [enabled, enablePipeline, disablePipeline],
  );

  return { enabled, toggle, teardown };
}
