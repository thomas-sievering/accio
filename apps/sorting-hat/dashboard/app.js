// The Sorting Hat's dashboard: plain DOM over the management API (API.md).
// Every call carries the dashboard header; the server lets it through on
// loopback or behind Cloudflare Access (README.md, "Dashboard").

const PROVIDERS = { anthropic: 'Claude', openai: 'ChatGPT' };
const state = { accounts: [], houses: [], hatKeys: [], limits: [] };
const $ = (selector) => document.querySelector(selector);

// ---------- API ----------

class ApiError extends Error {}

async function api(method, path, body) {
  const headers = { 'x-sorting-hat-dashboard': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!res.ok) throw new ApiError(data?.error?.message ?? `The Sorting Hat answered ${res.status}.`);
  return data;
}

async function load() {
  const usage = fetchUsage();
  usage.catch(() => {});
  const [accounts, houses, hatKeys, limits] = await Promise.all([api('GET', 'accounts'), api('GET', 'houses'), api('GET', 'hat-keys'), api('GET', 'limits')]);
  Object.assign(state, { accounts, houses, hatKeys, limits });
  render();
  await usage.then(showUsage);
}

/** Runs an action from the page; failures show in the toast. */
async function act(fn) {
  try { await fn(); } catch (error) { toast(error.message); }
  try { await load(); } catch (error) { toast(error.message); }
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// ---------- DOM helpers ----------

/** h('div', { class: 'x', onclick }, ...children): children are nodes or strings, never HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    // Through CSSOM: the page's CSP refuses style attributes.
    else if (key === 'style') Object.assign(el.style, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false) el.append(child);
  return el;
}

const button = (label, onclick, props = {}) => h('button', { type: 'button', onclick, ...props }, label);
const accountById = (id) => state.accounts.find((a) => a.id === id);
const accountName = (id) => accountById(id)?.name ?? id;

function relative(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const units = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) if (abs >= size) return fmt.format(Math.round(ms / size), unit);
  return ms >= 0 ? 'in under a minute' : 'just now';
}

const date = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// ---------- Render ----------

function render() {
  renderAccounts();
  renderHouses();
}

function renderAccounts() {
  const list = $('#account-list');
  if (!state.accounts.length) return list.replaceChildren(h('p', { class: 'empty' }, 'No accounts yet. Add a Claude or ChatGPT account and sign it in.'));
  list.replaceChildren(...state.accounts.map(accountCard));
}

function accountCard(account) {
  const houses = state.houses.filter((house) => house.accounts[account.providerId].includes(account.id));
  const inUseBy = houses.filter((house) => house.inUse[account.providerId] === account.id);
  const who = [account.email, account.organization].filter(Boolean).join(' · ');
  return h('article', { class: 'card', 'aria-label': `Account ${account.name}` },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h3', {}, account.name),
        h('p', { class: 'muted small' }, `${PROVIDERS[account.providerId]} account`, who ? ` · ${who}` : ''),
      ),
      account.signedIn ? h('span', { class: 'tag ok' }, 'Signed in') : h('span', { class: 'tag off' }, 'Signed out'),
    ),
    limitsView(account),
    h('p', { class: 'muted small' },
      houses.length ? `In ${houses.map((x) => x.name).join(', ')}` : 'In no house',
      inUseBy.length ? ` · in use for ${inUseBy.map((x) => x.name).join(', ')}` : ''),
    h('div', { class: 'actions' },
      button(account.signedIn ? 'Sign in again' : 'Sign in', () => signIn(account), { class: account.signedIn ? '' : 'primary' }),
      account.signedIn && button('Sign out', () => confirmAction({
        title: `Sign ${account.name} out?`, message: 'Its credentials are cleared. Its name and houses stay, so you can sign it in again.',
        confirm: 'Sign out', run: () => api('POST', `accounts/${enc(account.id)}/sign-out`),
      })),
      button('Rename', () => askName({ title: 'Rename account', value: account.name, submit: 'Rename', run: (name) => api('PATCH', `accounts/${enc(account.id)}`, { name }) })),
      button('Delete', () => confirmAction({
        title: `Delete ${account.name}?`, message: houses.length ? `Remove it from ${houses.map((x) => x.name).join(', ')} first.` : 'Its credentials and limits are removed from the Sorting Hat.',
        confirm: 'Delete account', danger: true, run: () => api('DELETE', `accounts/${enc(account.id)}`),
      }), { class: 'danger' }),
    ),
  );
}

function limitsView(account) {
  const limits = state.limits.find((l) => l.accountId === account.id);
  if (!account.signedIn) return h('p', { class: 'muted small' }, 'Sign in to see its limits.');
  if (!limits) return h('p', { class: 'muted small' }, 'No limits read yet.');
  const windows = limits.snapshot?.windows ?? [];
  const note = limits.problem?.message ?? (limits.status === 'unsupported' ? 'This provider does not report limits.' : limits.status === 'refreshing' ? 'Reading limits…' : !windows.length ? 'No limits read yet.' : null);
  return h('div', { class: 'limits', 'aria-label': `Limits of ${account.name}` },
    windows.map((w) => {
      const used = w.usedPercent;
      const level = used === null ? '' : used >= 95 ? 'full' : used >= 75 ? 'high' : '';
      const resets = relative(w.resetsAt);
      return h('div', { class: 'limit' },
        h('div', { class: 'limit-row' },
          h('span', {}, w.label, w.scope ? ` · ${w.scope}` : ''),
          h('span', { class: 'muted' }, used === null ? 'unknown' : `${Math.round(used)}% used`, resets ? ` · resets ${resets}` : ''),
        ),
        h('div', { class: `bar ${level}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': used === null ? undefined : String(Math.round(used)), 'aria-label': w.label },
          h('span', { style: { width: `${Math.max(0, Math.min(100, used ?? 0))}%` } })),
      );
    }),
    note && h('p', { class: 'muted small' }, note),
    limits.snapshot && h('p', { class: 'muted small' }, `Read ${relative(limits.snapshot.observedAt)}`),
  );
}

function renderHouses() {
  const list = $('#house-list');
  if (!state.houses.length) return list.replaceChildren(h('p', { class: 'empty' }, 'No houses yet. Create one, add accounts to it, and give each app a hat key.'));
  list.replaceChildren(...state.houses.map(houseCard));
}

function houseCard(house) {
  const keys = state.hatKeys.filter((k) => k.houseId === house.id);
  return h('article', { class: 'card', 'aria-label': `House ${house.name}` },
    h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, house.name), h('p', { class: 'muted small mono' }, house.id)),
      h('div', { class: 'actions' },
        button('Rename', () => askName({ title: 'Rename house', value: house.name, submit: 'Rename', run: (name) => api('PATCH', `houses/${enc(house.id)}`, { name }) })),
        button('Delete', () => confirmAction({
          title: `Delete ${house.name}?`, message: `Its ${keys.length === 1 ? 'hat key is' : `${keys.length} hat keys are`} deleted too, and apps using ${keys.length === 1 ? 'it' : 'them'} stop working. The accounts stay.`,
          confirm: 'Delete house', danger: true, run: () => api('DELETE', `houses/${enc(house.id)}`),
        }), { class: 'danger' }),
      ),
    ),
    h('div', { class: 'providers' }, Object.keys(PROVIDERS).map((provider) => providerOrder(house, provider))),
    hatKeysView(house, keys),
  );
}

function providerOrder(house, provider) {
  const ids = house.accounts[provider];
  const setOrder = (next) => act(() => api('PUT', `houses/${enc(house.id)}/accounts`, { [provider]: next }));
  const move = (i, by) => { const next = [...ids]; [next[i], next[i + by]] = [next[i + by], next[i]]; setOrder(next); };
  const available = state.accounts.filter((a) => a.providerId === provider && !ids.includes(a.id));
  const select = h('select', { 'aria-label': `${PROVIDERS[provider]} account to add to ${house.name}` },
    h('option', { value: '' }, available.length ? 'Choose an account…' : `No other ${PROVIDERS[provider]} accounts`),
    available.map((a) => h('option', { value: a.id }, a.name)));
  return h('div', { class: 'provider', 'aria-label': `${PROVIDERS[provider]} accounts of ${house.name}`, role: 'group' },
    h('h3', {}, `${PROVIDERS[provider]} accounts`),
    ids.length ? h('ol', { class: 'order' }, ids.map((id, i) => {
      const account = accountById(id);
      const name = accountName(id);
      return h('li', {},
        h('span', { class: 'pos' }, String(i + 1)),
        h('span', { class: 'name' }, name),
        house.inUse[provider] === id && h('span', { class: 'tag ok' }, 'In use'),
        account && !account.signedIn && h('span', { class: 'tag off' }, 'Signed out'),
        button('↑', () => move(i, -1), { class: 'icon', 'aria-label': `Move ${name} up`, disabled: i === 0 }),
        button('↓', () => move(i, 1), { class: 'icon', 'aria-label': `Move ${name} down`, disabled: i === ids.length - 1 }),
        button('×', () => setOrder(ids.filter((x) => x !== id)), { class: 'icon', 'aria-label': `Remove ${name} from ${house.name}` }),
      );
    })) : h('p', { class: 'muted small' }, `No ${PROVIDERS[provider]} account. Requests to this provider get refused.`),
    h('div', { class: 'add-row' },
      select,
      button('Add', () => { if (select.value) setOrder([...ids, select.value]); }, { disabled: !available.length, 'aria-label': `Add ${PROVIDERS[provider]} account to ${house.name}` }),
    ),
  );
}

function hatKeysView(house, keys) {
  return h('div', { class: 'keys', role: 'group', 'aria-label': `Hat keys of ${house.name}` },
    h('div', { class: 'keys-head' },
      h('h3', {}, 'Hat keys'),
      button('New hat key', () => newHatKey(house)),
    ),
    keys.length ? h('table', { class: 'key-table' }, h('tbody', {}, keys.map((key) => h('tr', { class: key.revokedAt ? 'revoked' : '', 'aria-label': `Hat key ${key.name}` },
      h('td', { class: 'key-name' }, key.name),
      h('td', { class: 'muted small' }, key.revokedAt ? `Revoked ${date(key.revokedAt)}` : `Created ${date(key.createdAt)}`),
      h('td', { class: 'key-actions' },
        button('Rename', () => askName({ title: 'Rename hat key', value: key.name, submit: 'Rename', run: (name) => api('PATCH', `hat-keys/${enc(key.id)}`, { name }) })),
        !key.revokedAt && button('Revoke', () => confirmAction({
          title: `Revoke ${key.name}?`, message: 'Apps using it are refused from now on. It stays listed until you delete it.',
          confirm: 'Revoke', danger: true, run: () => api('POST', `hat-keys/${enc(key.id)}/revoke`),
        }), { class: 'danger' }),
        button('Delete', () => confirmAction({
          title: `Delete ${key.name}?`, message: key.revokedAt ? 'It is removed from the list.' : 'Apps using it are refused from now on.',
          confirm: 'Delete', danger: true, run: () => api('DELETE', `hat-keys/${enc(key.id)}`),
        }), { class: 'danger' }),
      ),
    )))) : h('p', { class: 'muted small' }, 'No hat keys. Create one for each app that should use this house.'),
  );
}

const enc = encodeURIComponent;

// ---------- Dialogs ----------

const dialog = $('#dialog');
let onDialogClose;
const finishDialog = () => { const done = onDialogClose; onDialogClose = undefined; done?.(); };
// Escape closes it too. The event comes later than close(): skip it when another dialog opened since.
// Its content goes too, so a hat key's secret leaves the page once its dialog closes.
dialog.addEventListener('close', () => { if (!dialog.open) { finishDialog(); dialog.replaceChildren(); } });

/** Opens the dialog with new content; `closed` runs once when it closes or is replaced. */
function openDialog(title, content, closed) {
  finishDialog();
  onDialogClose = closed;
  dialog.replaceChildren(content);
  const heading = content.querySelector('h2');
  if (heading) heading.id = 'dialog-title';
  dialog.setAttribute('aria-label', title);
  if (!dialog.open) dialog.showModal();
}

function closeDialog() { finishDialog(); if (dialog.open) dialog.close(); dialog.replaceChildren(); }

/** A form in the dialog: `run` gets the form; a thrown error shows in the dialog. */
function formDialog({ title, fields, submit, danger, run, note }) {
  const error = h('p', { class: 'error', role: 'alert' });
  const submitButton = h('button', { type: 'submit', class: danger ? 'danger solid' : 'primary' }, submit);
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      submitButton.disabled = true; error.textContent = '';
      try { await run(form); } catch (e) { error.textContent = e.message; submitButton.disabled = false; }
    },
  },
  h('h2', {}, title),
  note && h('p', { class: 'muted' }, note),
  fields,
  error,
  h('div', { class: 'buttons' }, button('Cancel', closeDialog), submitButton));
  openDialog(title, form);
  form.querySelector('input, select, textarea, button[type=submit]')?.focus();
  return form;
}

