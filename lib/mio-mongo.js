/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

/**
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
var Query = require('mio').Query;

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
  settings = settings || {};

  if (settings.url) {
    settings.connectionString = settings.url;
    delete settings.url;
  }

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
      .on('set', prepareResource)
      .on('reset', prepareResource)
      .on('initialize', prepareResource);

    // event handlers that persist or retrieve resources
    Resource
      .hook('get', exports.findOne)
      .hook('put', function (query, representation, next, resource) {
        if (!resource) {
          resource = Resource(representation);
        }
        if (resource.isNew()) {
          exports.create.call(this, representation, next, resource);
        } else {
          exports.replace.call(this, query, representation, next);
        }
      })
      .hook('patch', exports.update)
      .hook('post', exports.create)
      .hook('delete', exports.destroy)
      .hook('collection:get', exports.find)
      .hook('collection:put', exports.replaceMany)
      .hook('collection:patch', exports.updateMany)
      .hook('collection:post', exports.createMany)
      .hook('collection:delete', exports.destroyMany);
      
    // emit event signaling that plugin initialization has finished
    Resource.emit('mongo:initialize');
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
  var mongoQuery = prepareQueryOrDocument(query.where(), Resource.attributes);
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
      var target = factory(relation.target, Resource);
      var nestedAttr = nestedName && target.attributes[nestedName];
      var nestedRelation = nestedAttr && nestedAttr.relation;
      var whereRelation = unpack(clone(where))[relationName];

      if (nestedRelation) {
        var nestedWhere = whereRelation[nestedName];
        var nestedTarget = factory(nestedRelation.target, target);

        // remove where[relation] clause so it is not passed to mongo client
        delete whereRelation[nestedName];

        // operation to fetch target resources to filter intermediary resources
        ops.push(function (filter, next) {
          var relPrimaryKey = target.primaryKey;
          var nestedPrimaryKey = nestedTarget.primaryKey;
          var nestedForeignKey = nestedRelation.foreignKey;
          var find = mongoExec(nestedTarget, 'find');
          var select = {};
          select[nestedPrimaryKey] = true;
          select[nestedForeignKey] = true;

          find(nestedWhere, select, {}, function (err, docs) {
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
        var targetPrimaryKey = target.primaryKey;
        var find = mongoExec(target, 'find');
        var select = {};
        select[targetPrimaryKey] = true;
        select[relation.foreignKey] = true;

        find(whereRelation, select, {}, function (err, docs) {
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

    findOne(mongoQuery, {}, mongoOptions, function (err, doc) {
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
      var RelatedResource = factory(relation.target, Resource);
      var rquery = new Query({
        context: RelatedResource,
        state: relationQueryOpts
      });

      ops.push(function (resource, next) {
        // move to the bottom of the waterfall if we don't have anything
        if (!resource) {
          return next(null, null);
        }

        // prepare query to fetch related resource(s)
        if (relation.type === 'belongsTo') {
          if (!resource[relation.foreignKey]) {
            return next(null, resource);
          }
          rquery.where(
            RelatedResource.primaryKey,
            resource[relation.foreignKey]
          );
        } else {
          rquery.where(relation.foreignKey, resource.primary);
        }

        // use results from previous filter query
        if (cached[relationName]) {
          if (cached[relationName].constructor === Array) {
            resource[relationName] = RelatedResource.Collection.create(
              cached[relationName],
              {
                query: rquery
              }
            );
          } else {
            resource[relationName] = RelatedResource.create(
              cached[relationName]
            );
          }


          return next(null, resource);
        }

        // fetch related resource(s) and populate parent resource attribute
        mongoExec(RelatedResource, methods[relation.type])(
          prepareQueryOrDocument(rquery.where(), RelatedResource.attributes),
          {},
          buildQueryOptions(rquery),
          function (err, result) {
            if (err) return next(err);

            if (result && result.constructor === Array) {
              resource[relationName] = RelatedResource.Collection.create(
                result,
                {
                  query: rquery
                }
              );
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

            var RelatedResource = factory(throughRelation.target, RelatedResource);
            var relType = throughRelation.type;
            var foreignKey = throughRelation.foreignKey;
            var throughAttr = throughRelation.attribute;
            var intermediaries = {};

            // build query for related resources using intermediary (through)
            // resource attributes
            rquery = new Query({
              context: RelatedResource,
              state: relationQueryOpts.nested
            });

            if (relType === 'belongsTo') {
              rquery.where(RelatedResource.primaryKey, {
                $in: resource[relationName].map(function (through) {
                  intermediaries[through[foreignKey]] = through;
                  return through[foreignKey];
                })
              });
            } else if (relType === 'hasOne') {
              rquery.where(foreignKey, {
                $in: resource[relationName].map(function (through) {
                  intermediaries[through.primary] = through;
                  return through.primary;
                })
              });
            } else {
              rquery.where(foreignKey, {
                $in: resource[relationName].map(function (through) {
                  intermediaries[resource.primary] = through;
                  return resource.primary;
                })
              });
            }

            // fetch related resource(s) using query built from intermediary
            // (through) resources
            mongoExec(RelatedResource, 'find')(
              prepareQueryOrDocument(rquery.where(), RelatedResource.attributes),
              {},
              {
                sort: rquery.sort()
              },
              function (err, docs) {
                if (err) return next(err);

                var from = rquery.from();
                var size = rquery.size();

                // populate the intermediary (through) resource relation
                // attributes with their related resources
                docs.forEach(function (doc, i) {
                  var related = new RelatedResource(doc);
                  var through;

                  if (relType === 'belongsTo') {
                    through = intermediaries[related.primary];
                  } else {
                    through = intermediaries[related[foreignKey]];
                  }

                  if (through) {
                    if (relType === 'hasMany') {
                      if (i === 0) {
                        through[throughAttr] = new RelatedResource.Collection(
                          [],
                          {
                            query: rquery
                          }
                        );
                      }

                      through[throughAttr].push(related);
                    } else {
                      through[throughAttr] = related;
                    }
                  }
                });

                if (relType === 'hasMany' && size) {
                  docs.forEach(function (doc, i) {
                    var related = new RelatedResource(doc);
                    var through;

                    through = intermediaries[related[foreignKey]];

                    if (through) {
                      through[throughAttr].reset(through[throughAttr].slice(from, size));
                    }
                  });
                }

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
  var mongoQuery = prepareQueryOrDocument(query.where(), this.attributes);
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
      var target = factory(relation.target, Resource);
      var nestedAttr = nestedName && target.attributes[nestedName];
      var nestedRelation = nestedAttr && nestedAttr.relation;
      var whereRelation = unpack(clone(where))[relationName];

      if (nestedRelation) {
        var nestedTarget = factory(nestedRelation.target, target);
        var nestedWhere = whereRelation[nestedName];

        // remove where[relation] clause so it is not passed to mongo client
        delete whereRelation[nestedName];

        // operation to fetch resources to filter intermediary resources
        ops.push(function (filter, next) {
          var primaryKey = target.primaryKey;
          var nestedPrimaryKey = nestedTarget.primaryKey;
          var nestedForeignKey = nestedRelation.foreignKey;
          var find = mongoExec(nestedTarget, 'find');
          var select = {};
          select[nestedPrimaryKey] = true;
          select[nestedForeignKey] = true;

          find(nestedWhere, select, {}, function (err, docs) {
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

      // operation to fetch intermediary resources used to filter targets
      ops.push(function (filter, next) {
        var find = mongoExec(target, 'find');
        var targetPrimaryKey = target.primaryKey;
        var select = {};
        select[targetPrimaryKey] = true;
        select[relation.foreignKey] = true;

        find(whereRelation, select, {}, function (err, docs) {
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

    find(mongoQuery, {}, mongoOptions, function (err, docs) {
      if (err) return next(err);

      var collection = new Resource.Collection(docs, {
        query: query,
        total: docs.count
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
      var relType = relation.type;
      var RelatedResource = factory(relation.through || relation.target, Resource);
      var intermediaries = {};
      var related = {};
      related[relationName] = {};

      var rquery = new Query({
        context: RelatedResource,
        state: relationQueryOpts
      });

      ops.push(function (resources, next) {

        // move to the bottom of the waterfall if we don't have anything
        if (!resources || !resources.length) {
          return next(null, null);
        }

        // iterate over found resources and build query to fetch related
        // resources for this relation... sure would be easier with a JOIN :p
        resources.forEach(function (resource) {
          if (relation.type === 'belongsTo') {
            if (!rquery.where(RelatedResource.primaryKey)) {
              rquery.where(RelatedResource.primaryKey, { $in: [] });
            }

            rquery.where(RelatedResource.primaryKey).$in.push(
              resource[relation.foreignKey]
            );
          } else {
            if (!rquery.where(relation.foreignKey)) {
              rquery.where(relation.foreignKey, { $in: [] });
            }

            rquery.where(relation.foreignKey).$in.push(resource.primary);
          }

          if (relType === 'hasMany') {
            resource[relationName] = RelatedResource.Collection.create([], {
              query: rquery
            });
          }
        });

        // use results from previous filter query
        if (cached[relationName]) {
          if (cached[relationName].constructor === Array) {
            resources.forEach(function (resource) {
              resource[relationName] = RelatedResource.Collection.create(
                cached[relationName],
                {
                  query: rquery
                }
              );
            });
          } else {
            resources.forEach(function (resource) {
              resource[relationName] = RelatedResource.create(
                cached[relationName]
              );
            });
          }

          if (relType === 'belongsTo') {
            related[relationName][resource[relation.foreignKey]] = resource;
          } else {
            related[relationName][resource.primary] = resource;
          }

          return next(null, resources);
        }

        // fetch related resources and populate relation attribute
        mongoExec(RelatedResource, 'find')(
          prepareQueryOrDocument(rquery.where(), RelatedResource.attributes),
          {},
          {
            sort: rquery.sort()
          },
          function (err, results) {
            if (err) return next(err);

            var from = rquery.from();
            var size = rquery.size();

            resources.forEach(function (resource) {
              results.forEach(function (result) {
                var related = RelatedResource.create(result);

                if (relType === 'belongsTo') {
                  if (resource[relation.foreignKey] === related.primary) {
                    resource[relationName] = related;
                  }
                } else {
                  if (resource.primary === related[relation.foreignKey]) {
                    if (relType === 'hasOne') {
                      resource[relationName] = related;
                    } else {
                      resource[relationName].push(related);
                    }
                  }
                }
              });

              if (relType === 'hasMany' && size) {
                resource[relationName].total = resource[relationName].length;
                resource[relationName].reset(resource[relationName].slice(from, size));
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

            var RelatedResource = factory(throughRelation.target, RelatedResource);
            var relType = throughRelation.type;
            var primaryKey = RelatedResource.primaryKey;
            var foreignKey = throughRelation.foreignKey;
            var throughAttr = throughRelation.attribute;
            var intermediaries = {};

            // build query for related resources using intermediary (through)
            // resource attributes
            rquery = new Query({
              context: RelatedResource,
              state: relationQueryOpts.nested
            });

            if (relType === 'belongsTo') {
              // "belongsTo" query uses primary key of related resource
              rquery.where(primaryKey, {
                $in: []
              });

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  if (!intermediaries[through[foreignKey]]) {
                    intermediaries[through[foreignKey]] = [];
                  }
                  intermediaries[through[foreignKey]].push(through);
                  rquery.where(primaryKey).$in.push(through[foreignKey]);
                });
              });
            } else if (relType === 'hasOne')  {
              // "hasOne" and "hasMany" queries use foreign key of related
              // resource
              rquery.where(foreignKey, {
                $in: []
              });

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  if (!intermediaries[through.primary]) {
                    intermediaries[through.primary] = [];
                  }
                  intermediaries[through.primary].push(through);
                  rquery.where(foreignKey).$in.push(through.primary);
                });
              });
            } else {
              // "hasOne" and "hasMany" queries use foreign key of related
              // resource
              rquery.where(foreignKey, {
                $in: []
              });

              resources.forEach(function (resource) {
                resource[relationName].forEach(function (through) {
                  if (!intermediaries[resource.primary]) {
                    intermediaries[resource.primary] = [];
                  }
                  intermediaries[resource.primary].push(through);
                  rquery.where(foreignKey).$in.push(resource.primary);
                });
              });
            }

            // fetch related resource(s) using query built from intermediary
            // (through) resources
            mongoExec(RelatedResource, 'find')(
              prepareQueryOrDocument(rquery.where(), RelatedResource.attributes),
              {},
              {
                sort: rquery.sort()
              },
              function (err, docs) {
                if (err) return next(err);

                var from = rquery.from();
                var size = rquery.size();

                // populate the intermediary (through) resource relation
                // attributes with their related resources
                docs.forEach(function (doc, i) {
                  var related = new RelatedResource(doc);
                  var throughArr;

                  if (relType === 'belongsTo') {
                    throughArr = intermediaries[related.primary];
                  } else {
                    throughArr = intermediaries[related[foreignKey]];
                  }

                  if (throughArr) {
                    throughArr.forEach(function (through) {
                      if (relType === 'hasMany') {
                        if (i === 0) {
                          through[throughAttr] = new RelatedResource.Collection(
                            [],
                            {
                              query: rquery
                            }
                          );
                        }

                        through[throughAttr].push(related);
                      } else {
                        through[throughAttr] = related;
                      }
                    });
                  }
                });

                if (relType === 'hasMany' && size) {
                  docs.forEach(function (doc, i) {
                    var related = new RelatedResource(doc);
                    var throughArr;

                    throughArr = intermediaries[related[foreignKey]];

                    if (throughArr) {
                      throughArr.forEach(function (through) {
                        through[throughAttr].reset(through[throughAttr].slice(from, size));
                      });
                    }
                  });
                }

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
  var attributes = Resource.attributes;
  var representation = {};

  // set defaults and remove non-attributes
  for (var key in attributes) {
    if (typeof body[key] === 'undefined') {
      if (attributes[key].default) {
        if (typeof attributes[key].default === 'function') {
          representation[key] = attributes[key].default();
        } else {
          representation[key] = attributes[key];
        }
      }
    } else {
      representation[key] = body[key];
    }
  }

  mongoExec(Resource, 'insert')(
    prepareQueryOrDocument(representation, attributes),
    { w: 1 },
    function (err, result) {
      if (err) return next(err);

      if (!resource) {
        resource = new Resource();
      }

      resource.reset(result.pop());

      next(err, resource);
    });
};

/**
 * Update resource using given `changes`.
 *
 * @param {external:mio.Query} query
 * @param {Object} changes
 * @param {Function} next
 * @param {external:mio.Resource=} resource
 * @private
 */
