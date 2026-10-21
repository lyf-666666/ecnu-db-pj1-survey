const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { checkAnswers } = require('../services/answer-check');

const router = express.Router();
router.use(requireLogin);

async function findPublicSurvey(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: '问卷 ID 不正确' });
    return null;
  }
  const survey = await getDb().collection('surveys').findOne({ _id: new ObjectId(req.params.id) });
  if (!survey || survey.status === 'draft') {
    res.status(404).json({ error: '问卷不存在' });
    return null;
  }
  if (survey.status === 'closed') {
    res.status(403).json({ error: '问卷已经关闭' });
    return null;
  }
  if (survey.deadline && survey.deadline.getTime() <= Date.now()) {
    res.status(403).json({ error: '问卷已到截止时间' });
    return null;
  }
  return survey;
}

router.get('/:id', async (req, res, next) => {
  try {
    const survey = await findPublicSurvey(req, res);
    if (!survey) return;
    const questions = await getDb()
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();

    res.json({
      survey: {
        _id: survey._id,
        title: survey.title,
        description: survey.description,
        allowAnonymous: survey.allowAnonymous,
        deadline: survey.deadline,
        status: survey.status
      },
      questions
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/responses', async (req, res, next) => {
  try {
    const survey = await findPublicSurvey(req, res);
    if (!survey) return;

    const questions = await getDb()
      .collection('questions')
      .find({ surveyId: survey._id })
      .sort({ order: 1 })
      .toArray();
    if (questions.length === 0) {
      return res.status(400).json({ error: '问卷还没有题目' });
    }

    const result = checkAnswers(questions, req.body.answers);
    if (!result.ok) {
      return res.status(400).json({ error: result.errors[0].message, errors: result.errors });
    }

    const anonymous = Boolean(req.body.anonymous);
    if (anonymous && !survey.allowAnonymous) {
      return res.status(400).json({ error: '该问卷不允许匿名填写' });
    }

    const doc = {
      surveyId: survey._id,
      respondentId: anonymous ? null : new ObjectId(req.session.userId),
      anonymous,
      submittedAt: new Date(),
      path: result.path,
      answers: result.answers
    };
    const inserted = await getDb().collection('responses').insertOne(doc);
    res.status(201).json({ ok: true, responseId: inserted.insertedId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
