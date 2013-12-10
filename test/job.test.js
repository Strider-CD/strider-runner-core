var expect = require('expect.js')
  , EventEmitter = require('events').EventEmitter
  , Job = require('../').Job

describe('Job', function () {
  var job
  describe('with no plugins', function () {
    beforeEach(function () {
      job = new Job(
        { id: 'man'
        },
        { fetch: function (dest, userConfig, config, done) {
          done(null)
        }
      }, [], {
        io: new EventEmitter()
      })
    })
    it('should fail', function (done) {
      this.timeout(30)
      job.run(function (err) {
        expect(err.message).to.match(/plugin/)
        done()
      })
    })
  })
})