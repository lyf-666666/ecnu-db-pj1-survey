const state = {
  scope: 'mine',
  keyword: '',
  bankId: '',
  list: [],
  banks: [],
  detail: null,
  editor: { rootId: null, mode: 'create', parentVersionId: null, versionId: null }
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const listEl = document.getElementById('question-list');
const editorCard = document.getElementById('editor-card');
const detailCard = document.getElementById('detail-card');
const form = document.getElementById('question-form');
const typeSelect = document.getElementById('type-select');
const optionRows = document.getElementById('option-rows');
const questionMsg = document.getElementById('question-msg');

function debounce(fn, wait) {
  let timer = null;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}

async function loadList() {
  const params = new URLSearchParams();
  params.set('scope', state.scope);
  if (state.keyword) params.set('keyword', state.keyword);
  if (state.bankId) params.set('bankId', state.bankId);
  const data = await api('/api/questions?' + params.toString());
  state.list = data.questions;
  renderList();
}

function renderList() {
  if (state.list.length === 0) {
    listEl.innerHTML = '<div class="empty">' +
      (state.keyword ? '没有匹配的题目' : '还没有题目，点右上角“新建题目”开始') + '</div>';
    return;
  }

  listEl.innerHTML = state.list.map((item) => {
    const ops = [
      '<button type="button" class="link" data-detail="' + item.rootId + '">详情</button>'
    ];
    if (item.isOwner) {
      ops.push('<button type="button" class="link" data-edit="' + item.rootId + '">修改</button>');
    }
    const shared = item.sharedWithCount > 0 ? ' · 已共享给 ' + item.sharedWithCount + ' 人' : '';
    const usage = item.usageCount > 0 ? ' · 用于 ' + item.usageCount + ' 份问卷' : ' · 还没被使用';

    return `
      <div class="question-item q-item">
        <div class="head">
          <div>
            <div class="title">${esc(item.title)}</div>
            <div class="sub">
              ${typeName(item.type)} · v${item.versionNo}${usage}${shared}
              ${item.isOwner ? '' : ' · 来自 ' + esc(item.ownerName || '其他用户')}
            </div>
          </div>
        </div>
        <div class="ops">${ops.join('')}</div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-detail]').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.detail));
  });
  listEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditor(btn.dataset.edit));
  });
}

function optionKeysInForm() {
  return [...optionRows.querySelectorAll('.option-row')].map((row) => row.dataset.key);
}

function nextOptionKey() {
  const used = optionKeysInForm();
  return LETTERS.find((letter) => !used.includes(letter)) || 'X' + (used.length + 1);
}

function addOptionRow(key, label) {
  const row = document.createElement('div');
  row.className = 'option-row';
  row.dataset.key = key;
  row.innerHTML = `
    <span class="key">${esc(key)}</span>
    <input type="text" class="opt-label" maxlength="100" value="${esc(label || '')}" placeholder="选项内容">
    <button type="button" class="link" style="color:#dc2626;">删除</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (optionRows.querySelectorAll('.option-row').length <= 2) {
      alert('至少保留两个选项');
      return;
    }
    row.remove();
  });
  optionRows.appendChild(row);
}

function renderOptions(options) {
  optionRows.innerHTML = '';
  const list = options && options.length ? options : [{ key: 'A', label: '' }, { key: 'B', label: '' }];
  list.forEach((option) => addOptionRow(option.key, option.label));
}

function toggleTypeBlocks() {
  const type = typeSelect.value;
  document.getElementById('options-box').hidden = type !== 'single' && type !== 'multiple';
  document.getElementById('multiple-box').hidden = type !== 'multiple';
  document.getElementById('text-box').hidden = type !== 'text';
  document.getElementById('number-box').hidden = type !== 'number';
  if ((type === 'single' || type === 'multiple') && optionRows.children.length === 0) {
    renderOptions(null);
  }
}

typeSelect.addEventListener('change', toggleTypeBlocks);

document.getElementById('add-option').addEventListener('click', () => addOptionRow(nextOptionKey(), ''));

function fillForm(content) {
  form.elements.title.value = content ? content.title : '';
  typeSelect.value = content ? content.type : 'single';
  renderOptions(content ? content.options : null);
  form.elements.minSelect.value = content && content.multiple ? (content.multiple.minSelect ?? '') : '';
  form.elements.maxSelect.value = content && content.multiple ? (content.multiple.maxSelect ?? '') : '';
  form.elements.minLength.value = content && content.text ? (content.text.minLength ?? '') : '';
  form.elements.maxLength.value = content && content.text ? (content.text.maxLength ?? '') : '';
  form.elements.min.value = content && content.number ? (content.number.min ?? '') : '';
  form.elements.max.value = content && content.number ? (content.number.max ?? '') : '';
  form.elements.integer.checked = content && content.number ? Boolean(content.number.integer) : false;
  form.elements.changeNote.value = '';
  toggleTypeBlocks();
}

function openEditor(rootId, options) {
  const opts = options || {};
  state.editor = {
    rootId: rootId || null,
    mode: opts.mode || (rootId ? 'edit' : 'create'),
    parentVersionId: opts.parentVersionId || null,
    versionId: opts.versionId || null
  };

  editorCard.hidden = false;
  questionMsg.textContent = '';
  document.getElementById('editor-title').textContent =
    state.editor.mode === 'create' ? '新建题目' : state.editor.mode === 'fork' ? '基于历史版本新建' : '修改题目';

  const hint = document.getElementById('editor-hint');
  if (state.editor.mode === 'edit') {
    hint.textContent = '保存后会生成一个新版本。已经引用旧版本的问卷不会被改动，需要的话可以在问卷编辑页手动更新。';
  } else if (state.editor.mode === 'fork') {
    hint.textContent = '会以选中的版本为底稿另起一个新版本，原版本继续保留。';
  } else {
    hint.textContent = '新建的题目会直接进入题目库，之后可以反复使用。';
  }

  if (opts.content) {
    fillForm(opts.content);
  } else if (rootId) {
    fillForm(null);
    api('/api/questions/' + rootId).then((data) => fillForm(data.current)).catch((err) => {
      questionMsg.textContent = err.message;
    });
  } else {
    fillForm(null);
  }

  editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('new-question').addEventListener('click', () => openEditor(null));
document.getElementById('cancel-edit').addEventListener('click', () => {
  editorCard.hidden = true;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  questionMsg.textContent = '';
  const type = typeSelect.value;
  const options = [...optionRows.querySelectorAll('.option-row')].map((row) => ({
    key: row.dataset.key,
    label: row.querySelector('.opt-label').value.trim()
  }));

  if ((type === 'single' || type === 'multiple') && options.length < 2) {
    questionMsg.textContent = '至少需要两个选项';
    return;
  }

  const payload = {
    type,
    title: form.elements.title.value.trim(),
    options,
    multiple: {
      minSelect: form.elements.minSelect.value === '' ? null : Number(form.elements.minSelect.value),
      maxSelect: form.elements.maxSelect.value === '' ? null : Number(form.elements.maxSelect.value)
    },
    text: {
      minLength: form.elements.minLength.value === '' ? null : Number(form.elements.minLength.value),
      maxLength: form.elements.maxLength.value === '' ? null : Number(form.elements.maxLength.value)
    },
    number: {
      min: form.elements.min.value === '' ? null : Number(form.elements.min.value),
      max: form.elements.max.value === '' ? null : Number(form.elements.max.value),
      integer: form.elements.integer.checked
    },
    changeNote: form.elements.changeNote.value.trim()
  };

  if (!payload.title) {
    questionMsg.textContent = '题目不能为空';
    return;
  }

  try {
    if (state.editor.mode === 'create') {
      const created = await api('/api/questions', { method: 'POST', body: payload });
      editorCard.hidden = true;
      await loadList();
      await openDetail(created.rootId);
    } else if (state.editor.mode === 'fork') {
      await api('/api/questions/' + state.editor.rootId + '/versions', {
        method: 'POST',
        body: { ...payload, parentVersionId: state.editor.parentVersionId }
      });
      editorCard.hidden = true;
      await loadList();
      await openDetail(state.editor.rootId);
    } else {
      await api('/api/questions/' + state.editor.rootId, { method: 'PUT', body: payload });
      editorCard.hidden = true;
      await loadList();
      await openDetail(state.editor.rootId);
    }
  } catch (err) {
    questionMsg.textContent = err.message;
  }
});

function versionSourceName(version) {
  if (version.source === 'create') return '新建';
  if (version.source === 'restore') return '恢复';
  if (version.source === 'fork') return '分叉';
  return '修改';
}

async function openDetail(rootId) {
  detailCard.hidden = false;
  detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('detail-title').textContent = '题目详情';
  document.getElementById('version-list').innerHTML = '<div class="muted">加载中...</div>';
  document.getElementById('usage-list').innerHTML = '';
  document.getElementById('stats-box').innerHTML = '<div class="muted">加载中...</div>';

  try {
    const data = await api('/api/questions/' + rootId);
    state.detail = data;
    renderDetail(data);
    await loadStats(rootId);
  } catch (err) {
    document.getElementById('version-list').innerHTML = '<div class="error">' + esc(err.message) + '</div>';
  }
}

function renderDetail(data) {
  const current = data.current || {};
  document.getElementById('detail-title').textContent = current.title || '题目详情';
  document.getElementById('detail-meta').textContent =
    typeName(current.type) + ' · 最新 v' + data.root.latestVersionNo +
    ' · 创建于 ' + fmtDate(data.root.createdAt) +
    (data.root.isOwner ? '' : ' · 来自 ' + esc(data.ownerName || '其他用户'));

  renderVersions(data);
  renderUsage(data);
  renderShare(data);
  renderBankSelect(data);
}

function renderVersions(data) {
  const latestId = String(data.root.latestVersionId || data.versions[data.versions.length - 1]._id);
  const byId = new Map(data.versions.map((version) => [String(version._id), version]));

  const html = data.versions.map((version) => {
    const isLatest = String(version._id) === latestId;
    const parent = version.parentVersionId ? byId.get(String(version.parentVersionId)) : null;
    const parentText = parent ? '由 v' + parent.versionNo + ' 改出' : '最初版本';
    const ops = [];
    if (String(version._id) !== String(data.root.latestVersionId)) {
      ops.push('<button type="button" class="link" data-restore="' + version._id + '" data-no="' + version.versionNo + '">恢复此版本</button>');
    }
    if (data.root.isOwner) {
      ops.push('<button type="button" class="link" data-fork="' + version._id + '">基于此版本新建</button>');
    }

    const optionText = version.options && version.options.length
      ? version.options.map((option) => option.key + '.' + option.label).join('　')
      : '';

    return `
      <div class="version-item${isLatest ? ' current' : ''}">
        <div class="version-title">v${version.versionNo}　${esc(version.title)}${isLatest ? '　<span class="badge draft">当前</span>' : ''}</div>
        <div class="version-meta">
          ${versionSourceName(version)} · ${parentText} · ${fmtDate(version.createdAt)}
          ${version.changeNote ? ' · ' + esc(version.changeNote) : ''}
        </div>
        ${optionText ? '<div class="version-meta">' + esc(optionText) + '</div>' : ''}
        ${ops.length ? '<div class="version-meta">' + ops.join('　') + '</div>' : ''}
      </div>`;
  }).join('');

  const box = document.getElementById('version-list');
  box.innerHTML = html;

  box.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('恢复 v' + btn.dataset.no + ' 的内容？会生成一个新版本，原来的版本都还在。')) return;
      try {
        await api('/api/questions/' + data.root._id + '/versions/' + btn.dataset.restore + '/restore', { method: 'POST' });
        await loadList();
        await openDetail(data.root._id);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  box.querySelectorAll('[data-fork]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const version = data.versions.find((item) => String(item._id) === btn.dataset.fork);
      openEditor(data.root._id, {
        mode: 'fork',
        parentVersionId: version._id,
        content: version
      });
    });
  });
}

