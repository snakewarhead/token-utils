const { MongoClient } = require('mongodb')

let db
let connected = false

const connect = async () => {
  if (db) {
    return
  }

  const uriDB = process.env.uriDB
  const nmDB = process.env.nmDB
  if (!uriDB || !uriDB) {
    console.log('db no use')
    return
  }

  const client = new MongoClient(uriDB)
  // auto close connection when app finished
  await client.connect()
  db = client.db(nmDB)

  connected = true
  console.log('db connected')
}

const sanitize = (params) => {
  if (params instanceof Object) {
    for (var key in params) {
      if (/^\$/.test(key)) {
        delete params[key]
      } else {
        sanitize(params[key])
      }
    }
  }
  return params
}

const sanitizeStr = (params) => {
  if (typeof params === 'string') {
    params = JSON.parse(params)
  }
  return sanitize(params)
}

const insert = async (coll, m) => {
  const res = await db.collection(coll).insertOne(m)
  return res && res.insertedId
}

const updateOne = async (coll, filter, m) => {
  const res = await db.collection(coll).updateOne(filter, { $set: m }, { upsert: true })
  if (!(res && res.acknowledged)) {
    throw new Error('update error - ' + coll)
  }
}

const updateMany = async (coll, filter, fieldValues, options) => {
  const res = await db.collection(coll).updateMany(filter, { $set: fieldValues }, options)
  if (!(res && res.acknowledged)) {
    throw new Error('updateMany error - ' + coll)
  }
}

const bulkWrite = async (coll, opers) => {
  const res = await db.collection(coll).bulkWrite(opers, { ordered: false })
  return res?.isOk?.()
}

const findOne = async (coll, filter, options) => {
  return await db.collection(coll).findOne(filter, options)
}

const find = async (coll, filter, options) => {
  const cursor = await db.collection(coll).find(filter, options)
  return await cursor.toArray()
}

const estimatedCount = async (coll) => {
  return await db.collection(coll).estimatedDocumentCount()
}

const countDocuments = async (coll, filter) => {
  return await db.collection(coll).countDocuments(filter)
}

const aggregate = async (coll, pipeline) => {
  const cursor = await db.collection(coll).aggregate(pipeline)
  return await cursor.toArray()
}

const groupCount = async (coll, field, itor) => {
  const p = [
    {
      $group: {
        _id: '$' + field,
        count: {
          $sum: 1,
        },
      },
    },
  ]
  const c = await db.collection(coll).aggregate(p)
  itor && (await c.forEach((e) => itor(e._id, e.count)))
  return await c.toArray()
}

const groupSum = async (coll, field, fieldSum, itor) => {
  const p = [
    {
      $group: {
        _id: field ? '$' + field : null,
        sum: {
          $sum: '$' + fieldSum,
        },
      },
    },
  ]
  const c = await db.collection(coll).aggregate(p)
  itor && (await c.forEach((e) => itor(e._id, e.sum)))
  return await c.toArray()
}

module.exports = {
  connected,
  connect,
  sanitize,
  sanitizeStr,

  insert,
  updateOne,
  updateMany,
  bulkWrite,
  findOne,
  find,
  estimatedCount,
  countDocuments,
  aggregate,
  groupCount,
  groupSum,
}
