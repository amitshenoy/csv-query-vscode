// Color Editor webview: a virtualised, read-only rendering of the whole file.
// The extension owns the file and a byte-offset line index; this script owns the
// scrollbar. Only a moving window of lines (viewport plus a generous buffer) is
// ever in the DOM — the window is re-fetched from the extension when scrolling
// approaches its edge, so all millions of lines are reachable at native scroll
// speed with a constant-size DOM.
(function () {
  var vscode = acquireVsCodeApi();
  window.addEventListener('error', function (e) {
    try { vscode.postMessage({ type: 'clientError', message: String((e && e.message) || 'unknown script error') }); } catch (err) {}
  });
  var LH = 19;
  var total = 0;
  var renderedFirst = -1;
  var renderedCount = 0;
  var rafPending = false;
  var scroll = document.getElementById('scroll');
  var spacer = document.getElementById('spacer');
  var win = document.getElementById('win');
  var head = document.getElementById('head');

  function needRange() {
    var vh = scroll.clientHeight || 600;
    var first = Math.max(0, Math.floor(scroll.scrollTop / LH) - 100);
    var count = Math.ceil(vh / LH) + 200;
    return { first: first, count: count };
  }
  function requestWindow(force) {
    if (!total) return;
    var viewFirst = Math.floor(scroll.scrollTop / LH);
    var viewLast = viewFirst + Math.ceil((scroll.clientHeight || 600) / LH);
    if (!force && renderedFirst >= 0 && viewFirst > renderedFirst + 40 && viewLast < renderedFirst + renderedCount - 40) return;
    var r = needRange();
    vscode.postMessage({ type: 'range', first: r.first, count: r.count });
  }
  scroll.addEventListener('scroll', function () {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; requestWindow(false); });
  });
  window.addEventListener('resize', function () { requestWindow(false); });
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'meta') {
      total = m.total || 0;
      head.textContent = m.label || '';
      spacer.style.height = (total * LH) + 'px';
      renderedFirst = -1; renderedCount = 0;
      requestWindow(true);
    } else if (m.type === 'lines') {
      renderedFirst = m.first; renderedCount = m.count;
      win.style.top = (m.first * LH) + 'px';
      win.innerHTML = m.html;
    } else if (m.type === 'status') {
      head.textContent = m.text || '';
    }
  });
  vscode.postMessage({ type: 'ready' });
  // If no 'meta' arrives (a lost message, a slow first load), check in once
  // more — the provider re-sends meta on every 'ready' once indexing is done.
  setTimeout(function () { if (!total) vscode.postMessage({ type: 'ready' }); }, 2000);
})();
