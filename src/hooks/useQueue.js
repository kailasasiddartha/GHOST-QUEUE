import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { updateHeartbeat } from "../utils/firestore";
import { startVisibilityAwareHeartbeat } from "../utils/heartbeat";

const AVG_SERVICE_MINS = 3;

function getEntryWeight(entry) {
  const members = Number(entry?.member_count ?? 1);
  return Number.isFinite(members) && members > 0 ? members : 1;
}

function buildInitialState() {
  return {
    position: null,
    waitMins: 0,
    avgServiceMins: AVG_SERVICE_MINS,
    totalInQueue: 0,
    progress: 0,
    entries: [],
    myEntry: null,
    storeMeta: null,
    isServed: false,
    inQueue: false,
    loading: true,
    storeMissing: false,
    error: null,
  };
}

export function useQueue(storeId, userId) {
  const [state, setState] = useState(buildInitialState);
  const totalAtJoinRef = useRef(null);
  const wasInQueueRef = useRef(false);
  const avgServiceMinsRef = useRef(AVG_SERVICE_MINS);

  useEffect(() => {
    if (!storeId) {
      return undefined;
    }

    totalAtJoinRef.current = null;
    wasInQueueRef.current = false;
    avgServiceMinsRef.current = AVG_SERVICE_MINS;

    const ready = { queue: false, store: false, entry: !userId };
    const markReady = (key) => {
      ready[key] = true;
      if (ready.queue && ready.store && ready.entry) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    const handleStoreSnapshot = (snapshot) => {
      const meta = snapshot.exists() ? snapshot.data() : null;
      const avgServiceMins = Number(meta?.avg_service_mins ?? AVG_SERVICE_MINS) || AVG_SERVICE_MINS;
      avgServiceMinsRef.current = avgServiceMins;
      setState((prev) => ({
        ...prev,
        storeMeta: meta,
        avgServiceMins,
        storeMissing: !snapshot.exists(),
      }));
      markReady("store");
    };

    const unsubscribers = [];

    if (!userId) {
      unsubscribers.push(onSnapshot(
        query(collection(db, "stores", storeId, "entries"), orderBy("queue_index", "asc")),
        (snapshot) => {
          const entries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
          setState((prev) => ({ ...prev, entries, totalInQueue: entries.length }));
          markReady("queue");
        },
        () => setState((prev) => ({ ...prev, error: "Could not load the live queue.", loading: false }))
      ));

      unsubscribers.push(onSnapshot(
        doc(db, "stores", storeId, "meta", "info"),
        handleStoreSnapshot,
        () => setState((prev) => ({ ...prev, error: "Could not load store details.", loading: false }))
      ));
    } else {
      unsubscribers.push(onSnapshot(
        query(collection(db, "publicStores", storeId, "liveQueue"), orderBy("queue_index", "asc")),
        (snapshot) => {
          const entries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
          const myIndex = entries.findIndex((entry) => entry.id === userId);
          const inQueue = myIndex !== -1;

          if (inQueue && totalAtJoinRef.current === null) {
            totalAtJoinRef.current = entries.length;
          }

          const isServed = wasInQueueRef.current && !inQueue;
          wasInQueueRef.current = inQueue;

          if (!inQueue) {
            setState((prev) => ({
              ...prev,
              entries,
              inQueue: false,
              totalInQueue: entries.length,
              position: null,
              waitMins: 0,
              progress: 0,
              isServed,
            }));
            markReady("queue");
            return;
          }

          const position = myIndex + 1;
          const aheadWeight = entries.slice(0, myIndex).reduce((sum, entry) => sum + getEntryWeight(entry), 0);
          const totalAtJoin = totalAtJoinRef.current ?? entries.length;
          const progress = totalAtJoin > 0 ? (totalAtJoin - (position - 1)) / totalAtJoin : 1;

          setState((prev) => ({
            ...prev,
            entries,
            inQueue: true,
            totalInQueue: entries.length,
            position,
            waitMins: Math.round(aheadWeight * avgServiceMinsRef.current),
            progress: Math.min(Math.max(progress, 0), 1),
            isServed,
          }));
          markReady("queue");
        },
        () => setState((prev) => ({ ...prev, error: "Could not load queue status.", loading: false }))
      ));

      unsubscribers.push(onSnapshot(
        doc(db, "publicStores", storeId),
        handleStoreSnapshot,
        () => setState((prev) => ({ ...prev, error: "Could not load store details.", loading: false }))
      ));

      unsubscribers.push(onSnapshot(
        doc(db, "stores", storeId, "entries", userId),
        (snapshot) => {
          setState((prev) => ({ ...prev, myEntry: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null }));
          markReady("entry");
        },
        () => setState((prev) => ({ ...prev, error: "Could not load your queue ticket.", loading: false }))
      ));
    }

    let stopHeartbeat = null;
    if (userId) {
      stopHeartbeat = startVisibilityAwareHeartbeat(() => updateHeartbeat(storeId, userId));
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (stopHeartbeat) stopHeartbeat();
    };
  }, [storeId, userId]);

  return state;
}
