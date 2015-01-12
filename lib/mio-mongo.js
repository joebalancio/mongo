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
 * Emitted whenever a collection of resources is returned. Collections returned
 * by `mio-mongo` include `size` and `from` pagination properties.
 *
 * @event mongodb:collection
 * @param {Resource.Collection} collection
 * @param {Number} collection.from
 * @param {Number} collection.size
 */

// Dependencies
var async = require('async');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

// Track whether resources share settings object.
var loaded = false;

var methods = {
  hasOne: 'findOne',
  hasMany: 'find',
  belongsTo: 'findOne'
};

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
      .before('get', exports.findOne)
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
      .before('collection:get', exports.find)
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
exports.findOne = function (query, done) {
  var Resource = this;
  var mongoQuery = namesToAliases(query.where(), Resource.attributes);
  var mongoOptions = buildQueryOptions(query);
  var withRelated = query.withRelated();

  Resource.emit('mongodb:query', query);

  // (n) relations are accounted for using an array of mongodb operations
  var ops = [
    function (next) {
      var findOne = mongoExec(Resource, 'findOne');

      findOne(mongoQuery, mongoOptions, function (err, doc) {
        if (doc) {
          next(err, Resource.create(doc));
        } else {
          next(err);
        }
      });
    }
  ];

  // add mongodb query operations for each included relationship
  if (withRelated) {
    Object.keys(withRelated).forEach(function (relationName) {
      var attr = Resource.attributes[relationName];
      var relation = attr.relation;
      var relationQueryOpts = withRelated[relationName];
      var RelatedResource = relation.target;
      var rquery = {};

      ops.push(function (resource, next) {

        // move to the bottom of the waterfall if we don't have anything
        if (!resource) {
          return next(null, null);
        }

        // prepare query to fetch related resource(s)
        if (relation.type === 'belongsTo') {
          rquery[RelatedResource.primaryKey] = resource[relation.foreignKey];
        } else {
          rquery[relation.foreignKey] = resource.primary;
        }

        // fetch related resource(s) and populate parent resource attribute
        mongoExec(RelatedResource, methods[relation.type])(
          namesToAliases(rquery, RelatedResource.attributes),
          buildQueryOptions(relationQueryOpts),
          function (err, result) {
            if (err) return next(err);

            if (result instanceof Array) {
              resource[relationName] = RelatedResource.Collection.create(result);
            } else {
              resource[relationName] = RelatedResource.create(result);
            }

            next(null, resource);
          });
      });

      if (relation.nested || relationQueryOpts.nested) {

        // add mongo query operations for each intermediary resource's
        // relationships... sure would be easier with a JOIN :p
        Object.keys(RelatedResource.attributes).forEach(function (key) {
          var attr = RelatedResource.attributes[key];
          var throughRelation = attr && attr.relation;

          throughRelation && ops.push(function (resource, next) {

            // move to the bottom of the waterfall if we don't have anything
            if (!resource) {
              return next(null, null);
            }

            var RelatedResource = throughRelation.target;
            var relationType = throughRelation.type;
            var foreignKey = throughRelation.foreignKey;
            var throughAttr = throughRelation.attribute;
            var intermediaries = {};

            // build query for related resources using intermediary (through)
            // resource attributes
            rquery = {};

            if (relationType === 'belongsTo') {
              rquery[RelatedResource.primaryKey] = {
                $in: resource[relationName].map(function (through) {
                  intermediaries[through[foreignKey]] = through;
                  return through[foreignKey];
                })
              }
            } else if (relationType === 'hasOne') {
              rquery[foreignKey] = {
                $in: resource[relationName].map(function (through) {
                  intermediaries[through.primary] = through;
                  return through.primary;
                })
              }
            } else {
              rquery[foreignKey] = {
                $in: resource[relationName].map(function (through) {
                  intermediaries[resource.primary] = through;
                  return resource.primary;
                })
              }
            }

            // fetch related resource(s) using query built from intermediary
            // (through) resources
            mongoExec(RelatedResource, 'find')(
              namesToAliases(rquery, RelatedResource.attributes),
              buildQueryOptions(relationQueryOpts.nested),
              function (err, docs) {
                if (err) return next(err);

                // populate the intermediary (through) resource relation
                // attributes with their related resources
                docs.forEach(function (doc, i) {
                  var related = new RelatedResource(doc);
                  var through;

                  if (relationType === 'belongsTo') {
                    through = intermediaries[related.primary];
                  } else {
                    through = intermediaries[related[foreignKey]];
                  }

                  if (through) {
                    if (relationType === 'hasMany') {
                      if (i === 0) {
                        through[throughAttr] = new RelatedResource.Collection();
                      }

                      through[throughAttr].push(related);
                    } else {
                      through[throughAttr] = related;
                    }
                  }
                });

                next(null, resource);
              });
          });
        });
      }
    });
  }

  async.waterfall(ops, done);
};

