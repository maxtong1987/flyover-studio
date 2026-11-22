import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineMeters } from '../public/js/tcx-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(__dirname, '../public/samples');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resamples a list of control [lat, lon, ele] waypoints into `targetCount` smooth points
 * using Catmull-Rom interpolation so curves and hairpins look organic.
 */
function interpolateWaypoints(waypoints, targetCount) {
  const n = waypoints.length;
  const result = [];
  for (let i = 0; i < targetCount; i += 1) {
    const t = (i / (targetCount - 1)) * (n - 1);
    const idx = Math.min(n - 2, Math.floor(t));
    const u = t - idx;

    const p0 = waypoints[Math.max(0, idx - 1)];
    const p1 = waypoints[idx];
    const p2 = waypoints[Math.min(n - 1, idx + 1)];
    const p3 = waypoints[Math.min(n - 1, idx + 2)];

    const u2 = u * u;
    const u3 = u2 * u;

    const catmull = (v0, v1, v2, v3) =>
      0.5 * (
        2 * v1 +
        (-v0 + v2) * u +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
        (-v0 + 3 * v1 - 3 * v2 + v3) * u3
      );

    result.push({
      lat: catmull(p0[0], p1[0], p2[0], p3[0]),
      lon: catmull(p0[1], p1[1], p2[1], p3[1]),
      ele: catmull(p0[2], p1[2], p2[2], p3[2])
    });
  }
  return result;
}

function buildTcxXml({
  sport,
  title,
  startIso,
  waypoints,
  pointCount,
  baseSpeedMps,
  baseHr,
  hrAmplitude,
  baseCadence,
  includeWatts = false,
  baseWatts = 240
}) {
  const pts = interpolateWaypoints(waypoints, pointCount);
  const startMs = Date.parse(startIso);
  let totalDist = 0;
  let elapsedSec = 0;
  let maxSpeed = 0;
  let sumHr = 0;
  let maxHr = 0;

  const trackpointBlocks = [];

  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    let segDist = 0;
    let grade = 0;
    if (i > 0) {
      segDist = haversineMeters(pts[i - 1].lat, pts[i - 1].lon, p.lat, p.lon);
      totalDist += segDist;
      grade = segDist > 0.5 ? (p.ele - pts[i - 1].ele) / segDist : 0;
    }

    // Realistic speed variation with terrain grade and mid-activity pacing
    const progress = i / (pts.length - 1);
    const gradeFactor = Math.max(0.45, Math.min(1.38, 1 - grade * 2.4));
    const surge = 1 + 0.08 * Math.sin(progress * Math.PI * 5);
    const speed = Math.max(1.4, baseSpeedMps * gradeFactor * surge);
    if (speed > maxSpeed) maxSpeed = speed;

    if (i > 0) {
      elapsedSec += segDist / speed;
    }

    const timeIso = new Date(startMs + Math.round(elapsedSec * 1000)).toISOString();
    const hr = Math.round(
      Math.max(
        105,
        Math.min(
          192,
          baseHr + hrAmplitude * Math.min(1, progress * 3.5) + Math.max(0, grade * 110) + 4 * Math.sin(progress * 18)
        )
      )
    );
    sumHr += hr;
    if (hr > maxHr) maxHr = hr;

    const cadence = Math.round(baseCadence + (grade > 0.03 ? -4 : 3) + 2 * Math.cos(progress * 14));
    const watts = includeWatts
      ? Math.round(Math.max(110, baseWatts + grade * 950 + 25 * Math.sin(progress * 12)))
      : null;

    const cadenceTag =
      sport === 'Biking'
        ? `            <Cadence>${cadence}</Cadence>\n`
        : '';
    const tpxCadenceTag =
      sport === 'Running'
        ? `                <ns3:RunCadence>${cadence}</ns3:RunCadence>\n`
        : '';
    const tpxWattsTag =
      watts !== null
        ? `                <ns3:Watts>${watts}</ns3:Watts>\n`
        : '';

    trackpointBlocks.push(
      `          <Trackpoint>\n` +
      `            <Time>${timeIso}</Time>\n` +
      `            <Position>\n` +
      `              <LatitudeDegrees>${p.lat.toFixed(6)}</LatitudeDegrees>\n` +
      `              <LongitudeDegrees>${p.lon.toFixed(6)}</LongitudeDegrees>\n` +
      `            </Position>\n` +
      `            <AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>\n` +
      `            <DistanceMeters>${totalDist.toFixed(1)}</DistanceMeters>\n` +
      `            <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>\n` +
      cadenceTag +
      `            <Extensions>\n` +
      `              <ns3:TPX>\n` +
      `                <ns3:Speed>${speed.toFixed(2)}</ns3:Speed>\n` +
      tpxCadenceTag +
      tpxWattsTag +
      `              </ns3:TPX>\n` +
      `            </Extensions>\n` +
      `          </Trackpoint>`
    );
  }

  const avgHr = Math.round(sumHr / pts.length);
  const calories = Math.round((elapsedSec / 60) * (sport === 'Biking' ? 14 : 13));

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
    <Activity Sport="${escapeXml(sport)}">
      <Id>${startIso}</Id>
      <Notes>${escapeXml(title)}</Notes>
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${elapsedSec.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${totalDist.toFixed(1)}</DistanceMeters>
        <MaximumSpeed>${maxSpeed.toFixed(2)}</MaximumSpeed>
        <Calories>${calories}</Calories>
        <AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpointBlocks.join('\n')}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

