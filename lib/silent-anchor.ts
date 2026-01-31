/**
 * Silent anchor: keeps Web Audio API AudioContext active in background.
 * Uses an OscillatorNode to generate a continuous, nearly-silent tone.
 * This prevents the browser from suspending the AudioContext when the tab
 * is inactive or the screen is locked on mobile devices.
 *
 * Must be started when playback starts and stopped when playback pauses/stops.
 */

let audioContext: AudioContext | null = null;
let oscillatorNode: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let isRunning = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!audioContext) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
      audioContext = new AudioContextClass();
    } catch (error) {
      console.warn("Failed to create AudioContext for silent anchor:", error);
      return null;
    }
  }

  return audioContext;
}

export function startSilentAnchor(): void {
  if (isRunning) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Resume AudioContext if suspended (required on some mobile browsers)
    if (ctx.state === "suspended") {
      ctx.resume().catch((err) => {
        console.warn("Failed to resume AudioContext:", err);
      });
    }

    // Create oscillator node (generates continuous sine wave)
    oscillatorNode = ctx.createOscillator();
    oscillatorNode.type = "sine";
    oscillatorNode.frequency.value = 20; // 20Hz - below human hearing range

    // Create gain node (controls volume)
    gainNode = ctx.createGain();
    gainNode.gain.value = 0.001; // Very quiet (0.1% volume)

    // Connect: Oscillator -> Gain -> Destination (speakers)
    oscillatorNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Start oscillator
    oscillatorNode.start();

    isRunning = true;
  } catch (error) {
    console.warn("Failed to start silent anchor:", error);
  }
}

export function stopSilentAnchor(): void {
  if (!isRunning) return;

  try {
    // Stop and disconnect oscillator
    if (oscillatorNode) {
      oscillatorNode.stop();
      oscillatorNode.disconnect();
      oscillatorNode = null;
    }

    // Disconnect gain node
    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }

    isRunning = false;
  } catch (error) {
    console.warn("Failed to stop silent anchor:", error);
  }
}

/**
 * Check if silent anchor is currently running
 */
export function isSilentAnchorActive(): boolean {
  return isRunning;
}

/**
 * Get the current AudioContext (if created)
 */
export function getSilentAnchorContext(): AudioContext | null {
  return audioContext;
}
