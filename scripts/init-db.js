const { connect, getDb, close } = require('../src/db');

const surveyValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ownerId', 'title', 'allowAnonymous', 'status', 'createdAt'],
    properties: {
      ownerId: { bsonType: 'objectId' },
      title: { bsonType: 'string', minLength: 1, maxLength: 80 },
      description: { bsonType: 'string', maxLength: 1000 },
      allowAnonymous: { bsonType: 'bool' },
      status: { enum: ['draft', 'published', 'closed'] },
      deadline: { bsonType: ['date', 'null'] },
      createdAt: { bsonType: 'date' },
      publishedAt: { bsonType: ['date', 'null'] },
      closedAt: { bsonType: ['date', 'null'] }
    }
  }
};

const optionSchema = {
  bsonType: 'object',
  required: ['key', 'label'],
  properties: {
    key: { bsonType: 'string' },
    label: { bsonType: 'string' }
  }
};

// 题目内容和题目实例共用的字段。版本表里存的是同一套结构。
const contentProperties = {
  type: { enum: ['single', 'multiple', 'text', 'number'] },
  title: { bsonType: 'string', minLength: 1, maxLength: 200 },
  options: { bsonType: 'array', maxItems: 30, items: optionSchema },
  multiple: {
    bsonType: 'object',
    properties: {
      minSelect: { bsonType: ['int', 'null'] },
      maxSelect: { bsonType: ['int', 'null'] }
    }
  },
  text: {
    bsonType: 'object',
    properties: {
      minLength: { bsonType: ['int', 'null'] },
      maxLength: { bsonType: ['int', 'null'] }
    }
  },
  number: {
    bsonType: 'object',
    properties: {
      min: { bsonType: ['double', 'int', 'null'] },
      max: { bsonType: ['double', 'int', 'null'] },
      integer: { bsonType: 'bool' }
    }
  }
};

const questionValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['surveyId', 'rootId', 'versionId', 'versionNo', 'order', 'type', 'title', 'required', 'createdAt'],
    properties: {
      surveyId: { bsonType: 'objectId' },
      rootId: { bsonType: 'objectId' },
      versionId: { bsonType: 'objectId' },
      versionNo: { bsonType: ['int', 'double'] },
      fromBank: { bsonType: 'bool' },
      frozen: { bsonType: 'bool' },
      order: { bsonType: 'int', minimum: 1 },
      required: { bsonType: 'bool' },
      ...contentProperties,
      jumps: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['targetQuestionId', 'match'],
          properties: {
            targetQuestionId: { bsonType: 'objectId' },
            match: { bsonType: 'object' }
          }
        }
      },
      createdAt: { bsonType: 'date' }
    }
  }
};

const questionRootValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ownerId', 'latestVersionId', 'latestVersionNo', 'sharedWith', 'createdAt', 'updatedAt'],
    properties: {
      ownerId: { bsonType: 'objectId' },
      latestVersionId: { bsonType: 'objectId' },
      latestVersionNo: { bsonType: ['int', 'double'] },
      sharedWith: { bsonType: 'array', items: { bsonType: 'objectId' } },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }
    }
  }
};

const questionVersionValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['rootId', 'ownerId', 'versionNo', 'source', 'createdAt'],
    properties: {
      rootId: { bsonType: 'objectId' },
      ownerId: { bsonType: 'objectId' },
      versionNo: { bsonType: ['int', 'double'], minimum: 1 },
      parentVersionId: { bsonType: ['objectId', 'null'] },
      source: { enum: ['create', 'edit', 'fork', 'restore'] },
      changeNote: { bsonType: 'string', maxLength: 200 },
      ...contentProperties,
      createdAt: { bsonType: 'date' }
    }
  }
};

const questionBankValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ownerId', 'name', 'createdAt', 'updatedAt'],
    properties: {
      ownerId: { bsonType: 'objectId' },
      name: { bsonType: 'string', minLength: 1, maxLength: 40 },
      description: { bsonType: 'string', maxLength: 200 },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }
    }
  }
};

const bankItemValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['bankId', 'rootId', 'addedAt'],
    properties: {
      bankId: { bsonType: 'objectId' },
      rootId: { bsonType: 'objectId' },
      addedAt: { bsonType: 'date' }
    }
  }
};

const responseValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['surveyId', 'submittedAt', 'answers', 'anonymous'],
    properties: {
      surveyId: { bsonType: 'objectId' },
      respondentId: { bsonType: ['objectId', 'null'] },
      anonymous: { bsonType: 'bool' },
      submittedAt: { bsonType: 'date' },
      path: { bsonType: 'array', items: { bsonType: 'objectId' } },
      answers: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['questionId', 'type'],
          properties: {
            questionId: { bsonType: 'objectId' },
            type: { enum: ['single', 'multiple', 'text', 'number'] },
            rootId: { bsonType: ['objectId', 'null'] },
            optionKeys: { bsonType: 'array', items: { bsonType: 'string' } },
            value: { bsonType: ['string', 'null'] },
            numberValue: { bsonType: ['double', 'int', 'null'] }
          }
        }
      }
    }
  }
};

const userValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['username', 'passwordHash', 'createdAt'],
    properties: {
      username: { bsonType: 'string', minLength: 3, maxLength: 20 },
      passwordHash: { bsonType: 'string' },
      createdAt: { bsonType: 'date' },
      lastLoginAt: { bsonType: ['date', 'null'] }
    }
  }
};

async function ensureCollection(db, name, validator) {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    await db.createCollection(name, { validator, validationLevel: 'strict' });
  } else {
    await db.command({ collMod: name, validator, validationLevel: 'strict' });
  }
}

async function initDatabase(db) {
  await ensureCollection(db, 'users', userValidator);
  await ensureCollection(db, 'surveys', surveyValidator);
  await ensureCollection(db, 'questions', questionValidator);
  await ensureCollection(db, 'responses', responseValidator);
  await ensureCollection(db, 'question_roots', questionRootValidator);
  await ensureCollection(db, 'question_versions', questionVersionValidator);
  await ensureCollection(db, 'question_banks', questionBankValidator);
  await ensureCollection(db, 'bank_items', bankItemValidator);

  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('surveys').createIndex({ ownerId: 1, createdAt: -1 });
  await db.collection('questions').createIndex({ surveyId: 1, order: 1 }, { unique: true });
  await db.collection('questions').createIndex({ rootId: 1, surveyId: 1 });
  await db.collection('responses').createIndex({ surveyId: 1, submittedAt: -1 });
  await db.collection('responses').createIndex({ surveyId: 1, respondentId: 1 });
  await db.collection('responses').createIndex({ surveyId: 1, 'answers.questionId': 1 });
  await db.collection('question_roots').createIndex({ ownerId: 1, updatedAt: -1 });
  await db.collection('question_roots').createIndex({ sharedWith: 1 });
  await db.collection('question_versions').createIndex({ rootId: 1, versionNo: 1 }, { unique: true });
  await db.collection('question_banks').createIndex({ ownerId: 1, createdAt: -1 });
  await db.collection('bank_items').createIndex({ bankId: 1, rootId: 1 }, { unique: true });
}

if (require.main === module) {
  require('dotenv').config();
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.DB_NAME || 'survey_db';
  connect(uri, dbName)
    .then((db) => initDatabase(db))
    .then(() => {
      console.log('集合、校验规则和索引已就绪：' + dbName);
    })
    .catch((err) => {
      console.error('初始化失败：', err.message);
      process.exitCode = 1;
    })
    .finally(() => close());
}

module.exports = { initDatabase };
