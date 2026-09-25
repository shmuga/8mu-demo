import {
  PARAMS, GESTURE_AXES, DEFAULT_MAPPINGS, indexOf, state,
  setParam, onParamChange, saveStored
} from './params.js';
import { onMidiStatus, onMidiActivity, onLearn, startLearn } from './midi.js';

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

const ccLabel = (cc) => (cc >= 0 ? `CC ${cc}` : '—');
// Bipolar gestures show "negative / positive" CCs, e.g. "CC 43 / 42".
const axisLabel = (ni, pi) => `${ccLabel(state.mappings[ni])} / ${state.mappings[pi] >= 0 ? state.mappings[pi] : '—'}`;

// actions: { togglePause, isPaused, reset, resetView, stats }
export function createUI(actions) {
  const controls = []; // { input, output, cc, row, read, write, active }
  const panel = $('#controls-panel');
  const settings = $('#settings-dialog');
  const help = $('#help-dialog');
  const toast = $('#toast');
  let toastTimer = 0;

  // --- Control panel ----------------------------------------------------

  function makeRow({ name, cc, gesture, bipolar, ends }) {
    const id = `ctl-${controls.length}`;
    const input = el('input', {
      type: 'range', id, min: bipolar ? -1 : 0, max: 1, step: 0.001,
      class: bipolar ? 'bipolar' : ''
    });
    const output = el('output', { for: id });
    const ccEl = el('span', { class: 'cc', text: cc });
    const row = el('div', { class: `ctl${gesture ? ' gesture' : ''}` }, [
      el('div', { class: 'ctl-head' }, [el('label', { for: id, text: name }), ccEl, output]),
      input
    ]);
    if (ends) {
      row.append(el('div', { class: 'ctl-ends' }, [el('span', { text: ends[0] }), el('span', { text: ends[1] })]));
    }
    return { input, output, ccEl, row };
  }

  function bindControl(ctl, { read, write, reset, spring }) {
    Object.assign(ctl, { read, write, active: false, lastInput: 0, shown: NaN });
    const { input } = ctl;
    input.addEventListener('input', () => {
      ctl.lastInput = performance.now();
      write(parseFloat(input.value));
      paint(ctl, parseFloat(input.value));
    });
    input.addEventListener('pointerdown', () => {
      ctl.active = true;
      const up = () => {
        ctl.active = false;
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (spring && state.prefs.springGestures) write(0);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    input.addEventListener('dblclick', reset);
    controls.push(ctl);
  }

  function paint(ctl, v) {
    const { input, output } = ctl;
    if (input.min === '-1') {
      const pos = ((v + 1) / 2) * 100;
      input.style.setProperty('--a', `${Math.min(50, pos)}%`);
      input.style.setProperty('--b', `${Math.max(50, pos)}%`);
      const n = Math.round(v * 100);
      output.textContent = n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
    } else {
      input.style.setProperty('--a', '0%');
      input.style.setProperty('--b', `${v * 100}%`);
      output.textContent = `${Math.round(v * 100)}%`;
    }
    ctl.shown = v;
  }

  PARAMS.forEach((param, i) => {
    if (param.group !== 'sim') return;
    const ctl = makeRow({ name: param.name, cc: ccLabel(state.mappings[i]) });
    ctl.indices = [i];
    bindControl(ctl, {
      read: () => state.value[i],
      write: (v) => setParam(i, v, 'ui'),
      reset: () => setParam(i, param.def, 'ui')
    });
    $('#sim-controls').append(ctl.row);
  });

  GESTURE_AXES.forEach((axis) => {
    const pi = indexOf[axis.pos];
    const ni = indexOf[axis.neg];
    const ctl = makeRow({
      name: axis.name,
      cc: axisLabel(ni, pi),
      gesture: true,
      bipolar: true,
      ends: [axis.negLabel, axis.posLabel]
    });
    ctl.indices = [pi, ni];
    ctl.axis = axis;
    const write = (v) => {
      setParam(pi, Math.max(0, v), 'ui');
      setParam(ni, Math.max(0, -v), 'ui');
    };
    bindControl(ctl, {
      read: () => state.value[pi] - state.value[ni],
      write,
      reset: () => write(0),
      spring: true
    });
    $('#gesture-controls').append(ctl.row);
  });

  function refreshCCLabels() {
    for (const ctl of controls) {
      if (ctl.axis) {
        const [pi, ni] = ctl.indices;
        ctl.ccEl.textContent = axisLabel(ni, pi);
      } else {
        ctl.ccEl.textContent = ccLabel(state.mappings[ctl.indices[0]]);
      }
    }
  }

  function setPanel(open) {
    panel.hidden = !open;
    $('#btn-controls').setAttribute('aria-pressed', String(open));
  }
  const togglePanel = () => setPanel(panel.hidden);

  $('#btn-controls').addEventListener('click', togglePanel);
  $('#btn-close-controls').addEventListener('click', () => setPanel(false));

  $('#btn-randomize').addEventListener('click', () => {
    PARAMS.forEach((param, i) => {
      if (param.group === 'sim') setParam(i, 0.1 + Math.random() * 0.8, 'ui');
    });
  });
  $('#btn-defaults').addEventListener('click', () => {
    PARAMS.forEach((param, i) => setParam(i, param.def, 'ui'));
  });

  // --- Toast + row flash for external (MIDI / keyboard) changes -----------

  onParamChange((index, value, source) => {
    if (source === 'ui') return;
    const param = PARAMS[index];
    const gesture = param.group === 'gesture';

    const ctl = controls.find((c) => c.indices.includes(index));
    if (ctl && !panel.hidden) {
      ctl.row.classList.add('flash');
      clearTimeout(ctl.flashTimer);
      ctl.flashTimer = setTimeout(() => ctl.row.classList.remove('flash'), 160);
    }

    toast.classList.toggle('gesture', gesture);
    toast.querySelector('.toast-name').textContent = param.name;
    toast.querySelector('.toast-bar i').style.width = `${value * 100}%`;
    toast.querySelector('.toast-value').textContent = `${Math.round(value * 100)}%`;
    toast.querySelector('.toast-src').textContent = source === 'midi' ? ccLabel(state.mappings[index]) : 'key';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  });

  // --- MIDI status -------------------------------------------------------

  let firstStatus = true;
  onMidiStatus((midi) => {
    const chip = $('#chip-midi');
    chip.dataset.status = midi.status;
    const label = {
      pending: 'Connecting MIDI…',
      connected: midi.devices.length === 1 ? midi.devices[0] : `${midi.devices.length} MIDI devices`,
      none: 'No MIDI device',
      unavailable: 'MIDI unavailable'
    }[midi.status];
    chip.querySelector('.chip-label').textContent = label;
    chip.title = midi.status === 'unavailable'
      ? 'Web MIDI is blocked or unsupported in this browser. Use the on-screen controls.'
      : midi.devices.join(', ');
    $('#midi-devices').textContent = midi.devices.length ? midi.devices.join(', ') : label;

    // Like the original app: show on-screen controls when there's no controller.
    if (firstStatus && midi.status !== 'pending') {
      firstStatus = false;
      if (midi.status !== 'connected' && window.innerWidth > 720) setPanel(true);
    }
  });

  let blinkTimer = 0;
  onMidiActivity((msg) => {
    const dot = $('#chip-midi .dot');
    dot.classList.add('blink');
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => dot.classList.remove('blink'), 90);
    if (settings.open) {
      $('#midi-monitor').textContent = `Last CC: ${msg.cc} = ${Math.round(msg.value * 127)} (ch ${msg.channel})`;
    }
  });

  // --- Settings dialog ---------------------------------------------------

  const mapRows = [];
  function buildMapTable() {
    const table = $('#map-table');
    table.replaceChildren();
    mapRows.length = 0;
    PARAMS.forEach((param, i) => {
      if (i === 0 || PARAMS[i - 1].group !== param.group) {
        table.append(el('div', { class: 'map-group', text: param.group === 'sim' ? 'Simulation' : 'Gestures' }));
      }
      const input = el('input', {
        type: 'number', min: 0, max: 127, step: 1,
        value: state.mappings[i] >= 0 ? state.mappings[i] : '',
        'aria-label': `${param.name} CC number`
      });
      input.classList.toggle('unmapped', state.mappings[i] < 0);
      input.addEventListener('change', () => {
        const n = parseInt(input.value, 10);
        state.mappings[i] = Number.isInteger(n) && n >= 0 && n <= 127 ? n : -1;
        if (state.mappings[i] < 0) input.value = '';
        input.classList.toggle('unmapped', state.mappings[i] < 0);
        saveStored();
        refreshCCLabels();
      });
      const learn = el('button', { class: 'btn small ghost', type: 'button', text: 'Learn' });
      learn.addEventListener('click', () => startLearn(i));
      const meter = el('div', { class: `meter${param.group === 'gesture' ? ' gesture' : ''}` }, [el('i')]);
      table.append(el('span', { text: param.name }), input, learn, meter);
      mapRows.push({ input, learn, fill: meter.firstChild });
    });
  }

  onLearn((learnIndex, assigned) => {
    mapRows.forEach((row, i) => {
      const on = i === learnIndex;
      row.learn.classList.toggle('learning', on);
      row.learn.textContent = on ? 'Move a control…' : 'Learn';
      row.input.value = state.mappings[i] >= 0 ? state.mappings[i] : '';
      row.input.classList.toggle('unmapped', state.mappings[i] < 0);
    });
    if (assigned) refreshCCLabels();
  });

  function openSettings() {
    buildMapTable();
    syncPrefInputs();
    settings.showModal();
  }
  settings.addEventListener('close', () => startLearn(null));
  for (const dlg of [settings, help]) {
    // Click on the backdrop closes the dialog.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-help').addEventListener('click', () => help.showModal());
  $('#btn-mappings-reset').addEventListener('click', () => {
    state.mappings = DEFAULT_MAPPINGS.slice();
    saveStored();
    buildMapTable();
    refreshCCLabels();
  });

  // --- Preferences -------------------------------------------------------

  function applyPrefs() {
    document.body.classList.toggle('no-stats', !state.prefs.showStats);
    $('#btn-orbit').setAttribute('aria-pressed', String(state.prefs.autoRotate));
    $('#pref-spring-inline').checked = state.prefs.springGestures;
  }
  function syncPrefInputs() {
    document.querySelectorAll('[data-pref]').forEach((input) => {
      input.checked = !!state.prefs[input.dataset.pref];
    });
  }
  function setPref(key, value) {
    state.prefs[key] = value;
    saveStored();
    applyPrefs();
    syncPrefInputs();
  }
  document.querySelectorAll('[data-pref]').forEach((input) => {
    input.addEventListener('change', () => setPref(input.dataset.pref, input.checked));
  });
  $('#pref-spring-inline').addEventListener('change', (e) => setPref('springGestures', e.target.checked));
  $('#btn-orbit').addEventListener('click', () => setPref('autoRotate', !state.prefs.autoRotate));

  // --- Toolbar -----------------------------------------------------------

  function syncPaused() {
    const paused = actions.isPaused();
    document.body.classList.toggle('paused', paused);
    const chip = $('#chip-state');
    chip.dataset.state = paused ? 'paused' : 'running';
    chip.querySelector('.chip-label').textContent = paused ? 'Paused' : 'Running';
    const btn = $('#btn-pause');
    btn.dataset.tip = paused ? 'Play (Space)' : 'Pause (Space)';
    btn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }
  const togglePause = () => { actions.togglePause(); syncPaused(); };

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-reset').addEventListener('click', actions.reset);
  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);

  // --- Keyboard ----------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (settings.open || help.open) return; // dialogs handle their own keys (Esc)
    if (e.target.matches?.('input[type="number"], input[type="text"], textarea')) return;
    // A focused button already reacts to Space/Enter; don't trigger twice.
    if (e.target.matches?.('button') && (e.key === ' ' || e.key === 'Enter')) return;
    // Let focused sliders keep their arrow keys.
    if (e.target.matches?.('input[type="range"]') && e.key.startsWith('Arrow')) return;

    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit) {
      const i = Number(digit[1]) - 1;
      setParam(i, state.target[i] + (e.shiftKey ? -0.1 : 0.1), 'key');
      e.preventDefault();
      return;
    }

    const handlers = {
      ' ': togglePause,
      p: togglePause,
      r: actions.reset,
      c: togglePanel,
      s: openSettings,
      a: () => setPref('autoRotate', !state.prefs.autoRotate),
      w: () => setPref('wireframe', !state.prefs.wireframe),
      v: actions.resetView,
      h: () => document.body.classList.toggle('ui-hidden'),
      f: toggleFullscreen,
      '?': () => help.showModal()
    };
    const fn = handlers[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });

  // --- Per-frame sync ----------------------------------------------------

  let statsAt = 0;
  function frame(now) {
    // Sliders follow the smoothed values, so MIDI moves and spring-backs animate.
    if (!panel.hidden) {
      for (const ctl of controls) {
        if (ctl.active || now - ctl.lastInput < 400) continue;
        const v = ctl.read();
        if (Math.abs(v - ctl.shown) > 0.001 || Number.isNaN(ctl.shown)) {
          ctl.input.value = v;
          paint(ctl, v);
        }
      }
    }

    if (settings.open) {
      mapRows.forEach((row, i) => { row.fill.style.width = `${state.value[i] * 100}%`; });
    }

    if (now - statsAt > 500 && state.prefs.showStats) {
      statsAt = now;
      const { fps, particles } = actions.stats();
      $('#chip-stats').textContent = `${fps} fps · ${particles} particles`;
    }
  }

  applyPrefs();
  syncPaused();
  return { frame };
}
