const surveyId = location.pathname.split('/')[2];

const state = { survey: null, questions: [], editingId: null };

const listEl = document.getElementById('question-list');
const editorCard = document.getElementById('editor-card');
const questionForm = document.getElementById('question-form');
const typeSelect = document.getElementById('type-select');
const optionRows = document.getElementById('option-rows');
const jumpRows = document.getElementById('jump-rows');
const questionMsg = document.getElementById('question-msg');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function renderSurvey() {
  const survey = state.survey;
  document.getElementById('survey-title').textContent = survey.title;
  document.getElementById('survey-meta').textContent =
    state.questions.length + ' 道题 · 创建于 ' + fmtDate(survey.createdAt) +
    (survey.deadline ? ' · 截止 ' + fmtDate(survey.deadline) : ' · 不限截止时间');

  const badge = document.getElementById('survey-status');
  badge.textContent = statusName(survey.status);
  badge.className = 'badge ' + survey.status;

  const infoForm = document.getElementById('info-form');
  const infoFields = infoForm.elements;
  infoFields.title.value = survey.title;
  infoFields.description.value = survey.description || '';
  infoFields.deadline.value = toLocalInput(survey.deadline);
  infoFields.allowAnonymous.checked = Boolean(survey.allowAnonymous);
  infoForm.querySelectorAll('input, textarea, button').forEach((el) => {
    el.disabled = survey.status === 'closed';
  });

  document.getElementById('publish-btn').hidden = survey.status !== 'draft';
  document.getElementById('close-btn').hidden = survey.status !== 'published';
  const statsLink = document.getElementById('stats-link');
  statsLink.hidden = survey.status === 'draft';
  statsLink.href = '/surveys/' + surveyId + '/stats';

  const shareBox = document.getElementById('share-box');
  const shareLink = document.getElementById('share-link');
  if (survey.status === 'published') {
    shareBox.hidden = false;
    shareLink.textContent = location.origin + '/survey/' + surveyId;
  } else {
    shareBox.hidden = true;
  }

  const draft = survey.status === 'draft';
  document.getElementById('lock-hint').hidden = draft;
  document.getElementById('new-question-btn').hidden = !draft;
  document.getElementById('pick-question-btn').hidden = !draft;
  if (!draft) {
    editorCard.hidden = true;
    document.getElementById('picker-card').hidden = true;
  }
}

function constraintsText(q) {
  const parts = [];
  if (q.type === 'multiple') {
    if (q.multiple.minSelect !== null && q.multiple.minSelect !== undefined) parts.push('至少选 ' + q.multiple.minSelect + ' 个');
    if (q.multiple.maxSelect !== null && q.multiple.maxSelect !== undefined) parts.push('最多选 ' + q.multiple.maxSelect + ' 个');
  }
  if (q.type === 'text') {
    if (q.text.minLength !== null && q.text.minLength !== undefined) parts.push('至少 ' + q.text.minLength + ' 字');
    if (q.text.maxLength !== null && q.text.maxLength !== undefined) parts.push('最多 ' + q.text.maxLength + ' 字');
  }
  if (q.type === 'number') {
    if (q.number.min !== null && q.number.min !== undefined) parts.push('≥ ' + q.number.min);
    if (q.number.max !== null && q.number.max !== undefined) parts.push('≤ ' + q.number.max);
    if (q.number.integer) parts.push('整数');
  }
  return parts.join('，');
}

function jumpSummary(q) {
  if (!q.jumps || q.jumps.length === 0) return '';
  const titles = new Map(state.questions.map((item) => [item._id, '第 ' + item.order + ' 题']));
  const pieces = q.jumps.map((rule) => {
    let cond;
    if (rule.match.kind === 'option') {
      cond = (rule.match.mode === 'all' ? '同时选中 ' : '选中 ') + rule.match.keys.join('/');
    } else {
      cond = '数值 ' + rule.match.op + ' ' + rule.match.value;
    }
    return cond + ' → ' + (titles.get(rule.targetQuestionId.toString()) || '已删除的题目');
  });
  return '跳转：' + pieces.join('；');
}

