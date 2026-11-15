// Mirror: the main copy posts its band-driven engine calls (fall, taps, answers) on a
// BroadcastChannel; the embedded copy (?embed=1, the deck's frame) replays them on its own engine
// and shows the main copy's band / listening state. Additive; never throws.
(function () {
  'use strict';
  try {
    if (typeof BroadcastChannel === 'undefined' || !window.VexoCare || !window.VexoCare.engine) return;
    var care = window.VexoCare, engine = care.engine;
    var EMBED = /[?&]embed=1(?:&|$)/.test(location.search) || (document.body && document.body.classList.contains('embed'));
    var ch = new BroadcastChannel('apotheosis-mirror');
    var origIngest = engine.ingest, origAction = engine.userAction;
    var FORWARD = { 'free-fall': 1, 'tap': 1, 'double-tap': 1 };
    function post(m) { try { ch.postMessage(m); } catch (_) { /* */ } }
    function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (_) { return null; } }

    if (!EMBED) {
      engine.ingest = function (sig) {
        var r = origIngest.apply(this, arguments);
        try { if (sig && FORWARD[sig.type]) post({ t: 'ingest', sig: clone(sig) }); } catch (_) { /* */ }
        return r;
      };
      engine.userAction = function (kind, via) {
        var r = origAction.apply(this, arguments);
        post({ t: 'action', kind: kind, via: via });
        return r;
      };
      var beat = function () {
        try { post({ t: 'beat', connected: !!care.band, listening: !!(window.VexoLiveTranscript && window.VexoLiveTranscript.listening) }); } catch (_) { /* */ }
      };
      beat(); setInterval(beat, 2000);
      return;
    }

    // ---- embedded copy ----
    var main = null, lastBeat = 0;
    ch.onmessage = function (e) {
      try {
        var m = e.data || {};
        if (m.t === 'ingest' && m.sig) origIngest.call(engine, m.sig);
        else if (m.t === 'action') origAction.call(engine, m.kind, m.via);
        else if (m.t === 'beat') { main = m; lastBeat = Date.now(); paint(); }
      } catch (_) { /* */ }
    };
    function $(id) { return document.getElementById(id); }
    function paint() {
      try {
        if (!main || Date.now() - lastBeat > 6000 || !main.connected) return;
        var dot = $('gmBandDot'), say = $('gmBandSay'), sum = $('cgSummary');
        if (dot) dot.dataset.on = '1';
        if (say) say.textContent = main.listening ? 'Your band is connected and listening' : 'Your band is connected';
        if (sum && /not connected/i.test(sum.textContent)) sum.textContent = main.listening ? 'Band connected · listening' : 'Band connected';
        if (main.listening) {
          var st = document.querySelectorAll('.lt-state');
          for (var i = 0; i < st.length; i++) {
            st[i].dataset.level = 'on';
            var sp = st[i].querySelector('span'); if (sp) sp.textContent = 'Listening';
          }
        }
      } catch (_) { /* */ }
    }
    (function loop() { paint(); try { requestAnimationFrame(loop); } catch (_) { /* */ } })();
    setInterval(paint, 500);   // rAF pauses in hidden frames
  } catch (_) { /* never throw */ }
})();