function askName({ title, value = '', submit, run, label = 'Name', note }) {
  const input = h('input', { type: 'text', name: 'name', value, required: true, maxlength: '80', autocomplete: 'off' });
  // `run` may open the next dialog (sign-in, the new hat key); close only this form.
  formDialog({ title, note, submit, fields: h('label', {}, label, input), run: async (form) => { await run(input.value.trim()); if (dialog.contains(form)) closeDialog(); await load().catch((e) => toast(e.message)); } });
}

function confirmAction({ title, message, confirm, danger, run }) {
  formDialog({ title, note: message, submit: confirm, danger, fields: [], run: async () => { await run(); closeDialog(); await load().catch((e) => toast(e.message)); } });
}

// ---------- Accounts and sign-in ----------

function addAccount(providerId) {
  askName({
    title: `Add a ${PROVIDERS[providerId]} account`, label: 'Account name', submit: 'Add and sign in',
    note: `A name for this ${PROVIDERS[providerId]} login, such as “Personal” or “Work”.`,
    run: async (name) => {
      const account = await api('POST', 'accounts', { name, providerId });
      await load();
      await signIn(account);
    },
  });
}

function signIn(account) {
  if (account.providerId === 'anthropic') return claudeSignIn(account);
  chatgptChoice(account);
}

