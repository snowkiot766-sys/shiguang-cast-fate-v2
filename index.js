const EXT_ID = 'shiguang-cast-fate-v2';
const PANEL_URL = `/scripts/extensions/third-party/${EXT_ID}/panel.html`;
const BRIDGE_SOURCE = 'shiguang-cast-fate';
const POS_KEY = 'shiguang-launcher-pos';
let bridgeBound = false;

function getContextSafe() {
  try { return globalThis.SillyTavern?.getContext?.() ?? null; }
  catch (error) {
    console.error(`[${EXT_ID}] ctx`, error);
    return null;
  }
}

async function executeSlash(command) {
  const ctx = getContextSafe();
  const runners = [
    () => ctx?.executeSlashCommandsWithOptions?.(command),
    () => ctx?.executeSlashCommands?.(command),
    () => globalThis.TavernHelper?.triggerSlash?.(command),
    () => globalThis.triggerSlash?.(command),
    () => globalThis.STscript?.(command),
  ];
  let lastError = null;
  for (const run of runners) {
    try {
      const result = await run();
      if (result !== undefined && result !== false) return true;
    } catch (error) { lastError = error; }
  }
  if (lastError) console.error(`[${EXT_ID}] slash`, lastError);
  return false;
}

async function sendWorldDirective(text) {
  const directive = String(text || '').trim();
  if (!directive) return { ok: false, message: '投命指令为空' };
  const escaped = directive.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const sent = await executeSlash(`/send "${escaped}"`);
  if (!sent) return { ok: false, message: '无法调用 /send' };
  const triggered = await executeSlash('/trigger');
  if (!triggered) return { ok: false, message: '指令已发送，请手动点发送/继续' };
  return { ok: true, message: '已进入此世，AI 正在生成开场' };
}

function postToPanel(payload) {
  const frame = document.getElementById('shiguang-frame');
  frame?.contentWindow?.postMessage({ source: BRIDGE_SOURCE, ...payload }, location.origin);
}

function bindBridge() {
  if (bridgeBound) return;
  bridgeBound = true;
  window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE) return;
    if (data.type === 'enter-world') {
      const result = await sendWorldDirective(data.directive);
      postToPanel({ type: 'enter-world-result', requestId: data.requestId, ...result });
      if (result.ok) closePanel();
    }
  });
}

function applyBaseStyle(el) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(POS_KEY)); } catch { return null; } })();
  const top = saved?.top ?? 220;
  const left = saved?.left ?? (window.innerWidth - 60);
  Object.assign(el.style, {
    display: 'flex', position: 'fixed',
    top: top + 'px', left: left + 'px',
    right: 'auto', bottom: 'auto', transform: 'none',
    width: '48px', height: '48px', zIndex: '2147483647',
    alignItems: 'center', justifyContent: 'center',
    borderRadius: '50%', cursor: 'grab',
    background: 'radial-gradient(circle at 45% 35%,#302647,#100d18 72%)',
    border: '2px solid #d9b772', color: '#d9b772',
    fontSize: '20px', opacity: '1', visibility: 'visible',
    pointerEvents: 'auto', userSelect: 'none', touchAction: 'none',
    boxShadow: '0 0 12px rgba(217,183,114,.5)',
  });
}

function makeDraggable(el) {
  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;

  const start = (e) => {
    dragging = true; moved = false;
    const p = e.touches ? e.touches[0] : e;
    sx = p.clientX; sy = p.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    el.style.cursor = 'grabbing';
  };
  const move = (e) => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - sx, dy = p.clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    let nx = ox + dx, ny = oy + dy;
    nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, nx));
    ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, ny));
    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    const r = el.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ top: r.top, left: r.left })); } catch {}
    if (!moved) openPanel();
  };

  el.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  el.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end);
}

function ensureUI() {
  if (!document.getElementById('shiguang-launcher')) {
    const launcher = document.createElement('button');
    launcher.id = 'shiguang-launcher';
    launcher.type = 'button';
    launcher.title = '拖动可移动 · 轻点打开命盘';
    launcher.innerHTML = '命';
    applyBaseStyle(launcher);
    document.body.appendChild(launcher);
    makeDraggable(launcher);
  }

  if (!document.getElementById('shiguang-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'shiguang-overlay';
    overlay.innerHTML = `
      <div id="shiguang-modal" role="dialog" aria-modal="true" aria-label="拾光投命">
        <div id="shiguang-modal-head">
          <span>拾光 · 投命</span>
          <div class="shiguang-head-actions">
            <button id="shiguang-reload" type="button" title="刷新命盘">↻</button>
            <button id="shiguang-close" type="button" title="关闭">×</button>
          </div>
        </div>
        <iframe id="shiguang-frame" src="${PANEL_URL}" allow="clipboard-write" title="拾光投命命盘"></iframe>
      </div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });
    document.body.appendChild(overlay);

    document.getElementById('shiguang-close')?.addEventListener('click', closePanel);
    document.getElementById('shiguang-reload')?.addEventListener('click', () => {
      const frame = document.getElementById('shiguang-frame');
      if (frame) frame.src = `${PANEL_URL}?t=${Date.now()}`;
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  }

  bindBridge();
}

function openPanel() {
  const overlay = document.getElementById('shiguang-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.classList.add('shiguang-lock');
}

function closePanel() {
  document.getElementById('shiguang-overlay')?.classList.remove('open');
  document.body.classList.remove('shiguang-lock');
}

function init() {
  ensureUI();
  setInterval(ensureUI, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
