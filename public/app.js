const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let applications = [];
let tickets = [];
let presenceTimer;
let ticketCategoryFilter = 'all';
let generatedReport = null;

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
  const prioritized = [...applications].sort((a, b) => {
    const aPending = (a.status || 'pending') === 'pending' ? 0 : 1;
    const bPending = (b.status || 'pending') === 'pending' ? 0 : 1;
    return aPending - bPending || Number(b.submittedAt || 0) - Number(a.submittedAt || 0);
  });
  body.innerHTML = prioritized.slice(0, 25).map((app) => `<tr><td data-label="Applicant"><em>#${String(app.id).padStart(4, '0')}</em><strong>${escapeHtml(`${app.firstName || ''} ${app.lastName || ''}`.trim())}</strong></td><td data-label="Submitted">${formatAge(app.submittedAt)}</td><td data-label="Vouches"><span class="count">${Array.isArray(app.vouches) ? app.vouches.length : 0}</span></td><td data-label="Status"><span class="pill ${app.status === 'denied' ? 'denied-pill' : app.status === 'approved' ? 'approved-pill' : ''}">${escapeHtml(app.status || 'pending')}</span></td><td class="row-action">${app.status === 'pending' ? `<button class="review" data-review="${app.id}">Review</button>` : ''}</td></tr>`).join('');
  $$('[data-review]').forEach((button) => button.addEventListener('click', () => openReview(button.dataset.review)));
}

function renderWhitelistArchive() {
  const body = $('#whitelist-archive-body');
  const query = ($('#whitelist-search')?.value || '').trim().toLowerCase();
  const visible = applications.filter((app) => [app.id, app.firstName, app.lastName, app.discordUsername, app.applicantId, app.steamProfileUrl, app.steamId64, app.status].join(' ').toLowerCase().includes(query));
  if (!visible.length) { body.innerHTML = `<tr><td colspan="7" class="empty-state">${query ? 'No whitelist request matches your search.' : 'No submitted whitelist requests yet.'}</td></tr>`; return; }
  body.innerHTML = visible.map((app) => `<tr><td data-label="Applicant"><em>#${String(app.id).padStart(4, '0')}</em><strong>${escapeHtml(`${app.firstName || ''} ${app.lastName || ''}`.trim())}</strong></td><td data-label="Submitted">${formatAge(app.submittedAt)}</td><td data-label="Discord">${escapeHtml(app.discordUsername || '—')}</td><td data-label="Discord ID"><code>${escapeHtml(app.applicantId || '—')}</code></td><td data-label="Steam URL">${app.steamProfileUrl ? `<a href="${escapeHtml(app.steamProfileUrl)}" target="_blank" rel="noopener">${escapeHtml(app.steamProfileUrl)}</a>` : '—'}</td><td data-label="Vouches"><span class="count">${Array.isArray(app.vouches) ? app.vouches.length : 0}</span></td><td data-label="Status"><span class="pill ${app.status === 'denied' ? 'denied-pill' : app.status === 'approved' ? 'approved-pill' : ''}">${escapeHtml(app.status || 'pending')}</span></td></tr>`).join('');
}

function ticketStatusLabel(status) { return status === 'in_progress' ? 'In progress' : status === 'closed' ? 'Closed' : 'Open'; }

