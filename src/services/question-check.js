const { ObjectId } = require('mongodb');

const TYPES = ['single', 'multiple', 'text', 'number'];
const NUMBER_OPS = ['==', '!=', '>', '>=', '<', '<='];

function toIntOrNull(value, field, errors) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    errors.push(field + ' 必须是非负整数');
    return null;
  }
  return num;
}

function toNumberOrNull(value, field, errors) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    errors.push(field + ' 必须是数字');
    return null;
  }
  return num;
}

function normalizeOptions(input, errors) {
  if (!Array.isArray(input)) {
    errors.push('选项列表格式不正确');
    return [];
  }
  if (input.length < 2) errors.push('至少需要两个选项');
  if (input.length > 30) errors.push('选项不能超过 30 个');

  const used = new Set();
  const result = [];
  let autoIndex = 0;
  for (const item of input) {
    const label = typeof item === 'string' ? item : item && item.label;
    if (typeof label !== 'string' || label.trim() === '') {
      errors.push('选项内容不能为空');
      continue;
    }
    let key = item && typeof item.key === 'string' ? item.key.trim() : '';
    if (!key) {
      while (used.has(String.fromCharCode(65 + autoIndex))) autoIndex++;
      key = String.fromCharCode(65 + autoIndex);
      autoIndex++;
    }
    if (!/^[A-Za-z0-9]{1,4}$/.test(key)) {
      errors.push('选项编号只能是 1 到 4 位字母或数字');
      continue;
    }
    key = key.toUpperCase();
    if (used.has(key)) {
      errors.push('选项编号重复：' + key);
      continue;
    }
    used.add(key);
    result.push({ key, label: label.trim() });
  }
  return result;
}

function normalizeJumps(input, options, existingIds, selfId, errors) {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) {
    errors.push('跳转规则格式不正确');
    return [];
  }
  const optionKeys = new Set(options.map((o) => o.key));
  const result = [];

  for (const rule of input) {
    if (!rule || !rule.match || !rule.targetQuestionId) {
      errors.push('跳转规则缺少条件或目标题目');
      continue;
    }
    const targetId = String(rule.targetQuestionId);
    if (!ObjectId.isValid(targetId)) {
      errors.push('跳转目标题目的 ID 格式不正确');
      continue;
    }
    if (selfId && targetId === selfId) {
      errors.push('不能跳转到题目本身');
      continue;
    }
    if (!existingIds.has(targetId)) {
      errors.push('跳转目标题目不存在');
      continue;
    }

    const match = rule.match;
    let normalized;
    if (match.kind === 'option') {
      const keys = Array.isArray(match.keys) ? [...new Set(match.keys.map(String))] : [];
      if (keys.length === 0) {
        errors.push('选项跳转条件至少要选一个选项');
        continue;
      }
      const missing = keys.filter((k) => !optionKeys.has(k));
      if (missing.length > 0) {
        errors.push('跳转条件里的选项不存在：' + missing.join(','));
        continue;
      }
      normalized = { kind: 'option', keys, mode: match.mode === 'all' ? 'all' : 'any' };
    } else if (match.kind === 'number') {
      const op = NUMBER_OPS.includes(match.op) ? match.op : null;
      const value = Number(match.value);
      if (!op) {
        errors.push('数字跳转的运算符不支持');
        continue;
      }
      if (!Number.isFinite(value)) {
        errors.push('数字跳转的比较值必须是数字');
        continue;
      }
      normalized = { kind: 'number', op, value };
    } else {
      errors.push('未知的跳转条件类型');
      continue;
    }

    result.push({ targetQuestionId: new ObjectId(targetId), match: normalized });
  }
  return result;
}

function normalizeQuestion(payload, existingQuestions, selfId) {
  const errors = [];
  const type = payload && payload.type;
  if (!TYPES.includes(type)) {
    return { ok: false, errors: ['题型不正确'] };
  }
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title.length === 0 || title.length > 200) {
    errors.push('题目文字长度需在 1 到 200 字之间');
  }
  const required = Boolean(payload.required);

  const doc = {
    type,
    title,
    required,
    options: [],
    multiple: { minSelect: null, maxSelect: null },
    text: { minLength: null, maxLength: null },
    number: { min: null, max: null, integer: false },
    jumps: []
  };

  if (type === 'single' || type === 'multiple') {
    doc.options = normalizeOptions(payload.options, errors);
  }

  if (type === 'multiple') {
    const source = payload.multiple || {};
    const minSelect = toIntOrNull(source.minSelect, '最少选择数', errors);
    const maxSelect = toIntOrNull(source.maxSelect, '最多选择数', errors);
    if (minSelect !== null && maxSelect !== null && minSelect > maxSelect) {
      errors.push('最少选择数不能大于最多选择数');
    }
    if (maxSelect !== null && maxSelect > doc.options.length) {
      errors.push('最多选择数不能超过选项数量');
    }
    doc.multiple = { minSelect, maxSelect };
  }

  if (type === 'text') {
    const source = payload.text || {};
    const minLength = toIntOrNull(source.minLength, '最少字数', errors);
    const maxLength = toIntOrNull(source.maxLength, '最多字数', errors);
    if (minLength !== null && maxLength !== null && minLength > maxLength) {
      errors.push('最少字数不能大于最多字数');
    }
    if (maxLength !== null && maxLength > 5000) {
      errors.push('最多字数不能超过 5000');
    }
    doc.text = { minLength, maxLength };
  }

  if (type === 'number') {
    const source = payload.number || {};
    const min = toNumberOrNull(source.min, '最小值', errors);
    const max = toNumberOrNull(source.max, '最大值', errors);
    if (min !== null && max !== null && min > max) {
      errors.push('最小值不能大于最大值');
    }
    doc.number = { min, max, integer: Boolean(source.integer) };
  }

  const existingIds = new Set(existingQuestions.map((q) => q._id.toString()));
  doc.jumps = normalizeJumps(payload.jumps, doc.options, existingIds, selfId, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, doc };
}

module.exports = { normalizeQuestion };
