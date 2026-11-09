'use strict';

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

const CFG_KEY = 'hilvi.config.v1';
const SAVE_KEY = 'hilvi.save.v1';
const MAX_HISTORY = 80;
const SEND_HISTORY = 24;

const DEFAULT_CFG = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 1.2,
  maxTokens: 400,
};

function readCfg() {
  let cfg = Object.assign({}, DEFAULT_CFG);
  try {
    Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
  } catch {
    /* 坏数据当成默认 */
  }
  cfg.apiKey = String(cfg.apiKey || '').trim();
  if (/[^\x21-\x7e]/.test(cfg.apiKey) || cfg.apiKey.length < 12) cfg.apiKey = '';
  return cfg;
}

function writeCfg(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function defaultSave() {
  return {
    affection: HILVI_DEFAULT_AFFECTION,
    mood: '不安',
    memories: [],
    history: [],
    createdAt: new Date().toISOString(),
  };
}

function readSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw) return defaultSave();
    return Object.assign(defaultSave(), raw);
  } catch {
    return defaultSave();
  }
}

let save = readSave();

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (err) {
    toast('本地存储满了，备份一下再继续。');
    console.error(err);
  }
}

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const els = {
  chat: document.getElementById('chat'),
  input: document.getElementById('input'),
  send: document.getElementById('sendBtn'),
  reset: document.getElementById('resetBtn'),
  exportBtn: document.getElementById('exportBtn'),
  stage: document.getElementById('stage'),
  bar: document.getElementById('affectionBar'),
  num: document.getElementById('affectionNum'),
  mini: document.getElementById('miniAffection'),
  mood: document.getElementById('moodValue'),
  moodChip: document.getElementById('moodChip'),
  memories: document.getElementById('memories'),
  banner: document.getElementById('keyBanner'),
  toast: document.getElementById('toast'),
  settingsBtn: document.getElementById('settingsBtn'),
  sheet: document.getElementById('sheet'),
  sheetClose: document.getElementById('sheetClose'),
  cfgKey: document.getElementById('cfgKey'),
  cfgBase: document.getElementById('cfgBase'),
  cfgModel: document.getElementById('cfgModel'),
  cfgTemp: document.getElementById('cfgTemp'),
  cfgMax: document.getElementById('cfgMax'),
  tempVal: document.getElementById('tempVal'),
  maxVal: document.getElementById('maxVal'),
  saveCfg: document.getElementById('saveCfg'),
  toggleKey: document.getElementById('toggleKey'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  wipeBtn: document.getElementById('wipeBtn'),
  dataHint: document.getElementById('dataHint'),
};

const ui = { busy: false };

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scrollBottom() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function timeLabel(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 23 || h < 5) return '……主人，这么晚了，还不睡吗？';
  if (h < 9) return '主人……早安。今天，也会留下来吗？';
  if (h < 12) return '那个……主人，今天也辛苦了。';
  if (h < 14) return '午饭……吃过了吗？';
  if (h < 18) return '我一直在这里，没有走开。';
  if (h < 23) return '天黑了……主人，回来了。';
  return '主人……';
}

/** 从流式文本里摘掉 [[...]] 内部标记 */
function makeTagStripper(onTag) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let out = '';
      for (;;) {
        const open = buf.indexOf('[[');
        if (open === -1) {
          if (buf.endsWith('[')) {
            out += buf.slice(0, -1);
            buf = '[';
          } else {
            out += buf;
            buf = '';
          }
          break;
        }
        out += buf.slice(0, open);
        const close = buf.indexOf(']]', open + 2);
        if (close === -1) {
          buf = buf.slice(open);
          break;
        }
        onTag(buf.slice(open + 2, close));
        buf = buf.slice(close + 2);
      }
      return out;
    },
    flush() {
      const rest = buf;
      buf = '';
      const i = rest.indexOf('[[');
      return i === -1 ? rest : rest.slice(0, i);
    },
  };
}