/**
 * Find resources with given `query`.
 *
 * @param {Object} query
 * @param {Function} done
 * @fires mongodb:query
 * @fires mongodb:collection
 * @private
 */
exports.find = function (query, done) {
  var Resource = this;
  var withRelated = query.withRelated();
  var mongoQuery = namesToAliases(query.where(), this.attributes);
  var mongoOptions = buildQueryOptions(query);

  Resource.emit('mongodb:query', query);

  // (n) relations are accounted for using an array of mongodb operations
  var ops = [
    function (next) {
      var find = mongoExec(Resource, 'find');

      find(mongoQuery, mongoOptions, function (err, docs) {
        if (err) return next(err);

        var collection = docs.map(function (doc) {
          return new Resource(doc);
        });

        collection.from = mongoOptions.skip || 0;
        collection.size = mongoOptions.limit || 25;

        Resource.emit('mongodb:collection', collection);

        next(null, Resource.Collection.create(collection));
      });
    }
  ];

  // add mongodb query operations for each included relationship
  if (withRelated) {
    Object.keys(withRelated).forEach(function (relationName) {
      var relationQueryOpts = withRelated[relationName];
      var attr = Resource.attributes[relationName];
      var relation = attr.relation;
      var relationType = relation.type;
      var RelatedResource = relation.through || relation.target;
      var intermediaries = {};
      var rquery = {};

      ops.push(function (resources, next) {

        // move to the bottom of the waterfall if we don't have anything
        if (!resources || !resources.length) {
          return next(null, null);
        }

        // iterate over found resources and build query to fetch related
        // resources for this relation... sure would be easier with a JOIN :p
        resources.forEach(function (resource) {
          if (relation.type === 'belongsTo') {
            if (!rquery[RelatedResource.primaryKey]) {
              rquery[RelatedResource.primaryKey] = { $in: [] };
            }

            rquery[RelatedResource.primaryKey].$in.push(
              resource[relation.foreignKey]
            );
          } else {
            if (!rquery[relation.foreignKey]) {
              rquery[relation.foreignKey] = { $in: [] };
            }

            rquery[relation.foreignKey].$in.push(resource.primary);
          }

          if (relationType === 'hasMany') {
            resource[relationName] = RelatedResource.Collection.create();
          }

          if (relationType === 'belongsTo') {
            resources[resource[relation.foreignKey]] = resource;
          } else {
            resources[resource.primary] = resource;
          }
        });

        // fetch related resources and populate relation attribute
        mongoExec(RelatedResource, 'find')(
          namesToAliases(rquery, RelatedResource.attributes),
          buildQueryOptions(relationQueryOpts),
          function (err, result) {
            if (err) return next(err);

            result.forEach(function (result) {
              var related = RelatedResource.create(result);
              var resource;

              if (relationType === 'belongsTo') {
                resource = resources[related.primary];
              } else {
                resource = resources[related[relation.foreignKey]];
              }

              if (resource) {
                if (relationType === 'belongsTo' || relationType === 'hasOne') {
                  resource[relationName] = RelatedResource.create(result);
                } else {
                  resource[relationName].push(RelatedResource.create(result));
                }
              }
            });

            next(null, resources);
          });
      });

      if (relation.nested || relationQueryOpts.nested) {

        // add mongo query operations for each intermediary resource's
        // relationships... sure would be easier with a JOIN :p
        Object.keys(RelatedResource.attributes).forEach(function (key) {
          var attr = RelatedResource.attributes[key];
          var throughRelation = attr && attr.relation;

          throughRelation && ops.push(function (resources, next) {

            // move to the bottom of the waterfall if we don't have anything
            if (!resources || !resources.length) {
              return next(null, null);
            }

            var RelatedResource = throughRelation.target;
            var relationType = throughRelation.type;
            var primaryKey = RelatedResource.primaryKey;
            var foreignKey = throughRelation.foreignKey;
            var throughAttr = throughRelation.attribute;
            var intermediaries = {};

            // build query for related resources using intermediary (through)
            // resource attributes
            rquery = {};

            if (relationType === 'belongsTo') {
              // "belongsTo" query uses primary key of related resource
              rquery[primaryKey] = {
                $in: []
              };

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  intermediaries[through[foreignKey]] = through;
                  rquery[primaryKey].$in.push(through[foreignKey]);
                });
              });
            } else if (relationType === 'hasOne')  {
              // "hasOne" and "hasMany" queries use foreign key of related
              // resource
              rquery[foreignKey] = {
                $in: []
              };

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  intermediaries[through.primary] = through;
                  rquery[foreignKey].$in.push(through.primary);
                });
              });
            } else {
              // "hasOne" and "hasMany" queries use foreign key of related
              // resource
              rquery[foreignKey] = {
                $in: []
              };

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  intermediaries[resource.primary] = through;
                  rquery[foreignKey].$in.push(resource.primary);
                });
              });
            }

            // fetch related resource(s) using query built from intermediary
            // (through) resources
            mongoExec(RelatedResource, 'find')(
              namesToAliases(rquery, RelatedResource.attributes),
              buildQueryOptions(relationQueryOpts.nested),
              function (err, docs) {
                if (err) return next(err);

                // populate the intermediary (through) resource relation
                // attributes with their related resources
                docs.forEach(function (doc, i) {
                  var related = new RelatedResource(doc);
                  var through;

                  if (relationType === 'belongsTo') {
                    through = intermediaries[related.primary];
                  } else {
                    through = intermediaries[related[foreignKey]];
                  }

                  if (through) {
                    if (relationType === 'hasMany') {
                      if (i === 0) {
                        through[throughAttr] = new RelatedResource.Collection();
                      }

                      through[throughAttr].push(related);
                    } else {
                      through[throughAttr] = related;
                    }
                  }
                });

                next(null, resources);
              });
          });
        });
      }
    });
  }

  async.waterfall(ops, done);
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
    namesToAliases(body, this.attributes, resource),
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
  var set = namesToAliases(changes, this.attributes);
  delete set[this.attributes[this.primaryKey].alias || this.primaryKey];
  this.mongo.collection.update(
    namesToAliases(query.where(), this.attributes, set),
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
    namesToAliases(query.where(), this.attributes),
    namesToAliases(changes, this.attributes),
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
    namesToAliases(query.where(), this.attributes),
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
 * Return mongo driver method wrapped to ensure database connection and apply
 * filters.
 *
 * @param {Resource} Resource
 * @param {String} method
 * @returns {Function}
 * @private
 */
function mongoExec(Resource, method) {

  return function MioMongoExec() {
    var args = arguments;
    var cb = args[args.length - 1];

    connect(Resource, function (err) {
      if (err) return cb(err);

      var collection = Resource.mongo.collection;

      if (method === 'find') {
        var query = args[0];
        var options = args[1];
        var cursor = collection.find(query, options);

        ['sort', 'skip', 'limit'].forEach(function (filter) {
          if (options[filter]) {
            cursor[filter](options[filter]);
          }
        });

        cursor.toArray(cb);
      } else {
        collection[method].apply(collection, args);
      }
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
function namesToAliases (query, attributes) {
  query = (typeof query.where === 'function') ? query.query : query;

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
      namesToAliases(value, attributes);
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
  if (!query) {
    query = {};
  }

  var options = query.toJSON ? query.toJSON() : query;
  var sort = query.sort;

  if (sort) {
    for (var key in sort) {
      var sortVal = sort[key];
      if (typeof sortVal === 'string' && !isNaN(sortVal)) {
        options.sort[key] = Number(sortVal);
      }
    }
  }

  // set `skip` and `limit` from paging parameters
  options.skip = Number(query.from || 0);
  options.limit = Number(query.size || 25);

  return options;
}