function renderTicketConversation(ticket) {
  const panel = $('#ticket-conversation');
  const messages = Array.isArray(ticket.conversation) ? ticket.conversation : [];
  panel.innerHTML = `<header><p class="eyebrow">${escapeHtml(ticket.categoryLabel || ticket.categoryId)}</p><h3>${escapeHtml(ticket.channelName)}</h3><span class="pill ${ticket.dashboardStatus === 'closed' ? 'denied-pill' : ticket.dashboardStatus === 'in_progress' ? 'approved-pill' : ''}">${ticketStatusLabel(ticket.dashboardStatus)}</span></header><div class="conversation-scroll">${messages.length ? messages.map((message) => `<div class="ticket-message"><strong>${escapeHtml(message.authorTag || message.authorId)}</strong><time>${new Date(message.createdAt).toLocaleString()}</time>${message.content ? `<p>${escapeHtml(message.content)}</p>` : ''}${(message.attachments || []).map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Attachment: ${escapeHtml(item.name)}</a>`).join('')}</div>`).join('') : '<p class="empty-state">No captured conversation is available for this ticket.</p>'}</div>`;
}

function renderTickets() {
  const list = $('#ticket-list');
  const visible = ticketCategoryFilter === 'all' ? tickets : tickets.filter((ticket) => ticket.categoryId === ticketCategoryFilter);
  if (!visible.length) { list.innerHTML = '<p class="empty-state">No tickets in this category.</p>'; $('#ticket-conversation').innerHTML = '<p class="empty-state">No ticket conversation to display.</p>'; return; }
  list.innerHTML = visible.map((ticket, index) => `<button data-ticket-index="${index}"><strong>${escapeHtml(ticket.channelName)}</strong><span>${escapeHtml(ticket.categoryLabel || ticket.categoryId)}</span><small>${ticketStatusLabel(ticket.dashboardStatus)}</small></button>`).join('');
  $$('[data-ticket-index]').forEach((button) => button.addEventListener('click', () => renderTicketConversation(visible[Number(button.dataset.ticketIndex)])));
  renderTicketConversation(visible[0]);
}

function renderTicketCategoryCounts() {
  $$('[data-ticket-category]').forEach((button) => {
    const category = button.dataset.ticketCategory;
    const count = category === 'all' ? tickets.length : tickets.filter((ticket) => ticket.categoryId === category).length;
    let badge = button.querySelector('.ticket-category-count');
    if (!badge) { badge = document.createElement('b'); badge.className = 'ticket-category-count'; button.appendChild(badge); }
    badge.textContent = count;
  });
}

function reportPeriod() {
  const range = $('#report-range').value; const now = new Date();
  if (range === 'all') return { start: 0, end: Infinity, label: 'All time' };
  if (range === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: Infinity, label: 'Current month' };
  if (range === 'custom') {
    const startValue = $('#report-start').value; const endValue = $('#report-end').value;
    if (!startValue || !endValue) throw new Error('Select both a start and end date.');
    const start = new Date(`${startValue}T00:00:00`).getTime(); const end = new Date(`${endValue}T23:59:59.999`).getTime();
    if (start > end) throw new Error('Start date must be before the end date.');
    return { start, end, label: `${startValue} to ${endValue}` };
  }
  const days = Number(range); return { start: Date.now() - days * 86400000, end: Infinity, label: `Last ${days} days` };
}

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

function generateReport() {
  try {
    const type = $('#report-type').value; const period = reportPeriod(); const category = $('#report-category').value;
    let headers; let rows; let title;
    if (type === 'whitelist') {
      title = 'Whitelist Requests Report'; headers = ['Application', 'Applicant', 'Submitted', 'Discord Username', 'Discord ID', 'Steam URL', 'Vouches', 'Status'];
      rows = applications.filter((app) => Number(app.submittedAt) >= period.start && Number(app.submittedAt) <= period.end).map((app) => [`#${String(app.id).padStart(4, '0')}`, `${app.firstName || ''} ${app.lastName || ''}`.trim(), new Date(app.submittedAt).toLocaleString(), app.discordUsername || '', app.applicantId || '', app.steamProfileUrl || '', Array.isArray(app.vouches) ? app.vouches.length : 0, app.status || 'pending']);
    } else {
      title = 'Support Tickets Report'; headers = ['Ticket', 'Category', 'Discord ID', 'Opened', 'Closed', 'Status', 'Messages'];
      rows = tickets.filter((ticket) => (category === 'all' || ticket.categoryId === category) && Number(ticket.createdAt) >= period.start && Number(ticket.createdAt) <= period.end).map((ticket) => [ticket.channelName, ticket.categoryLabel || ticket.categoryId, ticket.userId || '', new Date(ticket.createdAt).toLocaleString(), ticket.closedAt ? new Date(ticket.closedAt).toLocaleString() : '', ticketStatusLabel(ticket.dashboardStatus), Array.isArray(ticket.conversation) ? ticket.conversation.length : 0]);
    }
    generatedReport = { title, period: period.label, category: type === 'tickets' ? $('#report-category').selectedOptions[0].textContent : 'All whitelist requests', headers, rows, generatedAt: new Date().toLocaleString() };
    $('#report-result').innerHTML = `<div class="report-summary"><div><p class="eyebrow">${escapeHtml(generatedReport.period)}</p><h3>${escapeHtml(title)}</h3><span>${escapeHtml(generatedReport.category)} • ${rows.length} record(s)</span></div></div><div class="table-wrap"><table><thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-state">No records match this report.</td></tr>`}</tbody></table></div>`;
    $('#report-actions').classList.remove('hidden');
  } catch (error) { toast(error.message, true); }
}

function downloadReportCsv() {
  if (!generatedReport) return;
  const csv = [generatedReport.headers, ...generatedReport.rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${generatedReport.title.toLowerCase().replaceAll(' ', '-')}-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function printReport() {
  if (!generatedReport) return;
  const popup = window.open('', '_blank'); if (!popup) return toast('Allow pop-ups to print the report.', true);
  popup.document.write(`<!doctype html><title>${escapeHtml(generatedReport.title)}</title><style>body{font:12px Arial;padding:28px;color:#111}h1{margin-bottom:4px}p{color:#555}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#f3f3f3}@media print{body{padding:0}}</style><h1>${escapeHtml(generatedReport.title)}</h1><p>${escapeHtml(generatedReport.period)} • ${escapeHtml(generatedReport.category)} • Generated ${escapeHtml(generatedReport.generatedAt)}</p><table><thead><tr>${generatedReport.headers.map((item) => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${generatedReport.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); popup.document.close(); popup.focus(); popup.print();
}

