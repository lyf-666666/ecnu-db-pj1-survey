const { ObjectId } = require('mongodb');

// 服务端会按题号顺序重新走一遍跳转，客户端传上来的答案只当作“作答内容”，
// 因此被跳过的题目即使客户端多传了答案也不会入库。

function charLength(str) {
  return Array.from(str).length;
}

function validateSingle(q, raw, qid) {
  const keys = Array.isArray(raw.optionKeys) ? raw.optionKeys : [];
  if (keys.length !== 1) {
    return { error: { questionId: qid, message: '单选题需要且只能选择一个选项' } };
  }
  const valid = q.options.some((o) => o.key === keys[0]);
  if (!valid) {
    return { error: { questionId: qid, message: '选项不存在：' + keys[0] } };
  }
  return {
    doc: { questionId: q._id, type: 'single', optionKeys: [keys[0]], value: null, numberValue: null }
  };
}

function validateMultiple(q, raw, qid) {
  const keys = Array.isArray(raw.optionKeys) ? raw.optionKeys : [];
  const unique = [...new Set(keys)];
  if (unique.length !== keys.length) {
    return { error: { questionId: qid, message: '多选题选项重复' } };
  }
  for (const key of unique) {
    if (!q.options.some((o) => o.key === key)) {
      return { error: { questionId: qid, message: '选项不存在：' + key } };
    }
  }
  const rules = q.multiple || {};
  let min = rules.minSelect;
  if (min === null || min === undefined) min = q.required ? 1 : 0;
  if (q.required && min < 1) min = 1;
  const max = rules.maxSelect === null || rules.maxSelect === undefined ? null : rules.maxSelect;

  if (unique.length < min) {
    return { error: { questionId: qid, message: `至少需要选择 ${min} 个选项` } };
  }
  if (max !== null && unique.length > max) {
    return { error: { questionId: qid, message: `最多只能选择 ${max} 个选项` } };
  }
  return {
    doc: { questionId: q._id, type: 'multiple', optionKeys: unique, value: null, numberValue: null }
  };
}

function validateText(q, raw, qid) {
  if (typeof raw.value !== 'string') {
    return { error: { questionId: qid, message: '填空题需要提交文本内容' } };
  }
  const value = raw.value.trim();
  if (q.required && value.length === 0) {
    return { error: { questionId: qid, message: '这是必答题' } };
  }
  const rules = q.text || {};
  const len = charLength(value);
  if (rules.minLength !== null && rules.minLength !== undefined && len < rules.minLength) {
    return { error: { questionId: qid, message: `至少需要输入 ${rules.minLength} 个字` } };
  }
  if (rules.maxLength !== null && rules.maxLength !== undefined && len > rules.maxLength) {
    return { error: { questionId: qid, message: `最多只能输入 ${rules.maxLength} 个字` } };
  }
  return {
    doc: { questionId: q._id, type: 'text', optionKeys: [], value, numberValue: null }
  };
}

function validateNumber(q, raw, qid) {
  const rawValue = raw.value;
  if (rawValue === '' || rawValue === null || rawValue === undefined) {
    if (q.required) return { error: { questionId: qid, message: '这是必答题' } };
    return { doc: { questionId: q._id, type: 'number', optionKeys: [], value: null, numberValue: null } };
  }
  const num = Number(rawValue);
  if (!Number.isFinite(num)) {
    return { error: { questionId: qid, message: '请输入数字' } };
  }
  const rules = q.number || {};
  if (rules.integer && !Number.isInteger(num)) {
    return { error: { questionId: qid, message: '必须是整数' } };
  }
  if (rules.min !== null && rules.min !== undefined && num < rules.min) {
    return { error: { questionId: qid, message: `不能小于 ${rules.min}` } };
  }
  if (rules.max !== null && rules.max !== undefined && num > rules.max) {
    return { error: { questionId: qid, message: `不能大于 ${rules.max}` } };
  }
  return {
    doc: { questionId: q._id, type: 'number', optionKeys: [], value: null, numberValue: num }
  };
}

function validateOne(q, raw) {
  const qid = q._id.toString();
  switch (q.type) {
    case 'single':
      return validateSingle(q, raw, qid);
    case 'multiple':
      return validateMultiple(q, raw, qid);
    case 'text':
      return validateText(q, raw, qid);
    case 'number':
      return validateNumber(q, raw, qid);
    default:
      return { error: { questionId: qid, message: '未知题型' } };
  }
}

function compareNumber(op, left, right) {
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    default: return false;
  }
}

function jumpMatches(match, answer) {
  if (!match || !answer) return false;
  if (match.kind === 'option') {
    const selected = answer.optionKeys || [];
    const keys = match.keys || [];
    if (selected.length === 0 || keys.length === 0) return false;
    if (match.mode === 'all') return keys.every((k) => selected.includes(k));
    return keys.some((k) => selected.includes(k));
  }
  if (match.kind === 'number') {
    if (answer.numberValue === null || answer.numberValue === undefined) return false;
    return compareNumber(match.op, answer.numberValue, Number(match.value));
  }
  return false;
}

function nextQuestion(questions, byId, current, answerDoc) {
  if (answerDoc && Array.isArray(current.jumps)) {
    for (const rule of current.jumps) {
      if (!jumpMatches(rule.match, answerDoc)) continue;
      const target = byId.get(rule.targetQuestionId.toString());
      if (target) return target;
    }
  }
  const index = questions.findIndex((q) => q._id.equals(current._id));
  return questions[index + 1] || null;
}

function checkAnswers(questions, rawAnswers) {
  const list = Array.isArray(rawAnswers) ? rawAnswers : [];
  const byId = new Map(questions.map((q) => [q._id.toString(), q]));
  const answerMap = new Map();
  const errors = [];

  for (const raw of list) {
    const qid = raw && raw.questionId ? String(raw.questionId) : '';
    if (!ObjectId.isValid(qid)) {
      errors.push({ questionId: qid, message: '题目 ID 格式不正确' });
      continue;
    }
    if (!byId.has(qid)) {
      errors.push({ questionId: qid, message: '题目不属于这份问卷' });
      continue;
    }
    answerMap.set(qid, raw);
  }

  const answers = [];
  const path = [];
  const visited = new Set();
  let current = questions[0];

  while (current) {
    const key = current._id.toString();
    if (visited.has(key)) {
      errors.push({ questionId: key, message: '跳转规则形成了循环，无法完成填写' });
      break;
    }
    visited.add(key);
    path.push(current._id);

    const raw = answerMap.get(key);
    let answerDoc = null;

    if (raw === undefined || raw === null) {
      if (current.required) {
        errors.push({ questionId: key, message: '这是必答题' });
      }
    } else {
      const result = validateOne(current, raw);
      if (result.error) {
        errors.push(result.error);
      } else {
        answerDoc = result.doc;
        answers.push(answerDoc);
      }
    }

    current = nextQuestion(questions, byId, current, answerDoc);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, answers, path };
}

module.exports = { checkAnswers, jumpMatches, validateOne };
