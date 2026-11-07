/* Job requests: emails forwarded to the company's intake address, or messages pasted in, read for the job details. */
'use strict';
SCREENS.requests = async (v, status = 'new') => {
  const r = await api('GET', '/requests?status=' + status);
  v.innerHTML = `<div class="head"><div><h1>Job requests</h1><p class="sub">Forward job emails to <b class="mono">${esc(B.boot.intake_address || '')}</b>, or paste a message or WhatsApp below. TM WerX picks out the address, dates and type; you check it and make the job.</p></div>
<div class="acts"><button id="paste">Paste a request</button></div></div>
<div class="tabs">${[
    ['new', 'To check'],
    ['approved', 'Made into jobs'],
    ['rejected', 'Rejected'],
  ]
    .map(([k, t]) => `<a href="#requests/${k}" class="${status === k ? 'on' : ''}">${t}</a>`)
    .join('')}</div>
${
  r.requests
    .map(q => {
      const x = q.extracted || {};
      return `<div class="card"><div class="head" style="margin:0"><div><h2>${esc(q.subject || x.address || 'Request')}</h2><p class="muted">${esc(q.source)}${q.from_addr ? ' from ' + esc(q.from_addr) : ''} · ${fmtDT(q.created_at)}${q.duplicate_of ? ' · <span class="chip warn">Looks like a duplicate</span>' : ''}</p></div>
${status === 'new' ? `<div class="acts"><button class="sec" data-rej="${esc(q.id)}">Reject</button><button data-mk="${esc(q.id)}">Make job</button></div>` : q.job_id ? `<a href="#job/${esc(q.job_id)}">Open job</a>` : ''}</div>
<div class="grid2"><div><table>${
        [
          ['Address', x.address],
          ['Postcode', x.postcode],
          ['Dates', [x.start_date, x.end_date].filter(Boolean).join(' to ')],
          ['Start time', x.start_time],
          ['Type', x.tm_type],
          ['Client ref', x.client_ref],
          ['Permit', x.permit_ref],
          ['Contact', x.site_contact],
        ]
          .filter(a => a[1])
          .map(([k, val2]) => `<tr><th>${k}</th><td>${esc(val2)}</td></tr>`)
          .join('') || '<tr><td class="muted">Nothing recognised: read the message.</td></tr>'
      }</table></div>
<div><details><summary>Message</summary><pre style="white-space:pre-wrap;font:13px var(--body);max-height:320px;overflow:auto">${esc(q.body)}</pre></details></div></div></div>`;
    })
    .join('') || '<div class="card"><p class="empty">Nothing here.</p></div>'
}`;
  $('#paste').onclick = () => {
    const d = modal(
      `<h2>Paste a request</h2><div class="row"><div><label>From</label><input type="text" id="from"></div><div class="narrow"><label>Kind</label><select id="src"><option value="paste">Message</option><option value="whatsapp">WhatsApp</option><option value="eml">Raw email (.eml)</option></select></div></div>
<label>Subject</label><input type="text" id="subj"><label>Message</label><textarea id="txt" style="min-height:220px"></textarea><p class="muted">Or open an .eml file: <input type="file" id="eml" accept=".eml,message/rfc822"></p>
<div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Add</button></div>`,
      'wide'
    );
    $('#eml', d).onchange = async e => {
      const f = e.target.files[0];
      if (f) ($('#txt', d).value = await f.text()), ($('#src', d).value = 'eml');
    };
    $('#go', d).onclick = async () => {
      const x = await guard(() =>
        api('POST', '/requests', {
          source: val('src', d),
          from: val('from', d),
          subject: val('subj', d),
          text: $('#txt', d).value,
        })
      );
      if (x) d.close(), toast(x.duplicate_of ? 'Added: it looks like one you already have.' : 'Added'), route();
    };
  };
  $$('[data-rej]', v).forEach(
    b =>
      (b.onclick = async () =>
        (await guard(() => api('POST', `/requests/${b.dataset.rej}/reject`), 'Rejected')) &&
        (B.boot.counts.requests--, route()))
  );
  $$('[data-mk]', v).forEach(
    b =>
      (b.onclick = () => {
        const q = r.requests.find(z => z.id === b.dataset.mk),
          x = q.extracted || {};
        B.boot.counts.requests = Math.max(0, (B.boot.counts.requests || 1) - 1);
        window.newJobFrom({
          intake_id: q.id,
          address: x.address,
          postcode: x.postcode,
          client_ref: x.client_ref,
          permit_ref: x.permit_ref,
          tm_type: B.boot.tm_types.includes(x.tm_type) ? x.tm_type : '',
          site_contact: x.site_contact,
          hours: x.start_time ? 'From ' + x.start_time : '',
          instructions: `From request: ${q.subject || ''}`.trim(),
          hazards: [],
        });
      })
  );
};
