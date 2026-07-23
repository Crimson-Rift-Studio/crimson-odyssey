import { stdin, stdout } from 'node:process';
import { renderLayout } from './layout.js';
import { decodeInput, mouseDirection } from './input.js';
import { loadWorkspaceState } from '../core/state.js';
import { readMessages, createSession, listSessions, sessionMeta } from '../session/session.js';
import { runAgentTurn } from '../agent/runtime.js';
import { loadoutPreview, loadSkillCatalog, equipSkill } from '../loadout/engine.js';
import { PROVIDERS, fetchModels } from '../providers/catalog.js';
import { readJSON, writeJSON } from '../core/fs.js';
import { prepareModelSelection } from '../providers/picker.js';
import { createLogger } from '../core/log.js';

const ENTER_ALT = '\x1b[?1049h';
const EXIT_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1006l';

function helpText() {
  return [
    'Commands:',
    '/model opens the provider and model picker.',
    '/loadout opens the skill and slot picker.',
    '/session opens the session picker.',
    '/sidebar toggles the right sidebar.',
    '/logs focuses the sidebar log stream.',
    '/clear clears the visible transcript only.',
    '/exit closes Crimson Odyssey.',
    '',
    'Navigation: PgUp and PgDn scroll conversation history. Tab changes focus. Mouse wheel scrolls the pane below the pointer.'
  ].join('\n');
}

function messageFromHistory(entry) {
  return {
    role: entry.kind === 'error' ? 'error' : entry.role,
    kind: entry.kind,
    content: entry.content,
    time: entry.time
  };
}

