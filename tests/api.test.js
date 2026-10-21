const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');

const { connect, getDb, close } = require('../src/db');
const { initDatabase } = require('../scripts/init-db');
const { createApp } = require('../src/app');

let mongod;
let app;

let owner;
let filler1;
let filler2;
let outsider;

let surveyId;
const q = {};

const SINGLE = {
  type: 'single',
  title: '你的性别',
  required: true,
  options: [
    { key: 'A', label: '男' },
    { key: 'B', label: '女' }
  ]
};

const MULTIPLE = {
  type: 'multiple',
  title: '你喜欢的水果',
  required: true,
  options: [
    { key: 'A', label: '苹果' },
    { key: 'B', label: '香蕉' },
    { key: 'C', label: '西瓜' },
    { key: 'D', label: '葡萄' }
  ],
  multiple: { minSelect: 2, maxSelect: 3 }
};

const NUMBER = {
  type: 'number',
  title: '你的年龄',
  required: true,
  number: { min: 0, max: 120, integer: true }
};

const TEXT = {
  type: 'text',
  title: '简单说一下你的建议',
  required: true,
  text: { minLength: 2, maxLength: 20 }
};

const LAST = {
  type: 'single',
  title: '你平时会参加运动吗',
  required: false,
  options: [
    { key: 'A', label: '会' },
    { key: 'B', label: '不会' }
  ]
};

function post(path, agent, body) {
  return agent.post(path).send(body);
}

function assertStatus(res, status) {
  assert.equal(res.status, status, '期望 ' + status + '，实际 ' + res.status + '，返回：' + JSON.stringify(res.body));
  return res.body;
}

async function addQuestion(payload) {
  const res = await post('/api/surveys/' + surveyId + '/questions', owner, payload);
  const body = assertStatus(res, 201);
  return body.question._id;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await connect(mongod.getUri(), 'survey_test');
  await initDatabase(getDb());
  app = createApp();

  owner = request.agent(app);
  filler1 = request.agent(app);
  filler2 = request.agent(app);
  outsider = request.agent(app);
});

after(async () => {
  await close();
  if (mongod) await mongod.stop();
});

test('未登录不能访问问卷接口', async () => {
  const res = await post('/api/surveys', request(app), { title: '测试' });
  assertStatus(res, 401);
});

test('注册、重复注册、登录失败与登录成功', async () => {
  assertStatus(await post('/api/auth/register', owner, { username: 'owner01', password: '123456' }), 201);
  assertStatus(await post('/api/auth/register', filler1, { username: 'filler01', password: '123456' }), 201);
  assertStatus(await post('/api/auth/register', filler2, { username: 'filler02', password: '123456' }), 201);
  assertStatus(await post('/api/auth/register', outsider, { username: 'other01', password: '123456' }), 201);

  assertStatus(await post('/api/auth/register', request(app), { username: 'owner01', password: '123456' }), 409);

  const shortPwd = await post('/api/auth/register', request(app), { username: 'abc123', password: '123' });
  assertStatus(shortPwd, 400);

  const wrong = await post('/api/auth/login', request(app), { username: 'owner01', password: 'badpass' });
  assertStatus(wrong, 401);

  const me = await owner.get('/api/auth/me');
  assert.equal(assertStatus(me, 200).user.username, 'owner01');
});

test('创建问卷并添加题目', async () => {
  const created = assertStatus(
    await post('/api/surveys', owner, {
      title: '健康状况小调查',
      description: '麻烦大家抽两分钟填一下',
      allowAnonymous: true
    }),
    201
  );
  surveyId = created.survey._id;
  assert.equal(created.survey.status, 'draft');

  const emptyPublish = await post('/api/surveys/' + surveyId + '/publish', owner);
  assertStatus(emptyPublish, 400);

  q.single = await addQuestion(SINGLE);
  q.multiple = await addQuestion(MULTIPLE);
  q.number = await addQuestion(NUMBER);
  q.text = await addQuestion(TEXT);
  q.last = await addQuestion(LAST);

  const detail = assertStatus(await owner.get('/api/surveys/' + surveyId), 200);
  assert.equal(detail.questions.length, 5);
  assert.deepEqual(detail.questions.map((item) => item.order), [1, 2, 3, 4, 5]);

  // 选项编号重复应该被拒绝
  const badOptions = await post('/api/surveys/' + surveyId + '/questions', owner, {
    type: 'single',
    title: '重复编号',
    required: false,
    options: [
      { key: 'A', label: '一' },
      { key: 'A', label: '二' }
    ]
  });
  assertStatus(badOptions, 400);

  // 多选题的最少选择数不能大于最多选择数
  const badRange = await post('/api/surveys/' + surveyId + '/questions', owner, {
    type: 'multiple',
    title: '范围错误',
    required: false,
    options: [{ label: '甲' }, { label: '乙' }],
    multiple: { minSelect: 2, maxSelect: 1 }
  });
  assertStatus(badRange, 400);
});

