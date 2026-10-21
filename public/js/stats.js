const surveyId = location.pathname.split('/')[2];
const listEl = document.getElementById('stats-list');

document.getElementById('back-edit').href = '/surveys/' + surveyId + '/edit';

function choiceHtml(q) {
  const rows = q.options.map((option) => `
    <div class="stat-row">
      <div class="stat-label">
        <span>${esc(option.key)}. ${esc(option.label)}</span>
        <span class="muted">${option.count} 人（${option.percent}%）</span>
      </div>
      <div class="bar"><i style="width:${Math.min(option.percent, 100)}%"></i></div>
    </div>`).join('');
  return rows;
}

function render(data) {
  document.getElementById('title').textContent = data.survey.title;
  document.getElementById('summary').textContent =
    '共收到 ' + data.totalResponses + ' 份回答' + (data.survey.status === 'closed' ? ' · 问卷已关闭' : '');

  if (data.totalResponses === 0) {
    listEl.innerHTML = '<div class="card"><div class="empty">还没有人填写这份问卷</div></div>';
    return;
  }

  listEl.innerHTML = data.questions.map((q) => {
    let body = '';
    if (q.type === 'single' || q.type === 'multiple') {
      body = q.answered === 0
        ? '<div class="empty">这道题还没有人回答</div>'
        : choiceHtml(q);
    } else if (q.type === 'number') {
      body = q.number.count === 0
        ? '<div class="empty">这道题还没有数字回答</div>'
        : `<div class="muted">作答 ${q.number.count} 人，平均值 ${q.number.avg}，最小值 ${q.number.min}，最大值 ${q.number.max}</div>`;
    } else {
      body = q.texts.length === 0
        ? '<div class="empty">这道题还没有填写内容</div>'
        : '<div class="text-list">' + q.texts.map((text) => '<div>' + esc(text) + '</div>').join('') + '</div>';
    }

    return `
      <div class="card">
        <h2>第 ${q.order} 题　${esc(q.title)}</h2>
        <div class="muted" style="margin-bottom:12px;">${typeName(q.type)} · ${q.answered} 人作答</div>
        ${body}
      </div>`;
  }).join('');
}

(async () => {
  try {
    const data = await api('/api/surveys/' + surveyId + '/stats');
    render(data);
  } catch (err) {
    listEl.innerHTML = '<div class="card"><div class="empty">' + esc(err.message) + '</div></div>';
  }
})();
