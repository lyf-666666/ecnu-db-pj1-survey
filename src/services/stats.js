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

module.exports = { surveyStats, questionStats };