function applyTags(tags) {
  let delta = 0;
  for (const raw of tags) {
    const tag = String(raw).trim();
    let m;
    if ((m = /^mood\s*[:：]\s*(.+)$/.exec(tag))) {
      const mood = m[1].trim().slice(0, 6);
      if (mood) save.mood = mood;
    } else if ((m = /^affection\s*[:：]\s*([+-]?\d+)/.exec(tag))) {
      delta += Number(m[1]) || 0;
    } else if ((m = /^remember\s*[:：]\s*(.+)$/.exec(tag))) {
      const text = m[1].trim().slice(0, 120);
      if (text && !save.memories.includes(text)) save.memories.push(text);
    }
  }
  if (save.memories.length > 50) save.memories = save.memories.slice(-50);
  return delta;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function addMessage(role, text, ts, animate = true) {
  const msg = document.createElement('div');
  msg.className = 'msg ' + (role === 'user' ? 'user' : 'her');
  if (!animate) msg.style.animation = 'none';

  const avatar = document.createElement('div');
  avatar.className = 'dot-avatar';
  avatar.textContent = role === 'user' ? '我' : '希';

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrap.appendChild(bubble);
  if (ts) wrap.appendChild(stampOf(ts));

  msg.appendChild(avatar);
  msg.appendChild(wrap);
  els.chat.appendChild(msg);
  scrollBottom();
  return { bubble, wrap };
}

function stampOf(ts) {
  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  stamp.textContent = timeLabel(ts);
  return stamp;
}

function renderEmpty() {
  const div = document.createElement('div');
  div.className = 'empty';
  const avatar = document.createElement('div');
  avatar.className = 'big-avatar';
  avatar.textContent = '希';
  const p = document.createElement('p');
  p.textContent = greeting();
  div.appendChild(avatar);
  div.appendChild(p);
  els.chat.appendChild(div);
}

function renderHistory() {
  els.chat.innerHTML = '';
  if (!save.history.length) return renderEmpty();
  for (const m of save.history) addMessage(m.role, m.content, m.ts, false);
  scrollBottom();
}

function renderMemories() {
  els.memories.innerHTML = '';
  if (!save.memories.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = '（她还没记住什么……）';
    els.memories.appendChild(li);
    return;
  }
  for (const text of save.memories) {
    const li = document.createElement('li');
    li.textContent = text;
    els.memories.appendChild(li);
  }
}

function renderPanel() {
  const stage = hilviStageOf(save.affection).name;
  els.num.textContent = save.affection;
  els.mini.textContent = save.affection;
  els.bar.style.width = Math.max(3, Math.min(100, save.affection)) + '%';
  els.stage.textContent = stage;
  els.mood.textContent = save.mood;
  els.moodChip.textContent = save.mood;
  els.banner.hidden = Boolean(readCfg().apiKey);
  renderMemories();
}

/* ------------------------------------------------------------------ */
/* 发送                                                                */
/* ------------------------------------------------------------------ */

function apiUrl(cfg) {
  return String(cfg.baseURL || DEFAULT_CFG.baseURL).replace(/\/+$/, '') + '/chat/completions';
}

function buildPayload(cfg, messages) {
  const payload = {
    model: cfg.model || DEFAULT_CFG.model,
    messages,
    stream: true,
    temperature: cfg.temperature == null ? 1.2 : cfg.temperature,
    max_tokens: cfg.maxTokens == null ? 400 : cfg.maxTokens,
  };
  // 官方接口默认开思考模式，陪聊关掉更快也更像说话
  if (/^(?:[a-z0-9-]+\.)*deepseek\.com$/i.test(new URL(cfg.baseURL || DEFAULT_CFG.baseURL).hostname)) {
    payload.thinking = { type: 'disabled' };
  }
  return payload;
}

async function requestReply(text) {
  const cfg = readCfg();
  save.history.push({ role: 'user', content: text, ts: Date.now() });
  if (save.history.length > MAX_HISTORY) save.history = save.history.slice(-MAX_HISTORY);

  const messages = [
    { role: 'system', content: hilviSystemPrompt(save) },
    ...save.history.slice(-SEND_HISTORY).map((h) => ({ role: h.role, content: h.content })),
  ];

  const res = await fetch(apiUrl(cfg), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify(buildPayload(cfg, messages)),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    let msg = '模型返回 ' + res.status;
    try {
      const j = JSON.parse(detail);
      msg += '：' + (j.error?.message || j.message || detail.slice(0, 160));
    } catch {
      if (detail) msg += '：' + detail.slice(0, 160);
    }
    throw new Error(msg);
  }

  return res;
}

async function send() {
  const text = els.input.value.trim();
  if (!text || ui.busy) return;

  const cfg = readCfg();
  if (!cfg.apiKey) {
    openSheet('先填一下 API Key');
    return;
  }

  els.input.value = '';
  autoGrow();
  ui.busy = true;
  els.send.disabled = true;

  addMessage('user', text, Date.now());
  const { bubble, wrap } = addMessage('her', '', 0, true);
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

  const tags = [];
  const stripper = makeTagStripper((tag) => tags.push(tag));
  let reply = '';
  let firstChunk = true;

  try {
    const res = await requestReply(text);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          done = true;
          break;
        }
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          const visible = stripper.push(piece);
          if (visible) {
            if (firstChunk) {
              bubble.textContent = '';
              firstChunk = false;
            }
            reply += visible;
            bubble.textContent = reply;
            scrollBottom();
          }
        }
      }
    }

    reply += stripper.flush();
    if (reply.trim()) {
      bubble.textContent = reply;
      const delta = applyTags(tags);
      save.affection = clamp(save.affection + 1 + delta, 0, 100);
      save.history.push({ role: 'assistant', content: reply.trim(), ts: Date.now() });
      if (save.history.length > MAX_HISTORY) save.history = save.history.slice(-MAX_HISTORY);
      persist();
      wrap.appendChild(stampOf(Date.now()));
      renderPanel();
    } else {
      bubble.textContent = '（她张了张嘴，什么也没说。）';
      save.history.pop(); // 空回复的话，把这条 user 也撤掉，免得污染上下文
      persist();
    }
  } catch (err) {
    bubble.textContent = '';
    const span = document.createElement('span');
    span.className = 'error-text';
    span.textContent = '……连接断掉了。（' + (err.message || '未知错误') + '）';
    bubble.appendChild(span);
    save.history.pop();
    persist();
  } finally {
    ui.busy = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 150) + 'px';
}