exports.update = function (query, changes, next, resource) {
  var Resource = this;
  var attributes = Resource.attributes;
  var doc = prepareQueryOrDocument(changes, attributes);

  delete doc[attributes[Resource.primaryKey].alias || Resource.primaryKey];

  mongoExec(Resource, 'findAndModify')(
    prepareQueryOrDocument(query.where(), attributes),
    [],
    { $set: doc },
    { 'new': true },
    function (err, result) {
      if (err) return next(err);

      if (!resource) {
        resource = new Resource();
      }

      resource.reset(result);

      next(err, resource);
    });
};

/**
 * Replace resource using given `representation`.
 *
 * @param {external:mio.Query} query
 * @param {Object} representation
 * @param {Function} next
 * @param {external:mio.Resource=} resource
 * @private
 */
exports.replace = function (query, representation, next, resource) {
  var Resource = this;
  var attributes = Resource.attributes;
  var doc = prepareQueryOrDocument(representation, attributes);

  mongoExec(Resource, 'findAndModify')(
    prepareQueryOrDocument(query.where(), attributes),
    [],
    doc,
    { 'new': true },
    function (err, result) {
      if (err) return next(err);

      if (!resource) {
        resource = new Resource();
      }

      resource.reset(result);

      next(err, resource);
    });
};