export async function runTUI({ workspace = process.cwd(), sessionId = null } = {}) {
  const workspaceState = loadWorkspaceState(workspace);
  let session = sessionId ? sessionMeta(workspaceState.paths, sessionId) : null;
  if (!session) session = createSession(workspaceState.paths, { platform: 'tui' });
  const preview = loadoutPreview(workspaceState.paths, workspaceState.workspace.loadout || 'default');

  const state = {
    workspace,
    paths: workspaceState.paths,
    session,
    messages: readMessages(workspaceState.paths, session.id).map(messageFromHistory),
    input: '',
    scroll: 0,
    sidebarScroll: 0,
    sidebarOpen: true,
    sidebarBreakpoint: workspaceState.config.ui?.sidebarBreakpoint || 110,
    sidebarWidth: workspaceState.config.ui?.sidebarWidth || 34,
    focus: 'composer',
    busy: false,
    activeStage: 'ready',
    modal: null,
    logs: [],
    model: workspaceState.model,
    heartbeat: workspaceState.heartbeat,
    equipped: preview.equipped,
    exit: false,
    renderMeta: null
  };

  const logger = createLogger(workspaceState.paths, {
    onEntry(entry) {
      state.logs.push(entry);
      if (state.logs.length > 100) state.logs.shift();
    }
  });

  let renderQueued = false;
  function render() {
    const width = Math.max(40, stdout.columns || 100);
    const height = Math.max(12, stdout.rows || 30);
    const result = renderLayout(state, width, height);
    state.renderMeta = result.meta;
    stdout.write(`\x1b[H${result.text}`);
  }
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setImmediate(() => {
      renderQueued = false;
      render();
    });
  }

  function addMessage(role, content, kind = 'message') {
    state.messages.push({ role, content, kind, time: new Date().toISOString() });
    if (state.scroll === 0) state.scroll = 0;
    queueRender();
  }

  function refreshLoadout() {
    const current = loadWorkspaceState(workspace);
    state.equipped = loadoutPreview(current.paths, current.workspace.loadout || 'default').equipped;
  }

  function closeModal() {
    state.modal = null;
    queueRender();
  }

  function openProviderModal() {
    state.modal = {
      type: 'model',
      phase: 'provider',
      title: 'Select Provider',
      subtitle: 'Choose with arrows, type a number, or press Esc',
      choices: PROVIDERS.map((provider) => ({ label: provider.name, value: provider.id })),
      index: 0,
      scroll: 0,
      numberBuffer: '',
      footer: 'Enter select  0 custom model after provider  Esc close'
    };
    queueRender();
  }

  async function selectProvider(providerId) {
    state.modal = {
      type: 'model',
      phase: 'loading',
      title: 'Loading Models',
      subtitle: providerId,
      choices: [{ label: 'Fetching provider catalog...', value: null }],
      index: 0,
      providerId
    };
    queueRender();
    const latest = loadWorkspaceState(workspace);
    const catalog = await fetchModels(providerId, latest.config, { paths: latest.paths, refresh: false });
    state.modal = {
      type: 'model',
      phase: 'model',
      title: `${catalog.provider.name} Models`,
      subtitle: catalog.liveAvailable ? `Live catalog${catalog.fromCache ? ' from cache' : ''}` : 'Suggested catalog. Use 0 for a custom model ID.',
      choices: catalog.models.map((entry) => ({
        label: `${entry.id}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''}`,
        value: entry.id
      })),
      index: 0,
      scroll: 0,
      providerId,
      numberBuffer: '',
      footer: 'Enter select  0 custom model ID  Esc back'
    };
    queueRender();
  }

  function saveModel(providerId, model, custom = false) {
    const latest = loadWorkspaceState(workspace);
    const provider = PROVIDERS.find((item) => item.id === providerId);
    const config = readJSON(latest.paths.config, latest.config);
    let selected;
    try {
      selected = prepareModelSelection(providerId, model, config, { custom });
    } catch (error) {
      addMessage('error', error.message, 'error');
      closeModal();
      return false;
    }
    writeJSON(latest.paths.config, config);
    writeJSON(latest.paths.model, selected);
    state.model = selected;
    logger('info', 'model.changed', { provider: providerId, model });
    addMessage('system', `Model changed to ${provider?.name || providerId} / ${model}.`);
    closeModal();
    return true;
  }

  function openLoadoutModal() {
    const latest = loadWorkspaceState(workspace);
    const catalog = loadSkillCatalog(latest.paths);
    const equippedIds = new Set(Object.values(state.equipped).flat().map((item) => item.id));
    state.modal = {
      type: 'loadout',
      phase: 'skill',
      title: 'Loadout Manager',
      subtitle: 'Select a skill, then choose its slot',
      choices: catalog.map((skill) => ({
        label: `${skill.name} [${skill.slots.join(', ')}]${equippedIds.has(skill.id) ? ' [equipped]' : ''}`,
        value: skill.id,
        skill
      })),
      index: 0,
      scroll: 0,
      numberBuffer: '',
      footer: 'Enter preview slots  Esc close'
    };
    queueRender();
  }

  function openSessionModal() {
    const sessions = listSessions(workspaceState.paths);
    state.modal = {
      type: 'session',
      phase: 'list',
      title: 'Sessions',
      subtitle: 'Select a session to switch context',
      choices: [
        { label: '+ New session', value: '__new__' },
        ...sessions.map((item) => ({ label: `${item.id}  ${item.platform}  ${item.turnCount || 0} turns`, value: item.id }))
      ],
      index: 0,
      scroll: 0,
      numberBuffer: '',
      footer: 'Enter switch  Esc close'
    };
    queueRender();
  }

  async function submitModalSelection() {
    const modal = state.modal;
    if (!modal) return;
    if (modal.mode === 'text') {
      if (modal.input?.trim()) saveModel(modal.providerId, modal.input.trim(), true);
      return;
    }
    const choice = modal.choices?.[modal.index || 0];
    if (!choice) return;
    if (modal.type === 'model' && modal.phase === 'provider') {
      await selectProvider(choice.value);
      return;
    }
    if (modal.type === 'model' && modal.phase === 'model') {
      saveModel(modal.providerId, choice.value, false);
      return;
    }
    if (modal.type === 'loadout' && modal.phase === 'skill') {
      modal.phase = 'slot';
      modal.selectedSkill = choice.skill;
      modal.title = choice.skill.name;
      modal.subtitle = `${choice.skill.description} | Select slot`;
      modal.choices = choice.skill.slots.map((slot) => ({ label: slot.toUpperCase(), value: slot }));
      modal.index = 0;
      modal.scroll = 0;
      modal.numberBuffer = '';
      queueRender();
      return;
    }
    if (modal.type === 'loadout' && modal.phase === 'slot') {
      const latest = loadWorkspaceState(workspace);
      equipSkill(latest.paths, {
        loadoutName: latest.workspace.loadout || 'default',
        skillId: modal.selectedSkill.id,
        slot: choice.value
      });
      refreshLoadout();
      logger('info', 'loadout.equipped', { skill: modal.selectedSkill.id, slot: choice.value });
      addMessage('system', `${modal.selectedSkill.name} equipped as ${choice.value}.`);
      closeModal();
      return;
    }
    if (modal.type === 'session') {
      session = choice.value === '__new__' ? createSession(workspaceState.paths, { platform: 'tui' }) : sessionMeta(workspaceState.paths, choice.value);
      state.session = session;
      state.messages = readMessages(workspaceState.paths, session.id).map(messageFromHistory);
      state.scroll = 0;
      logger('info', 'session.switched', { session: session.id });
      closeModal();
    }
  }

  async function handleModal(event) {
    const modal = state.modal;
    if (!modal) return false;
    if (event.type === 'escape') {
      if (modal.type === 'model' && modal.phase === 'model') openProviderModal();
      else closeModal();
      return true;
    }
    if (modal.mode === 'text') {
      if (event.type === 'backspace') modal.input = [...(modal.input || '')].slice(0, -1).join('');
      else if (event.type === 'text') modal.input = `${modal.input || ''}${event.text}`;
      else if (event.type === 'enter') await submitModalSelection();
      queueRender();
      return true;
    }
    if (event.type === 'up') modal.index = Math.max(0, (modal.index || 0) - 1);
    else if (event.type === 'down') modal.index = Math.min((modal.choices?.length || 1) - 1, (modal.index || 0) + 1);
    else if (event.type === 'page-up') modal.index = Math.max(0, (modal.index || 0) - 8);
    else if (event.type === 'page-down') modal.index = Math.min((modal.choices?.length || 1) - 1, (modal.index || 0) + 8);
    else if (event.type === 'text' && /^\d+$/.test(event.text)) {
      if (event.text === '0' && modal.type === 'model' && modal.phase === 'model') {
        modal.mode = 'text';
        modal.input = '';
        modal.title = 'Custom Model ID';
        modal.subtitle = 'Enter the exact model ID supplied by the provider';
      } else {
        modal.numberBuffer = `${modal.numberBuffer || ''}${event.text}`.slice(-3);
        const value = Number(modal.numberBuffer);
        if (value > 0 && value <= (modal.choices?.length || 0)) modal.index = value - 1;
      }
    } else if (event.type === 'backspace') {
      modal.numberBuffer = (modal.numberBuffer || '').slice(0, -1);
    } else if (event.type === 'enter') {
      await submitModalSelection();
    }
    if (modal.index < (modal.scroll || 0)) modal.scroll = modal.index;
    if (modal.index >= (modal.scroll || 0) + 12) modal.scroll = modal.index - 11;
    queueRender();
    return true;
  }

  async function processCommand(text) {
    const [command] = text.trim().split(/\s+/);
    if (['/exit', '/quit', '/keluar'].includes(command)) {
      state.exit = true;
      return;
    }
    if (['/help', '/bantuan'].includes(command)) return addMessage('system', helpText());
    if (command === '/model') return openProviderModal();
    if (command === '/loadout') return openLoadoutModal();
    if (command === '/session') return openSessionModal();
    if (command === '/sidebar') {
      state.sidebarOpen = !state.sidebarOpen;
      return queueRender();
    }
    if (command === '/logs') {
      state.focus = 'sidebar';
      state.sidebarOpen = true;
      return queueRender();
    }
    if (command === '/clear') {
      state.messages = [];
      state.scroll = 0;
      return queueRender();
    }
    return addMessage('system', `Unknown command: ${command}. Use /help.`);
  }

  async function submitInput() {
    const text = state.input.trim();
    if (!text || state.busy) return;
    state.input = '';
    if (text.startsWith('/')) {
      await processCommand(text);
      return;
    }
    state.busy = true;
    state.activeStage = 'thinking';
    addMessage('user', text);
    logger('info', 'turn.started', { session: session.id });
    try {
      const result = await runAgentTurn({
        workspace,
        session,
        text,
        onActivity(activity) {
          logger('info', activity.event, activity.detail || {});
          state.activeStage = activity.event;
          queueRender();
        }
      });
      addMessage('assistant', result.answer);
      state.heartbeat = result.state.heartbeat;
      refreshLoadout();
    } catch (error) {
      addMessage('error', error.message, 'error');
    } finally {
      state.busy = false;
      state.activeStage = 'ready';
      queueRender();
    }
  }

  function adjustScroll(direction, amount = 3, x = 0) {
    const sidebar = state.renderMeta?.sidebarVisible && x > state.renderMeta.mainWidth;
    if (sidebar || state.focus === 'sidebar') {
      const max = state.renderMeta?.sidebarMaxScroll || 0;
      state.sidebarScroll = Math.max(0, Math.min(max, state.sidebarScroll + (direction === 'up' ? amount : -amount)));
    } else {
      const max = state.renderMeta?.maxScroll || 0;
      state.scroll = Math.max(0, Math.min(max, state.scroll + (direction === 'up' ? amount : -amount)));
    }
    queueRender();
  }

  async function handleData(data) {
    const event = decodeInput(data);
    if (state.modal && await handleModal(event)) return;
    if (event.type === 'ctrl-c') {
      state.exit = true;
      return;
    }
    if (event.type === 'ctrl-b') {
      state.sidebarOpen = !state.sidebarOpen;
      return queueRender();
    }
    if (event.type === 'tab') {
      const order = state.renderMeta?.sidebarVisible ? ['composer', 'transcript', 'sidebar'] : ['composer', 'transcript'];
      state.focus = order[(order.indexOf(state.focus) + 1) % order.length];
      return queueRender();
    }
    if (event.type === 'page-up') return adjustScroll('up', Math.max(4, Math.floor((state.renderMeta?.transcriptHeight || 10) * 0.7)));
    if (event.type === 'page-down') return adjustScroll('down', Math.max(4, Math.floor((state.renderMeta?.transcriptHeight || 10) * 0.7)));
    if (event.type === 'home' && state.focus !== 'composer') {
      state.scroll = state.renderMeta?.maxScroll || 0;
      return queueRender();
    }
    if (event.type === 'end' && state.focus !== 'composer') {
      state.scroll = 0;
      return queueRender();
    }
    if (event.type === 'mouse') {
      const direction = mouseDirection(event.button);
      if (direction) return adjustScroll(direction, 3, event.x);
      return;
    }
    if (state.focus !== 'composer') {
      if (event.type === 'up') return adjustScroll('up', 1);
      if (event.type === 'down') return adjustScroll('down', 1);
      if (event.type === 'text') state.focus = 'composer';
      else return;
    }
    if (event.type === 'enter') return submitInput();
    if (event.type === 'backspace') state.input = [...state.input].slice(0, -1).join('');
    else if (event.type === 'text') state.input += event.text;
    queueRender();
  }

  function cleanup() {
    stdin.off('data', handleData);
    stdout.off('resize', queueRender);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write(`${DISABLE_MOUSE}${SHOW_CURSOR}${EXIT_ALT}`);
  }

  stdout.write(`${ENTER_ALT}${HIDE_CURSOR}${ENABLE_MOUSE}\x1b[2J\x1b[H`);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdin.on('data', handleData);
  stdout.on('resize', queueRender);
  logger('info', 'tui.started', { session: session.id, workspace });
  if (!state.messages.length) addMessage('assistant', `Crimson Odyssey v0.2.0 is ready. Type /help for commands.`);
  render();

  try {
    while (!state.exit) await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    logger('info', 'tui.stopped', { session: session.id });
    cleanup();
  }
  return 0;
}
