import { useEffect, useState, type RefObject } from 'react';

const speeds = [1, 2, 4, 8, 16];

function nextSpeed(current: number, direction: -1 | 1) {
  if (!current) return direction;
  const index = speeds.findIndex((speed) => speed >= Math.abs(current));
  const step = index < 0 ? speeds.length - 1 : index;
  if (Math.sign(current) === direction)
    return direction * speeds[Math.min(step + 1, speeds.length - 1)];
  return step === 0 ? 0 : Math.sign(current) * speeds[step - 1];
}

function isEditing(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input:not([type="range"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="radio"]):not([type="reset"])',
  );
}

// Native playback handles forward shuttle. Reverse uses bounded, non-overlapping
// seeks because browsers do not consistently support negative playbackRate.
export function useShuttlePlayback(
  video: RefObject<HTMLVideoElement | null>,
  source: string,
  ready: boolean,
) {
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const player = video.current;
    if (!player || !source || !ready) return;
    let current = player.paused ? 0 : player.playbackRate;
    let frame = 0;
    let generation = 0;
    let disposed = false;

    function update(value: number) {
      current = value;
      setSpeed(value);
    }
    function cancelReverse() {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    function pause() {
      generation++;
      cancelReverse();
      update(0);
      player!.pause();
      player!.playbackRate = 1;
    }
    function shuttle(value: number) {
      const request = ++generation;
      cancelReverse();
      setError('');
      if (!value || (value < 0 && player!.currentTime <= 0)) {
        pause();
        return;
      }
      update(value);
      if (value < 0) {
        player!.pause();
        player!.playbackRate = 1;
        let previous = performance.now();
        const rewind = (now: number) => {
          if (disposed || current >= 0) return;
          // Wait for each seek to finish instead of piling up decoding requests.
          if (!player!.seeking && now - previous >= 80) {
            const elapsed = Math.min((now - previous) / 1000, 1);
            previous = now;
            player!.currentTime = Math.max(0, player!.currentTime + elapsed * current);
            if (player!.currentTime <= 0) {
              pause();
              return;
            }
          }
          frame = requestAnimationFrame(rewind);
        };
        frame = requestAnimationFrame(rewind);
      } else {
        if (player!.ended || player!.currentTime >= player!.duration) player!.currentTime = 0;
        try {
          player!.playbackRate = value;
          void player!.play().catch((cause: unknown) => {
            if (disposed || generation !== request) return;
            pause();
            if (!(cause instanceof DOMException && cause.name === 'AbortError'))
              setError('Playback could not start. Try the player controls or reopen Preview.');
          });
        } catch {
          pause();
          setError('This playback speed is unavailable in your browser. Try a lower speed.');
        }
      }
    }
    function keydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (
        !['j', 'k', 'l'].includes(key) ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
        event.composedPath().some(isEditing) ||
        isEditing(document.activeElement)
      )
        return;
      event.preventDefault();
      // Holding a key must not race straight to the highest speed.
      if (event.repeat) return;
      shuttle(key === 'k' ? 0 : nextSpeed(current, key === 'j' ? -1 : 1));
    }
    function playing() {
      // A queued play event can arrive after K or J interrupted play().
      if (player!.paused) return;
      generation++;
      cancelReverse();
      update(player!.playbackRate);
    }
    function paused() {
      if (current < 0 || !player!.paused) return;
      pause();
    }
    function rateChanged() {
      if (current >= 0 && !player!.paused) update(player!.playbackRate);
    }
    function visibilityChanged() {
      if (document.hidden && current < 0) pause();
    }
    update(current);
    document.addEventListener('keydown', keydown);
    document.addEventListener('visibilitychange', visibilityChanged);
    player.addEventListener('play', playing);
    player.addEventListener('pause', paused);
    player.addEventListener('ratechange', rateChanged);
    player.addEventListener('ended', pause);
    player.addEventListener('error', pause);
    return () => {
      disposed = true;
      generation++;
      cancelReverse();
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', visibilityChanged);
      player.removeEventListener('play', playing);
      player.removeEventListener('pause', paused);
      player.removeEventListener('ratechange', rateChanged);
      player.removeEventListener('ended', pause);
      player.removeEventListener('error', pause);
      player.pause();
      player.playbackRate = 1;
    };
  }, [video, source, ready]);
  return { speed: ready ? speed : 0, error };
}
