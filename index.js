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

/* ════════════════════════════════════════════════════
   附加模块 · 顶部灯笼栏 + 点击化蝶（独立，不影响上方原有代码）
   需上传到本扩展仓库的图片（透明底 PNG，名字要一致）：
     lantern1.png  lantern2.png  lantern3.png  lantern4.png  butterfly.png
   ════════════════════════════════════════════════════ */
(function shiguangLanterns() {
  const EXT = 'shiguang-cast-fate-v2';
  const BASE = `/scripts/extensions/third-party/${EXT}/`;
  const LANTERNS = ['lantern1.png', 'lantern2.png', 'lantern3.png', 'lantern4.png'];
  const BUTTERFLY = 'butterfly.png';
  const HEIGHTS = [6, 22, 0, 16];   // 错落高度，可调
  const BAR_ID = 'shiguang-lantern-bar';

  function injectStyle() {
    if (document.getElementById('shiguang-lantern-style')) return;
    const s = document.createElement('style');
    s.id = 'shiguang-lantern-style';
    s.textContent = `
      #${BAR_ID}{position:fixed;top:46px;left:0;right:0;height:74px;z-index:9980;
        pointer-events:none;display:flex;justify-content:space-around;align-items:flex-start;
        padding:0 8px;overflow:visible;}
      #${BAR_ID} .lan{pointer-events:auto;cursor:pointer;width:42px;height:auto;
        transform-origin:top center;filter:drop-shadow(0 4px 7px rgba(0,0,0,.55));
        animation:lanSway 4s ease-in-out infinite;transition:transform .25s ease;}
      #${BAR_ID} .lan:active{transform:scale(.9);}
      #${BAR_ID} .lan.bfly{width:48px;animation:bflyFlit 1.4s ease-in-out infinite;
        filter:drop-shadow(0 3px 8px rgba(30,40,120,.6));}
      @keyframes lanSway{0%,100%{transform:rotate(-1.5deg)}50%{transform:rotate(1.5deg)}}
      @keyframes bflyFlit{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-6px) rotate(6deg)}}
      .shiguang-dust{position:fixed;z-index:9999;pointer-events:none;border-radius:50%;
        background:radial-gradient(circle,#fff3c4,#e8c46a 50%,rgba(217,164,65,0));
        box-shadow:0 0 6px rgba(232,196,106,.9);
        animation:dustFly 1s ease-out forwards;}
      @keyframes dustFly{
        0%{transform:translate(0,0) scale(1);opacity:1}
        100%{transform:translate(var(--dx),var(--dy)) scale(.3);opacity:0}
      }
    `;
    document.head.appendChild(s);
  }

  function toggleButterfly(img) {
    spawnGoldDust(img);
    if (img.classList.contains('bfly')) {
      img.src = BASE + img.dataset.lan;
      img.classList.remove('bfly');
    } else {
      img.src = BASE + BUTTERFLY;
      img.classList.add('bfly');
    }
  }

  /* 点灯笼撒一把金粉 */
  function spawnGoldDust(img) {
    const r = img.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 14; i++) {
      const d = document.createElement('span');
      d.className = 'shiguang-dust';
      const ang = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 42;
      d.style.left = cx + 'px';
      d.style.top = cy + 'px';
      d.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      d.style.setProperty('--dy', (Math.sin(ang) * dist + 30) + 'px');
      d.style.width = d.style.height = (3 + Math.random() * 3) + 'px';
      d.style.animationDelay = (Math.random() * 0.15) + 's';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 1100);
    }
  }

  function buildBar() {
    if (document.getElementById(BAR_ID)) return;
    injectStyle();
    const bar = document.createElement('div');
    bar.id = BAR_ID;
    LANTERNS.forEach((src, i) => {
      const img = document.createElement('img');
      img.className = 'lan';
      img.src = BASE + src;
      img.dataset.lan = src;
      img.style.marginTop = HEIGHTS[i % HEIGHTS.length] + 'px';
      img.style.animationDelay = (i * 0.4) + 's';
      img.addEventListener('click', () => toggleButterfly(img));
      bar.appendChild(img);
    });
    document.body.appendChild(bar);
  }

  function ensureBar() { if (!document.getElementById(BAR_ID)) buildBar(); }

  /* —— 底部「一 世 念」草书题字键 + 世字缠蓝蝶 + 头像萤火环 —— */
  function injectButtonStyle() {
    if (document.getElementById('shiguang-btn-style')) return;
    const s = document.createElement('style');
    s.id = 'shiguang-btn-style';
    s.textContent = `
      /* 三连键：淡金宣纸牌匾，墨字才跳得出来 */
      #send_but,#options_button,#extensionsMenuButton{
        position:relative!important;font-size:0!important;
        width:48px!important;height:48px!important;border-radius:11px!important;
        background:linear-gradient(160deg,#f3e6c4,#e3c98c)!important;
        border:1px solid rgba(184,137,58,.7)!important;
        box-shadow:0 2px 8px rgba(0,0,0,.4),inset 0 0 10px rgba(255,255,255,.35)!important;
        display:flex!important;align-items:center;justify-content:center;overflow:visible!important;
      }
      #send_but svg,#send_but i,
      #options_button svg,#options_button i,
      #extensionsMenuButton svg,#extensionsMenuButton i{display:none!important;}
      #send_but::after,#options_button::after,#extensionsMenuButton::after{
        content:''!important;position:absolute;inset:6px;
        background-position:center;background-repeat:no-repeat;background-size:contain;
        filter:drop-shadow(0 1px 1px rgba(0,0,0,.25));
      }
      #send_but::after{background-image:url('${BASE}nian.png');}        /* 念 */
      #options_button::after{background-image:url('${BASE}yi.png');}     /* 一 */
      #extensionsMenuButton::after{background-image:url('${BASE}shi.png');} /* 世 */
      /* 蓝蝶只缠在「世」上，适度大小 */
      #extensionsMenuButton::before{
        content:'';position:absolute;width:34px;height:48px;top:-18px;right:-9px;
        pointer-events:none;z-index:3;
        background:url('${BASE}butterfly_swirl.png') center/contain no-repeat;
        filter:drop-shadow(0 1px 3px rgba(20,30,90,.5));
        animation:bflyWrap 3s ease-in-out infinite;transform-origin:bottom center;
      }
      @keyframes bflyWrap{0%,100%{transform:rotate(-7deg) translateY(0)}50%{transform:rotate(7deg) translateY(-3px)}}

      /* 头像：萤火光环，缓慢旋转包裹 */
      .mes .avatar,.avatar{position:relative!important;overflow:visible!important;}
      .mes .avatar img,.avatar img{border:1.5px solid rgba(232,196,106,.55)!important;border-radius:50%!important;}
      .mes .avatar::after,.avatar::after{
        content:''!important;position:absolute;inset:-9px;border-radius:50%;
        background:url('${BASE}firefly_ring.png') center/contain no-repeat;
        box-shadow:none!important;border:none!important;pointer-events:none;
        animation:fireflySpin 18s linear infinite;
      }
      @keyframes fireflySpin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(s);
  }

  /* —— 底部「常相见」做旧印章页脚 —— */
  function injectFooterStyle() {
    if (document.getElementById('shiguang-footer-style')) return;
    const s = document.createElement('style');
    s.id = 'shiguang-footer-style';
    s.textContent = `
      #shiguang-footer{
        position:relative;margin:14px auto 4px;max-width:90%;
        padding:10px 16px;border-radius:6px;text-align:center;
        font-family:'Noto Serif SC',serif;color:#f3e3c4;
        background:linear-gradient(160deg,rgba(110,20,20,.55),rgba(40,12,10,.6));
        border:1px solid rgba(232,196,106,.4);
        box-shadow:inset 0 0 22px rgba(0,0,0,.45),0 3px 12px rgba(0,0,0,.4);
        letter-spacing:.12em;
      }
      #shiguang-footer .seal{
        display:inline-block;font-size:13px;font-weight:700;color:#e8c46a;
        text-shadow:0 0 8px rgba(232,196,106,.4);
      }
      #shiguang-footer .poem{
        display:block;margin-top:5px;font-size:11.5px;color:#d9c9a8;letter-spacing:.18em;
      }
      /* 做旧斑驳 */
      #shiguang-footer::before{
        content:'';position:absolute;inset:0;border-radius:6px;pointer-events:none;
        background:radial-gradient(circle at 18% 30%,rgba(232,196,106,.10),transparent 25%),
                  radial-gradient(circle at 82% 70%,rgba(232,196,106,.08),transparent 22%),
                  radial-gradient(circle at 50% 90%,rgba(0,0,0,.18),transparent 30%);
        mix-blend-mode:overlay;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureFooter() {
    injectFooterStyle();
    const chat = document.getElementById('chat');
    if (!chat) return;
    if (document.getElementById('shiguang-footer')) return;
    const f = document.createElement('div');
    f.id = 'shiguang-footer';
    f.innerHTML = `<span class="seal">◈ 常 相 见 ◈</span>
      <span class="poem">愿同梁上双燕，年年檐下相逢</span>`;
    chat.appendChild(f);
  }

  function ensureAll() { ensureBar(); injectButtonStyle(); ensureFooter(); }
  ensureAll();
  setInterval(ensureAll, 1500);
})();
