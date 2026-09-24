import { WebMidi } from 'webmidi';
import { state, setParam, saveStored } from './params.js';

// MIDI status: 'pending' | 'connected' | 'none' | 'unavailable'
const midi = {
  status: 'pending',
  devices: [],
  learnIndex: null,
  lastCC: null
};

const statusListeners = new Set();
const activityListeners = new Set();
const learnListeners = new Set();

export function onMidiStatus(fn) {
  statusListeners.add(fn);
  fn(midi);
}
export function onMidiActivity(fn) {
  activityListeners.add(fn);
}
export function onLearn(fn) {
  learnListeners.add(fn);
}

function emitStatus() {
  midi.devices = WebMidi.enabled ? WebMidi.inputs.map((i) => i.name) : [];
  if (WebMidi.enabled) midi.status = midi.devices.length ? 'connected' : 'none';
  statusListeners.forEach((fn) => fn(midi));
}

// Start (or cancel with null) MIDI learn for a parameter: the next CC received
// is assigned to it.
export function startLearn(index) {
  midi.learnIndex = midi.learnIndex === index ? null : index;
  learnListeners.forEach((fn) => fn(midi.learnIndex, null));
}

function handleCC(e) {
  const cc = e.controller.number;
  const value = e.value; // normalized 0..1
  midi.lastCC = { cc, value, channel: e.message.channel };

  if (midi.learnIndex !== null) {
    const index = midi.learnIndex;
    // A CC can only drive one parameter: unassign it elsewhere.
    state.mappings = state.mappings.map((m, i) => (m === cc && i !== index ? -1 : m));
    state.mappings[index] = cc;
    midi.learnIndex = null;
    saveStored();
    learnListeners.forEach((fn) => fn(null, { index, cc }));
  }

  const index = state.mappings.indexOf(cc);
  if (index !== -1) setParam(index, value, 'midi');
  activityListeners.forEach((fn) => fn(midi.lastCC, index));
}

function attach(input) {
  input.removeListener('controlchange', handleCC);
  input.addListener('controlchange', handleCC);
}

export async function initMidi() {
  try {
    await WebMidi.enable();
    WebMidi.inputs.forEach(attach);
    // Hot-plug: devices connected after load work without a refresh.
    WebMidi.addListener('connected', (e) => {
      if (e.port.type === 'input') attach(e.port);
      emitStatus();
    });
    WebMidi.addListener('disconnected', emitStatus);
    emitStatus();
  } catch (err) {
    console.warn('WebMidi could not be enabled:', err);
    midi.status = 'unavailable';
    statusListeners.forEach((fn) => fn(midi));
  }
  return midi;
}
