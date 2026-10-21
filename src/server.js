require('dotenv').config();

const { connect, getDb, close } = require('./db');
const { initDatabase } = require('../scripts/init-db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.DB_NAME || 'survey_db';

async function main() {
  await connect(uri, dbName);
  await initDatabase(getDb());
  console.log('已连接 MongoDB：' + dbName);

  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`问卷系统已启动：http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败：', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('请确认本机 MongoDB 已经启动，或检查 .env 里的 MONGODB_URI');
  }
  process.exit(1);
});
