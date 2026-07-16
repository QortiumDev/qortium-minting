import { useEffect, useRef } from 'react';

export function useSmartRefresh(onPoll: () => Promise<void> | void, onNow: () => void) {
  const poll = useRef(onPoll); const tick = useRef(onNow); poll.current = onPoll; tick.current = onNow;

  useEffect(() => {
    let active = true;
    let heightTimer = 0;
    let nowTimer = 0;

    const stop = () => {
      window.clearTimeout(heightTimer);
      window.clearInterval(nowTimer);
    };

    const schedulePoll = () => {
      window.clearTimeout(heightTimer);
      heightTimer = window.setTimeout(() => void runPoll(), 30_000);
    };

    const runPoll = async () => {
      if (!active || document.hidden) return;

      try {
        await poll.current();
      } finally {
        if (active && !document.hidden) schedulePoll();
      }
    };

    const start = () => {
      stop();
      tick.current();
      nowTimer = window.setInterval(() => tick.current(), 30_000);
      void runPoll();
    };

    const visibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener('visibilitychange', visibility);

    return () => {
      active = false;
      stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
