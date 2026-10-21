const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { surveyStats, questionStats } = require('../services/stats');

const router = express.Router();
router.use(requireLogin);

async function findOwnedSurvey(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: '问卷 ID 不正确' });
    return null;
  }
  const survey = await getDb()
    .collection('surveys')
    .findOne({ _id: new ObjectId(req.params.id), ownerId: new ObjectId(req.session.userId) });
  if (!survey) {
    res.status(404).json({ error: '问卷不存在，或不属于当前用户' });
    return null;
  }
  return survey;
}

router.get('/:id/stats', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    const data = await surveyStats(survey);
    res.json({ survey: { _id: survey._id, title: survey.title, status: survey.status }, ...data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/stats/questions/:qid', async (req, res, next) => {
  try {
    const survey = await findOwnedSurvey(req, res);
    if (!survey) return;
    if (!ObjectId.isValid(req.params.qid)) {
      return res.status(400).json({ error: '题目 ID 不正确' });
    }
    const question = await getDb()
      .collection('questions')
      .findOne({ _id: new ObjectId(req.params.qid), surveyId: survey._id });
    if (!question) return res.status(404).json({ error: '题目不存在' });
    res.json({ stat: await questionStats(survey._id, question) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
