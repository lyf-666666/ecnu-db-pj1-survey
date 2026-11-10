const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const publicRoutes = require('./routes/public-surveys');
const statsRoutes = require('./routes/stats');
const questionRoutes = require('./routes/questions');
const bankRoutes = require('./routes/banks');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      name: 'survey.sid',
      secret: process.env.SESSION_SECRET || 'survey-dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      }
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/surveys', surveyRoutes);
  app.use('/api/surveys', statsRoutes);
  app.use('/api/questions', questionRoutes);
  app.use('/api/banks', bankRoutes);
  app.use('/api/public/surveys', publicRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/survey/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'fill.html'));
  });
  app.get('/surveys/:id/edit', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'edit.html'));
  });
  app.get('/surveys/:id/stats', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'stats.html'));
  });
  app.get('/questions', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'questions.html'));
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}

module.exports = { createApp };
