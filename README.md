# mio-mongo [![Build Status](http://img.shields.io/travis/mio/mongo.svg?style=flat)](http://travis-ci.org/mio/mongo) [![Coverage Status](https://img.shields.io/coveralls/mio/mongo.svg?style=flat)](https://coveralls.io/r/mio/mongo?branch=master) [![NPM version](http://img.shields.io/npm/v/mio-mongo.svg?style=flat)](https://www.npmjs.org/package/mio-mongo) [![Dependency Status](http://img.shields.io/david/mio/mongo.svg?style=flat)](https://david-dm.org/mio/mongo)

> MongoDB storage plugin for Mio.

**Example**  
```javascript
var mio = require('mio');
var MongoDB = require('mio-mongo');

var User = mio.Resource.extend({
  attributes: {
    id: {
      primary: true,
      alias: '_id'
    }
  },
}, {
  use: [MongoDB({
    url: 'mongodb://db.example.net:2500',
    collection: 'Users'
  })]
});
```

## Installation

Install using [npm](https://www.npmjs.org/):

```sh
npm install mio-mongo
```

## API Reference

<a name="module_mio-mongo"></a>
#mio-mongo
**Example**  
```javascript
var mio = require('mio');
var MongoDB = require('mio-mongo');

var User = mio.Resource.extend({
  attributes: {
    id: {
      primary: true,
      alias: '_id'
    }
  },
}, {
  use: [MongoDB({
    url: 'mongodb://db.example.net:2500',
    collection: 'Users'
  })]
});
```

<a name="exp_module_mio-mongo"></a>
##module.exports(settings) ⏏
It is recommended to share the same `settings` object between different
resources so they can share the same mongo client and connection pool.

A connection to mongo will be established automatically before any query is
run.

If you'd like to use the mongo client directly, it's available via
`Resource.mongo` and once connected the collection will be available via
`Resource.mongo.collection`.

**Params**

- settings `Object`  
  - url `String` - mongodb connection string  
  - collection `String` - mongodb collection for this resource  
  - \[options\] `Object` - mongodb connection options  
  - \[retry\] `Number` - connection retry delay in milliseconds
(default: 1000)  
  - \[client\] `mongodb.MongoClient` - mongo client instance to use  

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
Emitted whenever a collection of resources is returned.

**Params**

- collection `Array.<mio.Resource>`  
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