function renderUsage(data) {
  const box = document.getElementById('usage-list');
  if (data.usage.length === 0) {
    box.innerHTML = '<div class="muted" style="font-size:13px;">这道题还没有被任何问卷使用。</div>';
    return;
  }
  box.innerHTML = data.usage.map((item) => `
    <div class="version-item">
      <div class="version-title">${esc(item.surveyTitle)}</div>
      <div class="version-meta">
        使用 v${item.versionNo} · ${statusName(item.surveyStatus)}
        ${item.isMine ? '' : ' · ' + esc(item.ownerName || '其他用户')}
      </div>
    </div>`).join('');
}

function renderShare(data) {
  const block = document.getElementById('share-block');
  block.hidden = !data.root.isOwner;

  const box = document.getElementById('share-list');
  if (data.root.sharedWith.length === 0) {
    box.textContent = '还没有共享给任何人。';
  } else {
    box.innerHTML = data.root.sharedWith.map((user) => `
      <span class="bank-chip">
        ${esc(user.username || '未知用户')}
        <button type="button" class="link" style="font-size:12px;" data-unshare="${user.userId}">移除</button>
      </span>`).join('');
    box.querySelectorAll('[data-unshare]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/questions/' + data.root._id + '/share/' + btn.dataset.unshare, { method: 'DELETE' });
          await openDetail(data.root._id);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
}

document.getElementById('share-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = document.getElementById('share-msg');
  msg.textContent = '';
  const username = event.target.elements.username.value.trim();
  if (!username) return;
  try {
    await api('/api/questions/' + state.detail.root._id + '/share', { method: 'POST', body: { username } });
    event.target.reset();
    await openDetail(state.detail.root._id);
  } catch (err) {
    msg.textContent = err.message;
  }
});

