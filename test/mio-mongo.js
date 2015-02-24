/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

var expect = require('chai').expect;
var mio = require('mio');
var ObjectID = require('mongodb').ObjectID;
var MongoDB = process.env.JSCOV ? require('../lib-cov/mio-mongo') : require('../lib/mio-mongo');

function MongoDbStub(methods) {
  if (!(this instanceof MongoDbStub)) {
    return new MongoDbStub(methods);
  }

  return MongoDB({
    connectionString: 'localhost',
    collection: 'test',
    db: {
      collection: function (name) {
        return methods;
      }
    }
  });
};

describe('mio-mongo module', function() {
  it('exports plugin factory', function() {
    expect(MongoDB).to.be.a('function');
  });
});

describe('MongoDB', function() {
  it('returns a mio plugin function', function() {
    var Resource = mio.Resource.extend({
      use: [MongoDB({ url: "localhost" })]
    });
  });

  it('requires collection name', function () {
    expect(function() {
      mio.Resource.extend().use(MongoDB({}));
    }).to.throw(/connectionString or db/);
  });

  it('casts ObjectIDs in query or documents', function (done) {
      var Resource = mio.Resource.extend({
        attributes: {
          id: {
            alias: '_id',
            objectId: true,
            primary: true
          },
          authorId: {
            objectId: true
          },
          reviewId: {
            objectId: true
          }
        }
      }, {
        use: [new MongoDbStub({
          findAndModify: function (query, sorts, body, options, cb) {
            expect(query).to.be.an('object');
            expect(query).to.have.property('_id');
            expect(query).to.have.property('authorId');
            expect(query.authorId).to.be.an('object');
            expect(
              query.authorId.toString()
            ).to.equal('647dfc2bdc1e430000ff13c1');
            expect(query._id).to.be.an('object');
            expect(query._id).to.have.property('$in');
            expect(query._id.$in).to.be.an('array');
            expect(query._id.$in[0]).to.be.an('object');
            expect(
              query._id.$in[0].toString()
            ).to.equal('547dfc2bdc1e430000ff13b0');
            expect(body).to.be.an('object');
            expect(body).to.have.property('$set');
            expect(body.$set).to.be.an('object');
            expect(body.$set).to.have.property('reviewId');
            expect(body.$set.reviewId).to.be.an('object');
            expect(
              body.$set.reviewId.toString()
            ).to.equal('147dfc2bdc1e430000ff13b5');
            cb(null, { _id: '547dfc2bdc1e430000ff13b0' });
          }
        })]
      });

      Resource.patch({
        where: {
          id: {
            $in: ['547dfc2bdc1e430000ff13b0']
          },
          authorId: '647dfc2bdc1e430000ff13c1'
        }
      }, {
        reviewId: '147dfc2bdc1e430000ff13b5'
      }, function(err, resource) {
        if (err) return done(err);
        expect(resource).to.exist();
        done();
      });
  });

  it('stringifies ObjectIDs when setting resource attributes', function (done) {
    var Resource = mio.Resource.extend({
      attributes: {
        id: {
          alias: '_id',
          objectId: true,
          primary: true
        },
        authorId: {
          objectId: true
        },
        reviewId: {
          alias: 'review_id',
          objectId: true
        }
      }
    }, {
      use: [new MongoDbStub({
        findOne: function (query, options, cb) {
          cb(null, {
            _id: new ObjectID('547dfc2bdc1e430000ff13b0'),
            authorId: new ObjectID('647dfc2bdc1e430000ff13c1'),
            review_id: new ObjectID('147dfc2bdc1e430000ff13b5')
          });
        }
      })]
    });

    Resource.get('547dfc2bdc1e430000ff13b0', function (err, resource) {
      if (err) return done(err);

      expect(resource).to.have.property('id', '547dfc2bdc1e430000ff13b0');
      expect(resource).to.have.property('authorId', '647dfc2bdc1e430000ff13c1');
      expect(resource).to.have.property('reviewId', '147dfc2bdc1e430000ff13b5');

      done();
    });
  });

  it('does not prepare object attributes with null value', function (done) {
    var Resource = mio.Resource.extend({
      attributes: {
        id: {
          alias: '_id',
          objectId: true,
          primary: true
        },
        authorId: {
          objectId: true
        },
        reviewId: {
          alias: 'review_id',
          objectId: true
        }
      }
    }, {
      use: [new MongoDbStub({
        insert: function(doc, options, cb) {
          expect(doc).to.be.an('object');
          expect(doc).to.have.property('authorId', null);
          cb(null, [{
            _id: new ObjectID('547dfc2bdc1e430000ff13b0'),
            authorId: null,
            review_id: new ObjectID('147dfc2bdc1e430000ff13b5')
          }]);
        },
        findOne: function (query, options, cb) {
          cb(null, {
            _id: new ObjectID('547dfc2bdc1e430000ff13b0'),
            authorId: new ObjectID('647dfc2bdc1e430000ff13c1'),
            review_id: new ObjectID('147dfc2bdc1e430000ff13b5')
          });
        }
      })]
    });

    Resource.put({
      id: '547dfc2bdc1e430000ff13b0'
    }, {
      authorId: null
    }, function (err, resource) {
      if (err) return done(err);

      expect(resource).to.have.property('id', '547dfc2bdc1e430000ff13b0');
      expect(resource).to.have.property('authorId', null);
      expect(resource).to.have.property('reviewId', '147dfc2bdc1e430000ff13b5');

      done();
    });
  });

  it('does not stringify objectId attributes with null value', function (done) {
    var Resource = mio.Resource.extend({
      attributes: {
        id: {
          alias: '_id',
          objectId: true,
          primary: true
        },
        authorId: {
          objectId: true
        },
        reviewId: {
          alias: 'review_id',
          objectId: true
        }
      }
    }, {
      use: [new MongoDbStub({
        findOne: function (query, options, cb) {
          cb(null, {
            _id: new ObjectID('547dfc2bdc1e430000ff13b0'),
            authorId: null,
            review_id: new ObjectID('147dfc2bdc1e430000ff13b5')
          });
        }
      })]
    });

    Resource.get('547dfc2bdc1e430000ff13b0', function (err, resource) {
      if (err) return done(err);

      expect(resource).to.have.property('id', '547dfc2bdc1e430000ff13b0');
      expect(resource).to.have.property('authorId', null);
      expect(resource).to.have.property('reviewId', '147dfc2bdc1e430000ff13b5');

      done();
    });
  });

  it('does not mutate dates in documents or queries', function (done) {
      var Resource = mio.Resource.extend({
        attributes: {
          id: {
            alias: '_id',
            objectId: true,
            primary: true
          },
          createdAt: {},
          updatedAt: {
            required: true,
            default: function () {
              return new Date();
            }
          }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            expect(query).to.have.property('createdAt');
            expect(query.createdAt).to.be.instanceOf(Date);
            expect(query).to.have.property('updatedAt');
            expect(query.updatedAt).to.have.property('$gt');
            expect(query.updatedAt.$gt).to.be.an('array');
            expect(query.updatedAt.$gt[0]).to.be.an.instanceOf(Date);
            cb(null, {
              _id: new ObjectID('547dfc2bdc1e430000ff13b0'),
              createdAt: new Date()
            });
          }
        })]
      });

      Resource.get().where({
        id: '547dfc2bdc1e430000ff13b0',
        createdAt: new Date(),
        updatedAt: {
          $gt: [new Date()]
        }
      }).exec(function (err, resource) {
        if (err) return done(err);

        expect(resource).to.have.property('id', '547dfc2bdc1e430000ff13b0');
        expect(resource).to.have.property('createdAt');
        expect(resource.createdAt).to.be.instanceOf(Date);
        expect(resource).to.have.property('updatedAt');
        expect(resource.updatedAt).to.be.instanceOf(Date);

        done();
      });
  });

  describe('.findOne()', function() {
    it('finds one resource', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          id: {
            alias: '_id',
            primary: true
          }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, { _id: '547dfc2bdc1e430000ff13b0' });
          }
        })]
      });

      Resource.get({ id: '547dfc2bdc1e430000ff13b0' }, function(err, resource) {
        if (err) return done(err);
        expect(resource).to.exist();
        done();
      });
    });

    it('includes related resource', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          editor_id: {},
          author_id: {}
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, {
              id: '547dfc2bdc1e430000ff13b0',
              author_id: '647dfc2bdc1e430000ff13c1',
              editor_id: '647dfc2bdc1e430000ff13c1'
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, { id: '647dfc2bdc1e430000ff13c1' });
          }
        })]
      });

      var Certification = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, {
              id: '848dfc2bdc1e430000ff13j2',
              book_id: '547dfc2bdc1e430000ff13b0'
            });
          }
        })]
      });

      Book.belongsTo('author', {
        target: Author,
        foreignKey: 'author_id'
      });

      Book.belongsTo('editor', {
        target: Author,
        foreignKey: 'editor_id'
      });

      Book.hasOne('certification', {
        target: Certification,
        foreignKey: 'book_id'
      });

      Book.get(1).withRelated('author', 'editor', 'certification').exec(function (err, book) {
        if (err) return done(err);

        expect(book).to.not.be.empty();

        expect(book).to.have.property('author');
        expect(book.author).to.be.an('object');
        expect(book.author).to.not.be.empty();

        expect(book).to.have.property('editor');
        expect(book.author).to.be.an('object');
        expect(book.editor).to.not.be.empty();

        expect(book).to.have.property('certification');
        expect(book.certification).to.be.an('object');
        expect(book.certification).to.not.be.empty();

        done();
      });
    });

    it('filters by relation', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "647dfc2bdc1e430000ff13c1",
                  name: "test"
                }]);
              }
            }
          },
          findOne: function(query, options, cb) {
            cb(null, {
              id: "647dfc2bdc1e430000ff13c1",
              name: "test"
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                expect(query).to.be.an('object');

                cb(null, [{
                  id: "547dfc2bdc1e430000ff13b0",
                  name: "alex"
                }]);
              }
            };
          }
        })]
      });

      var Authorship = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {},
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '147dfc2bdc1e430000ff13b5',
                  author_id: '547dfc2bdc1e430000ff13b0',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      }).belongsTo('book', {
          target: Book,
          foreignKey: 'book_id'
        })
        .belongsTo('author', {
          target: Author,
          foreignKey: 'author_id'
        });

      Book.hasMany('authorships', {
        target: Authorship,
        foreignKey: 'book_id',
        nested: true
      });

      Book.get()
        .where({ 'authorships.author.name': 'alex' })
        .withRelated('authorships')
        .exec(function (err, book) {
          if (err) return done(err);

          expect(book).to.be.an('object');
          expect(book).to.have.property('authorships');
          expect(book.authorships).to.be.an('object');

          done();
        });
    });

    it('includes related collection', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {}
        }
      }, {
        use: [new MongoDbStub({
          findOne: function(query, options, cb) {
            cb(null, {
              id: '547dfc2bdc1e430000ff13b0',
              author_id: '647dfc2bdc1e430000ff13c1'
            });
          },
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                expect(query).to.have.property('author_id');
                cb(null, [{
                  id: '547dfc2bdc1e430000ff13b0',
                  author_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            }
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function(query, options, cb) {
            cb(null, { id: '647dfc2bdc1e430000ff13c1' });
          }
        })]
      });

      Author.hasMany('books', {
        target: Book,
        foreignKey: 'author_id'
      });

      Author.hasOne('book', {
        target: Book,
        foreignKey: 'author_id'
      });

      Author.get(1).withRelated('books', 'book').exec(function (err, author) {
        if (err) return done(err);

        expect(author).to.not.be.empty();

        expect(author).to.have.property('books');
        expect(author.books).to.not.be.empty();

        expect(author).to.have.property('book');
        expect(author.book).to.be.an('object');
        expect(author.book).to.not.be.empty();

        done();
      });
    });

    it('includes related collection through another resource', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "647dfc2bdc1e430000ff13c1",
                  name: "test"
                }]);
              }
            }
          },
          findOne: function(query, options, cb) {
            cb(null, {
              id: "647dfc2bdc1e430000ff13c1",
              name: "test"
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "547dfc2bdc1e430000ff13b0",
                  name: "alex"
                }]);
              }
            };
          }
        })]
      });

      var Review = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          body: { required: true },
          book_id: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '847dfc2bdc1e430000ff13h7',
                  body: 'test review body',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      });

      var Certification = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          authorship_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '873dfc2bdc1e430000ff13u8',
                  authorship_id: '147dfc2bdc1e430000ff13b5'
                }]);
              }
            };
          }
        })]
      });

      var Authorship = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {},
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '147dfc2bdc1e430000ff13b5',
                  author_id: '547dfc2bdc1e430000ff13b0',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      }).belongsTo('book', {
          target: Book,
          foreignKey: 'book_id'
        })
        .belongsTo('author', {
          target: Author,
          foreignKey: 'author_id'
        })
        .hasOne('certification', {
          target: Certification,
          foreignKey: 'authorship_id'
        })
        .hasMany('reviews', {
          target: Review,
          foreignKey: 'book_id'
        });

      Book.hasMany('authorships', {
        target: Authorship,
        foreignKey: 'book_id',
        nested: true
      });

      Book.get(1).withRelated('authorships').exec(function (err, book) {
        if (err) return done(err);

        expect(book).to.not.be.empty();

        expect(book).to.have.property('authorships');
        expect(book.authorships).to.not.be.empty();

        var authorship = book.authorships.at(0);

        expect(authorship).to.have.property('book');
        expect(authorship).to.have.property('author');
        expect(authorship).to.have.property('reviews');
        expect(authorship).to.have.property('certification');

        expect(authorship.author).to.be.an('object');
        expect(authorship.author).to.have.property('name', 'alex');

        expect(authorship.book).to.be.an('object');
        expect(authorship.book).to.have.property('name', 'test');

        expect(authorship.reviews).to.be.an.instanceOf(Review.Collection);
        expect(authorship.reviews).to.have.property('length', 1);
        expect(authorship.reviews.at(0)).to.have.property('id', '847dfc2bdc1e430000ff13h7')

        expect(authorship.certification).to.be.an('object');
        expect(authorship.certification).to.have.property('authorship_id', authorship.primary);

        done();
      });
    });

    it('uses relation-specific query', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          editor_id: {},
          author_id: {}
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, {
              id: '547dfc2bdc1e430000ff13b0',
              author_id: '647dfc2bdc1e430000ff13c1',
              editor_id: '647dfc2bdc1e430000ff13c1'
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, { id: '647dfc2bdc1e430000ff13c1' });
          }
        })]
      });

      Book.belongsTo('author', {
        target: Author,
        foreignKey: 'author_id'
      });

      Book.belongsTo('editor', {
        target: Author,
        foreignKey: 'editor_id'
      });

      Book.get(1).withRelated({
        author: {
          where: {
            test: 'foobar'
          }
        }
      })
      .withRelated('editor')
      .exec(function (err, book) {
        if (err) return done(err);

        expect(book).to.not.be.empty();

        expect(book).to.have.property('author');
        expect(book.author).to.be.an('object');
        expect(book.author).to.not.be.empty();

        expect(book).to.have.property('editor');
        expect(book.author).to.be.an('object');
        expect(book.editor).to.not.be.empty();

        done();
      });
    });
  });

  describe('.find()', function() {
    it('finds many resources', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                find: function(query, options) {
                  var chain = {
                    sort: function () { return chain; },
                    skip: function () { return chain; },
                    limit: function () { return chain; },
                    toArray: function (cb) {
                      cb(null, [{ active: true }]);
                    }
                  };
                  return chain;
                }
              };
            }
          }
        })]
      });

      Resource.Collection.get({ active: true }, function(err, resources) {
        if (err) return done(err);
        expect(resources).to.be.instanceOf(Resource.Collection);
        expect(resources.at(0)).to.have.property('active', true);
        done();
      });
    });

    it('transforms sort of "desc" into -1', function (done) {
      var Resource = mio.Resource.extend({
        attributes: {
          id: {
            alias: '_id'
          },
          name: {
            required: true,
            default: ''
          },
          createdAt: {
            required: true,
            default: function () {
              return new Date();
            }
          }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                find: function(query, options) {
                  expect(options).to.be.an('object');
                  expect(options).to.have.property('sort');
                  expect(options.sort).to.be.an('object');
                  expect(options.sort).to.have.property('name', -1);
                  expect(options.sort).to.have.property('createdAt', 1);

                  var chain = {
                    sort: function () { return chain; },
                    skip: function () { return chain; },
                    limit: function () { return chain; },
                    toArray: function (cb) {
                      cb(null, [{ _id: 123, nested: { nested: true } }]);
                    }
                  };
                  return chain;
                }
              };
            }
          }
        })]
      });

      Resource.Collection.get()
        .where({
          active: true
        })
        .sort({
          name: 'desc',
          createdAt: 'asc'
        })
        .exec(function(err, resources) {
          if (err) return done(err);
          expect(resources).to.be.instanceOf(Resource.Collection);
          expect(resources.at(0)).to.have.property('id', 123);
          done();
        });
    });

    it('transforms attribute names using their alias', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          id: {
            alias: '_id'
          },
          nested: {}
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                find: function(query, options) {
                  var chain = {
                    sort: function () { return chain; },
                    skip: function () { return chain; },
                    limit: function () { return chain; },
                    toArray: function (cb) {
                      cb(null, [{ _id: 123, nested: { nested: true } }]);
                    }
                  };
                  return chain;
                }
              };
            }
          }
        })]
      });

      Resource.Collection.get({ active: true }, function(err, resources) {
        if (err) return done(err);
        expect(resources).to.be.instanceOf(Resource.Collection);
        expect(resources.at(0)).to.have.property('id', 123);
        done();
      });
    });

    it('filters by relation', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true },
          editor_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "647dfc2bdc1e430000ff13c1",
                  name: "test"
                }]);
              }
            }
          },
          findOne: function(query, options, cb) {
            cb(null, {
              id: "647dfc2bdc1e430000ff13c1",
              name: "test"
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                expect(query).to.be.an('object');

                cb(null, [{
                  id: "547dfc2bdc1e430000ff13b0",
                  name: "alex"
                }]);
              }
            };
          }
        })]
      });

      var Certification = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          book_id: {},
          active: false
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '873dfc2bdc1e430000ff13u8',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      });

      var Review = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          authorship_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: 'uh7dfc2bdc1e430000ff1888',
                  authorship_id: '147dfc2bdc1e430000ff13b5',
                }]);
              }
            };
          }
        })]
      });

      var Authorship = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {},
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '147dfc2bdc1e430000ff13b5',
                  author_id: '547dfc2bdc1e430000ff13b0',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      }).belongsTo('book', {
          target: Book,
          foreignKey: 'book_id'
        })
        .belongsTo('author', {
          target: Author,
          foreignKey: 'author_id'
        })
        .hasMany('reviews', {
          target: Review,
          foreignKey: 'authorship_id'
        });

      Book
        .hasMany('authorships', {
          target: Authorship,
          foreignKey: 'book_id',
          nested: true
        })
        .belongsTo('editor', {
          target: Author,
          foreignKey: 'editor_id'
        })
        .hasOne('certification', {
          target: Certification,
          foreignKey: 'book_id'
        });

      Book.Collection.get()
        .where({
          'authorships.author.name': 'alex',
          'editor.name': 'bob',
          'certification.active': true
        })
        .exec(function (err, books) {
          if (err) return done(err);

          expect(books).to.be.instanceOf(Book.Collection);

          var book = books.at(0);

          expect(book).to.be.an('object');
          expect(book).to.have.property('authorships');

          done();
        });
    });

    it('includes related resource', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          editor_id: {},
          author_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '547dfc2bdc1e430000ff13b0',
                  author_id: '647dfc2bdc1e430000ff13c1',
                  editor_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{ id: '647dfc2bdc1e430000ff13c1' }]);
              }
            };
          }
        })]
      });

      var Certification = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '848dfc2bdc1e430000ff13j2',
                  book_id: '547dfc2bdc1e430000ff13b0'
                }]);
              }
            };
          }
        })]
      });

      Book.belongsTo('author', {
        target: Author,
        foreignKey: 'author_id'
      });

      Book.belongsTo('editor', {
        target: Author,
        foreignKey: 'editor_id'
      });

      Book.hasOne('certification', {
        target: Certification,
        foreignKey: 'book_id'
      });

      Book.Collection.get().withRelated('author', 'editor', 'certification').exec(function (err, books) {
        if (err) return done(err);

        expect(books).to.not.be.empty();

        var book = books.at(0);

        expect(book).to.be.an('object');

        expect(book).to.have.property('author');
        expect(book.author).to.be.an('object');
        expect(book.author).to.not.be.empty();

        expect(book).to.have.property('editor');
        expect(book.author).to.be.an('object');
        expect(book.editor).to.not.be.empty();

        expect(book).to.have.property('certification');
        expect(book.certification).to.be.an('object');
        expect(book.certification).to.not.be.empty();

        done();
      });
    });

    it('includes related collection', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {}
        }
      }, {
        use: [new MongoDbStub({
          findOne: function(query, options, cb) {
            cb(null, {
              id: '547dfc2bdc1e430000ff13b0',
              author_id: '647dfc2bdc1e430000ff13c1'
            });
          },
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                expect(query).to.have.property('author_id');
                cb(null, [{
                  id: '547dfc2bdc1e430000ff13b0',
                  author_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            }
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{ id: '647dfc2bdc1e430000ff13c1' }]);
              }
            };
          }
        })]
      });

      Author.hasMany('books', {
        target: Book,
        foreignKey: 'author_id'
      });

      Author.hasOne('book', {
        target: Book,
        foreignKey: 'author_id'
      });

      Author.Collection.get().withRelated('books', 'book').exec(function (err, authors) {
        if (err) return done(err);

        expect(authors).to.not.be.empty();

        var author = authors.at(0);

        expect(author).to.be.an('object');
        expect(author).to.have.property('books');
        expect(author.books).to.not.be.empty();

        expect(author).to.have.property('book');
        expect(author.book).to.be.an('object');
        expect(author.book).to.not.be.empty();

        done();
      });
    });

    it('includes related collection through another resource', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "647dfc2bdc1e430000ff13c1",
                  name: "test"
                }]);
              }
            }
          },
          findOne: function(query, options, cb) {
            cb(null, {
              id: "647dfc2bdc1e430000ff13c1",
              name: "test"
            });
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: "547dfc2bdc1e430000ff13b0",
                  name: "alex"
                }]);
              }
            };
          }
        })]
      });

      var Review = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          body: { required: true },
          book_id: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '847dfc2bdc1e430000ff13h7',
                  body: 'test review body',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      });

      var Certification = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          authorship_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '873dfc2bdc1e430000ff13u8',
                  authorship_id: '147dfc2bdc1e430000ff13b5'
                }]);
              }
            };
          }
        })]
      });

      var Authorship = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          author_id: {},
          book_id: {}
        }
      }, {
        use: [new MongoDbStub({
          find: function (query, options) {
            return {
              limit: function () {},
              toArray: function (cb) {
                cb(null, [{
                  id: '147dfc2bdc1e430000ff13b5',
                  author_id: '547dfc2bdc1e430000ff13b0',
                  book_id: '647dfc2bdc1e430000ff13c1'
                }]);
              }
            };
          }
        })]
      }).belongsTo('book', {
          target: Book,
          foreignKey: 'book_id'
        })
        .belongsTo('author', {
          target: Author,
          foreignKey: 'author_id'
        })
        .hasOne('certification', {
          target: Certification,
          foreignKey: 'authorship_id'
        })
        .hasMany('reviews', {
          target: Review,
          foreignKey: 'book_id'
        });

      Book.hasMany('authorships', {
        target: Authorship,
        foreignKey: 'book_id',
        nested: true
      });

      Book.Collection.get().where({
        id: { $in: [1] }
      }).withRelated('authorships').exec(function (err, books) {
        if (err) return done(err);

        expect(books).to.not.be.empty();

        var book = books.at(0);

        expect(book).to.have.property('authorships');
        expect(book.authorships).to.not.be.empty();

        var authorship = book.authorships.at(0);

        expect(authorship).to.have.property('book');
        expect(authorship).to.have.property('author');
        expect(authorship).to.have.property('reviews');
        expect(authorship).to.have.property('certification');

        expect(authorship.author).to.be.an('object');
        expect(authorship.author).to.have.property('name', 'alex');

        expect(authorship.book).to.be.an('object');
        expect(authorship.book).to.have.property('name', 'test');

        expect(authorship.reviews).to.be.an.instanceOf(Review.Collection);
        expect(authorship.reviews).to.have.property('length', 1);
        expect(authorship.reviews.at(0)).to.have.property('id', '847dfc2bdc1e430000ff13h7')

        expect(authorship.certification).to.be.an('object');
        expect(authorship.certification).to.have.property('authorship_id', authorship.primary);

        done();
      });
    });

    it('passes query pagination parameters to mongo', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            expect(options).to.be.an('object');
            expect(options).to.have.property('skip', 6);
            expect(options).to.have.property('limit', 100);
            return {
              skip: function (skip) {
                expect(skip).to.equal(6);
              },
              limit: function (limit) {
                expect(limit).to.equal(100);
              },
              toArray: function (cb) {
                cb(null, [{
                  id: "647dfc2bdc1e430000ff13c1",
                  name: "test"
                }]);
              }
            }
          }
        })]
      });

      Book.Collection.get().size(101).from(6).exec(done);
    });

    it('passes relation query parameters to mongo', function (done) {
      var Book = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          name: { required: true },
          authorId: { required: true }
        }
      }, {
        use: [new MongoDbStub({
          find: function(query, options) {
            expect(options).to.be.an('object');
            expect(options).to.have.property('skip', 6);
            expect(options).to.have.property('limit', 100);
            return {
              skip: function (skip) {
                expect(skip).to.equal(6);
              },
              limit: function (limit) {
                expect(limit).to.equal(100);
              },
              toArray: function (cb) {
                cb(null, [{
                  id: '647dfc2bdc1e430000ff13c1',
                  name: 'test'
                }]);
              }
            }
          }
        })]
      });

      var Review = mio.Resource.extend({
        attributes: {
          id: { primary: true },
          description: { required: true },
          bookId: { required: true }
        }
      }, {
        defaultPageSize: 70,
        use: [new MongoDbStub({
          find: function(query, options) {
            return {
              skip: function (skip) {
                expect(skip).to.equal(10);
              },
              limit: function (limit) {
                expect(limit).to.equal(70);
              },
              toArray: function (cb) {
                var result = [];

                for (var i = 0; i < 70; i++) {
                  result.push({
                    id: '547dfc2bdc1e430000ff13b0',
                    description: 'review',
                    bookId: '647dfc2bdc1e430000ff13c1'
                  });
                }

                cb(null, result);
              }
            };
          }
        })]
      });

      Book.hasMany('reviews', {
        target: Review,
        foreignKey: 'bookId'
      });

      Book.Collection.get().withRelated({
        reviews: {
          from: 10,
          size: 70
        }
      }).size(101).from(6).exec(function (err, books) {
        expect(books).to.be.an('object');
        expect(books).to.be.an.instanceOf(Book.Collection);
        expect(books).to.have.property('from', 6);
        expect(books).to.have.property('size', 100);
        expect(books).to.have.property('length', 1);

        var book = books.at(0);

        expect(book).to.be.an('object');
        expect(book).to.have.property('reviews');
        expect(book.reviews).to.be.an('object');
        expect(book.reviews).to.be.an.instanceOf(Review.Collection);
        expect(book.reviews).to.have.property('from', 10);
        expect(book.reviews).to.have.property('size', 70);
        expect(book.reviews).to.have.property('length', 70);

        done();
      });
    });
  });

  describe('.create()', function() {
    it('creates resource from POST', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                insert: function(query, options, cb) {
                  cb(null, [{ _id: 1, active: true }]);
                }
              };
            }
          }
        })]
      });

      Resource().set({ active: true }).post(function(err) {
        if (err) return done(err);
        expect(this).to.be.instanceOf(Resource);
        expect(this).to.have.property('active', true);
        done();
      });
    });

    it('creates resource from PUT', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                insert: function(query, options, cb) {
                  cb(null, [{ _id: 1, active: true }]);
                }
              };
            }
          }
        })]
      });

      Resource().set({ active: true }).put(function(err) {
        if (err) return done(err);
        expect(this).to.be.instanceOf(Resource);
        expect(this).to.have.property('active', true);
        done();
      });
    });

    it('persists defined, non-relation attributes only', function (done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                insert: function(query, options, cb) {
                  expect(query).to.have.property('active', true);
                  expect(query).to.not.have.property('invalid');
                  expect(query).to.not.have.property('author');
                  cb(null, [{ _id: 1, active: true }]);
                }
              };
            }
          }
        })]
      });

      var Author = mio.Resource.extend({
        attributes: {
          id: { primary: true }
        }
      }, {
        use: [new MongoDbStub({
          findOne: function (query, options, cb) {
            cb(null, { id: '647dfc2bdc1e430000ff13c1' });
          }
        })]
      });

      Resource.hasOne('author', {
        target: Author,
        foreignKey: 'authorId'
      });

      var resource = Resource.create();
      resource.active = true;
      resource.invalid = true;
      resource.author = new Author();

      resource.put(function(err) {
        if (err) return done(err);
        expect(this).to.be.instanceOf(Resource);
        expect(this).to.have.property('active', true);

        Resource.post({
          active: true,
          author: false,
          invalid: true
        }, function (err) {
          done(err);
        });
      });
    });
  });

  describe('.createMany()', function() {
    it('creates resources from POST', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                insert: function(query, options, cb) {
                  cb(null, [
                    { _id: 1, active: true },
                    { _id: 2, active: false }
                  ]);
                }
              };
            }
          }
        })]
      });

      Resource.Collection.post([
        { active: true },
        { active: false }
      ], function (err, collection) {
        if (err) return done(err);
        expect(collection).to.be.an('object');
        expect(collection).to.have.property('length', 2);
        done();
      });
    });
  });

  describe('.replace()', function() {
    it('creates resource from PUT', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                insert: function(doc, options, cb) {
                  cb(null, [{
                    _id: "547dfc2bdc1e430000ff13b0",
                    active: true
                  }]);
                }
              };
            }
          }
        })]
      });

      Resource.create().set({ active: true }).put(function(err, changed) {
        if (err) return done(err);
        expect(this).to.have.property('active', true);
        done();
      });
    });

    it('updates resource from PUT', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                findOne: function(query, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                },
                findAndModify: function(query, doc, sort, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                }
              };
            }
          }
        })]
      });

      Resource.get(1, function(err, resource) {
        if (err) return done(err);

        resource.set({ active: true }).put(function(err, changed) {
          if (err) return done(err);
          expect(this).to.have.property('active', true);
          done();
        });
      });
    });
  });

  describe('.replaceMany()', function() {
    it('replaces many resources', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                update: function(query, update, opts, cb) {
                  cb(null, { active: false });
                }
              };
            }
          }
        })]
      });

      Resource.Collection.put(
        { active: true },
        { $set: { active: false } },
        function(err, changes) {
          if (err) return done(err);
          done();
        });
    });
  });

  describe('.update()', function() {
    it('updates resource from PATCH', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                findOne: function(query, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                },
                findAndModify: function(query, doc, sort, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                }
              };
            }
          }
        })]
      });

      Resource.get(1, function(err, resource) {
        if (err) return done(err);

        resource.set({ active: true }).patch(function(err, changed) {
          if (err) return done(err);
          expect(this).to.have.property('active', true);
          done();
        });
      });
    });

    it('updates resource from PUT', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                findOne: function(query, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                },
                findAndModify: function(query, doc, sort, options, cb) {
                  cb(null, { _id: "547dfc2bdc1e430000ff13b0" });
                }
              };
            }
          }
        })]
      });

      Resource.get(1, function(err, resource) {
        if (err) return done(err);

        resource.set({ active: true }).put(function(err, changed) {
          if (err) return done(err);
          expect(this).to.have.property('active', true);
          done();
        });
      });
    });
  });

  describe('.updateMany()', function() {
    it('updates many resources', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                update: function(query, update, opts, cb) {
                  cb(null, { active: false });
                }
              };
            }
          }
        })]
      });

      Resource.Collection.patch(
        { active: true },
        { $set: { active: false } },
        function(err, changes) {
          if (err) return done(err);
          done();
        });
    });
  });

  describe('.destroy()', function() {
    it('removes resource', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                remove: function(query, cb) {
                  cb();
                }
              };
            }
          }
        })]
      });

      Resource({ _id: "547dfc2bdc1e430000ff13b0", active: true }).delete(done);
    });
  });

  describe('.destroyMany()', function() {
    it('removes many resources', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          connectionString: "localhost",
          collection: "users",
          db: {
            collection: function(name) {
              return {
                remove: function(query, options, cb) {
                  cb();
                }
              };
            }
          }
        })]
      });

      Resource.Collection.delete({ active: true }, done);
    });
  });
});