test('设置跳转规则并发布问卷', async () => {
  // 第 1 题选 A 直接跳到第 5 题
  assertStatus(
    await owner.put('/api/surveys/' + surveyId + '/questions/' + q.single).send({
      ...SINGLE,
      jumps: [{ targetQuestionId: q.last, match: { kind: 'option', keys: ['A'], mode: 'any' } }]
    }),
    200
  );

  // 第 2 题同时选中 A、B 时跳到第 5 题
  assertStatus(
    await owner.put('/api/surveys/' + surveyId + '/questions/' + q.multiple).send({
      ...MULTIPLE,
      jumps: [{ targetQuestionId: q.last, match: { kind: 'option', keys: ['A', 'B'], mode: 'all' } }]
    }),
    200
  );

  // 第 3 题填 100 时跳到第 5 题
  assertStatus(
    await owner.put('/api/surveys/' + surveyId + '/questions/' + q.number).send({
      ...NUMBER,
      jumps: [{ targetQuestionId: q.last, match: { kind: 'number', op: '==', value: 100 } }]
    }),
    200
  );

  const detail = assertStatus(await owner.get('/api/surveys/' + surveyId), 200);
  assert.equal(detail.questions[0].jumps.length, 1);
  assert.equal(detail.questions[1].jumps[0].match.mode, 'all');

  assertStatus(await post('/api/surveys/' + surveyId + '/publish', owner), 200);

  // 已发布的问卷不能再改题目
  assertStatus(await post('/api/surveys/' + surveyId + '/questions', owner, SINGLE), 400);
  assertStatus(await post('/api/surveys/' + surveyId + '/publish', owner), 400);
});

test('填写人登录后可以获取问卷', async () => {
  const data = assertStatus(await filler1.get('/api/public/surveys/' + surveyId), 200);
  assert.equal(data.questions.length, 5);
  assert.equal(data.survey.title, '健康状况小调查');
});

test('单选跳转：选 A 直接跳到第 5 题', async () => {
  const submitted = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['A'] },
      // 客户端多传了被跳过的题目，服务端应该忽略
      { questionId: q.number, value: 30 }
    ]
  });
  const body = assertStatus(submitted, 201);

  const response = await getDb().collection('responses').findOne({ _id: new ObjectId(body.responseId) });
  assert.equal(response.answers.length, 1);
  assert.deepEqual(response.path.map((id) => id.toString()), [q.single, q.last]);
});

test('多选跳转与数字跳转', async () => {
  // 第 1 题选 B，第 2 题同时选 A、B，触发跳到第 5 题
  const first = await post('/api/public/surveys/' + surveyId + '/responses', filler2, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'B'] },
      { questionId: q.last, optionKeys: ['A'] }
    ]
  });
  assertStatus(first, 201);

  // 第 1 题选 B，第 2 题选 A、C，第 3 题填 100，触发跳到第 5 题
  const second = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'C'] },
      { questionId: q.number, value: 100 },
      { questionId: q.last, optionKeys: ['B'] }
    ]
  });
  const body = assertStatus(second, 201);

  const response = await getDb().collection('responses').findOne({ _id: new ObjectId(body.responseId) });
  assert.deepEqual(response.path.map((id) => id.toString()), [q.single, q.multiple, q.number, q.last]);
  assert.equal(response.answers.length, 4);
});

test('填写校验：必答、选项、多选数量、数字、文本', async () => {
  const noRequired = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: []
  });
  assertStatus(noRequired, 400);
  assert.match(noRequired.body.error, /必答/);

  const badOption = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [{ questionId: q.single, optionKeys: ['Z'] }]
  });
  assertStatus(badOption, 400);

  const tooFew = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A'] },
      { questionId: q.number, value: 20 },
      { questionId: q.text, value: '挺好的' }
    ]
  });
  assertStatus(tooFew, 400);
  assert.match(tooFew.body.error, /至少需要选择 2 个/);

  const notInteger = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'C'], value: '' },
      { questionId: q.number, value: 23.5 },
      { questionId: q.text, value: '挺好的' }
    ]
  });
  assertStatus(notInteger, 400);
  assert.match(notInteger.body.error, /整数/);

  const outOfRange = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'C'] },
      { questionId: q.number, value: 200 },
      { questionId: q.text, value: '挺好的' }
    ]
  });
  assertStatus(outOfRange, 400);
  assert.match(outOfRange.body.error, /不能大于 120/);

  const tooShort = await post('/api/public/surveys/' + surveyId + '/responses', filler1, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'C'] },
      { questionId: q.number, value: 20 },
      { questionId: q.text, value: '好' }
    ]
  });
  assertStatus(tooShort, 400);
  assert.match(tooShort.body.error, /至少需要输入 2 个字/);
});

