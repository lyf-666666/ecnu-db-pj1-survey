const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { connect, getDb, close } = require('../src/db');
const { initDatabase } = require('../scripts/init-db');
const { createApp } = require('../src/app');

let mongod;
let app;
let alice;
let bob;

let rootId;
let surveyA;
let surveyB;
let questionA;
let questionB;

const CONTENT = {
  type: 'single',
  title: '你最常用的编程语言',
  options: [
    { key: 'A', label: '男' },
    { key: 'B', label: '女' }
  ]
};

function assertStatus(res, status) {
  assert.equal(res.status, status, '期望 ' + status + '，实际 ' + res.status + '，返回：' + JSON.stringify(res.body));
  return res.body;
}

async function createSurvey(agent, title) {
  const body = assertStatus(
    await agent.post('/api/surveys').send({ title, description: '', allowAnonymous: true }),
    201
  );
  return body.survey._id;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await connect(mongod.getUri(), 'survey_phase2_test');
  await initDatabase(getDb());
  app = createApp();

  alice = request.agent(app);
  bob = request.agent(app);
  assertStatus(await alice.post('/api/auth/register').send({ username: 'alice01', password: '123456' }), 201);
  assertStatus(await bob.post('/api/auth/register').send({ username: 'bob0001', password: '123456' }), 201);
});

after(async () => {
  await close();
  if (mongod) await mongod.stop();
});

test('新建题目会同时生成题目本体和第 1 版', async () => {
  const body = assertStatus(await alice.post('/api/questions').send(CONTENT), 201);
  rootId = body.rootId;

  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  assert.equal(detail.versions.length, 1);
  assert.equal(detail.versions[0].versionNo, 1);
  assert.equal(detail.versions[0].parentVersionId, null);
  assert.equal(detail.current.title, CONTENT.title);

  const list = assertStatus(await alice.get('/api/questions'), 200);
  assert.equal(list.questions.length, 1);
  assert.equal(list.questions[0].versionNo, 1);
  assert.equal(list.questions[0].usageCount, 0);
});

test('修改题目只新增版本，旧版本内容原样保留', async () => {
  const before = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  const v1 = before.versions[0];

  const changed = assertStatus(
    await alice.put('/api/questions/' + rootId).send({ ...CONTENT, title: '你最常用的编程语言（修订）' }),
    200
  );
  assert.equal(changed.versionNo, 2);

  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  assert.equal(detail.versions.length, 2);
  const v2 = detail.versions[1];
  assert.equal(String(v2.parentVersionId), String(v1._id));
  assert.equal(v2.title, '你最常用的编程语言（修订）');

  const stillOld = detail.versions.find((item) => item.versionNo === 1);
  assert.equal(stillOld.title, CONTENT.title);
});

test('两份问卷可以分别使用同一题目的不同版本', async () => {
  surveyA = await createSurvey(alice, '问卷 A');
  surveyB = await createSurvey(alice, '问卷 B');

  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  const v1 = detail.versions.find((item) => item.versionNo === 1);

  const inA = assertStatus(
    await alice.post('/api/surveys/' + surveyA + '/questions').send({ rootId, versionId: v1._id, required: true }),
    201
  );
  questionA = inA.question._id;
  assert.equal(inA.question.title, CONTENT.title);
  assert.equal(inA.question.versionNo, 1);
  assert.equal(inA.question.fromBank, true);

  const inB = assertStatus(
    await alice.post('/api/surveys/' + surveyB + '/questions').send({ rootId }),
    201
  );
  questionB = inB.question._id;
  assert.equal(inB.question.versionNo, 2);
  assert.equal(inB.question.title, '你最常用的编程语言（修订）');
});

test('在问卷里改题会分叉出新版本，另一份问卷不受影响', async () => {
  const body = assertStatus(
    await alice
      .put('/api/surveys/' + surveyA + '/questions/' + questionA)
      .send({ ...CONTENT, title: '只给问卷 A 用的问法' }),
    200
  );
  assert.equal(body.question.versionNo, 3);

  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  assert.equal(detail.versions.length, 3);
  const v3 = detail.versions[2];
  assert.equal(String(v3.parentVersionId), String(detail.versions[0]._id));
  assert.equal(v3.title, '只给问卷 A 用的问法');

  const b = assertStatus(await alice.get('/api/surveys/' + surveyB), 200);
  assert.equal(b.questions[0].title, '你最常用的编程语言（修订）');
  assert.equal(b.questions[0].versionNo, 2);
  assert.equal(b.questions[0].latestVersionNo, 3);
});

