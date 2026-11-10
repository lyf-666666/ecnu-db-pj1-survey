const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { normalizeContent } = require('../services/question-check');
const { rootStats } = require('../services/stats');
const {
  createRootWithVersion,
  addVersion,
  latestVersion,
  findVersion,
  loadAccessibleRoot,
  loadOwnedRoot
} = require('../services/question-catalog');

const router = express.Router();
router.use(requireLogin);

async function usernameMap(ids) {
  if (ids.length === 0) return new Map();
  const users = await getDb()
    .collection('users')
    .find({ _id: { $in: ids } }, { projection: { username: 1 } })
    .toArray();
  return new Map(users.map((user) => [user._id.toString(), user.username]));
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const me = new ObjectId(req.session.userId);
    const shared = req.query.scope === 'shared';
    const filter = shared ? { sharedWith: me, ownerId: { $ne: me } } : { ownerId: me };

    let roots;
    if (req.query.bankId) {
      if (!ObjectId.isValid(req.query.bankId)) {
        return res.status(400).json({ error: '题库 ID 不正确' });
      }
      const bankId = new ObjectId(req.query.bankId);
      const bank = await db.collection('question_banks').findOne({ _id: bankId, ownerId: me });
      if (!bank) return res.status(404).json({ error: '题库不存在' });
      const items = await db.collection('bank_items').find({ bankId }).toArray();
      roots = await db
        .collection('question_roots')
        .find({ ...filter, _id: { $in: items.map((item) => item.rootId) } })
        .sort({ updatedAt: -1 })
        .toArray();
    } else {
      roots = await db.collection('question_roots').find(filter).sort({ updatedAt: -1 }).limit(200).toArray();
    }

    const versions = roots.length
      ? await db
          .collection('question_versions')
          .find({ _id: { $in: roots.map((root) => root.latestVersionId) } })
          .toArray()
      : [];
    const versionMap = new Map(versions.map((version) => [version._id.toString(), version]));

    const keyword = String(req.query.keyword || '').trim();
    const visible = keyword
      ? roots.filter((root) => {
          const version = versionMap.get(root.latestVersionId.toString());
          return version && version.title.includes(keyword);
        })
      : roots;

    const mySurveys = await db
      .collection('surveys')
      .find({ ownerId: me }, { projection: { _id: 1 } })
      .toArray();
    const usageRows = visible.length
      ? await db
          .collection('questions')
          .aggregate([
            {
              $match: {
                rootId: { $in: visible.map((root) => root._id) },
                surveyId: { $in: mySurveys.map((survey) => survey._id) }
              }
            },
            { $group: { _id: { rootId: '$rootId', surveyId: '$surveyId' } } }
          ])
          .toArray()
      : [];
    const usageMap = new Map();
    for (const row of usageRows) {
      const key = row._id.rootId.toString();
      usageMap.set(key, (usageMap.get(key) || 0) + 1);
    }

    const owners = await usernameMap([...new Set(visible.map((root) => root.ownerId.toString()))].map((id) => new ObjectId(id)));

    res.json({
      questions: visible.map((root) => {
        const version = versionMap.get(root.latestVersionId.toString()) || {};
        return {
          rootId: root._id,
          versionId: root.latestVersionId,
          versionNo: root.latestVersionNo,
          title: version.title || '',
          type: version.type || '',
          options: version.options || [],
          ownerId: root.ownerId,
          ownerName: owners.get(root.ownerId.toString()) || '',
          isOwner: root.ownerId.equals(me),
          sharedWithCount: (root.sharedWith || []).length,
          usageCount: usageMap.get(root._id.toString()) || 0,
          createdAt: root.createdAt,
          updatedAt: root.updatedAt
        };
      })
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = normalizeContent(req.body);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    const me = new ObjectId(req.session.userId);
    const created = await createRootWithVersion(me, result.doc, '创建题目');

    const bankIds = Array.isArray(req.body.bankIds) ? req.body.bankIds : [];
    for (const bankId of bankIds) {
      if (!ObjectId.isValid(bankId)) continue;
      const bank = await getDb()
        .collection('question_banks')
        .findOne({ _id: new ObjectId(bankId), ownerId: me });
      if (!bank) continue;
      await getDb()
        .collection('bank_items')
        .updateOne(
          { bankId: bank._id, rootId: created.root._id },
          { $setOnInsert: { addedAt: new Date() } },
          { upsert: true }
        );
    }

    res.status(201).json({ rootId: created.root._id, versionId: created.versionId, versionNo: 1 });
  } catch (err) {
    next(err);
  }
});