/* ------------------------------------------------------------------ */
/* 设置面板                                                            */
/* ------------------------------------------------------------------ */

function openSheet(title) {
  const cfg = readCfg();
  els.cfgKey.value = cfg.apiKey;
  els.cfgBase.value = cfg.baseURL;
  els.cfgModel.value = cfg.model;
  els.cfgTemp.value = String(cfg.temperature);
  els.cfgMax.value = String(cfg.maxTokens);
  els.tempVal.textContent = Number(cfg.temperature).toFixed(1);
  els.maxVal.textContent = String(cfg.maxTokens);
  if (title) toast(title);
  els.sheet.hidden = false;
  requestAnimationFrame(() => els.cfgKey.focus());
}

function closeSheet() {
  els.sheet.hidden = true;
}

function saveCfgFromSheet() {
  const key = els.cfgKey.value.trim();
  if (key && (key.length < 12 || /[^\x21-\x7e]/.test(key))) {
    toast('这个 key 看起来不太对，检查一下有没有多余空格。');
    return;
  }
  writeCfg({
    apiKey: key,
    baseURL: els.cfgBase.value.trim() || DEFAULT_CFG.baseURL,
    model: els.cfgModel.value.trim() || DEFAULT_CFG.model,
    temperature: Number(els.cfgTemp.value),
    maxTokens: Number(els.cfgMax.value),
  });
  renderPanel();
  closeSheet();
  toast(key ? '记住了。' : '还没填 key，暂时聊不了。');
  els.input.focus();
}

/* ------------------------------------------------------------------ */
/* 存档导入导出                                                        */
/* ------------------------------------------------------------------ */

function exportSave() {
  const data = { app: 'hilvi-pwa', version: 1, exportedAt: new Date().toISOString(), save };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.download = 'hilvi-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('备份已导出。');
}

function importSave(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const incoming = parsed && parsed.save ? parsed.save : parsed;
      if (!incoming || !Array.isArray(incoming.history)) throw new Error('不是希尔薇的存档');
      if (!confirm('用这份存档覆盖现在的一切吗？')) return;
      save = Object.assign(defaultSave(), incoming);
      persist();
      renderHistory();
      renderPanel();
      toast('存档已恢复。');
    } catch (err) {
      toast('读不出来：' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
els.send.addEventListener('click', send);

els.settingsBtn.addEventListener('click', () => openSheet());
els.sheetClose.addEventListener('click', closeSheet);
els.sheet.addEventListener('click', (e) => {
  if (e.target === els.sheet) closeSheet();
});
els.saveCfg.addEventListener('click', saveCfgFromSheet);
els.toggleKey.addEventListener('click', () => {
  const showing = els.cfgKey.type === 'text';
  els.cfgKey.type = showing ? 'password' : 'text';
  els.toggleKey.textContent = showing ? '显示' : '隐藏';
});
els.cfgTemp.addEventListener('input', () => (els.tempVal.textContent = Number(els.cfgTemp.value).toFixed(1)));
els.cfgMax.addEventListener('input', () => (els.maxVal.textContent = els.cfgMax.value));

els.exportBtn.addEventListener('click', exportSave);
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files && els.importFile.files[0];
  if (file) importSave(file);
  els.importFile.value = '';
});

els.wipeBtn.addEventListener('click', () => {
  if (!confirm('她会忘掉所有对话、好感和记忆。确定吗？')) return;
  save = defaultSave();
  persist();
  els.chat.innerHTML = '';
  renderEmpty();
  renderPanel();
  closeSheet();
  toast('一切归零了。');
});

els.reset.addEventListener('click', () => {
  if (!confirm('要让她忘掉这一切，重新开始吗？')) return;
  save = defaultSave();
  persist();
  els.chat.innerHTML = '';
  renderEmpty();
  renderPanel();
});

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW 注册失败', err));
  });
}

let installEvent = null;
const installTip = document.getElementById('installTip');
const installTipBtn = document.getElementById('installTipBtn');
const installTipClose = document.getElementById('installTipClose');
const TIP_KEY = 'hilvi.installTip.dismissed';

function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function maybeShowTip() {
  if (!installTip || standalone() || localStorage.getItem(TIP_KEY) === '1') return;
  installTip.hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  const btn = document.getElementById('installTipBtn');
  if (btn) btn.hidden = false;
});

if (installTipBtn) {
  installTipBtn.hidden = true;
  installTipBtn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    installTip.hidden = true;
  });
}
if (installTipClose) {
  installTipClose.addEventListener('click', () => {
    installTip.hidden = true;
    localStorage.setItem(TIP_KEY, '1');
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  renderPanel();
  renderHistory();
  const cfg = readCfg();
  if (!cfg.apiKey) openSheet('第一次来？填个 API Key 就能聊了');
  els.input.focus();
  setTimeout(maybeShowTip, 2500);
}

boot();
