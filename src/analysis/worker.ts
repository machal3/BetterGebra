import { analyse, type AnalysisRequest } from './compute';

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  try {
    self.postMessage(analyse(e.data));
  } catch (err) {
    // A bug in one analysis must not stall the queue: answer with an empty result.
    console.error(err);
    self.postMessage({ gen: e.data.gen, activeId: e.data.activeId, values: null, roots: '—', intersections: null, marks: [], snaps: [], setPoints: {} });
  }
};