test('提交成功后可查看统计', async () => {
  const totalResponses = await getDb().collection('responses').countDocuments({ surveyId: new ObjectId(surveyId) });
  assert.equal(totalResponses, 3);

  const stats = assertStatus(await owner.get('/api/surveys/' + surveyId + '/stats'), 200);
  assert.equal(stats.totalResponses, 3);

  const single = stats.questions.find((item) => item.questionId === q.single);
  const countOf = (key) => single.options.find((option) => option.key === key).count;
  assert.equal(countOf('A'), 1);
  assert.equal(countOf('B'), 2);

  const multiple = stats.questions.find((item) => item.questionId === q.multiple);
  assert.equal(multiple.options.find((option) => option.key === 'A').count, 2);
  assert.equal(multiple.options.find((option) => option.key === 'B').count, 1);
  assert.equal(multiple.options.find((option) => option.key === 'C').count, 1);
  assert.equal(multiple.answered, 2);

  const number = stats.questions.find((item) => item.questionId === q.number);
  assert.equal(number.number.count, 1);
  assert.equal(number.number.avg, 100);

  const text = stats.questions.find((item) => item.questionId === q.text);
  assert.equal(text.answered, 0);

  const oneQuestion = assertStatus(
    await owner.get('/api/surveys/' + surveyId + '/stats/questions/' + q.multiple),
    200
  );
  assert.equal(oneQuestion.stat.questionId, q.multiple);

  // 不是创建者，看不到统计
  assertStatus(await outsider.get('/api/surveys/' + surveyId + '/stats'), 404);
});

test('匿名填写不保存填写人', async () => {
  const res = await post('/api/public/surveys/' + surveyId + '/responses', filler2, {
    answers: [
      { questionId: q.single, optionKeys: ['B'] },
      { questionId: q.multiple, optionKeys: ['A', 'D'] },
      { questionId: q.number, value: 40 },
      { questionId: q.text, value: '匿名回答' }
    ],
    anonymous: true
  });
  const body = assertStatus(res, 201);
  const response = await getDb().collection('responses').findOne({ _id: new ObjectId(body.responseId) });
  assert.equal(response.anonymous, true);
  assert.equal(response.respondentId, null);
});

test('关闭问卷后不能再填写', async () => {
  assertStatus(await post('/api/surveys/' + surveyId + '/close', owner), 200);
  const res = await filler1.get('/api/public/surveys/' + surveyId);
  assertStatus(res, 403);
});

test('不允许匿名时拒绝匿名提交', async () => {
  const created = assertStatus(
    await post('/api/surveys', owner, {
      title: '实名问卷',
      allowAnonymous: false
    }),
    201
  );
  const id = created.survey._id;
  const qid = await addQuestionTo(id, SINGLE);
  assertStatus(await post('/api/surveys/' + id + '/publish', owner), 200);

  const res = await post('/api/public/surveys/' + id + '/responses', filler1, {
    answers: [{ questionId: qid, optionKeys: ['A'] }],
    anonymous: true
  });
  assertStatus(res, 400);
  assert.match(res.body.error, /不允许匿名/);
});

async function addQuestionTo(id, payload) {
  const res = await post('/api/surveys/' + id + '/questions', owner, payload);
  return assertStatus(res, 201).question._id;
}

test('删除题目时清理指向它的跳转', async () => {
  const created = assertStatus(
    await post('/api/surveys', owner, { title: '删除测试', allowAnonymous: false }),
    201
  );
  const id = created.survey._id;
  const first = await addQuestionTo(id, SINGLE);
  const second = await addQuestionTo(id, LAST);

  assertStatus(
    await owner.put('/api/surveys/' + id + '/questions/' + first).send({
      ...SINGLE,
      jumps: [{ targetQuestionId: second, match: { kind: 'option', keys: ['A'], mode: 'any' } }]
    }),
    200
  );

  assertStatus(await owner.delete('/api/surveys/' + id + '/questions/' + second), 200);

  const detail = assertStatus(await owner.get('/api/surveys/' + id), 200);
  assert.equal(detail.questions.length, 1);
  assert.equal(detail.questions[0].jumps.length, 0);
});