router.get('/:rootId', async (req, res, next) => {
  try {
    const db = getDb();
    const access = await loadAccessibleRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const { root, isOwner } = access;
    const me = new ObjectId(req.session.userId);

    const [versions, current, questions] = await Promise.all([
      db.collection('question_versions').find({ rootId: root._id }).sort({ versionNo: 1 }).toArray(),
      db.collection('question_versions').findOne({ _id: root.latestVersionId }),
      db.collection('questions').find({ rootId: root._id }).toArray()
    ]);

    const surveyIds = [...new Set(questions.map((question) => question.surveyId.toString()))].map((id) => new ObjectId(id));
    const surveys = surveyIds.length
      ? await db
          .collection('surveys')
          .find({ _id: { $in: surveyIds } }, { projection: { title: 1, status: 1, ownerId: 1 } })
          .toArray()
      : [];
    const surveyMap = new Map(surveys.map((survey) => [survey._id.toString(), survey]));
    const owners = await usernameMap(
      [...new Set([root.ownerId.toString(), ...surveys.map((survey) => survey.ownerId.toString())])].map(
        (id) => new ObjectId(id)
      )
    );

    const usage = questions
      .map((question) => {
        const survey = surveyMap.get(question.surveyId.toString());
        if (!survey) return null;
        return {
          questionId: question._id,
          surveyId: question.surveyId,
          surveyTitle: survey.title,
          surveyStatus: survey.status,
          ownerName: owners.get(survey.ownerId.toString()) || '',
          isMine: survey.ownerId.equals(me),
          versionNo: question.versionNo,
          versionId: question.versionId
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.isMine) - Number(a.isMine));

    const sharedUsers = await usernameMap(root.sharedWith || []);
    const bankItems = await db.collection('bank_items').find({ rootId: root._id }).toArray();
    const banks = bankItems.length
      ? await db
          .collection('question_banks')
          .find({ _id: { $in: bankItems.map((item) => item.bankId) }, ownerId: me }, { projection: { name: 1 } })
          .toArray()
      : [];

    res.json({
      root: {
        _id: root._id,
        isOwner,
        ownerId: root.ownerId,
        ownerName: owners.get(root.ownerId.toString()) || '',
        latestVersionId: root.latestVersionId,
        latestVersionNo: root.latestVersionNo,
        sharedWith: (root.sharedWith || []).map((id) => ({ userId: id, username: sharedUsers.get(id.toString()) || '' })),
        createdAt: root.createdAt,
        updatedAt: root.updatedAt
      },
      current,
      versions: versions.map((version) => ({
        _id: version._id,
        versionNo: version.versionNo,
        parentVersionId: version.parentVersionId,
        source: version.source,
        changeNote: version.changeNote,
        title: version.title,
        type: version.type,
        options: version.options,
        multiple: version.multiple,
        text: version.text,
        number: version.number,
        createdAt: version.createdAt
      })),
      usage,
      banks: banks.map((bank) => ({ _id: bank._id, name: bank.name }))
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:rootId', async (req, res, next) => {
  try {
    const access = await loadOwnedRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const result = normalizeContent(req.body);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    const version = await addVersion(access.root, result.doc, {
      source: 'edit',
      changeNote: typeof req.body.changeNote === 'string' ? req.body.changeNote.slice(0, 200) : '修改题目'
    });
    res.json({ versionId: version._id, versionNo: version.versionNo });
  } catch (err) {
    next(err);
  }
});

// 基于某个历史版本另起一个新版本：新版本独立发展，不影响原版本。
router.post('/:rootId/versions', async (req, res, next) => {
  try {
    const access = await loadOwnedRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const parent = req.body.parentVersionId
      ? await findVersion(access.root._id, req.body.parentVersionId)
      : await latestVersion(access.root);
    if (!parent) return res.status(404).json({ error: '要基于的版本不存在' });

    const result = normalizeContent(req.body);
    if (!result.ok) return res.status(400).json({ error: result.errors[0], errors: result.errors });

    const version = await addVersion(access.root, result.doc, {
      source: 'fork',
      parentVersionId: parent._id,
      changeNote: typeof req.body.changeNote === 'string' ? req.body.changeNote.slice(0, 200) : '基于 v' + parent.versionNo + ' 新建版本'
    });
    res.status(201).json({ versionId: version._id, versionNo: version.versionNo, parentVersionId: parent._id });
  } catch (err) {
    next(err);
  }
});

router.post('/:rootId/versions/:versionId/restore', async (req, res, next) => {
  try {
    const access = await loadOwnedRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const target = await findVersion(access.root._id, req.params.versionId);
    if (!target) return res.status(404).json({ error: '版本不存在' });

    // 恢复不是把指针拨回去，而是把旧内容重新发一个新版本，
    // 这样已经引用旧版本的问卷不会因为“恢复”而跟着变。
    const version = await addVersion(access.root, target, {
      source: 'restore',
      parentVersionId: target._id,
      changeNote: '恢复自 v' + target.versionNo
    });
    res.status(201).json({ versionId: version._id, versionNo: version.versionNo, restoredFrom: target.versionNo });
  } catch (err) {
    next(err);
  }
});

router.post('/:rootId/share', async (req, res, next) => {
  try {
    const access = await loadOwnedRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!username) return res.status(400).json({ error: '请输入要共享的用户名' });

    const user = await getDb().collection('users').findOne({ username });
    if (!user) return res.status(404).json({ error: '找不到这个用户' });
    if (user._id.equals(access.root.ownerId)) {
      return res.status(400).json({ error: '不用共享给自己' });
    }

    await getDb()
      .collection('question_roots')
      .updateOne({ _id: access.root._id }, { $addToSet: { sharedWith: user._id }, $set: { updatedAt: new Date() } });
    res.json({ ok: true, userId: user._id, username: user.username });
  } catch (err) {
    next(err);
  }
});

router.delete('/:rootId/share/:userId', async (req, res, next) => {
  try {
    const access = await loadOwnedRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ error: '用户 ID 不正确' });
    }
    await getDb()
      .collection('question_roots')
      .updateOne(
        { _id: access.root._id },
        { $pull: { sharedWith: new ObjectId(req.params.userId) }, $set: { updatedAt: new Date() } }
      );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:rootId/stats', async (req, res, next) => {
  try {
    const access = await loadAccessibleRoot(req.params.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    const current = await latestVersion(access.root);
    const data = await rootStats(access.root._id, new ObjectId(req.session.userId));
    res.json({
      root: {
        _id: access.root._id,
        title: current ? current.title : '',
        type: current ? current.type : '',
        versionNo: access.root.latestVersionNo
      },
      ...data
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