function renderBankSelect(data) {
  const select = document.getElementById('bank-select');
  if (state.banks.length === 0) {
    select.innerHTML = '<option value="">还没有题库，先在下面建一个</option>';
    document.getElementById('add-to-bank').disabled = true;
    return;
  }
  document.getElementById('add-to-bank').disabled = false;
  select.innerHTML = state.banks.map((bank) => `<option value="${bank._id}">${esc(bank.name)}</option>`).join('');
  document.getElementById('bank-msg').textContent = data.banks.length
    ? '已加入：' + data.banks.map((bank) => bank.name).join('、')
    : '';
}

document.getElementById('add-to-bank').addEventListener('click', async () => {
  const select = document.getElementById('bank-select');
  const msg = document.getElementById('bank-msg');
  if (!select.value) return;
  try {
    await api('/api/banks/' + select.value + '/items', {
      method: 'POST',
      body: { rootId: state.detail.root._id }
    });
    await loadBanks();
    await openDetail(state.detail.root._id);
    msg.className = 'success';
    msg.textContent = '已加入题库';
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
  }
});

async function loadStats(rootId) {
  const box = document.getElementById('stats-box');
  try {
    const data = await api('/api/questions/' + rootId + '/stats');
    if (data.answered === 0) {
      box.innerHTML = '<div class="muted">还没有回答。问卷发布并有人填写后，这里会按选项汇总所有问卷的数据。</div>';
      return;
    }

    const parts = [];
    parts.push(`<div class="muted" style="margin-bottom:12px;">共 ${data.answered} 份回答，来自 ${data.surveyCount} 份问卷</div>`);

    if (data.options.length > 0) {
      parts.push(data.options.map((option) => `
        <div class="stat-row">
          <div class="stat-label"><span>${esc(option.label)}</span><span>${option.count} 人（${option.percent}%）</span></div>
          <div class="bar"><i style="width:${Math.min(100, option.percent)}%"></i></div>
        </div>`).join(''));
    }

    if (data.number && data.number.count > 0) {
      parts.push(`
        <div class="muted" style="margin-top:10px;">
          数值回答 ${data.number.count} 个，平均 ${data.number.avg}，最小 ${data.number.min}，最大 ${data.number.max}
        </div>`);
    }

    if (data.texts.length > 0) {
      parts.push('<div class="text-list" style="margin-top:12px;">' +
        data.texts.slice(0, 50).map((text) => '<div>' + esc(text) + '</div>').join('') +
        '</div>');
    }

    if (data.versions.length > 0) {
      parts.push('<div class="muted" style="margin-top:12px;">版本分布：' +
        data.versions.map((item) => 'v' + item.versionNo + ' 收到 ' + item.answered + ' 份').join('；') + '</div>');
    }

    if (data.surveys.length > 0) {
      parts.push('<div class="muted" style="margin-top:6px;">按问卷：' +
        data.surveys.map((item) => esc(item.title) + '（v' + item.versionNo + '，' + item.answered + ' 份）').join('；') + '</div>');
    }

    box.innerHTML = parts.join('');
  } catch (err) {
    box.innerHTML = '<div class="error">' + esc(err.message) + '</div>';
  }
}

