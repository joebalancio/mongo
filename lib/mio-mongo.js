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
 * }, {
 *   use: [MongoDB({
 *     url: 'mongodb://db.example.net:2500'
 *   })]
 * });
 * ```
 *
 * @module mio-mongo
 */

/**
 * Dependencies
 */

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

/**
 * Track whether resources share settings object.
 */

var loaded = false;

/**
 * It is recommended to share the same `settings` object between different
 * resources so they can share a mongo connection pool.
 *
 * A connection to mongo will be established automatically before any query is
 * run.
 *
 * If you'd like to use the mongo client directly, it's available via
 * `Resource.mongo` and once connected the collection will be available via
 * `Resource.mongo.collection`.
 *
 * **Events**
 *
 *  - `mongodb query` Emitted with `query` argument whenever a `query` is
 *    received and before it is processed, to allow for transformation.
 *
 * @param {Object} settings
 * @param {String} settings.url mongodb connection string
 * @param {String} settings.collection mongodb collection for this resource
 * @param {Object=} settings.options mongodb connection options
 * @param {Number=} settings.retry connection retry delay in milliseconds
 * (default: 1000)
 * @param {mongodb.MongoClient=} settings.client mongo client instance
 * @return {Function(Resource)} returns Mio plugin
 */

module.exports = function (settings) {
  return function (Resource) {
    if (!settings.client) {
      // client is shared with resources that share settings object
      settings.client = new MongoClient();

      if (loaded) {
        console.log(
          "warning: settings object should be shared between resources to "
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
      .on('setting', translateAliasesToNames)
      .on('reset', translateAliasesToNames)
      .on('initializing', translateAliasesToNames);

    // event handlers that persist or retrieve resources
    Resource
      .before('find one', createEventHandler('findOne'))
      .before('find many', createEventHandler('find'))
      .before('count', createEventHandler('count'))
      .before('create', createEventHandler('create'))
      .before('update', createEventHandler('update'))
      .before('update many', createEventHandler('updateMany'))
      .before('destroy', createEventHandler('destroy'))
      .before('destroy many', createEventHandler('destroyMany'));
  };
};

/**
 * Find a resource with given `query`.
 *
 * @param {Object} query
 * @param {Function(Error, Resource)} next
 * @private
 */

exports.findOne = function (query, next) {
  var Resource = this;

  Resource.emit('mongodb query', query);

  Resource.mongo.collection.findOne(
    translateNamesToAliases(whereQuery(query), Resource.attributes),
    buildQueryOptions(query),
    function (err, doc) {
      if (err) return next(err);

      next(null, new Resource(doc));
    });
};

/**
 * Find resources with given `query`.
 *
 * @param {Object} query
 * @param {Function(Error, Array)} next
 * @private
 */

exports.find = function (query, next) {
  var Resource = this;

  Resource.emit('mongodb query', query);

  Resource.mongo.collection.find(
    translateNamesToAliases(whereQuery(query), Resource.attributes),
    buildQueryOptions(query)).toArray(function (err, docs) {
      if (err) return next(err);

      var collection = docs.map(function (doc) {
        return new Resource(doc);
      });

      collection.page = query.page || 1;
      collection.skip = query.skip || 0;

      next(null, collection);
    });
};

/**
 * Create resource using given `body`.
 *
 * @param {Resource} resource
 * @param {Object} body
 * @param {Function(Error, Resource)} next
 * @private
 */

exports.create = function (resource, body, next) {
  this.mongo.collection.insert(
    translateNamesToAliases(body, this.attributes),
    { w: 1 },
    function (err, result) {
      if (err) return next(err);

      next(null, resource.reset(result.pop()));
    });
};

/**
 * Update resource using given `changes`.
 *
 * @param {Resource} resource
 * @param {Object} changes
 * @param {Function(Error, Resource)} next
 * @private
 */

exports.update = function (resource, changes, next) {
  this.mongo.collection.update(filterByID(resource), {
    $set: translateNamesToAliases(changes, this.attributes)
  }, function (err, result) {
    if (err) return next(err);

    next(null, resource);
  });
};

/**
 * Update resources matching `query` using given `changes`.
 *
 * @param {Object} query
 * @param {Object} changes a single set of changes or patch to apply
 * @param {Function(Error)} next
 * @private
 */

exports.updateMany = function (query, changes, next) {
  this.emit('mongodb query', query);

  this.mongo.collection.update(
    translateNamesToAliases(whereQuery(query), this.attributes),
    translateNamesToAliases(changes, this.attributes),
    buildQueryOptions(query),
    function (err, result) {
      next(err);
    });
};

/**
 * Count resources matching given `query`.
 *
 * @param {Object} query
 * @param {Function(Error, Number)} next
 * @private
 */

exports.count = function (query, next) {
  this.emit('mongodb query', query);

  this.mongo.collection.count(
    translateNamesToAliases(whereQuery(query), this.attributes),
    buildQueryOptions(query),
    next);
};

/**
 * Remove resource.
 *
 * @param {Resource} resource
 * @param {Function(Error)} next
 * @private
 */

exports.destroy = function (resource, next) {
  this.mongo.collection.remove(filterByID(resource), function (err, result) {
    next(err);
  });
};

/**
 * Remove resources matching given `query`.
 *
 * @param {Object} query
 * @param {Function(Error)} next
 * @private
 */

exports.destroyMany = function (query, next) {
  this.emit('mongodb query', query);

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

    if (alias) {
      query[alias] = value;
      delete query[key];
    }

    if (attr && (attr.primary || attr.index)) {
      query[alias || key] = new ObjectID(value);
    } else if (typeof value === 'object') {
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

    if (value && alias) {
      attributes[key] = attributes[alias];
      delete attributes[alias];
    }

    if (value && (attr.primary || attr.index)) {
      attributes[key] = attributes[key].toString();
    } else if (typeof value === 'object') {
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
  var options = {};

  for (var key in query) {
    if (key !== 'where') {
      options[key] = query[key];
    }
  }

  return options;
}

/**
 * Move top-level query properties into query.where
 *
 * @param {Object} query
 * @return {Object}
 * @private
 */

function whereQuery (query) {
  var where;

  if (!query.where) {
    where = { where: {} };

    for (var key in query) {
      if (query.hasOwnProperty && query.hasOwnProperty(key)) {
        where[key] = query[key];
      }
    }
  }

  return where || query;
}

/**
 * Return MongoDB filter by primary key for given `resource`.
 *
 * @param {Resource} resource
 * @return {Object}
 * @private
 */

function filterByID (resource) {
  var filter = {};
  var primaryKey = resource.constructor.primaryKey;
  var attr = resource.constructor.attributes[primaryKey];

  filter[attr.alias || primaryKey] = resource.primary;

  return filter;
}
