# 基于 MongoDB 的问卷系统（第一阶段）

课程大作业第一阶段：一个简化版在线问卷系统，支持注册登录、创建问卷、四种题型、跳转规则、填写校验和统计。

技术栈：Node.js 18+、Express 4、MongoDB 6+、原生 mongodb 驱动、原生 HTML/CSS/JS。没有用 Mongoose，也没有用任何问卷框架。

## 运行前准备

1. 安装 Node.js（建议 18 以上）和 MongoDB Community Server。
2. 启动 MongoDB。Windows 安装后一般已经注册为服务，也可以在命令行执行：

   ```powershell
   mongod --dbpath "C:\data\db"
   ```

   如果用 MongoDB Atlas，把连接串换成 Atlas 提供的那一条即可。
3. 在项目根目录复制配置文件：

   ```powershell
   copy .env.example .env
   ```

   按实际情况修改 `MONGODB_URI`、`DB_NAME`、`SESSION_SECRET`。

## 安装和启动

```powershell
npm install
npm run init-db
npm start
```

打开 http://localhost:3000 ，注册账号后即可创建问卷。

`npm run init-db` 会创建四个集合、写入 JSON Schema 校验规则和索引。服务启动时也会自动执行一次，重复执行不会清空数据。

## 测试

```powershell
npm test
```

测试使用 `mongodb-memory-server` 临时启动一个真实的 mongod 进程，不会动本机数据库，跑完自动关闭。共 13 个用例，覆盖注册登录、问卷创建、四种题型校验、三种跳转、统计和权限。

## 目录结构

```
src/
  app.js                 Express 应用和路由挂载
  server.js              启动入口
  db.js                  MongoDB 连接
  middleware/auth.js     登录校验
  routes/                账号、问卷、公开填写、统计接口
  services/              题目配置校验、答案校验与跳转、统计、密码哈希
scripts/init-db.js       集合、校验器、索引初始化
public/                  五个简单页面和对应脚本
tests/api.test.js        接口自动测试
docs/                    设计文档、测试用例、AI 使用记录、项目报告
```

## 页面

- `/` 登录与注册
- `/dashboard.html` 我的问卷
- `/surveys/:id/edit` 问卷编辑（题目、跳转、发布、关闭）
- `/survey/:id` 填写页（需要登录，链接可以直接发给别人）
- `/surveys/:id/stats` 统计页

## 已知限制

- session 存在进程内存里，重启服务后需要重新登录。课程作业够用，生产环境应该换成 Redis 或 MongoDB 存储。
- 问卷发布后题目被锁定，不能增删改。这是有意的设计，避免已有回答和题目结构对不上。
- 填写页一次显示一题，没有做“上一题”回退，避免和跳转路径冲突。
