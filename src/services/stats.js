const { ObjectId } = require('mongodb');
const { getDb } = require('../db');

async function questionStats(surveyId, question) {
  const db = getDb();
  const [facet] = await db
    .collection('responses')
    .aggregate([
      { $match: { surveyId } },
      { $unwind: '$answers' },
      { $match: { 'answers.questionId': question._id } },
      {
        $facet: {
          answered: [{ $count: 'count' }],
          optionCounts: [
            { $unwind: '$answers.optionKeys' },
            { $group: { _id: '$answers.optionKeys', count: { $sum: 1 } } }
          ],
          numbers: [
            { $match: { 'answers.numberValue': { $ne: null } } },
            {
              $group: {
                _id: null,
                avg: { $avg: '$answers.numberValue' },
                min: { $min: '$answers.numberValue' },
                max: { $max: '$answers.numberValue' },
                count: { $sum: 1 }
              }
            }
          ],
          texts: [
            { $match: { 'answers.value': { $ne: null } } },
            { $project: { _id: 0, value: '$answers.value', submittedAt: 1 } }
          ]
        }
      }
    ])
    .toArray();

  const answered = facet.answered[0] ? facet.answered[0].count : 0;
  const base = {
    questionId: question._id,
    title: question.title,
    type: question.type,
    order: question.order,
    answered
  };

  if (question.type === 'single' || question.type === 'multiple') {
    const counts = new Map(facet.optionCounts.map((row) => [row._id, row.count]));
    return {
      ...base,
      options: question.options.map((option) => {
        const count = counts.get(option.key) || 0;
        return {
          key: option.key,
          label: option.label,
          count,
          percent: answered === 0 ? 0 : Math.round((count / answered) * 1000) / 10
        };
      })
    };
  }

  if (question.type === 'number') {
    const row = facet.numbers[0];
    return {
      ...base,
      number: row
        ? {
            count: row.count,
            avg: Math.round(row.avg * 100) / 100,
            min: row.min,
            max: row.max
          }
        : { count: 0, avg: null, min: null, max: null }
    };
  }

  return {
    ...base,
    texts: facet.texts.map((item) => item.value)
  };
}

async function surveyStats(survey) {
  const db = getDb();
  const totalResponses = await db.collection('responses').countDocuments({ surveyId: survey._id });
  const questions = await db
    .collection('questions')
    .find({ surveyId: survey._id })
    .sort({ order: 1 })
    .toArray();

  const items = [];
  for (const question of questions) {
    items.push(await questionStats(survey._id, question));
  }
  return { totalResponses, questions: items };
}

// 跨问卷统计：只看当前用户自己名下的问卷。
// 选项按“选项文字”合并，因为同一个题目不同版本的编号可能对不上，
// 但用户在页面上看到的文字是一致的。
async function rootStats(rootId, userId) {
  const db = getDb();
  const allQuestions = await db.collection('questions').find({ rootId }).toArray();
  const surveyIds = [...new Set(allQuestions.map((q) => q.surveyId.toString()))].map((id) => new ObjectId(id));
  const surveys = await db
    .collection('surveys')
    .find({ _id: { $in: surveyIds }, ownerId: userId })
    .toArray();
  const surveyMap = new Map(surveys.map((s) => [s._id.toString(), s]));
  const mine = allQuestions.filter((q) => surveyMap.has(q.surveyId.toString()));

  const qidMap = new Map(mine.map((q) => [q._id.toString(), q]));
  const rows = mine.length
    ? await db
        .collection('responses')
        .aggregate([
          { $match: { surveyId: { $in: surveys.map((s) => s._id) } } },
          { $unwind: '$answers' },
          { $match: { 'answers.questionId': { $in: mine.map((q) => q._id) } } },
          { $project: { _id: 1, answer: '$answers' } }
        ])
        .toArray()
    : [];

  const answeredIds = new Set();
  const optionCounts = new Map();
  const texts = [];
  let numberCount = 0;
  let numberSum = 0;
  let numberMin = null;
  let numberMax = null;
  const perQuestion = new Map();
  const perVersion = new Map();

  for (const row of rows) {
    const question = qidMap.get(row.answer.questionId.toString());
    if (!question) continue;
    answeredIds.add(row._id.toString());

    const qidKey = question._id.toString();
    if (!perQuestion.has(qidKey)) perQuestion.set(qidKey, new Set());
    perQuestion.get(qidKey).add(row._id.toString());

    const versionKey = String(question.versionNo);
    if (!perVersion.has(versionKey)) perVersion.set(versionKey, new Set());
    perVersion.get(versionKey).add(row._id.toString());

    if (question.type === 'single' || question.type === 'multiple') {
      const labels = new Map((question.options || []).map((option) => [option.key, option.label]));
      for (const key of row.answer.optionKeys || []) {
        const label = labels.get(key) || key;
        optionCounts.set(label, (optionCounts.get(label) || 0) + 1);
      }
    } else if (question.type === 'number') {
      const value = row.answer.numberValue;
      if (value !== null && value !== undefined) {
        numberCount += 1;
        numberSum += value;
        numberMin = numberMin === null ? value : Math.min(numberMin, value);
        numberMax = numberMax === null ? value : Math.max(numberMax, value);
      }
    } else if (row.answer.value) {
      texts.push(row.answer.value);
    }
  }

  const answered = answeredIds.size;
  const options = [...optionCounts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: answered === 0 ? 0 : Math.round((count / answered) * 1000) / 10
    }))
    .sort((a, b) => b.count - a.count);

  const bySurvey = new Map();
  for (const question of mine) {
    const key = question.surveyId.toString();
    if (!bySurvey.has(key)) bySurvey.set(key, []);
    bySurvey.get(key).push(question);
  }

  return {
    answered,
    surveyCount: surveys.length,
    surveys: surveys.map((survey) => {
      const list = bySurvey.get(survey._id.toString()) || [];
      const ids = new Set(list.map((q) => q._id.toString()));
      let count = 0;
      for (const [qid, responses] of perQuestion.entries()) {
        if (ids.has(qid)) count += responses.size;
      }
      return {
        _id: survey._id,
        title: survey.title,
        status: survey.status,
        versionNo: list.length ? list[0].versionNo : null,
        answered: count
      };
    }),
    options,
    number: {
      count: numberCount,
      avg: numberCount === 0 ? null : Math.round((numberSum / numberCount) * 100) / 100,
      min: numberMin,
      max: numberMax
    },
    texts,
    versions: [...perVersion.entries()]
      .map(([versionNo, set]) => ({ versionNo: Number(versionNo), answered: set.size }))
      .sort((a, b) => a.versionNo - b.versionNo)
  };
}

module.exports = { surveyStats, questionStats, rootStats };
