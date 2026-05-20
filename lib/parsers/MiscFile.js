const fs = require('fs');

//
// war3mapMisc.txt — the map's Gameplay Constants override file.
//
// This file is a plain-text INI ([Section] + Key=value, values may be CSV).
// It is OPTIONAL and, in practice, ABSENT from every melee map in this
// project (melee maps use WC3 engine defaults and do not override gameplay
// constants). We still parse it when present so that custom maps which DO
// override the creep guard/return distance get an exact, map-derived leash
// instead of the documented WC3 default. See helpers/mappings.resolveCampLeash.
//
// We deliberately read only the constants we actually use. The known WC3
// gameplay-constant keys for the creep camp leash are:
//   GuardReturnDist  — "Creeps - Guard Return Distance" (units a creep may be
//                       pulled from its guard spot before it returns to camp)
//   GuardDistance    — "Creeps - Guard Distance" (acquisition/guard radius)
//
const LEASH_KEYS = ['GuardReturnDist', 'GuardDistance'];

const parseConstants = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return null;
  }

  const raw = {};
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] === '/' || trimmed[0] === '[') {
      return;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      return;
    }
    const key = trimmed.slice(0, eq).trim();
    // values may be CSV ("a,b") or quoted — take the first numeric-looking token
    const val = trimmed.slice(eq + 1).split(',')[0].replace(/"/g, '').trim();
    raw[key] = val;
  });

  // map the known leash key(s) to a normalized, documented field
  let creepGuardReturnDistance = null;
  for (const k of LEASH_KEYS) {
    if (raw[k] != null) {
      const n = parseFloat(raw[k]);
      if (isFinite(n) && n > 0) {
        creepGuardReturnDistance = n;
        break;
      }
    }
  }

  if (creepGuardReturnDistance == null) {
    return null; // file present but no usable leash override
  }

  return { creepGuardReturnDistance };
};

const MiscFile = class {
  constructor (filePath) {
    // null when the file is absent or carries no usable leash override —
    // callers fall back to the documented WC3 default via resolveCampLeash.
    this.constants = parseConstants(filePath);
  }
};

module.exports = MiscFile;
module.exports.parseConstants = parseConstants;
