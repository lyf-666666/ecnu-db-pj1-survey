const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { normalizeQuestion } = require('../services/question-check');

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
    const questions = await getDb()
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();
    res.json({ survey, questions });
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
    await getDb().collection('surveys').updateOne(
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
    const result = normalizeQuestion(req.body, questions, null);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    const order = questions.length === 0 ? 1 : questions[questions.length - 1].order + 1;
    const doc = {
      ...result.doc,
      surveyId: survey._id,
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
    await getDb().collection('questions').updateOne({ _id: qid }, { $set: update });
    const updated = await getDb().collection('questions').findOne({ _id: qid });
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
