# mio-mongo [![Build Status](http://img.shields.io/travis/mio/mongo.svg?style=flat)](http://travis-ci.org/mio/mongo) [![Coverage Status](https://img.shields.io/coveralls/mio/mongo.svg?style=flat)](https://coveralls.io/r/mio/mongo?branch=master) [![NPM version](http://img.shields.io/npm/v/mio-mongo.svg?style=flat)](https://www.npmjs.org/package/mio-mongo) [![Dependency Status](http://img.shields.io/david/mio/mongo.svg?style=flat)](https://david-dm.org/mio/mongo)

> MongoDB storage plugin for Mio.

Install using [npm](https://www.npmjs.org/):

```sh
npm install mio-mongo
```

## Usage

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

#### ObjectIDs

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

#### Relations

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

#### Aliases

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

#### Mongo client

Access the mongo client directly via `Resource.options.mongo.db` and the
resource's collection via `Resource.options.mongo.dbCollection`.

## API Reference

<a name="module_mio-mongo"></a>
## mio-mongo

* [mio-mongo](#module_mio-mongo)
  * [module.exports(settings)](#exp_module_mio-mongo--module.exports) ⇒ <code>function</code> ⏏
    * [~prepareResource(resource, attributes)](#module_mio-mongo--module.exports..prepareResource) ⇒ <code>Object</code>
    * ["mongodb:query" (query)](#module_mio-mongo--module.exports..mongodb_query)
    * ["mongodb:collection" (collection)](#module_mio-mongo--module.exports..mongodb_collection)

<a name="exp_module_mio-mongo--module.exports"></a>
### module.exports(settings) ⇒ <code>function</code> ⏏
It is recommended to share the same `settings.db` object between
different resources so they can share the same mongo client and connection
pool.

A connection to mongo will be established automatically before any query is
run.

If you'd like to use the mongo client directly, the `db` is available via
`Resource.options.mongo.db`.

**Kind**: Exported function  
**Returns**: <code>function</code> - returns Mio plugin  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> |  |
| settings.collection | <code>String</code> | mongodb collection for this resource |
| [settings.connectionString] | <code>String</code> | mongodb connection string. required if `settings.db` is not provided. |
| [settings.connectionOptions] | <code>Object</code> | mongodb connection options |
| [settings.db] | <code>mongodb.MongoClient.Db</code> | reuse node-mongo-native db connection |

<a name="module_mio-mongo--module.exports..prepareResource"></a>
#### module.exports~prepareResource(resource, attributes) ⇒ <code>Object</code>
Prepare resource attributes.

- Translate attribute aliases
- Stringify ObjectIDs
- Remove undefined attributes

**Kind**: inner method of <code>[module.exports](#exp_module_mio-mongo--module.exports)</code>  

| Param | Type |
| --- | --- |
| resource | <code>[Resource](#external_mio.Resource)</code> | 
| attributes | <code>Object</code> | 

<a name="module_mio-mongo--module.exports..mongodb_query"></a>
#### "mongodb:query" (query)
Emitted with `query` argument whenever a `query` is received and before it
is processed, to allow for transformation.

**Kind**: event emitted by <code>[module.exports](#exp_module_mio-mongo--module.exports)</code>  

| Param | Type |
| --- | --- |
| query | <code>Object</code> | 

<a name="module_mio-mongo--module.exports..mongodb_collection"></a>
#### "mongodb:collection" (collection)
Emitted whenever a collection of resources is returned. Collections returned
by `mio-mongo` include `size` and `from` pagination properties.

**Kind**: event emitted by <code>[module.exports](#exp_module_mio-mongo--module.exports)</code>  

| Param | Type |
| --- | --- |
| collection | <code>external:mio.Resource.Collection</code> | 
| collection.from | <code>Number</code> | 
| collection.size | <code>Number</code> | 


### Events

## Contributing

Please submit all issues and pull requests to the [mio/mongo](http://github.com/mio/mongo) repository!

## Tests

Run tests using `npm test` or `gulp test`.

## Code coverage

Generate code coverage using `gulp coverage` and open `coverage.html` in your
web browser.

## Support

If you have any problem or suggestion please open an issue [here](https://github.com/mio/mongo/issues).
