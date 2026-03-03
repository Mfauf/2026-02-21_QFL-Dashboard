/**
 * blueprint-pdf.js — Generates a print-ready Project Blueprint / Proposal PDF.
 *
 * Opens a new popup window with a self-contained styled HTML document
 * and immediately triggers window.print(). No external libraries required.
 *
 * Usage:
 *   import { printBlueprint } from '../blueprint-pdf.js';
 *   printBlueprint(project, client, features);
 */

import { formatQAR } from './utils.js';
import { getSettings } from './settings-store.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * @param {object}   project  — full project record
 * @param {object|null} client  — full client record (name, email, phone, …)
 * @param {Array}    features — [{name, details, price}, …]
 */
export function printBlueprint(project, client, features) {
  const s       = getSettings();
  const profile = s.profile;
  const terms   = s.blueprint?.terms ?? '';

  const clientName = client?.name ?? '—';

  /* ── Avatar ───────────────────────────────────────────────────────────── */
  const avatarHTML = profile.avatar
    ? `<img src="${profile.avatar}" alt="Logo"
            style="width:52px;height:52px;border-radius:50%;object-fit:cover;display:block;">`
    : (() => {
        const name   = profile.name || profile.company || 'QFL';
        const ini    = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#10b981'];
        const bg     = colors[name.charCodeAt(0) % colors.length];
        return `<div style="width:52px;height:52px;border-radius:50%;background:${bg};
                            display:flex;align-items:center;justify-content:center;
                            color:#fff;font-weight:700;font-size:1.125rem;flex-shrink:0;">
                  ${ini}
                </div>`;
      })();

  /* ── Features table rows ─────────────────────────────────────────────── */
  const featureRows = features.length
    ? features.map((f, i) => `
        <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#fff'}">
          <td style="padding:.875rem 1.25rem;font-size:.875rem;font-weight:600;color:#1e293b;
                     border-bottom:1px solid #f1f5f9;">${esc(f.name)}</td>
          <td style="padding:.875rem 1.25rem;font-size:.8125rem;color:#475569;
                     border-bottom:1px solid #f1f5f9;white-space:pre-wrap;">${esc(f.details || '')}</td>
          <td style="padding:.875rem 1.25rem;font-size:.875rem;font-weight:600;color:#1e293b;
                     text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;
                     border-bottom:1px solid #f1f5f9;">
            ${f.price ? esc(formatQAR(Number(f.price))) : '<span style="color:#94a3b8">—</span>'}
          </td>
        </tr>`).join('')
    : `<tr><td colspan="3"
               style="padding:2rem;text-align:center;color:#94a3b8;font-size:.875rem;font-style:italic;">
         No features or services listed.
       </td></tr>`;

  /* ── Total row ───────────────────────────────────────────────────────── */
  const total = features.reduce((sum, f) => sum + (Number(f.price) || 0), 0);
  const totalRow = total > 0 ? `
    <tr style="background:#f1f5f9;">
      <td colspan="2"
          style="padding:.875rem 1.25rem;font-size:.8125rem;font-weight:700;
                 text-transform:uppercase;letter-spacing:.06em;color:#64748b;">
        Total Estimate
      </td>
      <td style="padding:.875rem 1.25rem;text-align:right;font-size:1.025rem;
                 font-weight:800;color:#6366f1;
                 font-variant-numeric:tabular-nums;white-space:nowrap;">
        ${esc(formatQAR(total))}
      </td>
    </tr>` : '';

  /* ── Terms block ─────────────────────────────────────────────────────── */
  const termsBlock = terms.trim() ? `
    <div style="margin-top:2.5rem;padding:1.5rem 1.75rem;background:#f8fafc;
                border-radius:10px;border:1px solid #e2e8f0;">
      <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;
                letter-spacing:.1em;color:#94a3b8;margin:0 0 .75rem">
        Terms of Agreement
      </p>
      <p style="font-size:.8125rem;color:#475569;line-height:1.75;
                margin:0;white-space:pre-wrap;">${esc(terms)}</p>
    </div>` : '';

  /* ── Project description block ───────────────────────────────────────── */
  const notesBlock = project.blueprintDescription ? `
    <div style="margin-top:1.25rem;padding:1rem 1.25rem;background:#f8fafc;
                border-radius:8px;border:1px solid #e2e8f0;">
      <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;
                letter-spacing:.1em;color:#94a3b8;margin-bottom:.5rem;">
        Project Description
      </p>
      <p style="font-size:.875rem;color:#475569;line-height:1.65;
                white-space:pre-wrap;margin:0;">${esc(project.blueprintDescription)}</p>
    </div>` : '';

  /* ── Meta detail helper ──────────────────────────────────────────────── */
  const pRow = (label, value, color = '#1e293b') =>
    (value && value !== '—')
      ? `<tr>
           <td style="padding:.45rem 0;color:#94a3b8;font-size:.8rem;
                      white-space:nowrap;width:8.5rem;">${esc(label)}</td>
           <td style="padding:.45rem 0;font-size:.8rem;font-weight:500;
                      text-align:right;color:${color};">${esc(value)}</td>
         </tr>`
      : '';

  const overdue = project.endDate && project.status !== 'complete' && project.status !== 'cancelled'
                  && new Date(project.endDate) < new Date();
  const today   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /* ── Full HTML document ─────────────────────────────────────────────── */
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Blueprint — ${esc(project.name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #fff; color: #1e293b; font-family: 'Inter', system-ui, sans-serif; }
    .page  { max-width: 800px; margin: 0 auto; padding: 3rem 3.5rem; }
    table  { border-collapse: collapse; width: 100%; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
    @media print {
      .no-print { display: none !important; }
      .page { padding: 2rem 2.5rem; }
      @page { margin: 0; size: A4; }
      body  { padding: 0.6cm; }
    }
  </style>
</head>
<body>

  <!-- Toolbar (hidden on print) -->
  <div class="no-print"
       style="background:#f1f5f9;padding:.75rem 1rem;display:flex;
              justify-content:flex-end;gap:.75rem;border-bottom:1px solid #e2e8f0;">
    <button onclick="window.print()"
            style="background:#6366f1;color:#fff;border:none;padding:.5rem 1.25rem;
                   border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;
                   font-family:inherit;display:flex;align-items:center;gap:.5rem;">
      <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2
             m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm1-4h.01"/>
      </svg>
      Print / Save PDF
    </button>
    <button onclick="window.close()"
            style="background:#e2e8f0;color:#475569;border:none;padding:.5rem 1.25rem;
                   border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;
                   font-family:inherit;">
      Close
    </button>
  </div>

  <div class="page">

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1.5rem;">

      <!-- Sender -->
      <div style="display:flex;align-items:center;gap:1rem;">
        ${avatarHTML}
        <div>
          <p style="font-size:1.125rem;font-weight:700;color:#0f172a;line-height:1.2;">
            ${esc(profile.name || 'Your Name')}
          </p>
          ${profile.company ? `<p style="font-size:.875rem;color:#64748b;margin-top:.2rem;">${esc(profile.company)}</p>` : ''}
          ${profile.tagline ? `<p style="font-size:.75rem;color:#94a3b8;margin-top:.15rem;font-style:italic;">${esc(profile.tagline)}</p>` : ''}
          ${profile.email   ? `<p style="font-size:.8rem;color:#64748b;margin-top:.3rem;">${esc(profile.email)}</p>`   : ''}
          ${profile.phone   ? `<p style="font-size:.8rem;color:#64748b;margin-top:.1rem;">${esc(profile.phone)}</p>`   : ''}
        </div>
      </div>

      <!-- Title block -->
      <div style="text-align:right;">
        <p style="font-size:1.75rem;font-weight:900;color:#0f172a;
                  letter-spacing:-.03em;line-height:1;">
          PROJECT<br>BLUEPRINT
        </p>
        <p style="font-size:.9375rem;font-weight:700;color:#6366f1;margin-top:.4rem;">
          ${esc(project.name)}
        </p>
        <p style="font-size:.75rem;color:#94a3b8;margin-top:.2rem;">${esc(today)}</p>
      </div>
    </div>

    <hr class="divider">

    <!-- ── Bill To + Project Details ───────────────────────────────────── -->
    <div style="display:flex;justify-content:space-between;gap:2rem;flex-wrap:wrap;">

      <!-- Prepared For -->
      <div style="flex:1;min-width:180px;">
        <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:.1em;color:#94a3b8;margin-bottom:.75rem;">
          Prepared For
        </p>
        <p style="font-size:1rem;font-weight:600;color:#0f172a;">${esc(clientName)}</p>
        ${client?.company ? `<p style="font-size:.8125rem;color:#64748b;margin-top:.2rem;">${esc(client.company)}</p>` : ''}
        ${client?.email   ? `<p style="font-size:.8125rem;color:#64748b;margin-top:.25rem;">${esc(client.email)}</p>`  : ''}
        ${client?.phone   ? `<p style="font-size:.8125rem;color:#64748b;margin-top:.15rem;">${esc(client.phone)}</p>`  : ''}
      </div>

      <!-- Project meta -->
      <div style="min-width:200px;">
        <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:.1em;color:#94a3b8;margin-bottom:.75rem;">
          Project Details
        </p>
        <table>
          <tbody>
            ${pRow('Category',   project.category)}
            ${pRow('Start Date', shortDate(project.startDate))}
            ${pRow('Due Date',   shortDate(project.endDate), overdue ? '#f87171' : '#1e293b')}
            ${pRow('Budget',     project.amount ? formatQAR(Number(project.amount)) : '')}
            ${pRow('Hours',      project.hours  ? `${Number(project.hours).toLocaleString()} hrs` : '')}
          </tbody>
        </table>
      </div>
    </div>

    ${notesBlock}

    <hr class="divider">

    <!-- ── Features & Services ─────────────────────────────────────────── -->
    <p style="font-size:.7rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.1em;color:#94a3b8;margin-bottom:.875rem;">
      Features &amp; Services
    </p>
    <table style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:.875rem 1.25rem;text-align:left;font-size:.75rem;font-weight:700;
                     text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;
                     border-bottom:1px solid #e2e8f0;width:32%;">
            Feature / Service
          </th>
          <th style="padding:.875rem 1.25rem;text-align:left;font-size:.75rem;font-weight:700;
                     text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;
                     border-bottom:1px solid #e2e8f0;">
            Details
          </th>
          <th style="padding:.875rem 1.25rem;text-align:right;font-size:.75rem;font-weight:700;
                     text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;
                     border-bottom:1px solid #e2e8f0;width:130px;">
            Price
          </th>
        </tr>
      </thead>
      <tbody>
        ${featureRows}
        ${totalRow}
      </tbody>
    </table>

    ${termsBlock}

    <!-- ── Footer ──────────────────────────────────────────────────────── -->
    <div style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid #e2e8f0;
                display:flex;justify-content:space-between;align-items:center;
                flex-wrap:wrap;gap:.75rem;">
      <div style="font-size:.75rem;color:#94a3b8;">
        ${profile.email ? `<span>${esc(profile.email)}</span>` : ''}
        ${profile.email && profile.phone ? '<span style="margin:0 .5rem">·</span>' : ''}
        ${profile.phone ? `<span>${esc(profile.phone)}</span>` : ''}
      </div>
      <div style="font-size:.75rem;color:#cbd5e1;font-style:italic;">
        Confidential — prepared exclusively for ${esc(clientName)}
      </div>
    </div>

  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=920,height=760,resizable=yes');
  if (!win) { alert('Please allow pop-ups to export Blueprint PDF.'); return; }
  win.document.write(html);
  win.document.close();
}
