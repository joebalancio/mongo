/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

/**
 * @example
 *
 * ```javascript
 * var mio = require('mio');
 * var MongoDB = require('mio-mongo');
 *
 * var User = mio.Resource.extend({
 *   attributes: {
 *     id: {
 *       primary: true,
 *       alias: '_id'
 *     }
 *   },
 * });
 *
 * User.use(MongoDB({
 *   url: 'mongodb://db.example.net:2500',
 *   collection: 'Users'
 * }));
 * ```
 *
 * @module mio-mongo
 */

/**
 * Emitted with `query` argument whenever a `query` is received and before it
 * is processed, to allow for transformation.
 *
 * @event mongodb:query
 * @param {Object} query
 */

/**
 * Emitted whenever a collection of resources is returned.
 *
 * @event mongodb:collection
 * @param {Array<mio.Resource>} collection
 * @param {Number} collection.from
 * @param {Number} collection.size
 */

// Dependencies
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

// Track whether resources share settings object.
var loaded = false;

/**
 * It is recommended to share the same `settings` object between different
 * resources so they can share the same mongo client and connection pool.
 *
 * A connection to mongo will be established automatically before any query is
 * run.
 *
 * If you'd like to use the mongo client directly, it's available via
 * `Resource.mongo` and once connected the collection will be available via
 * `Resource.mongo.collection`.
 *
 *
 * @param {Object} settings
 * @param {String} settings.url mongodb connection string
 * @param {String} settings.collection mongodb collection for this resource
 * @param {Object=} settings.options mongodb connection options
 * @param {Number=} settings.retry connection retry delay in milliseconds
 * (default: 1000)
 * @param {mongodb.MongoClient=} settings.client mongo client instance to use
 * @return {Function} returns Mio plugin
 */
module.exports = function (settings) {
  return function (Resource) {
    if (!settings.client) {
      // client is shared with resources that share settings object
      settings.client = new MongoClient();

      if (loaded) {
        console.warn(
          "[warning] resources should share a setings object to "
          + "ensure they share a connection pool");
      } else {
        loaded = true;
      }
    }

    Resource.options.mongo = settings;
    Resource.mongo = settings.client;

    if (!settings.collection) {
      throw new Error("must specify a collection name");
    }

    if (typeof settings.retry !== 'number') {
      settings.retry = 1000;
    }

    // event handlers to translate attributes from mongo documents
    Resource
      .on('set', translateAliasesToNames)
      .on('reset', translateAliasesToNames)
      .on('initialize', translateAliasesToNames);

    // event handlers that persist or retrieve resources
    Resource
      .before('get', createEventHandler('findOne'))
      .before('put', function (query, representation, next, resource) {
        if (((!resource && Resource(representation)) || resource).isNew()) {
          exports.create.call(this, resource.toJSON(), next, resource);
        } else {
          exports.update.call(this, query, resource.toJSON(), next);
        }
      })
      .before('patch', createEventHandler('update'))
      .before('post', createEventHandler('create'))
      .before('delete', createEventHandler('destroy'))
      .before('collection:get', createEventHandler('find'))
      .before('collection:patch', createEventHandler('updateMany'))
      .before('collection:delete', createEventHandler('destroyMany'));
  };
};

/**
 * Find a resource with given `query`.
 *
 * @param {Object} query
 * @param {Function} next
 * @fires mongodb:query
 * @private
 */
exports.findOne = function (query, next) {
  var Resource = this;

  Resource.emit('mongodb:query', query);

  if (typeof query === 'string') {
    var id = query;
    query = { where: {} };
    query.where[Resource.primaryKey] = id;
  }

  Resource.mongo.collection.findOne(
    translateNamesToAliases(whereQuery(query), Resource.attributes),
    buildQueryOptions(query),
    function (err, doc) {
      if (err) return next(err);

      if (doc) {
        next(null, new Resource(doc));
      } else {
        next();
      }
    });
};

/**
 * Find resources with given `query`.
 *
 * @param {Object} query
 * @param {Function} next
 * @fires mongodb:query
 * @fires mongodb:collection
 * @private
 */
exports.find = function (query, next) {
  var Resource = this;
  var options = buildQueryOptions(query);
  var mongoQuery = translateNamesToAliases(whereQuery(query), this.attributes);

  Resource.emit('mongodb:query', query);

  var cursor = Resource.mongo.collection.find(mongoQuery, options);

  ['sort', 'skip', 'limit'].forEach(function (filter) {
    if (options[filter]) {
      cursor[filter](options[filter]);
    }
  });

  cursor.toArray(function (err, docs) {
    if (err) return next(err);

    var collection = docs.map(function (doc) {
      return new Resource(doc);
    });

    collection.from = options.skip || 0;
    collection.size = options.limit || 25;

    Resource.emit('mongodb:collection', collection);

    next(null, collection);
  });
};

/**
 * Create resource using given `body`.
 *
 * @param {Object} body
 * @param {Function} next
 * @param {Resource=} resource
 * @private
 */
exports.create = function (body, next, resource) {
  this.mongo.collection.insert(
    translateNamesToAliases(body, this.attributes, resource),
    { w: 1 },
    function (err, result) {
      if (err) return next(err);

      if (resource) {
        resource.reset(result.pop());
      }

      next();
    });
};

/**
 * Update resource using given `changes`.
 *
 * @param {Resource} resource
 * @param {Object} changes
 * @param {Function} next
 * @private
 */
