# 三、API 说明

接口统一返回 JSON。失败时返回 `{ "error": "给用户看的提示" }`，字段级错误可能还会带 `errors` 数组，例如：

```json
{
  "error": "至少需要选择 2 个选项",
  "errors": [{ "questionId": "6ad8...", "message": "至少需要选择 2 个选项" }]
}
```

需要登录的接口在未登录时返回 401。问卷不属于当前用户时返回 404，不返回 403，避免暴露问卷是否存在。

## 3.1 账号

### POST /api/auth/register

注册并自动登录。

请求：

```json
{ "username": "student01", "password": "123456" }
```

成功返回 201：

```json
{ "user": { "id": "6ad8...", "username": "student01" } }
```

用户名不合法返回 400，用户名重复返回 409。

### POST /api/auth/login

请求 `{ "username": "...", "password": "..." }`。成功返回 200 和用户信息，密码错误返回 401。

### POST /api/auth/logout

销毁 session，返回 `{ "ok": true }`。

### GET /api/auth/me

返回当前登录用户，未登录返回 401。

```json
{ "user": { "id": "6ad8...", "username": "student01", "createdAt": "2026-10-20T10:00:00.000Z" } }
```

## 3.2 问卷管理

以下接口都要求登录。

### GET /api/surveys

返回当前用户创建的问卷，按创建时间倒序，带题目数和回答数。

```json
{
  "surveys": [
    {
      "_id": "6ad8...",
      "title": "健康状况小调查",
      "status": "published",
      "questionCount": 5,
      "responseCount": 3,
      "...": "其余字段略"
    }
  ]
}
```

### POST /api/surveys

请求：

```json
{
  "title": "健康状况小调查",
  "description": "麻烦大家抽两分钟填一下",
  "allowAnonymous": true,
  "deadline": "2026-11-01T12:00"
}
```

标题必填，1 到 80 字；说明最多 1000 字；截止时间可以不传或传 null，传了必须晚于当前时间。创建后状态是 `draft`。

### GET /api/surveys/:id

返回问卷和按 order 排好的题目。只有创建者能访问。

```json
{ "survey": { "...": "..." }, "questions": [ { "_id": "...", "order": 1, "type": "single", "...": "..." } ] }
```

### PUT /api/surveys/:id

修改标题、说明、匿名设置、截止时间。传哪个字段改哪个，至少要传一个。已关闭的问卷返回 400。

### POST /api/surveys/:id/publish

发布问卷。没有题目返回 400；已发布或已关闭返回 400；截止时间已过返回 400。

### POST /api/surveys/:id/close

关闭问卷，只有已发布的问卷能关闭。

### POST /api/surveys/:id/questions

添加题目，只有草稿状态能加。请求体按题型不同：

单选题：

```json
{
  "type": "single",
  "title": "你的性别",
  "required": true,
  "options": [
    { "key": "A", "label": "男" },
    { "key": "B", "label": "女" }
  ]
}
```

多选题（最少选 2 个，最多选 3 个）：

```json
{
  "type": "multiple",
  "title": "你喜欢的水果",
  "required": true,
  "options": [
    { "label": "苹果" },
    { "label": "香蕉" },
    { "label": "西瓜" }
  ],
  "multiple": { "minSelect": 2, "maxSelect": 3 }
}
```

`key` 可以不传，服务端会按顺序生成 A、B、C。如果传了不能重复。

文本填空：

```json
{
  "type": "text",
  "title": "你的建议",
  "required": true,
  "text": { "minLength": 2, "maxLength": 50 }
}
```

数字填空：

```json
{
  "type": "number",
  "title": "你的年龄",
  "required": true,
  "number": { "min": 0, "max": 120, "integer": true }
}
```

跳转规则既可以跟着添加请求一起传，也可以之后用 PUT 修改：

