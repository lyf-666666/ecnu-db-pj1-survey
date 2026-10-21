async function api(url, options) {
  const opts = Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, options || {});
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);

  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth')) {
      const next = location.pathname + location.search;
      location.href = '/?next=' + encodeURIComponent(next);
      throw new Error('未登录');
    }
    const err = new Error((data && data.error) || '请求失败（' + res.status + '）');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function typeName(type) {
  return { single: '单选', multiple: '多选', text: '填空', number: '数字' }[type] || type;
}

function statusName(status) {
  return { draft: '草稿', published: '已发布', closed: '已关闭' }[status] || status;
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

function showMessage(el, message, ok) {
  el.textContent = message || '';
  el.className = ok ? 'success' : 'error';
}
