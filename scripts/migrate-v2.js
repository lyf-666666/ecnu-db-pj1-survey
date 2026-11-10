// 第一阶段的数据里，题目内容是直接存在 questions 文档里的，没有版本概念。
// 这个脚本把每道老题补成“题目本体 + 第 1 版”，之后就能正常参与版本管理和跨问卷统计。
const { ObjectId } = require('mongodb');
const { connect, getDb, close } = require('../src/db');
const { initDatabase } = require('./init-db');

function contentOf(question) {
  return {
    type: question.type,
    title: question.title,
    options: question.options || [],
    multiple: question.multiple || { minSelect: null, maxSelect: null },
    text: question.text || { minLength: null, maxLength: null },
    number: question.number || { min: null, max: null, integer: false }
  };
}

async function migrate() {
  const db = getDb();
  const questions = await db.collection('questions').find({ rootId: { $exists: false } }).toArray();
  if (questions.length === 0) {
    console.log('没有需要迁移的题目');
    return;
  }

  const surveyIds = [...new Set(questions.map((item) => item.surveyId.toString()))].map((id) => new ObjectId(id));
  const surveys = await db.collection('surveys').find({ _id: { $in: surveyIds } }).toArray();
  const statusMap = new Map(surveys.map((survey) => [survey._id.toString(), survey.status]));

  let count = 0;
  for (const question of questions) {
    const now = new Date();
    const rootId = new ObjectId();
    const versionId = new ObjectId();
    const ownerId = question.ownerId || null;

    // 老数据里没有 owner，只能从问卷上取
    const survey = surveys.find((item) => item._id.equals(question.surveyId));

    await db.collection('question_versions').insertOne({
      _id: versionId,
      rootId,
      ownerId: ownerId || (survey ? survey.ownerId : question.surveyId),
      versionNo: 1,
      parentVersionId: null,
      source: 'create',
      changeNote: '第一阶段数据迁移',
      ...contentOf(question),
      createdAt: question.createdAt || now
    });

    await db.collection('question_roots').insertOne({
      _id: rootId,
      ownerId: ownerId || (survey ? survey.ownerId : question.surveyId),
      latestVersionId: versionId,
      latestVersionNo: 1,
      sharedWith: [],
      createdAt: question.createdAt || now,
      updatedAt: now
    });

    await db.collection('questions').updateOne(
      { _id: question._id },
      {
        $set: {
          rootId,
          versionId,
          versionNo: 1,
          fromBank: false,
          frozen: statusMap.get(question.surveyId.toString()) !== 'draft'
        }
      }
    );
    count += 1;
  }
  console.log('已迁移题目 ' + count + ' 道');
}

if (require.main === module) {
  require('dotenv').config();
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.DB_NAME || 'survey_db';
  connect(uri, dbName)
    .then((db) => initDatabase(db))
    .then(() => migrate())
    .then(() => console.log('第二阶段数据迁移完成'))
    .catch((err) => {
      console.error('迁移失败：', err.message);
      process.exitCode = 1;
    })
    .finally(() => close());
}

module.exports = { migrate };
