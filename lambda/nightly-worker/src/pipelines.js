'use strict';

const { ObjectId } = require('mongodb');
const loadTemplate = require('./data/source-load-pipeline.json');
const schemaStages = require('./data/canonical-schema-stages.json');

function idToString(id) {
  if (id == null) return null;
  if (typeof id === 'object' && typeof id.toHexString === 'function') return id.toHexString();
  return String(id);
}

function idQueryValue(lastId) {
  if (lastId == null || lastId === '') return null;
  const text = String(lastId);
  if (/^[a-f0-9]{24}$/i.test(text)) return new ObjectId(text);
  return text;
}

function sourceLoadPipeline(lastId, limit) {
  const pipe = JSON.parse(JSON.stringify(loadTemplate));
  const match = {};
  const id = idQueryValue(lastId);
  if (id != null) match._id = { $gt: id };
  pipe[0] = { $match: match };
  pipe.splice(1, 0, { $sort: { _id: 1 } }, { $limit: limit });
  const project = pipe.find((stage) => stage.$project && Object.prototype.hasOwnProperty.call(stage.$project, 'phone'));
  if (project && project.$project._id === 0) delete project.$project._id;
  const projectIndex = pipe.indexOf(project);
  if (project) {
    pipe.splice(projectIndex, 0, {
      $lookup: {
        from: 'web_visitors',
        let: { uid: { $arrayElemAt: ['$_users._id', 0] } },
        pipeline: [
          { $match: { $expr: { $and: [
            { $ne: ['$$uid', null] },
            { $eq: [{ $toString: '$patient_id' }, { $toString: '$$uid' }] },
          ] } } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_webVisitor',
      },
    }, {
      $lookup: {
        from: 'web_touchpoints',
        let: { vid: { $arrayElemAt: ['$_webVisitor._id', 0] } },
        pipeline: [
          { $match: { $expr: { $and: [
            { $ne: ['$$vid', null] },
            { $eq: [{ $toString: '$visitor_id' }, { $toString: '$$vid' }] },
          ] } } },
          { $project: {
            utm_source: 1,
            utm_medium: 1,
            utm_campaign: 1,
            utm_term: 1,
            referrer: 1,
            gclid: 1,
            ts: 1,
            occurred_at: '$ts',
          } },
        ],
        as: '_touchpoints',
      },
    });
    project.$project.web_touchpoints = { $ifNull: ['$_touchpoints', []] };
  }
  return pipe;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function sourceWritePipeline(phone, source, stage) {
  return [
    { $match: { phone } },
    { $set: { source: plain(source), stage: plain(stage) } },
    ...JSON.parse(JSON.stringify(schemaStages)),
  ];
}

const OPEN_STATUSES_EXCLUDED = ['Converted', 'Not Converted'];

function temperatureLoadPipeline(lastId, limit) {
  const match = { conversionStatus: { $nin: OPEN_STATUSES_EXCLUDED } };
  const id = idQueryValue(lastId);
  if (id != null) match._id = { $gt: id };
  return [
    { $match: match },
    { $sort: { _id: 1 } },
    { $limit: limit },
    { $project: { phone: 1, conversionStatus: 1 } },
  ];
}

function temperatureWritePipeline(scored) {
  const write = scored.should_write_temperature === true;
  const clear = scored.should_clear_temperature === true;
  const derived = scored.temperature_derived || {};
  const unset = ['lead_temperature', 'temperature_calculated_at', 'temperature_outcome', 'temperature_rule'];
  if (clear) unset.push('temperature', 'calculated_at', 'temperature_derived');
  const stages = [{ $match: { phone: scored.phone } }];
  if (write) {
    stages.push({
      $set: {
        temperature: scored.temperature,
        calculated_at: {
          $convert: {
            input: scored.calculated_at,
            to: 'date',
            onError: '$$REMOVE',
            onNull: '$$REMOVE',
          },
        },
        temperature_derived: {
          attempts: derived.attempts ?? 0,
          connected: derived.connected ?? 0,
          d_captured: derived.d_captured ?? null,
          d_inbound: derived.d_inbound ?? null,
          d_call: derived.d_call ?? null,
        },
      },
    });
  }
  stages.push({ $unset: unset });
  stages.push({
    $merge: {
      into: 'new-telecrm',
      on: '_id',
      whenMatched: 'replace',
      whenNotMatched: 'discard',
    },
  });
  return stages;
}

module.exports = {
  idToString,
  sourceLoadPipeline,
  sourceWritePipeline,
  temperatureLoadPipeline,
  temperatureWritePipeline,
};
