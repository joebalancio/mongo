# mio-mongo [![Build Status](http://img.shields.io/travis/mio/mongo.svg?style=flat)](http://travis-ci.org/mio/mongo) [![Coverage Status](https://img.shields.io/coveralls/mio/mongo.svg?style=flat)](https://coveralls.io/r/mio/mongo?branch=master) [![NPM version](http://img.shields.io/npm/v/mio-mongo.svg?style=flat)](https://www.npmjs.org/package/mio-mongo) [![Dependency Status](http://img.shields.io/david/mio/mongo.svg?style=flat)](https://david-dm.org/mio/mongo)

> MongoDB storage plugin for Mio.

Install using [npm](https://www.npmjs.org/):

```sh
npm install mio-mongo
```

## API Reference

<a name="module_mio-mongo"></a>
#mio-mongo
**Example**  
## Basic usage

```javascript
var mio = require('mio');
var MongoDB = require('mio-mongo');

var User = mio.Resource.extend({
  attributes: {
    _id: {
      primary: true,
      objectId: true
    }
  }
});

User.use(MongoDB({
  url: 'mongodb://db.example.net:2500',
  collection: 'Users'
}));

User.Collection.get()
  .where({ active: true })
  .sort({ createdAt: 1 })
  .exec(function (err, users) {
    users.at(0).set({ active: false }).patch(function (err) {
      // ...
    });
  });
```

## Relations

```javascript
Post.belongsTo('author', {
  target: User,
  foreignKey: 'authorId'
});

User.hasMany('posts', {
  target: Post,
  foreignKey: 'authorId'
});

// fetch posts for user `123`
Post.Collection.get()
  .where({ 'author.id': 123 })
  .exec(function (err, posts) {
    // ...
  });

// fetch users with their posts included
User.Collection.get()
  .withRelated('posts')
  .exec(function (err, users) {
    users.pop().posts;
  });
```

## Aliases

```javascript
var User = mio.Resource.extend({
  attributes: {
    name: {
      alias: 'fullName'
    }
  }
});

// MongoDB query uses "fullName"
User.find({ name: 'Alex' }).exec(...);
```

## ObjectId

Automatically stringify and cast ObjectId's by setting `objectId: true`.

```javascript
var User = mio.Resource.extend({
  attributes: {
    companyId: {
      objectId: true
    }
  }
});

User.find({
  companyId: '547dfc2bdc1e430000ff13b0'
}).exec(function (err, user) {
  console.log(typeof user.companyId); // => "string"
});
```

<a name="exp_module_mio-mongo"></a>
##module.exports(settings) ⏏
It is recommended to share the same `settings.db` object between
different resources so they can share the same mongo client and connection
pool.

A connection to mongo will be established automatically before any query is
run.

If you'd like to use the mongo client directly, the `db` is available via
`Resource.options.mongo.db`.

**Params**

- settings `Object`  
  - collection `String` - mongodb collection for this resource  
  - \[connectionString\] `String` - mongodb connection string. required
if `settings.db` is not provided.  
  - \[connectionOptions\] `Object` - mongodb connection options  
  - \[db\] `mongodb.MongoClient.Db` - reuse node-mongo-native db
connection  

**Returns**: `function` - returns Mio plugin  


### Events

<a name="module_mio-mongo..mongodb_query"></a>
#event: "mongodb:query"
Emitted with `query` argument whenever a `query` is received and before it
is processed, to allow for transformation.

**Params**

- query `Object`  

**Scope**: inner event of [mio-mongo](#module_mio-mongo)  

<a name="module_mio-mongo..mongodb_collection"></a>
#event: "mongodb:collection"
Emitted whenever a collection of resources is returned. Collections returned
by `mio-mongo` include `size` and `from` pagination properties.

**Params**

- collection <code>[external:mio.Resource.Collection](external:mio.Resource.Collection)</code>  
  - from `Number`  
  - size `Number`  

**Scope**: inner event of [mio-mongo](#module_mio-mongo)  


## Contributing

Please submit all issues and pull requests to the [mio/mongo](http://github.com/mio/mongo) repository!

## Tests

Run tests using `npm test` or `gulp test`.

## Code coverage

Generate code coverage using `gulp coverage` and open `coverage.html` in your
web browser.

## Support

If you have any problem or suggestion please open an issue [here](https://github.com/mio/mongo/issues).
