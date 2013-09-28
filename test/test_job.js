
var expect = require('expect.js')
  , EventEmitter = require('events').EventEmitter

  , Job = require('../').Job

var testplugin = function () {
  return {
    runPhase: function (context, next) {
      next()
    }
  }
}

describe('Job', function () {
  var job, data
  describe('with no plugins', function () {
    beforeEach(function () {
      data = {
        repo: {
          provider: null
        },
        job: {
          id: 'theid',
          plugins: []
        }
      }
      job = new Job(data, {
        fetch: function (dest, userConfig, config, done) {
          done(null)
        }
      }, [], {
        io: new EventEmitter()
      })
    })
    it('should fail', function (done) {
      this.timeout(30)
      job.run(function (err) {
        expect(err.message).to.match('plugin')
        done()
      })
    })
  })

  describe('with no provider', function () {
    
    beforeEach(function () {
      data = {
        repo: {
          provider: null
        },
        job: {
          id: 'theid',
          plugins: [{id: 'tester'}]
        }
      }
      job = new Job(data, {
        plugins: { tester: testplugin }
      });
    })

    it('should fail', function (done) {
      job.callback = function (err) {
        expect(err.message).to.match('provider')
        done()
      }
      job.run()
    })

  })

  describe('with a provider', function () {

    beforeEach(function () {
      data = {
        repo: {
          provider: {}
        }
      }
    })
  })
})
      