test('已发布问卷的题目不能改，题库再改也不影响它的内容', async () => {
  assertStatus(await alice.post('/api/surveys/' + surveyB + '/publish').send({}), 200);

  const denied = await alice
    .put('/api/surveys/' + surveyB + '/questions/' + questionB)
    .send({ ...CONTENT, title: '发布后偷偷改' });
  assertStatus(denied, 400);

  assertStatus(
    await alice.put('/api/questions/' + rootId).send({ ...CONTENT, title: '题库里改成最终版' }),
    200
  );

  const b = assertStatus(await alice.get('/api/surveys/' + surveyB), 200);
  assert.equal(b.questions[0].title, '你最常用的编程语言（修订）');
  assert.equal(b.questions[0].frozen, true);

  const sync = await alice.post('/api/surveys/' + surveyB + '/questions/' + questionB + '/sync').send({});
  assertStatus(sync, 400);
});

test('草稿问卷可以手动同步到题库最新版', async () => {
  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  const latestNo = detail.root.latestVersionNo;

  const synced = assertStatus(
    await alice.post('/api/surveys/' + surveyA + '/questions/' + questionA + '/sync').send({}),
    200
  );
  assert.equal(synced.question.versionNo, latestNo);
  assert.equal(synced.question.title, '题库里改成最终版');
  assert.deepEqual(synced.question.jumps, []);
});

test('可以恢复旧版本，恢复动作本身也是一个新版本', async () => {
  const before = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  const v2 = before.versions.find((item) => item.versionNo === 2);
  const beforeCount = before.versions.length;

  const restored = assertStatus(
    await alice.post('/api/questions/' + rootId + '/versions/' + v2._id + '/restore').send({}),
    201
  );
  assert.equal(restored.restoredFrom, 2);

  const after = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  assert.equal(after.versions.length, beforeCount + 1);
  const latest = after.versions[after.versions.length - 1];
  assert.equal(latest.title, v2.title);
  assert.equal(String(latest.parentVersionId), String(v2._id));
  assert.equal(latest.source, 'restore');
});

test('题目可以共享给其他用户，对方能用但不能改', async () => {
  const shared = assertStatus(await alice.post('/api/questions/' + rootId + '/share').send({ username: 'bob0001' }), 200);
  assert.ok(shared.userId);

  const bobList = assertStatus(await bob.get('/api/questions?scope=shared'), 200);
  assert.equal(bobList.questions.length, 1);
  assert.equal(bobList.questions[0].ownerName, 'alice01');

  const denied = await bob.put('/api/questions/' + rootId).send({ ...CONTENT, title: '别人改的' });
  assertStatus(denied, 403);

  const surveyC = await createSurvey(bob, '问卷 C');
  const inC = assertStatus(await bob.post('/api/surveys/' + surveyC + '/questions').send({ rootId }), 201);
  assert.ok(inC.question.rootId);
});

test('可以查看一道题被哪些问卷使用', async () => {
  const detail = assertStatus(await alice.get('/api/questions/' + rootId), 200);
  assert.equal(detail.usage.length, 3);
  const titles = detail.usage.map((item) => item.surveyTitle).sort();
  assert.deepEqual(titles, ['问卷 A', '问卷 B', '问卷 C']);
  assert.equal(detail.usage.filter((item) => item.isMine).length, 2);
});

test('题库可以创建、加入题目和移除题目', async () => {
  const created = assertStatus(await alice.post('/api/banks').send({ name: '常用题目', description: '平时攒的题' }), 201);
  const bankId = created.bank._id;

  assertStatus(await alice.post('/api/banks/' + bankId + '/items').send({ rootId }), 201);

  const detail = assertStatus(await alice.get('/api/banks/' + bankId), 200);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].title, '你最常用的编程语言（修订）');
  assert.equal(detail.items[0].versionNo, 5);

  const list = assertStatus(await alice.get('/api/banks'), 200);
  assert.equal(list.banks[0].itemCount, 1);

  const inBank = assertStatus(await alice.get('/api/questions?bankId=' + bankId), 200);
  assert.equal(inBank.questions.length, 1);

  assertStatus(await alice.delete('/api/banks/' + bankId + '/items/' + rootId), 200);
  const empty = assertStatus(await alice.get('/api/banks/' + bankId), 200);
  assert.equal(empty.items.length, 0);
});

test('单题统计可以跨问卷合并回答', async () => {
  const b = assertStatus(await alice.get('/api/surveys/' + surveyB), 200);
  const qid = b.questions[0]._id;

  for (const key of ['A', 'A']) {
    assertStatus(
      await bob.post('/api/public/surveys/' + surveyB + '/responses').send({
        anonymous: true,
        answers: [{ questionId: qid, type: 'single', optionKeys: [key] }]
      }),
      201
    );
  }

  const stats = assertStatus(await alice.get('/api/questions/' + rootId + '/stats'), 200);
  assert.equal(stats.answered, 2);
  assert.equal(stats.surveyCount, 2);
  assert.deepEqual(stats.options, [{ label: '男', count: 2, percent: 100 }]);
  assert.ok(stats.versions.some((item) => item.versionNo === 2 && item.answered === 2));
});

test('他人的题目不会出现在我的题目列表里', async () => {
  const list = assertStatus(await bob.get('/api/questions'), 200);
  const owned = list.questions.filter((item) => item.isOwner);
  assert.equal(owned.length, 0);
});
