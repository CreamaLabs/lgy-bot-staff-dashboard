const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let applications = [];

function toast(message, error = false) {
  const element = $('#toast'); element.textContent = message; element.className = `toast show${error ? ' error' : ''}`;
  setTimeout(() => { element.className = 'toast'; }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatAge(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hrs ago`; return `${Math.floor(seconds / 86400)} days ago`;
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }

function renderApplications() {
  const body = $('#applications-body');
  if (!applications.length) { body.innerHTML = '<tr><td colspan="5" class="empty-state">No synchronized applications yet. Restart LGY Bot after installing its dashboard update.</td></tr>'; return; }
  body.innerHTML = applications.slice(0, 25).map((app) => `<tr><td><em>#${String(app.id).padStart(4, '0')}</em><strong>${escapeHtml(`${app.firstName || ''} ${app.lastName || ''}`.trim())}</strong></td><td>${formatAge(app.submittedAt)}</td><td><span class="count">${Array.isArray(app.vouches) ? app.vouches.length : 0}</span></td><td><span class="pill ${app.status === 'denied' ? 'denied-pill' : app.status === 'approved' ? 'approved-pill' : ''}">${escapeHtml(app.status || 'pending')}</span></td><td>${app.status === 'pending' ? `<button class="review" data-review="${app.id}">Review</button>` : ''}</td></tr>`).join('');
  $$('[data-review]').forEach((button) => button.addEventListener('click', () => openReview(button.dataset.review)));
}

function updateStats() {
  const weekAgo = Date.now() - 7 * 86400000;
  $('#pending-count').textContent = applications.filter((app) => app.status === 'pending').length;
  $('#approved-count').textContent = applications.filter((app) => app.status === 'approved' && Number(app.reviewedAt) >= weekAgo).length;
  $('#denied-count').textContent = applications.filter((app) => app.status === 'denied' && Number(app.reviewedAt) >= weekAgo).length;
}

async function loadApplications(showToast = false) {
  try {
    const data = await api('/api/applications'); applications = data.applications || []; renderApplications(); updateStats();
    $('#sync-state').textContent = data.synced ? 'Live' : 'Waiting'; $('#sync-time').textContent = data.synced ? 'Secure bridge connected' : 'Bot restart required';
    $('#connection-label').textContent = data.synced ? 'LGY Bot synchronized' : 'Waiting for LGY Bot'; $('#connection-note').textContent = data.synced ? `${applications.length} records available` : 'Install the Bot-Hosting update';
    if (showToast) toast('Application list refreshed.');
  } catch (error) { toast(error.message, true); }
}

async function queueCommand(type, payload = {}) {
  const labels = { post_apply_panel: 'post a new whitelist panel', post_ticket_panel: 'post a new ticket panel', post_streamer_registration_panel: 'post the streamer registration panel', post_streamer_stats_panel: 'post the streamer statistics panel', post_streamer_fallback_panel: 'post the streamer fallback panel' };
  if (labels[type] && !confirm(`Ask LGY Bot to ${labels[type]}?`)) return;
  try { await api('/api/commands', { method: 'POST', body: JSON.stringify({ type, payload }) }); toast('Command queued. LGY Bot will process it shortly.'); $$('dialog[open]').forEach((dialog) => dialog.close()); }
  catch (error) { toast(error.message, true); }
}

function openReview(id) {
  const app = applications.find((item) => String(item.id) === String(id)); if (!app) return;
  $('#review-id').value = app.id; $('#review-title').textContent = `${app.firstName} ${app.lastName}`; $('#review-details').textContent = `Application #${app.id} • ${app.discordUsername || 'Discord user'} • ${app.steamProfileUrl || 'No Steam URL'}`; $('#denial-reason').value = ''; $('#review-modal').showModal();
}

async function init() {
  try {
    const session = await api('/api/session'); const name = session.user.displayName || session.user.username;
    $('#staff-name').textContent = name; $('#staff-initials').textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); $('#greeting').textContent = `Welcome, ${name}.`;
    $('#login-screen').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); await loadApplications();
  } catch { $('#login-screen').classList.remove('hidden'); }
}

$$('[data-command]').forEach((button) => button.addEventListener('click', () => queueCommand(button.dataset.command)));
$$('[data-modal]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.modal}`).showModal()));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
$('#refresh-apps').addEventListener('click', () => loadApplications(true));
$('#approve-button').addEventListener('click', () => queueCommand('approve_application', { applicationId: $('#review-id').value }));
$('#deny-button').addEventListener('click', () => { const reason = $('#denial-reason').value.trim(); if (!reason) return toast('Enter a denial reason first.', true); queueCommand('deny_application', { applicationId: $('#review-id').value, reason }); });
$('#announcement-send').addEventListener('click', () => { const channelId = $('#announcement-channel').value.trim(); const title = $('#announcement-title').value.trim(); if (!/^\d{15,22}$/.test(channelId) || !title) return toast('Enter a valid Discord channel ID and title.', true); queueCommand('announcement', { channelId, title, description: $('#announcement-description').value.trim(), mediaUrl: $('#announcement-media').value.trim(), sticky: $('#announcement-sticky').checked }); });
init();
