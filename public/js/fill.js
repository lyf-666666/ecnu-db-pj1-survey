const surveyId = location.pathname.split('/')[2];

const state = {
  survey: null,
  questions: [],
  index: 0,
  answers: {},
  answeredCount: 0
};

const questionArea = document.getElementById('question-area');
const errorEl = document.getElementById('error');
const nextBtn = document.getElementById('next-btn');
const skipBtn = document.getElementById('skip-btn');
const confirmCard = document.getElementById('confirm-card');
const doneCard = document.getElementById('done-card');

function charLength(str) {
  return Array.from(str).length;
}

function optionHtml(q) {
  if (q.type === 'single') {
    return q.options.map((option) => `
      <label class="choice">
        <input type="radio" name="answer" value="${esc(option.key)}">
        ${esc(option.label)}
      </label>`).join('');
  }
  return q.options.map((option) => `
    <label class="choice">
      <input type="checkbox" name="answer" value="${esc(option.key)}">
      ${esc(option.label)}
    </label>`).join('');
}

function hintText(q) {
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
    if (q.number.min !== null && q.number.min !== undefined) parts.push('不小于 ' + q.number.min);
    if (q.number.max !== null && q.number.max !== undefined) parts.push('不大于 ' + q.number.max);
    if (q.number.integer) parts.push('必须是整数');
  }
  return parts.length ? '（' + parts.join('，') + '）' : '';
}

function renderQuestion() {
  const q = state.questions[state.index];
  if (!q) return;

  document.getElementById('progress').textContent = '第 ' + q.order + ' 题，共 ' + state.questions.length + ' 题';
  errorEl.textContent = '';
  skipBtn.hidden = q.required;

  let inputHtml = '';
  if (q.type === 'single' || q.type === 'multiple') {
    inputHtml = optionHtml(q);
  } else if (q.type === 'text') {
    inputHtml = '<textarea id="text-input" rows="4" maxlength="5000" placeholder="请输入内容"></textarea>';
  } else {
    const step = q.number.integer ? '1' : 'any';
    inputHtml = '<input type="number" id="number-input" step="' + step + '" placeholder="请输入数字">';
  }

  questionArea.innerHTML = `
    <div class="question-box">
      <div class="question-title">${esc(q.title)}${q.required ? '<span style="color:#dc2626;"> *</span>' : ''}</div>
      <div class="question-hint">${typeName(q.type)}${q.type === 'multiple' ? '（可多选）' : ''} ${esc(hintText(q))}</div>
      ${inputHtml}
    </div>`;

  questionArea.querySelectorAll('.choice input').forEach((input) => {
    input.addEventListener('change', () => {
      questionArea.querySelectorAll('.choice').forEach((label) => {
        label.classList.toggle('selected', label.querySelector('input').checked);
      });
    });
  });
}

