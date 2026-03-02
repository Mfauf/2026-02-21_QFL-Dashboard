/**
 * invoice-pdf.js — Generates a print-ready PDF preview for a single invoice.
 *
 * Opens a new popup window that contains a self-contained, styled HTML document
 * and immediately triggers window.print(). No external libraries required.
 *
 * Usage:
 *   import { printInvoice } from '../invoice-pdf.js';
 *   printInvoice(invoice, clientName, projectName, settings);
 */

import { formatDate, formatQAR } from './utils.js';
import { getSettings }           from './settings-store.js';

/* ── Status label map ───────────────────────────────────────────────────── */
const STATUS_LABEL = {
  draft:     'Draft',
  sent:      'Sent',
  paid:      'Paid',
  overdue:   'Overdue',
  cancelled: 'Cancelled',
};

const STATUS_COLOR = {
  draft:     '#94a3b8',
  sent:      '#60a5fa',
  paid:      '#34d399',
  overdue:   '#f87171',
  cancelled: '#6b7280',
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Main export ─────────────────────────────────────────────────────────── */
/**
 * @param {object} invoice
 * @param {string} clientName
 * @param {string} [projectName]
 */
export function printInvoice(invoice, clientName, projectName) {
  const s       = getSettings();
  const profile = s.profile;
  const invSet  = s.invoice;

  const statusLabel = STATUS_LABEL[invoice.status] ?? invoice.status;
  const statusColor = STATUS_COLOR[invoice.status] ?? '#94a3b8';
  const isPaid      = invoice.status === 'paid';

  /* ── Avatar: photo or initials block ──────────────────────────────────── */
  const avatarHTML = profile.avatar
    ? `<img src="${profile.avatar}" alt="Logo"
            style="width:56px;height:56px;border-radius:50%;object-fit:cover;display:block;">`
    : (() => {
        const name   = profile.name || profile.company || 'QFL';
        const ini    = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const colors = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981'];
        const bg     = colors[name.charCodeAt(0) % colors.length];
        return `<div style="width:56px;height:56px;border-radius:50%;background:${bg};
                            display:flex;align-items:center;justify-content:center;
                            color:#fff;font-weight:700;font-size:1.25rem;flex-shrink:0;">
                  ${ini}
                </div>`;
      })();

  /* ── Notes / payment terms ─────────────────────────────────────────────── */
  const notesBlock = invoice.notes
    ? `<div style="margin-top:2rem;padding:1.25rem 1.5rem;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
         <p style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:0 0 .5rem;">Notes</p>
         <p style="font-size:.875rem;color:#475569;line-height:1.6;margin:0;white-space:pre-wrap;">${esc(invoice.notes)}</p>
       </div>`
    : '';

  const termsBlock = invSet.paymentTerms
    ? `<div style="margin-top:1rem;padding:1.25rem 1.5rem;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
         <p style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:0 0 .5rem;">Payment Terms</p>
         <p style="font-size:.875rem;color:#475569;line-height:1.6;margin:0;">${esc(invSet.paymentTerms)}</p>
       </div>`
    : '';

  /* ── Project row ────────────────────────────────────────────────────────── */
  const projectRow = projectName && projectName !== '—'
    ? `<tr>
         <td style="padding:.6rem 0;color:#94a3b8;font-size:.8125rem;white-space:nowrap;width:9rem;">Project</td>
         <td style="padding:.6rem 0;color:#1e293b;font-size:.8125rem;font-weight:500;text-align:right;">${esc(projectName)}</td>
       </tr>`
    : '';

  /* ── PAID watermark ─────────────────────────────────────────────────────── */
  const watermark = isPaid
    ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);
                   font-size:8rem;font-weight:900;color:rgba(52,211,153,.12);
                   pointer-events:none;user-select:none;z-index:0;letter-spacing:.1em;">
         PAID
       </div>`
    : '';

  /* ── Full HTML document ─────────────────────────────────────────────────── */
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invoice ${esc(invoice.number ?? '')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #fff; color: #1e293b; font-family: 'Inter', system-ui, sans-serif; }
    body { padding: 0; }
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 3rem 3.5rem;
      position: relative;
    }
    @media print {
      html, body { background: #fff !important; }
      .no-print { display: none !important; }
      .page { padding: 2rem 2.5rem; }
    }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
    table { border-collapse: collapse; width: 100%; }
  </style>
</head>
<body>

  <!-- Print button (hidden when printing) -->
  <div class="no-print" style="background:#f1f5f9;padding:.75rem 1rem;display:flex;
                                justify-content:flex-end;gap:.75rem;border-bottom:1px solid #e2e8f0;">
    <button onclick="window.print()"
            style="background:#6366f1;color:#fff;border:none;padding:.5rem 1.25rem;
                   border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;
                   font-family:inherit;display:flex;align-items:center;gap:.5rem;">
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2
             m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm1-4h.01"/>
      </svg>
      Print / Save PDF
    </button>
    <button onclick="window.close()"
            style="background:#e2e8f0;color:#475569;border:none;padding:.5rem 1.25rem;
                   border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;font-family:inherit;">
      Close
    </button>
  </div>

  <div class="page">
    ${watermark}

    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">

      <!-- Sender info -->
      <div style="display:flex;align-items:center;gap:1rem;">
        ${avatarHTML}
        <div>
          <p style="font-size:1.125rem;font-weight:700;color:#0f172a;line-height:1.2;">
            ${esc(profile.name || 'Your Name')}
          </p>
          ${profile.company ? `<p style="font-size:.875rem;color:#64748b;margin-top:.2rem;">${esc(profile.company)}</p>` : ''}
          ${profile.tagline ? `<p style="font-size:.75rem;color:#94a3b8;margin-top:.15rem;font-style:italic;">${esc(profile.tagline)}</p>` : ''}
        </div>
      </div>

      <!-- Invoice label + status -->
      <div style="text-align:right;">
        <p style="font-size:1.75rem;font-weight:900;color:#0f172a;letter-spacing:-.03em;line-height:1;">
          INVOICE
        </p>
        <p style="font-size:1rem;font-weight:600;color:#6366f1;margin-top:.3rem;font-family:monospace;">
          ${esc(invoice.number ?? '—')}
        </p>
        <span style="display:inline-block;margin-top:.5rem;padding:.25rem .75rem;
                     border-radius:999px;font-size:.75rem;font-weight:600;
                     background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}55;">
          ${esc(statusLabel)}
        </span>
      </div>
    </div>

    <hr class="divider">

    <!-- ── Bill To + Invoice details ─────────────────────────────────── -->
    <div style="display:flex;justify-content:space-between;gap:2rem;flex-wrap:wrap;">

      <!-- Bill To -->
      <div style="flex:1;min-width:180px;">
        <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
                  color:#94a3b8;margin-bottom:.75rem;">Bill To</p>
        <p style="font-size:1rem;font-weight:600;color:#0f172a;">${esc(clientName)}</p>
      </div>

      <!-- Invoice meta -->
      <div style="min-width:200px;">
        <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
                  color:#94a3b8;margin-bottom:.75rem;">Details</p>
        <table>
          <tbody>
            <tr>
              <td style="padding:.6rem 0;color:#94a3b8;font-size:.8125rem;white-space:nowrap;width:9rem;">Issue Date</td>
              <td style="padding:.6rem 0;color:#1e293b;font-size:.8125rem;font-weight:500;text-align:right;">
                ${esc(formatDate(invoice.issuedAt))}
              </td>
            </tr>
            <tr>
              <td style="padding:.6rem 0;color:#94a3b8;font-size:.8125rem;white-space:nowrap;">Due Date</td>
              <td style="padding:.6rem 0;font-size:.8125rem;font-weight:600;text-align:right;
                         color:${invoice.dueAt && invoice.status !== 'paid' && new Date(invoice.dueAt) < new Date() ? '#f87171' : '#1e293b'};">
                ${esc(formatDate(invoice.dueAt))}
              </td>
            </tr>
            ${projectRow}
          </tbody>
        </table>
      </div>
    </div>

    <hr class="divider">

    <!-- ── Line items table ───────────────────────────────────────────── -->
    <table style="width:100%;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:.875rem 1.25rem;text-align:left;font-size:.75rem;font-weight:700;
                     text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;border-bottom:1px solid #e2e8f0;">
            Description
          </th>
          <th style="padding:.875rem 1.25rem;text-align:right;font-size:.75rem;font-weight:700;
                     text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;border-bottom:1px solid #e2e8f0;">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:1.1rem 1.25rem;font-size:.9375rem;color:#1e293b;border-bottom:1px solid #f1f5f9;">
            ${invoice.notes
              ? `<span style="font-weight:500;">${esc(invoice.notes.split('\n')[0])}</span>`
              : `<span style="color:#94a3b8;font-style:italic;">Professional services</span>`}
          </td>
          <td style="padding:1.1rem 1.25rem;text-align:right;font-size:.9375rem;
                     font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;
                     font-variant-numeric:tabular-nums;white-space:nowrap;">
            ${invoice.amount ? esc(formatQAR(Number(invoice.amount))) : '—'}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- ── Total ──────────────────────────────────────────────────────── -->
    <div style="display:flex;justify-content:flex-end;margin-top:1.5rem;">
      <div style="min-width:260px;">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    background:#6366f1;border-radius:10px;padding:1rem 1.5rem;">
          <span style="font-size:.875rem;font-weight:600;color:#c7d2fe;
                       text-transform:uppercase;letter-spacing:.06em;">Total Due</span>
          <span style="font-size:1.375rem;font-weight:800;color:#fff;
                       font-variant-numeric:tabular-nums;white-space:nowrap;">
            ${invoice.amount ? esc(formatQAR(Number(invoice.amount))) : '—'}
          </span>
        </div>
      </div>
    </div>

    <!-- ── Notes + Terms ────────────────────────────────────────────────── -->
    ${notesBlock}
    ${termsBlock}

    <!-- ── Footer ─────────────────────────────────────────────────────── -->
    <div style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid #e2e8f0;
                display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;">
      <div style="font-size:.75rem;color:#94a3b8;">
        ${profile.email ? `<span>${esc(profile.email)}</span>` : ''}
        ${profile.email && profile.phone ? '<span style="margin:0 .5rem;">·</span>' : ''}
        ${profile.phone ? `<span>${esc(profile.phone)}</span>` : ''}
      </div>
      <div style="font-size:.75rem;color:#cbd5e1;font-style:italic;">
        Thank you for your business
      </div>
    </div>
  </div>

</body>
</html>`;

  /* ── Open popup + print ─────────────────────────────────────────────────── */
  const win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (!win) {
    // Popup blocked — fallback toast is handled at call site
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
