const EXT_ID = 'shiguang-cast-fate';
const PANEL_URL = `/scripts/extensions/third-party/${EXT_ID}/panel.html`;
const BRIDGE_SOURCE = 'shiguang-cast-fate';
let bridgeBound = false;

function getContextSafe() {
  try { return globalThis.SillyTavern?.getContext?.() ?? null; }
  catch (error) {
    console.error(`[${EXT_ID}] Unable to read SillyTavern context`, error);
    return null;
  }
}

function isShiguangCard() {
  const ctx = getContextSafe();
  if (!ctx || ctx.characterId === undefined || ctx.characterId === null) return false;
  const char = ctx.characters?.[ctx.characterId];
  const name = String(char?.name || char?.data?.name || '');
  const desc = String(char?.description || char?.data?.description || '');
  return /拾光|投命|快穿攻略系统/i.test(`${name} ${desc}`);
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
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) console.error(`[${EXT_ID}] Slash command failed`, lastError);
  return false;
}

async function sendWorldDirective(text) {
  const directive = String(text || '').trim();
  if (!directive) return { ok: false, message: '投命指令为空' };

  // Quoted STscript argument prevents punctuation and spaces from being split.
  const escaped = directive.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const sent = await executeSlash(`/send "${escaped}"`);
  if (!sent) return { ok: false, message: '无法调用 /send，请确认云酒馆开放扩展与 STscript' };

  const triggered = await executeSlash('/trigger');
  if (!triggered) return { ok: false, message: '指令已发送，但无法自动触发生成；请手动点发送/继续' };
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

function ensureUI() {
  if (document.getElementById('shiguang-launcher')) return;

  const launcher = document.createElement('button');
  launcher.id = 'shiguang-launcher';
  launcher.type = 'button';
  launcher.title = '打开拾光·投命命盘';
  launcher.setAttribute('aria-label', '打开拾光·投命命盘');
  launcher.innerHTML = '<span class="shiguang-launcher-mark">命</span>';
  launcher.addEventListener('click', openPanel);
  document.body.appendChild(launcher);

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

  bindBridge();
  refreshVisibility();
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

function refreshVisibility() {
  const launcher = document.getElementById('shiguang-launcher');
  if (!launcher) return;
  const visible = isShiguangCard();
  launcher.classList.toggle('active-card', visible);
  launcher.style.display = visible ? 'grid' : 'none';
  if (!visible) closePanel();
}

function bindEvents() {
  const ctx = getContextSafe();
  const es = ctx?.eventSource;
  const et = ctx?.event_types;
  if (!es || !et) return;
  ['APP_READY', 'CHAT_CHANGED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'GROUP_UPDATED']
    .forEach(name => { if (et[name]) es.on(et[name], refreshVisibility); });
}

function onEnable() {
  ensureUI();
  refreshVisibility();
}

function onDisable() {
  document.getElementById('shiguang-launcher')?.remove();
  document.getElementById('shiguang-overlay')?.remove();
  document.body.classList.remove('shiguang-lock');
}

function onActivate() {
  ensureUI();
}

function init() {
  ensureUI();
  bindEvents();
  setTimeout(refreshVisibility, 600);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
