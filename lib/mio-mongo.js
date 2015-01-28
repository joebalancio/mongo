/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

/**
 * @example
 *
 * ## Basic usage
 *
 * ```javascript
 * var mio = require('mio');
 * var MongoDB = require('mio-mongo');
 *
 * var User = mio.Resource.extend({
 *   attributes: {
 *     _id: {
 *       primary: true,
 *       objectId: true
 *     }
 *   }
 * });
 *
 * User.use(MongoDB({
 *   url: 'mongodb://db.example.net:2500',
 *   collection: 'Users'
 * }));
 *
 * User.Collection.get()
 *   .where({ active: true })
 *   .sort({ createdAt: 1 })
 *   .exec(function (err, users) {
 *     users.at(0).set({ active: false }).patch(function (err) {
 *       // ...
 *     });
 *   });
 * ```
 *
 * ## Relations
 *
 * ```javascript
 * Post.belongsTo('author', {
 *   target: User,
 *   foreignKey: 'authorId'
 * });
 *
 * User.hasMany('posts', {
 *   target: Post,
 *   foreignKey: 'authorId'
 * });
 *
 * // fetch posts for user `123`
 * Post.Collection.get()
 *   .where({ 'author.id': 123 })
 *   .exec(function (err, posts) {
 *     // ...
 *   });
 *
 * // fetch users with their posts included
 * User.Collection.get()
 *   .withRelated('posts')
 *   .exec(function (err, users) {
 *     users.pop().posts;
 *   });
 * ```
 *
 * ## Aliases
 *
 * ```javascript
 * var User = mio.Resource.extend({
 *   attributes: {
 *     name: {
 *       alias: 'fullName'
 *     }
 *   }
 * });
 *
 * // MongoDB query uses "fullName"
 * User.find({ name: 'Alex' }).exec(...);
 * ```
 *
 * ## ObjectId
 *
 * Automatically stringify and cast ObjectId's by setting `objectId: true`.
 *
 * ```javascript
 * var User = mio.Resource.extend({
 *   attributes: {
 *     companyId: {
 *       objectId: true
 *     }
 *   }
 * });
 *
 * User.find({
 *   companyId: '547dfc2bdc1e430000ff13b0'
 * }).exec(function (err, user) {
 *   console.log(typeof user.companyId); // => "string"
 * });
 * ```
 *
 * @module mio-mongo
 */

/**
 * @external mio
 * @see {@link https://github.com/mio/mio}
 */

/**
 * @name Resource
 * @memberof external:mio
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
 * @param {external:mio.Resource.Collection} collection
 * @param {Number} collection.from
 * @param {Number} collection.size
 */

// Dependencies
var async = require('async');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

var methods = {
  hasOne: 'findOne',
  hasMany: 'find',
  belongsTo: 'findOne'
};

/**
 * It is recommended to share the same `settings.db` object between
 * different resources so they can share the same mongo client and connection
 * pool.
 *
 * A connection to mongo will be established automatically before any query is
 * run.
 *
 * If you'd like to use the mongo client directly, the `db` is available via
 * `Resource.options.mongo.db`.
 *
 * @param {Object} settings
 * @param {String} settings.collection mongodb collection for this resource
 * @param {String=} settings.connectionString mongodb connection string. required
 * if `settings.db` is not provided.
 * @param {Object=} settings.connectionOptions mongodb connection options
 * @param {mongodb.MongoClient.Db=} settings.db reuse node-mongo-native db
 * connection
 * @return {Function} returns Mio plugin
 */
