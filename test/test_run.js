
var expect = require('expect.js')
  , process = require('../').process

  , EventEmitter = require('events').EventEmitter

describe('Integration', function () {
  it('should just work', function (done) {
    var called = {
      fetch: false,
      environment: false,
      prepare: false,
      test: false,
      deploy: false,
      cleanup: false
    }
    function cachier(sub) {
      return cachier
    }
    process({
      id: '123',
      type: 'TEST_AND_DEPLOY',
      ref: {
        branch: 'master'
      }
    }, { // provider
      fetch: function (context, done) {
        called.fetch = true
        done()
      }
    }, [{ // jobplugins
      environment: function (context, done) {
        called.environment = true
        done(null, true)
      },
      prepare: function (context, done) {
        called.prepare = true
        done(null, true)
      },
      test: function (context, done) {
        called.test = true
        done(null, true)
      },
      deploy: function (context, done) {
        called.deploy = true
        done(null, true)
      },
      cleanup: function (context, done) {
        called.cleanup = true
        done(null, true)
      }
    }], { // config
      dataDir: '/tmp/',
      cachier: cachier,
      io: new EventEmitter()
    }, function (err) {
      if (err) return done(err)
      for (var name in called) {
        if (!called[name]) {
          return done(new Error(name + ' was not called'))
        }
      }
      done()
    })
  })
})
