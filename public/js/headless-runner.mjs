import { parseTcx } from './tcx-parser.mjs';
import { buildFlyoverTimeline, evaluateFrameAt } from './flyover-math.mjs';
import { FlyoverMapScene } from './map-scene.mjs';
import { renderHud } from './hud-renderer.mjs';
import { exportInstagramVideo } from './exporter.mjs';
import {
  DEFAULT_TIMELINE_SAMPLES,
  applyActivityToState,
  buildRenderSettings,
  createStudioState
} from './studio-state.mjs';

/**
 * Headless entrypoint invoked by cli.mjs via Playwright.
 * Reuses the exact same parsing, camera choreography, MapLibre 3D terrain,
 * route/HUD rendering, and FFmpeg batch-export pipeline as the web studio.
 */
window.runFlyoverRender = async function runFlyoverRender({
  xmlText,
  fileName = 'activity.tcx',
  stateOverrides = {}
}) {
  const activity = parseTcx(xmlText, fileName);
  const state = applyActivityToState(
    { ...createStudioState(), ...stateOverrides },
    activity,
    stateOverrides
  );

  const settings = {
    ...buildRenderSettings(state),
    // Cold headless browser profile starts with an empty tile cache; allow extra time when tiles are still in-flight.
    prewarmTileWaitMs: 1500,
    exportTileWaitMs: 450
  };
  const timeline = buildFlyoverTimeline(activity, {
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    numSamples: DEFAULT_TIMELINE_SAMPLES,
    trackSmoothness: state.trackSmoothness
  });

  const stageEl = document.getElementById('map-stage');
  stageEl.style.width = `${settings.stageWidth}px`;
  stageEl.style.height = `${settings.stageHeight}px`;

  const mapScene = new FlyoverMapScene(stageEl, {
    mapStyle: settings.mapStyle,
    showLabels: settings.showLabels,
    exaggeration: settings.exaggeration
  });

  try {
    mapScene.resizeStage(settings.stageWidth, settings.stageHeight);
    await mapScene.waitUntilLoaded();

    const result = await exportInstagramVideo({
      timeline,
      settings,
      mapScene,
      evaluateFrameFn: evaluateFrameAt,
      renderHudFn: renderHud,
      onProgress: (info) => {
        if (typeof window.__flyoverProgress === 'function') {
          window.__flyoverProgress(info);
        }
      }
    });

    return {
      ...result,
      title: state.title,
      sport: state.sport,
      totalDistanceM: timeline.totalDistanceM,
      totalElevationGainM: timeline.totalElevationGainM
    };
  } finally {
    mapScene.destroy();
  }
};

window.__flyoverReady = true;