module.exports = function createMioMongoPlugin(settings) {
  return function MioMongoPlugin(Resource) {
    if (!settings.connectionString && !settings.db) {
      throw new Error('connectionString or db is required');
    }

    if (!settings.collection) {
      throw new Error('must specify a collection name');
    }

    Resource.options.mongo = settings;

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
      .before('patch', exports.update)
      .before('post', exports.create)
      .before('delete', exports.destroy)
      .before('collection:get', exports.find)
      .before('collection:patch', exports.updateMany)
      .before('collection:delete', exports.destroyMany);
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
  var where = query.where();
  var cached = {};

  Resource.emit('mongodb:query', query);

  // (n) relations are accounted for using an array of mongodb operations
  var ops = [
    function (next) {
      next(null, {});
    }
  ];

  // iterate over where clause to find where[relation] queries
  Object.keys(where).forEach(function (key) {
    var keyArr = key.split('.');
    var relationName = keyArr[0];
    var nestedName = keyArr.length > 2 && keyArr[1];
    var attr = Resource.attributes[relationName];
    var relation = attr && attr.relation;

    if (relation) {
      var nestedAttr = nestedName && relation.target.attributes[nestedName];
      var nestedRelation = nestedAttr && nestedAttr.relation;
      var whereRelation = unpack(clone(where))[relationName];

      if (nestedRelation) {
        var nestedWhere = whereRelation[nestedName];

        // remove where[relation] clause so it is not passed to mongo client
        delete whereRelation[nestedName];

        // operation to fetch target resources to filter intermediary resources
        ops.push(function (filter, next) {
          var relPrimaryKey = relation.target.primaryKey;
          var nestedPrimaryKey = nestedRelation.target.primaryKey;
          var nestedForeignKey = nestedRelation.foreignKey;
          var find = mongoExec(nestedRelation.target, 'find');

          find(nestedWhere, {}, function (err, docs) {
            if (err) return next(err);

            // add $in query to filter intermediary resources
            if (nestedRelation.type === 'belongsTo') {
              $in(docs, whereRelation, nestedForeignKey, nestedPrimaryKey);
            } else {
              $in(docs, whereRelation, relPrimaryKey, nestedForeignKey);
            }

            next(null, filter);
          });
        });
      }

      // remove where[relation] clauses so they are not passed to mongo client
      delete mongoQuery[key];
      delete mongoQuery[relationName];

      // operation to fetch intermediary resources used to filter resources
      ops.push(function (filter, next) {
        var targetPrimaryKey = relation.target.primaryKey;
        var find = mongoExec(relation.target, 'find');

        find(whereRelation, {}, function (err, docs) {
            if (err) return next(err);

            // add $in query to filter resources
            if (relation.type === 'belongsTo') {
              $in(docs, filter, relation.foreignKey, targetPrimaryKey);
            } else {
              $in(docs, filter, Resource.primaryKey, relation.foreignKey);
            }

            cached[relationName] = docs;

            next(null, filter);
          });
      });
    }
  });

  // fetch primary resource for this query
  ops.push(function (filter, next) {
    // Receive optional list of ids from previous relational query (if any).
    // For example, `/users?where[project.status]=active` would first select
    // active projects and then related users of those projects.
    Object.keys(filter).forEach(function (key) {
      mongoQuery[key] = mongoQuery[key] || {};
      mongoQuery[key].$in = mongoQuery[key].$in || [];

      filter[key].$in.forEach(function (id) {
        mongoQuery[key].$in.push(id);
      });
    });

    var findOne = mongoExec(Resource, 'findOne');

    findOne(mongoQuery, mongoOptions, function (err, doc) {
      if (doc) {
        next(err, Resource.create(doc));
      } else {
        next(err, null);
      }
    });
  });

  // add mongodb query operations for each included relationship
  if (withRelated) {
    Object.keys(withRelated).forEach(function (relationName) {
      var attr = Resource.attributes[relationName];
      var relation = attr.relation;
      var relationQueryOpts = withRelated[relationName];
      var RelatedResource = relation.target;
      var rquery = {};

      ops.push(function (resource, next) {
        // use results from previous filter query
        if (cached[relationName]) {
          if (cached[relationName] instanceof Array) {
            resource[relationName] = RelatedResource.Collection.create(
              cached[relationName]
            );
          } else {
            resource[relationName] = RelatedResource.create(
              cached[relationName]
            );
          }


          return next(null, resource);
        }

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
  var mongoQuery = namesToAliases(query.where(), this.attributes);
  var mongoOptions = buildQueryOptions(query);
  var withRelated = query.withRelated();
  var where = query.where();
  var cached = {};

  Resource.emit('mongodb:query', query);

  // (n) relations are accounted for using an array of mongodb operations
  var ops = [
    function (next) {
      next(null, {});
    }
  ];

  // add relation filters for where[relation] queries
  Object.keys(where).forEach(function (key) {
    var keys = key.split('.');
    var relationName = keys[0];
    var attr = Resource.attributes[relationName];
    var relation = attr && attr.relation;

    if (relation) {
      var nestedName = keys.length > 2 && keys[1];
      var nestedAttr = nestedName && relation.target.attributes[nestedName];
      var nestedRelation = nestedAttr && nestedAttr.relation;
      var whereRelation = unpack(clone(where))[relationName];

      if (nestedRelation) {
        var nestedWhere = whereRelation[nestedName];

        // remove where[relation] clause so it is not passed to mongo client
        delete whereRelation[nestedName];

        // operation to fetch target resources to filter intermediary resources
        ops.push(function (filter, next) {
          var find = mongoExec(nestedRelation.target, 'find');
          var primaryKey = relation.target.primaryKey;
          var nestedPrimaryKey = nestedRelation.target.primaryKey;
          var nestedForeignKey = nestedRelation.foreignKey;

          find(nestedWhere, {}, function (err, docs) {
            if (err) return next(err);

            // add $in query to filter intermediary resources
            if (nestedRelation.type === 'belongsTo') {
              $in(docs, whereRelation, nestedForeignKey, nestedPrimaryKey);
            } else {
              $in(docs, whereRelation, primaryKey, nestedForeignKey);
            }

            next(null, filter);
          });
        });
      }

      // remove where[relation] clauses so they are not passed to mongo client
      delete mongoQuery[key];
      delete mongoQuery[relationName];

      // operation to fetch intermediary resources used to filter resources
      ops.push(function (filter, next) {
        var find = mongoExec(relation.target, 'find');
        var targetPrimaryKey = relation.target.primaryKey;

        find(whereRelation, {}, function (err, docs) {
            if (err) return next(err);

            // add ids to correct foreign key filter
            // add $in query to filter resources
            if (relation.type === 'belongsTo') {
              $in(docs, filter, relation.foreignKey, targetPrimaryKey);
            } else {
              $in(docs, filter, Resource.primaryKey, relation.foreignKey);
            }

            cached[relationName] = docs;

            next(null, filter);
          });
      });
    }
  });

  // fetch primary resource for this query
  ops.push(function (filter, next) {
    // Receive optional list of ids from previous relational query (if any).
    // For example, `/users?where[project.status]=active` would first select
    // active projects and then related users of those projects.
    Object.keys(filter).forEach(function (key) {
      mongoQuery[key] = mongoQuery[key] || {};
      mongoQuery[key].$in = mongoQuery[key].$in || [];

      filter[key].$in.forEach(function (id) {
        mongoQuery[key].$in.push(id);
      });
    });

    var find = mongoExec(Resource, 'find');

    find(mongoQuery, mongoOptions, function (err, docs) {
      if (err) return next(err);

      var collection = new Resource.Collection(docs, {
        query: query
      });

      Resource.emit('mongodb:collection', collection);

      next(null, collection);
    });
  });

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
        // use results from previous filter query
        if (cached[relationName]) {
          if (cached[relationName] instanceof Array) {
            resources.forEach(function (resource) {
              resource[relationName] = RelatedResource.Collection.create(
                cached[relationName]
              );
            });
          } else {
            resources.forEach(function (resource) {
              resource[relationName] = RelatedResource.create(
                cached[relationName]
              );
            });
          }

          return next(null, resources);
        }


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
 * @param {external:mio.Resource=} resource
 * @private
 */
exports.create = function (body, next, resource) {
  var Resource = this;

  mongoExec(Resource, 'insert')(
    namesToAliases(body, Resource.attributes),
    { w: 1 },
    function (err, result) {
      if (err) return next(err);

      if (!resource) {
        resource = new Resource();
      }

      resource.reset(result.pop());

      next();
    });
};

/**
 * Update resource using given `changes`.
 *
 * @param {external:mio.Resource} resource
 * @param {Object} changes
 * @param {Function} next
 * @private
 */
exports.update = function (query, changes, next, resource) {
  var set = namesToAliases(changes, this.attributes);
  delete set[this.attributes[this.primaryKey].alias || this.primaryKey];
  mongoExec(this, 'update')(
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

  mongoExec(this, 'update')(
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
 * @param {external:mio.Resource} resource
 * @param {Function(Error)} next
 * @private
 */
exports.destroy = function (query, next) {
  mongoExec(this, 'remove')(query, function (err, result) {
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

  mongoExec(this, 'remove')(
    namesToAliases(query.where(), this.attributes),
    buildQueryOptions(query),
    function (err, result) {
      next(err);
    });
};

/**
 * Return mongo driver method wrapped to ensure database connection and apply
 * filters.
 *
 * @param {external:mio.Resource} Resource
 * @param {String} method
 * @returns {Function}
 * @private
 */
function mongoExec(Resource, method) {
  var settings = Resource.options.mongo;
  var connection = settings.db;

  return function () {
    var args = arguments;
    var cb = args[args.length - 1];

    if (connection) {
      if (!settings.dbCollection) {
        settings.dbCollection = connection.collection(settings.collection);
      }

      MioMongoExec();
    } else {
      (new MongoClient()).connect(
        settings.connectionString,
        (settings.connectionOptions || {}),
        function (err, db) {
          if (err) return cb(err);

          settings.db = db;
          settings.dbCollection = db.collection(settings.collection);

          MioMongoExec();
        });
    }

    function MioMongoExec () {
      if (method === 'find') {
        var query = args[0];
        var options = args[1];
        var cursor = settings.dbCollection.find(query, options);

        ['sort', 'skip', 'limit'].forEach(function (filter) {
          if (options[filter]) {
            cursor[filter](options[filter]);
          }
        });

        cursor.toArray(cb);
      } else {
        settings.dbCollection[method].apply(settings.dbCollection, args);
      }
    }
  };
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

      if (attr && (attr.primary || attr.objectId)) {
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
 * @param {external:mio.Resource} resource
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

      if (attr && (attr.primary || attr.objectId)) {
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
  } else if (typeof query.toJSON === 'function') {
    query = query.toJSON();
  }

  var options = {};
  var sort = query.sort;

  if (sort) {
    options.sort = {};

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

/**
 * Unpack object using object notation `path`.
 *
 * @param {Object} obj
 * @param {String=} path
 * @returns {Object}
 * @private
 */
function unpack(obj, scope) {
  if (scope) {
    var scopeArr = scope.split('.');
    var head = scopeArr.shift();
    var tail = scopeArr.join('.');
    var val = obj[scope];

    if (tail) {
      obj[head] = {};
      obj[head][tail] = val;
      delete obj[scope];
      unpack(obj[head], tail);
    } else {
      if (typeof obj[head] === 'object') {
        unpack(obj[head]);
      }
    }
  } else {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (typeof obj[key] === 'string') {
          unpack(obj, key);
        }
        if (typeof obj[key] === 'object') {
          unpack(obj[key]);
        }
      }
    }
  }

  return obj;
}

function $in(docs, obj, key, docKey) {
  if (!obj[key]) {
    obj[key] = {};
    if (!obj[key].$in) {
      obj[key].$in = [];
    }
  }

  docs.forEach(function (doc) {
    obj[key].$in.push(doc[docKey]);
  });

  return obj[key].$in;
}

function clone (source) {
  var obj = {};

  for (var key in source) {
    if (source.hasOwnProperty(key)) {
      obj[key] = source[key];
    }
  }

  return obj;
}
