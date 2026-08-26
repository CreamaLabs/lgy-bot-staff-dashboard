const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let applications = [];
let tickets = [];

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

function renderWhitelistArchive() {
  const body = $('#whitelist-archive-body');
  const query = ($('#whitelist-search')?.value || '').trim().toLowerCase();
  const visible = applications.filter((app) => [app.id, app.firstName, app.lastName, app.discordUsername, app.applicantId, app.steamProfileUrl, app.steamId64, app.status].join(' ').toLowerCase().includes(query));
  if (!visible.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${query ? 'No whitelist request matches your search.' : 'No submitted whitelist requests yet.'}</td></tr>`; return; }
  body.innerHTML = visible.map((app) => `<tr><td><em>#${String(app.id).padStart(4, '0')}</em><strong>${escapeHtml(`${app.firstName || ''} ${app.lastName || ''}`.trim())}</strong></td><td>${formatAge(app.submittedAt)}</td><td>${escapeHtml(app.discordUsername || '—')}</td><td><code>${escapeHtml(app.applicantId || '—')}</code></td><td>${app.steamProfileUrl ? `<a href="${escapeHtml(app.steamProfileUrl)}" target="_blank" rel="noopener">${escapeHtml(app.steamProfileUrl)}</a>` : '—'}</td><td><span class="count">${Array.isArray(app.vouches) ? app.vouches.length : 0}</span></td><td><span class="pill ${app.status === 'denied' ? 'denied-pill' : app.status === 'approved' ? 'approved-pill' : ''}">${escapeHtml(app.status || 'pending')}</span></td></tr>`).join('');
}

function ticketStatusLabel(status) { return status === 'in_progress' ? 'In progress' : status === 'closed' ? 'Closed' : 'Open'; }

function renderTicketConversation(ticket) {
  const panel = $('#ticket-conversation');
  const messages = Array.isArray(ticket.conversation) ? ticket.conversation : [];
  panel.innerHTML = `<header><p class="eyebrow">${escapeHtml(ticket.categoryLabel || ticket.categoryId)}</p><h3>${escapeHtml(ticket.channelName)}</h3><span class="pill ${ticket.dashboardStatus === 'closed' ? 'denied-pill' : ticket.dashboardStatus === 'in_progress' ? 'approved-pill' : ''}">${ticketStatusLabel(ticket.dashboardStatus)}</span></header><div class="conversation-scroll">${messages.length ? messages.map((message) => `<div class="ticket-message"><strong>${escapeHtml(message.authorTag || message.authorId)}</strong><time>${new Date(message.createdAt).toLocaleString()}</time>${message.content ? `<p>${escapeHtml(message.content)}</p>` : ''}${(message.attachments || []).map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Attachment: ${escapeHtml(item.name)}</a>`).join('')}</div>`).join('') : '<p class="empty-state">No captured conversation is available for this ticket.</p>'}</div>`;
}

function renderTickets() {
  const list = $('#ticket-list');
  if (!tickets.length) { list.innerHTML = '<p class="empty-state">No synchronized tickets.</p>'; $('#ticket-conversation').innerHTML = '<p class="empty-state">No ticket conversation to display.</p>'; return; }
  list.innerHTML = tickets.map((ticket, index) => `<button data-ticket-index="${index}"><strong>${escapeHtml(ticket.channelName)}</strong><span>${escapeHtml(ticket.categoryLabel || ticket.categoryId)}</span><small>${ticketStatusLabel(ticket.dashboardStatus)}</small></button>`).join('');
  $$('[data-ticket-index]').forEach((button) => button.addEventListener('click', () => renderTicketConversation(tickets[Number(button.dataset.ticketIndex)])));
  renderTicketConversation(tickets[0]);
}

async function loadTickets(showToast = false) {
  try { const data = await api('/api/tickets'); tickets = data.tickets || []; renderTickets(); if (showToast) toast('Ticket conversations refreshed.'); }
  catch (error) { toast(error.message, true); }
}

function updateStats() {
  const weekAgo = Date.now() - 7 * 86400000;
  $('#pending-count').textContent = applications.filter((app) => app.status === 'pending').length;
  $('#approved-count').textContent = applications.filter((app) => app.status === 'approved' && Number(app.reviewedAt) >= weekAgo).length;
  $('#denied-count').textContent = applications.filter((app) => app.status === 'denied' && Number(app.reviewedAt) >= weekAgo).length;
}

async function loadApplications(showToast = false) {
  try {
    const data = await api('/api/applications'); applications = data.applications || []; renderApplications(); renderWhitelistArchive(); updateStats();
    $('#sync-state').textContent = data.synced ? 'Live' : 'Waiting'; $('#sync-time').textContent = data.synced ? 'Secure bridge connected' : 'Bot restart required';
    $('#connection-label').textContent = data.synced ? 'LGY Bot synchronized' : 'Waiting for LGY Bot'; $('#connection-note').textContent = data.synced ? `${applications.length} records available` : 'Install the Bot-Hosting update';
    if (showToast) toast('Application list refreshed.');
  } catch (error) { toast(error.message, true); }
}

async function queueCommand(type, payload = {}) {
  const labels = { post_apply_panel: 'post a new whitelist panel', post_ticket_panel: 'post a new ticket panel' };
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
    $$('[data-owner-only]').forEach((element) => element.classList.toggle('hidden', !session.isOwner));
    $('#login-screen').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); await Promise.all([loadApplications(), loadTickets()]);
  } catch { $('#login-screen').classList.remove('hidden'); }
}

$$('[data-command]').forEach((button) => button.addEventListener('click', () => queueCommand(button.dataset.command)));
$$('[data-modal]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.modal}`).showModal()));
$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  const view = button.dataset.view;
  $$('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active');
  $$('.overview-view').forEach((item) => item.classList.toggle('hidden', view !== 'overview'));
  $('#whitelist-view').classList.toggle('hidden', view !== 'whitelist');
  $('#tickets-view').classList.toggle('hidden', view !== 'tickets');
  if (view === 'tickets') loadTickets();
}));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
$('#refresh-apps').addEventListener('click', () => loadApplications(true));
$('#refresh-whitelist').addEventListener('click', () => loadApplications(true));
$('#whitelist-search').addEventListener('input', renderWhitelistArchive);
$('#refresh-tickets').addEventListener('click', () => loadTickets(true));
$('#approve-button').addEventListener('click', () => queueCommand('approve_application', { applicationId: $('#review-id').value }));
$('#deny-button').addEventListener('click', () => { const reason = $('#denial-reason').value.trim(); if (!reason) return toast('Enter a denial reason first.', true); queueCommand('deny_application', { applicationId: $('#review-id').value, reason }); });
$('#announcement-send').addEventListener('click', () => { const channelId = $('#announcement-channel').value.trim(); const title = $('#announcement-title').value.trim(); if (!/^\d{15,22}$/.test(channelId) || !title) return toast('Enter a valid Discord channel ID and title.', true); queueCommand('announcement', { channelId, title, description: $('#announcement-description').value.trim(), mediaUrl: $('#announcement-media').value.trim(), sticky: $('#announcement-sticky').checked }); });
$('#reset-testing-data').addEventListener('click', () => {
  const confirmation = $('#reset-confirmation').value;
  if (confirmation !== 'RESET TEST DATA') return toast('Type RESET TEST DATA exactly before continuing.', true);
  if (!confirm('Final warning: permanently delete ALL whitelist and ticket testing data?')) return;
  queueCommand('reset_testing_data', { confirmation });
});
init();
