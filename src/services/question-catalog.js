const { ObjectId } = require('mongodb');
const { getDb } = require('../db');

const CONTENT_FIELDS = ['type', 'title', 'options', 'multiple', 'text', 'number'];

function pickContent(source) {
  return {
    type: source.type,
    title: source.title,
    options: source.options || [],
    multiple: source.multiple || { minSelect: null, maxSelect: null },
    text: source.text || { minLength: null, maxLength: null },
    number: source.number || { min: null, max: null, integer: false }
  };
}

function contentText(source) {
  return JSON.stringify(pickContent(source));
}

function sameContent(a, b) {
  return contentText(a) === contentText(b);
}

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
}

// 题目本体（root）只存身份和最新版本指针，具体内容全部放在不可变的版本里。
// 这样“改题”等于新增一个版本，旧问卷引用的老版本不会被动到。
async function createRootWithVersion(ownerId, content, changeNote) {
  const db = getDb();
  const now = new Date();
  const versionId = new ObjectId();
  const rootId = new ObjectId();

  await db.collection('question_versions').insertOne({
    _id: versionId,
    rootId,
    ownerId,
    versionNo: 1,
    parentVersionId: null,
    source: 'create',
    changeNote: changeNote || '创建题目',
    ...pickContent(content),
    createdAt: now
  });

  const root = {
    _id: rootId,
    ownerId,
    latestVersionId: versionId,
    latestVersionNo: 1,
    sharedWith: [],
    createdAt: now,
    updatedAt: now
  };
  await db.collection('question_roots').insertOne(root);
  return { root, versionId, versionNo: 1 };
}

async function addVersion(root, content, options) {
  const db = getDb();
  const opts = options || {};
  const now = new Date();
  const versionNo = root.latestVersionNo + 1;
  const versionId = new ObjectId();

  const doc = {
    _id: versionId,
    rootId: root._id,
    ownerId: root.ownerId,
    versionNo,
    parentVersionId: opts.parentVersionId || root.latestVersionId,
    source: opts.source || 'edit',
    changeNote: opts.changeNote || '',
    ...pickContent(content),
    createdAt: now
  };
  await db.collection('question_versions').insertOne(doc);

  // 题库列表展示“最近创建的版本”。旧问卷仍然指向各自的老版本，不受影响。
  await db.collection('question_roots').updateOne(
    { _id: root._id },
    { $set: { latestVersionId: versionId, latestVersionNo: versionNo, updatedAt: now } }
  );
  root.latestVersionId = versionId;
  root.latestVersionNo = versionNo;
  return doc;
}

async function latestVersion(root) {
  return getDb().collection('question_versions').findOne({ _id: root.latestVersionId });
}

async function findVersion(rootId, versionId) {
  const id = toObjectId(versionId);
  if (!id) return null;
  return getDb().collection('question_versions').findOne({ _id: id, rootId });
}

// 返回 { root, isOwner } 或 { error, status }
async function loadAccessibleRoot(rootId, userId) {
  const id = toObjectId(rootId);
  if (!id) return { error: '题目 ID 不正确', status: 400 };
  const root = await getDb().collection('question_roots').findOne({ _id: id });
  if (!root) return { error: '题目不存在', status: 404 };

  const me = toObjectId(userId);
  const isOwner = root.ownerId.equals(me);
  const isShared = (root.sharedWith || []).some((item) => item.equals(me));
  if (!isOwner && !isShared) return { error: '没有权限使用这道题', status: 403 };
  return { root, isOwner };
}

async function loadOwnedRoot(rootId, userId) {
  const result = await loadAccessibleRoot(rootId, userId);
  if (result.error) return result;
  if (!result.isOwner) return { error: '只有题目创建者可以做这个操作', status: 403 };
  return result;
}

async function versionsOf(rootId) {
  return getDb()
    .collection('question_versions')
    .find({ rootId })
    .sort({ versionNo: 1 })
    .toArray();
}

module.exports = {
  CONTENT_FIELDS,
  pickContent,
  sameContent,
  toObjectId,
  createRootWithVersion,
  addVersion,
  latestVersion,
  findVersion,
  loadAccessibleRoot,
  loadOwnedRoot,
  versionsOf
};