function renderQuestions() {
  if (state.questions.length === 0) {
    listEl.innerHTML = '<div class="empty">还没有题目，点右上角“添加题目”开始</div>';
    return;
  }
  const draft = state.survey.status === 'draft';

  listEl.innerHTML = state.questions.map((q) => {
    const options = q.options && q.options.length
      ? '<div class="sub">选项：' + q.options.map((o) => o.key + '.' + esc(o.label)).join('　') + '</div>'
      : '';
    const extras = constraintsText(q);
    const jump = jumpSummary(q);
    const version = q.versionNo ? ' · v' + q.versionNo : '';
    const newer = draft && q.versionNo && q.latestVersionNo && q.latestVersionNo > q.versionNo;
    const ops = draft
      ? `<div class="ops">
           ${newer ? `<button type="button" class="link" data-sync="${q._id}">更新到 v${q.latestVersionNo}</button>` : ''}
           <button type="button" class="link" data-edit="${q._id}">编辑</button>
           <button type="button" class="link" data-delete="${q._id}" style="color:#dc2626;">删除</button>
         </div>`
      : '';

    return `
      <div class="question-item">
        <div class="head">
          <div>
            <div class="title">第 ${q.order} 题　${esc(q.title)}</div>
            <div class="sub">${typeName(q.type)}${q.required ? ' · 必答' : ' · 选答'}${version}${extras ? ' · ' + extras : ''}</div>
            ${options}
            ${jump ? '<div class="sub">' + esc(jump) + '</div>' : ''}
          </div>
          ${ops}
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-sync]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('把这道题换成题库里的最新版本？原来的跳转规则会被清空，需要重新设置。')) return;
      try {
        await api('/api/surveys/' + surveyId + '/questions/' + btn.dataset.sync + '/sync', { method: 'POST' });
        await load();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  listEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = state.questions.find((item) => item._id === btn.dataset.edit);
      openEditor(q);
    });
  });

  listEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除这道题？指向它的跳转规则也会一起清除。')) return;
      try {
        await api('/api/surveys/' + surveyId + '/questions/' + btn.dataset.delete, { method: 'DELETE' });
        await load();
        if (state.editingId === btn.dataset.delete) resetEditor();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function optionKeysInForm() {
  return [...optionRows.querySelectorAll('.option-row')].map((row) => row.dataset.key);
}

function nextOptionKey() {
  const used = optionKeysInForm();
  const free = LETTERS.find((letter) => !used.includes(letter));
  return free || 'X' + (used.length + 1);
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
    const rules = readJumps();
    renderJumpRows(rules);
  });
  optionRows.appendChild(row);
}

function renderOptions(options) {
  optionRows.innerHTML = '';
  const list = options && options.length ? options : [{ key: 'A', label: '' }, { key: 'B', label: '' }];
  list.forEach((option) => addOptionRow(option.key, option.label));
}

function targetCandidates() {
  return state.questions.filter((q) => q._id !== state.editingId);
}

function renderJumpRows(rules) {
  jumpRows.innerHTML = '';
  const type = typeSelect.value;
  if (type === 'text') return;

  const candidates = targetCandidates();
  if (candidates.length === 0) {
    jumpRows.innerHTML = '<div class="hint">还没有其他题目可以作为跳转目标，先保存题目再设置跳转。</div>';
    return;
  }

  (rules || []).forEach((rule) => addJumpRow(rule, false));
}

function addJumpRow(rule, focus) {
  const type = typeSelect.value;
  const candidates = targetCandidates();
  if (candidates.length === 0) {
    jumpRows.innerHTML = '<div class="hint">还没有其他题目可以作为跳转目标，先保存题目再设置跳转。</div>';
    return;
  }

  const row = document.createElement('div');
  row.className = 'jump-row';
  const keys = optionKeysInForm();

  let conditionHtml = '';
  if (type === 'number') {
    const op = rule && rule.match && rule.match.kind === 'number' ? rule.match.op : '==';
    const value = rule && rule.match && rule.match.kind === 'number' ? rule.match.value : '';
    conditionHtml = `
      <div>
        <label>条件</label>
        <select class="jump-op">
          <option value="=="${op === '==' ? ' selected' : ''}>等于</option>
          <option value="!="${op === '!=' ? ' selected' : ''}>不等于</option>
          <option value=">"${op === '>' ? ' selected' : ''}>大于</option>
          <option value=">="${op === '>=' ? ' selected' : ''}>大于等于</option>
          <option value="<"${op === '<' ? ' selected' : ''}>小于</option>
          <option value="<="${op === '<=' ? ' selected' : ''}>小于等于</option>
        </select>
      </div>
      <div>
        <label>数值</label>
        <input type="number" class="jump-value" step="any" value="${esc(value)}">
      </div>`;
  } else {
    const selectedKeys = rule && rule.match && rule.match.kind === 'option' ? rule.match.keys : [];
    conditionHtml = `
      <div>
        <label>${type === 'multiple' ? '选中的选项（可多选条件）' : '选中的选项'}</label>
        <select class="jump-keys" multiple size="${Math.min(4, Math.max(2, keys.length))}">
          ${keys.map((key) => {
            const label = optionRows.querySelector('.option-row[data-key="' + key + '"] .opt-label');
            const text = label && label.value ? label.value : key;
            return `<option value="${esc(key)}"${selectedKeys.includes(key) ? ' selected' : ''}>${esc(key)}. ${esc(text)}</option>`;
          }).join('')}
        </select>
      </div>`;
    if (type === 'multiple') {
      const mode = rule && rule.match ? rule.match.mode : 'any';
      conditionHtml += `
        <div>
          <label>满足方式</label>
          <select class="jump-mode">
            <option value="any"${mode === 'any' ? ' selected' : ''}>选中任意一个</option>
            <option value="all"${mode === 'all' ? ' selected' : ''}>全部选中</option>
          </select>
        </div>`;
    }
  }

  row.innerHTML = `
    <div class="fields">
      ${conditionHtml}
      <div>
        <label>跳转到</label>
        <select class="jump-target">
          ${candidates.map((q) => `<option value="${q._id}"${rule && rule.targetQuestionId === q._id ? ' selected' : ''}>第 ${q.order} 题：${esc(q.title)}</option>`).join('')}
        </select>
      </div>
      <div style="flex:0 0 auto;">
        <button type="button" class="link" style="color:#dc2626;">删除规则</button>
      </div>
    </div>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  jumpRows.appendChild(row);
  if (focus) {
    const select = row.querySelector('.jump-target');
    if (select) select.focus();
  }
}

function readJumps() {
  const type = typeSelect.value;
  if (type === 'text') return [];
  return [...jumpRows.querySelectorAll('.jump-row')].map((row) => {
    const targetQuestionId = row.querySelector('.jump-target').value;
    if (type === 'number') {
      return {
        targetQuestionId,
        match: {
          kind: 'number',
          op: row.querySelector('.jump-op').value,
          value: Number(row.querySelector('.jump-value').value)
        }
      };
    }
    return {
      targetQuestionId,
      match: {
        kind: 'option',
        keys: [...row.querySelector('.jump-keys').selectedOptions].map((option) => option.value),
        mode: type === 'multiple' ? row.querySelector('.jump-mode').value : 'any'
      }
    };
  });
}

function toggleTypeBlocks() {
  const type = typeSelect.value;
  document.getElementById('options-box').hidden = type !== 'single' && type !== 'multiple';
  document.getElementById('multiple-box').hidden = type !== 'multiple';
  document.getElementById('text-box').hidden = type !== 'text';
  document.getElementById('number-box').hidden = type !== 'number';
  document.getElementById('jumps-box').hidden = type === 'text';

  if ((type === 'single' || type === 'multiple') && optionRows.children.length === 0) {
    renderOptions(null);
  }
  if (type === 'text') {
    jumpRows.innerHTML = '';
  } else {
    renderJumpRows(readJumps());
  }
}

typeSelect.addEventListener('change', () => {
  // 题型变了，旧规则的条件控件已经对不上，直接清空
  jumpRows.innerHTML = '';
  toggleTypeBlocks();
});

document.getElementById('add-option').addEventListener('click', () => {
  addOptionRow(nextOptionKey(), '');
  renderJumpRows(readJumps());
});

document.getElementById('add-jump').addEventListener('click', () => addJumpRow(null, true));

function openEditor(question) {
  state.editingId = question ? question._id : null;
  document.getElementById('editor-title').textContent = question ? '编辑题目' : '添加题目';
  document.getElementById('cancel-edit').hidden = !question;
  questionMsg.textContent = '';
  jumpRows.innerHTML = '';

  questionForm.elements.title.value = question ? question.title : '';
  questionForm.elements.required.checked = question ? question.required : true;
  typeSelect.value = question ? question.type : 'single';
  document.getElementById('version-hint').hidden = !(question && question.versionNo);

  renderOptions(question ? question.options : null);

  questionForm.elements.minSelect.value = question && question.multiple ? (question.multiple.minSelect ?? '') : '';
  questionForm.elements.maxSelect.value = question && question.multiple ? (question.multiple.maxSelect ?? '') : '';
  questionForm.elements.minLength.value = question && question.text ? (question.text.minLength ?? '') : '';
  questionForm.elements.maxLength.value = question && question.text ? (question.text.maxLength ?? '') : '';
  questionForm.elements.min.value = question && question.number ? (question.number.min ?? '') : '';
  questionForm.elements.max.value = question && question.number ? (question.number.max ?? '') : '';
  questionForm.elements.integer.checked = question && question.number ? Boolean(question.number.integer) : false;

  toggleTypeBlocks();
  if (question && question.jumps) {
    renderJumpRows(question.jumps.map((rule) => ({
      targetQuestionId: rule.targetQuestionId.toString(),
      match: rule.match
    })));
  }

  editorCard.hidden = false;
  editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetEditor() {
  state.editingId = null;
  questionForm.reset();
  optionRows.innerHTML = '';
  jumpRows.innerHTML = '';
  questionMsg.textContent = '';
  document.getElementById('version-hint').hidden = true;
  editorCard.hidden = true;
}

document.getElementById('new-question-btn').addEventListener('click', () => openEditor(null));
document.getElementById('cancel-edit').addEventListener('click', resetEditor);

questionForm.addEventListener('submit', async (event) => {
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
    title: questionForm.elements.title.value.trim(),
    required: questionForm.elements.required.checked,
    options,
    multiple: {
      minSelect: questionForm.elements.minSelect.value === '' ? null : Number(questionForm.elements.minSelect.value),
      maxSelect: questionForm.elements.maxSelect.value === '' ? null : Number(questionForm.elements.maxSelect.value)
    },
    text: {
      minLength: questionForm.elements.minLength.value === '' ? null : Number(questionForm.elements.minLength.value),
      maxLength: questionForm.elements.maxLength.value === '' ? null : Number(questionForm.elements.maxLength.value)
    },
    number: {
      min: questionForm.elements.min.value === '' ? null : Number(questionForm.elements.min.value),
      max: questionForm.elements.max.value === '' ? null : Number(questionForm.elements.max.value),
      integer: questionForm.elements.integer.checked
    },
    jumps: readJumps()
  };

  if (!payload.title) {
    questionMsg.textContent = '题目不能为空';
    return;
  }

  try {
    if (state.editingId) {
      await api('/api/surveys/' + surveyId + '/questions/' + state.editingId, { method: 'PUT', body: payload });
    } else {
      await api('/api/surveys/' + surveyId + '/questions', { method: 'POST', body: payload });
    }
    resetEditor();
    await load();
  } catch (err) {
    questionMsg.textContent = err.message;
  }
});

document.getElementById('info-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const fields = form.elements;
  const msg = document.getElementById('info-msg');
  msg.textContent = '';
  try {
    await api('/api/surveys/' + surveyId, {
      method: 'PUT',
      body: {
        title: fields.title.value,
        description: fields.description.value,
        allowAnonymous: fields.allowAnonymous.checked,
        deadline: fields.deadline.value || null
      }
    });
    msg.className = 'success';
    msg.textContent = '已保存';
    await load();
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
  }
});

document.getElementById('publish-btn').addEventListener('click', async () => {
  const msg = document.getElementById('action-msg');
  msg.textContent = '';
  if (!confirm('发布后题目将不能修改，确定发布吗？')) return;
  try {
    await api('/api/surveys/' + surveyId + '/publish', { method: 'POST' });
    await load();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('close-btn').addEventListener('click', async () => {
  const msg = document.getElementById('action-msg');
  msg.textContent = '';
  if (!confirm('关闭后其他人不能再填写，确定关闭吗？')) return;
  try {
    await api('/api/surveys/' + surveyId + '/close', { method: 'POST' });
    await load();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('copy-link').addEventListener('click', async () => {
  await copyText(location.origin + '/survey/' + surveyId);
  const btn = document.getElementById('copy-link');
  btn.textContent = '已复制';
  setTimeout(() => { btn.textContent = '复制链接'; }, 1500);
});

const pickerCard = document.getElementById('picker-card');
const pickerList = document.getElementById('picker-list');

function debounce(fn, wait) {
  let timer = null;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}

async function loadPicker() {
  pickerList.innerHTML = '<div class="empty">加载中...</div>';
  const params = new URLSearchParams();
  params.set('scope', document.getElementById('picker-scope').value);
  const keyword = document.getElementById('picker-search').value.trim();
  if (keyword) params.set('keyword', keyword);

  try {
    const data = await api('/api/questions?' + params.toString());
    const items = data.questions.slice(0, 30);
    if (items.length === 0) {
      pickerList.innerHTML = '<div class="empty">没有可用的题目，先去题目库建一道</div>';
      return;
    }

    // 列表接口只带最新版本，这里补一次详情，方便挑历史版本
    const details = await Promise.all(
      items.map((item) => api('/api/questions/' + item.rootId).catch(() => null))
    );

    pickerList.innerHTML = items.map((item, index) => {
      const detail = details[index];
      const versions = detail ? detail.versions : [];
      const options = versions
        .slice()
        .reverse()
        .map((version) => `<option value="${version._id}"${version.versionNo === item.versionNo ? ' selected' : ''}>v${version.versionNo}${version.versionNo === item.versionNo ? '（最新）' : ''}</option>`)
        .join('');
      return `
        <div class="question-item">
          <div class="head">
            <div>
              <div class="title">${esc(item.title)}</div>
              <div class="sub">${typeName(item.type)} · 最新 v${item.versionNo}${item.isOwner ? '' : ' · 来自 ' + esc(item.ownerName || '其他用户')}</div>
            </div>
            <div class="ops">
              <select data-version="${item.rootId}" style="min-width:110px;">${options}</select>
              <button type="button" class="secondary" data-add="${item.rootId}">加入</button>
            </div>
          </div>
        </div>`;
    }).join('');

    pickerList.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rootId = btn.dataset.add;
        const select = pickerList.querySelector('[data-version="' + rootId + '"]');
        btn.disabled = true;
        try {
          await api('/api/surveys/' + surveyId + '/questions', {
            method: 'POST',
            body: { rootId, versionId: select ? select.value : undefined }
          });
          await load();
          pickerCard.hidden = true;
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    pickerList.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  }
}

document.getElementById('pick-question-btn').addEventListener('click', async () => {
  pickerCard.hidden = false;
  pickerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await loadPicker();
});
document.getElementById('close-picker').addEventListener('click', () => { pickerCard.hidden = true; });
document.getElementById('picker-scope').addEventListener('change', loadPicker);
document.getElementById('picker-search').addEventListener('input', debounce(loadPicker, 300));

async function load() {
  const data = await api('/api/surveys/' + surveyId);
  state.survey = data.survey;
  state.questions = data.questions;
  renderSurvey();
  renderQuestions();
  if (state.survey.status === 'draft' && state.questions.length === 0 && !state.editingId) {
    openEditor(null);
  }
}

(async () => {
  try {
    await load();
  } catch (err) {
    listEl.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  }
})();