async function claudeSignIn(account) {
  let started;
  try { started = await api('POST', `accounts/${enc(account.id)}/sign-in`, {}); } catch (e) { return toast(e.message); }
  let finished = false;
  const code = h('input', { type: 'text', name: 'code', required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'code#state' });
  const error = h('p', { class: 'error', role: 'alert' });
  const finish = h('button', { type: 'submit', class: 'primary' }, 'Finish sign-in');
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      finish.disabled = true; error.textContent = '';
      try {
        await api('POST', `sign-ins/${enc(started.signInId)}/complete`, { code: code.value.trim() });
        finished = true; closeDialog(); await load();
      } catch (e) { error.textContent = e.message; finish.disabled = false; }
    },
  },
  h('h2', {}, `Sign ${account.name} in with Claude`),
  h('ol', { class: 'steps' },
    h('li', {}, h('a', { class: 'button primary', href: started.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open Claude sign-in'), ' and approve.'),
    h('li', {}, 'Copy the code Claude shows and paste it here.'),
  ),
  h('label', {}, 'Code', code),
  error,
  h('div', { class: 'buttons' }, button('Cancel', closeDialog), finish));
  openDialog('Claude sign-in', form, () => { if (!finished) api('DELETE', `sign-ins/${enc(started.signInId)}`).catch(() => {}); });
}

function chatgptChoice(account) {
  const body = h('div', { class: 'body' },
    h('h2', {}, `Sign ${account.name} in with ChatGPT`),
    h('p', { class: 'muted' }, 'With a code you approve on any device. In this browser, you paste back the address ChatGPT sends you to.'),
    h('div', { class: 'buttons' },
      button('Cancel', closeDialog),
      button('Sign in in this browser', () => chatgptSignIn(account, 'browser')),
      button('Sign in with a code', () => chatgptSignIn(account, 'device'), { class: 'primary' }),
    ));
  openDialog('ChatGPT sign-in', body);
}

async function chatgptSignIn(account, flow) {
  let started;
  try { started = await api('POST', `accounts/${enc(account.id)}/sign-in`, { flow }); } catch (e) { closeDialog(); return toast(e.message); }
  let finished = false;
  let timer;
  const error = h('p', { class: 'error', role: 'alert' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Waiting for approval…');
  const poll = async () => {
    try {
      const result = await api('GET', `sign-ins/${enc(started.signInId)}`);
      if (result.status === 'complete') { finished = true; closeDialog(); await load(); return; }
    } catch (e) { error.textContent = e.message; status.textContent = ''; return; }
    timer = setTimeout(poll, 1500);
  };
  const link = h('a', { class: 'button primary', href: started.url, target: '_blank', rel: 'noopener noreferrer' }, flow === 'device' ? 'Open ChatGPT' : 'Open ChatGPT sign-in');
  let content;
  if (flow === 'device') {
    content = [
      h('ol', { class: 'steps' },
        h('li', {}, link, ' on any device.'),
        h('li', {}, 'Enter this code and approve:', h('div', { class: 'secret' }, h('code', { class: 'user-code', 'aria-label': 'Device code' }, started.userCode), copyButton(() => started.userCode, 'Copy code')))),
    ];
  } else {
    const address = h('input', { type: 'text', name: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'http://localhost:1455/auth/callback?code=…' });
    const send = button('Send address', async () => {
      error.textContent = '';
      try { await api('POST', `sign-ins/${enc(started.signInId)}/complete`, { url: address.value.trim() }); status.textContent = 'Finishing sign-in…'; }
      catch (e) { error.textContent = e.message; }
    });
    content = [
      h('ol', { class: 'steps' },
        h('li', {}, link, ' and approve.'),
        h('li', {}, 'ChatGPT then opens a localhost address, which may not load. Copy that address from the address bar and paste it here.')),
      h('label', {}, 'Address', h('div', { class: 'add-row' }, address, send)),
    ];
  }
  openDialog('ChatGPT sign-in', h('div', { class: 'body' },
    h('h2', {}, `Sign ${account.name} in with ChatGPT`), content, status, error,
    h('div', { class: 'buttons' }, button('Cancel', closeDialog))),
  () => { clearTimeout(timer); if (!finished) api('DELETE', `sign-ins/${enc(started.signInId)}`).catch(() => {}); });
  timer = setTimeout(poll, 1000);
}

// ---------- Houses and hat keys ----------

function addHouse() {
  const name = h('input', { type: 'text', name: 'name', required: true, maxlength: '80', autocomplete: 'off' });
  const id = h('input', { type: 'text', name: 'id', maxlength: '64', autocomplete: 'off', spellcheck: 'false', placeholder: 'made from the name' });
  formDialog({
    title: 'New house', submit: 'Create house',
    note: 'A group of accounts that apps reach with its hat keys, such as “personal” or “work”.',
    fields: [h('label', {}, 'Name', name), h('label', {}, h('span', {}, 'Id ', h('span', { class: 'muted small' }, '(optional, never changes)')), id)],
    run: async () => {
      await api('POST', 'houses', { name: name.value.trim(), ...(id.value.trim() ? { id: id.value.trim() } : {}) });
      closeDialog(); await load();
    },
  });
}

function newHatKey(house) {
  askName({
    title: `New hat key for ${house.name}`, label: 'Hat key name', submit: 'Create hat key',
    note: 'Name it after the app and machine that will use it, such as “pi on laptop”.',
    run: async (name) => {
      const key = await api('POST', 'hat-keys', { houseId: house.id, name });
      showHatKey(house, key);
    },
  });
}

function copyButton(text, label = 'Copy') {
  const b = button(label, async () => {
    const value = text();
    try { await navigator.clipboard.writeText(value); }
    catch {
      const area = h('textarea', {}, value); document.body.append(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = label; }, 1500);
  });
  return b;
}

/** The new key's only showing: its secret and settings for the apps that use it. */
function showHatKey(house, key) {
  const base = location.origin;
  const secret = key.secret;
  const snippets = {
    'Claude Code': {
      hint: 'Run Claude Code with these, and leave ANTHROPIC_API_KEY unset:',
      text: `ANTHROPIC_BASE_URL=${base} ANTHROPIC_AUTH_TOKEN=${secret} claude`,
    },
    'Claude Code settings': {
      hint: 'Or in ~/.claude/settings.json (or a project’s .claude/settings.local.json):',
      text: JSON.stringify({ env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: secret } }, null, 2),
    },
    'pi-claude-bridge': {
      hint: 'In ~/.pi/agent/auth.json, then pick a claude-bridge/… model with /model:',
      text: JSON.stringify({ 'claude-bridge': { type: 'api_key', key: 'not-used', env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: secret, ANTHROPIC_API_KEY: '' } } }, null, 2),
    },
    Codex: {
      hint: 'In ~/.codex/config.toml, then run SORTING_HAT_KEY=<hat key> codex:',
      text: `model_provider = "sorting-hat"\n\n[model_providers.sorting-hat]\nname = "Sorting Hat"\nbase_url = "${base}/openai"\nenv_key = "SORTING_HAT_KEY"\nwire_api = "responses"\nsupports_websockets = false`,
    },
  };
  const names = Object.keys(snippets);
  const hint = h('p', { class: 'muted small' });
  const pre = h('pre', { 'aria-label': 'Settings' });
  let current = names[0];
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, names.map((name) => button(name, () => pick(name), { role: 'tab' })));
  const pick = (name) => {
    current = name;
    hint.textContent = snippets[name].hint;
    pre.textContent = snippets[name].text;
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.textContent === name));
  };
  pick(current);
  openDialog('New hat key', h('div', { class: 'body' },
    h('h2', {}, `Hat key “${key.name}” for ${house.name}`),
    h('p', { class: 'note' }, 'Copy it now: the Sorting Hat keeps only its hash and does not show it again.'),
    h('div', { class: 'secret' }, h('code', { 'aria-label': 'Hat key' }, secret), copyButton(() => secret, 'Copy hat key')),
    h('div', { class: 'snippet' },
      tabs,
      h('div', { class: 'snippet-head' }, hint, copyButton(() => snippets[current].text, 'Copy settings')),
      pre),
    h('div', { class: 'buttons' }, button('Done', closeDialog, { class: 'primary' })),
  ), () => { load().catch((e) => toast(e.message)); });
}

