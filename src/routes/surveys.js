const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { normalizeQuestion } = require('../services/question-check');
const {
  pickContent,
  sameContent,
  createRootWithVersion,
  addVersion,
  latestVersion,
  findVersion,
  loadAccessibleRoot
} = require('../services/question-catalog');

const router = express.Router();
router.use(requireLogin);

async function findOwnedSurvey(req, res) {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: '问卷 ID 不正确' });
    return null;
  }
  const survey = await getDb()
    .collection('surveys')
    .findOne({ _id: new ObjectId(id), ownerId: new ObjectId(req.session.userId) });
  if (!survey) {
    res.status(404).json({ error: '问卷不存在，或不属于当前用户' });
    return null;
  }
  return survey;
}

function parseDeadline(input, errors) {
  if (input === null || input === undefined || input === '') return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    errors.push('截止时间格式不正确');
    return null;
  }
  return date;
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const ownerId = new ObjectId(req.session.userId);
    const surveys = await db.collection('surveys').find({ ownerId }).sort({ createdAt: -1 }).toArray();
    const ids = surveys.map((s) => s._id);
    if (ids.length === 0) return res.json({ surveys: [] });

    const [questionCounts, responseCounts] = await Promise.all([
      db.collection('questions').aggregate([
        { $match: { surveyId: { $in: ids } } },
        { $group: { _id: '$surveyId', count: { $sum: 1 } } }
      ]).toArray(),
      db.collection('responses').aggregate([
        { $match: { surveyId: { $in: ids } } },
        { $group: { _id: '$surveyId', count: { $sum: 1 } } }
      ]).toArray()
    ]);

    const qMap = new Map(questionCounts.map((row) => [row._id.toString(), row.count]));
    const rMap = new Map(responseCounts.map((row) => [row._id.toString(), row.count]));

    res.json({
      surveys: surveys.map((survey) => ({
        ...survey,
        questionCount: qMap.get(survey._id.toString()) || 0,
        responseCount: rMap.get(survey._id.toString()) || 0
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const errors = [];
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!title || title.length > 80) errors.push('问卷标题长度需在 1 到 80 字之间');
    if (description.length > 1000) errors.push('问卷说明不能超过 1000 字');
    const deadline = parseDeadline(req.body.deadline, errors);
    if (deadline && deadline.getTime() <= Date.now()) errors.push('截止时间需要晚于当前时间');

    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

    const doc = {
      ownerId: new ObjectId(req.session.userId),
      title,
      description,
      allowAnonymous: Boolean(req.body.allowAnonymous),
      status: 'draft',
      deadline,
      createdAt: new Date(),
      publishedAt: null,
      closedAt: null
    };
    const result = await getDb().collection('surveys').insertOne(doc);
    res.status(201).json({ survey: { ...doc, _id: result.insertedId } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    const db = getDb();
    const questions = await db
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();

    // 顺带把题库里的最新版本号带回去，编辑页才能提示“有新版本可用”
    const rootIds = questions.map((question) => question.rootId).filter(Boolean);
    const roots = rootIds.length
      ? await db.collection('question_roots').find({ _id: { $in: rootIds } }).toArray()
      : [];
    const rootMap = new Map(roots.map((root) => [root._id.toString(), root]));

    res.json({
      survey,
      questions: questions.map((question) => {
        const root = question.rootId ? rootMap.get(question.rootId.toString()) : null;
        return {
          ...question,
          latestVersionNo: root ? root.latestVersionNo : question.versionNo || null
        };
      })
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status === 'closed') {
      return res.status(400).json({ error: '问卷已关闭，不能再修改' });
    }

    const errors = [];
    const update = {};
    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title || title.length > 80) errors.push('问卷标题长度需在 1 到 80 字之间');
      update.title = title;
    }
    if (req.body.description !== undefined) {
      const description = String(req.body.description).trim();
      if (description.length > 1000) errors.push('问卷说明不能超过 1000 字');
      update.description = description;
    }
    if (req.body.allowAnonymous !== undefined) {
      update.allowAnonymous = Boolean(req.body.allowAnonymous);
    }
    if (req.body.deadline !== undefined) {
      update.deadline = parseDeadline(req.body.deadline, errors);
    }
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });
    if (Object.keys(update).length === 0) return res.status(400).json({ error: '没有需要修改的内容' });

    await getDb().collection('surveys').updateOne({ _id: survey._id }, { $set: update });
    const updated = await getDb().collection('surveys').findOne({ _id: survey._id });
    res.json({ survey: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status === 'published') return res.status(400).json({ error: '问卷已经发布过了' });
    if (survey.status === 'closed') return res.status(400).json({ error: '问卷已关闭' });

    const questionCount = await getDb().collection('questions').countDocuments({ surveyId: survey._id });
    if (questionCount === 0) return res.status(400).json({ error: '问卷至少需要一道题目才能发布' });
    if (survey.deadline && survey.deadline.getTime() <= Date.now()) {
      return res.status(400).json({ error: '截止时间已经过去，请先修改截止时间' });
    }

    const now = new Date();
    const db = getDb();
    // 发布时把题目快照标记为冻结。之后题库里再怎么改版本，
    // 这份问卷看到的仍然是发布那一刻的内容。
    await db.collection('questions').updateMany({ surveyId: survey._id }, { $set: { frozen: true } });
    await db.collection('surveys').updateOne(
      { _id: survey._id },
      { $set: { status: 'published', publishedAt: now } }
    );
    res.json({ ok: true, status: 'published', publishedAt: now });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/close', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status !== 'published') return res.status(400).json({ error: '只有已发布的问卷才能关闭' });
    const now = new Date();
    await getDb().collection('surveys').updateOne(
      { _id: survey._id },
      { $set: { status: 'closed', closedAt: now } }
    );
    res.json({ ok: true, status: 'closed', closedAt: now });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/questions', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status !== 'draft') {
      return res.status(400).json({ error: '问卷发布后不能再添加题目' });
    }

    const questions = await getDb()
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();

    let root;
    let version = null;
    if (req.body.rootId) {
      const access = await loadAccessibleRoot(req.body.rootId, req.session.userId);
      if (access.error) return res.status(access.status).json({ error: access.error });
      root = access.root;
      version = req.body.versionId
        ? await findVersion(root._id, req.body.versionId)
        : await latestVersion(root);
      if (!version) return res.status(404).json({ error: '要使用的题目版本不存在' });
    }

    const source = version ? { ...pickContent(version), required: req.body.required !== false } : req.body;
    const result = normalizeQuestion({ ...source, jumps: req.body.jumps }, questions, null);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    let rootId;
    let versionId;
    let versionNo;
    if (version) {
      rootId = root._id;
      versionId = version._id;
      versionNo = version.versionNo;
    } else {
      // 手写的题目也自动落一份到题库，之后可以复用、共享、看跨问卷统计
      const created = await createRootWithVersion(new ObjectId(req.session.userId), result.doc, '问卷中创建');
      rootId = created.root._id;
      versionId = created.versionId;
      versionNo = 1;
    }

    const order = questions.length === 0 ? 1 : questions[questions.length - 1].order + 1;
    const doc = {
      ...result.doc,
      surveyId: survey._id,
      rootId,
      versionId,
      versionNo,
      fromBank: Boolean(version),
      frozen: false,
      order,
      createdAt: new Date()
    };
    const inserted = await getDb().collection('questions').insertOne(doc);
    res.status(201).json({ question: { ...doc, _id: inserted.insertedId } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/questions/:qid', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status !== 'draft') {
      return res.status(400).json({ error: '问卷发布后不能再修改题目' });
    }
    if (!ObjectId.isValid(req.params.qid)) {
      return res.status(400).json({ error: '题目 ID 不正确' });
    }
    const qid = new ObjectId(req.params.qid);
    const questions = await getDb()
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();
    const existing = questions.find((q) => q._id.equals(qid));
    if (!existing) return res.status(404).json({ error: '题目不存在' });

    const result = normalizeQuestion(req.body, questions, req.params.qid);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    const update = {
      type: result.doc.type,
      title: result.doc.title,
      required: result.doc.required,
      options: result.doc.options,
      multiple: result.doc.multiple,
      text: result.doc.text,
      number: result.doc.number,
      jumps: result.doc.jumps
    };

    // 内容真的变了才生成新版本。只改必答或者跳转，不算改题。
    const currentVersion = existing.versionId
      ? await getDb().collection('question_versions').findOne({ _id: existing.versionId })
      : null;
    if (!currentVersion || !sameContent(currentVersion, result.doc)) {
      if (existing.rootId) {
        const root = await getDb().collection('question_roots').findOne({ _id: existing.rootId });
        if (root) {
          // 新版本的上一版就是“这份问卷当前用的那一版”，
          // 其他问卷继续用它们各自的老版本。
          const version = await addVersion(root, result.doc, {
            source: 'fork',
            parentVersionId: existing.versionId || root.latestVersionId,
            changeNote: '在问卷中修改'
          });
          update.versionId = version._id;
          update.versionNo = version.versionNo;
        }
      } else {
        const created = await createRootWithVersion(new ObjectId(req.session.userId), result.doc, '问卷中创建');
        update.rootId = created.root._id;
        update.versionId = created.versionId;
        update.versionNo = 1;
      }
    }

    await getDb().collection('questions').updateOne({ _id: qid }, { $set: update });
    const updated = await getDb().collection('questions').findOne({ _id: qid });
    res.json({ question: updated });
  } catch (err) {
    next(err);
  }
});

// 把某个题目换成题库里的最新版本。只对草稿生效，已发布问卷的内容保持原样。
router.post('/:id/questions/:qid/sync', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status !== 'draft') {
      return res.status(400).json({ error: '问卷发布后不能再修改题目' });
    }
    if (!ObjectId.isValid(req.params.qid)) {
      return res.status(400).json({ error: '题目 ID 不正确' });
    }
    const db = getDb();
    const question = await db
      .collection('questions')
      .findOne({ _id: new ObjectId(req.params.qid), surveyId: survey._id });
    if (!question) return res.status(404).json({ error: '题目不存在' });
    if (!question.rootId) return res.status(400).json({ error: '这道题还没有关联题库' });

    const root = await db.collection('question_roots').findOne({ _id: question.rootId });
    if (!root) return res.status(404).json({ error: '题目对应的题库记录不存在' });
    if (String(root.latestVersionId) === String(question.versionId)) {
      return res.status(400).json({ error: '已经是最新版本了' });
    }

    const version = await latestVersion(root);
    const update = {
      ...pickContent(version),
      versionId: version._id,
      versionNo: version.versionNo
    };

    // 换版本后原来的跳转条件可能失效（选项编号可能变了），一起清掉让用户重配
    await db
      .collection('questions')
      .updateOne({ _id: question._id }, { $set: { ...update, jumps: [] } });
    const updated = await db.collection('questions').findOne({ _id: question._id });
    res.json({ question: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/questions/:qid', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (survey.status !== 'draft') {
      return res.status(400).json({ error: '问卷发布后不能再删除题目' });
    }
    if (!ObjectId.isValid(req.params.qid)) {
      return res.status(400).json({ error: '题目 ID 不正确' });
    }
    const qid = new ObjectId(req.params.qid);
    const questions = getDb().collection('questions');

    const result = await questions.deleteOne({ _id: qid, surveyId: survey._id });
    if (result.deletedCount === 0) return res.status(404).json({ error: '题目不存在' });

    // 其他题目的跳转可能在指向这道题，删除题目时要一起清掉，否则填写时会跳到空处
    await questions.updateMany(
      { surveyId: survey._id, 'jumps.targetQuestionId': qid },
      { $pull: { jumps: { targetQuestionId: qid } } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
