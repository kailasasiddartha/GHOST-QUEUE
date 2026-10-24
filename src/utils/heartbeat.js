export function startVisibilityAwareHeartbeat(onBeat, intervalMs = 2 * 60 * 1000) {
  if (typeof window === "undefined" || typeof onBeat !== "function") {
    return () => {};
  }

  let intervalId = null;

  const stop = () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };

  const beat = () => {
    if (document.visibilityState === "hidden") {
      return;
    }

    onBeat();
  };

  const start = () => {
    if (intervalId === null) {
      intervalId = window.setInterval(beat, intervalMs);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }

    beat();
    start();
  };

  start();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