// ---------- Usage ----------
//
// Time zone: the API's day buckets are UTC days, but this page shows days in the
// browser's time zone. So it asks for hourly buckets and adds them up into local
// days itself. The Sorting Hat keeps hours only for the last 90 whole UTC days
// (older hours become UTC days, API.md "Usage"): for a custom range reaching
// further back, those days are asked for per UTC day and shown on their UTC
// date, with a note saying so.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HOURLY_FOR_DAYS = 90;
const TOKEN_TYPES = [['inputTokens', 'Input'], ['outputTokens', 'Output'], ['cacheReadTokens', 'Cache read'], ['cacheWriteTokens', 'Cache write']];
const GROUPS = {
  house: { field: 'houseId', title: 'House', groupBy: 'house' },
  hatKey: { field: 'hatKeyId', title: 'Hat key', groupBy: 'hatKey' },
  // With the provider, so the rows line up with each account's limits.
  account: { field: 'accountId', title: 'Account', groupBy: 'account,provider' },
  model: { field: 'model', title: 'Model', groupBy: 'model' },
};
/** Series in the chart; smaller groups share the last colour as "Other". */
const MAX_SERIES = 7;
const usageView = { range: 'week', group: 'house', tokens: 'all' };
let usageSeq = 0;

const tokensOf = (t) => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
const valueOf = (t, tokens) => tokens === 'all' ? tokensOf(t) : t[tokens];
const zeroTotals = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const addTo = (target, t) => { for (const k of Object.keys(zeroTotals())) target[k] += t[k]; };
const fmt = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const localDay = (ms, add = 0) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + add); return d.getTime(); };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const utcDayKey = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
const parseDate = (value) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN; };
const dateInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The chosen range: [from, to) in ms, and its buckets' size. */
function usageRange(now = Date.now()) {
  if (usageView.range === 'day') { const to = Math.floor(now / HOUR) * HOUR + HOUR; return { from: to - 24 * HOUR, to, bucket: 'hour' }; }
  if (usageView.range === 'week') return { from: localDay(now, -6), to: localDay(now, 1), bucket: 'day' };
  if (usageView.range === 'month') return { from: localDay(now, -29), to: localDay(now, 1), bucket: 'day' };
  const from = parseDate($('#usage-from').value);
  const last = parseDate($('#usage-to').value);
  if (Number.isNaN(from) || Number.isNaN(last)) return { problem: 'Choose both dates.' };
  if (from > last) return { problem: 'The start date is after the end date.' };
  const to = localDay(last, 1);
  const cut = Math.floor(now / DAY) * DAY - HOURLY_FOR_DAYS * DAY;
  // A day or two in hours, as long as the Sorting Hat still has them.
  return { from, to, bucket: to - from <= 2 * DAY + HOUR && from >= cut ? 'hour' : 'day' };
}

