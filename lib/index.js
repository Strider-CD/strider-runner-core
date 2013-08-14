
var Job = require('./job')

module.exports = {
  process: process,
  Job: Job
}

// config vbls:
//   pty: bool
//   io: eventemiter
//   logger: {log: , warn: , error: , info: }
//   dataDir: where to store data
//   plugins: {name: obj, ...} // this can be a superset of the plugins actually used
//   providers: {name: obj, ...}
function process(task, config, next) {
  var job = new Job(task, config, next)
  job.run()
}