document.getElementById('close-detail').addEventListener('click', () => {
  detailCard.hidden = true;
});

async function loadBanks() {
  const data = await api('/api/banks');
  state.banks = data.banks;

  const filter = document.getElementById('bank-filter');
  const current = filter.value;
  filter.innerHTML = '<option value="">全部题库</option>' +
    state.banks.map((bank) => `<option value="${bank._id}">${esc(bank.name)}</option>`).join('');
  filter.value = current;
  if (filter.value !== current) {
    state.bankId = '';
    filter.value = '';
  }

  const box = document.getElementById('bank-list');
  if (state.banks.length === 0) {
    box.innerHTML = '<div class="empty">还没有题库</div>';
    return;
  }
  box.innerHTML = state.banks.map((bank) => `
    <div class="version-item">
      <div class="version-title">${esc(bank.name)} <span class="muted">（${bank.itemCount} 道题）</span></div>
      <div class="version-meta">${bank.description ? esc(bank.description) : '没有说明'} · ${fmtDate(bank.createdAt)}</div>
      <div class="version-meta">
        <button type="button" class="link" data-bank-open="${bank._id}">查看题目</button>
        <button type="button" class="link" style="color:#dc2626;" data-bank-delete="${bank._id}">删除题库</button>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-bank-open]').forEach((btn) => {
    btn.addEventListener('click', () => openBank(btn.dataset.bankOpen));
  });
  box.querySelectorAll('[data-bank-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除这个题库？题目本身不会被删除。')) return;
      try {
        await api('/api/banks/' + btn.dataset.bankDelete, { method: 'DELETE' });
        document.getElementById('bank-detail').hidden = true;
        await loadBanks();
        await loadList();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function openBank(bankId) {
  const box = document.getElementById('bank-detail');
  box.hidden = false;
  document.getElementById('bank-detail-title').textContent = '加载中...';
  document.getElementById('bank-items').innerHTML = '';

  const data = await api('/api/banks/' + bankId);
  document.getElementById('bank-detail-title').textContent = data.bank.name + '（' + data.items.length + ' 道题）';

  if (data.items.length === 0) {
    document.getElementById('bank-items').innerHTML = '<div class="muted" style="font-size:13px;">这个题库还是空的。在题目详情里点“加入题库”就能放进来。</div>';
    return;
  }

  const container = document.getElementById('bank-items');
  container.innerHTML = data.items.map((item) => `
    <div class="version-item">
      <div class="version-title">${esc(item.title)}</div>
      <div class="version-meta">${typeName(item.type)} · v${item.versionNo}</div>
      <div class="version-meta">
        <button type="button" class="link" data-item-detail="${item.rootId}">查看</button>
        <button type="button" class="link" style="color:#dc2626;" data-item-remove="${item.rootId}">移出题库</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('[data-item-detail]').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.itemDetail));
  });
  container.querySelectorAll('[data-item-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/banks/' + bankId + '/items/' + btn.dataset.itemRemove, { method: 'DELETE' });
        await openBank(bankId);
        await loadBanks();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.getElementById('bank-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = document.getElementById('bank-msg-global');
  msg.textContent = '';
  const name = event.target.elements.name.value.trim();
  const description = event.target.elements.description.value.trim();
  if (!name) return;
  try {
    await api('/api/banks', { method: 'POST', body: { name, description } });
    event.target.reset();
    await loadBanks();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('bank-filter').addEventListener('change', (event) => {
  state.bankId = event.target.value;
  loadList();
});

document.getElementById('search').addEventListener('input', debounce((event) => {
  state.keyword = event.target.value.trim();
  loadList();
}, 300));

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
    btn.classList.add('active');
    state.scope = btn.dataset.scope;
    loadList();
  });
});

(async () => {
  try {
    await loadBanks();
    await loadList();
  } catch (err) {
    listEl.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  }
})();