/** Fetches the chosen range and breakdown; resolves to null when a newer request has been made. */
async function fetchUsage() {
  const seq = ++usageSeq;
  const view = { ...usageView };
  const range = usageRange();
  if (range.problem) return { seq, view, range };
  const groupBy = GROUPS[view.group].groupBy;
  const ask = (from, to, bucket) => api('GET', `usage?${new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), groupBy, bucket })}`);
  // Hours are kept for 90 whole UTC days; before that, UTC days (see above).
  const cut = Math.floor(Date.now() / DAY) * DAY - HOURLY_FOR_DAYS * DAY;
  const parts = [];
  let utcBefore = null;
  if (range.from < cut) {
    const utcFrom = Date.UTC(new Date(range.from).getFullYear(), new Date(range.from).getMonth(), new Date(range.from).getDate());
    const last = new Date(range.to - 1);
    const utcTo = Math.min(cut, Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    parts.push(ask(utcFrom, utcTo, 'day').then((r) => r.rows.map((row) => ({ ...row, utc: true }))));
    utcBefore = Math.min(cut, range.to);
  }
  if (range.to > Math.max(range.from, cut)) parts.push(ask(Math.max(range.from, cut), range.to, 'hour').then((r) => r.rows));
  const rows = (await Promise.all(parts)).flat();
  return { seq, view, range, rows, utcBefore };
}

function showUsage(result) {
  if (!result || result.seq !== usageSeq) return;
  state.usage = result;
  renderUsage();
}

function reloadUsage() {
  syncUsageControls();
  fetchUsage().then(showUsage).catch((e) => toast(e.message));
}

function syncUsageControls() {
  for (const tab of document.querySelectorAll('#usage-range [data-range]')) tab.setAttribute('aria-selected', String(tab.dataset.range === usageView.range));
  $('#usage-custom').hidden = usageView.range !== 'custom';
  $('#usage-group').value = usageView.group;
  $('#usage-tokens').value = usageView.tokens;
}

/** How a group's id reads: a name, or that it was deleted. */
function groupLabel(group, id) {
  if (group === 'house') {
    const house = state.houses.find((x) => x.id === id);
    return house ? { name: house.name } : { name: 'Deleted house', detail: id, deleted: true };
  }
  if (group === 'hatKey') {
    if (id === null) return { name: 'No hat key', detail: 'from before hat keys' };
    const key = state.hatKeys.find((x) => x.id === id);
    if (!key) return { name: 'Deleted hat key', deleted: true };
    return { name: key.name, detail: [state.houses.find((x) => x.id === key.houseId)?.name, key.revokedAt && 'revoked'].filter(Boolean).join(', ') || undefined };
  }
  if (group === 'account') {
    const account = accountById(id);
    return account ? { name: account.name, detail: PROVIDERS[account.providerId] } : { name: 'Deleted account', deleted: true };
  }
  return id === null ? { name: 'Unknown model', deleted: true } : { name: id };
}

/** Bucket starts in the range, labels, and where a row's start falls. */
function usageBuckets(range) {
  const starts = [];
  if (range.bucket === 'hour') for (let t = range.from; t < range.to; t += HOUR) starts.push(t);
  else for (let t = range.from; t < range.to; t = localDay(t, 1)) starts.push(t);
  const byDay = new Map(starts.map((t, i) => [dayKey(new Date(t)), i]));
  const indexOf = (row) => {
    const start = Date.parse(row.start);
    if (range.bucket === 'hour') return Math.min(starts.length - 1, Math.max(0, Math.floor((start - range.from) / HOUR)));
    const i = byDay.get(row.utc ? utcDayKey(new Date(start)) : dayKey(new Date(start)));
    if (i !== undefined) return i;
    return start < range.from ? 0 : starts.length - 1;
  };
  return { starts, indexOf };
}

function bucketLabel(start, bucket, long = false) {
  const d = new Date(start);
  if (bucket === 'hour') return long ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, long ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

function renderUsage() {
  const body = $('#usage-body');
  const result = state.usage;
  if (!result) return;
  const { view, range, rows = [] } = result;
  if (range.problem) return body.replaceChildren(h('p', { class: 'muted small', role: 'status' }, range.problem));
  const { field, title } = GROUPS[view.group];
  const groupKey = (row) => JSON.stringify(row[field] ?? null);

  // Per group: totals over the range, and per bucket.
  const { starts, indexOf } = usageBuckets(range);
  const groups = new Map();
  const totals = zeroTotals();
  for (const row of rows) {
    const key = groupKey(row);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { id: row[field] ?? null, totals: zeroTotals(), buckets: starts.map(() => zeroTotals()) });
    addTo(g.totals, row);
    addTo(g.buckets[indexOf(row)], row);
    addTo(totals, row);
  }
  // By account, every account is listed with its limits, also without usage.
  if (view.group === 'account') {
    for (const a of state.accounts) if (!groups.has(JSON.stringify(a.id))) groups.set(JSON.stringify(a.id), { id: a.id, totals: zeroTotals(), buckets: starts.map(() => zeroTotals()) });
  }
  const list = [...groups.values()].sort((a, b) => valueOf(b.totals, view.tokens) - valueOf(a.totals, view.tokens) || tokensOf(b.totals) - tokensOf(a.totals));
  list.forEach((g, i) => { g.label = groupLabel(view.group, g.id); g.series = Math.min(i, MAX_SERIES); });

  const tokensName = view.tokens === 'all' ? 'tokens' : `${TOKEN_TYPES.find(([k]) => k === view.tokens)[1].toLowerCase()} tokens`;
  const summary = h('div', { class: 'usage-summary', 'aria-label': 'Usage totals' },
    h('span', {}, h('strong', {}, fmt.format(tokensOf(totals))), ' tokens'),
    h('span', {}, h('strong', {}, fmt.format(totals.requests)), totals.requests === 1 ? ' request' : ' requests'),
    TOKEN_TYPES.map(([k, name]) => h('span', { class: 'muted' }, `${name} ${fmt.format(totals[k])}`)),
  );
  const notes = [
    result.utcBefore !== null && result.utcBefore !== undefined && h('p', { class: 'muted small' }, `Before ${new Date(result.utcBefore).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })}, the Sorting Hat keeps usage per UTC day, so those days are UTC days.`),
  ];
  body.replaceChildren(
    summary,
    totals.requests ? usageChart(list, starts, range.bucket, view.tokens, tokensName) : h('p', { class: 'empty' }, 'No usage in this range.'),
    ...notes.filter(Boolean),
    list.length ? usageTable(list, totals, view, title) : null,
  );
}

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c !== undefined && c !== null && c !== false) el.append(c);
  return el;
}