async function loadTickets(showToast = false) {
  try { const data = await api('/api/tickets'); tickets = data.tickets || []; renderTickets(); renderTicketCategoryCounts(); updateStats(); if (showToast) toast('Ticket conversations refreshed.'); }
  catch (error) { toast(error.message, true); }
}

async function updatePresence() {
  try {
    await api('/api/presence', { method: 'POST', body: '{}' });
    const data = await api('/api/presence');
    $('#connected-admin-count').textContent = data.count || 0;
    $('#connected-admin-list').innerHTML = (data.staff || []).length
      ? data.staff.map((staff) => `<div class="${staff.online ? 'online' : 'offline'}"><i></i><span><strong>${escapeHtml(staff.displayName || staff.username)}</strong><small>${staff.online ? 'Connected now' : `Last active ${formatAge(staff.lastSeen)}`}</small></span></div>`).join('')
      : '<span>No dashboard connection history yet.</span>';
  } catch (error) { console.warn('Presence update failed:', error.message); }
}

function updateStats() {
  const weekAgo = Date.now() - 7 * 86400000;
  $('#pending-count').textContent = applications.filter((app) => app.status === 'pending').length;
  $('#approved-count').textContent = applications.filter((app) => app.status === 'approved' && Number(app.reviewedAt) >= weekAgo).length;
  $('#denied-count').textContent = applications.filter((app) => app.status === 'denied' && Number(app.reviewedAt) >= weekAgo).length;
  $('#approved-total').textContent = applications.filter((app) => app.status === 'approved').length;
  $('#denied-total').textContent = applications.filter((app) => app.status === 'denied').length;
  $('#open-ticket-count').textContent = tickets.filter((ticket) => ticket.dashboardStatus !== 'closed').length;
  $('#closed-ticket-count').textContent = tickets.filter((ticket) => ticket.dashboardStatus === 'closed').length;
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
    $('#login-screen').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); $('#mobile-nav').classList.remove('hidden'); await Promise.all([loadApplications(), loadTickets(), updatePresence()]);
    clearInterval(presenceTimer); presenceTimer = setInterval(updatePresence, 30000);
  } catch { $('#login-screen').classList.remove('hidden'); }
}

$$('[data-command]').forEach((button) => button.addEventListener('click', () => queueCommand(button.dataset.command)));
$$('[data-modal]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.modal}`).showModal()));
function showView(view) {
  $('#dashboard').classList.remove('mobile-controls-mode');
  $$('[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $$('.overview-view').forEach((item) => item.classList.toggle('hidden', view !== 'overview'));
  $('#whitelist-view').classList.toggle('hidden', view !== 'whitelist');
  $('#tickets-view').classList.toggle('hidden', view !== 'tickets');
  $('#reports-view').classList.toggle('hidden', view !== 'reports');
  if (view === 'tickets') loadTickets();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-mobile-action="quick-controls"]').forEach((button) => button.addEventListener('click', () => {
  showView('overview');
  $('#dashboard').classList.add('mobile-controls-mode');
  $$('#mobile-nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  requestAnimationFrame(() => $('.quick-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}));
$$('[data-ticket-category]').forEach((button) => button.addEventListener('click', () => { ticketCategoryFilter = button.dataset.ticketCategory; $$('[data-ticket-category]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); $('[data-view="tickets"]').click(); renderTickets(); }));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
$('#refresh-apps').addEventListener('click', () => loadApplications(true));
$('#refresh-whitelist').addEventListener('click', () => loadApplications(true));
$('#whitelist-search').addEventListener('input', renderWhitelistArchive);
$('#refresh-tickets').addEventListener('click', () => loadTickets(true));
$('#report-type').addEventListener('change', () => $('#report-category-label').classList.toggle('hidden', $('#report-type').value !== 'tickets'));
$('#report-range').addEventListener('change', () => $('#custom-date-fields').classList.toggle('hidden', $('#report-range').value !== 'custom'));
$('#generate-report').addEventListener('click', generateReport);
$('#download-report-csv').addEventListener('click', downloadReportCsv);
$('#print-report').addEventListener('click', printReport);
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
