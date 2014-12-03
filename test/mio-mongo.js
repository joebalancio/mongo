/*!
 * mio-mongo
 * https://github.com/mio/mongo
 */

'use strict';

var expect = require('chai').expect;
var mio = require('mio');
var MongoDB = process.env.JSCOV ? require('../lib-cov/mio-mongo') : require('../lib/mio-mongo');

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
    }).to.throw(/a collection/);
  });

  it('logs warning if settings object is not shared', function (done) {
    var log = console.log;

    console.log = function (message) {
      console.log = log;
      expect(message).to.match(/should be shared/);
      done();
    };

    mio.Resource.extend().use(MongoDB({
      collection: "test"
    }));
  });

  it('listens for db "close" event', function (done) {
    var Resource = mio.Resource.extend().use(MongoDB({
      collection: "test",
      client: {
        connect: function (url, opts, cb) {
          expect(Resource.mongo).to.have.property('connecting', true);
          cb(null, {
            collection: function(name) {
              return {
                findOne: function(query, options, cb) {
                  cb(null, { _id: 1 });
                }
              };
            },
            on: function (ev, handler) {
              if (ev === 'close') {
                handler();
                expect(Resource.mongo).to.have.property('connected', false);
                done();
              }
            }
          });
        }
      }
    }));

    Resource.findOne(1, function() {});
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
        use: [MongoDB({
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    findOne: function(query, options, cb) {
                      cb(null, { _id: 1 });
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.findOne({ id: 1 }, function(err, resource) {
        if (err) return done(err);
        expect(resource).to.exist();
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
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    find: function(query, options) {
                      return {
                        toArray: function (cb) {
                          cb(null, [{ active: true }]);
                        }
                      };
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.find({ active: true }, function(err, resources) {
        if (err) return done(err);
        expect(resources).to.be.instanceOf(Array);
        expect(resources[0]).to.have.property('active', true);
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
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    find: function(query, options) {
                      return {
                        toArray: function (cb) {
                          cb(null, [{ _id: 123, nested: { nested: true } }]);
                        }
                      };
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.find({ active: true }, function(err, resources) {
        if (err) return done(err);
        expect(resources).to.be.instanceOf(Array);
        expect(resources[0]).to.have.property('id', 123);
        done();
      });
    });
  });

  describe('.count()', function() {
    it('counts resources', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    count: function(query, options, cb) {
                      cb(null, 3);
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.count({ active: true }, function(err, count) {
        if (err) return done(err);
        expect(count).to.equal(3);
        done();
      });
    });
  });

  describe('.create()', function() {
    it('creates resource', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    insert: function(query, options, cb) {
                      cb(null, [{ _id: 1, active: true }]);
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource().set({ active: true }).save(function(err, changed) {
        if (err) return done(err);
        expect(this).to.be.instanceOf(Resource);
        expect(this).to.have.property('active', true);
        done();
      });
    });
  });

  describe('.update()', function() {
    it('updates resource', function(done) {
      var Resource = mio.Resource.extend({
        attributes: {
          _id: { primary: true },
          active: { default: false }
        },
      }, {
        use: [MongoDB({
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    findOne: function(query, options, cb) {
                      cb(null, { _id: 1 });
                    },
                    update: function(query, options, cb) {
                      cb();
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.findOne(1, function(err, resource) {
        if (err) return done(err);

        resource.set({ active: true }).save(function(err, changed) {
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
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    update: function(query, update, options, cb) {
                      cb(null, { active: false });
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.update(
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
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    remove: function(query, cb) {
                      cb();
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource({ _id: 1, active: true }).destroy(done);
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
          url: "localhost",
          collection: "users",
          client: {
            connect: function (url, opts, cb) {
              cb(null, {
                on: function() {},
                collection: function(name) {
                  return {
                    remove: function(query, options, cb) {
                      cb();
                    }
                  };
                }
              });
            }
          }
        })]
      });

      Resource.destroy({ active: true }, done);
    });
  });
});
