const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');
const { loadAccessibleRoot } = require('../services/question-catalog');

const router = express.Router();
router.use(requireLogin);

async function findOwnedBank(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: '题库 ID 不正确' });
    return null;
  }
  const bank = await getDb()
    .collection('question_banks')
    .findOne({ _id: new ObjectId(req.params.id), ownerId: new ObjectId(req.session.userId) });
  if (!bank) {
    res.status(404).json({ error: '题库不存在，或不属于当前用户' });
    return null;
  }
  return bank;
}

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const ownerId = new ObjectId(req.session.userId);
    const banks = await db.collection('question_banks').find({ ownerId }).sort({ createdAt: -1 }).toArray();
    const counts = banks.length
      ? await db
          .collection('bank_items')
          .aggregate([
            { $match: { bankId: { $in: banks.map((bank) => bank._id) } } },
            { $group: { _id: '$bankId', count: { $sum: 1 } } }
          ])
          .toArray()
      : [];
    const countMap = new Map(counts.map((row) => [row._id.toString(), row.count]));
    res.json({
      banks: banks.map((bank) => ({
        _id: bank._id,
        name: bank.name,
        description: bank.description,
        itemCount: countMap.get(bank._id.toString()) || 0,
        createdAt: bank.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const errors = [];
    if (!name || name.length > 40) errors.push('题库名称长度需在 1 到 40 字之间');
    if (description.length > 200) errors.push('题库说明不能超过 200 字');
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

    const doc = {
      ownerId: new ObjectId(req.session.userId),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const inserted = await getDb().collection('question_banks').insertOne(doc);
    res.status(201).json({ bank: { ...doc, _id: inserted.insertedId } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const bank = await findOwnedBank(req, res);
    if (!bank) return;

    const db = getDb();
    const items = await db.collection('bank_items').find({ bankId: bank._id }).sort({ addedAt: -1 }).toArray();
    const roots = items.length
      ? await db.collection('question_roots').find({ _id: { $in: items.map((item) => item.rootId) } }).toArray()
      : [];
    const rootMap = new Map(roots.map((root) => [root._id.toString(), root]));
    const versions = roots.length
      ? await db
          .collection('question_versions')
          .find({ _id: { $in: roots.map((root) => root.latestVersionId) } })
          .toArray()
      : [];
    const versionMap = new Map(versions.map((version) => [version._id.toString(), version]));

    res.json({
      bank: { _id: bank._id, name: bank.name, description: bank.description, createdAt: bank.createdAt },
      items: items
        .map((item) => {
          const root = rootMap.get(item.rootId.toString());
          if (!root) return null;
          const version = versionMap.get(root.latestVersionId.toString()) || {};
          return {
            rootId: root._id,
            versionId: root.latestVersionId,
            versionNo: root.latestVersionNo,
            title: version.title || '',
            type: version.type || '',
            options: version.options || [],
            addedAt: item.addedAt
          };
        })
        .filter(Boolean)
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const bank = await findOwnedBank(req, res);
    if (!bank) return;
    const update = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 40) return res.status(400).json({ error: '题库名称长度需在 1 到 40 字之间' });
      update.name = name;
    }
    if (req.body.description !== undefined) {
      const description = String(req.body.description).trim();
      if (description.length > 200) return res.status(400).json({ error: '题库说明不能超过 200 字' });
      update.description = description;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: '没有需要修改的内容' });
    update.updatedAt = new Date();

    await getDb().collection('question_banks').updateOne({ _id: bank._id }, { $set: update });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const bank = await findOwnedBank(req, res);
    if (!bank) return;
    const db = getDb();
    await db.collection('bank_items').deleteMany({ bankId: bank._id });
    await db.collection('question_banks').deleteOne({ _id: bank._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items', async (req, res, next) => {
  try {
    const bank = await findOwnedBank(req, res);
    if (!bank) return;

    const access = await loadAccessibleRoot(req.body.rootId, req.session.userId);
    if (access.error) return res.status(access.status).json({ error: access.error });

    await getDb()
      .collection('bank_items')
      .updateOne(
        { bankId: bank._id, rootId: access.root._id },
        { $setOnInsert: { addedAt: new Date() } },
        { upsert: true }
      );
    res.status(201).json({ ok: true, rootId: access.root._id });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/items/:rootId', async (req, res, next) => {
  try {
    const bank = await findOwnedBank(req, res);
    if (!bank) return;
    if (!ObjectId.isValid(req.params.rootId)) {
      return res.status(400).json({ error: '题目 ID 不正确' });
    }
    await getDb()
      .collection('bank_items')
      .deleteOne({ bankId: bank._id, rootId: new ObjectId(req.params.rootId) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