/**
 * Replace resource using given `representation`.
 *
 * @param {external:mio.Query} query
 * @param {Object} representation
 * @param {Function} next
 * @param {external:mio.Resource.Collection=} collection
 * @private
 */
exports.replaceMany = function (query, representation, next, collection) {
  var Resource = this;
  var attributes = Resource.attributes;
  var doc = prepareQueryOrDocument(representation, attributes);

  mongoExec(Resource, 'update')(
    prepareQueryOrDocument(query.where(), attributes),
    doc,
    { upsert: true },
    function (err, result) {
      next(err, collection);
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
  var attributes = this.attributes;

  var options = buildQueryOptions(query);
  options.multi = true;

  this.emit('mongodb:query', query);

  mongoExec(this, 'update')(
    prepareQueryOrDocument(query.where(), attributes),
    {
      $set: prepareQueryOrDocument(changes, attributes),
    },
    options,
    function (err, result) {
      next(err);
    });
};

/**
 * Create resources using given `representations`.
 *
 * @param {Object} representations
 * @param {Function} next
 * @param {external:mio.Resource.Collection=} collection
 * @private
 */
exports.createMany = function (representations, next, collection) {
  var Resource = this;
  var attributes = Resource.attributes;

  representations.forEach(function (representation, i) {
    representations[i] = prepareQueryOrDocument(representations[i], attributes);
  });

  mongoExec(Resource, 'insert')(
    representations,
    { w: 1 },
    function (err, result) {
      if (err) return next(err);

      if (!collection) {
        collection = new Resource.Collection();
      }

      collection.reset(result);

      next(err, collection);
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
  mongoExec(this, 'remove')(
		prepareQueryOrDocument(query.where(), this.attributes),
		function (err, result) {
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
    prepareQueryOrDocument(query.where(), this.attributes),
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
        var select = args[1];
        var options = args[2];

        var cursor = settings.dbCollection.find(query, select, options);

        ['sort', 'skip', 'limit'].forEach(function (filter) {
          if (options[filter]) {
            cursor[filter](options[filter]);
          }
        });

        cursor.toArray(function (err, docs) {
          if (err) return cb(err);

          if (options.withCount) {
            settings.dbCollection.count(query, function (err, count) {
              if (err) return cb(err);

              docs.count = count;

              cb(err, docs);
            });
          } else {
            cb(err, docs);
          }
        });
      } else {
        settings.dbCollection[method].apply(settings.dbCollection, args);
      }
    }
  };
}

/**
 * Prepare query or document `obj` for storage.
 *
 * - Remove undefined or transient attributes
 * - Translate attribute names to aliases
 * - Cast id strings as ObjectIDs
 *
 * @param {Object} obj query or document
 * @param {external:mio.Resource.attributes} attributes
 * @returns {Object}
 * @private
 */
function prepareQueryOrDocument(obj, attributes, parentAttr) {
  var isArray = obj.constructor === Array;
  var prepared = isArray ? [] : {};

  for (var key in obj) {
    var val = obj[key];
    var currAttr = attributes[key];
    var attr = currAttr || parentAttr;
    var alias = currAttr && currAttr.alias;
    var type = typeof val;
    var toObjectId = type === 'string' && attr && attr.objectId;
    var isKeyword = key.charAt(0) === '$';

    if (!attr || (!attr.relation && !attr.transient)) {
      if (type === 'object' && val !== null && val.constructor !== Date) {
        prepared[alias || key] = prepareQueryOrDocument(
          obj[key],
          attributes,
          ((!isKeyword && attr) ? attr : parentAttr)
        );
      } else {
        prepared[alias || key] = toObjectId ? new ObjectID(val) : val;
      }
    }
  }

  return prepared;
}

/**
 * Prepare resource attributes.
 *
 * - Translate attribute aliases
 * - Stringify ObjectIDs
 * - Remove undefined attributes
 *
 * @param {external:mio.Resource} resource
 * @param {Object} attributes
 * @returns {Object}
 */
function prepareResource (resource, attributes) {
  attributes = attributes || {};
  for (var key in resource.constructor.attributes) {
    var attr = resource.constructor.attributes[key];
    var alias = attr && attr.alias;
    var value = attributes[alias || key];

    if (typeof value === 'object' && value !== null) {
      if (attr && attr.objectId) {
        attributes[alias || key] = value.toString();
      }
    }

    if (alias && typeof attributes[alias] !== 'undefined') {
      attributes[key] = attributes[alias];
      delete attributes[alias];
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

      if (typeof sortVal === 'string') {
        options.sort[key] = (sortVal === 'desc' ? (-1) : 1);
      } else {
        options.sort[key] = sortVal;
      }
    }
  }

  // set `skip` and `limit` from paging parameters
  options.skip = Number(query.from || 0);

  if (query.size) {
    options.limit = Number(query.size);
  }

  if (query.withCount) {
    options.withCount = true;
  }

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

function factory (fn, ctx) {
  if (typeof fn === 'function' && !fn.attributes) {
    return fn.call(ctx);
  }

  return fn;
}