exports.update = function (query, changes, next) {
  var set = translateNamesToAliases(changes, this.attributes);
  delete set[this.attributes[this.primaryKey].alias || this.primaryKey];
  this.mongo.collection.update(
    translateNamesToAliases(whereQuery(query), this.attributes, set),
    { $set: set },
    function (err, result) {
      next(err);
    });
};

/**
 * Update resources matching `query` using given `changes`.
 *
 * @param {Object} query
 * @param {Object} changes a single set of changes or patch to apply
 * @param {Function(Error)} next
 * @fires mongodb:query
 * @private
 */
exports.updateMany = function (query, changes, next) {
  this.emit('mongodb:query', query);

  this.mongo.collection.update(
    translateNamesToAliases(whereQuery(query), this.attributes),
    translateNamesToAliases(changes, this.attributes),
    buildQueryOptions(query),
    function (err, result) {
      next(err);
    });
};

/**
 * Remove resource.
 *
 * @param {Resource} resource
 * @param {Function(Error)} next
 * @private
 */
exports.destroy = function (query, next) {
  this.mongo.collection.remove(query, function (err, result) {
    next(err);
  });
};

/**
 * Remove resources matching given `query`.
 *
 * @param {Object} query
 * @param {Function(Error)} next
 * @fires mongodb:query
 * @private
 */
exports.destroyMany = function (query, next) {
  this.emit('mongodb:query', query);

  this.mongo.collection.remove(
    translateNamesToAliases(whereQuery(query), this.attributes),
    buildQueryOptions(query),
    function (err, result) {
      next(err);
    });
};

/**
 * Create resource event handler for given `method`.
 *
 * Ensures `connect()` is called before the actual event handlers.
 *
 * @param {String} method
 * @private
 */
function createEventHandler (method) {
  return function () {
    var next = arguments[arguments.length - 1];
    var args = arguments;

    connect(this, function (err) {
      if (err) return next(err);

      exports[method].apply(this, args);
    });
  };
}

/**
 * Establish connection with MongoDB.
 *
 * @param {Resource} Resource
 * @param {Function(Error)} done
 * @private
 */
function connect (Resource, done) {
  var settings = Resource.options.mongo;
  var mongo = Resource.mongo;

  if (mongo.connected) {
    done.call(Resource);
  } else if (mongo.connecting) {
    setTimeout(function() {
      connect(Resource, done);
    }, settings.retry);
  } else {
    mongo.connecting = true;

    mongo.connect(settings.url, settings.options, function(err, db) {
      mongo.connecting = false;

      if (err) {
        return done(err);
      }

      mongo.connected = true;
      mongo.collection = db.collection(settings.collection);
      settings.db = db;

      db.on('close', function() {
        mongo.connected = false;
      });

      done.call(Resource);
    });
  }
}

/**
 * Translate attribute names to aliases before querying.
 *
 * @param {Object} query
 * @param {Object} attributes
 * @return {Object}
 * @private
 */
function translateNamesToAliases (query, attributes) {
  for (var key in query) {
    var attr = attributes[key];
    var alias = attr && attr.alias;
    var value = query[key];

    if (typeof value !== 'undefined') {
      if (alias) {
        query[alias] = value;
        delete query[key];
      }

      if (attr && (attr.primary || attr.index)) {
        if (ObjectID.isValid(value)) {
          query[alias || key] = new ObjectID(value);
        }
      }
    }

    if (value && typeof value === 'object' && value.constructor !== ObjectID) {
      translateNamesToAliases(value, attributes);
    }
  }

  return query;
}

/**
 * Translate alias when setting attributes.
 *
 * @param {Resource} resource
 * @param {Object} attributes
 * @return {Object}
 */
function translateAliasesToNames (resource, attributes) {
  for (var key in resource.constructor.attributes) {
    var attr = resource.constructor.attributes[key];
    var alias = attr && attr.alias;
    var value = attributes[alias || key];

    if (typeof value !== 'undefined') {
      if (alias) {
        attributes[key] = attributes[alias];
        delete attributes[alias];
      }

      if (attr && (attr.primary || attr.index)) {
        attributes[key] = attributes[key].toString();
      }
    }

    if (typeof value === 'object' && value.constructor !== ObjectID) {
      translateAliasesToNames(resource, value);
    }
  }

  return attributes;
}

/**
 * Returns MongoDB query options from given `query`.
 *
 * @param {Object} query
 * @return {Object} returns MongoDB query options
 * @private
 */
function buildQueryOptions (query) {
  var opts = {};

  for (var key in query) {
    if (key !== 'where') {
      if (isNaN(query[key])) {
        opts[key] = query[key];
      } else {
        opts[key] = Number(query[key]);
      }
    }
  }

  if (opts.sort) {
    for (var key in opts.sort) {
      var sort = opts.sort[key];
      if (typeof sort === 'string' && !isNaN(sort)) {
        opts.sort[key] = Number(sort);
      }
    }
  }

  // set `skip` and `limit` from paging parameters
  var skip = Number(opts.from || 0);
  var limit = Number(opts.size || 25);

  if (!skip && opts.page) {
    skip = Number(opts.page) * limit;
  }

  opts.skip = skip;
  opts.limit = limit;

  return opts;
}

/**
 * Move top-level query properties into query.where
 *
 * @param {Object} query
 * @return {Object}
 * @private
 */
function whereQuery (query) {
  if (!query.where) {
    query.where = {};

    for (var key in query) {
      if (!key.match(/(where|from|size|sort|withRelated)/)) {
        if (query.hasOwnProperty && query.hasOwnProperty(key)) {
          query.where[key] = query[key];
        }
      }
    }
  }

  return query.where || {};
}
