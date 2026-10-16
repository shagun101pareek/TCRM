'use strict';

const { MongoClient } = require('mongodb');

let client = null;

async function getDb(config) {
  if (!client) {
    client = new MongoClient(config.mongoUri, { maxPoolSize: 2 });
    await client.connect();
  }
  return client.db(config.mongoDb);
}

async function closeDb() {
  if (!client) return;
  const current = client;
  client = null;
  await current.close();
}

module.exports = { getDb, closeDb };
