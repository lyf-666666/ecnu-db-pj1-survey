const listEl = document.getElementById('list');
const createForm = document.getElementById('create-form');
const createMsg = document.getElementById('create-msg');

let currentUser = null;

async function loadUser() {
  const data = await api('/api/auth/me');
  currentUser = data.user;
  document.getElementById('username').textContent = data.user.username;
}

async function loadSurveys() {
  const data = await api('/api/surveys');
  if (data.surveys.length === 0) {
    listEl.innerHTML = '<div class="empty">还没有问卷，先在上方创建一个吧</div>';
    return;
  }

  listEl.innerHTML = data.surveys.map((survey) => {
    const id = survey._id;
    const link = location.origin + '/survey/' + id;
    const deadline = survey.deadline ? '截止 ' + fmtDate(survey.deadline) : '不限截止时间';
    const actions = [];

    actions.push(`<a href="/surveys/${id}/edit">${survey.status === 'draft' ? '编辑题目' : '查看题目'}</a>`);
    if (survey.status === 'draft') {
      actions.push(`<button type="button" class="secondary" data-publish="${id}">发布</button>`);
    }
    if (survey.status === 'published') {
      actions.push(`<button type="button" class="secondary" data-copy="${esc(link)}">复制填写链接</button>`);
      actions.push(`<button type="button" class="secondary" data-close="${id}">关闭问卷</button>`);
    }
    if (survey.status !== 'draft') {
      actions.push(`<a href="/surveys/${id}/stats">查看统计</a>`);
    }

    return `
      <div class="survey-item">
        <div>
          <strong>${esc(survey.title)}</strong>
          <span class="badge ${survey.status}">${statusName(survey.status)}</span>
        </div>
        <div class="meta">
          ${survey.questionCount} 道题 · ${survey.responseCount} 份回答 · ${deadline} · 创建于 ${fmtDate(survey.createdAt)}
        </div>
        ${survey.status === 'published' ? `<div class="share-link">${esc(link)}</div>` : ''}
        <div class="actions" style="margin-top:10px;">${actions.join('')}</div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-publish]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/surveys/' + btn.dataset.publish + '/publish', { method: 'POST' });
        await loadSurveys();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  listEl.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('关闭之后就不能再填写了，确定关闭吗？')) return;
      btn.disabled = true;
      try {
        await api('/api/surveys/' + btn.dataset.close + '/close', { method: 'POST' });
        await loadSurveys();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  listEl.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await copyText(btn.dataset.copy);
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = '复制填写链接'; }, 1500);
    });
  });
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(createForm);
  createMsg.textContent = '';
  try {
    const data = await api('/api/surveys', {
      method: 'POST',
      body: {
        title: form.get('title'),
        description: form.get('description'),
        allowAnonymous: form.get('allowAnonymous') === 'on',
        deadline: form.get('deadline') || null
      }
    });
    location.href = '/surveys/' + data.survey._id + '/edit';
  } catch (err) {
    createMsg.textContent = err.message;
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

(async () => {
  try {
    await loadUser();
    await loadSurveys();
  } catch (err) {
    listEl.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  }
})();