/** Stacked bars: one per bucket, a segment per group. Hovering shows the numbers. */
function usageChart(list, starts, bucket, tokens, tokensName) {
  const W = 760, H = 220, left = 48, right = 8, top = 10, bottom = 26;
  const n = starts.length;
  const stacks = starts.map((_, i) => list.reduce((sum, g) => sum + valueOf(g.buckets[i], tokens), 0));
  const max = niceMax(Math.max(0, ...stacks));
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left - right) / n;
  const barW = Math.max(1, Math.min(36, slot * 0.72));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(n / (bucket === 'hour' ? 8 : 10));
  const shown = list.filter((g) => g.series < MAX_SERIES);
  const other = list.filter((g) => g.series === MAX_SERIES);
  return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Chart of ${tokensName} per ${bucket}` },
    ticks.map((v) => [
      s('line', { class: 'grid', x1: left, x2: W - right, y1: y(v), y2: y(v) }),
      s('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, compact.format(v)),
    ]),
    starts.map((start, i) => {
      const x = left + slot * i + (slot - barW) / 2;
      let base = 0;
      const segments = [];
      const parts = [...shown.map((g) => ({ name: g.label.name, series: g.series, value: valueOf(g.buckets[i], tokens) })),
        { name: 'Other', series: MAX_SERIES, value: other.reduce((sum, g) => sum + valueOf(g.buckets[i], tokens), 0) }].filter((p) => p.value > 0);
      for (const p of parts) {
        segments.push(s('rect', { class: `seg s${p.series}`, x, width: barW, y: y(base + p.value), height: Math.max(0, y(base) - y(base + p.value)) },
          s('title', {}, `${bucketLabel(start, bucket, true)} · ${p.name}: ${fmt.format(p.value)} ${tokensName}`)));
        base += p.value;
      }
      return s('g', { class: 'bucket' },
        s('rect', { class: 'slot', x: left + slot * i, width: slot, y: top, height: H - top - bottom },
          s('title', {}, `${bucketLabel(start, bucket, true)}: ${fmt.format(stacks[i])} ${tokensName}`)),
        segments,
        i % every === 0 && s('text', { x: left + slot * i + slot / 2, y: H - 8, 'text-anchor': 'middle' }, bucketLabel(start, bucket)),
      );
    }),
  );
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function usageTable(list, totals, view, title) {
  const byAccount = view.group === 'account';
  const cells = (t) => [h('td', {}, fmt.format(t.requests)), TOKEN_TYPES.map(([k]) => h('td', {}, fmt.format(t[k]))), h('td', {}, fmt.format(tokensOf(t)))];
  return h('div', { class: 'table-scroll' }, h('table', { class: 'usage-table', 'aria-label': `Usage by ${title.toLowerCase()}` },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, title), h('th', { scope: 'col' }, 'Requests'),
      TOKEN_TYPES.map(([, name]) => h('th', { scope: 'col' }, name)), h('th', { scope: 'col' }, 'Total'),
      byAccount && h('th', { scope: 'col', class: 'limits-cell' }, 'Limits'))),
    h('tbody', {}, list.map((g) => {
      const account = byAccount ? accountById(g.id) : undefined;
      return h('tr', {},
        h('td', {}, h('div', { class: 'group-name' },
          h('span', { class: `swatch s${g.series}`, 'aria-hidden': 'true' }),
          h('span', {}, h('span', { class: g.label.deleted ? 'deleted' : '' }, g.label.name), g.label.detail ? h('span', { class: 'muted small' }, ` · ${g.label.detail}`) : null))),
        cells(g.totals),
        byAccount && h('td', { class: 'limits-cell' }, account ? limitsView(account) : h('span', { class: 'muted small' }, '—')));
    })),
    h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), cells(totals), byAccount && h('td', { class: 'limits-cell' })))));
}

// ---------- Start ----------

for (const el of document.querySelectorAll('[data-add-account]')) el.addEventListener('click', () => addAccount(el.dataset.addAccount));
$('#add-house').addEventListener('click', addHouse);
for (const tab of document.querySelectorAll('#usage-range [data-range]')) {
  tab.addEventListener('click', () => {
    usageView.range = tab.dataset.range;
    if (usageView.range === 'custom' && !$('#usage-from').value) {
      $('#usage-from').value = dateInput(localDay(Date.now(), -29));
      $('#usage-to').value = dateInput(Date.now());
    }
    reloadUsage();
  });
}
for (const id of ['#usage-from', '#usage-to']) $(id).addEventListener('change', reloadUsage);
$('#usage-group').addEventListener('change', (event) => { usageView.group = event.currentTarget.value; reloadUsage(); });
// The token type only changes the chart: no new request.
$('#usage-tokens').addEventListener('change', (event) => {
  usageView.tokens = event.currentTarget.value;
  syncUsageControls();
  if (state.usage) { state.usage.view.tokens = usageView.tokens; renderUsage(); }
});
syncUsageControls();
$('#refresh-limits').addEventListener('click', async (event) => {
  const b = event.currentTarget;
  b.disabled = true;
  await act(() => api('POST', 'limits/refresh', { force: true }));
  b.disabled = false;
});

fetch('/dashboard/session', { credentials: 'same-origin' }).then((r) => r.json()).then((session) => {
  $('#session').textContent = session.mode === 'access' ? `Signed in through Cloudflare Access${session.email ? ` as ${session.email}` : ''}` : 'On this machine';
}).catch(() => {});

load().catch((e) => toast(e.message));
// Keep the account in use, limits and usage current while the page is open, but never under an open dialog.
setInterval(() => { if (!dialog.open && document.visibilityState === 'visible') load().catch(() => {}); }, 30_000);