function readAnswer(q) {
  if (q.type === 'single') {
    const checked = questionArea.querySelector('input[name="answer"]:checked');
    if (!checked) {
      return { error: '请选择一个选项' };
    }
    return { answer: { questionId: q._id, optionKeys: [checked.value] } };
  }

  if (q.type === 'multiple') {
    const keys = [...questionArea.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
    let min = q.multiple.minSelect;
    if (min === null || min === undefined) min = q.required ? 1 : 0;
    if (q.required && min < 1) min = 1;
    const max = q.multiple.maxSelect;
    if (keys.length < min) return { error: '至少需要选择 ' + min + ' 个选项' };
    if (max !== null && max !== undefined && keys.length > max) return { error: '最多只能选择 ' + max + ' 个选项' };
    return { answer: { questionId: q._id, optionKeys: keys } };
  }

  if (q.type === 'text') {
    const value = document.getElementById('text-input').value.trim();
    if (q.required && value === '') return { error: '这是必答题' };
    if (q.text.minLength !== null && q.text.minLength !== undefined && charLength(value) < q.text.minLength) {
      return { error: '至少需要输入 ' + q.text.minLength + ' 个字' };
    }
    if (q.text.maxLength !== null && q.text.maxLength !== undefined && charLength(value) > q.text.maxLength) {
      return { error: '最多只能输入 ' + q.text.maxLength + ' 个字' };
    }
    return { answer: { questionId: q._id, value } };
  }

  const raw = document.getElementById('number-input').value;
  if (raw === '') {
    if (q.required) return { error: '这是必答题' };
    return { answer: { questionId: q._id, value: null } };
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return { error: '请输入数字' };
  if (q.number.integer && !Number.isInteger(num)) return { error: '必须是整数' };
  if (q.number.min !== null && q.number.min !== undefined && num < q.number.min) return { error: '不能小于 ' + q.number.min };
  if (q.number.max !== null && q.number.max !== undefined && num > q.number.max) return { error: '不能大于 ' + q.number.max };
  return { answer: { questionId: q._id, value: num } };
}

function jumpMatches(match, answer) {
  if (!match || !answer) return false;
  if (match.kind === 'option') {
    const selected = answer.optionKeys || [];
    const keys = match.keys || [];
    if (selected.length === 0 || keys.length === 0) return false;
    return match.mode === 'all'
      ? keys.every((key) => selected.includes(key))
      : keys.some((key) => selected.includes(key));
  }
  if (match.kind === 'number') {
    const value = Number(answer.value);
    if (answer.value === null || answer.value === undefined || !Number.isFinite(value)) return false;
    const target = Number(match.value);
    switch (match.op) {
      case '==': return value === target;
      case '!=': return value !== target;
      case '>': return value > target;
      case '>=': return value >= target;
      case '<': return value < target;
      case '<=': return value <= target;
      default: return false;
    }
  }
  return false;
}

function nextIndex(q, answer) {
  if (answer && Array.isArray(q.jumps)) {
    for (const rule of q.jumps) {
      if (!jumpMatches(rule.match, answer)) continue;
      const index = state.questions.findIndex((item) => item._id === rule.targetQuestionId.toString());
      if (index >= 0) return index;
    }
  }
  return state.index + 1;
}

function saveAnswer(q, answer) {
  if (!answer) return;
  const isEmpty = answer.optionKeys
    ? answer.optionKeys.length === 0
    : (answer.value === '' || answer.value === null || answer.value === undefined);
  if (isEmpty && !q.required) return;
  state.answers[q._id] = answer;
}

function goNext(forceSkip) {
  const q = state.questions[state.index];
  let answer = null;

  if (!forceSkip) {
    const result = readAnswer(q);
    if (result.error) {
      errorEl.textContent = result.error;
      return;
    }
    answer = result.answer;
  }

  saveAnswer(q, answer);
  errorEl.textContent = '';
  state.answeredCount = Object.keys(state.answers).length;

  const target = nextIndex(q, answer);
  if (target >= state.questions.length) {
    showConfirm();
    return;
  }
  state.index = target;
  renderQuestion();
}

function showConfirm() {
  document.getElementById('question-card').hidden = true;
  confirmCard.hidden = false;
  document.getElementById('progress').textContent = '已完成 ' + Object.keys(state.answers).length + ' 题';

  const unanswered = state.questions.length - Object.keys(state.answers).length;
  document.getElementById('confirm-text').textContent =
    '你已经回答了 ' + Object.keys(state.answers).length + ' 道题' +
    (unanswered > 0 ? '，另有 ' + unanswered + ' 道题因跳转或跳过没有作答。' : '。') +
    ' 提交后不能再修改。';

  if (state.survey.allowAnonymous) {
    document.getElementById('anonymous-row').hidden = false;
  }
}

async function submit() {
  const btn = document.getElementById('submit-btn');
  const errEl = document.getElementById('submit-error');
  errEl.textContent = '';
  btn.disabled = true;
  try {
    await api('/api/public/surveys/' + surveyId + '/responses', {
      method: 'POST',
      body: {
        answers: Object.values(state.answers),
        anonymous: document.getElementById('anonymous-check').checked
      }
    });
    document.getElementById('survey-card').hidden = true;
    confirmCard.hidden = true;
    doneCard.hidden = false;
    document.getElementById('done-text').textContent = '感谢你填写《' + state.survey.title + '》。';
    document.getElementById('again-link').href = '/survey/' + surveyId;
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false;
  }
}

nextBtn.addEventListener('click', () => goNext(false));
skipBtn.addEventListener('click', () => goNext(true));
document.getElementById('submit-btn').addEventListener('click', submit);

(async () => {
  try {
    const data = await api('/api/public/surveys/' + surveyId);
    state.survey = data.survey;
    state.questions = data.questions;

    document.getElementById('title').textContent = state.survey.title;
    document.getElementById('description').textContent = state.survey.description || '';
    document.getElementById('deadline').textContent = state.survey.deadline
      ? '截止时间：' + fmtDate(state.survey.deadline)
      : '';

    if (state.questions.length === 0) {
      questionArea.innerHTML = '<div class="empty">这份问卷还没有题目</div>';
      nextBtn.hidden = true;
      return;
    }
    renderQuestion();
  } catch (err) {
    document.getElementById('title').textContent = '无法填写问卷';
    questionArea.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
    nextBtn.hidden = true;
    document.getElementById('progress').textContent = '';
  }
})();
