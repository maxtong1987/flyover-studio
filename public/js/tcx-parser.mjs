const EARTH_RADIUS_M = 6371000;

export function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function decodeXmlEntities(str) {
  if (!str || !str.includes('&')) return str;
  return str.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, entity) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
          const code = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        }
        if (entity.startsWith('#')) {
          const code = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        }
        return _;
    }
  });
}

function parseAttributes(attrStr) {
  const attrs = {};
  if (!attrStr) return attrs;
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(attrStr)) !== null) {
    const rawKey = match[1];
    const localKey = rawKey.includes(':') ? rawKey.split(':').pop() : rawKey;
    attrs[localKey] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Lightweight, namespace-agnostic XML parser that works identically in Node and Browsers.
 */
export function parseXmlSimple(xmlString) {
  if (typeof xmlString !== 'string' || !xmlString.trim()) {
    throw new Error('XML input is empty');
  }

  let src = xmlString.replace(/^\uFEFF/, '');
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
  src = src.replace(/<\?[\s\S]*?\?>/g, '');
  src = src.replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  const root = { localName: '__root__', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;

  let lastIndex = 0;
  let sawAnyTag = false;
  let match;

  while ((match = tagRe.exec(src)) !== null) {
    sawAnyTag = true;
    if (match.index > lastIndex) {
      const textChunk = src.slice(lastIndex, match.index);
      if (textChunk) {
        stack[stack.length - 1].text += decodeXmlEntities(textChunk);
      }
    }
    lastIndex = tagRe.lastIndex;

    const isClosing = match[1] === '/';
    const rawName = match[2];
    const attrRaw = match[3];
    const isSelfClosing = match[4] === '/';
    const localName = rawName.includes(':') ? rawName.split(':').pop() : rawName;

    if (isClosing) {
      if (stack.length <= 1) {
        throw new Error(`Malformed XML: unexpected closing tag </${rawName}>`);
      }
      const top = stack[stack.length - 1];
      if (top.localName !== localName) {
        // Attempt graceful recovery only if matching ancestor exists near top; otherwise reject.
        throw new Error(`Malformed XML: expected </${top.localName}> but found </${rawName}>`);
      }
      stack.pop();
    } else {
      const node = {
        localName,
        attrs: parseAttributes(attrRaw),
        children: [],
        text: ''
      };
      stack[stack.length - 1].children.push(node);
      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  if (!sawAnyTag || root.children.length === 0) {
    throw new Error('Invalid XML: no root element found');
  }
  if (stack.length !== 1) {
    throw new Error(`Malformed XML: unclosed tag <${stack[stack.length - 1].localName}>`);
  }

  return root.children[0];
}

function findChildren(node, localName) {
  if (!node || !node.children) return [];
  return node.children.filter((c) => c.localName === localName);
}

function findFirstDescendant(node, localName) {
  if (!node || !node.children) return null;
  for (const child of node.children) {
    if (child.localName === localName) return child;
    const nested = findFirstDescendant(child, localName);
    if (nested) return nested;
  }
  return null;
}

function findAllDescendants(node, localName, out = []) {
  if (!node || !node.children) return out;
  for (const child of node.children) {
    if (child.localName === localName) {
      out.push(child);
    }
    findAllDescendants(child, localName, out);
  }
  return out;
}

function getChildText(node, localName) {
  if (!node) return '';
  const child = findChildren(node, localName)[0];
  return child ? child.text.trim() : '';
}

function parseFiniteNum(str) {
  if (str === undefined || str === null || str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

function humanizeFilename(fileName) {
  if (!fileName) return '';
  const stem = String(fileName)
    .replace(/^.*[/\\]/, '')
    .replace(/\.(tcx|gpx|xml)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!stem) return '';
  return stem.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeSport(rawSport) {
  const s = String(rawSport || '').trim().toLowerCase();
  if (!s) return 'Activity';
  if (s.includes('run')) return 'Running';
  if (s.includes('bik') || s.includes('cycl') || s.includes('ride')) return 'Cycling';
  if (s.includes('hik')) return 'Hiking';
  if (s.includes('walk')) return 'Walking';
  if (s.includes('ski')) return 'Skiing';
  return rawSport.trim().charAt(0).toUpperCase() + rawSport.trim().slice(1);
}

function isValidCoordinate(lat, lon, { rejectNullIsland = false } = {}) {
  if (lat === null || lon === null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (rejectNullIsland && lat === 0 && lon === 0) return false;
  return true;
}

function fillMissingElevations(rawPoints) {
  const firstValidIdx = rawPoints.findIndex((p) => p.ele !== null);
  if (firstValidIdx === -1) {
    for (const p of rawPoints) p.ele = 0;
    return false;
  }

  for (let i = 0; i < firstValidIdx; i += 1) {
    rawPoints[i].ele = rawPoints[firstValidIdx].ele;
  }
  let prevValidIdx = firstValidIdx;
  for (let i = firstValidIdx + 1; i < rawPoints.length; i += 1) {
    if (rawPoints[i].ele !== null) {
      const span = i - prevValidIdx;
      if (span > 1) {
        const e0 = rawPoints[prevValidIdx].ele;
        const e1 = rawPoints[i].ele;
        for (let k = 1; k < span; k += 1) {
          rawPoints[prevValidIdx + k].ele = e0 + ((e1 - e0) * k) / span;
        }
      }
      prevValidIdx = i;
    }
  }
  for (let i = prevValidIdx + 1; i < rawPoints.length; i += 1) {
    rawPoints[i].ele = rawPoints[prevValidIdx].ele;
  }
  return true;
}

function parseGpxRoot(root, fileName) {
  const trkpts = findAllDescendants(root, 'trkpt');
  if (trkpts.length === 0) {
    throw new Error('GPX file contains no trackpoints (<trkpt>)');
  }
  const nameNode = findFirstDescendant(root, 'name');
  const typeNode = findFirstDescendant(root, 'type');
  const title = (nameNode?.text?.trim() || humanizeFilename(fileName) || 'GPX Activity').slice(0, 80);
  const sport = normalizeSport(typeNode?.text || 'Running');

  const rawPoints = [];
  for (const pt of trkpts) {
    const lat = parseFiniteNum(pt.attrs.lat);
    const lon = parseFiniteNum(pt.attrs.lon);
    if (!isValidCoordinate(lat, lon)) continue;

    const ele = parseFiniteNum(getChildText(pt, 'ele'));
    const timeStr = getChildText(pt, 'time');
    const timeMs = timeStr ? Date.parse(timeStr) : Number.NaN;
    const hrNode = findFirstDescendant(pt, 'hr');
    const cadNode = findFirstDescendant(pt, 'cad');
    const powerNode = findFirstDescendant(pt, 'power');

    rawPoints.push({
      lat,
      lon,
      ele,
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      rawDist: null,
      hr: parseFiniteNum(hrNode?.text?.trim()),
      cadence: parseFiniteNum(cadNode?.text?.trim()),
      speed: null,
      watts: parseFiniteNum(powerNode?.text?.trim()),
      startTimeIso: timeStr || null
    });
  }

  return finalizeParsedActivity({ title, sport, rawPoints });
}

function finalizeParsedActivity({ title, sport, explicitStartIso = null, rawPoints }) {
  if (rawPoints.length < 2) {
    throw new Error('Track must contain at least 2 valid GPS points with latitude and longitude');
  }

  // Synthesize timestamps if missing or non-monotonic
  const hasAnyTime = rawPoints.some((p) => p.timeMs !== null);
  let lastValidTime = rawPoints.find((p) => p.timeMs !== null)?.timeMs ?? Date.now();
  for (let i = 0; i < rawPoints.length; i += 1) {
    if (!hasAnyTime) {
      rawPoints[i].timeMs = lastValidTime + i * 1000;
    } else if (rawPoints[i].timeMs === null || (i > 0 && rawPoints[i].timeMs < rawPoints[i - 1].timeMs)) {
      rawPoints[i].timeMs = i > 0 ? rawPoints[i - 1].timeMs + 1000 : lastValidTime;
    }
    lastValidTime = rawPoints[i].timeMs;
  }

  // Interpolate missing elevation values from nearest neighbors
  const hasElevation = fillMissingElevations(rawPoints);

  // Validate DistanceMeters: use it only if strictly present for all points and monotonic
  let useRawDist = true;
  let prevRaw = -1;
  for (const p of rawPoints) {
    if (p.rawDist === null || p.rawDist < prevRaw - 0.5) {
      useRawDist = false;
      break;
    }
    prevRaw = p.rawDist;
  }
  const baseRawDist = useRawDist ? rawPoints[0].rawDist : 0;

  let cumulativeHaversine = 0;
  const points = rawPoints.map((p, idx) => {
    if (idx > 0) {
      cumulativeHaversine += haversineMeters(
        rawPoints[idx - 1].lat,
        rawPoints[idx - 1].lon,
        p.lat,
        p.lon
      );
    }
    const distanceM = useRawDist ? Math.max(0, p.rawDist - baseRawDist) : cumulativeHaversine;
    return {
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      timeMs: p.timeMs,
      distanceM,
      hr: p.hr,
      cadence: p.cadence,
      speed: p.speed,
      watts: p.watts
    };
  });

  // Compute fallback instantaneous speed where TPX Speed is missing
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].speed === null) {
      const a = i === 0 ? points[0] : points[i - 1];
      const b = i === 0 ? points[1] : points[i];
      const dt = Math.max(0.5, (b.timeMs - a.timeMs) / 1000);
      const dd = Math.max(0, b.distanceM - a.distanceM);
      points[i].speed = dd / dt;
    }
  }

  const totalDist = points[points.length - 1].distanceM;
  if (totalDist < 5) {
    throw new Error('Track total GPS distance is too small (< 5 meters)');
  }

  const startTimeIso =
    explicitStartIso ||
    rawPoints.find((p) => p.startTimeIso)?.startTimeIso ||
    new Date(points[0].timeMs).toISOString();

  return {
    title,
    sport,
    startTimeIso,
    points,
    hasElevation,
    hasHeartRate: points.some((p) => p.hr !== null),
    hasCadence: points.some((p) => p.cadence !== null),
    hasPower: points.some((p) => p.watts !== null)
  };
}

/**
 * Parses Garmin Training Center XML (.tcx) — and gracefully accepts .gpx fallback —
 * into a normalized activity structure ready for 3D flyover choreography.
 */
export function parseTcx(xmlString, fileName = 'activity.tcx') {
  const root = parseXmlSimple(xmlString);

  if (root.localName === 'gpx') {
    return parseGpxRoot(root, fileName);
  }

  if (root.localName !== 'TrainingCenterDatabase') {
    throw new Error(
      `Unsupported XML root <${root.localName}>. Expected a Garmin TCX (<TrainingCenterDatabase>) or GPX file.`
    );
  }

  const activitiesNode = findFirstDescendant(root, 'Activities');
  const activityNode = activitiesNode ? findChildren(activitiesNode, 'Activity')[0] : null;
  const courseNode = !activityNode ? findFirstDescendant(root, 'Course') : null;

  const containerNode = activityNode || courseNode;
  if (!containerNode) {
    throw new Error('TCX file does not contain any <Activity> or <Course> data');
  }

  const rawSport = activityNode?.attrs?.Sport || (courseNode ? 'Cycling' : 'Activity');
  const sport = normalizeSport(rawSport);

  const notesText = getChildText(containerNode, 'Notes') || getChildText(containerNode, 'Name');
  const firstNoteLine = notesText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  const title = (firstNoteLine || humanizeFilename(fileName) || `${sport} Activity`).slice(0, 80);

  const explicitStartIso = getChildText(containerNode, 'Id') || null;
  const trackpoints = findAllDescendants(containerNode, 'Trackpoint');
  if (trackpoints.length === 0) {
    throw new Error('TCX file contains no <Trackpoint> elements');
  }

  const rawPoints = [];
  for (const tp of trackpoints) {
    const posNode = findChildren(tp, 'Position')[0];
    if (!posNode) continue;

    const lat = parseFiniteNum(getChildText(posNode, 'LatitudeDegrees'));
    const lon = parseFiniteNum(getChildText(posNode, 'LongitudeDegrees'));
    if (!isValidCoordinate(lat, lon, { rejectNullIsland: true })) {
      continue;
    }

    const ele = parseFiniteNum(getChildText(tp, 'AltitudeMeters'));
    const timeStr = getChildText(tp, 'Time');
    const timeMs = timeStr ? Date.parse(timeStr) : Number.NaN;
    const rawDist = parseFiniteNum(getChildText(tp, 'DistanceMeters'));

    const hrNode = findChildren(tp, 'HeartRateBpm')[0];
    const hr = hrNode ? parseFiniteNum(getChildText(hrNode, 'Value')) : null;

    let cadence = parseFiniteNum(getChildText(tp, 'Cadence'));
    const tpxNode = findFirstDescendant(tp, 'TPX');
    if (cadence === null && tpxNode) {
      cadence = parseFiniteNum(getChildText(tpxNode, 'RunCadence'));
    }
    const speed = tpxNode ? parseFiniteNum(getChildText(tpxNode, 'Speed')) : null;
    const watts = tpxNode ? parseFiniteNum(getChildText(tpxNode, 'Watts')) : null;

    rawPoints.push({
      lat,
      lon,
      ele,
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      rawDist,
      hr,
      cadence,
      speed,
      watts,
      startTimeIso: timeStr || null
    });
  }

  return finalizeParsedActivity({ title, sport, explicitStartIso, rawPoints });
}
