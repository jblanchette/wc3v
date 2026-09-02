// The release policy: what a version of this app is allowed to do.
//
// The update manifest the updater polls (cdn.wc3v.com/desktop/latest.json)
// carries two optional fields beyond what the updater reads, both written by
// tools/deploy-desktop.js:
//
//   minimum       the oldest version allowed to run. Below it the app puts
//                 an update screen over everything and offers one button.
//   onboard_from  anyone set up before this version goes through the
//                 first-run screen again on their next launch.
//
// So a release can be marked "must update" (a parser fix everyone needs, a
// manifest format change) or "set up again" (the setup screen changed and
// the people who tested the old one should see the new one), and the two are
// independent: most releases set neither.
//
// The policy is fetched at boot with a short timeout and NEVER blocks when
// it cannot be fetched. Offline is "no policy". A dead-man switch that bricks
// the app on a bad connection is the wrong kind of dead-man switch.
//
// A build older than the one that introduced this module cannot be forced:
// it never reads the fields. It gets the ordinary update offer, and every
// build after it is enforceable.

(function () {
  'use strict';

  // 1.0.10 against 1.0.9: numeric per segment, missing segments are zero,
  // anything unparseable (the old "1" setup marker, "preview") is 0.0.0.
  const parse = (v) => String(v || '').trim().split('.').map(x => parseInt(x, 10) || 0);
  const cmpVersion = (a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  };
  const isVersion = (v) => /^\d+(\.\d+)*$/.test(String(v || '').trim());

  // Below the minimum: update before anything else.
  const mustUpdate = (policy, appVersion) =>
    !!(policy && isVersion(policy.minimum) && isVersion(appVersion) &&
       cmpVersion(appVersion, policy.minimum) < 0);

  // Set up before `onboard_from`: the first-run screen again. A machine never
  // set up (null) is the ordinary first run and is not this rule's business.
  // A marker that is not a version ("1", from builds before the marker
  // carried one) counts as older than anything.
  const mustOnboard = (policy, setupVersion) => {
    if (!policy || !isVersion(policy.onboard_from)) return false;
    if (setupVersion === null || setupVersion === undefined) return false;
    const have = isVersion(setupVersion) ? setupVersion : '0';
    return cmpVersion(have, policy.onboard_from) < 0;
  };

  window.ReleasePolicy = { cmpVersion, mustUpdate, mustOnboard, isVersion };

  window.createReleasePolicy = (deps) => {
    // deps: invoke, log, errText, appVersion() -> Promise<string>
    let promise = null;

    const fetchPolicy = async () => {
      try {
        const p = await deps.invoke('release_policy');
        return p || null;
      } catch (e) {
        deps.log(`could not read the release policy: ${deps.errText(e)}`, 'warn');
        return null;
      }
    };

    return {
      // Started once; the same promise is handed to everyone who asks.
      start () {
        if (!promise) promise = fetchPolicy();
        return promise;
      },
      // The policy if it has arrived within `ms`, else null; the fetch
      // carries on and `start()` still resolves later.
      within (ms) {
        return Promise.race([
          this.start(),
          new Promise(r => setTimeout(() => r(null), ms))
        ]);
      }
    };
  };
})();