// 1. Marin Headlands & Hawk Hill Ridge Run (~11.2 km coastal trail loop around 37.827, -122.499)
const marinWaypoints = [
  [37.8322, -122.4812, 24],
  [37.8295, -122.4870, 72],
  [37.8266, -122.4932, 138],
  [37.8258, -122.4992, 224],
  [37.8270, -122.5020, 281], // Hawk Hill summit
  [37.8234, -122.5078, 188],
  [37.8206, -122.5155, 88],
  [37.8224, -122.5252, 46],  // Point Bonita ridge
  [37.8304, -122.5298, 32],  // Rodeo Beach overlook
  [37.8378, -122.5256, 84],
  [37.8424, -122.5158, 165], // Miwok ridge
  [37.8405, -122.5042, 198],
  [37.8364, -122.4938, 126],
  [37.8324, -122.4816, 26]
];

// 2. Alpe d'Huez 21 Hairpins Climb (~13.8 km, ~1,060m climb from Bourg-d'Oisans 45.062, 6.030 to 45.091, 6.070)
const alpeWaypoints = [
  [45.0525, 6.0260, 720],  // Le Bourg-d'Oisans approach
  [45.0620, 6.0300, 745],  // Base of climb
  [45.0654, 6.0385, 792],  // Hairpin 21
  [45.0616, 6.0428, 845],  // Hairpin 19
  [45.0668, 6.0372, 898],  // Hairpin 17
  [45.0684, 6.0468, 955],  // Hairpin 15
  [45.0638, 6.0504, 1018], // Hairpin 14
  [45.0694, 6.0518, 1085], // La Garde
  [45.0714, 6.0436, 1142], // Hairpin 12
  [45.0754, 6.0498, 1204], // Hairpin 10
  [45.0708, 6.0558, 1266], // Hairpin 9
  [45.0764, 6.0566, 1330], // Hairpin 7 (Huez)
  [45.0802, 6.0496, 1396], // Hairpin 6
  [45.0812, 6.0604, 1468], // Hairpin 5
  [45.0766, 6.0642, 1538], // Hairpin 4
  [45.0836, 6.0652, 1612], // Hairpin 3
  [45.0872, 6.0574, 1680], // Hairpin 2
  [45.0888, 6.0664, 1748], // Hairpin 1
  [45.0910, 6.0700, 1805]  // Alpe d'Huez Summit
];

// 3. Central Park Full Loop Tempo (~9.7 km around 40.782, -73.965)
const centralParkWaypoints = [
  [40.7681, -73.9815, 22], // Columbus Circle start
  [40.7745, -73.9772, 26],
  [40.7825, -73.9718, 31],
  [40.7905, -73.9654, 28],
  [40.7986, -73.9588, 38], // Harlem Hill climb
  [40.8004, -73.9548, 43], // North end
  [40.7972, -73.9502, 24], // East Drive descent
  [40.7894, -73.9554, 29],
  [40.7812, -73.9612, 33], // Reservoir east
  [40.7734, -73.9668, 27],
  [40.7662, -73.9726, 23], // South drive
  [40.7681, -73.9812, 22]
];

async function main() {
  await fs.mkdir(SAMPLES_DIR, { recursive: true });

  const specs = [
    {
      filename: 'marin-headlands-trail-run.tcx',
      sport: 'Running',
      title: 'Marin Headlands & Hawk Hill Ridge Run',
      startIso: '2026-10-18T07:15:00Z',
      waypoints: marinWaypoints,
      pointCount: 340,
      baseSpeedMps: 3.35,
      baseHr: 146,
      hrAmplitude: 18,
      baseCadence: 86,
      includeWatts: false
    },
    {
      filename: 'alpe-dhuez-climb.tcx',
      sport: 'Biking',
      title: "Alpe d'Huez 21 Hairpins Climb",
      startIso: '2026-09-06T08:30:00Z',
      waypoints: alpeWaypoints,
      pointCount: 380,
      baseSpeedMps: 5.2,
      baseHr: 156,
      hrAmplitude: 16,
      baseCadence: 79,
      includeWatts: true,
      baseWatts: 275
    },
    {
      filename: 'central-park-tempo.tcx',
      sport: 'Running',
      title: 'Central Park Full Loop Tempo',
      startIso: '2026-11-02T06:45:00Z',
      waypoints: centralParkWaypoints,
      pointCount: 320,
      baseSpeedMps: 4.15,
      baseHr: 158,
      hrAmplitude: 14,
      baseCadence: 90,
      includeWatts: false
    }
  ];

  for (const spec of specs) {
    const xml = buildTcxXml(spec);
    const outPath = path.join(SAMPLES_DIR, spec.filename);
    await fs.writeFile(outPath, xml, 'utf8');
    const distMatch = xml.match(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/);
    console.log(`Generated ${spec.filename} (lap distance=${distMatch?.[1]}m)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