```json
{
  "type": "single",
  "title": "你平时运动吗",
  "required": true,
  "options": [{ "key": "A", "label": "经常" }, { "key": "B", "label": "很少" }],
  "jumps": [
    { "targetQuestionId": "第3题的id", "match": { "kind": "option", "keys": ["B"], "mode": "any" } }
  ]
}
```

数字跳转：

```json
{
  "jumps": [
    { "targetQuestionId": "第5题的id", "match": { "kind": "number", "op": ">=", "value": 100 } }
  ]
}
```

`targetQuestionId` 必须是同一问卷中已经存在的题目，不能指向自己。选项条件的 key 必须属于这道题的选项。

### PUT /api/surveys/:id/questions/:qid

整体替换题目配置，请求体和添加题目相同。题目 id、所属问卷、order 不变。只有草稿状态能改。

### DELETE /api/surveys/:id/questions/:qid

删除题目，同时清掉其他题目中指向它的跳转规则。只有草稿状态能删。

## 3.3 填写

### GET /api/public/surveys/:id

获取问卷和题目，供填写页使用。要求登录。只返回公开字段，不返回创建者 id。

草稿返回 404；已关闭或已过截止时间返回 403 `{ "error": "问卷已经关闭" }` 或 `{ "error": "问卷已到截止时间" }`。

### POST /api/public/surveys/:id/responses

提交回答。要求登录。

请求：

```json
{
  "anonymous": false,
  "answers": [
    { "questionId": "题目1的id", "optionKeys": ["A"] },
    { "questionId": "题目2的id", "optionKeys": ["A", "B"] },
    { "questionId": "题目3的id", "value": 100 },
    { "questionId": "题目4的id", "value": "多加点实操" }
  ]
}
```

- 选择题用 `optionKeys`，文本题和数字题用 `value`。
- 服务端会按题目顺序和跳转规则重新走一遍，只保存实际经过的题目。客户端多传的被跳过题目的答案会被忽略。
- 必答题没回答、选项不存在、多选数量不对、字数不在范围内、数字不是整数或超出范围，都会返回 400。
- `anonymous: true` 时要求问卷允许匿名，否则返回 400；匿名提交不会保存 respondentId。
- 同一个人可以多次提交，需求里没有限制次数。

成功返回 201：

```json
{ "ok": true, "responseId": "6ad8..." }
```

## 3.4 统计

### GET /api/surveys/:id/stats

整份问卷的统计，只有创建者能看。返回结构：

```json
{
  "survey": { "_id": "...", "title": "...", "status": "published" },
  "totalResponses": 3,
  "questions": [
    {
      "questionId": "...",
      "title": "你的性别",
      "type": "single",
      "order": 1,
      "answered": 3,
      "options": [
        { "key": "A", "label": "男", "count": 1, "percent": 33.3 },
        { "key": "B", "label": "女", "count": 2, "percent": 66.7 }
      ]
    },
    {
      "questionId": "...",
      "title": "你的年龄",
      "type": "number",
      "order": 2,
      "answered": 2,
      "number": { "count": 2, "avg": 23.5, "min": 20, "max": 27 }
    },
    {
      "questionId": "...",
      "title": "你的建议",
      "type": "text",
      "order": 3,
      "answered": 2,
      "texts": ["建议一", "建议二"]
    }
  ]
}
```

多选题的 `percent` 按“作答人数”算，不是按总提交数，因为被跳转跳过的人没有作答。`answered` 就是这道题的实际作答人数。

### GET /api/surveys/:id/stats/questions/:qid

单题统计，返回结构和上面 `questions` 数组里的一项相同，外层包一个 `stat`：

```json
{ "stat": { "questionId": "...", "answered": 2, "options": [] } }
```

## 3.5 页面路由

| 路径 | 页面 |
| --- | --- |
| `/` | 登录注册 |
| `/dashboard.html` | 我的问卷 |
| `/surveys/:id/edit` | 问卷编辑 |
| `/survey/:id` | 填写问卷 |
| `/surveys/:id/stats` | 统计结果 |
